/**
 * Scans: the shared "queue a board fetch" path and the scan read model.
 *
 * `startScan` is used by both `POST /sources/:id/scan` and the scheduler, so
 * a manual scan and a scheduled one build the same `FetchBoardInput` from the
 * same limits and set the same `next_scan_after`. Everything happens in the
 * caller's transaction: the scan row, the task row and the source update are
 * committed together or not at all (02_ARCHITECTURE.md step 2).
 */
import {
  DEFAULT_PREFERENCES,
  DISCOVERY_LIMITS,
  type FetchBoardInput,
  type Preferences,
  type ScanCounts,
  type ScanView,
} from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import type { ScanRow, SourceRow, TaskRow } from '../db/types.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { enqueueTask } from '../tasks/enqueue.js';
import { ensurePreferences, readStoredConfig } from '../settings/preferences.js';
import { isScannable } from './sources.js';

export const ZERO_COUNTS: ScanCounts = {
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  closed: 0,
  pages: 0,
};

/** Scan states that occupy the one-in-flight slot for a source. */
export const IN_FLIGHT_STATUSES = ['queued', 'running'] as const;

export function hoursFromNowWithJitter(
  from: Date,
  hours: number,
  random: () => number = Math.random,
): Date {
  // Jitter is only ever added: a configured interval is a floor, never a
  // target to be undershot ("scan interval 24 hours with jitter").
  const jitterMs = random() * DISCOVERY_LIMITS.scanIntervalJitterMinutes * 60 * 1000;
  return new Date(from.getTime() + hours * 60 * 60 * 1000 + jitterMs);
}

/**
 * Preferences for a workspace, tolerating a row written under an older
 * settings version: the scheduler must not stop scanning every board — and
 * the jobs list must not stop listing — because one workspace has stale
 * preferences. The settings page itself still reports the staleness.
 */
export async function workspacePreferences(scope: WorkspaceScope): Promise<Preferences> {
  const row = await ensurePreferences(scope);
  try {
    return readStoredConfig(row);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export interface StartScanOptions {
  readonly idempotencyKey?: string | null;
  readonly now?: Date;
  readonly random?: () => number;
}

export interface StartedScan {
  readonly scan: ScanRow;
  readonly task: TaskRow;
}

/**
 * Queues one `fetch_board` for a source the caller has locked.
 *
 * Refuses a disabled or blocked source with 422 (the user must re-enable it)
 * and a source that already has a scan in flight with 409; the partial unique
 * index `scans_one_in_flight_idx` enforces the latter even across replicas.
 */
export async function startScan(
  trx: DbTransaction,
  scope: WorkspaceScope,
  source: SourceRow,
  options: StartScanOptions = {},
): Promise<StartedScan> {
  const scoped = scope.withExecutor(trx);
  const now = options.now ?? new Date();

  if (!isScannable(source)) {
    throw unprocessable(
      source.enabled
        ? 'This source is blocked after repeated refusals from the board. ' +
            'Re-enable it (PATCH /sources/:id with enabled: true) to scan again.'
        : 'This source is disabled. Enable it to scan.',
      { id: source.enabled ? 'Source health is "blocked".' : 'Source is disabled.' },
    );
  }

  const inFlight = await scoped
    .selectFrom('scans')
    .select(['id', 'task_id'])
    .where('source_id', '=', source.id)
    .where('status', 'in', [...IN_FLIGHT_STATUSES])
    .executeTakeFirst();
  if (inFlight) {
    throw conflict('A scan of this source is already in progress.');
  }

  const preferences = await workspacePreferences(scoped);

  const scan = (await scoped
    .insertInto('scans', {
      source_id: source.id,
      task_id: null,
      status: 'queued',
      complete_snapshot: false,
      counts: JSON.stringify(ZERO_COUNTS),
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as ScanRow;

  const payload: FetchBoardInput = {
    scan_id: scan.id,
    source_id: source.id,
    connector: source.connector,
    connector_version: source.connector_version,
    board_key: source.board_key,
    base_url: source.base_url,
    etag: source.etag,
    last_modified: source.last_modified,
    limits: {
      // The user may choose fewer than the connector limit, never more.
      max_jobs: Math.min(DISCOVERY_LIMITS.maxJobsPerScan, preferences.limits.scan_max_jobs),
      max_pages: DISCOVERY_LIMITS.maxPagesPerScan,
      timeout_seconds: DISCOVERY_LIMITS.requestTimeoutSeconds,
      min_request_interval_ms: DISCOVERY_LIMITS.minRequestIntervalMs,
    },
  };

  const task = await enqueueTask(trx, {
    workspaceId: scope.workspaceId,
    type: 'fetch_board',
    payload,
    idempotencyKey: options.idempotencyKey ?? null,
  });

  await scoped
    .updateTable('scans')
    .set({ task_id: task.id, updated_at: now })
    .where('id', '=', scan.id)
    .execute();

  await scoped
    .updateTable('sources')
    .set({
      last_scan_id: scan.id,
      next_scan_after: hoursFromNowWithJitter(now, preferences.scan_interval_hours, options.random),
      updated_at: now,
    })
    .where('id', '=', source.id)
    .execute();

  return { scan: { ...scan, task_id: task.id }, task };
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/**
 * Resolves a scan by its id *or* by the id of the task that runs it, for the
 * same reason `GET /profile/imports/:id` does: `POST /sources/:id/scan`
 * answers with `{task_id}` only, and the contract declares no scan list, so a
 * client following it literally holds a task id and nothing else.
 */
export async function findScan(scope: WorkspaceScope, id: string): Promise<ScanRow> {
  const byId = await scope.selectFrom('scans').selectAll().where('id', '=', id).executeTakeFirst();
  if (byId) return byId as ScanRow;
  const byTask = await scope
    .selectFrom('scans')
    .selectAll()
    .where('task_id', '=', id)
    .executeTakeFirst();
  if (byTask) return byTask as ScanRow;
  throw notFound('No such scan.');
}

export function readCounts(row: ScanRow): ScanCounts {
  const raw = row.counts as Partial<ScanCounts> | null;
  return {
    fetched: raw?.fetched ?? 0,
    created: raw?.created ?? 0,
    updated: raw?.updated ?? 0,
    unchanged: raw?.unchanged ?? 0,
    closed: raw?.closed ?? 0,
    pages: raw?.pages ?? 0,
  };
}

export function toScanView(row: ScanRow): ScanView {
  return {
    id: row.id,
    source_id: row.source_id,
    task_id: row.task_id,
    status: row.status,
    complete_snapshot: row.complete_snapshot,
    counts: readCounts(row),
    error_code: row.error_code,
    error_message: row.error_message,
    started_at: row.started_at === null ? null : row.started_at.toISOString(),
    completed_at: row.completed_at === null ? null : row.completed_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

/** The scan a task row belongs to, locked for the completing transaction. */
export async function lockScanForTask(
  scope: WorkspaceScope,
  taskId: string,
): Promise<ScanRow | null> {
  const row = await scope
    .selectFrom('scans')
    .selectAll()
    .where('task_id', '=', taskId)
    .forUpdate()
    .executeTakeFirst();
  return (row as ScanRow | undefined) ?? null;
}
