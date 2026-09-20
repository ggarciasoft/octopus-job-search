import { Type, type Static } from '@sinclair/typebox';
import { OptionalNullable, Timestamp, TriState, Uuid } from '../common.js';
// One SalaryPeriod for the whole contract: a job's stated period and a user's
// preference period must be the same enum, because they are compared directly
// and never converted.
import { SalaryPeriod } from './preferences.js';

/**
 * Discovery and job contracts (milestone M2), from
 * docs/spec/05_DISCOVERY_CONNECTORS.md and the jobs/sources/scans rows of
 * docs/spec/03_DATA_MODEL.md.
 *
 * Two invariants shape everything here:
 *  - nothing is invented: a published date, a salary or an eligible country
 *    that the source did not state is null, and a field a connector inferred
 *    rather than read is declared as inferred with the excerpt it came from;
 *  - unknown stays unknown: remote does not imply worldwide, and an absent
 *    eligibility statement is `unknown`, never a positive match.
 */

export const ConnectorId = Type.Union([
  Type.Literal('greenhouse'),
  Type.Literal('lever'),
  Type.Literal('manual'),
  Type.Literal('url'),
]);
export type ConnectorId = Static<typeof ConnectorId>;

export const ALL_CONNECTOR_IDS = [
  'greenhouse',
  'lever',
  'manual',
  'url',
] as const satisfies readonly ConnectorId[];

/** Connectors a user may register as a scannable board. */
export const BOARD_CONNECTOR_IDS = [
  'greenhouse',
  'lever',
] as const satisfies readonly ConnectorId[];

export const RemoteType = Type.Union([
  Type.Literal('remote'),
  Type.Literal('hybrid'),
  Type.Literal('onsite'),
  Type.Literal('unknown'),
]);
export type RemoteType = Static<typeof RemoteType>;

export const JobStatus = Type.Union([
  Type.Literal('active'),
  Type.Literal('closed'),
  Type.Literal('unknown'),
]);
export type JobStatus = Static<typeof JobStatus>;

export const ALL_JOB_STATUSES = [
  'active',
  'closed',
  'unknown',
] as const satisfies readonly JobStatus[];

export const JobEmploymentType = Type.Union([
  Type.Literal('full_time'),
  Type.Literal('part_time'),
  Type.Literal('contract'),
  Type.Literal('internship'),
  Type.Literal('temporary'),
  Type.Literal('freelance'),
]);
export type JobEmploymentType = Static<typeof JobEmploymentType>;

export const JobLocation = Type.Object(
  {
    /** ISO-3166-1 alpha-2, or null when the posting names no country. */
    country: Type.Union([Type.String({ pattern: '^[A-Z]{2}$' }), Type.Null()]),
    region: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
    city: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
    /** The text the location was read from, so a user can check it. */
    source_excerpt: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type JobLocation = Static<typeof JobLocation>;

/**
 * Stored exactly as stated. No currency or period conversion happens in the
 * pilot; comparison is only ever between matching currency and period, and a
 * salary with an unknown currency compares to nothing.
 */
export const JobSalary = Type.Object(
  {
    min: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    max: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    currency: Type.Union([Type.String({ pattern: '^[A-Z]{3}$' }), Type.Null()]),
    period: Type.Union([SalaryPeriod, Type.Null()]),
    source_excerpt: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
);
export type JobSalary = Static<typeof JobSalary>;

export const RequirementKind = Type.Union([
  Type.Literal('required'),
  Type.Literal('preferred'),
  Type.Literal('unknown'),
]);

export const JobRequirement = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 600 }),
    kind: RequirementKind,
    evidence_excerpt: Type.String({ minLength: 1, maxLength: 600 }),
  },
  { additionalProperties: false },
);
export type JobRequirement = Static<typeof JobRequirement>;

/**
 * A field the connector inferred (from surrounding text, a heuristic, or a
 * model) rather than read from a structured value. The excerpt is mandatory:
 * an inference with no evidence is an invention.
 */
export const InferredField = Type.Object(
  {
    field: Type.Union([
      Type.Literal('remote_type'),
      Type.Literal('locations'),
      Type.Literal('eligible_countries'),
      Type.Literal('employment_type'),
      Type.Literal('salary'),
      Type.Literal('language'),
      Type.Literal('requirements'),
    ]),
    source_excerpt: Type.String({ minLength: 1, maxLength: 600 }),
  },
  { additionalProperties: false },
);
export type InferredField = Static<typeof InferredField>;

