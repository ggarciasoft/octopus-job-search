/**
 * The single chokepoint that resolves a workspace from an authenticated
 * principal and injects it into every query on private data.
 *
 * "The API derives workspace from the authenticated principal; it never trusts
 * a client workspace_id" (04_API_CONTRACTS.md) and "Hosted data must be scoped
 * to the authenticated workspace on every operation" (invariant 8).
 *
 * The design goal is that forgetting the scope is a *type error*:
 *
 *  * `WorkspaceScope.selectFrom` / `updateTable` / `deleteFrom` only accept
 *    the names in `WORKSPACE_SCOPED_TABLES` and always append the
 *    `workspace_id` predicate themselves.
 *  * `insertInto` rejects a caller-supplied `workspace_id` at the type level
 *    (`Omit<…, 'workspace_id'>`) and supplies its own.
 *  * The raw `Kysely` handle is reachable only through `unscoped()`, whose
 *    name is intended to be conspicuous in review, and which is used solely
 *    for operator-global tables (`users`, `workspaces`, `system_flags`,
 *    `worker_registrations`).
 *
 * The casts below are the only place in the API where a table name is widened,
 * and they exist because Kysely cannot express "every table in this union has
 * a `workspace_id` column" without a generic constraint over its schema type.
 */
import type {
  DeleteQueryBuilder,
  DeleteResult,
  InsertQueryBuilder,
  InsertResult,
  SelectQueryBuilder,
  UpdateQueryBuilder,
  UpdateResult,
  Insertable,
  Updateable,
} from 'kysely';
import type { DbExecutor } from '../db/pool.js';
import type { Database, WorkspaceScopedTable } from '../db/types.js';

/** Who is making the request. Resolved by the authentication hooks. */
export type PrincipalKind = 'session' | 'worker' | 'device';

export interface SessionPrincipal {
  readonly kind: 'session';
  readonly userId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  /** Raw token, needed to derive the expected anti-CSRF value. */
  readonly sessionToken: string;
}

/**
 * The operator's polling worker. It processes many workspaces, so it has no
 * workspace of its own; task-scoped endpoints derive the workspace from the
 * task row it holds a lease on.
 */
export interface WorkerPrincipal {
  readonly kind: 'worker';
  readonly workerId: string;
}

/**
 * A paired local runner or extension. Device pairing is milestone M4/M5, so no
 * device token can be issued yet — but the *authorization rules* for one are
 * implemented and tested now, because retrofitting them later is how
 * cross-workspace holes appear.
 */
export interface DevicePrincipal {
  readonly kind: 'device';
  readonly deviceId: string;
  readonly workspaceId: string;
}

export type Principal = SessionPrincipal | WorkerPrincipal | DevicePrincipal;

export function principalWorkspaceId(principal: Principal): string | null {
  return principal.kind === 'worker' ? null : principal.workspaceId;
}

// The empty output type Kysely itself uses before any `select()` call.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type EmptySelection = {};

type ScopedSelect<T extends WorkspaceScopedTable> = SelectQueryBuilder<Database, T, EmptySelection>;
type ScopedUpdate<T extends WorkspaceScopedTable> = UpdateQueryBuilder<
  Database,
  T,
  T,
  UpdateResult
>;
type ScopedDelete<T extends WorkspaceScopedTable> = DeleteQueryBuilder<Database, T, DeleteResult>;
type ScopedInsert<T extends WorkspaceScopedTable> = InsertQueryBuilder<Database, T, InsertResult>;

/**
 * A workspace-bound view of the database.
 *
 * Construct one per request from the authenticated principal, never from a
 * request body, query parameter or header.
 */
export class WorkspaceScope {
  readonly workspaceId: string;
  private readonly executor: DbExecutor;

  private constructor(executor: DbExecutor, workspaceId: string) {
    this.executor = executor;
    this.workspaceId = workspaceId;
  }

  /**
   * The only supported way to obtain a scope. A worker principal has no
   * workspace of its own and therefore cannot produce one; task endpoints call
   * `forTaskWorkspace` after reading the task row they hold a lease on.
   */
  static fromPrincipal(executor: DbExecutor, principal: Principal): WorkspaceScope | null {
    const workspaceId = principalWorkspaceId(principal);
    return workspaceId === null ? null : new WorkspaceScope(executor, workspaceId);
  }

  /**
   * Scope derived from a task the caller has already been authorised for (by
   * holding its active lease). The workspace still comes from the server-side
   * row, never from the request.
   */
  static forTaskWorkspace(executor: DbExecutor, workspaceId: string): WorkspaceScope {
    return new WorkspaceScope(executor, workspaceId);
  }

  /** Re-binds the same workspace to a transaction handle. */
  withExecutor(executor: DbExecutor): WorkspaceScope {
    return new WorkspaceScope(executor, this.workspaceId);
  }

  selectFrom<T extends WorkspaceScopedTable>(table: T): ScopedSelect<T> {
    const builder = this.executor.selectFrom(table) as unknown as ScopedSelect<T>;
    return builder.where(
      `${table}.workspace_id` as never,
      '=',
      this.workspaceId as never,
    ) as unknown as ScopedSelect<T>;
  }

  updateTable<T extends WorkspaceScopedTable>(table: T): ScopedUpdate<T> {
    const builder = this.executor.updateTable(table) as unknown as ScopedUpdate<T>;
    return builder.where(
      `${table}.workspace_id` as never,
      '=',
      this.workspaceId as never,
    ) as unknown as ScopedUpdate<T>;
  }

  deleteFrom<T extends WorkspaceScopedTable>(table: T): ScopedDelete<T> {
    const builder = this.executor.deleteFrom(table) as unknown as ScopedDelete<T>;
    return builder.where(
      `${table}.workspace_id` as never,
      '=',
      this.workspaceId as never,
    ) as unknown as ScopedDelete<T>;
  }

  /**
   * `workspace_id` is omitted from the accepted value type: a caller cannot
   * pass one even by accident, and the scope's own id is always used.
   */
  insertInto<T extends WorkspaceScopedTable>(
    table: T,
    values: Omit<Insertable<Database[T]>, 'workspace_id'>,
  ): ScopedInsert<T> {
    const builder = this.executor.insertInto(table) as unknown as ScopedInsert<T>;
    return builder.values({
      ...(values as Record<string, unknown>),
      workspace_id: this.workspaceId,
    } as never) as unknown as ScopedInsert<T>;
  }

  /** Convenience for the common `SET ... , updated_at = now()` shape. */
  touch<T extends WorkspaceScopedTable>(
    table: T,
    values: Omit<Updateable<Database[T]>, 'workspace_id'>,
  ): ScopedUpdate<T> {
    return this.updateTable(table).set({
      ...(values as Record<string, unknown>),
      updated_at: new Date(),
    } as never) as unknown as ScopedUpdate<T>;
  }

  /**
   * Escape hatch for operator-global tables only (`users`, `workspaces`,
   * `system_flags`, `worker_registrations`, `schema_migrations`). Using it for
   * a workspace-scoped table is a review failure, not a style preference.
   */
  unscoped(): DbExecutor {
    return this.executor;
  }
}

/** Records an audit row. Metadata must already be redacted by the caller. */
export async function recordAuditEvent(
  scope: WorkspaceScope,
  event: {
    action: string;
    actorId?: string | null;
    objectId?: string | null;
    objectType?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await scope
    .insertInto('audit_events', {
      action: event.action,
      actor_id: event.actorId ?? null,
      object_id: event.objectId ?? null,
      object_type: event.objectType ?? null,
      metadata: JSON.stringify(event.metadata ?? {}),
    })
    .execute();
}
