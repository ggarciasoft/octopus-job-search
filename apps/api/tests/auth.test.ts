/**
 * AT01 (bootstrap half), session handling, CSRF/origin verification, honest
 * capability reporting and the error envelope.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  ErrorEnvelope,
  IMPLEMENTED_TASK_TYPES,
  MeResponse,
  SetupStatus,
} from '@job-getter/contracts';
import {
  TEST_ORIGIN,
  TEST_OWNER_EMAIL,
  TEST_OWNER_PASSWORD,
  TEST_SETUP_TOKEN,
  TEST_WORKER_TOKEN,
  authed,
  completeSetup,
  createHarness,
  type Harness,
  type Session,
} from './helpers/harness.js';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
}, 180_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

async function login(email = TEST_OWNER_EMAIL, password = TEST_OWNER_PASSWORD) {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload: { email, password },
  });
}

describe('AT01 — one-time owner setup', () => {
  it('reports setup as required on a fresh local installation', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Value.Check(SetupStatus, body)).toBe(true);
    expect(body).toEqual({ mode: 'local', setup_required: true, registration_open: false });
  });

  it('creates the owner, workspace, membership, profile and preferences rows', async () => {
    const session = await completeSetup(harness);

    const counts = await harness.pool.query<{ table_name: string; count: string }>(`
      SELECT 'users' AS table_name, count(*)::text FROM users
      UNION ALL SELECT 'workspaces', count(*)::text FROM workspaces
      UNION ALL SELECT 'memberships', count(*)::text FROM memberships
      UNION ALL SELECT 'profiles', count(*)::text FROM profiles
      UNION ALL SELECT 'preferences', count(*)::text FROM preferences
    `);
    for (const row of counts.rows) {
      expect(row.count, row.table_name).toBe('1');
    }

    const membership = await harness.db
      .selectFrom('memberships')
      .selectAll()
      .where('workspace_id', '=', session.workspaceId)
      .executeTakeFirstOrThrow();
    expect(membership.role).toBe('owner');

    // The profile starts genuinely empty; nothing is invented (invariant 2).
    const profile = await harness.db
      .selectFrom('profiles')
      .selectAll()
      .where('workspace_id', '=', session.workspaceId)
      .executeTakeFirstOrThrow();
    expect(profile.contact).toBeNull();
    expect(profile.confirmed_revision).toBeNull();

    const facts = await harness.db.selectFrom('profile_facts').selectAll().execute();
    expect(facts).toEqual([]);
  });

  it('stores the password as an Argon2id hash, never as plaintext', async () => {
    await completeSetup(harness);
    const user = await harness.db.selectFrom('users').selectAll().executeTakeFirstOrThrow();
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    expect(user.password_hash).not.toContain(TEST_OWNER_PASSWORD);
  });

  it('returns a session cookie that is HttpOnly, SameSite=Lax and not Secure locally', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: TEST_ORIGIN },
      payload: {
        setup_token: TEST_SETUP_TOKEN,
        email: TEST_OWNER_EMAIL,
        password: TEST_OWNER_PASSWORD,
      },
    });
    expect(response.statusCode).toBe(201);

    const cookies = ([] as string[]).concat(response.headers['set-cookie'] as string[]);
    const sessionCookie = cookies.find((value) => value.startsWith('jg_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    // Local mode is plain http; a Secure cookie would simply never be sent.
    expect(sessionCookie).not.toContain('Secure');

    // The CSRF half is readable by script on purpose (double-submit).
    const csrfCookie = cookies.find((value) => value.startsWith('jg_csrf='));
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).not.toContain('HttpOnly');
  });

  it('closes permanently: a second call is rejected even with the correct token', async () => {
    await completeSetup(harness);

    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: TEST_ORIGIN },
      payload: {
        setup_token: TEST_SETUP_TOKEN,
        email: 'intruder@job-getter.invalid',
        password: 'another perfectly valid password',
      },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('SETUP_CLOSED');

    // And nothing was created by the rejected call.
    const users = await harness.db.selectFrom('users').selectAll().execute();
    expect(users).toHaveLength(1);
  });

  it('stays closed even if the owner row is later deleted', async () => {
    await completeSetup(harness);
    // Cascades remove the workspace too; the system_flags record does not care.
    await harness.pool.query('DELETE FROM memberships');
    await harness.pool.query('DELETE FROM workspaces');
    await harness.pool.query('DELETE FROM users');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: TEST_ORIGIN },
      payload: {
        setup_token: TEST_SETUP_TOKEN,
        email: 'intruder@job-getter.invalid',
        password: 'another perfectly valid password',
      },
    });
    expect(response.json().error.code).toBe('SETUP_CLOSED');
  });

  it('reports setup as no longer required once complete', async () => {
    await completeSetup(harness);
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(response.json().setup_required).toBe(false);
  });

  it('rejects an incorrect setup token without creating anything', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: TEST_ORIGIN },
      payload: {
        setup_token: 'wrong-token-but-long-enough-here',
        email: TEST_OWNER_EMAIL,
        password: TEST_OWNER_PASSWORD,
      },
    });
    expect(response.statusCode).toBe(401);
    expect(await harness.db.selectFrom('users').selectAll().execute()).toEqual([]);
  });

  it('refuses setup from a public source address', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: TEST_ORIGIN },
      remoteAddress: '203.0.113.7',
      payload: {
        setup_token: TEST_SETUP_TOKEN,
        email: TEST_OWNER_EMAIL,
        password: TEST_OWNER_PASSWORD,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(await harness.db.selectFrom('users').selectAll().execute()).toEqual([]);
  });

  it('rejects a password below the contract minimum length', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { origin: TEST_ORIGIN },
      payload: { setup_token: TEST_SETUP_TOKEN, email: TEST_OWNER_EMAIL, password: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.fields).toHaveProperty('password');
  });
});

describe('login and logout', () => {
  beforeEach(async () => {
    await completeSetup(harness);
  });

  it('exchanges credentials for a session', async () => {
    const response = await login();
    expect(response.statusCode).toBe(200);
    expect(Value.Check(MeResponse, response.json())).toBe(true);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrongPassword = await login(TEST_OWNER_EMAIL, 'definitely not the password');
    const unknownAccount = await login('nobody@job-getter.invalid', TEST_OWNER_PASSWORD);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownAccount.json().error.message);
    expect(wrongPassword.json().error.code).toBe(unknownAccount.json().error.code);
  });

  it('revokes the session on logout and the cookie stops working', async () => {
    const session = await createLoggedInSession();

    const before = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/me' }));
    expect(before.statusCode).toBe(200);

    const logout = await harness.app.inject(
      authed(session, { method: 'POST', url: '/api/v1/auth/logout', payload: {} }),
    );
    expect(logout.statusCode).toBe(204);

    const after = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/me' }));
    expect(after.statusCode).toBe(401);
  });

  it('rejects a login for a disabled account with the same uniform message', async () => {
    await harness.pool.query('UPDATE users SET disabled_at = now()');
    const response = await login();
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe('Email or password is incorrect.');
  });
});

async function createLoggedInSession(): Promise<Session> {
  const response = await login();
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] as string[]);
  const session = cookies
    .find((value) => value.startsWith('jg_session='))!
    .split(';')[0]!
    .split('=')[1]!;
  const csrf = cookies
    .find((value) => value.startsWith('jg_csrf='))!
    .split(';')[0]!
    .split('=')[1]!;
  const body = response.json();
  return {
    cookie: `jg_session=${session}; jg_csrf=${csrf}`,
    csrfToken: csrf,
    workspaceId: body.workspace.id,
    userId: body.user.id,
  };
}

describe('CSRF and origin verification', () => {
  let session: Session;

  beforeEach(async () => {
    session = await completeSetup(harness);
  });

  it('leaves safe GET requests unaffected by CSRF requirements', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: session.cookie },
    });
    // No Origin header, no CSRF token: a read is still served.
    expect(response.statusCode).toBe(200);
  });

  it('rejects a state-changing request from a foreign origin', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        origin: 'https://evil.example',
        cookie: session.cookie,
        'x-csrf-token': session.csrfToken,
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('rejects a state-changing request with no Origin or Referer at all', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('accepts a same-origin Referer when Origin is absent', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        referer: `${TEST_ORIGIN}/settings`,
        cookie: session.cookie,
        'x-csrf-token': session.csrfToken,
      },
      payload: {},
    });
    expect(response.statusCode).toBe(204);
  });

  it('rejects a state-changing request with a missing CSRF token', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: TEST_ORIGIN, cookie: session.cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('anti-CSRF');
  });

  it('rejects a CSRF token that belongs to a different session', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        origin: TEST_ORIGIN,
        cookie: session.cookie,
        'x-csrf-token': 'a'.repeat(64),
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('never advertises a permissive CORS policy', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/setup',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('GET /me reports capabilities honestly (invariant 10)', () => {
  it('claims nothing beyond what this milestone implements', async () => {
    const session = await completeSetup(harness);
    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/me' }),
    );

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(MeResponse, body)).toBe(true);

    // The advertised list is the contract's IMPLEMENTED_TASK_TYPES intersected
    // with the task types a *registered* route can create. A worker handler
    // alone is not a capability the user can reach. M2 registered
    // scanSource/importJob, so fetch_board/fetch_job now appear — computed
    // from the route table, not added by hand. M4 added fillApplication, and
    // `fill_local` appears for the same reason, even though the handler that
    // performs it lives in the paired runner rather than in the container
    // worker: the user can reach it, which is what this list claims. The same
    // goes for `observe_confirmation`, which the runner performs and
    // `observeApplication` creates.
    const advertised: string[] = body.capabilities.implemented_task_types;
    for (const type of advertised) expect(IMPLEMENTED_TASK_TYPES).toContain(type);
    expect([...advertised].sort()).toEqual(
      [
        'noop_echo',
        'parse_profile',
        'fetch_board',
        'fetch_job',
        'match_job',
        'render_cv',
        'fill_local',
        'observe_confirmation',
      ].sort(),
    );
    // M1 and M2 landed: their routes exist, so these flags are true and the
    // task types appear above. Everything beyond M2 must still be false.
    expect(body.capabilities.profile_import).toBe(true);
    expect(body.capabilities.job_discovery).toBe(true);
    expect(body.capabilities.cv_generation).toBe(false);
    expect(body.capabilities.applications).toBe(false);
    expect(body.capabilities.browser_filling).toBe(false);
    expect(body.capabilities.extension).toBe(false);
    expect(body.capabilities.ai_provider_configured).toBe(false);

    // Unknown cost is null, never 0 (04_API_CONTRACTS.md).
    expect(body.usage.measured_cost_today).toBeNull();
    expect(body.usage.currency).toBeNull();
    expect(body.usage.daily_cost_budget).toBeNull();
  });

  it('reports worker_online only after a worker has actually polled', async () => {
    const session = await completeSetup(harness);

    const before = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/me' }));
    expect(before.json().capabilities.worker_online).toBe(false);

    await harness.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      headers: { authorization: `Bearer ${TEST_WORKER_TOKEN}` },
      payload: { worker_id: 'worker-1', capabilities: ['noop_echo'], protocol_version: 1 },
    });

    const after = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/me' }));
    expect(after.json().capabilities.worker_online).toBe(true);
  });

  it('stops reporting a worker online once its poll has aged out', async () => {
    const session = await completeSetup(harness);
    await harness.app.inject({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      headers: { authorization: `Bearer ${TEST_WORKER_TOKEN}` },
      payload: { worker_id: 'worker-1', capabilities: ['noop_echo'], protocol_version: 1 },
    });
    await harness.pool.query(
      `UPDATE worker_registrations SET last_seen_at = now() - interval '10 minutes'`,
    );

    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/me' }),
    );
    expect(response.json().capabilities.worker_online).toBe(false);
  });
});

describe('error envelope (04_API_CONTRACTS.md)', () => {
  it('matches the contract shape exactly, including request_id', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/me' });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(Value.Check(ErrorEnvelope, body)).toBe(true);
    expect(body.error.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('gives a different request_id per request', async () => {
    const first = await harness.app.inject({ method: 'GET', url: '/api/v1/me' });
    const second = await harness.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(first.json().error.request_id).not.toBe(second.json().error.request_id);
  });

  it('returns per-field messages for a schema violation', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: TEST_ORIGIN },
      payload: { email: 'a', password: 'b', unexpected: true },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.error.fields ?? {}).length).toBeGreaterThan(0);
  });

  it('never leaks a stack trace or internal message on a 500', async () => {
    const session = await completeSetup(harness);
    // Force a genuine internal failure: drop the table the handler reads.
    await harness.pool.query('ALTER TABLE tasks RENAME TO tasks_hidden');
    try {
      const response = await harness.app.inject(
        authed(session, { method: 'GET', url: '/api/v1/tasks' }),
      );
      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(Value.Check(ErrorEnvelope, body)).toBe(true);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred.');
      expect(response.body).not.toContain('tasks_hidden');
      expect(response.body).not.toMatch(/at \w+ \(/); // no stack frames
      expect(response.body).not.toContain('node_modules');
    } finally {
      await harness.pool.query('ALTER TABLE tasks_hidden RENAME TO tasks');
    }
  });

  it('rejects a malformed UUID path parameter with 400, not 200', async () => {
    // Confirms the TypeBox validator compiler honours `format: uuid` — the
    // same registry the worker-result validation uses.
    const session = await completeSetup(harness);
    const bad = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/tasks/not-a-uuid' }),
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    const good = await harness.app.inject(
      authed(session, {
        method: 'GET',
        url: '/api/v1/tasks/2f1c9b3a-5d4e-4f6a-8b7c-9d0e1f2a3b4c',
      }),
    );
    // A well-formed but unknown id reaches the handler and is a clean 404.
    expect(good.statusCode).toBe(404);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    const limited = await createHarness({ rateLimitEnabled: true });
    try {
      await completeSetup(limited);
      let sawTooMany = false;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const response = await limited.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin: TEST_ORIGIN },
          payload: { email: TEST_OWNER_EMAIL, password: 'guess number ' + attempt },
        });
        if (response.statusCode === 429) {
          sawTooMany = true;
          expect(response.json().error.code).toBe('QUOTA_EXCEEDED');
          break;
        }
      }
      expect(sawTooMany).toBe(true);
    } finally {
      await limited.close();
    }
  }, 240_000);
});

describe('health endpoints (10_DEPLOYMENT.md)', () => {
  it('liveness answers without consulting the database', async () => {
    // Renaming the migrations table breaks readiness but must not break
    // liveness: liveness is "the process is alive", nothing more.
    await harness.pool.query('ALTER TABLE schema_migrations RENAME TO schema_migrations_hidden');
    try {
      const live = await harness.app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
      expect(live.json().status).toBe('ok');

      const ready = await harness.app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json().status).toBe('not_ready');
    } finally {
      await harness.pool.query('ALTER TABLE schema_migrations_hidden RENAME TO schema_migrations');
    }
  });

  it('readiness passes once the schema and storage are in place', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    const checks = response.json().checks as { name: string; ok: boolean }[];
    expect(checks.map((check) => check.name).sort()).toEqual(['database', 'schema', 'storage']);
    expect(checks.every((check) => check.ok)).toBe(true);
  });
});
