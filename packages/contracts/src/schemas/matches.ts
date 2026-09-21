import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, TriState, Uuid } from '../common.js';
import { MATCH_WEIGHT_KEYS } from './preferences.js';
import { JobRequirement } from './requirements.js';

/**
 * Fit algorithm v1 (docs/spec/06_AI_PROFILE_AND_CV.md).
 *
 * Three rules govern everything in this file, and they are invariants rather
 * than preferences:
 *
 *  1. A score is a heuristic ranking, never a probability of being hired
 *     (invariant 3). Nothing here may be presented as a percentage chance,
 *     an ATS score, or a calibrated prediction.
 *  2. Absent evidence is never a positive answer. A component the job does
 *     not describe is *not evaluable*: it is excluded from the renormalised
 *     score and counted against coverage, never scored as zero (which reads
 *     as "a bad match") and never as one (which would be an invention).
 *  3. Every number carries its evidence. A component value without the job
 *     text and the confirmed fact ids behind it cannot be reviewed, and an
 *     unreviewable claim about a person's own CV is the thing this product
 *     exists to avoid.
 */
export const MATCH_ALGORITHM_VERSION = 'v1';

/**
 * The alias map itself lives in the worker (Python owns processing,
 * invariant 1), but its version is part of the persisted result, so a score
 * can be reproduced against the map that produced it.
 */
export const SKILL_ALIAS_MAP_VERSION = 'v1';

/** Required job skills count double, per the fit algorithm. */
export const SKILL_REQUIRED_WEIGHT = 2;
export const SKILL_PREFERRED_WEIGHT = 1;

export const MatchComponentKey = Type.Union([
  Type.Literal('skills'),
  Type.Literal('role_title'),
  Type.Literal('seniority'),
  Type.Literal('work_arrangement'),
  Type.Literal('industry'),
]);
export type MatchComponentKey = Static<typeof MatchComponentKey>;

/**
 * Same keys as the configurable weights, in the same order. Declared by
 * reference so a new weight cannot be added without a component to spend it.
 */
export const ALL_MATCH_COMPONENT_KEYS = MATCH_WEIGHT_KEYS satisfies readonly MatchComponentKey[];

/**
 * Why a component could not be evaluated. "The job does not say" and "the
 * profile does not say" are different facts and are never collapsed: one is a
 * gap in the posting, the other is a gap the user can close.
 */
export const MatchUnknownCode = Type.Union([
  Type.Literal('JOB_STATES_NOTHING'),
  Type.Literal('PROFILE_STATES_NOTHING'),
  Type.Literal('NO_CONFIRMED_FACTS'),
  Type.Literal('NOT_COMPARABLE'),
  Type.Literal('WEIGHT_ZERO'),
]);
export type MatchUnknownCode = Static<typeof MatchUnknownCode>;

export const ALL_MATCH_UNKNOWN_CODES = [
  'JOB_STATES_NOTHING',
  'PROFILE_STATES_NOTHING',
  'NO_CONFIRMED_FACTS',
  'NOT_COMPARABLE',
  'WEIGHT_ZERO',
] as const satisfies readonly MatchUnknownCode[];

/**
 * A quotation that justifies one number. `fact_id` is set when the evidence
 * is a confirmed profile fact and null when it is job text.
 */
export const MatchEvidence = Type.Object(
  {
    source: Type.Union([Type.Literal('job'), Type.Literal('profile')]),
    excerpt: Type.String({ minLength: 1, maxLength: 600 }),
    fact_id: Type.Union([Uuid, Type.Null()]),
  },
  { additionalProperties: false },
);
export type MatchEvidence = Static<typeof MatchEvidence>;

