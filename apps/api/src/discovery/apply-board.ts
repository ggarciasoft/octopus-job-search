/**
 * Applies a `fetch_board` result — or its terminal failure — to the scan,
 * the source and the jobs, inside the completing transaction.
 *
 * Called from `completeTask` / `failTaskRow` in `src/tasks/queue.ts` after the
 * lease check and the closed-schema validation, so the task state and the
 * domain state cannot disagree (04_API_CONTRACTS.md).
 *
 * Freshness and closure (05_DISCOVERY_CONNECTORS.md, `CLOSURE_RULES`):
 *
 *   "A job disappearing from two successful complete board snapshots at
 *    least 24 hours apart becomes closed. A failed/partial scan cannot close
 *    jobs."
 *
 * The bookkeeping lives on the provenance row, per source: a complete
 * snapshot that does not list an identity increments that identity's
 * `missing_snapshots` and records when the absence was first and last seen.
 * A job closes only when *every* provenance row through an enabled source
 * has met the rule — a job still listed elsewhere is not gone. A partial
 * result (`complete_snapshot: false`), a refusal, or a failure touches none
 * of these counters. Reappearance resets them and reopens the job.
 */
import { sql } from 'kysely';
import {
  CLOSURE_RULES,
  type FetchBoardResult,
  type NormalizedJob,
  type ScanCounts,
  type ScanStatus,
} from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import type { TaskRow } from '../db/types.js';
import { WorkspaceScope } from '../auth/scope.js';
import { upsertNormalizedJob } from './jobs.js';
import { lockScanForTask } from './scans.js';
import { lockSource, recordSourceFailure, recordSourceSuccess } from './sources.js';

interface Denial {
  readonly code: 'ACCESS_DENIED' | 'RATE_LIMITED';
  readonly detail: string;
  readonly retryAfterSeconds: number | null;
}

/**
 * A 403/429 anywhere in the fetch is a refusal, whatever else was fetched.
 * The worker may report it as a warning, as the observed HTTP status, or as
 * an observed `blocked` state; all three are read, because the source health
 * decision must not depend on which one a connector happened to fill in.
 */
function denialFrom(result: FetchBoardResult): Denial | null {
  const retryAfterSeconds = result.observed_health.retry_after_seconds;
  const warning = result.warnings.find(
    (entry) => entry.code === 'RATE_LIMITED' || entry.code === 'ACCESS_DENIED',
  );
  if (warning) {
    return {
      code: warning.code as Denial['code'],
      detail: warning.message,
      retryAfterSeconds,
    };
  }
  const status = result.observed_health.http_status;
  if (status === 429) {
    return { code: 'RATE_LIMITED', detail: 'The board answered HTTP 429.', retryAfterSeconds };
  }
  if (status === 403 || status === 401) {
    return {
      code: 'ACCESS_DENIED',
      detail: `The board answered HTTP ${status}.`,
      retryAfterSeconds,
    };
  }
  if (result.observed_health.state === 'blocked') {
    return { code: 'ACCESS_DENIED', detail: 'The board refused the request.', retryAfterSeconds };
  }
  return null;
}

/** Last occurrence wins: the same identity twice in one page is one posting. */
function dedupeBySourceKey(jobs: readonly NormalizedJob[]): NormalizedJob[] {
  const byKey = new Map<string, NormalizedJob>();
  for (const job of jobs) byKey.set(job.source_key, job);
  return [...byKey.values()];
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (60 * 60 * 1000);
}

/**
 * Marks every identity through this source that the complete snapshot did
 * not list, then closes the jobs for which the rule now holds.
 */
async function applyAbsences(
  scope: WorkspaceScope,
  sourceId: string,
  seenKeys: ReadonlySet<string>,
  snapshotAt: Date,
): Promise<number> {
  let query = scope
    .selectFrom('job_sources')
    .select(['id', 'job_id', 'source_key', 'last_missing_at'])
    .where('source_id', '=', sourceId);
  if (seenKeys.size > 0) query = query.where('source_key', 'not in', [...seenKeys]);
  const absent = await query.execute();

  const affectedJobs = new Set<string>();
  for (const row of absent) {
    // Idempotent against a replayed or out-of-order snapshot: one snapshot
    // time counts once, and an older one never counts after a newer one.
    if (row.last_missing_at !== null && row.last_missing_at >= snapshotAt) continue;
    await scope
      .updateTable('job_sources')
      .set({
        missing_snapshots: sql<number>`missing_snapshots + 1`,
        missing_since: sql<Date>`COALESCE(missing_since, ${snapshotAt})`,
        last_missing_at: snapshotAt,
        updated_at: new Date(),
      })
      .where('id', '=', row.id)
      .execute();
    affectedJobs.add(row.job_id);
  }

  let closed = 0;
  for (const jobId of affectedJobs) {
    if (await closeIfGone(scope, jobId, snapshotAt)) closed += 1;
  }
  return closed;
}

