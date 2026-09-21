import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';
import { TaskFailureCode, TaskProgress, TaskState, TaskType } from './registry.js';

export const INPUT_SCHEMA_VERSION = 1;
export const RESULT_SCHEMA_VERSION = 1;
export const PROTOCOL_VERSION = 1;

/** POST /internal/v1/tasks/claim */
export const ClaimRequest = Type.Object(
  {
    worker_id: Type.String({ minLength: 1, maxLength: 128 }),
    capabilities: Type.Array(TaskType, { minItems: 1, maxItems: 32 }),
    protocol_version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type ClaimRequest = Static<typeof ClaimRequest>;

/**
 * A declared input file the worker may download through the task-scoped
 * endpoint. Workers never receive a storage key or a public URL.
 */
export const TaskInputFile = Type.Object(
  {
    file_id: Uuid,
    purpose: Type.String({ maxLength: 64 }),
    original_name: Type.String({ maxLength: 255 }),
    mime: Type.String({ maxLength: 128 }),
    bytes: Type.Integer({ minimum: 0 }),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
);
export type TaskInputFile = Static<typeof TaskInputFile>;

export const ClaimResponse = Type.Object(
  {
    task_id: Uuid,
    type: TaskType,
    lease_token: Type.String({ minLength: 32 }),
    lease_expires_at: Timestamp,
    attempt: Type.Integer({ minimum: 1 }),
    max_attempts: Type.Integer({ minimum: 1 }),
    input_schema_version: Type.Integer({ minimum: 1 }),
    /** Task snapshot: revision IDs and minimal fields, never full history. */
    input: Type.Unknown(),
    files: Type.Array(TaskInputFile),
  },
  { additionalProperties: false },
);
export type ClaimResponse = Static<typeof ClaimResponse>;

export const HeartbeatRequest = Type.Object(
  {
    lease_token: Type.String({ minLength: 32 }),
    progress: Type.Optional(TaskProgress),
  },
  { additionalProperties: false },
);
export type HeartbeatRequest = Static<typeof HeartbeatRequest>;

export const HeartbeatResponse = Type.Object(
  {
    cancel_requested: Type.Boolean(),
    lease_expires_at: Timestamp,
  },
  { additionalProperties: false },
);
export type HeartbeatResponse = Static<typeof HeartbeatResponse>;

export const CompleteRequest = Type.Object(
  {
    lease_token: Type.String({ minLength: 32 }),
    result_schema_version: Type.Integer({ minimum: 1 }),
    result: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type CompleteRequest = Static<typeof CompleteRequest>;

/** The server, not the worker, decides whether a retry happens. */
export const FailRequest = Type.Object(
  {
    lease_token: Type.String({ minLength: 32 }),
    code: TaskFailureCode,
    retryable: Type.Boolean(),
    redacted_message: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type FailRequest = Static<typeof FailRequest>;

export const TaskAck = Type.Object(
  { task_id: Uuid, state: TaskState },
  { additionalProperties: false },
);
export type TaskAck = Static<typeof TaskAck>;

export const ArtifactUploadResponse = Type.Object(
  { file_id: Uuid, committed: Type.Literal(false) },
  { additionalProperties: false },
);
export type ArtifactUploadResponse = Static<typeof ArtifactUploadResponse>;

/** GET /api/v1/tasks/:id — the public view, free of lease internals. */
export const TaskView = Type.Object(
  {
    id: Uuid,
    type: TaskType,
    state: TaskState,
    progress: Type.Union([TaskProgress, Type.Null()]),
    attempt: Type.Integer({ minimum: 0 }),
    max_attempts: Type.Integer({ minimum: 1 }),
    cancel_requested: Type.Boolean(),
    run_after: Timestamp,
    created_at: Timestamp,
    updated_at: Timestamp,
    result: Type.Union([Type.Unknown(), Type.Null()]),
    error: Type.Union([
      Type.Object(
        {
          code: TaskFailureCode,
          message: Type.String(),
          retryable: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type TaskView = Static<typeof TaskView>;

// ---------------------------------------------------------------------------
// Usage reservation (06_AI_PROFILE_AND_CV.md)
//
//     Reserve estimated token/cost budget before requests; settle actual usage
//     if reported. Track unknown price as unknown, never zero.
//
// The reservation is taken *before* the request and against the database, not
// against a counter in the worker process. A per-process counter cannot express
// a daily budget at all: it is born at zero on every task, so a budget could
// only ever refuse a single request larger than the whole day's allowance, and
// a day of ordinary requests would never exhaust anything.
// ---------------------------------------------------------------------------

/** POST /internal/v1/tasks/:id/usage/reserve */
export const UsageReserveRequest = Type.Object(
  {
    lease_token: Type.String({ minLength: 32 }),
    /**
     * The worker's estimate, made from the prompt it is about to send. It is
     * deliberately crude and deliberately made first: the point is to stop a
     * request that cannot be afforded before it is sent, not to bill precisely.
     */
    estimated_input_tokens: Type.Integer({ minimum: 0, maximum: 10_000_000 }),
    estimated_output_tokens: Type.Integer({ minimum: 0, maximum: 10_000_000 }),
  },
  { additionalProperties: false },
);
export type UsageReserveRequest = Static<typeof UsageReserveRequest>;

export const UsageReserveResponse = Type.Object(
  {
    reservation_id: Uuid,
    reserved_tokens: Type.Integer({ minimum: 0 }),
    /** Null when no rate card is configured: the price is unknown, not zero. */
    reserved_cost: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    currency: Type.Union([Type.String({ pattern: '^[A-Z]{3}$' }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type UsageReserveResponse = Static<typeof UsageReserveResponse>;

/** POST /internal/v1/tasks/:id/usage/:reservation_id/settle */
export const UsageSettleRequest = Type.Object(
  {
    lease_token: Type.String({ minLength: 32 }),
    /**
     * Null means the provider reported nothing. The reservation's estimate then
     * stands as the charge — an unreported request is not a free one.
     */
    input_tokens: Type.Union([Type.Integer({ minimum: 0, maximum: 10_000_000 }), Type.Null()]),
    output_tokens: Type.Union([Type.Integer({ minimum: 0, maximum: 10_000_000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type UsageSettleRequest = Static<typeof UsageSettleRequest>;

export const UsageSettleResponse = Type.Object(
  {
    reservation_id: Uuid,
    input_tokens: Type.Integer({ minimum: 0 }),
    output_tokens: Type.Integer({ minimum: 0 }),
    measured_cost: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    currency: Type.Union([Type.String({ pattern: '^[A-Z]{3}$' }), Type.Null()]),
    /** True when no price could be computed. Never reported as a cost of zero. */
    cost_is_unknown: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type UsageSettleResponse = Static<typeof UsageSettleResponse>;

/** POST /internal/v1/tasks/:id/usage/:reservation_id/release */
export const UsageReleaseRequest = Type.Object(
  { lease_token: Type.String({ minLength: 32 }) },
  { additionalProperties: false },
);
export type UsageReleaseRequest = Static<typeof UsageReleaseRequest>;
