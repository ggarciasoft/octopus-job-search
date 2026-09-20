/**
 * The bounded scan scheduler.
 *
 * 05_DISCOVERY_CONNECTORS.md: "scan interval 24 hours with jitter", and the
 * user's `scan_interval_hours` preference (08_UX_AND_CUSTOMIZATION.md). Every
 * enabled, non-blocked source whose `next_scan_after` has passed (or was never
 * set) gets exactly one `fetch_board` queued; `startScan` then moves
 * `next_scan_after` forward by the interval plus jitter, so a source is never
 * scanned faster than configured however often this runs.
 *
 * Concurrency: each source is handled in its own transaction under
 * `FOR UPDATE SKIP LOCKED`, so two API replicas firing together divide the
 * due sources between them rather than double-queueing, and one source's
 * failure cannot roll back another's scan. The partial unique index
 * `scans_one_in_flight_idx` is the last line of defence against a second
 * in-flight scan for the same source.
 */
import type { Db } from '../db/pool.js';
import type { SourceRow } from '../db/types.js';
import { ApiError } from '../errors.js';
import { WorkspaceScope } from '../auth/scope.js';
import { IN_FLIGHT_STATUSES, startScan } from './scans.js';

export interface ScheduleScansOptions {
  readonly now?: Date;
  readonly random?: () => number;
  /** Upper bound per run; the next run picks up the rest. */
  readonly limit?: number;
}

export interface ScheduleScansResult {
  readonly queued: string[];
  readonly skipped: string[];
}

function isDue(source: SourceRow, now: Date): boolean {
  return (
    source.enabled &&
    source.health_state !== 'blocked' &&
    (source.next_scan_after === null || source.next_scan_after.getTime() <= now.getTime())
  );
}

export async function scheduleDueScans(
  db: Db,
  options: ScheduleScansOptions = {},
): Promise<ScheduleScansResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  const queued: string[] = [];
  const skipped: string[] = [];

  // Candidates first, without locks: cheap, and each one is re-checked under
  // its own row lock below.
  const candidates = await db
    .selectFrom('sources')
    .select(['id'])
    .where('enabled', '=', true)
    .where('health_state', '<>', 'blocked')
    .where((eb) => eb.or([eb('next_scan_after', 'is', null), eb('next_scan_after', '<=', now)]))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('scans')
            .select('scans.id')
            .whereRef('scans.source_id', '=', 'sources.id')
            .where('scans.status', 'in', [...IN_FLIGHT_STATUSES]),
        ),
      ),
    )
    .orderBy('next_scan_after', 'asc')
    .limit(limit)
    .execute();

  for (const candidate of candidates) {
    const outcome = await db.transaction().execute(async (trx) => {
      const source = (await trx
        .selectFrom('sources')
        .selectAll()
        .where('id', '=', candidate.id)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst()) as SourceRow | undefined;
      // Locked by a replica or a manual scan, or changed since we looked.
      if (!source || !isDue(source, now)) return 'skipped';

      const scope = WorkspaceScope.forTaskWorkspace(trx, source.workspace_id);
      try {
        await startScan(trx, scope, source, { now, random: options.random });
        return 'queued';
      } catch (error) {
        // "Already in flight" is a legitimate answer, not a fault. Anything
        // else propagates so the scheduler's guard logs it.
        if (error instanceof ApiError && error.status === 409) return 'skipped';
        throw error;
      }
    });
    (outcome === 'queued' ? queued : skipped).push(candidate.id);
  }

  return { queued, skipped };
}
