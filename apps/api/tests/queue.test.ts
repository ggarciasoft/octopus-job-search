/**
 * The PostgreSQL-backed queue: AT18, concurrency, capability authorization,
 * server-decided retry, result validation and internal-route authentication.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MAX_ATTEMPTS,
  LEASE_SECONDS,
  NO_RETRY_TASK_TYPES,
  PROTOCOL_VERSION,
  type ClaimResponse,
  type TaskType,
} from '@job-getter/contracts';
import { backoffMs, isRetryableFailure, claimTask } from '../src/tasks/queue.js';
import { reclaimExpiredLeases } from '../src/tasks/queue.js';
import {
  TEST_ORIGIN,
  TEST_WORKER_TOKEN,
  asWorker,
  authed,
  completeSetup,
  createHarness,
  idempotencyKey,
  type Harness,
  type Session,
} from './helpers/harness.js';

let harness: Harness;
let session: Session;

beforeAll(async () => {
  harness = await createHarness();
}, 180_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  session = await completeSetup(harness);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function queueEcho(message = 'hello world'): Promise<string> {
  const response = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/diagnostics/echo',
      headers: { 'idempotency-key': idempotencyKey() },
      payload: { message },
    }),
  );
  expect(response.statusCode).toBe(202);
  return response.json().task_id as string;
}

/** Inserts a task of a type M0 does not enqueue itself (M4/M5 capabilities). */
async function insertRawTask(
  type: TaskType,
  overrides: { workspaceId?: string; maxAttempts?: number } = {},
): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO tasks (workspace_id, type, capability, max_attempts, payload)
     VALUES ($1, $2, $2, $3, '{}'::jsonb) RETURNING id`,
    [
      overrides.workspaceId ?? session.workspaceId,
      type,
      overrides.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    ],
  );
  return result.rows[0]!.id;
}

async function claim(
  capabilities: TaskType[] = ['noop_echo'],
  workerId = 'worker-1',
): Promise<ClaimResponse | null> {
  const response = await harness.app.inject(
    asWorker({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: { worker_id: workerId, capabilities, protocol_version: PROTOCOL_VERSION },
    }),
  );
  if (response.statusCode === 204) return null;
  expect(response.statusCode).toBe(200);
  return response.json() as ClaimResponse;
}

function validResult(workerId = 'worker-1') {
  return {
    echoed: 'hello world',
    worker_id: workerId,
    worker_runtime: 'python-3.12',
    processed_at: new Date().toISOString(),
  };
}

async function expireLease(taskId: string): Promise<void> {
  await harness.pool.query(
    `UPDATE tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
    [taskId],
  );
}

async function taskRow(taskId: string) {
  return harness.db
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
}

// ---------------------------------------------------------------------------

