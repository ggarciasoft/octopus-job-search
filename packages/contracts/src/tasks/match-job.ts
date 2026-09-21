import { Type, type Static } from '@sinclair/typebox';
import { Locale, Timestamp, TriState, Uuid } from '../common.js';
import { Preferences } from '../schemas/preferences.js';
import { ProfileFact } from '../schemas/profile.js';
import { JobEmploymentType, JobLocation, JobSalary, RemoteType } from '../schemas/jobs.js';
import { JobRequirement } from '../schemas/requirements.js';
import { MatchExplanation } from '../schemas/matches.js';

/**
 * The job as the matcher sees it. This is a snapshot, not a reference: the
 * task input carries revision ids and the fields scored against them, never
 * the workspace's history (04_API_CONTRACTS.md, internal task protocol).
 *
 * `description_text` is included because the seniority and industry
 * components read prose the requirement extractor did not turn into a
 * requirement. It is untrusted data (invariant 9): the matcher quotes it, and
 * never follows it.
 */
export const MatchJobSnapshot = Type.Object(
  {
    company: Type.String({ minLength: 1, maxLength: 200 }),
    title: Type.String({ minLength: 1, maxLength: 300 }),
    description_text: Type.String({ maxLength: 200_000 }),
    locations: Type.Array(JobLocation, { maxItems: 50 }),
    remote_type: RemoteType,
    /** Null means the posting does not say; it never means "anywhere". */
    eligible_countries: Type.Union([
      Type.Array(Type.String({ pattern: '^[A-Z]{2}$' }), { maxItems: 250 }),
      Type.Null(),
    ]),
    employment_type: Type.Union([JobEmploymentType, Type.Null()]),
    salary: Type.Union([JobSalary, Type.Null()]),
    language: Type.Union([Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' }), Type.Null()]),
    requirements: Type.Array(JobRequirement, { maxItems: 200 }),
  },
  { additionalProperties: false },
);
export type MatchJobSnapshot = Static<typeof MatchJobSnapshot>;

/**
 * Only confirmed facts are sent. A draft fact is a parsing proposal the user
 * has not agreed to, and scoring against one would quietly turn an extraction
 * guess into a claim about the user's experience.
 */
export const MatchJobInput = Type.Object(
  {
    job_id: Uuid,
    job_revision: Type.Integer({ minimum: 1 }),
    profile_revision: Type.Integer({ minimum: 1 }),
    preferences_revision: Type.Integer({ minimum: 1 }),
    locale: Locale,
    job: MatchJobSnapshot,
    confirmed_facts: Type.Array(ProfileFact, { maxItems: 500 }),
    preferences: Preferences,
  },
  { additionalProperties: false },
);
export type MatchJobInput = Static<typeof MatchJobInput>;

/**
 * Scoring is deterministic: the same input must produce the same result on
 * any worker, which is what makes a score reproducible and auditable
 * (06_AI_PROFILE_AND_CV.md). No provider call is made by this task in v1, so
 * it consumes no AI budget and works with no provider configured at all.
 */
export const MatchJobResult = Type.Object(
  {
    eligible: TriState,
    /** Null when zero components were evaluable, never 0 as a stand-in. */
    score: Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()]),
    coverage_percent: Type.Integer({ minimum: 0, maximum: 100 }),
    explanation: MatchExplanation,
    computed_at: Timestamp,
  },
  { additionalProperties: false },
);
export type MatchJobResult = Static<typeof MatchJobResult>;