/** The connector output shape from docs/spec/05_DISCOVERY_CONNECTORS.md. */
export const NormalizedJob = Type.Object(
  {
    external_id: Type.String({ minLength: 1, maxLength: 200 }),
    /** connector + board + external id, or the normalised employer URL. */
    source_key: Type.String({ minLength: 1, maxLength: 500 }),
    canonical_url: Type.String({ minLength: 1, maxLength: 2000 }),
    apply_url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    company: Type.String({ minLength: 1, maxLength: 200 }),
    title: Type.String({ minLength: 1, maxLength: 300 }),
    description_text: Type.String({ minLength: 1, maxLength: 200_000 }),
    /** Never invented. Null when the source states no date. */
    published_at: Type.Union([Timestamp, Type.Null()]),
    updated_at: Type.Union([Timestamp, Type.Null()]),
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
    inferred: Type.Array(InferredField, { maxItems: 20 }),
    content_hash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    retrieved_at: Timestamp,
  },
  { additionalProperties: false },
);
export type NormalizedJob = Static<typeof NormalizedJob>;

// ---------------------------------------------------------------------------
// Sources (the board registry)
// ---------------------------------------------------------------------------

export const SourceHealthState = Type.Union([
  Type.Literal('unknown'),
  Type.Literal('ok'),
  Type.Literal('degraded'),
  /** Repeated 403/429: scanning stops until the user re-enables the source. */
  Type.Literal('blocked'),
  Type.Literal('disabled'),
]);
export type SourceHealthState = Static<typeof SourceHealthState>;

