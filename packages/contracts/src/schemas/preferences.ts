import { Type, type Static } from '@sinclair/typebox';
import { Locale } from '../common.js';

export const SETTINGS_VERSION = 1;

export const RemoteMode = Type.Union([
  Type.Literal('remote'),
  Type.Literal('hybrid'),
  Type.Literal('onsite'),
]);
export type RemoteMode = Static<typeof RemoteMode>;

export const SalaryPeriod = Type.Union([
  Type.Literal('year'),
  Type.Literal('month'),
  Type.Literal('week'),
  Type.Literal('day'),
  Type.Literal('hour'),
]);
export type SalaryPeriod = Static<typeof SalaryPeriod>;

/**
 * Component weights must be nonnegative and sum to exactly 100. Defaults come
 * from 06_AI_PROFILE_AND_CV.md; the score they produce is a heuristic ranking,
 * not a probability of being hired (invariant 3).
 */
export const MatchWeights = Type.Object(
  {
    skills: Type.Integer({ minimum: 0, maximum: 100 }),
    role_title: Type.Integer({ minimum: 0, maximum: 100 }),
    seniority: Type.Integer({ minimum: 0, maximum: 100 }),
    work_arrangement: Type.Integer({ minimum: 0, maximum: 100 }),
    industry: Type.Integer({ minimum: 0, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type MatchWeights = Static<typeof MatchWeights>;

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  skills: 40,
  role_title: 20,
  seniority: 15,
  work_arrangement: 15,
  industry: 10,
};

export const MATCH_WEIGHT_KEYS = [
  'skills',
  'role_title',
  'seniority',
  'work_arrangement',
  'industry',
] as const satisfies readonly (keyof MatchWeights)[];

const ShortString = Type.String({ minLength: 1, maxLength: 120 });

/**
 * Operational limits. Hosted operator maxima override attempts to increase
 * these; a user may always choose something stricter (08_UX_AND_CUSTOMIZATION).
 */
export const OperationalLimits = Type.Object(
  {
    scan_max_jobs: Type.Integer({ minimum: 1, maximum: 1000 }),
    request_concurrency_per_host: Type.Integer({ minimum: 1, maximum: 1 }),
    ai_requests_per_day: Type.Integer({ minimum: 0, maximum: 1000 }),
    fill_attempts_per_day: Type.Integer({ minimum: 0, maximum: 100 }),
    approval_ttl_hours: Type.Integer({ minimum: 1, maximum: 24 }),
    consented_evidence_capture: Type.Boolean(),
    raw_logs: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type OperationalLimits = Static<typeof OperationalLimits>;

export const DEFAULT_OPERATIONAL_LIMITS: OperationalLimits = {
  scan_max_jobs: 1000,
  request_concurrency_per_host: 1,
  ai_requests_per_day: 50,
  fill_attempts_per_day: 10,
  approval_ttl_hours: 24,
  consented_evidence_capture: false,
  raw_logs: false,
};

export const Preferences = Type.Object(
  {
    settings_version: Type.Literal(SETTINGS_VERSION),
    target_titles: Type.Array(ShortString, { maxItems: 50 }),
    excluded_titles: Type.Array(ShortString, { maxItems: 50 }),
    required_skills: Type.Array(ShortString, { maxItems: 100 }),
    preferred_skills: Type.Array(ShortString, { maxItems: 100 }),
    excluded_companies: Type.Array(ShortString, { maxItems: 200 }),
    countries: Type.Array(Type.String({ pattern: '^[A-Z]{2}$' }), { maxItems: 100 }),
    remote_modes: Type.Array(RemoteMode, { maxItems: 3 }),
    employment_types: Type.Array(
      Type.Union([
        Type.Literal('full_time'),
        Type.Literal('part_time'),
        Type.Literal('contract'),
        Type.Literal('internship'),
        Type.Literal('temporary'),
        Type.Literal('freelance'),
      ]),
      { maxItems: 6 },
    ),
    languages: Type.Array(Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }), { maxItems: 20 }),
    salary: Type.Union([
      Type.Object(
        {
          minimum: Type.Number({ minimum: 0 }),
          /** ISO-4217. No automatic conversion: only matching currency/period compare. */
          currency: Type.String({ pattern: '^[A-Z]{3}$' }),
          period: SalaryPeriod,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    sponsorship_policy: Type.Union([
      Type.Literal('allow'),
      Type.Literal('avoid'),
      Type.Literal('unknown'),
    ]),
    unknown_eligibility_policy: Type.Union([Type.Literal('review'), Type.Literal('hide')]),
    scan_interval_hours: Type.Integer({ minimum: 1, maximum: 168 }),
    match_weights: MatchWeights,
    cv_language: Locale,
    cv_template: Type.Union([Type.Literal('simple')]),
    resume_mode: Type.Union([Type.Literal('original'), Type.Literal('tailored')]),
    limits: OperationalLimits,
    /**
     * Level 2 customization: may adjust tone or emphasis, never the factual
     * constraints. Non-negotiable invariants are not overridable by prompts.
     */
    prompt_style_suffix: Type.Union([Type.String({ maxLength: 1000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type Preferences = Static<typeof Preferences>;

export const DEFAULT_PREFERENCES: Preferences = {
  settings_version: SETTINGS_VERSION,
  target_titles: [],
  excluded_titles: [],
  required_skills: [],
  preferred_skills: [],
  excluded_companies: [],
  countries: [],
  remote_modes: ['remote'],
  employment_types: ['full_time'],
  languages: ['en'],
  salary: null,
  sponsorship_policy: 'unknown',
  unknown_eligibility_policy: 'review',
  scan_interval_hours: 24,
  match_weights: DEFAULT_MATCH_WEIGHTS,
  cv_language: 'en',
  cv_template: 'simple',
  resume_mode: 'tailored',
  limits: DEFAULT_OPERATIONAL_LIMITS,
  prompt_style_suffix: null,
};

export const PreferencesView = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
    config: Preferences,
    updated_at: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);
export type PreferencesView = Static<typeof PreferencesView>;

export const PreferencesPutRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    config: Preferences,
  },
  { additionalProperties: false },
);
export type PreferencesPutRequest = Static<typeof PreferencesPutRequest>;

/** Weights must sum to 100 exactly; enforced beyond schema range checks. */
export function matchWeightsSum(weights: MatchWeights): number {
  return MATCH_WEIGHT_KEYS.reduce((total, key) => total + weights[key], 0);
}