/**
 * The closure decision for one job. Only provenance through a source that
 * still exists and is enabled votes: a disabled board cannot testify that a
 * posting is gone, and a deleted one has no opinion.
 */
async function closeIfGone(scope: WorkspaceScope, jobId: string, at: Date): Promise<boolean> {
  const job = await scope
    .selectFrom('jobs')
    .select(['status'])
    .where('id', '=', jobId)
    .forUpdate()
    .executeTakeFirst();
  if (!job || job.status !== 'active') return false;

  const votes = await scope
    .selectFrom('job_sources')
    .innerJoin('sources', (join) =>
      join
        .onRef('sources.workspace_id', '=', 'job_sources.workspace_id')
        .onRef('sources.id', '=', 'job_sources.source_id'),
    )
    .select([
      'job_sources.missing_snapshots',
      'job_sources.missing_since',
      'job_sources.last_missing_at',
    ])
    .where('job_sources.job_id', '=', jobId)
    .where('sources.enabled', '=', true)
    .execute();
  if (votes.length === 0) return false;

  const gone = votes.every(
    (vote) =>
      vote.missing_snapshots >= CLOSURE_RULES.missingCompleteSnapshotsToClose &&
      vote.missing_since !== null &&
      vote.last_missing_at !== null &&
      hoursBetween(vote.missing_since, vote.last_missing_at) >=
        CLOSURE_RULES.minHoursBetweenSnapshots,
  );
  if (!gone) return false;

  await scope
    .updateTable('jobs')
    .set({ status: 'closed', closed_at: at, closed_reason: 'snapshot', updated_at: new Date() })
    .where('id', '=', jobId)
    .execute();
  return true;
}

export async function applyFetchBoardResult(
  trx: DbTransaction,
  task: TaskRow,
  result: FetchBoardResult,
): Promise<void> {
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  const scan = await lockScanForTask(scope, task.id);
  // The source (and with it the scan) was deleted while the fetch ran: the
  // user asked for its jobs to be kept, not for new ones to be added.
  if (scan === null) return;
  const source = await lockSource(scope, scan.source_id);

  const fetchedAt = new Date(result.fetched_at);
  const denial = denialFrom(result);
  const jobs = dedupeBySourceKey(result.jobs);
  const counts: ScanCounts = {
    fetched: result.jobs.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    closed: 0,
    pages: result.pages_fetched,
  };

  // What was fetched is real, even when the fetch then hit a wall.
  const origin = { connector: source.connector, sourceId: source.id, boardKey: source.board_key };
  for (const job of jobs) {
    const outcome = await upsertNormalizedJob(scope, job, origin, fetchedAt);
    if (outcome.created) counts.created += 1;
    else if (outcome.updated) counts.updated += 1;
    else counts.unchanged += 1;
  }

  // A refused fetch is never a complete snapshot, whatever the worker said.
  const complete = result.complete_snapshot && denial === null;
  if (complete) {
    counts.closed = await applyAbsences(
      scope,
      source.id,
      new Set(jobs.map((job) => job.source_key)),
      fetchedAt,
    );
  }

  let status: ScanStatus;
  if (denial !== null) status = jobs.length > 0 ? 'partial' : 'failed';
  else status = complete ? 'succeeded' : 'partial';

  await scope
    .updateTable('scans')
    .set({
      status,
      complete_snapshot: complete,
      counts: JSON.stringify(counts),
      error_code: denial?.code ?? null,
      error_message: denial?.detail.slice(0, 500) ?? null,
      // The worker's observation time: when the board was actually read.
      started_at: fetchedAt,
      completed_at: new Date(),
      updated_at: new Date(),
    })
    .where('id', '=', scan.id)
    .execute();

  if (denial === null) {
    await recordSourceSuccess(scope, source.id, {
      at: fetchedAt,
      etag: result.etag,
      lastModified: result.last_modified,
    });
  } else {
    await recordSourceFailure(scope, source, {
      at: fetchedAt,
      code: denial.code,
      detail: denial.detail,
      retryAfterSeconds: denial.retryAfterSeconds,
    });
  }
}

/** Terminal task failure: the scan ends, the source degrades, nothing closes. */
export async function applyFetchBoardFailure(
  trx: DbTransaction,
  task: TaskRow,
  code: string,
  message: string,
): Promise<void> {
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  const scan = await lockScanForTask(scope, task.id);
  if (scan === null) return;
  if (scan.status !== 'queued' && scan.status !== 'running') return;

  const now = new Date();
  await scope
    .updateTable('scans')
    .set({
      status: code === 'CANCELLED' ? 'cancelled' : 'failed',
      complete_snapshot: false,
      error_code: code.slice(0, 64),
      error_message: message.slice(0, 500),
      completed_at: now,
      updated_at: now,
    })
    .where('id', '=', scan.id)
    .execute();

  if (code === 'CANCELLED') return;
  const source = await lockSource(scope, scan.source_id);
  await recordSourceFailure(scope, source, {
    at: now,
    code,
    detail: message,
    retryAfterSeconds: null,
  });
}
