/**
 * POST /jobs/:id/match and the match a job carries afterwards (M3, PR06).
 *
 * The scoring itself lives in the worker and is tested there. What is tested
 * here is everything the API is responsible for and could get wrong in a way
 * that misrepresents a user:
 *
 *  * only *confirmed* facts leave the API, so a draft extraction can never be
 *    scored as though the user had agreed to it;
 *  * a stored match is keyed on the revisions that produced it, so re-scoring
 *    unchanged inputs updates one row instead of accumulating history;
 *  * when any input moves on, the old score is still shown but marked stale,
 *    rather than silently recomputed or silently hidden;
 *  * `min_score` and `eligible` never invent a verdict for a job nobody has
 *    scored.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MatchJobInput, MatchJobResult, JobDetailView } from '@job-getter/contracts';
import {
  authed,
  completeSetup,
  createHarness,
  type Harness,
  type Session,
} from './helpers/harness.js';
import {
  boardResult,
  claimTask,
  completeTask,
  createSource,
  listJobs,
  normalizedJob,
  readJob,
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

/** Discovers one job through a real scan so its provenance is genuine. */
async function seedJob(): Promise<string> {
  const source = await createSource(harness, session);
  await runScan(
    harness,
    session,
    source.id,
    boardResult([
      normalizedJob({
        external_id: 'job-1',
        title: 'Senior Backend Engineer',
        requirements: [
          { text: 'Strong Python experience', kind: 'required', evidence_excerpt: 'Python' },
        ],
      }),
    ]),
  );
  const { items } = await listJobs(harness, session);
  return items[0]!.id as string;
}

