/**
 * Idempotency-Key semantics from 04_API_CONTRACTS.md:
 *
 *   "Mutation Idempotency-Key is required for scan, generate, packet, fill and
 *    export commands; same key with different body returns 409. Store response
 *    for 24 hours; domain uniqueness remains after expiration."
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from '@job-getter/contracts';
import {
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

function echo(key: string | undefined, payload: Record<string, unknown>) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/diagnostics/echo',
      headers: key === undefined ? {} : { 'idempotency-key': key },
      payload,
    }),
  );
}

describe('Idempotency-Key', () => {
  it('is required on a route the contract flags', () => {
    const route = ROUTES.find((entry) => entry.operationId === 'createDiagnosticTask');
    expect(route?.requiresIdempotencyKey).toBe(true);
  });

  it('rejects a request that omits the header', async () => {
    const response = await echo(undefined, { message: 'no key' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.fields).toHaveProperty('idempotency-key');
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toEqual([]);
  });

  it('rejects a header that is too short to be meaningful', async () => {
    const response = await echo('x', { message: 'tiny key' });
    expect(response.statusCode).toBe(400);
  });

  it('replays the stored response for the same key and body', async () => {
    const key = idempotencyKey();
    const first = await echo(key, { message: 'replay me' });
    expect(first.statusCode).toBe(202);

    const second = await echo(key, { message: 'replay me' });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());

    // Exactly one task was created.
    const tasks = await harness.db.selectFrom('tasks').selectAll().execute();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe(first.json().task_id);
  });

  it('replays regardless of the key order within the body', async () => {
    const key = idempotencyKey();
    const first = await echo(key, { message: 'stable', delay_ms: 5 });
    const second = await echo(key, { delay_ms: 5, message: 'stable' });
    expect(second.json()).toEqual(first.json());
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toHaveLength(1);
  });

  it('returns 409 for the same key with a different body', async () => {
    const key = idempotencyKey();
    await echo(key, { message: 'first body' });

    const conflict = await echo(key, { message: 'different body' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_MISMATCH');
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toHaveLength(1);
  });

  it('keeps domain uniqueness after the 24-hour replay window expires', async () => {
    const key = idempotencyKey();
    const first = await echo(key, { message: 'long lived' });
    expect(first.statusCode).toBe(202);

    // Age the replay record past its window, as the scheduler's prune would.
    await harness.pool.query(
      `UPDATE idempotency_records SET expires_at = now() - interval '1 minute'`,
    );

    // The stored response is gone, so the handler runs again — and the unique
    // index on tasks (workspace_id, type, idempotency_key) stops the duplicate.
    const second = await echo(key, { message: 'long lived' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('CONFLICT');
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toHaveLength(1);
  });

  it('still refuses a duplicate after the replay record is deleted entirely', async () => {
    const key = idempotencyKey();
    await echo(key, { message: 'survivor' });
    await harness.pool.query('DELETE FROM idempotency_records');

    const second = await echo(key, { message: 'survivor' });
    expect(second.statusCode).toBe(409);
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toHaveLength(1);
  });

  it('treats distinct keys as distinct commands', async () => {
    const first = await echo(idempotencyKey(), { message: 'one' });
    const second = await echo(idempotencyKey(), { message: 'two' });
    expect(first.json().task_id).not.toBe(second.json().task_id);
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toHaveLength(2);
  });

  it('creates at most one task when the same key arrives concurrently', async () => {
    const key = idempotencyKey();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => echo(key, { message: 'race' })),
    );

    const accepted = responses.filter((response) => response.statusCode === 202);
    const rejected = responses.filter((response) => response.statusCode === 409);
    expect(accepted.length + rejected.length).toBe(5);
    expect(accepted.length).toBeGreaterThanOrEqual(1);

    // Whatever the interleaving, the domain has exactly one task.
    const tasks = await harness.db.selectFrom('tasks').selectAll().execute();
    expect(tasks).toHaveLength(1);
  });
});