export const MatchComponent = Type.Object(
  {
    key: MatchComponentKey,
    /** 0-1, or null when the component is not evaluable. Never defaulted. */
    value: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
    /** The configured weight this component carried, for reproducibility. */
    weight: Type.Integer({ minimum: 0, maximum: 100 }),
    evaluable: Type.Boolean(),
    unknown_code: Type.Union([MatchUnknownCode, Type.Null()]),
    evidence: Type.Array(MatchEvidence, { maxItems: 20 }),
    fact_ids: Type.Array(Uuid, { maxItems: 50 }),
  },
  { additionalProperties: false },
);
export type MatchComponent = Static<typeof MatchComponent>;

/**
 * Hard filters, evaluated before any score. A `no` on any mandatory filter
 * makes the job ineligible; an `unknown` blocks application readiness but
 * never hides the job (06_AI_PROFILE_AND_CV.md).
 */
export const EligibilityFilter = Type.Union([
  Type.Literal('excluded_employer'),
  Type.Literal('employment_type'),
  Type.Literal('location'),
  Type.Literal('work_authorization'),
  Type.Literal('language'),
  Type.Literal('salary_minimum'),
]);
export type EligibilityFilter = Static<typeof EligibilityFilter>;

export const ALL_ELIGIBILITY_FILTERS = [
  'excluded_employer',
  'employment_type',
  'location',
  'work_authorization',
  'language',
  'salary_minimum',
] as const satisfies readonly EligibilityFilter[];

/**
 * A stable reason code per filter outcome. The web maps each to localised
 * copy; the code is never shown raw, and the API never composes it into a
 * sentence, because the API does not know the reader's language.
 */
export const EligibilityCode = Type.Union([
  Type.Literal('NOT_CONFIGURED'),
  Type.Literal('PASSES'),
  Type.Literal('EMPLOYER_EXCLUDED'),
  Type.Literal('EMPLOYMENT_TYPE_NOT_ACCEPTED'),
  Type.Literal('EMPLOYMENT_TYPE_NOT_STATED'),
  Type.Literal('COUNTRY_NOT_ELIGIBLE'),
  Type.Literal('COUNTRY_NOT_STATED'),
  Type.Literal('REMOTE_MODE_NOT_ACCEPTED'),
  Type.Literal('AUTHORIZATION_NOT_CONFIRMED'),
  Type.Literal('AUTHORIZATION_ABSENT'),
  Type.Literal('SPONSORSHIP_REQUIRED'),
  Type.Literal('LANGUAGE_NOT_DECLARED'),
  Type.Literal('LANGUAGE_NOT_STATED'),
  Type.Literal('SALARY_BELOW_MINIMUM'),
  Type.Literal('SALARY_NOT_STATED'),
  Type.Literal('SALARY_NOT_COMPARABLE'),
]);
export type EligibilityCode = Static<typeof EligibilityCode>;

export const ALL_ELIGIBILITY_CODES = [
  'NOT_CONFIGURED',
  'PASSES',
  'EMPLOYER_EXCLUDED',
  'EMPLOYMENT_TYPE_NOT_ACCEPTED',
  'EMPLOYMENT_TYPE_NOT_STATED',
  'COUNTRY_NOT_ELIGIBLE',
  'COUNTRY_NOT_STATED',
  'REMOTE_MODE_NOT_ACCEPTED',
  'AUTHORIZATION_NOT_CONFIRMED',
  'AUTHORIZATION_ABSENT',
  'SPONSORSHIP_REQUIRED',
  'LANGUAGE_NOT_DECLARED',
  'LANGUAGE_NOT_STATED',
  'SALARY_BELOW_MINIMUM',
  'SALARY_NOT_STATED',
  'SALARY_NOT_COMPARABLE',
] as const satisfies readonly EligibilityCode[];

export const EligibilityCheck = Type.Object(
  {
    filter: EligibilityFilter,
    /** yes = passes, no = fails the filter, unknown = cannot be determined. */
    verdict: TriState,
    code: EligibilityCode,
    /** Whether an `unknown` here blocks application readiness. */
    blocking: Type.Boolean(),
    evidence: Type.Array(MatchEvidence, { maxItems: 10 }),
  },
  { additionalProperties: false },
);
export type EligibilityCheck = Static<typeof EligibilityCheck>;