function queueMatch(jobId: string, idempotencyKey = `match-${jobId}-${Math.random()}`) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/match`,
      headers: { 'idempotency-key': idempotencyKey },
      payload: {},
    }),
  );
}

function matchResult(overrides: Partial<MatchJobResult> = {}): MatchJobResult {
  return {
    eligible: 'unknown',
    score: 72,
    coverage_percent: 90,
    explanation: {
      algorithm_version: 'v1',
      alias_map_version: 'v1',
      components: [],
      eligibility: [],
      requirements: [],
      unknown_components: ['industry'],
      fact_ids: [],
      evaluated_weight: 90,
    },
    computed_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Queues, claims and completes one match; returns the task input the worker saw. */
async function runMatch(
  jobId: string,
  result: MatchJobResult = matchResult(),
): Promise<MatchJobInput> {
  const queued = await queueMatch(jobId);
  expect(queued.statusCode, queued.body).toBe(202);
  const taskId = queued.json().task_id as string;

  const claimed = await claimTask(harness, 'match_job');
  expect(claimed?.task_id).toBe(taskId);
  const completed = await completeTask(harness, taskId, claimed!.lease_token, result);
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json().state).toBe('succeeded');

  return claimed!.input as MatchJobInput;
}

async function detail(jobId: string): Promise<JobDetailView> {
  const response = await readJob(harness, session, jobId);
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as JobDetailView;
}

async function addFact(kind: string, value: unknown, confirmed: boolean): Promise<void> {
  const profile = await harness.app.inject(
    authed(session, { method: 'GET', url: '/api/v1/profile' }),
  );
  expect(profile.statusCode, profile.body).toBe(200);
  const revision = profile.json().revision as number;

  const patched = await harness.app.inject(
    authed(session, {
      method: 'PATCH',
      url: '/api/v1/profile',
      payload: {
        expected_revision: revision,
        changes: [{ op: 'upsert', kind, value, confirmed }],
      },
    }),
  );
  expect(patched.statusCode, patched.body).toBe(200);
}

const PYTHON_SKILL = {
  canonical_name: 'Python',
  aliases: [],
  user_declared_proficiency: null,
  years: null,
};

// ---------------------------------------------------------------------------

describe('POST /jobs/:id/match', () => {
  it('queues a match_job task and answers 202', async () => {
    const jobId = await seedJob();
    const response = await queueMatch(jobId);

    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({ status: 'queued' });
  });

  it('404s for a job in another workspace rather than leaking its existence', async () => {
    const response = await queueMatch('00000000-0000-4000-8000-000000000000');
    expect(response.statusCode).toBe(404);
  });

  it('sends only confirmed facts to the worker', async () => {
    const jobId = await seedJob();
    await addFact('skill', PYTHON_SKILL, true);
    await addFact(
      'skill',
      { canonical_name: 'Rust', aliases: [], user_declared_proficiency: null, years: null },
      false,
    );

    const input = await runMatch(jobId);

    expect(input.confirmed_facts).toHaveLength(1);
    expect(input.confirmed_facts.every((fact) => fact.confirmed)).toBe(true);
    expect(JSON.stringify(input.confirmed_facts)).not.toContain('Rust');
  });

  it('carries the job snapshot and every input revision', async () => {
    const jobId = await seedJob();
    const input = await runMatch(jobId);

    expect(input.job_id).toBe(jobId);
    expect(input.job.title).toBe('Senior Backend Engineer');
    expect(input.job.requirements).toHaveLength(1);
    expect(input.job_revision).toBeGreaterThanOrEqual(1);
    expect(input.profile_revision).toBeGreaterThanOrEqual(1);
    expect(input.preferences_revision).toBeGreaterThanOrEqual(1);
  });

  it('reuses the stored response for a repeated idempotency key', async () => {
    const jobId = await seedJob();
    const key = 'same-key';
    const first = await queueMatch(jobId, key);
    const second = await queueMatch(jobId, key);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().task_id).toBe(first.json().task_id);
  });
});

describe('a completed match', () => {
  it('appears on the job with its explanation', async () => {
    const jobId = await seedJob();
    await runMatch(jobId);
    const view = await detail(jobId);

    expect(view.match).toMatchObject({ score: 72, coverage_percent: 90, eligible: 'unknown' });
    expect(view.match_explanation).not.toBeNull();
    expect(view.match_explanation?.algorithm_version).toBe('v1');
  });

  it('is not stale while its inputs are unchanged', async () => {
    const jobId = await seedJob();
    await runMatch(jobId);

    expect((await detail(jobId)).match?.stale).toBe(false);
  });

  it('reads as stale once the profile moves on, and is not recomputed', async () => {
    const jobId = await seedJob();
    await runMatch(jobId);
    await addFact('skill', PYTHON_SKILL, true);

    const view = await detail(jobId);
    expect(view.match?.stale).toBe(true);
    // Still the old number, visibly out of date rather than quietly replaced.
    expect(view.match?.score).toBe(72);
  });

  it('reads as stale once preferences move on', async () => {
    const jobId = await seedJob();
    await runMatch(jobId);

    const current = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/preferences' }),
    );
    const body = current.json();
    const updated = await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/preferences',
        payload: {
          expected_revision: body.revision,
          config: { ...body.config, target_titles: ['Backend Engineer'] },
        },
      }),
    );
    expect(updated.statusCode, updated.body).toBe(200);

    expect((await detail(jobId)).match?.stale).toBe(true);
  });

  it('rewrites one row when the same inputs are scored again', async () => {
    const jobId = await seedJob();
    await runMatch(jobId);
    await runMatch(jobId, matchResult({ score: 81, coverage_percent: 90 }));

    const rows = await harness.db.selectFrom('matches').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(81);
  });

  it('stores a null score without turning it into a zero', async () => {
    const jobId = await seedJob();
    await runMatch(
      jobId,
      matchResult({
        score: null,
        coverage_percent: 0,
        explanation: {
          ...matchResult().explanation,
          evaluated_weight: 0,
          unknown_components: ['skills', 'role_title', 'seniority', 'work_arrangement', 'industry'],
        },
      }),
    );

    const view = await detail(jobId);
    expect(view.match?.score).toBeNull();
    expect(view.match?.coverage_percent).toBe(0);
  });
});

describe('a job nobody has scored', () => {
  it('reports no match rather than a zero', async () => {
    const jobId = await seedJob();
    const view = await detail(jobId);

    expect(view.match).toBeNull();
    expect(view.match_explanation).toBeNull();
  });

  it('is absent from a min_score page', async () => {
    await seedJob();
    const { items } = await listJobs(harness, session, 'min_score=0');

    expect(items).toHaveLength(0);
  });

  it('is absent from an eligible page', async () => {
    await seedJob();
    const { items } = await listJobs(harness, session, 'eligible=unknown');

    expect(items).toHaveLength(0);
  });
});

describe('filtering on a stored match', () => {
  it('min_score keeps a job at or above the threshold', async () => {
    const jobId = await seedJob();
    await runMatch(jobId, matchResult({ score: 72 }));

    expect((await listJobs(harness, session, 'min_score=70')).items).toHaveLength(1);
    expect((await listJobs(harness, session, 'min_score=80')).items).toHaveLength(0);
  });

  it('a null score passes no threshold, not even zero', async () => {
    const jobId = await seedJob();
    await runMatch(
      jobId,
      matchResult({
        score: null,
        coverage_percent: 0,
        explanation: { ...matchResult().explanation, evaluated_weight: 0 },
      }),
    );

    expect((await listJobs(harness, session, 'min_score=0')).items).toHaveLength(0);
  });

  it('eligible selects on the stored verdict', async () => {
    const jobId = await seedJob();
    await runMatch(jobId, matchResult({ eligible: 'yes' }));

    expect((await listJobs(harness, session, 'eligible=yes')).items).toHaveLength(1);
    expect((await listJobs(harness, session, 'eligible=no')).items).toHaveLength(0);
  });
});
