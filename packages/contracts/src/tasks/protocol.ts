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
