/**
 * Source registry: read model and the health state machine.
 *
 * 05_DISCOVERY_CONNECTORS.md: "Honor Retry-After; stop on repeated 403/429
 * and show source health." The worker only *observes* (an HTTP status, a
 * Retry-After value); the API decides the stored state, because the API is
 * what has to stop scheduling. The rule is:
 *
 *  * a successful fetch → `ok`, counters reset, ETag/Last-Modified stored;
 *  * any failure → `degraded`, `consecutive_failures` incremented;
 *  * a 403/429 (ACCESS_DENIED / RATE_LIMITED) additionally increments
 *    `consecutive_denials`, and at `blockAfterConsecutiveDenials` the source
 *    becomes `blocked` and is not scheduled again until the user re-enables
 *    it through PATCH /sources/:id;
 *  * a Retry-After pushes `next_scan_after` out by at least that long.
 */
import { DISCOVERY_LIMITS, type SourceHealthState, type SourceView } from '@job-getter/contracts';
import type { SourceRow } from '../db/types.js';
import { notFound } from '../errors.js';
import type { WorkspaceScope } from '../auth/scope.js';

/** Failure codes that count as a refusal by the board (403/429). */
export const DENIAL_CODES = new Set(['ACCESS_DENIED', 'RATE_LIMITED', 'FETCH_BLOCKED']);

export async function loadSource(scope: WorkspaceScope, id: string): Promise<SourceRow> {
  const row = await scope.selectFrom('sources').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('No such source.');
  return row as SourceRow;
}

export async function lockSource(scope: WorkspaceScope, id: string): Promise<SourceRow> {
  const row = await scope
    .selectFrom('sources')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw notFound('No such source.');
  return row as SourceRow;
}

/** A disabled source reports `disabled` whatever its last observed health. */
export function effectiveHealthState(row: SourceRow): SourceHealthState {
  return row.enabled ? row.health_state : 'disabled';
}

export function isScannable(row: SourceRow): boolean {
  return row.enabled && row.health_state !== 'blocked';
}

export async function toSourceView(scope: WorkspaceScope, row: SourceRow): Promise<SourceView> {
  const counted = await scope
    .selectFrom('job_sources')
    .select((eb) => eb.fn.count<string>('job_id').distinct().as('count'))
    .where('source_id', '=', row.id)
    .executeTakeFirst();

  return {
    id: row.id,
    connector: row.connector,
    connector_version: row.connector_version,
    board_key: row.board_key,
    base_url: row.base_url,
    enabled: row.enabled,
    last_success_at: row.last_success_at === null ? null : row.last_success_at.toISOString(),
    last_scan_id: row.last_scan_id,
    next_scan_after: row.next_scan_after === null ? null : row.next_scan_after.toISOString(),
    health: {
      state: effectiveHealthState(row),
      consecutive_failures: row.consecutive_failures,
      last_error_code: row.last_error_code,
      last_error_at: row.last_error_at === null ? null : row.last_error_at.toISOString(),
      detail: row.health_detail,
    },
    job_count: Number(counted?.count ?? 0),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Health transitions (called inside the completing transaction)
// ---------------------------------------------------------------------------

export interface SuccessObservation {
  readonly at: Date;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export async function recordSourceSuccess(
  scope: WorkspaceScope,
  sourceId: string,
  observation: SuccessObservation,
): Promise<void> {
  await scope
    .updateTable('sources')
    .set({
      health_state: 'ok',
      consecutive_failures: 0,
      consecutive_denials: 0,
      last_error_code: null,
      last_error_at: null,
      health_detail: null,
      last_success_at: observation.at,
      // A conditional-request hint is only replaced by a newer one; a fetch
      // that returned none (or 304) keeps the last known value.
      ...(observation.etag !== null ? { etag: observation.etag } : {}),
      ...(observation.lastModified !== null ? { last_modified: observation.lastModified } : {}),
      updated_at: new Date(),
    })
    .where('id', '=', sourceId)
    .execute();
}

export interface FailureObservation {
  readonly at: Date;
  readonly code: string;
  readonly detail: string | null;
  /** From `Retry-After`; the next scan may not happen sooner. */
  readonly retryAfterSeconds: number | null;
}

export interface FailureTransition {
  readonly state: SourceHealthState;
  readonly consecutiveDenials: number;
  readonly blocked: boolean;
}

export async function recordSourceFailure(
  scope: WorkspaceScope,
  row: SourceRow,
  observation: FailureObservation,
): Promise<FailureTransition> {
  const denial = DENIAL_CODES.has(observation.code);
  const consecutiveDenials = denial ? row.consecutive_denials + 1 : 0;
  const blocked = consecutiveDenials >= DISCOVERY_LIMITS.blockAfterConsecutiveDenials;
  const state: SourceHealthState = blocked ? 'blocked' : 'degraded';

  const earliestRetry =
    observation.retryAfterSeconds === null
      ? null
      : new Date(observation.at.getTime() + observation.retryAfterSeconds * 1000);
  const nextScanAfter =
    earliestRetry === null
      ? row.next_scan_after
      : row.next_scan_after === null || row.next_scan_after < earliestRetry
        ? earliestRetry
        : row.next_scan_after;

  await scope
    .updateTable('sources')
    .set({
      health_state: state,
      consecutive_failures: row.consecutive_failures + 1,
      consecutive_denials: consecutiveDenials,
      last_error_code: observation.code.slice(0, 64),
      last_error_at: observation.at,
      health_detail: blocked
        ? `Blocked after ${consecutiveDenials} consecutive refusals (${observation.code}). ` +
          'Re-enable the source to scan again.'
        : (observation.detail?.slice(0, 500) ?? null),
      next_scan_after: nextScanAfter,
      updated_at: new Date(),
    })
    .where('id', '=', row.id)
    .execute();

  return { state, consecutiveDenials, blocked };
}
