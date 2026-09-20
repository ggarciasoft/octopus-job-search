/**
 * Source registry: GET/POST /sources, PATCH/DELETE /sources/:id,
 * POST /sources/:id/scan, GET /scans/:id.
 *
 * Also the capability half of invariant 10: once these routes exist,
 * `GET /me` reports `fetch_board`/`fetch_job` and `job_discovery: true`,
 * computed rather than asserted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  CONNECTOR_VERSIONS,
  DISCOVERY_LIMITS,
  FetchBoardInput,
  ScanView,
  SourceView,
} from '@job-getter/contracts';
import {
  authed,
  completeSetup,
  createHarness,
  createSecondWorkspace,
  idempotencyKey,
  type Harness,
  type Session,
} from './helpers/harness.js';
import {
  BOARD,
  boardResult,
  claimTask,
  completeTask,
  createSource,
  deniedResult,
  failTask,
  normalizedJob,
  queueScan,
  readScan,
  runScan,
} from './helpers/discovery.js';

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

function patchSource(id: string, payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(authed(as, { method: 'PATCH', url: `/api/v1/sources/${id}`, payload }));
}

function deleteSource(id: string, as: Session = session) {
  return harness.app.inject(authed(as, { method: 'DELETE', url: `/api/v1/sources/${id}` }));
}

function listSources(as: Session = session) {
  return harness.app.inject(authed(as, { method: 'GET', url: '/api/v1/sources' }));
}

describe('POST /sources', () => {
  it('registers a Greenhouse board with the connector version and unknown health', async () => {
    const source = await createSource(harness, session);
    expect(Value.Check(SourceView, source)).toBe(true);
    expect(source).toMatchObject({
      connector: 'greenhouse',
      connector_version: CONNECTOR_VERSIONS.greenhouse,
      board_key: BOARD,
      base_url: null,
      enabled: true,
      last_success_at: null,
      last_scan_id: null,
      next_scan_after: null,
      job_count: 0,
    });
    expect(source.health).toEqual({
      state: 'unknown',
      consecutive_failures: 0,
      last_error_code: null,
      last_error_at: null,
      detail: null,
    });
  });

  it('rejects a second registration of the same board with 409', async () => {
    await createSource(harness, session);
    const again = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/sources',
        payload: { connector: 'greenhouse', board_key: BOARD },
      }),
    );
    expect(again.statusCode).toBe(409);
  });

  it('accepts only documented regional endpoints as base_url', async () => {
    const eu = await createSource(harness, session, {
      connector: 'lever',
      board_key: 'acme-eu',
      base_url: 'https://api.eu.lever.co/v0/postings/',
    });
    expect(eu.base_url).toBe('https://api.eu.lever.co');

    const elsewhere = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/sources',
        payload: { connector: 'lever', board_key: 'evil', base_url: 'https://169.254.169.254/' },
      }),
    );
    expect(elsewhere.statusCode).toBe(422);
    expect(elsewhere.json().error.fields).toHaveProperty('base_url');

    const http = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/sources',
        payload: { connector: 'lever', board_key: 'plain', base_url: 'http://api.lever.co' },
      }),
    );
    expect(http.statusCode).toBe(422);

    // Greenhouse has one public endpoint and no regional variant.
    const greenhouse = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/sources',
        payload: { connector: 'greenhouse', board_key: 'x', base_url: 'https://api.lever.co' },
      }),
    );
    expect(greenhouse.statusCode).toBe(422);
  });

  it('rejects a connector that is not a scannable board', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/sources',
        payload: { connector: 'manual', board_key: 'x' },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /sources and PATCH /sources/:id', () => {
  it('lists the workspace sources with job counts', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([normalizedJob({ external_id: '1' }), normalizedJob({ external_id: '2' })]),
    );

    const response = await listSources();
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.next_cursor).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].job_count).toBe(2);
    expect(body.items[0].health.state).toBe('ok');
    expect(body.items[0].last_success_at).not.toBeNull();
  });

  it('disabling reports health as disabled and refuses a scan with 422', async () => {
    const source = await createSource(harness, session);
    const disabled = await patchSource(source.id, { enabled: false });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().enabled).toBe(false);
    expect(disabled.json().health.state).toBe('disabled');

    const scan = await queueScan(harness, session, source.id);
    expect(scan.statusCode).toBe(422);
    expect(scan.json().error.message).toContain('disabled');
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toEqual([]);
  });

  it('re-enabling a blocked source clears the block and its counters', async () => {
    const source = await createSource(harness, session);
    for (let i = 0; i < DISCOVERY_LIMITS.blockAfterConsecutiveDenials; i += 1) {
      await runScan(harness, session, source.id, deniedResult('ACCESS_DENIED'));
    }
    const blocked = (await listSources()).json().items[0];
    expect(blocked.health.state).toBe('blocked');

    const refused = await queueScan(harness, session, source.id);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.message).toContain('blocked');

    const reenabled = await patchSource(source.id, { enabled: true });
    expect(reenabled.statusCode).toBe(200);
    expect(reenabled.json().health).toMatchObject({
      state: 'unknown',
      consecutive_failures: 0,
      last_error_code: null,
    });
    expect(reenabled.json().next_scan_after).toBeNull();

    expect((await queueScan(harness, session, source.id)).statusCode).toBe(202);
  });

  it('changing base_url forgets the conditional-request hints of the old endpoint', async () => {
    const source = await createSource(harness, session, { connector: 'lever', board_key: 'acme' });
    await runScan(
      harness,
      session,
      source.id,
      boardResult([], { etag: '"v1"', last_modified: 'Mon, 01 Sep 2025 00:00:00 GMT' }),
    );
    const before = await harness.db
      .selectFrom('sources')
      .select(['etag', 'last_modified'])
      .executeTakeFirstOrThrow();
    expect(before.etag).toBe('"v1"');

    await patchSource(source.id, { base_url: 'https://api.eu.lever.co' });
    const after = await harness.db
      .selectFrom('sources')
      .select(['etag', 'last_modified'])
      .executeTakeFirstOrThrow();
    expect(after).toEqual({ etag: null, last_modified: null });
  });
});

describe('POST /sources/:id/scan', () => {
  it('creates a scan and a fetch_board task together, with a contract-valid input', async () => {
    const source = await createSource(harness, session);
    const response = await queueScan(harness, session, source.id);
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe('queued');

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', response.json().task_id)
      .executeTakeFirstOrThrow();
    expect(task.type).toBe('fetch_board');
    expect(task.capability).toBe('fetch_board');
    expect(Value.Check(FetchBoardInput, task.payload)).toBe(true);

    const payload = task.payload as typeof FetchBoardInput.static;
    expect(payload).toMatchObject({
      source_id: source.id,
      connector: 'greenhouse',
      connector_version: CONNECTOR_VERSIONS.greenhouse,
      board_key: BOARD,
      base_url: null,
      etag: null,
      last_modified: null,
      limits: {
        max_jobs: DISCOVERY_LIMITS.maxJobsPerScan,
        max_pages: DISCOVERY_LIMITS.maxPagesPerScan,
        timeout_seconds: DISCOVERY_LIMITS.requestTimeoutSeconds,
        min_request_interval_ms: DISCOVERY_LIMITS.minRequestIntervalMs,
      },
    });

    const scan = await harness.db.selectFrom('scans').selectAll().executeTakeFirstOrThrow();
    expect(scan.id).toBe(payload.scan_id);
    expect(scan.task_id).toBe(task.id);
    expect(scan.status).toBe('queued');

    // The manual scan also moves the schedule forward, so the scheduler does
    // not queue a second one the moment this finishes.
    const updated = (await listSources()).json().items[0];
    expect(updated.last_scan_id).toBe(scan.id);
    expect(new Date(updated.next_scan_after).getTime()).toBeGreaterThan(Date.now());
  });

  it('passes the stored ETag and Last-Modified to the next scan', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([], { etag: '"abc"', last_modified: 'Mon, 01 Sep 2025 00:00:00 GMT' }),
    );
    const next = await queueScan(harness, session, source.id);
    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', next.json().task_id)
      .executeTakeFirstOrThrow();
    expect(task.payload).toMatchObject({
      etag: '"abc"',
      last_modified: 'Mon, 01 Sep 2025 00:00:00 GMT',
    });
  });

  it('caps max_jobs at the user preference', async () => {
    const preferences = (
      await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/preferences' }))
    ).json();
    const put = await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/preferences',
        payload: {
          expected_revision: preferences.revision,
          config: {
            ...preferences.config,
            limits: { ...preferences.config.limits, scan_max_jobs: 50 },
          },
        },
      }),
    );
    expect(put.statusCode).toBe(200);

    const source = await createSource(harness, session);
    const response = await queueScan(harness, session, source.id);
    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', response.json().task_id)
      .executeTakeFirstOrThrow();
    expect((task.payload as typeof FetchBoardInput.static).limits.max_jobs).toBe(50);
  });

  it('requires an Idempotency-Key and replays the same key', async () => {
    const source = await createSource(harness, session);
    const missing = await harness.app.inject(
      authed(session, { method: 'POST', url: `/api/v1/sources/${source.id}/scan`, payload: {} }),
    );
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.fields).toHaveProperty('idempotency-key');

    const key = idempotencyKey();
    const first = await queueScan(harness, session, source.id, key);
    const second = await queueScan(harness, session, source.id, key);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(await harness.db.selectFrom('scans').selectAll().execute()).toHaveLength(1);
  });

  it('refuses a second scan while one is in flight', async () => {
    const source = await createSource(harness, session);
    expect((await queueScan(harness, session, source.id)).statusCode).toBe(202);
    const second = await queueScan(harness, session, source.id);
    expect(second.statusCode).toBe(409);
    expect(await harness.db.selectFrom('scans').selectAll().execute()).toHaveLength(1);

    // Once the worker finishes, the slot is free again.
    const claimed = await claimTask(harness, 'fetch_board');
    await completeTask(harness, claimed!.task_id, claimed!.lease_token, boardResult([]));
    expect((await queueScan(harness, session, source.id)).statusCode).toBe(202);
  });
});

describe('GET /scans/:id', () => {
  it('resolves by scan id and by task id, and reports counts and completeness', async () => {
    const source = await createSource(harness, session);
    const { taskId, scan } = await runScan(
      harness,
      session,
      source.id,
      boardResult([normalizedJob({ external_id: '1' })], { pages_fetched: 3 }),
    );
    expect(Value.Check(ScanView, scan)).toBe(true);
    expect(scan.task_id).toBe(taskId);
    expect(scan.status).toBe('succeeded');
    expect(scan.complete_snapshot).toBe(true);
    expect(scan.counts).toEqual({
      fetched: 1,
      created: 1,
      updated: 0,
      unchanged: 0,
      closed: 0,
      pages: 3,
    });
    expect(scan.started_at).not.toBeNull();
    expect(scan.completed_at).not.toBeNull();

    const byId = await readScan(harness, session, scan.id);
    expect(byId).toEqual(scan);
  });

  it('marks a partial result as partial', async () => {
    const source = await createSource(harness, session);
    const { scan } = await runScan(
      harness,
      session,
      source.id,
      boardResult([normalizedJob({ external_id: '1' })], {
        complete_snapshot: false,
        next_cursor: 'page-2',
        warnings: [{ code: 'PAGE_LIMIT_REACHED', message: 'Stopped after 100 pages.' }],
      }),
    );
    expect(scan.status).toBe('partial');
    expect(scan.complete_snapshot).toBe(false);
  });

  it('marks the scan failed and degrades the source when the task fails terminally', async () => {
    const source = await createSource(harness, session);
    const queued = await queueScan(harness, session, source.id);
    const claimed = await claimTask(harness, 'fetch_board');
    const failed = await failTask(harness, claimed!.task_id, claimed!.lease_token, {
      code: 'INPUT_INVALID',
      retryable: false,
      redacted_message: 'The board key does not exist.',
    });
    expect(failed.statusCode).toBe(200);

    const scan = await readScan(harness, session, queued.json().task_id);
    expect(scan.status).toBe('failed');
    expect(scan.error_code).toBe('INPUT_INVALID');
    expect(scan.complete_snapshot).toBe(false);

    const view = (await listSources()).json().items[0];
    expect(view.health.state).toBe('degraded');
    expect(view.health.consecutive_failures).toBe(1);
    expect(view.health.last_error_code).toBe('INPUT_INVALID');
  });
});

describe('DELETE /sources/:id', () => {
  it('keeps the jobs and their provenance, nulling only the source pointer', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([normalizedJob({ external_id: '1' }), normalizedJob({ external_id: '2' })]),
    );

    const response = await deleteSource(source.id);
    expect(response.statusCode).toBe(204);
    expect((await listSources()).json().items).toEqual([]);

    const jobs = await harness.db.selectFrom('jobs').selectAll().execute();
    expect(jobs).toHaveLength(2);
    const provenance = await harness.db.selectFrom('job_sources').selectAll().execute();
    expect(provenance).toHaveLength(2);
    expect(provenance.every((row) => row.source_id === null)).toBe(true);

    const listed = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/jobs' }),
    );
    expect(listed.json().items).toHaveLength(2);
    expect(listed.json().items[0].sources[0].source_id).toBeNull();
    expect(listed.json().items[0].sources[0].connector).toBe('greenhouse');
  });

  it('re-registering the board reattaches the surviving provenance', async () => {
    const first = await createSource(harness, session);
    await runScan(harness, session, first.id, boardResult([normalizedJob({ external_id: '1' })]));
    await deleteSource(first.id);

    const second = await createSource(harness, session);
    await runScan(harness, session, second.id, boardResult([normalizedJob({ external_id: '1' })]));

    expect(await harness.db.selectFrom('jobs').selectAll().execute()).toHaveLength(1);
    const provenance = await harness.db.selectFrom('job_sources').selectAll().execute();
    expect(provenance).toHaveLength(1);
    expect(provenance[0]!.source_id).toBe(second.id);
  });
});

describe('workspace isolation', () => {
  it("answers 404 for another workspace's source, scan and task, identically to an absent id", async () => {
    const source = await createSource(harness, session);
    const { taskId, scan } = await runScan(harness, session, source.id, boardResult([]));
    const other = await createSecondWorkspace(harness);

    const foreign = await harness.app.inject(
      authed(other, { method: 'GET', url: `/api/v1/scans/${scan.id}` }),
    );
    const absent = await harness.app.inject(
      authed(other, { method: 'GET', url: `/api/v1/scans/${randomUUID()}` }),
    );
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error).toMatchObject({ code: absent.json().error.code });
    expect(foreign.json().error.message).toBe(absent.json().error.message);

    expect(
      (await harness.app.inject(authed(other, { method: 'GET', url: `/api/v1/scans/${taskId}` })))
        .statusCode,
    ).toBe(404);
    expect((await patchSource(source.id, { enabled: false }, other)).statusCode).toBe(404);
    expect((await deleteSource(source.id, other)).statusCode).toBe(404);
    expect((await queueScan(harness, other, source.id)).statusCode).toBe(404);
    expect((await listSources(other)).json().items).toEqual([]);

    // And the owner's source is untouched.
    expect((await listSources()).json().items[0].enabled).toBe(true);
  });
});

describe('GET /me', () => {
  it('reports fetch_board, fetch_job and job_discovery now that the routes exist', async () => {
    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/me' }),
    );
    expect(response.statusCode).toBe(200);
    const capabilities = response.json().capabilities;
    expect(capabilities.implemented_task_types).toEqual(
      expect.arrayContaining(['fetch_board', 'fetch_job', 'parse_profile', 'noop_echo']),
    );
    expect(capabilities.job_discovery).toBe(true);
  });
});
