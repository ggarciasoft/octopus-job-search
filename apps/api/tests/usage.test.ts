/**
 * The daily AI budget: AT22, and the API half of AT21.
 *
 * AT22 asks for two things at once — "new inference blocked" *and*
 * "review/export still work" — and the second half is the one worth protecting.
 * A budget that also takes away the work already paid for is not a budget, it
 * is an outage.
 *
 * The regression these tests exist for: before this, `usage_ledger` was written
 * by nothing at all. The worker built a budget per task and threw it away, so
 * the day's usage was zero every time it was asked, the dashboard reported zero
 * forever, and a daily cap could only ever refuse a single request bigger than
 * the whole day's allowance. `accumulates across separate tasks` below is the
 * test that would have caught it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROVIDER_LIMITS,
  PROTOCOL_VERSION,
  type ClaimResponse,
  type MeResponse,
  type TaskType,
} from '@job-getter/contracts';
import {
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

/** A leased task to reserve against. `parse_profile` is the real inference path. */
async function leasedTask(type: TaskType = 'parse_profile'): Promise<ClaimResponse> {
  await harness.pool.query(
    `INSERT INTO tasks (workspace_id, type, capability, payload)
     VALUES ($1, $2, $2, '{}'::jsonb)`,
    [session.workspaceId, type],
  );
  const response = await harness.app.inject(
    asWorker({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: {
        worker_id: `worker-${Math.random().toString(36).slice(2, 8)}`,
        capabilities: [type],
        protocol_version: PROTOCOL_VERSION,
      },
    }),
  );
  expect(response.statusCode).toBe(200);
  return response.json() as ClaimResponse;
}

async function reserve(
  task: ClaimResponse,
  inputTokens = 100,
  outputTokens = 100,
  leaseToken: string = task.lease_token,
) {
  return harness.app.inject(
    asWorker({
      method: 'POST',
      url: `/internal/v1/tasks/${task.task_id}/usage/reserve`,
      payload: {
        lease_token: leaseToken,
        estimated_input_tokens: inputTokens,
        estimated_output_tokens: outputTokens,
      },
    }),
  );
}

