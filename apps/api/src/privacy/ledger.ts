/**
 * The deletion ledger: what was deleted, so a restore cannot bring it back.
 *
 * 03_DATA_MODEL.md: "Restore must reapply a deletion ledger before exposing
 * data." Restoring a backup taken before a deletion resurrects the deleted
 * rows, and a restore script cannot know which ones those were — it needs a
 * list, and the list has to outlive both the rows and, for a workspace
 * deletion, the workspace.
 *
 * Two properties make it work, and both are unusual enough to state:
 *
 * **It is written on the deletion, not derived afterwards.** Every route that
 * removes something calls `recordDeletion` inside the same transaction. A
 * ledger reconstructed later from what is *missing* would be a ledger that
 * cannot tell a deletion from a row that never existed.
 *
 * **It is operator-global.** No workspace scope, no foreign key, not in the
 * export, not in the cascade. The whole point is that it survives what it
 * records; `scripts/reapply-deletions.sql` replays it after a restore.
 */
import type { DeletedObjectKind } from '@job-getter/contracts';
import type { DbExecutor } from '../db/pool.js';

/** Short machine reasons. Never free text, which would carry detail. */
export type DeletionReason = 'user_request' | 'retention_expiry' | 'workspace_deleted';

export interface DeletionRecord {
  readonly workspaceId: string;
  readonly kind: DeletedObjectKind;
  /** Null only for a whole-workspace deletion; the constraint enforces it. */
  readonly objectId?: string | null;
  readonly reason?: DeletionReason;
}

/**
 * Records one deletion.
 *
 * Takes a raw executor rather than a `WorkspaceScope` on purpose: the ledger is
 * not workspace-scoped data, and routing it through the scope helper would
 * both fail its type constraint and suggest it cascades, which is the one
 * thing it must not do.
 */
export async function recordDeletion(db: DbExecutor, record: DeletionRecord): Promise<void> {
  await db
    .insertInto('deletion_ledger')
    .values({
      workspace_id: record.workspaceId,
      object_kind: record.kind,
      object_id: record.kind === 'workspace' ? null : (record.objectId ?? null),
      reason: record.reason ?? 'user_request',
    })
    .execute();
}
