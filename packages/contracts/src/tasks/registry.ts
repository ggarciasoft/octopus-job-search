import { Type, type Static } from '@sinclair/typebox';

/**
 * Task types from 02_ARCHITECTURE.md. The full list is declared up front so the
 * queue, capability negotiation and settings share one enum, but only the types
 * listed in IMPLEMENTED_TASK_TYPES have handlers today.
 */
export const TaskType = Type.Union([
  Type.Literal('noop_echo'),
  Type.Literal('parse_profile'),
  Type.Literal('fetch_board'),
  Type.Literal('fetch_job'),
  Type.Literal('match_job'),
  Type.Literal('render_cv'),
  Type.Literal('build_packet'),
  Type.Literal('fill_local'),
  Type.Literal('export_workspace'),
  Type.Literal('delete_workspace'),
  Type.Literal('discover_boards'),
]);
export type TaskType = Static<typeof TaskType>;

export const ALL_TASK_TYPES = [
  'noop_echo',
  'parse_profile',
  'fetch_board',
  'fetch_job',
  'match_job',
  'render_cv',
  'build_packet',
  'fill_local',
  'export_workspace',
  'delete_workspace',
  'discover_boards',
] as const satisfies readonly TaskType[];

/** Task types that have a real worker handler. Everything else must 501. */
export const IMPLEMENTED_TASK_TYPES = [
  'noop_echo',
  'parse_profile',
  'fetch_board',
  'fetch_job',
] as const satisfies readonly TaskType[];

export const TaskState = Type.Union([
  Type.Literal('queued'),
  Type.Literal('leased'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);
export type TaskState = Static<typeof TaskState>;

export const ALL_TASK_STATES = [
  'queued',
  'leased',
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly TaskState[];

/**
 * fill_local is deliberately NOT a container-worker capability: it is only
 * claimable by a paired local desktop runner (02_ARCHITECTURE.md, ADR05).
 */
export const RUNNER_ONLY_CAPABILITIES = ['fill_local'] as const satisfies readonly TaskType[];

export const LEASE_SECONDS = 120;
export const HEARTBEAT_SECONDS = 30;
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Browser filling is never blindly retried (invariant: page may have changed). */
export const NO_RETRY_TASK_TYPES = ['fill_local'] as const satisfies readonly TaskType[];
export const ARTIFACT_STAGING_TTL_HOURS = 24;

export const TaskProgress = Type.Object(
  {
    stage: Type.String({ maxLength: 120 }),
    percent: Type.Integer({ minimum: 0, maximum: 100 }),
  },
  { additionalProperties: false },
);
export type TaskProgress = Static<typeof TaskProgress>;

export const TaskFailureCode = Type.Union([
  Type.Literal('PROVIDER_UNAVAILABLE'),
  Type.Literal('PROVIDER_INVALID_OUTPUT'),
  Type.Literal('BUDGET_EXHAUSTED'),
  Type.Literal('INPUT_INVALID'),
  Type.Literal('FILE_UNREADABLE'),
  Type.Literal('ENCRYPTED_DOCUMENT'),
  Type.Literal('OCR_REQUIRED'),
  Type.Literal('EXTRACTION_EMPTY'),
  Type.Literal('LIMIT_EXCEEDED'),
  Type.Literal('FETCH_BLOCKED'),
  Type.Literal('RATE_LIMITED'),
  Type.Literal('TIMEOUT'),
  Type.Literal('CANCELLED'),
  Type.Literal('UNSUPPORTED_TASK_TYPE'),
  Type.Literal('INTERNAL_ERROR'),
]);
export type TaskFailureCode = Static<typeof TaskFailureCode>;
