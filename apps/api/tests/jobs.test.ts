/**
 * Jobs: GET /jobs, GET /jobs/:id, PATCH /jobs/:id and the manual import
 * round trip (POST /jobs/import → fetch_job → applied result).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { FetchJobInput, JobDetailView, JobView, URL_FETCH_POLICY } from '@job-getter/contracts';
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
  failTask,
  jobResult,
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

function importJob(
  payload: Record<string, unknown>,
  as: Session = session,
  key = idempotencyKey(),
) {
  return harness.app.inject(
    authed(as, {
      method: 'POST',
      url: '/api/v1/jobs/import',
      headers: { 'idempotency-key': key },
      payload,
    }),
  );
}

function patchJob(id: string, payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(authed(as, { method: 'PATCH', url: `/api/v1/jobs/${id}`, payload }));
}

async function putExcludedCompanies(companies: string[]): Promise<void> {
  const current = (
    await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/preferences' }))
  ).json();
  const response = await harness.app.inject(
    authed(session, {
      method: 'PUT',
      url: '/api/v1/preferences',
      payload: {
        expected_revision: current.revision,
        config: { ...current.config, excluded_companies: companies },
      },
    }),
  );
  expect(response.statusCode).toBe(200);
}

/** Seeds a board with three jobs at distinct last_seen_at values. */
async function seedBoard(): Promise<string[]> {
  const source = await createSource(harness, session);
  await runScan(
    harness,
    session,
    source.id,
    boardResult([
      normalizedJob({ external_id: '1', title: 'Backend Engineer', company: 'Acme' }),
      normalizedJob({ external_id: '2', title: 'Data Scientist', company: 'Globex' }),
      normalizedJob({ external_id: '3', title: 'Frontend Engineer', company: 'Initech' }),
    ]),
  );
  const rows = await harness.db
    .selectFrom('jobs')
    .select(['id', 'canonical_key'])
    .orderBy('canonical_key', 'asc')
    .execute();
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------

describe('GET /jobs', () => {
  it('lists contract-valid views with provenance and a null match', async () => {
    await seedBoard();
    const page = await listJobs(harness, session);
    expect(page.items).toHaveLength(3);
    expect(page.next_cursor).toBeNull();
    for (const item of page.items) {
      expect(Value.Check(JobView, item), JSON.stringify([...Value.Errors(JobView, item)])).toBe(
        true,
      );
      expect(item['match']).toBeNull();
      expect(item['sources']).toHaveLength(1);
      expect(item['saved']).toBe(false);
      expect(item['excluded_reason']).toBeNull();
    }
  });

  it('filters by a case-insensitive substring of title or company, escaping LIKE metacharacters', async () => {
    await seedBoard();
    expect((await listJobs(harness, session, 'query=engineer')).items).toHaveLength(2);
    expect((await listJobs(harness, session, 'query=GLOBEX')).items).toHaveLength(1);
    expect((await listJobs(harness, session, 'query=%25')).items).toHaveLength(0);
    expect((await listJobs(harness, session, 'query=_')).items).toHaveLength(0);
  });

  it('paginates with an opaque cursor, newest last_seen_at first', async () => {
    await seedBoard();
    const first = await listJobs(harness, session, 'limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = await listJobs(harness, session, `limit=2&cursor=${first.next_cursor}`);
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    const ids = [...first.items, ...second.items].map((item) => item['id']);
    expect(new Set(ids).size).toBe(3);
  });

  it('rejects a limit above 100', async () => {
    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/jobs?limit=101' }),
    );
    expect(response.statusCode).toBe(400);
  });

  it('returns nothing for min_score or eligible until a match exists (M3)', async () => {
    await seedBoard();
    expect((await listJobs(harness, session, 'min_score=1')).items).toEqual([]);
    expect((await listJobs(harness, session, 'eligible=unknown')).items).toEqual([]);
  });

  it('hides excluded employers by default, marks them, and shows them on request', async () => {
    await seedBoard();
    await putExcludedCompanies(['  globex ']);

    const hidden = await listJobs(harness, session);
    expect(hidden.items.map((item) => item['company']).sort()).toEqual(['Acme', 'Initech']);

    const shown = await listJobs(harness, session, 'include_excluded=true');
    expect(shown.items).toHaveLength(3);
    const globex = shown.items.find((item) => item['company'] === 'Globex')!;
    expect(globex['excluded_reason']).toMatch(/excluded companies/);

    // The exclusion is still inspectable by id.
    expect((await readJob(harness, session, globex['id'] as string)).statusCode).toBe(200);

    // Editing the list takes effect immediately; nothing was written on the job.
    await putExcludedCompanies([]);
    expect((await listJobs(harness, session)).items).toHaveLength(3);
    const row = await harness.db
      .selectFrom('jobs')
      .select('excluded_reason')
      .where('id', '=', globex['id'] as string)
      .executeTakeFirstOrThrow();
    expect(row.excluded_reason).toBeNull();
  });

  it('filters by status and saved', async () => {
    const [first] = await seedBoard();
    await patchJob(first!, { expected_revision: 1, saved: true });
    expect((await listJobs(harness, session, 'saved=true')).items.map((i) => i['id'])).toEqual([
      first,
    ]);
    expect((await listJobs(harness, session, 'saved=false')).items).toHaveLength(2);

    await patchJob(first!, { expected_revision: 2, status: 'closed' });
    expect((await listJobs(harness, session, 'status=closed')).items.map((i) => i['id'])).toEqual([
      first,
    ]);
    expect((await listJobs(harness, session, 'status=active')).items).toHaveLength(2);
  });
});

describe('GET /jobs/:id', () => {
  it('returns the detail view with description, requirements and evidence', async () => {
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([
        normalizedJob({
          external_id: '1',
          description_text: 'We need Rust and Kubernetes.',
          requirements: [
            { text: 'Rust', kind: 'required', evidence_excerpt: 'We need Rust' },
            { text: 'Kubernetes', kind: 'preferred', evidence_excerpt: 'and Kubernetes' },
          ],
        }),
      ]),
    );
    const job = await harness.db.selectFrom('jobs').select('id').executeTakeFirstOrThrow();
    const response = await readJob(harness, session, job.id);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(
      Value.Check(JobDetailView, body),
      JSON.stringify([...Value.Errors(JobDetailView, body)]),
    ).toBe(true);
    expect(body.description_text).toBe('We need Rust and Kubernetes.');
    expect(body.requirements).toHaveLength(2);
    expect(body.last_fetched_at).not.toBeNull();
    expect(body.sources[0].canonical_url).toContain('/jobs/1');
  });

  it('answers 404 for an unknown id', async () => {
    expect((await readJob(harness, session, randomUUID())).statusCode).toBe(404);
  });
});