/**
 * How one explicit job requirement fared. `uncertain` is a first-class
 * outcome: an alias the map is not confident about stays uncertain rather
 * than being counted as experience the user never claimed.
 */
export const RequirementOutcome = Type.Union([
  Type.Literal('matched'),
  Type.Literal('uncertain'),
  Type.Literal('missing'),
]);
export type RequirementOutcome = Static<typeof RequirementOutcome>;

export const MatchedRequirement = Type.Object(
  {
    requirement: JobRequirement,
    outcome: RequirementOutcome,
    /** Weight this requirement carried: 2 when required, 1 otherwise. */
    weight: Type.Integer({ minimum: 0, maximum: 2 }),
    /** Confirmed profile facts that satisfied it. Empty unless matched. */
    fact_ids: Type.Array(Uuid, { maxItems: 20 }),
    matched_skill: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type MatchedRequirement = Static<typeof MatchedRequirement>;

export const MatchExplanation = Type.Object(
  {
    algorithm_version: Type.String({ maxLength: 16 }),
    alias_map_version: Type.String({ maxLength: 16 }),
    components: Type.Array(MatchComponent, { maxItems: 10 }),
    eligibility: Type.Array(EligibilityCheck, { maxItems: 10 }),
    /** Every explicit job requirement with its outcome, matched or not. */
    requirements: Type.Array(MatchedRequirement, { maxItems: 200 }),
    /** Component keys that could not be evaluated; drives the coverage copy. */
    unknown_components: Type.Array(MatchComponentKey, { maxItems: 10 }),
    /** Union of every confirmed fact id that contributed to any component. */
    fact_ids: Type.Array(Uuid, { maxItems: 200 }),
    /** Sum of the weights of evaluable components, before renormalisation. */
    evaluated_weight: Type.Integer({ minimum: 0, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type MatchExplanation = Static<typeof MatchExplanation>;

/**
 * Match summary as the jobs list carries it: enough to sort and filter by,
 * never enough to act on. The list shows the score beside its coverage; the
 * reasons live on the detail screen, in `MatchExplanation`.
 */
export const MatchSummary = Type.Object(
  {
    match_id: Uuid,
    eligible: TriState,
    /** Null when zero components were evaluable. Heuristic, not probability. */
    score: Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()]),
    coverage_percent: Type.Integer({ minimum: 0, maximum: 100 }),
    algorithm_version: Type.String({ maxLength: 16 }),
    /** True when profile, preferences or the job changed since scoring. */
    stale: Type.Boolean(),
    computed_at: Timestamp,
  },
  { additionalProperties: false },
);
export type MatchSummary = Static<typeof MatchSummary>;

/** The persisted row, returned on the job detail screen. */
export const MatchView = Type.Object(
  {
    id: Uuid,
    job_id: Uuid,
    job_revision: Type.Integer({ minimum: 1 }),
    profile_revision: Type.Integer({ minimum: 1 }),
    preferences_revision: Type.Integer({ minimum: 1 }),
    algorithm_version: Type.String({ maxLength: 16 }),
    eligible: TriState,
    /** Null when zero components were evaluable. */
    score: Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()]),
    coverage_percent: Type.Integer({ minimum: 0, maximum: 100 }),
    /** True when the profile, preferences or job moved on since scoring. */
    stale: Type.Boolean(),
    explanation: MatchExplanation,
    computed_at: Timestamp,
  },
  { additionalProperties: false },
);
export type MatchView = Static<typeof MatchView>;

/**
 * Coverage is the share of configured weight that was actually evaluable.
 * A score of 80 at 30% coverage is a far weaker claim than 80 at 100%, and
 * the UI must never show one without the other.
 */
export function coveragePercent(evaluatedWeight: number, totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  return Math.round((evaluatedWeight / totalWeight) * 100);
}
