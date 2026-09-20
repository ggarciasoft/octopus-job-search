/**
 * Applying `fetch_board` results: AT05, AT06, AT07, AT08 and source health.
 *
 *   AT05 — "Board fetch with duplicate jobs → Single canonical job with
 *           provenance, no lost histories"
 *   AT06 — "Failed/partial board scan → Missing jobs are not closed"
 *   AT07 — "Remote job restricted to US → Non-US eligibility not assumed;
 *           unknown shown when appropriate"
 *   AT08 — "Unknown currency/period → No invalid salary comparison or silent
 *           conversion"
 *
 * Every result goes through the real worker protocol and the completing
 * transaction; snapshot times are driven through the result's `fetched_at`
 * so the closure clock is the worker's observation, not the wall clock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLOSURE_RULES, DISCOVERY_LIMITS } from '@job-getter/contracts';
import {
  authed,
  completeSetup,
  createHarness,
  type Harness,
  type Session,
} from './helpers/harness.js';
import {
  BOARD,
  boardResult,
  claimTask,
  createSource,
  deniedResult,
  failTask,
  hoursAgo,
  listJobs,
  normalizedJob,
  queueScan,
  readJob,
  runScan,
  sha256,
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

async function jobRows() {
  return harness.db.selectFrom('jobs').selectAll().orderBy('first_seen_at', 'asc').execute();
}

async function provenanceRows(jobId?: string) {
  let query = harness.db.selectFrom('job_sources').selectAll().orderBy('created_at', 'asc');
  if (jobId) query = query.where('job_id', '=', jobId);
  return query.execute();
}

async function sourceRow() {
  return harness.db.selectFrom('sources').selectAll().executeTakeFirstOrThrow();
}

// ---------------------------------------------------------------------------

describe('AT05 — deduplication with provenance', () => {
  it('collapses the same requisition listed twice into one job with two provenance rows', async () => {
    const source = await createSource(harness, session);
    const applyUrl = 'https://boards.greenhouse.io/acme/jobs/100#app';
    // The same posting reached through two department pages: two connector
    // identities, one application URL.
    const { scan } = await runScan(
      harness,
      session,
      source.id,
      boardResult([
        normalizedJob({
          external_id: '100',
          apply_url: applyUrl,
          title: 'Backend Engineer',
          description_text: 'Backend role.',
        }),
        normalizedJob({
          external_id: '100-eng',
          apply_url: applyUrl,
          title: 'Backend Engineer',
          description_text: 'Backend role.',
        }),
      ]),
    );

    const jobs = await jobRows();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.canonical_key).toBe(`greenhouse:${BOARD}:100`);
    expect(scan.counts).toMatchObject({ fetched: 2, created: 1, unchanged: 1 });

    const provenance = await provenanceRows(jobs[0]!.id);
    expect(provenance.map((row) => row.external_id).sort()).toEqual(['100', '100-eng']);
    expect(provenance.every((row) => row.source_id === source.id)).toBe(true);

    const detail = (await readJob(harness, session, jobs[0]!.id)).json();
    expect(detail.sources).toHaveLength(2);
    expect(detail.possible_duplicates).toEqual([]);
  });

  it('treats an identity repeated verbatim in one result as one posting', async () => {
    const source = await createSource(harness, session);
    const job = normalizedJob({ external_id: '7' });
    await runScan(harness, session, source.id, boardResult([job, job]));
    expect(await jobRows()).toHaveLength(1);
    expect(await provenanceRows()).toHaveLength(1);
  });

  it('links a second source to the same job only on an identical apply_url', async () => {
    const greenhouse = await createSource(harness, session);
    const lever = await createSource(harness, session, { connector: 'lever', board_key: 'acme' });
    const applyUrl = 'https://jobs.acme.example/apply/42';

    await runScan(
      harness,
      session,
      greenhouse.id,
      boardResult([normalizedJob({ external_id: '42', apply_url: applyUrl })]),
    );
    await runScan(
      harness,
      session,
      lever.id,
      boardResult([
        normalizedJob({
          external_id: 'lever-uuid-42',
          connector: 'lever',
          apply_url: applyUrl,
          canonical_url: 'https://jobs.lever.co/acme/lever-uuid-42',
          title: 'Engineer 42 (Lever)',
        }),
      ]),
    );

    const jobs = await jobRows();
    expect(jobs).toHaveLength(1);
    // The first identity keeps the canonical key; the second is provenance.
    expect(jobs[0]!.canonical_key).toBe(`greenhouse:${BOARD}:42`);
    const provenance = await provenanceRows(jobs[0]!.id);
    expect(provenance.map((row) => row.connector).sort()).toEqual(['greenhouse', 'lever']);
    expect(provenance.map((row) => row.source_id).sort()).toEqual([greenhouse.id, lever.id].sort());
  });

  it('links the same requisition id seen through another board of the same connector', async () => {
    const parent = await createSource(harness, session, {
      connector: 'greenhouse',
      board_key: 'acme',
    });
    const child = await createSource(harness, session, {
      connector: 'greenhouse',
      board_key: 'acme-labs',
    });

    await runScan(
      harness,
      session,
      parent.id,
      boardResult([normalizedJob({ external_id: '4242', apply_url: null })]),
    );
    await runScan(
      harness,
      session,
      child.id,
      boardResult([normalizedJob({ external_id: '4242', board: 'acme-labs', apply_url: null })]),
    );

    expect(await jobRows()).toHaveLength(1);
    expect(await provenanceRows()).toHaveLength(2);
  });

  it('reports similar title and location as a possible duplicate and never merges', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([
        normalizedJob({ external_id: '1', title: 'Data Engineer', apply_url: null }),
        normalizedJob({ external_id: '2', title: 'Data  Engineer', apply_url: null }),
        // Same title, different city: not similar.
        normalizedJob({
          external_id: '3',
          title: 'Data Engineer',
          apply_url: null,
          locations: [{ country: 'ES', region: null, city: 'Barcelona', source_excerpt: 'BCN' }],
        }),
        // Same title and city, different employer: not reported.
        normalizedJob({
          external_id: '4',
          title: 'Data Engineer',
          company: 'Globex',
          apply_url: null,
        }),
      ]),
    );

    const jobs = await jobRows();
    expect(jobs).toHaveLength(4);
    const first = jobs.find((job) => job.canonical_key.endsWith(':1'))!;
    const second = jobs.find((job) => job.canonical_key.endsWith(':2'))!;

    const detail = (await readJob(harness, session, first.id)).json();
    expect(detail.possible_duplicates).toEqual([
      expect.objectContaining({ job_id: second.id, reason: 'similar_title_and_location' }),
    ]);

    // The list carries the same warning without a second round trip per job.
    const listed = await listJobs(harness, session);
    const listedSecond = listed.items.find((item) => item['id'] === second.id)!;
    expect(listedSecond['possible_duplicates']).toEqual([
      expect.objectContaining({ job_id: first.id }),
    ]);
  });

  it('bumps the revision only when the content hash changes', async () => {
    const source = await createSource(harness, session);
    const original = normalizedJob({ external_id: '9', description_text: 'v1' });
    await runScan(harness, session, source.id, boardResult([original]));

    const unchanged = await runScan(harness, session, source.id, boardResult([original]));
    expect(unchanged.scan.counts).toMatchObject({ unchanged: 1, updated: 0 });
    expect((await jobRows())[0]!.revision).toBe(1);

    const edited = normalizedJob({ external_id: '9', description_text: 'v2', title: 'Renamed' });
    const changed = await runScan(harness, session, source.id, boardResult([edited]));
    expect(changed.scan.counts).toMatchObject({ unchanged: 0, updated: 1 });
    const row = (await jobRows())[0]!;
    expect(row.revision).toBe(2);
    expect(row.title).toBe('Renamed');
    expect(row.content_hash).toBe(sha256('v2'));
  });
});

// ---------------------------------------------------------------------------

describe('AT06 — freshness and closure', () => {
  const t0 = new Date('2026-09-01T08:00:00.000Z');
  const at = (hours: number) => new Date(t0.getTime() + hours * 60 * 60 * 1000).toISOString();
  const jobsById = (ids: string[]) => ids.map((id) => normalizedJob({ external_id: id }));

  async function statusOf(externalId: string): Promise<{ status: string; missing: number }> {
    const provenance = await harness.db
      .selectFrom('job_sources')
      .innerJoin('jobs', 'jobs.id', 'job_sources.job_id')
      .select(['jobs.status', 'job_sources.missing_snapshots'])
      .where('job_sources.external_id', '=', externalId)
      .executeTakeFirstOrThrow();
    return { status: provenance.status, missing: provenance.missing_snapshots };
  }

  it('closes a job only after two complete snapshots at least 24 hours apart miss it', async () => {
    const source = await createSource(harness, session);

    // A: complete, jobs 1, 2, 3.
    await runScan(
      harness,
      session,
      source.id,
      boardResult(jobsById(['1', '2', '3']), { fetched_at: at(0) }),
    );
    expect(await statusOf('3')).toEqual({ status: 'active', missing: 0 });

    // B: partial, jobs 1, 2. Closes nothing, counts nothing.
    const partial = await runScan(
      harness,
      session,
      source.id,
      boardResult(jobsById(['1', '2']), { complete_snapshot: false, fetched_at: at(0.5) }),
    );
    expect(partial.scan.status).toBe('partial');
    expect(partial.scan.counts.closed).toBe(0);
    expect(await statusOf('3')).toEqual({ status: 'active', missing: 0 });

    // C: complete, jobs 1, 2, one hour later. Counts, does not close.
    const first = await runScan(
      harness,
      session,
      source.id,
      boardResult(jobsById(['1', '2']), { fetched_at: at(1) }),
    );
    expect(first.scan.counts.closed).toBe(0);
    expect(await statusOf('3')).toEqual({ status: 'active', missing: 1 });

    // C': another complete snapshot too soon after the first miss. Still open.
    const soon = await runScan(
      harness,
      session,
      source.id,
      boardResult(jobsById(['1', '2']), { fetched_at: at(2) }),
    );
    expect(soon.scan.counts.closed).toBe(0);
    expect(await statusOf('3')).toEqual({ status: 'active', missing: 2 });

    // D: complete, 25 hours after the first miss. Closed.
    const closing = await runScan(
      harness,
      session,
      source.id,
      boardResult(jobsById(['1', '2']), {
        fetched_at: at(1 + CLOSURE_RULES.minHoursBetweenSnapshots + 1),
      }),
    );
    expect(closing.scan.counts.closed).toBe(1);
    expect((await statusOf('3')).status).toBe('closed');
    const closed = (await jobRows()).find((job) => job.canonical_key.endsWith(':3'))!;
    expect(closed.closed_reason).toBe('snapshot');
    expect(closed.closed_at?.toISOString()).toBe(at(26));
    // History survives: last_seen_at is when the board last listed it.
    expect(closed.last_seen_at.toISOString()).toBe(at(0));
    expect((await statusOf('1')).status).toBe('active');

    // Reappearance reopens and resets the count.
    await runScan(
      harness,
      session,
      source.id,
      boardResult(jobsById(['1', '2', '3']), { fetched_at: at(30) }),
    );
    expect(await statusOf('3')).toEqual({ status: 'active', missing: 0 });
    const reopened = (await jobRows()).find((job) => job.canonical_key.endsWith(':3'))!;
    expect(reopened.closed_reason).toBeNull();
    expect(reopened.closed_at).toBeNull();
  });

  it('a failed scan never closes anything and never increments the count', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult(jobsById(['1', '2']), { fetched_at: at(0) }),
    );
    await runScan(harness, session, source.id, boardResult(jobsById(['1']), { fetched_at: at(1) }));
    expect(await statusOf('2')).toEqual({ status: 'active', missing: 1 });

    // A terminal failure 30 hours later: would be the closing snapshot if it counted.
    const queued = await queueScan(harness, session, source.id);
    const claimed = await claimTask(harness, 'fetch_board');
    await failTask(harness, claimed!.task_id, claimed!.lease_token, {
      code: 'TIMEOUT',
      retryable: false,
      redacted_message: 'The board did not answer.',
    });
    const scan = (
      await harness.app.inject(
        authed(session, { method: 'GET', url: `/api/v1/scans/${queued.json().task_id}` }),
      )
    ).json();
    expect(scan.status).toBe('failed');
    expect(await statusOf('2')).toEqual({ status: 'active', missing: 1 });

    // Nor does a refusal that happens to be a "complete" result by mistake.
    await runScan(
      harness,
      session,
      source.id,
      boardResult([], {
        complete_snapshot: true,
        observed_health: { state: 'degraded', http_status: 403, retry_after_seconds: null },
        warnings: [{ code: 'ACCESS_DENIED', message: 'HTTP 403' }],
        fetched_at: at(30),
      }),
    );
    expect(await statusOf('2')).toEqual({ status: 'active', missing: 1 });
    expect((await statusOf('1')).status).toBe('active');
  });

  it('does not close a job another enabled source still lists', async () => {
    const a = await createSource(harness, session, { connector: 'greenhouse', board_key: 'a' });
    const b = await createSource(harness, session, { connector: 'greenhouse', board_key: 'b' });
    const applyUrl = 'https://jobs.acme.example/apply/1';
    const viaA = normalizedJob({ external_id: '1', board: 'a', apply_url: applyUrl });
    const viaB = normalizedJob({ external_id: '1', board: 'b', apply_url: applyUrl });

    await runScan(harness, session, a.id, boardResult([viaA], { fetched_at: at(0) }));
    await runScan(harness, session, b.id, boardResult([viaB], { fetched_at: at(0) }));
    expect(await jobRows()).toHaveLength(1);

    // Board A stops listing it, twice, 25 hours apart; board B still has it.
    await runScan(harness, session, a.id, boardResult([], { fetched_at: at(1) }));
    await runScan(harness, session, b.id, boardResult([viaB], { fetched_at: at(1) }));
    await runScan(harness, session, a.id, boardResult([], { fetched_at: at(26) }));
    expect((await jobRows())[0]!.status).toBe('active');

    // Once B agrees, it closes.
    await runScan(harness, session, b.id, boardResult([], { fetched_at: at(27) }));
    await runScan(harness, session, b.id, boardResult([], { fetched_at: at(52) }));
    expect((await jobRows())[0]!.status).toBe('closed');
  });

  it('does not reopen a job the user closed explicitly', async () => {
    const source = await createSource(harness, session);
    await runScan(harness, session, source.id, boardResult(jobsById(['1'])));
    const job = (await jobRows())[0]!;
    const closed = await harness.app.inject(
      authed(session, {
        method: 'PATCH',
        url: `/api/v1/jobs/${job.id}`,
        payload: { expected_revision: 1, status: 'closed' },
      }),
    );
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe('closed');

    await runScan(harness, session, source.id, boardResult(jobsById(['1'])));
    expect((await jobRows())[0]!.status).toBe('closed');
    expect((await jobRows())[0]!.closed_reason).toBe('user');
  });
});

// ---------------------------------------------------------------------------

describe('AT07 / AT08 — nothing is invented on the way through', () => {
  it('keeps eligible_countries, salary fields and published_at null when the source said nothing', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([
        normalizedJob({
          external_id: 'remote-us',
          title: 'Remote Engineer',
          remote_type: 'remote',
          // Remote does not mean worldwide: the posting did not say.
          eligible_countries: null,
          // AT08: a stated range with no currency stays without one.
          salary: {
            min: 90000,
            max: 120000,
            currency: null,
            period: null,
            source_excerpt: '90-120k',
          },
          published_at: null,
          locations: [],
        }),
        normalizedJob({
          external_id: 'us-only',
          title: 'US Remote Engineer',
          remote_type: 'remote',
          eligible_countries: ['US'],
          inferred: [{ field: 'eligible_countries', source_excerpt: 'Must be based in the US.' }],
          published_at: '2026-08-30T12:00:00Z',
        }),
      ]),
    );

    const listed = await listJobs(harness, session);
    const remote = listed.items.find((item) => item['title'] === 'Remote Engineer')!;
    expect(remote['remote_type']).toBe('remote');
    expect(remote['eligible_countries']).toBeNull();
    expect(remote['salary']).toEqual({
      min: 90000,
      max: 120000,
      currency: null,
      period: null,
      source_excerpt: '90-120k',
    });
    expect(remote['published_at']).toBeNull();
    expect(remote['match']).toBeNull();

    const usOnly = listed.items.find((item) => item['title'] === 'US Remote Engineer')!;
    expect(usOnly['eligible_countries']).toEqual(['US']);
    expect(usOnly['published_at']).toBe('2026-08-30T12:00:00.000Z');

    const detail = (await readJob(harness, session, usOnly['id'] as string)).json();
    expect(detail.inferred).toEqual([
      { field: 'eligible_countries', source_excerpt: 'Must be based in the US.' },
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('source health', () => {
  it('blocks after three consecutive denials and stops scheduling', async () => {
    const source = await createSource(harness, session);

    for (let i = 1; i <= DISCOVERY_LIMITS.blockAfterConsecutiveDenials; i += 1) {
      const { scan } = await runScan(harness, session, source.id, deniedResult('ACCESS_DENIED'));
      expect(scan.status).toBe('failed');
      expect(scan.error_code).toBe('ACCESS_DENIED');
      const row = await sourceRow();
      expect(row.consecutive_denials).toBe(i);
      expect(row.health_state).toBe(
        i < DISCOVERY_LIMITS.blockAfterConsecutiveDenials ? 'degraded' : 'blocked',
      );
    }

    const refused = await queueScan(harness, session, source.id);
    expect(refused.statusCode).toBe(422);

    const { scheduleDueScans } = await import('../src/discovery/scan-scheduler.js');
    await harness.db.updateTable('sources').set({ next_scan_after: null }).execute();
    const scheduled = await scheduleDueScans(harness.db);
    expect(scheduled.queued).toEqual([]);
  });

  it('a success resets the failure counters; a mixed sequence does not block', async () => {
    const source = await createSource(harness, session);
    await runScan(harness, session, source.id, deniedResult('RATE_LIMITED'));
    await runScan(harness, session, source.id, deniedResult('ACCESS_DENIED'));
    expect((await sourceRow()).consecutive_denials).toBe(2);

    await runScan(harness, session, source.id, boardResult([normalizedJob({ external_id: '1' })]));
    const ok = await sourceRow();
    expect(ok.health_state).toBe('ok');
    expect(ok.consecutive_denials).toBe(0);
    expect(ok.consecutive_failures).toBe(0);
    expect(ok.last_error_code).toBeNull();

    await runScan(harness, session, source.id, deniedResult('ACCESS_DENIED'));
    await runScan(harness, session, source.id, deniedResult('ACCESS_DENIED'));
    expect((await sourceRow()).health_state).toBe('degraded');
  });

  it('honours Retry-After by pushing next_scan_after out at least that far', async () => {
    const source = await createSource(harness, session);
    const fetchedAt = new Date();
    const retryAfterSeconds = 3 * 24 * 60 * 60; // longer than the scan interval
    await runScan(
      harness,
      session,
      source.id,
      deniedResult('RATE_LIMITED', { retryAfterSeconds, fetchedAt: fetchedAt.toISOString() }),
    );
    const row = await sourceRow();
    expect(row.next_scan_after!.getTime()).toBeGreaterThanOrEqual(
      fetchedAt.getTime() + retryAfterSeconds * 1000,
    );
    expect(row.last_error_code).toBe('RATE_LIMITED');
  });

  it('applies the jobs a partially refused fetch did return, without closing anything', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([normalizedJob({ external_id: '1' }), normalizedJob({ external_id: '2' })], {
        fetched_at: hoursAgo(48),
      }),
    );
    await runScan(
      harness,
      session,
      source.id,
      boardResult([normalizedJob({ external_id: '1' })], { fetched_at: hoursAgo(30) }),
    );

    const { scan } = await runScan(
      harness,
      session,
      source.id,
      boardResult([normalizedJob({ external_id: '1' }), normalizedJob({ external_id: '3' })], {
        complete_snapshot: true,
        observed_health: { state: 'degraded', http_status: 429, retry_after_seconds: 60 },
        warnings: [{ code: 'RATE_LIMITED', message: 'Stopped on HTTP 429 after page 1.' }],
      }),
    );
    expect(scan.status).toBe('partial');
    expect(scan.complete_snapshot).toBe(false);
    expect(scan.counts).toMatchObject({ fetched: 2, created: 1, unchanged: 1, closed: 0 });
    expect(await jobRows()).toHaveLength(3);
    expect((await jobRows()).every((job) => job.status === 'active')).toBe(true);
    expect((await sourceRow()).consecutive_denials).toBe(1);
  });
});