describe('enqueue and claim', () => {
  it('enqueues the diagnostic probe as a queued noop_echo task', async () => {
    const taskId = await queueEcho('probe');
    const row = await taskRow(taskId);

    expect(row.state).toBe('queued');
    expect(row.type).toBe('noop_echo');
    expect(row.attempt).toBe(0);
    expect(row.max_attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(row.lease_token_hash).toBeNull();
    expect(row.payload).toEqual({ message: 'probe' });

    // The audit row is committed in the same transaction as the task.
    const audit = await harness.db
      .selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'diagnostics.echo_queued')
      .executeTakeFirstOrThrow();
    expect(audit.object_id).toBe(taskId);
    // Redacted metadata only: the message itself is not copied in.
    expect(JSON.stringify(audit.metadata)).not.toContain('probe');
  });

  it('rejects a payload that violates the contract input schema', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/diagnostics/echo',
        headers: { 'idempotency-key': idempotencyKey() },
        payload: { message: '', delay_ms: 99_999_999 },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('leases exactly one task and issues a fresh token, storing only its hash', async () => {
    const taskId = await queueEcho();
    const claimed = await claim();

    expect(claimed).not.toBeNull();
    expect(claimed!.task_id).toBe(taskId);
    expect(claimed!.lease_token.length).toBeGreaterThanOrEqual(32);
    expect(claimed!.attempt).toBe(1);
    expect(claimed!.input).toEqual({ message: 'hello world' });
    expect(claimed!.files).toEqual([]);

    const row = await taskRow(taskId);
    expect(row.state).toBe('leased');
    expect(row.lease_token_hash).not.toBeNull();
    // The raw token is never stored.
    expect(row.lease_token_hash).not.toBe(claimed!.lease_token);

    const leaseSeconds = Math.round(
      (new Date(claimed!.lease_expires_at).getTime() - Date.now()) / 1000,
    );
    expect(leaseSeconds).toBeGreaterThan(LEASE_SECONDS - 10);
    expect(leaseSeconds).toBeLessThanOrEqual(LEASE_SECONDS);
  });

  it('returns 204 when nothing matches', async () => {
    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'idle',
          capabilities: ['noop_echo'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('does not hand out a task scheduled for the future', async () => {
    const taskId = await queueEcho();
    await harness.pool.query(
      `UPDATE tasks SET run_after = now() + interval '1 hour' WHERE id = $1`,
      [taskId],
    );
    expect(await claim()).toBeNull();
  });

  it('rejects an incompatible protocol version', async () => {
    await queueEcho();
    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: { worker_id: 'old', capabilities: ['noop_echo'], protocol_version: 99 },
      }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain(String(PROTOCOL_VERSION));

    // The task was not touched.
    const rows = await harness.db.selectFrom('tasks').selectAll().execute();
    expect(rows[0]!.state).toBe('queued');
  });

  it('filters by declared capability', async () => {
    const echoId = await queueEcho();
    await insertRawTask('parse_profile');

    const claimed = await claim(['noop_echo']);
    expect(claimed!.task_id).toBe(echoId);

    // A worker that declares neither gets nothing.
    expect(await claim(['match_job'], 'worker-2')).toBeNull();
  });

  it('never hands the same task to two workers under concurrent claims', async () => {
    const taskIds = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      taskIds.add(await queueEcho(`message ${index}`));
    }

    const claims = await Promise.all(
      Array.from({ length: 8 }, (_unused, index) => claim(['noop_echo'], `worker-${index}`)),
    );

    const granted = claims.filter((value): value is ClaimResponse => value !== null);
    expect(granted).toHaveLength(8);

    const grantedIds = granted.map((value) => value.task_id);
    expect(new Set(grantedIds).size).toBe(8);
    expect(new Set(grantedIds)).toEqual(taskIds);

    // Every lease token is distinct too.
    expect(new Set(granted.map((value) => value.lease_token)).size).toBe(8);
  });

  it('hands out at most as many tasks as exist', async () => {
    await queueEcho('only one');
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) => claim(['noop_echo'], `worker-${index}`)),
    );
    expect(claims.filter((value) => value !== null)).toHaveLength(1);
  });
});

