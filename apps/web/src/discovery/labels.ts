import type {
  ConnectorId,
  FetchWarningCode,
  InferredField,
  JobEmploymentType,
  JobRequirement,
  JobStatus,
  PossibleDuplicate,
  RemoteType,
  ScanStatus,
  SourceHealthState,
} from '@job-getter/contracts';
import type { BadgeTone } from '@job-getter/ui';
import type { MessageKey } from '../i18n/messages';

/**
 * Human copy for the closed enums of the discovery contract.
 *
 * Every map is a *total* `Record` over the contract type, so adding a member
 * to `packages/contracts/src/schemas/jobs.ts` or `tasks/fetch-board.ts` stops
 * this file compiling until the UI can explain the new value. Nothing here is
 * a parallel enum: the keys are the contract's own literals.
 */

export const SOURCE_HEALTH_LABEL: Record<SourceHealthState, MessageKey> = {
  unknown: 'sourceHealth.unknown',
  ok: 'sourceHealth.ok',
  degraded: 'sourceHealth.degraded',
  blocked: 'sourceHealth.blocked',
  disabled: 'sourceHealth.disabled',
};

export const SOURCE_HEALTH_DESCRIPTION: Record<SourceHealthState, MessageKey> = {
  unknown: 'sourceHealth.unknown.description',
  ok: 'sourceHealth.ok.description',
  degraded: 'sourceHealth.degraded.description',
  blocked: 'sourceHealth.blocked.description',
  disabled: 'sourceHealth.disabled.description',
};

export const SOURCE_HEALTH_TONE: Record<SourceHealthState, BadgeTone> = {
  unknown: 'unknown',
  ok: 'success',
  degraded: 'warning',
  blocked: 'danger',
  disabled: 'neutral',
};

export const SCAN_STATUS_LABEL: Record<ScanStatus, MessageKey> = {
  queued: 'scanStatus.queued',
  running: 'scanStatus.running',
  succeeded: 'scanStatus.succeeded',
  partial: 'scanStatus.partial',
  failed: 'scanStatus.failed',
  cancelled: 'scanStatus.cancelled',
};

export const SCAN_STATUS_DESCRIPTION: Record<ScanStatus, MessageKey> = {
  queued: 'scanStatus.queued.description',
  running: 'scanStatus.running.description',
  succeeded: 'scanStatus.succeeded.description',
  partial: 'scanStatus.partial.description',
  failed: 'scanStatus.failed.description',
  cancelled: 'scanStatus.cancelled.description',
};

export const SCAN_STATUS_TONE: Record<ScanStatus, BadgeTone> = {
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'warning',
};

/** From the contract's scan status union: the two states still in flight. */
const IN_FLIGHT_SCAN_STATUSES: readonly ScanStatus[] = ['queued', 'running'];

export function isScanInFlight(status: ScanStatus): boolean {
  return IN_FLIGHT_SCAN_STATUSES.includes(status);
}

export const JOB_STATUS_LABEL: Record<JobStatus, MessageKey> = {
  active: 'jobStatus.active',
  closed: 'jobStatus.closed',
  unknown: 'jobStatus.unknown',
};

export const JOB_STATUS_DESCRIPTION: Record<JobStatus, MessageKey> = {
  active: 'jobStatus.active.description',
  closed: 'jobStatus.closed.description',
  unknown: 'jobStatus.unknown.description',
};

export const JOB_STATUS_TONE: Record<JobStatus, BadgeTone> = {
  active: 'success',
  closed: 'neutral',
  unknown: 'unknown',
};

export const REMOTE_TYPE_LABEL: Record<RemoteType, MessageKey> = {
  remote: 'remoteType.remote',
  hybrid: 'remoteType.hybrid',
  onsite: 'remoteType.onsite',
  unknown: 'remoteType.unknown',
};

