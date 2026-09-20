/**
 * Task enqueueing.
 *
 * 02_ARCHITECTURE.md step 2: "API commits domain mutation and task row in the
 * same PostgreSQL transaction." `enqueueTask` therefore requires a
 * `DbTransaction`, not a `Kysely` instance — calling it outside a transaction
 * is a compile error, not a code-review note.
 */
import { TASK_IO_SCHEMAS, DEFAULT_MAX_ATTEMPTS, type TaskType } from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import { unprocessable } from '../errors.js';
import { checkSchema } from '../validation.js';
import type { TaskRow } from '../db/types.js';

export interface EnqueueTaskInput {
  /** Always the server-resolved workspace, never a client-supplied value. */
  readonly workspaceId: string;
  readonly type: TaskType;
  /** Validated against `TASK_IO_SCHEMAS[type].input` before insertion. */
  readonly payload: unknown;
  readonly idempotencyKey?: string | null;
  readonly maxAttempts?: number;
  readonly runAfter?: Date;
  /**
   * Files the worker may download through the task-scoped endpoint. Anything
   * not listed here is unreachable for this task, even inside the workspace.
   */
  readonly inputFileIds?: readonly string[];
}

export class UnsupportedTaskTypeError extends Error {
  constructor(type: string) {
    super(
      `Task type "${type}" has no closed input/output schema, so it cannot be enqueued. ` +
        'Add it to TASK_IO_SCHEMAS in @job-getter/contracts first.',
    );
    this.name = 'UnsupportedTaskTypeError';
  }
}

/**
 * Inserts a queued task inside the caller's transaction.
 *
 * The payload is validated against the contract's closed input schema here, so
 * a worker never has to defend against a malformed task the API created.
 */
export async function enqueueTask(trx: DbTransaction, input: EnqueueTaskInput): Promise<TaskRow> {
  const io = TASK_IO_SCHEMAS[input.type];
  if (!io) throw new UnsupportedTaskTypeError(input.type);

  const check = checkSchema(io.input, input.payload);
  if (!check.ok) {
    throw unprocessable(
      `The ${input.type} payload does not match its contract schema.`,
      check.fields,
    );
  }

  const row = await trx
    .insertInto('tasks')
    .values({
      workspace_id: input.workspaceId,
      type: input.type,
      state: 'queued',
      payload: JSON.stringify(input.payload),
      idempotency_key: input.idempotencyKey ?? null,
      attempt: 0,
      max_attempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      run_after: input.runAfter ?? new Date(),
      // The capability a worker must declare. It equals the type today; the
      // column exists so a future type can require a narrower capability.
      capability: input.type,
      input_file_ids: [...(input.inputFileIds ?? [])],
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return row as TaskRow;
}