describe('runner-only capabilities (02_ARCHITECTURE.md, ADR05)', () => {
  it('refuses fill_local to a general operator worker credential', async () => {
    await insertRawTask('fill_local');

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'container-worker',
          capabilities: ['fill_local'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('fill_local');

    const rows = await harness.db.selectFrom('tasks').selectAll().execute();
    expect(rows[0]!.state).toBe('queued');
  });

  it('refuses a mixed capability list that smuggles fill_local in', async () => {
    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'container-worker',
          capabilities: ['noop_echo', 'fill_local'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    expect(response.statusCode).toBe(403);
  });

  it('leaves a fill_local task untouched for a worker that asks only for noop_echo', async () => {
    const fillId = await insertRawTask('fill_local');
    expect(await claim(['noop_echo'])).toBeNull();
    expect((await taskRow(fillId)).state).toBe('queued');
  });

  it('lets a paired device claim only its own workspace fill_local work', async () => {
    // Device pairing is M4/M5 and no device token can be issued yet, so the
    // authorization rule is exercised directly against the queue layer.
    const mine = await insertRawTask('fill_local');

    const otherWorkspace = await harness.pool.query<{ id: string }>(
      `INSERT INTO workspaces (owner_user_id, mode)
       SELECT id, 'local' FROM users LIMIT 1 RETURNING id`,
    );
    const theirs = await insertRawTask('fill_local', {
      workspaceId: otherWorkspace.rows[0]!.id,
    });

    const device = {
      kind: 'device' as const,
      deviceId: randomUUID(),
      workspaceId: session.workspaceId,
    };

    const first = await claimTask(harness.db, {
      principal: device,
      workerId: 'local-runner',
      capabilities: ['fill_local'],
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(first?.task_id).toBe(mine);

    // The other workspace's fill_local is invisible to this device.
    const second = await claimTask(harness.db, {
      principal: device,
      workerId: 'local-runner',
      capabilities: ['fill_local'],
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(second).toBeNull();
    expect((await taskRow(theirs)).state).toBe('queued');
  });

  it('refuses a device that asks for general processing capabilities', async () => {
    await expect(
      claimTask(harness.db, {
        principal: { kind: 'device', deviceId: randomUUID(), workspaceId: session.workspaceId },
        workerId: 'local-runner',
        capabilities: ['parse_profile'],
        protocolVersion: PROTOCOL_VERSION,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('heartbeat', () => {
  it('extends the lease and reports cancellation state', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/heartbeat`,
        payload: { lease_token: claimed.lease_token, progress: { stage: 'parsing', percent: 40 } },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().cancel_requested).toBe(false);
    expect(new Date(response.json().lease_expires_at).getTime()).toBeGreaterThanOrEqual(
      new Date(claimed.lease_expires_at).getTime(),
    );

    const row = await taskRow(taskId);
    expect(row.progress).toEqual({ stage: 'parsing', percent: 40 });
  });

  it('rejects a heartbeat with the wrong lease token', async () => {
    const taskId = await queueEcho();
    await claim();

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/heartbeat`,
        payload: { lease_token: 'b'.repeat(43) },
      }),
    );
    expect(response.statusCode).toBe(409);
  });

  it('surfaces a cancellation request at the next heartbeat', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    const cancel = await harness.app.inject(
      authed(session, { method: 'POST', url: `/api/v1/tasks/${taskId}/cancel`, payload: {} }),
    );
    expect(cancel.statusCode).toBe(200);
    // A leased task is not killed mid-flight; it is flagged.
    expect(cancel.json().state).toBe('leased');
    expect(cancel.json().cancel_requested).toBe(true);

    const heartbeat = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/heartbeat`,
        payload: { lease_token: claimed.lease_token },
      }),
    );
    expect(heartbeat.json().cancel_requested).toBe(true);
  });

  it('cancels a queued task immediately', async () => {
    const taskId = await queueEcho();
    const response = await harness.app.inject(
      authed(session, { method: 'POST', url: `/api/v1/tasks/${taskId}/cancel`, payload: {} }),
    );
    expect(response.json().state).toBe('cancelled');
    expect(await claim()).toBeNull();
  });
});

describe('complete', () => {
  it('stores a valid result and marks the task succeeded', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: claimed.lease_token,
          result_schema_version: 1,
          result: validResult(),
        },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task_id: taskId, state: 'succeeded' });

    const row = await taskRow(taskId);
    expect(row.state).toBe('succeeded');
    expect(row.lease_token_hash).toBeNull();
    expect((row.result as { echoed: string }).echoed).toBe('hello world');
  });

  it('fails the task instead of storing a result that violates the output schema', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: claimed.lease_token,
          result_schema_version: 1,
          // `worker_runtime` is missing and an extra key is present.
          result: {
            echoed: 'hi',
            worker_id: 'w',
            processed_at: new Date().toISOString(),
            extra: 1,
          },
        },
      }),
    );
    expect(response.statusCode).toBe(422);

    const row = await taskRow(taskId);
    expect(row.state).toBe('failed');
    // Crucially, the garbage was not stored.
    expect(row.result).toBeNull();
    expect(row.error_code).toBe('PROVIDER_INVALID_OUTPUT');
    expect(row.error_retryable).toBe(false);
  });

  it('rejects a non-UTC timestamp in a result', async () => {
    // The contract's date-time format accepts only Z or +00:00, because the
    // data model stores timestamptz in UTC.
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: claimed.lease_token,
          result_schema_version: 1,
          result: { ...validResult(), processed_at: '2026-03-01T12:00:00+02:00' },
        },
      }),
    );
    expect(response.statusCode).toBe(422);
    expect((await taskRow(taskId)).result).toBeNull();
  });

  it('rejects an unsupported result_schema_version without touching the task', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: claimed.lease_token,
          result_schema_version: 7,
          result: validResult(),
        },
      }),
    );
    expect(response.statusCode).toBe(422);
    expect((await taskRow(taskId)).state).toBe('leased');
  });

  it('returns 404 for a task that does not exist', async () => {
    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${randomUUID()}/complete`,
        payload: { lease_token: 'c'.repeat(43), result_schema_version: 1, result: validResult() },
      }),
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('AT18 — worker crash, reclaim and stale lease', () => {
  it('reclaims an expired lease, rejects the stale token and commits exactly one result', async () => {
    const taskId = await queueEcho('at18');
    const first = (await claim(['noop_echo'], 'worker-a'))!;
    expect(first.attempt).toBe(1);

    // The worker "crashes": it stops heartbeating and the lease expires.
    await expireLease(taskId);

    // A second worker reclaims the same task and receives a *new* token.
    const second = (await claim(['noop_echo'], 'worker-b'))!;
    expect(second.task_id).toBe(taskId);
    expect(second.attempt).toBe(2);
    expect(second.lease_token).not.toBe(first.lease_token);

    // The first worker wakes up and tries to commit. It must be refused with
    // 409 and must have no domain effect whatsoever.
    const stale = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: first.lease_token,
          result_schema_version: 1,
          result: { ...validResult('worker-a'), echoed: 'stale result' },
        },
      }),
    );
    expect(stale.statusCode).toBe(409);

    const afterStale = await taskRow(taskId);
    expect(afterStale.state).toBe('leased');
    expect(afterStale.result).toBeNull();

    // The holder of the current lease commits successfully.
    const fresh = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: second.lease_token,
          result_schema_version: 1,
          result: { ...validResult('worker-b'), echoed: 'fresh result' },
        },
      }),
    );
    expect(fresh.statusCode).toBe(200);

    const final = await taskRow(taskId);
    expect(final.state).toBe('succeeded');
    expect((final.result as { echoed: string }).echoed).toBe('fresh result');

    // Exactly one committed result: replaying the winning token is also
    // refused, because the lease was cleared on success.
    const replay = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: second.lease_token,
          result_schema_version: 1,
          result: validResult('worker-b'),
        },
      }),
    );
    expect(replay.statusCode).toBe(409);
    expect((await taskRow(taskId)).state).toBe('succeeded');

    const successEvents = await harness.db
      .selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'task.succeeded')
      .execute();
    expect(successEvents).toHaveLength(1);
  });

  it('rejects a stale heartbeat and a stale fail as well', async () => {
    const taskId = await queueEcho();
    const first = (await claim(['noop_echo'], 'worker-a'))!;
    await expireLease(taskId);
    await claim(['noop_echo'], 'worker-b');

    const heartbeat = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/heartbeat`,
        payload: { lease_token: first.lease_token },
      }),
    );
    expect(heartbeat.statusCode).toBe(409);

    const fail = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        payload: {
          lease_token: first.lease_token,
          code: 'INTERNAL_ERROR',
          retryable: true,
          redacted_message: 'stale worker',
        },
      }),
    );
    expect(fail.statusCode).toBe(409);
    expect((await taskRow(taskId)).state).toBe('leased');
  });

  it('the scheduler sweep requeues an abandoned lease even with no workers polling', async () => {
    const taskId = await queueEcho();
    await claim();
    await expireLease(taskId);

    const result = await reclaimExpiredLeases(harness.db);
    expect(result.requeued).toContain(taskId);

    const row = await taskRow(taskId);
    expect(row.state).toBe('queued');
    expect(row.lease_token_hash).toBeNull();
    expect(row.error_code).toBe('TIMEOUT');
  });

  it('fails rather than re-leasing when the retry budget is already spent', async () => {
    const taskId = await queueEcho();
    await harness.pool.query(`UPDATE tasks SET max_attempts = 1 WHERE id = $1`, [taskId]);

    await claim();
    await expireLease(taskId);

    const result = await reclaimExpiredLeases(harness.db);
    expect(result.failed).toContain(taskId);
    const row = await taskRow(taskId);
    expect(row.state).toBe('failed');
    expect(row.error_retryable).toBe(false);
  });
});

describe('failure handling — the server decides retryability', () => {
  it('re-queues with a future run_after and increments attempt across claims', async () => {
    const taskId = await queueEcho();
    const first = (await claim())!;
    expect(first.attempt).toBe(1);

    const failed = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        payload: {
          lease_token: first.lease_token,
          code: 'PROVIDER_UNAVAILABLE',
          retryable: true,
          redacted_message: 'provider refused the connection',
        },
      }),
    );
    expect(failed.statusCode).toBe(200);
    expect(failed.json().state).toBe('queued');

    const row = await taskRow(taskId);
    expect(row.state).toBe('queued');
    expect(row.attempt).toBe(1);
    expect(row.error_retryable).toBe(true);
    expect(row.run_after.getTime()).toBeGreaterThan(Date.now());

    // Once the backoff elapses the next claim is attempt 2.
    await harness.pool.query(`UPDATE tasks SET run_after = now() WHERE id = $1`, [taskId]);
    const second = (await claim())!;
    expect(second.attempt).toBe(2);
  });

  it('marks the task failed when max_attempts is exhausted', async () => {
    const taskId = await queueEcho();

    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
      await harness.pool.query(`UPDATE tasks SET run_after = now() WHERE id = $1`, [taskId]);
      const claimed = (await claim())!;
      expect(claimed.attempt).toBe(attempt);

      await harness.app.inject(
        asWorker({
          method: 'POST',
          url: `/internal/v1/tasks/${taskId}/fail`,
          payload: {
            lease_token: claimed.lease_token,
            code: 'TIMEOUT',
            retryable: true,
            redacted_message: 'timed out',
          },
        }),
      );
    }

    const row = await taskRow(taskId);
    expect(row.attempt).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(row.state).toBe('failed');
    expect(row.error_retryable).toBe(false);
  });

  it('never retries a NO_RETRY_TASK_TYPES task, even when the worker asks', async () => {
    expect(NO_RETRY_TASK_TYPES).toContain('fill_local');
    const taskId = await insertRawTask('fill_local');

    const claimed = await claimTask(harness.db, {
      principal: { kind: 'device', deviceId: randomUUID(), workspaceId: session.workspaceId },
      workerId: 'local-runner',
      capabilities: ['fill_local'],
      protocolVersion: PROTOCOL_VERSION,
    });

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        payload: {
          lease_token: claimed!.lease_token,
          code: 'TIMEOUT',
          retryable: true,
          redacted_message: 'the page changed',
        },
      }),
    );
    expect(response.json().state).toBe('failed');

    const row = await taskRow(taskId);
    // Browser filling is never blindly retried: the page may have changed.
    expect(row.attempt).toBe(1);
    expect(row.state).toBe('failed');
    expect(row.error_retryable).toBe(false);
  });

  it('does not retry a permanently invalid input even when the worker says retryable', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        payload: {
          lease_token: claimed.lease_token,
          code: 'ENCRYPTED_DOCUMENT',
          retryable: true,
          redacted_message: 'the document is password protected',
        },
      }),
    );
    expect((await taskRow(taskId)).state).toBe('failed');
  });

  it('honours a Retry-After hint on a rate-limit failure', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;

    await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        headers: { 'retry-after': '300' },
        payload: {
          lease_token: claimed.lease_token,
          code: 'RATE_LIMITED',
          retryable: true,
          redacted_message: 'the board returned 429',
        },
      }),
    );

    const row = await taskRow(taskId);
    expect(row.state).toBe('queued');
    // Never sooner than the server asked us to wait.
    expect(row.run_after.getTime() - Date.now()).toBeGreaterThan(290_000);
  });

  it('cancels rather than retries when cancellation was requested', async () => {
    const taskId = await queueEcho();
    const claimed = (await claim())!;
    await harness.app.inject(
      authed(session, { method: 'POST', url: `/api/v1/tasks/${taskId}/cancel`, payload: {} }),
    );

    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/fail`,
        payload: {
          lease_token: claimed.lease_token,
          code: 'CANCELLED',
          retryable: false,
          redacted_message: 'stopped at checkpoint',
        },
      }),
    );
    expect(response.json().state).toBe('cancelled');
  });
});

