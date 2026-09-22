/**
 * Deleting a workspace (PR14; AT26: "Access revoked, files erased, completion
 * recorded without PII").
 *
 * 09_SECURITY_PRIVACY.md: "Deletion revokes access immediately and queues
 * erasure; show completion or failure." That sentence splits the work in two,
 * and so does this module.
 *
 * **`requestWorkspaceDeletion` is the revocation, in one transaction.** The
 * workspace is marked `deleting`, which login already refuses; every session
 * and every paired device is revoked and the device credentials destroyed;
 * work in flight is cancelled, so a worker holding a lease can no longer
 * complete it or upload an artifact; the deletion goes into the ledger, so a
 * restore of an older backup re-deletes it; and a receipt is written. Either
 * all of that happens or none of it does.
 *
 * **`eraseWorkspace` is the erasure, and it may be repeated.** Stored objects
 * first, then the rows in one cascade, then the owner account. It runs inline
 * from the request, so a local installation normally answers with a finished
 * receipt, and the scheduler resumes any erasure a crash or a storage fault
 * interrupted. Every step is safe to run twice.
 *
 * Why not a `delete_workspace` task, as 02_ARCHITECTURE.md lists? A task row
 * is workspace data: it would be erased by the deletion it describes, and the
 * user could not read it anyway, because their session is revoked first. The
 * receipt (`workspace_deletions`, migration 0010) is the task's honest
 * replacement: operator-global, readable without a session, and holding
 * nothing that identifies anyone.
 */
import type { WorkspaceDeletionView } from '@job-getter/contracts';
import type { Config } from '../config.js';
import type { Db, DbExecutor } from '../db/pool.js';
import type { StorageDriver } from '../files/storage.js';
import type { Logger } from '../logging.js';
import { WorkspaceScope } from '../auth/scope.js';
import { SETUP_COMPLETED_FLAG } from '../routes/setup.js';
import { recordDeletion } from './ledger.js';

/**
 * Erasure passes before a receipt is marked `failed`. The scheduler retries
 * once a minute, so a storage outage of a few minutes is ridden out, and a
 * persistent one is reported rather than retried forever in silence.
 */
export const MAX_ERASE_ATTEMPTS = 5;

/** How long an `erasing` receipt must sit untouched before the scheduler resumes it. */
export const ERASE_RESUME_AFTER_MS = 30_000;

export interface DeletionReceipt {
  readonly id: string;
  readonly workspace_id: string;
  readonly state: 'erasing' | 'completed' | 'failed';
  readonly requested_at: Date;
  readonly completed_at: Date | null;
  readonly attempts: number;
  readonly files_erased: number;
  readonly failure_code: string | null;
  readonly setup_reopened: boolean;
}

export function toDeletionView(receipt: DeletionReceipt): WorkspaceDeletionView {
  return {
    deletion_id: receipt.id,
    state: receipt.state,
    requested_at: receipt.requested_at.toISOString(),
    completed_at: receipt.completed_at === null ? null : receipt.completed_at.toISOString(),
    files_erased: receipt.files_erased,
    failure_code: receipt.failure_code,
    setup_reopened: receipt.setup_reopened,
  };
}