async function settle(
  task: ClaimResponse,
  reservationId: string,
  inputTokens: number | null,
  outputTokens: number | null,
) {
  return harness.app.inject(
    asWorker({
      method: 'POST',
      url: `/internal/v1/tasks/${task.task_id}/usage/${reservationId}/settle`,
      payload: {
        lease_token: task.lease_token,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    }),
  );
}

async function release(task: ClaimResponse, reservationId: string) {
  return harness.app.inject(
    asWorker({
      method: 'POST',
      url: `/internal/v1/tasks/${task.task_id}/usage/${reservationId}/release`,
      payload: { lease_token: task.lease_token },
    }),
  );
}

/** Sets the workspace's own `ai_requests_per_day`, as the Preferences screen does. */
async function setRequestLimit(limit: number): Promise<void> {
  const current = await harness.app.inject(
    authed(session, { method: 'GET', url: '/api/v1/preferences' }),
  );
  expect(current.statusCode).toBe(200);
  const view = current.json() as { revision: number; config: typeof DEFAULT_PREFERENCES };
  const response = await harness.app.inject(
    authed(session, {
      method: 'PUT',
      url: '/api/v1/preferences',
      payload: {
        expected_revision: view.revision,
        config: {
          ...view.config,
          limits: { ...view.config.limits, ai_requests_per_day: limit },
        },
      },
    }),
  );
  expect(response.statusCode).toBe(200);
}

interface ProviderOverrides {
  readonly dailyTokenBudget?: number | null;
  readonly dailyCostBudget?: number | null;
  readonly rateCard?: { currency: string; input: number; output: number } | null;
}

async function configureProvider(overrides: ProviderOverrides = {}): Promise<void> {
  const response = await harness.app.inject(
    authed(session, {
      method: 'PUT',
      url: '/api/v1/settings/providers',
      payload: {
        provider: 'fake',
        model: 'fake-deterministic-v1',
        base_url: null,
        limits: {
          ...DEFAULT_PROVIDER_LIMITS,
          daily_token_budget: overrides.dailyTokenBudget ?? null,
          daily_cost_budget: overrides.dailyCostBudget ?? null,
        },
        rate_card:
          overrides.rateCard == null
            ? null
            : {
                currency: overrides.rateCard.currency,
                input_cost_per_million: overrides.rateCard.input,
                output_cost_per_million: overrides.rateCard.output,
              },
      },
    }),
  );
  expect(response.statusCode).toBe(200);
}

async function ledgerRows() {
  return harness.db
    .selectFrom('usage_ledger')
    .selectAll()
    .where('workspace_id', '=', session.workspaceId)
    .orderBy('created_at')
    .execute();
}

async function me(): Promise<MeResponse> {
  const response = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/me' }));
  expect(response.statusCode).toBe(200);
  return response.json() as MeResponse;
}

// ---------------------------------------------------------------------------

describe('reserving budget', () => {
  it('writes a ledger row before the request, not after it', async () => {
    const task = await leasedTask();
    const response = await reserve(task, 120, 80);

    expect(response.statusCode).toBe(201);
    const body = response.json() as { reservation_id: string; reserved_tokens: number };
    expect(body.reserved_tokens).toBe(200);

    const rows = await ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(body.reservation_id);
    expect(rows[0]!.status).toBe('reserved');
    expect(rows[0]!.task_id).toBe(task.task_id);
    // The estimate occupies the budget while the request is in flight. A
    // reservation that counted for nothing until it settled would let a burst
    // of concurrent requests all pass a cap they collectively break.
    expect(rows[0]!.input_tokens).toBe(120);
    expect(rows[0]!.output_tokens).toBe(80);
  });

  it('accumulates across separate tasks, which is what makes a daily cap real', async () => {
    await configureProvider({ dailyTokenBudget: 500 });

    // Three separate tasks, each a separate worker process in production. Each
    // request fits the budget on its own; together they do not.
    const first = await reserve(await leasedTask(), 100, 100);
    expect(first.statusCode).toBe(201);
    const second = await reserve(await leasedTask(), 100, 100);
    expect(second.statusCode).toBe(201);

    const third = await reserve(await leasedTask(), 100, 100);
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe('BUDGET_EXHAUSTED');
    expect(third.json().error.message).toContain('No request was sent');

    // The refused request left no trace: nothing was spent, so nothing is owed.
    expect(await ledgerRows()).toHaveLength(2);
  });

  it('refuses with 409, never 429, so the worker does not retry it', async () => {
    await setRequestLimit(1);
    const first = await reserve(await leasedTask());
    expect(first.statusCode).toBe(201);

    const second = await reserve(await leasedTask());
    // 429 would be read by the worker's API client as a transient rate limit
    // and retried with backoff, burning the task's attempts against a cap that
    // does not move until the day's requests age out.
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('BUDGET_EXHAUSTED');
    expect(second.headers['retry-after']).toBeUndefined();
  });

  it('enforces the workspace request limit, not the shipped default', async () => {
    await setRequestLimit(2);
    expect((await reserve(await leasedTask())).statusCode).toBe(201);
    expect((await reserve(await leasedTask())).statusCode).toBe(201);

    const third = await reserve(await leasedTask());
    expect(third.statusCode).toBe(409);
    expect(third.json().error.message).toContain('daily limit of 2 model requests');
  });

  it('enforces a cost cap only alongside a rate card', async () => {
    // A cost cap with no price list cannot be enforced without inventing the
    // price, so the token and request caps carry it instead.
    await configureProvider({ dailyCostBudget: 0.000001, rateCard: null });
    expect((await reserve(await leasedTask(), 1_000_000, 1_000_000)).statusCode).toBe(201);

    await harness.reset();
    session = await completeSetup(harness);

    await configureProvider({
      dailyCostBudget: 0.01,
      rateCard: { currency: 'USD', input: 1000, output: 1000 },
    });
    const refused = await reserve(await leasedTask(), 50_000, 50_000);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain('daily cost budget');
  });

  it('gives a released reservation back to the day', async () => {
    await configureProvider({ dailyTokenBudget: 400 });
    const task = await leasedTask();
    const held = (await reserve(task, 100, 100)).json() as { reservation_id: string };

    // A second reservation of the same size would now fit exactly; a third
    // would not. Releasing the first makes room again.
    expect((await reserve(await leasedTask(), 100, 100)).statusCode).toBe(201);
    expect((await reserve(await leasedTask(), 100, 100)).statusCode).toBe(409);

    expect((await release(task, held.reservation_id)).statusCode).toBe(204);
    expect((await reserve(await leasedTask(), 100, 100)).statusCode).toBe(201);
  });
});

describe('settling what a request actually used', () => {
  it('replaces the estimate with the reported usage', async () => {
    const task = await leasedTask();
    const held = (await reserve(task, 1000, 1000)).json() as { reservation_id: string };

    const settled = await settle(task, held.reservation_id, 640, 120);
    expect(settled.statusCode).toBe(200);
    expect(settled.json()).toMatchObject({ input_tokens: 640, output_tokens: 120 });

    const rows = await ledgerRows();
    expect(rows[0]!.status).toBe('settled');
    expect(rows[0]!.input_tokens).toBe(640);
    expect(rows[0]!.output_tokens).toBe(120);
  });

  it('leaves the estimate standing when the provider reported nothing', async () => {
    const task = await leasedTask();
    const held = (await reserve(task, 300, 200)).json() as { reservation_id: string };

    const settled = await settle(task, held.reservation_id, null, null);
    expect(settled.statusCode).toBe(200);
    // An unreported request is not a free one.
    expect(settled.json()).toMatchObject({ input_tokens: 300, output_tokens: 200 });
  });

  it('records an unknown price as unknown, never as zero', async () => {
    const task = await leasedTask();
    const held = (await reserve(task, 100, 100)).json() as { reservation_id: string };
    const settled = await settle(task, held.reservation_id, 100, 100);

    expect(settled.json().measured_cost).toBeNull();
    expect(settled.json().cost_is_unknown).toBe(true);
    expect((await ledgerRows())[0]!.measured_cost).toBeNull();
  });

  it('prices the request when a rate card exists', async () => {
    await configureProvider({ rateCard: { currency: 'USD', input: 2, output: 6 } });
    const task = await leasedTask();
    const held = (await reserve(task, 1_000_000, 0)).json() as { reservation_id: string };
    const settled = await settle(task, held.reservation_id, 1_000_000, 0);

    expect(settled.json().measured_cost).toBeCloseTo(2.0, 6);
    expect(settled.json().currency).toBe('USD');
    expect(settled.json().cost_is_unknown).toBe(false);
  });

  it('refuses a reservation that belongs to another task', async () => {
    const mine = await leasedTask();
    const theirs = await leasedTask();
    const held = (await reserve(theirs, 100, 100)).json() as { reservation_id: string };

    // Holding one lease must not let a worker settle or release the budget of a
    // task it does not own — that would be a way to hand itself budget back.
    const settled = await settle(mine, held.reservation_id, 1, 1);
    expect(settled.statusCode).toBe(404);
    expect((await release(mine, held.reservation_id)).statusCode).toBe(404);
  });

  it('refuses a stale lease token', async () => {
    const task = await leasedTask();
    const stale = await reserve(task, 100, 100, 'a-stale-lease-token-0123456789abcdef');
    expect(stale.statusCode).toBe(409);
    expect(await ledgerRows()).toHaveLength(0);
  });
});

describe('what the user is told', () => {
  it('reports the real usage and the real limit, not zeros and a default', async () => {
    await setRequestLimit(7);
    const task = await leasedTask();
    const held = (await reserve(task, 400, 100)).json() as { reservation_id: string };
    await settle(task, held.reservation_id, 380, 90);

    const usage = (await me()).usage;
    expect(usage.ai_requests_today).toBe(1);
    expect(usage.ai_requests_per_day_limit).toBe(7);
    expect(usage.input_tokens_today).toBe(380);
    expect(usage.output_tokens_today).toBe(90);
    // No rate card: the cost is unknown, and unknown is reported as null.
    expect(usage.measured_cost_today).toBeNull();
  });

  it('does not count a released reservation as usage', async () => {
    const task = await leasedTask();
    const held = (await reserve(task, 500, 500)).json() as { reservation_id: string };
    await release(task, held.reservation_id);

    const usage = (await me()).usage;
    expect(usage.ai_requests_today).toBe(0);
    expect(usage.input_tokens_today).toBe(0);
  });

  it('reports the configured cost budget', async () => {
    await configureProvider({
      dailyCostBudget: 2.5,
      rateCard: { currency: 'USD', input: 2, output: 6 },
    });
    expect((await me()).usage.daily_cost_budget).toBe(2.5);
  });
});

describe('AT22: with the budget exhausted, review and export still work', () => {
  beforeEach(async () => {
    await setRequestLimit(1);
    const spent = await reserve(await leasedTask());
    expect(spent.statusCode).toBe(201);
    // Every assertion below runs against a workspace that can buy no more
    // inference.
    expect((await reserve(await leasedTask())).statusCode).toBe(409);
  });

  it('still lists jobs and reads the dashboard', async () => {
    const jobs = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/jobs' }));
    expect(jobs.statusCode).toBe(200);
    expect((await me()).usage.ai_requests_today).toBe(1);
  });

  it('still reads the profile and preferences', async () => {
    for (const url of [
      '/api/v1/profile',
      '/api/v1/preferences',
      '/api/v1/settings/providers',
      '/api/v1/applications',
    ]) {
      const response = await harness.app.inject(authed(session, { method: 'GET', url }));
      expect(response.statusCode, `${url} should still be readable`).toBe(200);
    }
  });

  it('still lets the user edit a profile fact by hand', async () => {
    const before = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/profile' }),
    );
    const revision = before.json().revision as number;
    const response = await harness.app.inject(
      authed(session, {
        method: 'PATCH',
        url: '/api/v1/profile',
        payload: {
          expected_revision: revision,
          contact: {
            full_name: 'Written by hand, with no model involved',
            email: 'owner@job-getter.invalid',
          },
          changes: [],
        },
      }),
    );
    // Manual editing is not inference and must not be gated by an AI budget.
    expect(response.statusCode).toBe(200);
  });

  it('still exports the workspace', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/workspace/export',
        headers: { 'idempotency-key': idempotencyKey() },
        payload: {},
      }),
    );
    // Taking your data out is the one thing that must never be held hostage to
    // a spending cap (09_SECURITY_PRIVACY.md).
    expect([200, 202]).toContain(response.statusCode);
  });
});
