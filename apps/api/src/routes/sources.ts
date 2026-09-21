/**
 * GET/POST /sources, PATCH/DELETE /sources/:id, POST /sources/:id/scan.
 *
 * A source is a *seeded* public board: "Public listings APIs are not a
 * universal directory of employers. Seed boards manually."
 * (05_DISCOVERY_CONNECTORS.md). Registering one asserts nothing about
 * permission to crawl; the health state records what the board actually
 * answered, and a blocked source stays blocked until the user says otherwise.
 *
 * Deleting a source keeps its jobs and their provenance ("keep historical
 * jobs", 04_API_CONTRACTS.md): `job_sources.source_id` is nulled by the
 * foreign key, the `jobs` rows are untouched.
 */
import type {
  AcceptedResponse,
  CreateSourceRequest,
  PatchSourceRequest,
  SourceView,
} from '@job-getter/contracts';
import { conflict } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import type { SourceRow } from '../db/types.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { connectorVersion, validateBaseUrl } from '../discovery/connectors.js';
import { startScan } from '../discovery/scans.js';
import { loadSource, lockSource, toSourceView } from '../discovery/sources.js';
import { recordDeletion } from '../privacy/ledger.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const listSources: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const rows = (await scope
    .selectFrom('sources')
    .selectAll()
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as SourceRow[];

  const items: SourceView[] = [];
  for (const row of rows) items.push(await toSourceView(scope, row));
  // The contract paginates this list; the registry is bounded by hand-seeding
  // and is returned whole, so there is never a next page.
  return reply.status(200).send({ items, next_cursor: null });
};

export const createSource: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as CreateSourceRequest;

  const baseUrl = validateBaseUrl(body.connector, body.base_url);
  const boardKey = body.board_key.trim();

  const existing = await scope
    .selectFrom('sources')
    .select('id')
    .where('connector', '=', body.connector)
    .where('board_key', '=', boardKey)
    .executeTakeFirst();
  if (existing) {
    throw conflict(`A ${body.connector} source for "${boardKey}" is already registered.`);
  }

  const created = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const row = (await scoped
      .insertInto('sources', {
        connector: body.connector,
        connector_version: connectorVersion(body.connector),
        board_key: boardKey,
        base_url: baseUrl,
        enabled: true,
        // Due immediately: the scheduler's next pass queues the first scan.
        next_scan_after: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as SourceRow;

    await recordAuditEvent(scoped, {
      action: 'source.created',
      actorId: principal.userId,
      objectId: row.id,
      objectType: 'source',
      metadata: { connector: body.connector, has_base_url: baseUrl !== null },
    });
    return row;
  });

  return reply.status(201).send(await toSourceView(scope, created));
};

export const patchSource: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const body = request.body as PatchSourceRequest;

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const row = await lockSource(scoped, id);

    const baseUrl =
      body.base_url === undefined ? row.base_url : validateBaseUrl(row.connector, body.base_url);

    // `enabled: true` is the user's explicit "try again": it clears a block
    // and the counters behind it, whatever the current enabled flag was.
    const reenable = body.enabled === true;
    const disable = body.enabled === false;

    await scoped
      .updateTable('sources')
      .set({
        enabled: body.enabled === undefined ? row.enabled : body.enabled,
        base_url: baseUrl,
        ...(reenable
          ? {
              health_state: 'unknown',
              consecutive_failures: 0,
              consecutive_denials: 0,
              last_error_code: null,
              last_error_at: null,
              health_detail: null,
              next_scan_after: null,
            }
          : {}),
        // Conditional-request hints belong to the endpoint they came from.
        ...(baseUrl !== row.base_url ? { etag: null, last_modified: null } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', row.id)
      .execute();

    await recordAuditEvent(scoped, {
      action: 'source.updated',
      actorId: principal.userId,
      objectId: row.id,
      objectType: 'source',
      metadata: {
        enabled: body.enabled ?? null,
        reenabled_from: reenable ? row.health_state : null,
        disabled: disable,
        base_url_changed: baseUrl !== row.base_url,
      },
    });

    return lockSource(scoped, row.id);
  });

  return reply.status(200).send(await toSourceView(scope, updated));
};

export const deleteSource: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };

  await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const row = await lockSource(scoped, id);

    const kept = await scoped
      .selectFrom('job_sources')
      .select((eb) => eb.fn.count<string>('id').as('count'))
      .where('source_id', '=', row.id)
      .executeTakeFirst();

    // The foreign keys do the work: provenance rows keep the job and lose
    // only the source pointer (ON DELETE SET NULL); scans go with the source.
    await scoped.deleteFrom('sources').where('id', '=', row.id).execute();
    // Recorded so a restore of an older backup cannot bring the board back
    // (03_DATA_MODEL.md, "Privacy lifecycle").
    await recordDeletion(trx, {
      workspaceId: scope.workspaceId,
      kind: 'source',
      objectId: row.id,
    });

    await recordAuditEvent(scoped, {
      action: 'source.deleted',
      actorId: principal.userId,
      objectId: row.id,
      objectType: 'source',
      metadata: { connector: row.connector, provenance_kept: Number(kept?.count ?? 0) },
    });
  });

  return reply.status(204).send();
};

export const scanSource: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const idempotencyKey = readIdempotencyKey(request);

  // Scope check first, outside the replay store: a foreign id is a 404
  // before any idempotency record could be written for it.
  await loadSource(scope, id);

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    `POST /sources/${id}/scan`,
    async () => {
      try {
        const started = await context.db.transaction().execute(async (trx) => {
          const scoped = scope.withExecutor(trx);
          const source = await lockSource(scoped, id);
          const result = await startScan(trx, scope, source, { idempotencyKey });
          await recordAuditEvent(scoped, {
            action: 'source.scan_queued',
            actorId: principal.userId,
            objectId: result.scan.id,
            objectType: 'scan',
            metadata: { source_id: source.id, connector: source.connector, manual: true },
          });
          return result;
        });
        return {
          status: 202,
          body: { task_id: started.task.id, status: 'queued' } satisfies AcceptedResponse,
        };
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === '23505'
        ) {
          throw conflict('A scan with this Idempotency-Key already exists for this workspace.');
        }
        throw error;
      }
    },
  );

  return sendOutcome(reply, outcome);
};