export const SourceHealth = Type.Object(
  {
    state: SourceHealthState,
    consecutive_failures: Type.Integer({ minimum: 0 }),
    last_error_code: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    last_error_at: Type.Union([Timestamp, Type.Null()]),
    detail: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SourceHealth = Static<typeof SourceHealth>;

export const SourceView = Type.Object(
  {
    id: Uuid,
    connector: ConnectorId,
    connector_version: Type.String({ maxLength: 32 }),
    board_key: Type.String({ minLength: 1, maxLength: 200 }),
    base_url: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    enabled: Type.Boolean(),
    last_success_at: Type.Union([Timestamp, Type.Null()]),
    last_scan_id: Type.Union([Uuid, Type.Null()]),
    next_scan_after: Type.Union([Timestamp, Type.Null()]),
    health: SourceHealth,
    job_count: Type.Integer({ minimum: 0 }),
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);
export type SourceView = Static<typeof SourceView>;

export const CreateSourceRequest = Type.Object(
  {
    connector: Type.Union([Type.Literal('greenhouse'), Type.Literal('lever')]),
    /** Greenhouse board token or Lever site slug. */
    board_key: Type.String({ minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9._-]+$' }),
    /** Only for connectors with a documented regional endpoint (Lever EU). */
    base_url: OptionalNullable(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type CreateSourceRequest = Static<typeof CreateSourceRequest>;

export const PatchSourceRequest = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    base_url: OptionalNullable(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type PatchSourceRequest = Static<typeof PatchSourceRequest>;

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

export const ScanStatus = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  /** Fetched something but not a complete snapshot; may not close jobs. */
  Type.Literal('partial'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);
export type ScanStatus = Static<typeof ScanStatus>;

export const ScanCounts = Type.Object(
  {
    fetched: Type.Integer({ minimum: 0 }),
    created: Type.Integer({ minimum: 0 }),
    updated: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
    closed: Type.Integer({ minimum: 0 }),
    pages: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ScanCounts = Static<typeof ScanCounts>;

export const ScanView = Type.Object(
  {
    id: Uuid,
    source_id: Uuid,
    task_id: Type.Union([Uuid, Type.Null()]),
    status: ScanStatus,
    complete_snapshot: Type.Boolean(),
    counts: ScanCounts,
    error_code: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    error_message: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    started_at: Type.Union([Timestamp, Type.Null()]),
    completed_at: Type.Union([Timestamp, Type.Null()]),
    created_at: Timestamp,
  },
  { additionalProperties: false },
);
export type ScanView = Static<typeof ScanView>;

// ---------------------------------------------------------------------------
// Jobs as the API presents them
// ---------------------------------------------------------------------------

/** Provenance: where a job was seen. One job may be seen through several. */
export const JobSourceView = Type.Object(
  {
    id: Uuid,
    source_id: Type.Union([Uuid, Type.Null()]),
    connector: ConnectorId,
    external_id: Type.String({ maxLength: 200 }),
    canonical_url: Type.String({ maxLength: 2000 }),
    apply_url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    retrieved_at: Timestamp,
  },
  { additionalProperties: false },
);
export type JobSourceView = Static<typeof JobSourceView>;

/**
 * Similar title/location alone is a warning, never an automatic merge
 * (docs/spec/03_DATA_MODEL.md, "Deduplication").
 */
export const PossibleDuplicate = Type.Object(
  {
    job_id: Uuid,
    reason: Type.Union([
      Type.Literal('same_apply_url'),
      Type.Literal('same_requisition'),
      Type.Literal('similar_title_and_location'),
    ]),
    detail: Type.String({ maxLength: 300 }),
  },
  { additionalProperties: false },
);
export type PossibleDuplicate = Static<typeof PossibleDuplicate>;

/**
 * Match summary as the jobs list carries it. Populated by M3; until then the
 * API returns null, and the UI must render "Not checked", not a score.
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

export const JobView = Type.Object(
  {
    id: Uuid,
    canonical_key: Type.String({ maxLength: 500 }),
    company: Type.String({ maxLength: 200 }),
    title: Type.String({ maxLength: 300 }),
    status: JobStatus,
    remote_type: RemoteType,
    locations: Type.Array(JobLocation),
    eligible_countries: Type.Union([
      Type.Array(Type.String({ pattern: '^[A-Z]{2}$' })),
      Type.Null(),
    ]),
    employment_type: Type.Union([JobEmploymentType, Type.Null()]),
    salary: Type.Union([JobSalary, Type.Null()]),
    language: Type.Union([Type.String(), Type.Null()]),
    published_at: Type.Union([Timestamp, Type.Null()]),
    first_seen_at: Timestamp,
    last_seen_at: Timestamp,
    /** Last successful fetch of this job; drives the >24h recheck rule. */
    last_fetched_at: Type.Union([Timestamp, Type.Null()]),
    revision: Type.Integer({ minimum: 1 }),
    saved: Type.Boolean(),
    /** Hidden by an exclusion (employer) or a failed hard filter; still inspectable. */
    excluded_reason: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    sources: Type.Array(JobSourceView),
    match: Type.Union([MatchSummary, Type.Null()]),
    possible_duplicates: Type.Array(PossibleDuplicate),
  },
  { additionalProperties: false },
);
export type JobView = Static<typeof JobView>;

/**
 * A flat object rather than an intersection: `allOf` has no top-level
 * `type: object`, which the JSON Schema documents and the Pydantic generator
 * both rely on, and a spread keeps the two views from drifting apart.
 */
export const JobDetailView = Type.Object(
  {
    ...JobView.properties,
    description_text: Type.String(),
    requirements: Type.Array(JobRequirement),
    inferred: Type.Array(InferredField),
    content_hash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
);
export type JobDetailView = Static<typeof JobDetailView>;

export const JobsListQuery = Type.Object(
  {
    query: Type.Optional(Type.String({ maxLength: 200 })),
    status: Type.Optional(JobStatus),
    min_score: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    eligible: Type.Optional(TriState),
    /** Excluded jobs are hidden by default and shown only on request. */
    include_excluded: Type.Optional(Type.Boolean()),
    saved: Type.Optional(Type.Boolean()),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type JobsListQuery = Static<typeof JobsListQuery>;

/** POST /jobs/import: a URL or pasted text, with user-supplied provenance. */
export const JobImportRequest = Type.Object(
  {
    url: Type.Optional(Type.String({ minLength: 8, maxLength: 2000 })),
    description_text: Type.Optional(Type.String({ minLength: 20, maxLength: 200_000 })),
    company: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    apply_url: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
export type JobImportRequest = Static<typeof JobImportRequest>;

export const PatchJobRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    saved: Type.Optional(Type.Boolean()),
    /** Explicit user closure: closes immediately, unlike disappearance. */
    status: Type.Optional(Type.Literal('closed')),
  },
  { additionalProperties: false },
);
export type PatchJobRequest = Static<typeof PatchJobRequest>;

// ---------------------------------------------------------------------------
// Limits and rules from docs/spec/05_DISCOVERY_CONNECTORS.md
// ---------------------------------------------------------------------------

/**
 * Conservative defaults. They do not establish permission to crawl; a source
 * that answers 403 or 429 repeatedly is marked blocked and left alone.
 */
export const DISCOVERY_LIMITS = {
  perHostConcurrency: 1,
  minRequestIntervalMs: 1000,
  scanIntervalHours: 24,
  scanIntervalJitterMinutes: 30,
  requestTimeoutSeconds: 20,
  maxJobsPerScan: 1000,
  maxPagesPerScan: 100,
  /** Stop and mark the source blocked after this many consecutive 403/429. */
  blockAfterConsecutiveDenials: 3,
} as const;

/** Arbitrary-URL fetch policy. These are hard bounds, not tunables. */
export const URL_FETCH_POLICY = {
  httpsOnly: true,
  maxRedirects: 3,
  maxHtmlBytes: 2 * 1024 * 1024,
  timeoutSeconds: 20,
  allowedContentTypes: ['text/html', 'application/xhtml+xml', 'application/ld+json'] as const,
  /** Public IPs only, checked before connect and after every redirect. */
  blockPrivateDestinations: true,
  sendCredentials: false,
} as const;

/**
 * Closure: a job missing from two successful *complete* snapshots at least
 * 24 hours apart is closed. A failed or partial scan never closes anything.
 */
export const CLOSURE_RULES = {
  missingCompleteSnapshotsToClose: 2,
  minHoursBetweenSnapshots: 24,
  /** Recheck availability before packet preparation when older than this. */
  recheckBeforePacketHours: 24,
} as const;
