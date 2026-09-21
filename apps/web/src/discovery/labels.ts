import type {
  ConnectorId,
  EligibilityCode,
  EligibilityFilter,
  FetchWarningCode,
  InferredField,
  JobEmploymentType,
  JobRequirement,
  JobStatus,
  MatchComponentKey,
  MatchUnknownCode,
  PossibleDuplicate,
  RemoteType,
  RequirementOutcome,
  ResumeFindingCode,
  ResumeSectionKind,
  ScanStatus,
  SourceHealthState,
  TriState,
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

// ---------------------------------------------------------------------------
// Fit (M3)
// ---------------------------------------------------------------------------

export const MATCH_COMPONENT_LABEL: Record<MatchComponentKey, MessageKey> = {
  skills: 'match.component.skills',
  role_title: 'match.component.role_title',
  seniority: 'match.component.seniority',
  work_arrangement: 'match.component.work_arrangement',
  industry: 'match.component.industry',
};

/**
 * Why a component could not be judged. Each reads as a statement about the
 * evidence, never about the person: "the posting does not say" is a fact about
 * the posting, and it is not a mark against anyone's CV.
 */
export const MATCH_UNKNOWN_LABEL: Record<MatchUnknownCode, MessageKey> = {
  JOB_STATES_NOTHING: 'match.unknown.JOB_STATES_NOTHING',
  PROFILE_STATES_NOTHING: 'match.unknown.PROFILE_STATES_NOTHING',
  NO_CONFIRMED_FACTS: 'match.unknown.NO_CONFIRMED_FACTS',
  NOT_COMPARABLE: 'match.unknown.NOT_COMPARABLE',
  WEIGHT_ZERO: 'match.unknown.WEIGHT_ZERO',
};

export const ELIGIBILITY_FILTER_LABEL: Record<EligibilityFilter, MessageKey> = {
  excluded_employer: 'eligibility.filter.excluded_employer',
  employment_type: 'eligibility.filter.employment_type',
  location: 'eligibility.filter.location',
  work_authorization: 'eligibility.filter.work_authorization',
  language: 'eligibility.filter.language',
  salary_minimum: 'eligibility.filter.salary_minimum',
};

export const ELIGIBILITY_CODE_LABEL: Record<EligibilityCode, MessageKey> = {
  NOT_CONFIGURED: 'eligibility.code.NOT_CONFIGURED',
  PASSES: 'eligibility.code.PASSES',
  EMPLOYER_EXCLUDED: 'eligibility.code.EMPLOYER_EXCLUDED',
  EMPLOYMENT_TYPE_NOT_ACCEPTED: 'eligibility.code.EMPLOYMENT_TYPE_NOT_ACCEPTED',
  EMPLOYMENT_TYPE_NOT_STATED: 'eligibility.code.EMPLOYMENT_TYPE_NOT_STATED',
  COUNTRY_NOT_ELIGIBLE: 'eligibility.code.COUNTRY_NOT_ELIGIBLE',
  COUNTRY_NOT_STATED: 'eligibility.code.COUNTRY_NOT_STATED',
  REMOTE_MODE_NOT_ACCEPTED: 'eligibility.code.REMOTE_MODE_NOT_ACCEPTED',
  AUTHORIZATION_NOT_CONFIRMED: 'eligibility.code.AUTHORIZATION_NOT_CONFIRMED',
  AUTHORIZATION_ABSENT: 'eligibility.code.AUTHORIZATION_ABSENT',
  SPONSORSHIP_REQUIRED: 'eligibility.code.SPONSORSHIP_REQUIRED',
  LANGUAGE_NOT_DECLARED: 'eligibility.code.LANGUAGE_NOT_DECLARED',
  LANGUAGE_NOT_STATED: 'eligibility.code.LANGUAGE_NOT_STATED',
  SALARY_BELOW_MINIMUM: 'eligibility.code.SALARY_BELOW_MINIMUM',
  SALARY_NOT_STATED: 'eligibility.code.SALARY_NOT_STATED',
  SALARY_NOT_COMPARABLE: 'eligibility.code.SALARY_NOT_COMPARABLE',
};

/**
 * `unknown` uses the dashed `unknown` tone rather than a soft green: an
 * undetermined eligibility must never read as a pass.
 */
export const ELIGIBILITY_VERDICT_TONE: Record<TriState, BadgeTone> = {
  yes: 'success',
  no: 'danger',
  unknown: 'unknown',
};

export const ELIGIBILITY_VERDICT_LABEL: Record<TriState, MessageKey> = {
  yes: 'eligibility.verdict.yes',
  no: 'eligibility.verdict.no',
  unknown: 'eligibility.verdict.unknown',
};

export const REQUIREMENT_OUTCOME_LABEL: Record<RequirementOutcome, MessageKey> = {
  matched: 'match.outcome.matched',
  uncertain: 'match.outcome.uncertain',
  missing: 'match.outcome.missing',
};

/**
 * An uncertain requirement is not a near-miss to be celebrated: it is a
 * warning that the alias map found something adjacent and refused to count it.
 */
export const REQUIREMENT_OUTCOME_TONE: Record<RequirementOutcome, BadgeTone> = {
  matched: 'success',
  uncertain: 'warning',
  missing: 'neutral',
};

export const REQUIREMENT_OUTCOME_ORDER: readonly RequirementOutcome[] = [
  'missing',
  'uncertain',
  'matched',
];

// ---------------------------------------------------------------------------
// CV (M3, PR07)
// ---------------------------------------------------------------------------

/**
 * Every finding the validator can raise has copy here. A total `Record` means
 * adding a code to the contract stops this file compiling until somebody has
 * written what it means to a person reading their own CV.
 */
export const RESUME_FINDING_LABEL: Record<ResumeFindingCode, MessageKey> = {
  BULLET_WITHOUT_FACT: 'resumeFinding.BULLET_WITHOUT_FACT',
  UNKNOWN_FACT_ID: 'resumeFinding.UNKNOWN_FACT_ID',
  NUMBER_NOT_IN_FACTS: 'resumeFinding.NUMBER_NOT_IN_FACTS',
  NAME_NOT_IN_FACTS: 'resumeFinding.NAME_NOT_IN_FACTS',
  DATE_NOT_IN_FACTS: 'resumeFinding.DATE_NOT_IN_FACTS',
  CREDENTIAL_NOT_IN_FACTS: 'resumeFinding.CREDENTIAL_NOT_IN_FACTS',
  ROLES_MERGED: 'resumeFinding.ROLES_MERGED',
  PROJECT_PRESENTED_AS_EMPLOYMENT: 'resumeFinding.PROJECT_PRESENTED_AS_EMPLOYMENT',
  SKILL_NOT_CONFIRMED: 'resumeFinding.SKILL_NOT_CONFIRMED',
  SECTION_OMITTED_EMPTY: 'resumeFinding.SECTION_OMITTED_EMPTY',
  PAGE_OVERFLOW: 'resumeFinding.PAGE_OVERFLOW',
  MODEL_CORRECTED_ONCE: 'resumeFinding.MODEL_CORRECTED_ONCE',
  NO_PROVIDER_CONFIGURED: 'resumeFinding.NO_PROVIDER_CONFIGURED',
  MODEL_OUTPUT_REJECTED: 'resumeFinding.MODEL_OUTPUT_REJECTED',
  PDF_UNAVAILABLE: 'resumeFinding.PDF_UNAVAILABLE',
};

/**
 * Section names for the UI's own chrome. The document carries its own
 * headings, already in the CV's language, and those are what the preview
 * renders — these are for talking *about* a section, not for printing one.
 */
export const RESUME_SECTION_LABEL: Record<ResumeSectionKind, MessageKey> = {
  summary: 'resumeSection.summary',
  skills: 'resumeSection.skills',
  experience: 'resumeSection.experience',
  projects: 'resumeSection.projects',
  education: 'resumeSection.education',
  certifications: 'resumeSection.certifications',
  languages: 'resumeSection.languages',
};