describe('backoff', () => {
  it('grows exponentially and stays within the jitter band', () => {
    for (const attempt of [1, 2, 3, 4]) {
      const low = backoffMs(attempt, () => 0);
      const high = backoffMs(attempt, () => 1);
      const mid = backoffMs(attempt, () => 0.5);
      expect(low).toBeLessThanOrEqual(mid);
      expect(mid).toBeLessThanOrEqual(high);
    }
    expect(backoffMs(3, () => 0.5)).toBeGreaterThan(backoffMs(1, () => 0.5));
    // Bounded: a long outage must not schedule a retry days away.
    expect(backoffMs(40, () => 1)).toBeLessThanOrEqual(5 * 60 * 1000 * 1.25);
  });

  it('produces different delays for different random draws (jitter is real)', () => {
    const values = new Set([0.1, 0.4, 0.9].map((draw) => backoffMs(4, () => draw)));
    expect(values.size).toBeGreaterThan(1);
  });

  it('encodes the server-side retry policy', () => {
    expect(isRetryableFailure('noop_echo', 'TIMEOUT', true, 1, 3)).toBe(true);
    // Worker opinion can narrow but not widen.
    expect(isRetryableFailure('noop_echo', 'TIMEOUT', false, 1, 3)).toBe(false);
    expect(isRetryableFailure('noop_echo', 'INPUT_INVALID', true, 1, 3)).toBe(false);
    expect(isRetryableFailure('fill_local', 'TIMEOUT', true, 1, 3)).toBe(false);
    expect(isRetryableFailure('noop_echo', 'TIMEOUT', true, 3, 3)).toBe(false);
  });
});

