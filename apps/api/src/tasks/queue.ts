/**
 * The PostgreSQL-backed task queue.
 *
 * Semantics are taken verbatim from 02_ARCHITECTURE.md and
 * 04_API_CONTRACTS.md:
 *
 *  * "API atomically leases one task using SELECT FOR UPDATE SKIP LOCKED."
 *  * "Lease 120 seconds; heartbeat every 30 seconds. Completing with a stale
 *    token returns 409 and has no domain effect. Reclaimed tasks receive a new
 *    token."
 *  * "Ordinary read/compute tasks retry at most three times with exponential
 *    backoff and jitter. Respect Retry-After on 429. Browser filling is not
 *    blindly retried."
 *  * "Server, not worker, decides whether retry is allowed."
 *
 * Coordination is entirely through PostgreSQL row locks, so several API
 * replicas and several workers are safe with no Redis, BullMQ, Kafka or Celery
 * anywhere in the system (explicit prohibition in 02_ARCHITECTURE.md).
 */
import { sql } from 'kysely';
import {
  DEFAULT_MAX_ATTEMPTS,
  LEASE_SECONDS,
  NO_RETRY_TASK_TYPES,
  PROTOCOL_VERSION,
  TASK_IO_SCHEMAS,
  type ClaimResponse,
  type TaskFailureCode,
  type TaskInputFile,
  type TaskProgress,
  type TaskType,
  type TaskView,
  type FetchBoardResult,
  type FetchJobResult,
  type MatchJobResult,
  type ParseProfileResult,
  type FillLocalResult,
  type ObserveConfirmationResult,
  type RenderCvResult,
} from '@job-getter/contracts';
import type { Db, DbExecutor, DbTransaction } from '../db/pool.js';
import type { TaskRow } from '../db/types.js';
import { conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { generateToken, sha256Hex } from '../util/crypto.js';
import { checkSchema } from '../validation.js';
import { assertCapabilitiesAllowed } from '../auth/worker.js';
import type { Principal } from '../auth/scope.js';
import { applyParseProfileFailure, applyParseProfileResult } from '../profile/imports.js';
import { applyFetchBoardFailure, applyFetchBoardResult } from '../discovery/apply-board.js';
import { applyFetchJobFailure, applyFetchJobResult } from '../discovery/imports.js';
import { applyMatchJobResult } from '../matching/matches.js';
import { applyRenderCvFailure, applyRenderCvResult } from '../resumes/service.js';
import { applyFillLocalFailure, applyFillLocalResult } from '../applications/fill.js';
import {
  applyObserveConfirmationFailure,
  applyObserveConfirmationResult,
} from '../applications/observe.js';

/**
 * Applies a validated task result to the domain rows it owns.
 *
 * `noop_echo` has no domain effect by design — it is the M0 probe, and its
 * result lives only on the task row. Every task type with real consequences
 * registers here instead, and the call happens *inside* the completing
 * transaction so the task state and the domain state cannot disagree
 * (04_API_CONTRACTS.md: "Domain transitions occur only after API validation,
 * ownership checks, revision checks and task lease checks in one
 * transaction").
 */
async function applyDomainResult(
  trx: DbTransaction,
  task: TaskRow,
  result: unknown,
): Promise<void> {
  if (task.type === 'parse_profile') {
    await applyParseProfileResult(trx, task, result as ParseProfileResult);
  } else if (task.type === 'fetch_board') {
    await applyFetchBoardResult(trx, task, result as FetchBoardResult);
  } else if (task.type === 'fetch_job') {
    await applyFetchJobResult(trx, task, result as FetchJobResult);
  } else if (task.type === 'match_job') {
    await applyMatchJobResult(trx, task, result as MatchJobResult);
  } else if (task.type === 'render_cv') {
    await applyRenderCvResult(trx, task, result as RenderCvResult);
  } else if (task.type === 'fill_local') {
    await applyFillLocalResult(trx, task, result as FillLocalResult);
  } else if (task.type === 'observe_confirmation') {
    await applyObserveConfirmationResult(trx, task, result as ObserveConfirmationResult);
  }
}

/** The mirror image: a terminal failure must reach the domain row too. */
async function applyDomainFailure(
  trx: DbTransaction,
  task: TaskRow,
  code: string,
  message: string,
): Promise<void> {
  if (task.type === 'parse_profile') {
    await applyParseProfileFailure(trx, task, code, message);
  } else if (task.type === 'fetch_board') {
    await applyFetchBoardFailure(trx, task, code, message);
  } else if (task.type === 'fetch_job') {
    await applyFetchJobFailure(trx, task, code, message);
  } else if (task.type === 'render_cv') {
    await applyRenderCvFailure(trx, task, code, message);
  } else if (task.type === 'fill_local') {
    await applyFillLocalFailure(trx, task, code, message);
  } else if (task.type === 'observe_confirmation') {
    // Not a failed application: a browser that died mid-watch has said nothing
    // about whether the person's submission went through.
    await applyObserveConfirmationFailure(trx, task, code, message);
  }
  // `match_job` has no domain row to mark: a score that could not be computed
  // simply does not exist, and the job keeps reading "not checked". Inventing
  // a failed-match row would put a permanent red mark on a job over what is
  // usually a transient problem.
}

export const LEASE_MS = LEASE_SECONDS * 1000;

const NO_RETRY = new Set<string>(NO_RETRY_TASK_TYPES);

/**
 * Failure codes the *server* is willing to retry. A worker may ask for less
 * (`retryable: false` is honoured) but never for more: a worker that always
 * claims "retryable" cannot turn a permanently invalid document into an
 * infinite loop.
 */
const SERVER_RETRYABLE_CODES = new Set<TaskFailureCode>([
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'TIMEOUT',
  'INTERNAL_ERROR',
]);

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

export class ProtocolVersionError extends Error {
  constructor(received: number) {
    super(
      `Unsupported worker protocol_version ${received}; this API speaks version ${PROTOCOL_VERSION}.`,
    );
    this.name = 'ProtocolVersionError';
  }
}

/** Exponential backoff with jitter (02_ARCHITECTURE.md). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
  // Full-width jitter of +/-25% spreads a thundering herd of workers that all
  // failed against the same unavailable provider at the same instant.
  const jitter = exponential * 0.25 * (random() * 2 - 1);
  return Math.max(BACKOFF_BASE_MS, Math.round(exponential + jitter));
}

export function isRetryableFailure(
  type: TaskType,
  code: TaskFailureCode,
  workerSaysRetryable: boolean,
  attempt: number,
  maxAttempts: number,
): boolean {
  if (NO_RETRY.has(type)) return false;
  if (!workerSaysRetryable) return false;
  if (!SERVER_RETRYABLE_CODES.has(code)) return false;
  return attempt < maxAttempts;
}

export function toTaskView(row: TaskRow): TaskView {
  return {
    id: row.id,
    type: row.type,
    state: row.state,
    progress: (row.progress as TaskProgress | null) ?? null,
    attempt: row.attempt,
    max_attempts: row.max_attempts,
    cancel_requested: row.cancel_requested,
    run_after: row.run_after.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    result: row.result ?? null,
    error:
      row.error_code === null
        ? null
        : {
            code: row.error_code as TaskFailureCode,
            message: row.error_message ?? '',
            retryable: row.error_retryable ?? false,
          },
  };
}

export interface ClaimInput {
  readonly principal: Principal;
  readonly workerId: string;
  readonly capabilities: readonly TaskType[];
  readonly protocolVersion: number;
}

/**
 * Leases at most one task.
 *
 * The selection deliberately includes rows whose lease has expired, so a
 * crashed worker's task is picked up by the next poll rather than waiting for
 * the housekeeping sweep. Expired rows that have no retry budget left are
 * failed inside the same transaction instead of being handed out again.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes concurrent claims disjoint: a row
 * already locked by another claim transaction is invisible to this one.
 */
export async function claimTask(db: Db, input: ClaimInput): Promise<ClaimResponse | null> {
  if (input.protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolVersionError(input.protocolVersion);
  }
  assertCapabilitiesAllowed(input.principal, input.capabilities);

  const workspaceFilter = input.principal.kind === 'device' ? input.principal.workspaceId : null;

  return db.transaction().execute(async (trx) => {
    // Several candidates may be examined: an expired lease with no retry
    // budget is terminated and the search continues rather than returning 204
    // while runnable work waits behind it.
    for (let inspected = 0; inspected < 10; inspected += 1) {
      const candidate = await selectClaimCandidate(trx, input.capabilities, workspaceFilter);
      if (!candidate) return null;

      const isExpiredLease = candidate.state === 'leased';
      const exhausted = candidate.attempt >= candidate.max_attempts;
      const neverRetry = NO_RETRY.has(candidate.type);

      if (isExpiredLease && (exhausted || neverRetry)) {
        const message = neverRetry
          ? 'The lease expired and this task type is never retried automatically.'
          : 'The lease expired and no retry attempts remain.';
        await trx
          .updateTable('tasks')
          .set({
            state: 'failed',
            lease_token_hash: null,
            lease_expires_at: null,
            leased_by: null,
            error_code: 'TIMEOUT',
            error_message: message,
            error_retryable: false,
            updated_at: new Date(),
          })
          .where('id', '=', candidate.id)
          .execute();
        await applyDomainFailure(trx, candidate, 'TIMEOUT', message);
        continue;
      }

      if (candidate.cancel_requested) {
        await trx
          .updateTable('tasks')
          .set({
            state: 'cancelled',
            lease_token_hash: null,
            lease_expires_at: null,
            leased_by: null,
            updated_at: new Date(),
          })
          .where('id', '=', candidate.id)
          .execute();
        continue;
      }

      const leaseToken = generateToken();
      const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
      const leased = await trx
        .updateTable('tasks')
        .set({
          state: 'leased',
          attempt: candidate.attempt + 1,
          lease_token_hash: sha256Hex(leaseToken),
          lease_expires_at: leaseExpiresAt,
          leased_by: input.workerId,
          last_heartbeat_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', candidate.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      const row = leased as TaskRow;
      return {
        task_id: row.id,
        type: row.type,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt.toISOString(),
        attempt: row.attempt,
        max_attempts: row.max_attempts,
        input_schema_version: 1,
        input: row.payload,
        files: await loadInputFiles(trx, row),
      } satisfies ClaimResponse;
    }
    return null;
  });
}

async function selectClaimCandidate(
  trx: DbTransaction,
  capabilities: readonly TaskType[],
  workspaceId: string | null,
): Promise<TaskRow | null> {
  let query = trx
    .selectFrom('tasks')
    .selectAll()
    .where('capability', 'in', [...capabilities])
    .where((eb) =>
      eb.or([
        eb.and([eb('state', '=', 'queued'), eb('run_after', '<=', sql<Date>`now()`)]),
        eb.and([eb('state', '=', 'leased'), eb('lease_expires_at', '<=', sql<Date>`now()`)]),
      ]),
    )
    .orderBy('run_after', 'asc')
    .orderBy('created_at', 'asc')
    .limit(1)
    .forUpdate()
    .skipLocked();

  // A paired device may only see its own workspace's work.
  if (workspaceId !== null) query = query.where('workspace_id', '=', workspaceId);

  const row = await query.executeTakeFirst();
  return (row as TaskRow | undefined) ?? null;
}

/** Only files declared as inputs of this task are ever exposed to a worker. */
async function loadInputFiles(trx: DbExecutor, task: TaskRow): Promise<TaskInputFile[]> {
  if (task.input_file_ids.length === 0) return [];
  const rows = await trx
    .selectFrom('files')
    .selectAll()
    .where('workspace_id', '=', task.workspace_id)
    .where('id', 'in', task.input_file_ids)
    .execute();
  return rows.map((row) => ({
    file_id: row.id,
    purpose: row.purpose,
    original_name: row.original_name,
    mime: row.mime,
    bytes: Number(row.bytes),
    sha256: row.sha256,
  }));
}

/**
 * Loads a task by id and verifies the presented lease token.
 *
 * Returns 404 when the task does not exist (so a worker cannot enumerate task
 * ids) and 409 when the lease is stale or wrong — the case AT18 exercises
 * after a reclaim.
 */
/**
 * Loads a task and proves the caller still holds its lease, locking the row
 * for the rest of the transaction. Every worker-facing write goes through
 * this: a reclaimed worker's stale token gets a 409 and no domain effect.
 */
export async function lockLeasedTask(
  trx: DbTransaction,
  taskId: string,
  leaseToken: string,
): Promise<TaskRow> {
  const row = (await trx
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', taskId)
    .forUpdate()
    .executeTakeFirst()) as TaskRow | undefined;

  if (!row) throw notFound('No such task.');
  if (row.state !== 'leased' || row.lease_token_hash === null) {
    throw conflict('This task is not currently leased.');
  }
  if (row.lease_token_hash !== sha256Hex(leaseToken)) {
    // The lease was reclaimed and reissued: the old worker must stop. No
    // domain effect whatsoever (AT18).
    throw conflict('The lease token is stale; this task was reclaimed by another worker.');
  }
  if (row.lease_expires_at !== null && row.lease_expires_at.getTime() <= Date.now()) {
    throw conflict('The lease has expired.');
  }
  return row;
}

export interface HeartbeatResult {
  readonly cancel_requested: boolean;
  readonly lease_expires_at: string;
}

export async function heartbeatTask(
  db: Db,
  taskId: string,
  leaseToken: string,
  progress: TaskProgress | undefined,
): Promise<HeartbeatResult> {
  return db.transaction().execute(async (trx) => {
    const task = await lockLeasedTask(trx, taskId, leaseToken);
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    await trx
      .updateTable('tasks')
      .set({
        lease_expires_at: leaseExpiresAt,
        last_heartbeat_at: new Date(),
        progress: progress ? JSON.stringify(progress) : task.progress === null ? null : undefined,
        updated_at: new Date(),
      })
      .where('id', '=', task.id)
      .execute();

    return {
      cancel_requested: task.cancel_requested,
      lease_expires_at: leaseExpiresAt.toISOString(),
    };
  });
}

export interface CompleteResult {
  readonly task: TaskRow;
  /** False when the result failed contract validation and the task was failed. */
  readonly accepted: boolean;
}

/**
 * Applies a worker result.
 *
 * The lease check, the closed-schema validation of `result` and the state
 * transition all happen in one transaction, so a malformed result can never
 * reach domain state (04_API_CONTRACTS.md: "Domain transitions occur only
 * after API validation, ownership checks, revision checks and task lease
 * checks in one transaction").
 */
export async function completeTask(
  db: Db,
  taskId: string,
  leaseToken: string,
  result: unknown,
): Promise<CompleteResult> {
  return db.transaction().execute(async (trx) => {
    const task = await lockLeasedTask(trx, taskId, leaseToken);
    const io = TASK_IO_SCHEMAS[task.type];

    if (!io) {
      const failed = await failTaskRow(trx, task, {
        code: 'UNSUPPORTED_TASK_TYPE',
        message: `No output schema is registered for task type "${task.type}".`,
        retryable: false,
      });
      return { task: failed, accepted: false };
    }

    const check = checkSchema(io.output, result);
    if (!check.ok) {
      // Failing the task is the honest outcome: storing an unvalidated result
      // would let invalid model output become domain truth (invariant 9).
      const failed = await failTaskRow(trx, task, {
        code: 'PROVIDER_INVALID_OUTPUT',
        message: `The result does not match the ${task.type} output schema.`,
        retryable: false,
        fields: check.fields,
      });
      return { task: failed, accepted: false };
    }

    // Artifacts uploaded under this exact lease become permanent; anything
    // staged by a previous, reclaimed lease stays staging and is swept.
    const artifacts = await trx
      .selectFrom('task_artifacts')
      .select(['id', 'file_id'])
      .where('task_id', '=', task.id)
      .where('workspace_id', '=', task.workspace_id)
      .where('lease_token_hash', '=', sha256Hex(leaseToken))
      .execute();

    if (artifacts.length > 0) {
      await trx
        .updateTable('task_artifacts')
        .set({ committed: true, updated_at: new Date() })
        .where(
          'id',
          'in',
          artifacts.map((artifact) => artifact.id),
        )
        .execute();
      await trx
        .updateTable('files')
        .set({ state: 'ready', expires_at: null, updated_at: new Date() })
        .where('workspace_id', '=', task.workspace_id)
        .where(
          'id',
          'in',
          artifacts.map((artifact) => artifact.file_id),
        )
        .execute();
    }

    const updated = (await trx
      .updateTable('tasks')
      .set({
        state: 'succeeded',
        result: JSON.stringify(result),
        progress: JSON.stringify({ stage: 'complete', percent: 100 }),
        lease_token_hash: null,
        lease_expires_at: null,
        leased_by: null,
        error_code: null,
        error_message: null,
        error_retryable: null,
        updated_at: new Date(),
      })
      .where('id', '=', task.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as TaskRow;

    await applyDomainResult(trx, updated, result);

    await trx
      .insertInto('audit_events')
      .values({
        workspace_id: task.workspace_id,
        action: 'task.succeeded',
        object_id: task.id,
        object_type: 'task',
        // Redacted metadata only: no result contents.
        metadata: JSON.stringify({ type: task.type, attempt: task.attempt }),
      })
      .execute();

    return { task: updated, accepted: true };
  });
}

interface FailInput {
  readonly code: TaskFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly fields?: Record<string, string>;
}

/** Terminal failure of an already-locked row. */
async function failTaskRow(trx: DbTransaction, task: TaskRow, input: FailInput): Promise<TaskRow> {
  const row = (await trx
    .updateTable('tasks')
    .set({
      state: 'failed',
      lease_token_hash: null,
      lease_expires_at: null,
      leased_by: null,
      error_code: input.code,
      error_message: truncateMessage(input.message),
      error_retryable: false,
      updated_at: new Date(),
    })
    .where('id', '=', task.id)
    .returningAll()
    .executeTakeFirstOrThrow()) as TaskRow;

  // Without this, an import whose task failed would sit at "queued" forever
  // while the task row said "failed" — a dead end rather than an error.
  await applyDomainFailure(trx, row, input.code, input.message);
  return row;
}

function truncateMessage(message: string): string {
  return message.length > 2000 ? `${message.slice(0, 1997)}...` : message;
}

export interface FailTaskInput {
  readonly code: TaskFailureCode;
  readonly retryable: boolean;
  readonly redactedMessage: string;
  /** Parsed `Retry-After` header, in milliseconds, if the worker sent one. */
  readonly retryAfterMs?: number;
  readonly random?: () => number;
}

/**
 * Records a worker failure and decides — server-side — whether to retry.
 *
 * A retry re-queues the row with `run_after` in the future; `attempt` is not
 * touched here because it was already incremented when the lease was granted,
 * so the count reflects claims actually made.
 */
export async function failTask(
  db: Db,
  taskId: string,
  leaseToken: string,
  input: FailTaskInput,
): Promise<TaskRow> {
  return db.transaction().execute(async (trx) => {
    const task = await lockLeasedTask(trx, taskId, leaseToken);

    const retry =
      !task.cancel_requested &&
      isRetryableFailure(task.type, input.code, input.retryable, task.attempt, task.max_attempts);

    if (!retry) {
      if (task.cancel_requested) {
        return (await trx
          .updateTable('tasks')
          .set({
            state: 'cancelled',
            lease_token_hash: null,
            lease_expires_at: null,
            leased_by: null,
            error_code: input.code,
            error_message: truncateMessage(input.redactedMessage),
            error_retryable: false,
            updated_at: new Date(),
          })
          .where('id', '=', task.id)
          .returningAll()
          .executeTakeFirstOrThrow()) as TaskRow;
      }
      return failTaskRow(trx, task, {
        code: input.code,
        message: input.redactedMessage,
        retryable: false,
      });
    }

    const backoff = backoffMs(task.attempt, input.random);
    // A 429 from a job board or provider carries authoritative timing; never
    // retry sooner than it asked (02_ARCHITECTURE.md).
    const delay =
      input.code === 'RATE_LIMITED' && input.retryAfterMs !== undefined
        ? Math.max(backoff, input.retryAfterMs)
        : backoff;

    return (await trx
      .updateTable('tasks')
      .set({
        state: 'queued',
        run_after: new Date(Date.now() + delay),
        lease_token_hash: null,
        lease_expires_at: null,
        leased_by: null,
        error_code: input.code,
        error_message: truncateMessage(input.redactedMessage),
        error_retryable: true,
        updated_at: new Date(),
      })
      .where('id', '=', task.id)
      .returningAll()
      .executeTakeFirstOrThrow()) as TaskRow;
  });
}

/**
 * User-requested cancellation.
 *
 * A queued task is cancelled immediately because nothing is running. A leased
 * task only gets the flag: the worker learns about it at its next heartbeat
 * and stops at a safe checkpoint, which matters because a half-completed
 * browser fill must not be abandoned mid-form.
 */
export async function cancelTask(db: Db, workspaceId: string, taskId: string): Promise<TaskRow> {
  return db.transaction().execute(async (trx) => {
    const row = (await trx
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', taskId)
      .where('workspace_id', '=', workspaceId)
      .forUpdate()
      .executeTakeFirst()) as TaskRow | undefined;

    if (!row) throw notFound('No such task.');

    if (row.state === 'queued') {
      return (await trx
        .updateTable('tasks')
        .set({ state: 'cancelled', cancel_requested: true, updated_at: new Date() })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as TaskRow;
    }

    if (row.state === 'leased') {
      return (await trx
        .updateTable('tasks')
        .set({ cancel_requested: true, updated_at: new Date() })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow()) as TaskRow;
    }

    // Already terminal: cancellation is a no-op, reported truthfully.
    return row;
  });
}

/**
 * Housekeeping sweep for leases whose worker never came back.
 *
 * Claiming already handles expired leases opportunistically; this exists so a
 * queue with no active workers still converges (a task stuck in `leased`
 * forever would silently never fail). Safe in several replicas because the
 * candidate selection uses `FOR UPDATE SKIP LOCKED`.
 */
export async function reclaimExpiredLeases(
  db: Db,
  limit = 100,
): Promise<{ requeued: string[]; failed: string[] }> {
  return db.transaction().execute(async (trx) => {
    const expired = (await trx
      .selectFrom('tasks')
      .selectAll()
      .where('state', '=', 'leased')
      .where('lease_expires_at', '<=', sql<Date>`now()`)
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute()) as TaskRow[];

    const requeued: string[] = [];
    const failed: string[] = [];

    for (const task of expired) {
      const exhausted = task.attempt >= task.max_attempts;
      const neverRetry = NO_RETRY.has(task.type);
      if (exhausted || neverRetry || task.cancel_requested) {
        const message = neverRetry
          ? 'The lease expired and this task type is never retried automatically.'
          : 'The lease expired and no retry attempts remain.';
        await trx
          .updateTable('tasks')
          .set({
            state: task.cancel_requested ? 'cancelled' : 'failed',
            lease_token_hash: null,
            lease_expires_at: null,
            leased_by: null,
            error_code: 'TIMEOUT',
            error_message: message,
            error_retryable: false,
            updated_at: new Date(),
          })
          .where('id', '=', task.id)
          .execute();
        // The domain row must not be left mid-flight while the task is
        // terminal; the sweep is the only path that reaches some tasks.
        await applyDomainFailure(
          trx,
          task,
          task.cancel_requested ? 'CANCELLED' : 'TIMEOUT',
          message,
        );
        failed.push(task.id);
        continue;
      }

      await trx
        .updateTable('tasks')
        .set({
          state: 'queued',
          run_after: new Date(Date.now() + backoffMs(task.attempt)),
          lease_token_hash: null,
          lease_expires_at: null,
          leased_by: null,
          error_code: 'TIMEOUT',
          error_message: 'The worker stopped heartbeating; the task was returned to the queue.',
          error_retryable: true,
          updated_at: new Date(),
        })
        .where('id', '=', task.id)
        .execute();
      requeued.push(task.id);
    }

    return { requeued, failed };
  });
}

/** Records that a worker polled, so `GET /me` can report `worker_online`. */
export async function recordWorkerSeen(
  db: DbExecutor,
  input: {
    workerId: string;
    kind: 'worker' | 'device';
    capabilities: readonly string[];
    protocolVersion: number;
    workspaceId?: string | null;
  },
): Promise<void> {
  await db
    .insertInto('worker_registrations')
    .values({
      worker_id: input.workerId,
      workspace_id: input.workspaceId ?? null,
      kind: input.kind,
      capabilities: JSON.stringify([...input.capabilities]),
      protocol_version: input.protocolVersion,
      last_seen_at: new Date(),
    })
    .onConflict((conflictBuilder) =>
      conflictBuilder.column('worker_id').doUpdateSet({
        capabilities: JSON.stringify([...input.capabilities]),
        protocol_version: input.protocolVersion,
        workspace_id: input.workspaceId ?? null,
        kind: input.kind,
        last_seen_at: new Date(),
        updated_at: new Date(),
      }),
    )
    .execute();
}

/** A worker counts as online if it polled within three heartbeat intervals. */
export const WORKER_ONLINE_WINDOW_MS = 90_000;

export async function isWorkerOnline(db: DbExecutor): Promise<boolean> {
  const row = await db
    .selectFrom('worker_registrations')
    .select('worker_id')
    .where('last_seen_at', '>', new Date(Date.now() - WORKER_ONLINE_WINDOW_MS))
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Serves a declared input file to the worker holding the active lease.
 *
 * Anything not listed in `tasks.input_file_ids` is reported as absent, even
 * when it exists in the same workspace: the worker's reach is the task, not
 * the workspace (04_API_CONTRACTS.md).
 */
export async function authorizeTaskFile(
  db: Db,
  taskId: string,
  fileId: string,
  leaseToken: string,
): Promise<{ workspaceId: string; storageKey: string; originalName: string; mime: string }> {
  const task = (await db
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', taskId)
    .executeTakeFirst()) as TaskRow | undefined;

  if (!task) throw notFound('No such task.');
  if (task.state !== 'leased' || task.lease_token_hash !== sha256Hex(leaseToken)) {
    throw conflict('The lease token is not valid for this task.');
  }
  if (!task.input_file_ids.includes(fileId)) {
    throw notFound('This file is not an input of the task.');
  }

  const file = await db
    .selectFrom('files')
    .select(['storage_key', 'original_name', 'mime'])
    .where('id', '=', fileId)
    .where('workspace_id', '=', task.workspace_id)
    .executeTakeFirst();

  if (!file) throw notFound('No such file.');
  return {
    workspaceId: task.workspace_id,
    storageKey: file.storage_key,
    originalName: file.original_name,
    mime: file.mime,
  };
}

/** Verifies the lease before an artifact upload and returns the task row. */
export async function authorizeArtifactUpload(
  db: Db,
  taskId: string,
  leaseToken: string,
): Promise<TaskRow> {
  const task = (await db
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', taskId)
    .executeTakeFirst()) as TaskRow | undefined;

  if (!task) throw notFound('No such task.');
  if (task.state !== 'leased' || task.lease_token_hash !== sha256Hex(leaseToken)) {
    throw conflict('The lease token is not valid for this task.');
  }
  if (task.lease_expires_at !== null && task.lease_expires_at.getTime() <= Date.now()) {
    throw conflict('The lease has expired.');
  }
  return task;
}

export function assertKnownTaskType(type: string): asserts type is TaskType {
  if (!TASK_IO_SCHEMAS[type]) {
    throw unprocessable(`Unknown or unimplemented task type "${type}".`);
  }
}

export function assertSessionPrincipal(
  principal: Principal | null,
): asserts principal is Principal {
  if (principal === null) throw forbidden('A session is required.');
}

export { DEFAULT_MAX_ATTEMPTS, PROTOCOL_VERSION };