describe('PATCH /jobs/:id', () => {
  it('saves and unsaves against the expected revision', async () => {
    const [id] = await seedBoard();
    const saved = await patchJob(id!, { expected_revision: 1, saved: true });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ saved: true, revision: 2, status: 'active' });

    const stale = await patchJob(id!, { expected_revision: 1, saved: false });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STALE_REVISION');

    const unsaved = await patchJob(id!, { expected_revision: 2, saved: false });
    expect(unsaved.json()).toMatchObject({ saved: false, revision: 3 });
  });

  it('closes immediately on explicit user closure', async () => {
    const [id] = await seedBoard();
    const closed = await patchJob(id!, { expected_revision: 1, status: 'closed' });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe('closed');
    const row = await harness.db
      .selectFrom('jobs')
      .select(['closed_reason', 'closed_at'])
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(row.closed_reason).toBe('user');
    expect(row.closed_at).not.toBeNull();
  });

  it('corrects the title and company the source got wrong, and keeps the correction', async () => {
    // The pilot's other finding: a page with no JSON-LD is read as visible
    // text and the import says so, asking the reader to review the title and
    // company. There was no way to.
    const source = await createSource(harness, session);
    await runScan(
      harness,
      session,
      source.id,
      boardResult([
        normalizedJob({
          external_id: '9',
          title: 'Job Application for Software Engineer at Greenhouse',
          company: '(company not stated)',
        }),
      ]),
    );
    const [id] = await harness.db
      .selectFrom('jobs')
      .select('id')
      .execute()
      .then((rows) => rows.map((row) => row.id));

    const corrected = await patchJob(id!, {
      expected_revision: 1,
      title: 'Software Engineer',
      company: 'Greenhouse',
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({
      title: 'Software Engineer',
      company: 'Greenhouse',
      revision: 2,
      edited_fields: ['company', 'title'],
    });

    // The next fetch of the same posting brings the same bad words back and
    // must not win: on a board scanned daily the correction would not last.
    await runScan(
      harness,
      session,
      source.id,
      boardResult([
        normalizedJob({
          external_id: '9',
          title: 'Job Application for Software Engineer at Greenhouse',
          company: '(company not stated)',
          description_text: 'The posting was edited upstream.',
        }),
      ]),
    );
    const after = (await readJob(harness, session, id!)).json();
    expect(after.title).toBe('Software Engineer');
    expect(after.company).toBe('Greenhouse');
    // Everything the user did not correct still follows the source.
    expect(after.description_text).toBe('The posting was edited upstream.');
  });

  it('does not claim the source’s own wording as a correction', async () => {
    const [id] = await seedBoard();
    const resent = await patchJob(id!, { expected_revision: 1, title: 'Backend Engineer' });
    expect(resent.statusCode).toBe(200);
    expect(resent.json().edited_fields).toEqual([]);
    const row = await harness.db
      .selectFrom('jobs')
      .select(['title_edited_at', 'company_edited_at'])
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(row.title_edited_at).toBeNull();
    expect(row.company_edited_at).toBeNull();
  });

  it('refuses to blank the words an application packet carries', async () => {
    const [id] = await seedBoard();
    expect((await patchJob(id!, { expected_revision: 1, title: '' })).statusCode).toBe(400);
    expect((await patchJob(id!, { expected_revision: 1, company: '' })).statusCode).toBe(400);
  });

  it('rejects a status other than closed at the schema boundary', async () => {
    const [id] = await seedBoard();
    const response = await patchJob(id!, { expected_revision: 1, status: 'active' });
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('POST /jobs/import', () => {
  const PASTED =
    'Senior Platform Engineer at Initech. Remote within Spain. Requirements: Go, Terraform.';

  it('requires exactly one of url and description_text', async () => {
    expect((await importJob({})).statusCode).toBe(422);
    expect(
      (await importJob({ url: 'https://jobs.example/1', description_text: PASTED })).statusCode,
    ).toBe(422);
    expect(await harness.db.selectFrom('job_imports').selectAll().execute()).toEqual([]);
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toEqual([]);
  });

  it('refuses a non-https URL before anything is queued', async () => {
    const response = await importJob({ url: 'http://jobs.example/1' });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields).toHaveProperty('url');
    expect(await harness.db.selectFrom('tasks').selectAll().execute()).toEqual([]);
  });

  it('enqueues a fetch_job whose input satisfies FetchJobInput and carries the hard policy', async () => {
    const response = await importJob({
      url: 'https://jobs.example/postings/77',
      company: 'Example Co',
      title: 'Engineer',
      apply_url: 'https://jobs.example/apply/77',
    });
    expect(response.statusCode).toBe(202);

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', response.json().task_id)
      .executeTakeFirstOrThrow();
    expect(task.type).toBe('fetch_job');
    expect(Value.Check(FetchJobInput, task.payload)).toBe(true);
    const payload = task.payload as typeof FetchJobInput.static;
    expect(payload).toMatchObject({
      url: 'https://jobs.example/postings/77',
      description_text: null,
      company_hint: 'Example Co',
      title_hint: 'Engineer',
      apply_url_hint: 'https://jobs.example/apply/77',
      policy: {
        max_redirects: URL_FETCH_POLICY.maxRedirects,
        max_html_bytes: URL_FETCH_POLICY.maxHtmlBytes,
        timeout_seconds: URL_FETCH_POLICY.timeoutSeconds,
      },
    });

    const imported = await harness.db
      .selectFrom('job_imports')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(imported.task_id).toBe(task.id);
    expect(imported.id).toBe(payload.job_import_id);
    expect(imported.status).toBe('queued');

    // Until the worker answers, the task id resolves to no job.
    expect((await readJob(harness, session, task.id)).statusCode).toBe(404);
  });

  it('does not store the pasted text twice', async () => {
    const response = await importJob({ description_text: PASTED });
    expect(response.statusCode).toBe(202);
    const imported = await harness.db
      .selectFrom('job_imports')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(imported.input)).not.toContain('Initech');
    expect(imported.input).toMatchObject({ url: null, description_chars: PASTED.length });
  });

  it('replays the same Idempotency-Key', async () => {
    const key = idempotencyKey();
    const first = await importJob({ description_text: PASTED }, session, key);
    const second = await importJob({ description_text: PASTED }, session, key);
    expect(second.json()).toEqual(first.json());
    expect(await harness.db.selectFrom('job_imports').selectAll().execute()).toHaveLength(1);

    const different = await importJob({ description_text: `${PASTED} (edited)` }, session, key);
    expect(different.statusCode).toBe(409);
    expect(different.json().error.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('applies a resolved job with url provenance and makes it reachable by task id', async () => {
    const created = await importJob({
      url: 'https://jobs.example/postings/77?utm_source=newsletter',
      apply_url: 'https://jobs.example/apply/77',
    });
    const taskId = created.json().task_id as string;
    const claimed = await claimTask(harness, 'fetch_job');
    expect(claimed?.task_id).toBe(taskId);

    const fetched = normalizedJob({
      external_id: 'https://jobs.example/postings/77',
      source_key: 'url:https://jobs.example/postings/77',
      canonical_url: 'https://jobs.example/postings/77',
      apply_url: null,
      company: 'Example Co',
      title: 'Platform Engineer',
    });
    const completed = await completeTask(harness, taskId, claimed!.lease_token, jobResult(fetched));
    expect(completed.statusCode).toBe(200);

    const byTask = await readJob(harness, session, taskId);
    expect(byTask.statusCode).toBe(200);
    const job = byTask.json();
    expect(job.canonical_key).toBe('url:https://jobs.example/postings/77');
    expect(job.sources).toHaveLength(1);
    expect(job.sources[0]).toMatchObject({
      connector: 'url',
      source_id: null,
      // The user's hint filled the gap the page left.
      apply_url: 'https://jobs.example/apply/77',
    });

    const imported = await harness.db
      .selectFrom('job_imports')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(imported.status).toBe('resolved');
    expect(imported.job_id).toBe(job.id);

    // The documented extension of the stored task result.
    const task = (
      await harness.app.inject(authed(session, { method: 'GET', url: `/api/v1/tasks/${taskId}` }))
    ).json();
    expect(task.result.job_import).toEqual({
      id: imported.id,
      status: 'resolved',
      job_id: job.id,
    });
    expect(task.result.job.title).toBe('Platform Engineer');
  });

  it('links a pasted board link to the posting the connector already found', async () => {
    // The pilot's finding: pasting the link to a posting the board connector
    // had already discovered produced a *second* job. Neither source key nor
    // canonical key can see across the two paths, and the placeholder company
    // and title an unstructured page yields leave the similarity warning with
    // nothing to compare either, so the duplicate was silent.
    const board = await createSource(harness, session);
    const page = `https://boards.greenhouse.io/${BOARD}/jobs/8214721`;
    await runScan(
      harness,
      session,
      board.id,
      boardResult([normalizedJob({ external_id: '8214721', apply_url: null })]),
    );

    // Tracking parameters are part of the link people actually copy.
    const created = await importJob({ url: `${page}?utm_source=newsletter` });
    const taskId = created.json().task_id as string;
    const claimed = await claimTask(harness, 'fetch_job');
    await completeTask(
      harness,
      taskId,
      claimed!.lease_token,
      jobResult(
        normalizedJob({
          external_id: page,
          source_key: `url:${page}`,
          canonical_url: page,
          apply_url: null,
          // What an unstructured page actually yields.
          company: '(company not stated)',
          title: 'Job Application for Engineer 8214721',
        }),
      ),
    );

    const jobs = await harness.db.selectFrom('jobs').selectAll().execute();
    expect(jobs).toHaveLength(1);
    // The board identity keeps the canonical key; the paste becomes provenance.
    expect(jobs[0]!.canonical_key).toBe(`greenhouse:${BOARD}:8214721`);
    // The placeholder title from the unstructured page does not overwrite the
    // board's own words.
    expect(jobs[0]!.title).toBe('Engineer 8214721');

    const provenance = await harness.db
      .selectFrom('job_sources')
      .selectAll()
      .where('job_id', '=', jobs[0]!.id)
      .execute();
    expect(provenance.map((row) => row.connector).sort()).toEqual(['greenhouse', 'url']);
  });

  it('records candidates for the user to choose from when the page held several postings', async () => {
    const created = await importJob({ url: 'https://careers.example/jobs' });
    const taskId = created.json().task_id as string;
    const claimed = await claimTask(harness, 'fetch_job');

    const candidates = [
      normalizedJob({
        external_id: 'a',
        source_key: 'url:https://careers.example/jobs/a',
        canonical_url: 'https://careers.example/jobs/a',
      }),
      normalizedJob({
        external_id: 'b',
        source_key: 'url:https://careers.example/jobs/b',
        canonical_url: 'https://careers.example/jobs/b',
      }),
    ];
    await completeTask(
      harness,
      taskId,
      claimed!.lease_token,
      jobResult(null, {
        candidates,
        warnings: [{ code: 'MULTIPLE_POSTINGS', message: 'The page lists 2 postings.' }],
        fetch: {
          performed: true,
          final_url: 'https://careers.example/jobs',
          http_status: 200,
          content_type: 'text/html',
          bytes: 4096,
          redirects: 0,
          extraction: 'jsonld_jobposting',
        },
      }),
    );

    // No job is created on the user's behalf.
    expect(await harness.db.selectFrom('jobs').selectAll().execute()).toEqual([]);
    expect((await readJob(harness, session, taskId)).statusCode).toBe(404);

    const imported = await harness.db
      .selectFrom('job_imports')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(imported.status).toBe('needs_choice');
    expect(imported.candidates).toHaveLength(2);

    const task = (
      await harness.app.inject(authed(session, { method: 'GET', url: `/api/v1/tasks/${taskId}` }))
    ).json();
    expect(task.result.job_import).toMatchObject({ status: 'needs_choice', job_id: null });
    expect(task.result.candidates).toHaveLength(2);
    expect(task.result.warnings[0].code).toBe('MULTIPLE_POSTINGS');
  });

  it('applies a pasted description as a manual job', async () => {
    const created = await importJob({ description_text: PASTED, company: 'Initech' });
    const taskId = created.json().task_id as string;
    const claimed = await claimTask(harness, 'fetch_job');
    const parsed = normalizedJob({
      external_id: 'pasted',
      source_key: 'manual:pasted-1',
      canonical_url: 'manual:pasted-1',
      apply_url: null,
      company: 'Initech',
      title: 'Senior Platform Engineer',
      description_text: PASTED,
    });
    await completeTask(
      harness,
      taskId,
      claimed!.lease_token,
      jobResult(parsed, {
        fetch: {
          performed: false,
          final_url: null,
          http_status: null,
          content_type: null,
          bytes: null,
          redirects: 0,
          extraction: 'pasted_text',
        },
      }),
    );
    const job = (await readJob(harness, session, taskId)).json();
    expect(job.sources[0].connector).toBe('manual');
    expect(job.canonical_key).toBe(`manual:${parsed.content_hash}`);
  });

  it('marks the import failed when the fetch fails terminally', async () => {
    const created = await importJob({ url: 'https://blocked.example/job' });
    const taskId = created.json().task_id as string;
    const claimed = await claimTask(harness, 'fetch_job');
    const failed = await failTask(harness, taskId, claimed!.lease_token, {
      code: 'FETCH_BLOCKED',
      retryable: false,
      redacted_message: 'The destination resolved to a private address.',
    });
    expect(failed.statusCode).toBe(200);
    const imported = await harness.db
      .selectFrom('job_imports')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(imported.status).toBe('failed');
    expect(imported.error_code).toBe('FETCH_BLOCKED');
    expect((await readJob(harness, session, taskId)).statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('workspace isolation', () => {
  it("answers 404 for another workspace's job on read and patch, identically to an absent id", async () => {
    const [id] = await seedBoard();
    const other = await createSecondWorkspace(harness);

    const foreign = await readJob(harness, other, id!);
    const absent = await readJob(harness, other, randomUUID());
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.message).toBe(absent.json().error.message);
    expect(foreign.body).not.toContain('Acme');

    expect((await patchJob(id!, { expected_revision: 1, saved: true }, other)).statusCode).toBe(
      404,
    );
    expect((await listJobs(harness, other)).items).toEqual([]);

    const untouched = await harness.db
      .selectFrom('jobs')
      .select(['saved', 'revision'])
      .where('id', '=', id!)
      .executeTakeFirstOrThrow();
    expect(untouched).toEqual({ saved: false, revision: 1 });
  });

  it("does not resolve another workspace's import task id to a job", async () => {
    const created = await importJob({ url: 'https://jobs.example/postings/1' });
    const taskId = created.json().task_id as string;
    const claimed = await claimTask(harness, 'fetch_job');
    await completeTask(
      harness,
      taskId,
      claimed!.lease_token,
      jobResult(
        normalizedJob({
          external_id: 'x',
          source_key: 'url:https://jobs.example/postings/1',
          canonical_url: 'https://jobs.example/postings/1',
        }),
      ),
    );
    expect((await readJob(harness, session, taskId)).statusCode).toBe(200);
    const other = await createSecondWorkspace(harness);
    expect((await readJob(harness, other, taskId)).statusCode).toBe(404);
  });
});
