import {
  CLOSURE_RULES,
  type FetchWarning,
  type FetchWarningCode,
  type JobSalary,
  type JobView,
  type Locale,
  type NormalizedJob,
  type ScanStatus,
} from '@job-getter/contracts';
import { formatNumber } from '../i18n/format';
import type { MessageKey } from '../i18n/messages';
import { FETCH_WARNING_LABEL, isRefusalWarning } from './labels';

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export type Freshness = 'fresh' | 'stale' | 'never_fetched';

/**
 * 05_DISCOVERY_CONNECTORS.md, "Freshness and closure": recheck availability
 * before packet preparation when the last successful fetch is more than 24 h
 * old. The threshold is the contract's `CLOSURE_RULES.recheckBeforePacketHours`,
 * not a number repeated here. A job with no recorded successful fetch is not
 * "fresh" by default: it is flagged as well.
 */
export function freshnessOf(job: Pick<JobView, 'last_fetched_at'>, nowMs: number): Freshness {
  if (job.last_fetched_at === null) return 'never_fetched';
  const fetched = new Date(job.last_fetched_at).getTime();
  if (Number.isNaN(fetched)) return 'never_fetched';
  const ageHours = (nowMs - fetched) / 3_600_000;
  return ageHours > CLOSURE_RULES.recheckBeforePacketHours ? 'stale' : 'fresh';
}

// ---------------------------------------------------------------------------
// Salary
// ---------------------------------------------------------------------------

export interface SalaryParts {
  /** Numbers formatted for the locale; currency and period verbatim. */
  readonly amount: string | null;
  /** ISO code exactly as stated, or null when the posting named none. */
  readonly currency: string | null;
  readonly period: JobSalary['period'];
}

/**
 * Salary as stated, never converted (03_DATA_MODEL.md, contracts `JobSalary`).
 * Only the digits pass through `Intl`; the currency code and period are the
 * posting's own values. `amount` is null when neither bound was stated, in
 * which case only the excerpt says anything.
 */
export function salaryParts(locale: Locale, salary: JobSalary): SalaryParts {
  const min = salary.min === null ? null : formatNumber(locale, salary.min);
  const max = salary.max === null ? null : formatNumber(locale, salary.max);
  let amount: string | null;
  if (min !== null && max !== null) amount = min === max ? min : `${min}–${max}`;
  else amount = min ?? max;
  return { amount, currency: salary.currency, period: salary.period };
}

// ---------------------------------------------------------------------------
// Import task result
// ---------------------------------------------------------------------------

/**
 * `GET /tasks/:id` carries the `fetch_job` result extended by the API with a
 * `job_import` block (apps/api/src/discovery/imports.ts). The task contract
 * types `result` as unknown, so it is read here defensively: a result that
 * does not have the expected shape is reported as unreadable, never guessed.
 */
export interface ImportOutcome {
  readonly job: NormalizedJob | null;
  readonly candidates: readonly NormalizedJob[];
  readonly warnings: readonly FetchWarning[];
  /** The job the import created, once it exists. */
  readonly jobId: string | null;
  readonly importStatus: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNormalizedJobLike(value: unknown): value is NormalizedJob {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.company === 'string' &&
    typeof value.canonical_url === 'string'
  );
}

function isFetchWarningLike(value: unknown): value is FetchWarning {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    value.code in FETCH_WARNING_LABEL &&
    typeof value.message === 'string'
  );
}

export function readImportOutcome(result: unknown): ImportOutcome | null {
  if (!isRecord(result)) return null;
  if (!('job' in result) || !Array.isArray(result.candidates) || !Array.isArray(result.warnings)) {
    return null;
  }
  const job = result.job === null ? null : isNormalizedJobLike(result.job) ? result.job : null;
  const candidates = result.candidates.filter(isNormalizedJobLike);
  const warnings = result.warnings.filter(isFetchWarningLike);
  const extension = isRecord(result.job_import) ? result.job_import : null;
  const jobId = typeof extension?.job_id === 'string' ? extension.job_id : null;
  const importStatus = typeof extension?.status === 'string' ? extension.status : null;
  return { job, candidates, warnings, jobId, importStatus };
}

export type ImportOutcomeKind = 'created' | 'needs_choice' | 'refused' | 'nothing_found';

/** What the screen should show for a finished import. */
export function classifyImportOutcome(outcome: ImportOutcome): ImportOutcomeKind {
  if (outcome.jobId !== null) return 'created';
  if (outcome.candidates.length > 0) return 'needs_choice';
  if (outcome.warnings.some((warning) => isRefusalWarning(warning.code))) return 'refused';
  return 'nothing_found';
}

export function refusalWarnings(outcome: ImportOutcome): readonly FetchWarning[] {
  return outcome.warnings.filter((warning) => isRefusalWarning(warning.code));
}

export function fetchWarningLabelKey(code: FetchWarningCode): MessageKey {
  return FETCH_WARNING_LABEL[code];
}

// ---------------------------------------------------------------------------
// Scan task result
// ---------------------------------------------------------------------------

/**
 * The warnings of a `fetch_board` result, read from the scan's task.
 * `ScanView` carries only `error_code`/`error_message`; the warnings — in
 * particular `NOT_MODIFIED`, which turns a "partial" scan into "unchanged
 * since the last scan" — live on the task result.
 */
export function readScanWarnings(result: unknown): readonly FetchWarning[] {
  if (!isRecord(result) || !Array.isArray(result.warnings)) return [];
  return result.warnings.filter(isFetchWarningLike);
}

export type ScanPresentation = 'in_flight' | 'complete' | 'unchanged' | 'partial' | 'failed';

/**
 * How to present a scan. A re-scan answered with HTTP 304 is stored as
 * `partial` with `complete_snapshot: false` and zero counts — correct, since
 * nothing was re-fetched and nothing may be closed — but for the user it is
 * "the board reported no changes", not a half-finished scan. Only the
 * `NOT_MODIFIED` warning on the task result distinguishes the two, so the
 * caller passes the warnings it has (an empty list while they are unknown).
 */
export function presentScan(
  scan: { readonly status: ScanStatus; readonly complete_snapshot: boolean },
  warnings: readonly FetchWarning[],
): ScanPresentation {
  if (scan.status === 'queued' || scan.status === 'running') return 'in_flight';
  if (scan.status === 'failed' || scan.status === 'cancelled') return 'failed';
  if (scan.status === 'partial' || !scan.complete_snapshot) {
    return warnings.some((warning) => warning.code === 'NOT_MODIFIED') ? 'unchanged' : 'partial';
  }
  return 'complete';
}