export async function findDeletionReceipt(
  db: DbExecutor,
  id: string,
): Promise<DeletionReceipt | null> {
  const row = await db
    .selectFrom('workspace_deletions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return (row as DeletionReceipt | undefined) ?? null;
}

/**
 * Revokes all access to the workspace and records the deletion. One
 * transaction; returns the receipt.
 *
 * A workspace already being deleted returns its existing receipt rather than
 * a second one. That can only happen through a race, because the first
 * request revoked the session a second one would need.
 */
export async function requestWorkspaceDeletion(
  db: Db,
  workspaceId: string,
): Promise<DeletionReceipt> {
  return db.transaction().execute(async (trx) => {
    const workspace = await trx
      .selectFrom('workspaces')
      .select(['id', 'deletion_state'])
      .where('id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (workspace.deletion_state !== 'active') {
      const existing = await trx
        .selectFrom('workspace_deletions')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .orderBy('requested_at', 'desc')
        .executeTakeFirstOrThrow();
      return existing as DeletionReceipt;
    }

    const now = new Date();
    await trx
      .updateTable('workspaces')
      .set({ deletion_state: 'deleting', updated_at: now })
      .where('id', '=', workspaceId)
      .execute();

    const scoped = WorkspaceScope.forTaskWorkspace(trx, workspaceId);

    // Every session, not only the one that asked: a second browser signed in
    // to the same workspace loses access at the same instant.
    await scoped
      .updateTable('sessions')
      .set({ revoked_at: now, updated_at: now })
      .where('revoked_at', 'is', null)
      .execute();

    // Revoked the way DELETE /devices/:id revokes: the credential goes too, so
    // a copy left on the runner's disk is inert rather than merely refused.
    await scoped
      .updateTable('paired_devices')
      .set({
        revoked_at: now,
        token_hash: null,
        expires_at: null,
        pairing_code_hash: null,
        pairing_expires_at: null,
        updated_at: now,
      })
      .where('revoked_at', 'is', null)
      .execute();

    // Cancelled outright, lease and all. A worker mid-task then gets 409 on
    // complete, fail, heartbeat and artifact upload, so nothing it produces
    // can land in a workspace that is being erased.
    await scoped
      .updateTable('tasks')
      .set({
        state: 'cancelled',
        cancel_requested: true,
        lease_token_hash: null,
        lease_expires_at: null,
        leased_by: null,
        updated_at: now,
      })
      .where('state', 'in', ['queued', 'leased'])
      .execute();

    await recordDeletion(trx, { workspaceId, kind: 'workspace', reason: 'user_request' });

    const receipt = await trx
      .insertInto('workspace_deletions')
      .values({ workspace_id: workspaceId, requested_at: now })
      .returningAll()
      .executeTakeFirstOrThrow();
    return receipt as DeletionReceipt;
  });
}

export interface EraseContext {
  readonly db: Db;
  readonly storage: StorageDriver;
  readonly config: Pick<Config, 'isHosted'>;
  readonly logger: Logger;
}

/**
 * Erases the workspace a receipt names. Never throws: a failed pass is
 * recorded on the receipt, and the receipt is returned in whatever state the
 * pass reached.
 */
export async function eraseWorkspace(
  context: EraseContext,
  deletionId: string,
): Promise<DeletionReceipt> {
  const { db, storage, logger } = context;

  const started = await db
    .updateTable('workspace_deletions')
    .set((eb) => ({ attempts: eb('attempts', '+', 1), updated_at: new Date() }))
    .where('id', '=', deletionId)
    .where('state', '=', 'erasing')
    .returningAll()
    .executeTakeFirst();
  if (!started) {
    // Already completed or failed; report it as it stands.
    const current = await findDeletionReceipt(db, deletionId);
    if (!current) throw new Error(`No deletion receipt ${deletionId}.`);
    return current;
  }
  const receipt = started as DeletionReceipt;
  const workspaceId = receipt.workspace_id;

  try {
    // Objects before rows. If this pass dies after the rows are gone, there
    // would be nothing left to say which objects were the workspace's; the
    // other way round, a retry simply finds them again.
    const files = await db
      .selectFrom('files')
      .select(['storage_key'])
      .where('workspace_id', '=', workspaceId)
      .execute();
    for (const file of files) await storage.delete(file.storage_key);
    // And whatever no row names: a crashed upload, an orphaned artifact.
    await storage.deleteWorkspaceObjects(workspaceId);

    const finished = await db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('workspace_deletions')
        .selectAll()
        .where('id', '=', deletionId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      // A concurrent pass finished first.
      if (locked.state !== 'erasing') return locked as DeletionReceipt;

      const owner = await trx
        .selectFrom('workspaces')
        .select(['owner_user_id'])
        .where('id', '=', workspaceId)
        .executeTakeFirst();

      // One statement, and the foreign keys do the rest: every private table
      // cascades from `workspaces`. The ledger and this receipt do not.
      await trx.deleteFrom('workspaces').where('id', '=', workspaceId).execute();

      // The owner's account is personal data too (an email address and a
      // password hash). It goes unless it still belongs to another workspace,
      // which in v1 it never does.
      if (owner) {
        await trx
          .deleteFrom('users')
          .where('id', '=', owner.owner_user_id)
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('memberships')
                  .select('memberships.id')
                  .whereRef('memberships.user_id', '=', 'users.id'),
              ),
            ),
          )
          .execute();
      }

      const setupReopened = await reopenSetupIfEmpty(trx, context.config);

      const updated = await trx
        .updateTable('workspace_deletions')
        .set({
          state: 'completed',
          completed_at: new Date(),
          files_erased: files.length,
          setup_reopened: setupReopened,
          updated_at: new Date(),
        })
        .where('id', '=', deletionId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return updated as DeletionReceipt;
    });

    // Once more, after the rows: an artifact upload that passed its lease
    // check just before the revocation could have written bytes since the
    // first sweep. Nothing can write here now.
    await storage.deleteWorkspaceObjects(workspaceId);

    logger.info(
      {
        deletion_id: deletionId,
        state: finished.state,
        files_erased: finished.files_erased,
        attempts: finished.attempts,
      },
      'workspace erasure finished',
    );
    return finished;
  } catch (error) {
    const exhausted = receipt.attempts >= MAX_ERASE_ATTEMPTS;
    logger.error(
      { deletion_id: deletionId, attempts: receipt.attempts, exhausted, err: error },
      'workspace erasure pass failed',
    );
    if (!exhausted) return receipt;
    const failed = await db
      .updateTable('workspace_deletions')
      .set({ state: 'failed', failure_code: 'erasure_failed', updated_at: new Date() })
      .where('id', '=', deletionId)
      .where('state', '=', 'erasing')
      .returningAll()
      .executeTakeFirst();
    return (failed as DeletionReceipt | undefined) ?? receipt;
  }
}