/** The job's employment type shares the M1 catalogue entries for the same values. */
export const JOB_EMPLOYMENT_TYPE_LABEL: Record<JobEmploymentType, MessageKey> = {
  full_time: 'employmentType.full_time',
  part_time: 'employmentType.part_time',
  contract: 'employmentType.contract',
  internship: 'employmentType.internship',
  temporary: 'employmentType.temporary',
  freelance: 'employmentType.freelance',
};

export const CONNECTOR_LABEL: Record<ConnectorId, MessageKey> = {
  greenhouse: 'connector.greenhouse',
  lever: 'connector.lever',
  manual: 'connector.manual',
  url: 'connector.url',
};

export const FETCH_WARNING_LABEL: Record<FetchWarningCode, MessageKey> = {
  RATE_LIMITED: 'fetchWarning.RATE_LIMITED',
  ACCESS_DENIED: 'fetchWarning.ACCESS_DENIED',
  NOT_MODIFIED: 'fetchWarning.NOT_MODIFIED',
  PAGE_LIMIT_REACHED: 'fetchWarning.PAGE_LIMIT_REACHED',
  JOB_LIMIT_REACHED: 'fetchWarning.JOB_LIMIT_REACHED',
  SCHEMA_DRIFT: 'fetchWarning.SCHEMA_DRIFT',
  ROBOTS_DISALLOWED: 'fetchWarning.ROBOTS_DISALLOWED',
  BLOCKED_DESTINATION: 'fetchWarning.BLOCKED_DESTINATION',
  REDIRECT_LIMIT: 'fetchWarning.REDIRECT_LIMIT',
  CONTENT_TYPE_REJECTED: 'fetchWarning.CONTENT_TYPE_REJECTED',
  BODY_TRUNCATED: 'fetchWarning.BODY_TRUNCATED',
  NO_STRUCTURED_DATA: 'fetchWarning.NO_STRUCTURED_DATA',
  MULTIPLE_POSTINGS: 'fetchWarning.MULTIPLE_POSTINGS',
  FIELD_INFERRED: 'fetchWarning.FIELD_INFERRED',
  FIELD_DROPPED_INVALID: 'fetchWarning.FIELD_DROPPED_INVALID',
};

/**
 * Warnings that mean the fetch was refused or must not be attempted. The UI
 * says so and offers paste mode; it never suggests a way around them
 * (05_DISCOVERY_CONNECTORS.md: "if prohibited or blocked, offer paste/manual
 * mode instead of bypass").
 */
export const REFUSAL_WARNING_CODES: readonly FetchWarningCode[] = [
  'BLOCKED_DESTINATION',
  'ROBOTS_DISALLOWED',
  'ACCESS_DENIED',
  'RATE_LIMITED',
];

export function isRefusalWarning(code: FetchWarningCode): boolean {
  return REFUSAL_WARNING_CODES.includes(code);
}

export const INFERRED_FIELD_LABEL: Record<InferredField['field'], MessageKey> = {
  remote_type: 'inferredField.remote_type',
  locations: 'inferredField.locations',
  eligible_countries: 'inferredField.eligible_countries',
  employment_type: 'inferredField.employment_type',
  salary: 'inferredField.salary',
  language: 'inferredField.language',
  requirements: 'inferredField.requirements',
};

export const REQUIREMENT_KIND_LABEL: Record<JobRequirement['kind'], MessageKey> = {
  required: 'requirementKind.required',
  preferred: 'requirementKind.preferred',
  unknown: 'requirementKind.unknown',
};

/** Display order for the grouped requirements list. */
export const REQUIREMENT_KIND_ORDER: readonly JobRequirement['kind'][] = [
  'required',
  'preferred',
  'unknown',
];

export const DUPLICATE_REASON_LABEL: Record<PossibleDuplicate['reason'], MessageKey> = {
  same_apply_url: 'duplicateReason.same_apply_url',
  same_requisition: 'duplicateReason.same_requisition',
  similar_title_and_location: 'duplicateReason.similar_title_and_location',
};
