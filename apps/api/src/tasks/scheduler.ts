/**
 * Background housekeeping, built on plain timers.
 *
 * 02_ARCHITECTURE.md explicitly forbids introducing Redis, Celery or BullMQ to
 * bridge languages, so there is no external scheduler here: `setInterval` plus
 * PostgreSQL row locks. Running several API replicas is safe because every job
 * selects its work with `FOR UPDATE SKIP LOCKED` — two replicas firing at the
 * same instant simply divide the rows between them.
 *
 * Jobs:
 *  * reclaim expired leases, so a crashed worker's task converges (AT18);
 *  * sweep staging artifacts older than ARTIFACT_STAGING_TTL_HOURS, since
 *    "unreferenced artifacts expire after 24 hours";
 *  * prune expired idempotency records and revoked/expired sessions.
 */
import { sql } from 'kysely';
import { ARTIFACT_STAGING_TTL_HOURS } from '@job-getter/contracts';
import type { Db } from '../db/pool.js';
import type { Logger } from '../logging.js';
import type { StorageDriver } from '../files/storage.js';
import { pruneIdempotencyRecords } from './idempotency.js';
import { reclaimExpiredLeases } from './queue.js';

export const ARTIFACT_STAGING_TTL_MS = ARTIFACT_STAGING_TTL_HOURS * 60 * 60 * 1000;

export interface SchedulerOptions {
  readonly db: Db;
  readonly storage: StorageDriver;
  readonly logger: Logger;
  readonly reclaimIntervalMs?: number;
  readonly sweepIntervalMs?: number;
  readonly pruneIntervalMs?: number;
}

/**
 * Deletes staging files whose expiry has passed and which no completed task
 * committed. Storage objects are removed before the rows, so a crash midway
 * leaves a row pointing at a missing object (detectable) rather than an
 * orphaned blob nothing will ever revisit.
 */
export async function sweepStaleArtifacts(
  db: Db,
  storage: StorageDriver,
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const stale = await db
    .selectFrom('files')
    .select(['id', 'workspace_id', 'storage_key'])
    .where('state', '=', 'staging')
    .where('expires_at', 'is not', null)
    .where('expires_at', '<=', now)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('task_artifacts')
            .select('task_artifacts.id')
            .whereRef('task_artifacts.file_id', '=', 'files.id')
            .where('task_artifacts.committed', '=', true),
        ),
      ),
    )
    .limit(500)
    .execute();

  let deleted = 0;
  for (const file of stale) {
    await storage.delete(file.storage_key).catch(() => undefined);
    await db.deleteFrom('task_artifacts').where('file_id', '=', file.id).execute();
    const result = await db.deleteFrom('files').where('id', '=', file.id).executeTakeFirst();
    deleted += Number(result.numDeletedRows ?? 0n);
  }
  return { deleted };
}

/** Removes sessions that are expired or long revoked. */
export async function pruneSessions(db: Db): Promise<number> {
  const result = await db
    .deleteFrom('sessions')
    .where((eb) =>
      eb.or([
        eb('expires_at', '<=', sql<Date>`now() - interval '7 days'`),
        eb('revoked_at', '<=', sql<Date>`now() - interval '7 days'`),
      ]),
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0n);
}

export interface Scheduler {
  start(): void;
  stop(): Promise<void>;
  /** Runs every job once, immediately. Used by tests and by `start()`. */
  runOnce(): Promise<void>;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { db, storage, logger } = options;
  const reclaimIntervalMs = options.reclaimIntervalMs ?? 15_000;
  const sweepIntervalMs = options.sweepIntervalMs ?? 5 * 60_000;
  const pruneIntervalMs = options.pruneIntervalMs ?? 10 * 60_000;

  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  /** Serialises jobs and never lets one rejection kill the process. */
  const guard = async (name: string, job: () => Promise<unknown>): Promise<void> => {
    if (stopped) return;
    const started = Date.now();
    const run = job()
      .then((result) => {
        logger.debug({ job: name, duration_ms: Date.now() - started, result }, 'scheduler job');
      })
      .catch((error: unknown) => {
        logger.error(
          { job: name, duration_ms: Date.now() - started, err: error },
          'scheduler job failed',
        );
      });
    inFlight = inFlight.then(() => run);
    await run;
  };

  const reclaim = () => guard('reclaim_leases', () => reclaimExpiredLeases(db));
  const sweep = () => guard('sweep_artifacts', () => sweepStaleArtifacts(db, storage));
  const prune = () =>
    guard('prune', async () => ({
      idempotency: await pruneIdempotencyRecords(db),
      sessions: await pruneSessions(db),
    }));

  return {
    start() {
      if (timers.length > 0) return;
      stopped = false;
      const schedule = (fn: () => void, intervalMs: number) => {
        const timer = setInterval(fn, intervalMs);
        // Never hold the event loop open: the server's own listener does that.
        timer.unref();
        timers.push(timer);
      };
      schedule(() => void reclaim(), reclaimIntervalMs);
      schedule(() => void sweep(), sweepIntervalMs);
      schedule(() => void prune(), pruneIntervalMs);
      logger.info(
        { reclaimIntervalMs, sweepIntervalMs, pruneIntervalMs },
        'task scheduler started',
      );
    },

    async stop() {
      stopped = true;
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
      // Let an in-flight job finish so shutdown does not abort a sweep midway.
      await inFlight.catch(() => undefined);
    },

    async runOnce() {
      await reclaim();
      await sweep();
      await prune();
    },
  };
}