/**
 * A local installation whose last account is gone goes back to first-run.
 *
 * setup.ts closes setup permanently, and deliberately: removing the owner row
 * by some other route must not reopen it. A workspace deletion is the one
 * exception, because it is the owner asking for a clean slate, with their
 * password, and it leaves nothing behind to protect. Setup still needs
 * SETUP_TOKEN and a local or private-network source address. Hosted
 * installations never use this route to bootstrap, so they are left alone.
 */
async function reopenSetupIfEmpty(
  trx: DbExecutor,
  config: Pick<Config, 'isHosted'>,
): Promise<boolean> {
  if (config.isHosted) return false;
  const anyUser = await trx.selectFrom('users').select('id').limit(1).executeTakeFirst();
  if (anyUser) return false;
  const removed = await trx
    .deleteFrom('system_flags')
    .where('key', '=', SETUP_COMPLETED_FLAG)
    .executeTakeFirst();
  return Number(removed.numDeletedRows ?? 0n) > 0;
}

/**
 * Resumes erasures that a crash or a storage fault left unfinished. Called by
 * the scheduler; a receipt touched in the last ERASE_RESUME_AFTER_MS is left
 * to the request that is still working on it.
 */
export async function resumePendingErasures(context: EraseContext): Promise<{ resumed: number }> {
  const pending = await context.db
    .selectFrom('workspace_deletions')
    .select(['id'])
    .where('state', '=', 'erasing')
    .where('updated_at', '<=', new Date(Date.now() - ERASE_RESUME_AFTER_MS))
    .orderBy('requested_at', 'asc')
    .limit(20)
    .execute();
  for (const row of pending) await eraseWorkspace(context, row.id);
  return { resumed: pending.length };
}