describe('internal route authentication', () => {
  it('rejects a request with no bearer token', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: { worker_id: 'w', capabilities: ['noop_echo'], protocol_version: PROTOCOL_VERSION },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a wrong bearer token', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      headers: { authorization: 'Bearer not-the-worker-token-at-all-000000' },
      payload: { worker_id: 'w', capabilities: ['noop_echo'], protocol_version: PROTOCOL_VERSION },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not accept a user session cookie on an internal route', async () => {
    await queueEcho();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      headers: { cookie: session.cookie, origin: TEST_ORIGIN, 'x-csrf-token': session.csrfToken },
      payload: { worker_id: 'w', capabilities: ['noop_echo'], protocol_version: PROTOCOL_VERSION },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not accept the worker credential on a user route', async () => {
    const taskId = await queueEcho();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${TEST_WORKER_TOKEN}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('does not accept the worker credential on /me', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${TEST_WORKER_TOKEN}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('public task views', () => {
  it('exposes no lease internals', async () => {
    const taskId = await queueEcho();
    await claim();

    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: `/api/v1/tasks/${taskId}` }),
    );
    expect(response.statusCode).toBe(200);
    const body = response.body;
    expect(body).not.toContain('lease_token');
    expect(body).not.toContain('leased_by');
    expect(Object.keys(response.json()).sort()).toEqual(
      [
        'attempt',
        'cancel_requested',
        'created_at',
        'error',
        'id',
        'max_attempts',
        'progress',
        'result',
        'run_after',
        'state',
        'type',
        'updated_at',
      ].sort(),
    );
  });

  it('paginates the task list with a cursor', async () => {
    for (let index = 0; index < 5; index += 1) await queueEcho(`m${index}`);

    const first = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/tasks?limit=2' }),
    );
    expect(first.json().items).toHaveLength(2);
    expect(first.json().next_cursor).not.toBeNull();

    const second = await harness.app.inject(
      authed(session, {
        method: 'GET',
        url: `/api/v1/tasks?limit=2&cursor=${encodeURIComponent(first.json().next_cursor)}`,
      }),
    );
    expect(second.json().items).toHaveLength(2);

    const firstIds = first.json().items.map((item: { id: string }) => item.id);
    const secondIds = second.json().items.map((item: { id: string }) => item.id);
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
  });
});
