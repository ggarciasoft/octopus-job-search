import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';
import {
  ConnectorId,
  DISCOVERY_LIMITS,
  NormalizedJob,
  SourceHealthState,
  URL_FETCH_POLICY,
} from '../schemas/jobs.js';

/**
 * Discovery task contracts (M2). Two tasks:
 *
 *  - fetch_board: pull one configured public board (Greenhouse, Lever) and
 *    return normalised jobs. A partial fetch MUST say so, because only a
 *    complete snapshot may be used to decide that a job has disappeared.
 *  - fetch_job: resolve one user-supplied URL or pasted description into a
 *    normalised job, under the arbitrary-URL network policy.
 *
 * The API, not the worker, decides what happens to the result: dedup,
 * closure, provenance and source health are applied in one transaction
 * after validation (docs/spec/04_API_CONTRACTS.md).
 */

export const FetchLimits = Type.Object(
  {
    max_jobs: Type.Integer({ minimum: 1, maximum: DISCOVERY_LIMITS.maxJobsPerScan }),
    max_pages: Type.Integer({ minimum: 1, maximum: DISCOVERY_LIMITS.maxPagesPerScan }),
    timeout_seconds: Type.Integer({ minimum: 1, maximum: 120 }),
    min_request_interval_ms: Type.Integer({ minimum: DISCOVERY_LIMITS.minRequestIntervalMs }),
  },
  { additionalProperties: false },
);
export type FetchLimits = Static<typeof FetchLimits>;

export const FetchBoardInput = Type.Object(
  {
    scan_id: Uuid,
    source_id: Uuid,
    connector: Type.Union([Type.Literal('greenhouse'), Type.Literal('lever')]),
    connector_version: Type.String({ minLength: 1, maxLength: 32 }),
    board_key: Type.String({ minLength: 1, maxLength: 200 }),
    base_url: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    /** Conditional-request hints from the last successful scan, if any. */
    etag: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    last_modified: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    limits: FetchLimits,
  },
  { additionalProperties: false },
);
export type FetchBoardInput = Static<typeof FetchBoardInput>;

export const FetchWarningCode = Type.Union([
  Type.Literal('RATE_LIMITED'),
  Type.Literal('ACCESS_DENIED'),
  Type.Literal('NOT_MODIFIED'),
  Type.Literal('PAGE_LIMIT_REACHED'),
  Type.Literal('JOB_LIMIT_REACHED'),
  Type.Literal('SCHEMA_DRIFT'),
  Type.Literal('ROBOTS_DISALLOWED'),
  Type.Literal('BLOCKED_DESTINATION'),
  Type.Literal('REDIRECT_LIMIT'),
  Type.Literal('CONTENT_TYPE_REJECTED'),
  Type.Literal('BODY_TRUNCATED'),
  Type.Literal('NO_STRUCTURED_DATA'),
  Type.Literal('MULTIPLE_POSTINGS'),
  Type.Literal('FIELD_INFERRED'),
  Type.Literal('FIELD_DROPPED_INVALID'),
]);
export type FetchWarningCode = Static<typeof FetchWarningCode>;

export const FetchWarning = Type.Object(
  {
    code: FetchWarningCode,
    message: Type.String({ maxLength: 500 }),
    detail: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type FetchWarning = Static<typeof FetchWarning>;

export const FetchBoardResult = Type.Object(
  {
    jobs: Type.Array(NormalizedJob, { maxItems: DISCOVERY_LIMITS.maxJobsPerScan }),
    /**
     * True only when every page was fetched within limits and no request
     * failed. A false value forbids closing jobs that were not seen.
     */
    complete_snapshot: Type.Boolean(),
    next_cursor: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    pages_fetched: Type.Integer({ minimum: 0 }),
    etag: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    last_modified: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
    /** The worker's observation; the API decides the stored health state. */
    observed_health: Type.Object(
      {
        state: SourceHealthState,
        http_status: Type.Union([Type.Integer({ minimum: 100, maximum: 599 }), Type.Null()]),
        retry_after_seconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    warnings: Type.Array(FetchWarning, { maxItems: 100 }),
    fetched_at: Timestamp,
  },
  { additionalProperties: false },
);
export type FetchBoardResult = Static<typeof FetchBoardResult>;

export const FetchJobInput = Type.Object(
  {
    job_import_id: Uuid,
    /** Exactly one of url / description_text is set; the API enforces it. */
    url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    description_text: Type.Union([Type.String({ maxLength: 200_000 }), Type.Null()]),
    company_hint: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    title_hint: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
    apply_url_hint: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    policy: Type.Object(
      {
        max_redirects: Type.Integer({ minimum: 0, maximum: URL_FETCH_POLICY.maxRedirects }),
        max_html_bytes: Type.Integer({ minimum: 1024, maximum: URL_FETCH_POLICY.maxHtmlBytes }),
        timeout_seconds: Type.Integer({ minimum: 1, maximum: URL_FETCH_POLICY.timeoutSeconds }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type FetchJobInput = Static<typeof FetchJobInput>;

export const FetchJobResult = Type.Object(
  {
    /**
     * The resolved posting, or null when the page held several postings or
     * none: the user then chooses from `candidates` or falls back to paste.
     */
    job: Type.Union([NormalizedJob, Type.Null()]),
    candidates: Type.Array(NormalizedJob, { maxItems: 50 }),
    fetch: Type.Object(
      {
        performed: Type.Boolean(),
        final_url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
        http_status: Type.Union([Type.Integer({ minimum: 100, maximum: 599 }), Type.Null()]),
        content_type: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
        bytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        redirects: Type.Integer({ minimum: 0 }),
        /** How the posting was read: structured data first, then text. */
        extraction: Type.Union([
          Type.Literal('jsonld_jobposting'),
          Type.Literal('html_text'),
          Type.Literal('pasted_text'),
          Type.Literal('none'),
        ]),
      },
      { additionalProperties: false },
    ),
    warnings: Type.Array(FetchWarning, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type FetchJobResult = Static<typeof FetchJobResult>;

/** Tools that may run a connector, keyed by connector id (M2 support matrix). */
export const CONNECTOR_VERSIONS: Record<Extract<ConnectorId, 'greenhouse' | 'lever'>, string> = {
  greenhouse: '1',
  lever: '1',
};
