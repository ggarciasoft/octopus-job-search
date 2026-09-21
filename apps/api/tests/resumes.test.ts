/**
 * POST /resumes, GET /resumes/:id and approval (M3, PR07).
 *
 * The generation itself lives in the worker and is tested there. What is
 * tested here is what the API owes the user around it:
 *
 *  * original mode references the uploaded file and generates nothing, so the
 *    bytes the user sends are the bytes they chose (AT11);
 *  * a mode's shape is enforced rather than guessed at, because picking for
 *    the user is how somebody sends a generated CV when they meant to send
 *    their own;
 *  * approval is a user action on a ready document and nothing else can set
 *    it, which is what "user approval is mandatory" has to mean in storage;
 *  * a failed generation leaves a visible failed resume, not silence.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RenderCvInput, RenderCvResult, ResumeView } from '@job-getter/contracts';
import {
  authed,
  completeSetup,
  createHarness,
  type Harness,
  type Session,
} from './helpers/harness.js';
import { claimTask, completeTask, failTask } from './helpers/discovery.js';

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

async function addConfirmedFact(kind: string, value: unknown): Promise<void> {
  const profile = await harness.app.inject(
    authed(session, { method: 'GET', url: '/api/v1/profile' }),
  );
  const revision = profile.json().revision as number;
  const patched = await harness.app.inject(
    authed(session, {
      method: 'PATCH',
      url: '/api/v1/profile',
      payload: {
        expected_revision: revision,
        changes: [{ op: 'upsert', kind, value, confirmed: true }],
      },
    }),
  );
  expect(patched.statusCode, patched.body).toBe(200);
}

async function seedProfile(): Promise<void> {
  await addConfirmedFact('contact', {
    full_name: 'Ada Lovelace',
    email: 'ada@example.invalid',
    city: 'Montevideo',
    country: 'Uruguay',
  });
  await addConfirmedFact('skill', {
    canonical_name: 'Python',
    aliases: [],
    user_declared_proficiency: null,
    years: null,
  });
}

function create(body: Record<string, unknown>, key = `resume-${Math.random()}`) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/resumes',
      headers: { 'idempotency-key': key },
      payload: body,
    }),
  );
}

async function readResume(id: string): Promise<ResumeView> {
  const response = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/resumes/${id}` }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ResumeView;
}

function renderResult(overrides: Partial<RenderCvResult> = {}): RenderCvResult {
  return {
    document_json: {
      schema_version: 1,
      language: 'en',
      contact: {
        full_name: 'Ada Lovelace',
        email: 'ada@example.invalid',
        phone: null,
        location: null,
        links: [],
        fact_ids: [],
      },
      sections: [],
    },
    validation: {
      passed_automatic_checks: true,
      findings: [],
      fact_ids: [],
      provenance: {
        template_version: 'simple/v1',
        prompt_version: null,
        provider: null,
        model: null,
        deterministic: true,
      },
      pdf_pages: 1,
    },
    pdf_file_id: null,
    docx_file_id: null,
    fact_ids: [],
    ...overrides,
  };
}

/** Queues, claims and completes one generation; returns the worker's input. */
async function runRender(resumeId: string, result = renderResult()): Promise<RenderCvInput> {
  const claimed = await claimTask(harness, 'render_cv');
  expect(claimed).not.toBeNull();
  const completed = await completeTask(harness, claimed!.task_id, claimed!.lease_token, result);
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json().state).toBe('succeeded');
  void resumeId;
  return claimed!.input as RenderCvInput;
}

async function uploadCv(): Promise<string> {
  const boundary = '----jobgetterboundary';
  const head = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="purpose"',
    '',
    'cv_original',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="cv.pdf"',
    'Content-Type: application/pdf',
    '',
    '',
  ].join('\r\n');
  // A minimal well-formed PDF: the upload validator sniffs the magic bytes.
  const content = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';
  const tail = ['', `--${boundary}--`, ''].join('\r\n');

  const response = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(head + content + tail, 'binary'),
    }),
  );
  expect(response.statusCode, response.body).toBe(201);
  // The upload answers { file, validation }; the id lives on `file`.
  return response.json().file.id as string;
}

// ---------------------------------------------------------------------------

describe('POST /resumes, tailored', () => {
  it('queues a render_cv task and leaves the resume queued', async () => {
    await seedProfile();
    const response = await create({ mode: 'tailored' });

    expect(response.statusCode, response.body).toBe(202);
    const rows = await harness.db.selectFrom('resumes').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('queued');
    expect(rows[0]!.document_json).toBeNull();
  });

  it('sends only confirmed facts to the worker', async () => {
    await seedProfile();
    await harness.app.inject(
      authed(session, {
        method: 'PATCH',
        url: '/api/v1/profile',
        payload: {
          expected_revision: (
            await harness.app
              .inject(authed(session, { method: 'GET', url: '/api/v1/profile' }))
              .then((r) => r.json())
          ).revision,
          changes: [
            {
              op: 'upsert',
              kind: 'skill',
              value: {
                canonical_name: 'Rust',
                aliases: [],
                user_declared_proficiency: null,
                years: null,
              },
              confirmed: false,
            },
          ],
        },
      }),
    );

    const created = await create({ mode: 'tailored' });
    const input = await runRender(created.json().task_id as string);

    expect(input.confirmed_facts.every((fact) => fact.confirmed)).toBe(true);
    expect(JSON.stringify(input.confirmed_facts)).not.toContain('Rust');
  });

  it('refuses a tailored CV when no contact fact is confirmed', async () => {
    // Found on a live stack: without this the task queued, then died in the
    // worker with a retryable INTERNAL_ERROR because the document had no name.
    await addConfirmedFact('skill', {
      canonical_name: 'Python',
      aliases: [],
      user_declared_proficiency: null,
      years: null,
    });

    const response = await create({ mode: 'tailored' });

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.fields).toHaveProperty('profile');
    // Nothing was queued: the user gets the answer now, not in ten seconds.
    expect(await claimTask(harness, 'render_cv')).toBeNull();
  });

  it('rejects an input file, because tailored mode generates the document', async () => {
    await seedProfile();
    const fileId = await uploadCv();
    const response = await create({ mode: 'tailored', input_file_id: fileId });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields).toHaveProperty('input_file_id');
  });

  it('stores the document with its validation when the worker reports back', async () => {
    await seedProfile();
    const created = await create({ mode: 'tailored' });
    const taskId = created.json().task_id as string;
    await runRender(taskId);

    const view = await readResume(taskId);
    expect(view.status).toBe('ready');
    expect(view.document).not.toBeNull();
    expect(view.validation?.passed_automatic_checks).toBe(true);
    expect(view.validation?.provenance.deterministic).toBe(true);
  });

  it('keeps the findings that qualify a document', async () => {
    await seedProfile();
    const created = await create({ mode: 'tailored' });
    const taskId = created.json().task_id as string;
    await runRender(
      taskId,
      renderResult({
        validation: {
          ...renderResult().validation,
          passed_automatic_checks: false,
          findings: [
            {
              code: 'NUMBER_NOT_IN_FACTS',
              severity: 'blocking',
              where: 'experience[0].bullets[0]',
              excerpt: 'Cut latency by 40%',
              removed: true,
            },
          ],
        },
      }),
    );

    const view = await readResume(taskId);
    expect(view.validation?.passed_automatic_checks).toBe(false);
    expect(view.validation?.findings[0]?.code).toBe('NUMBER_NOT_IN_FACTS');
    expect(view.validation?.findings[0]?.removed).toBe(true);
  });

  it('leaves a visible failed resume when generation fails', async () => {
    await seedProfile();
    const created = await create({ mode: 'tailored' });
    const taskId = created.json().task_id as string;

    const claimed = await claimTask(harness, 'render_cv');
    await failTask(harness, claimed!.task_id, claimed!.lease_token, {
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
      redacted_message: 'The provider did not answer.',
    });

    const view = await readResume(taskId);
    expect(view.status).toBe('failed');
    expect(view.error_code).toBe('PROVIDER_UNAVAILABLE');
    expect(view.error_message).toContain('did not answer');
  });
});

describe('POST /resumes, original', () => {
  it('references the uploaded file and generates nothing', async () => {
    await seedProfile();
    const fileId = await uploadCv();
    const response = await create({ mode: 'original', input_file_id: fileId });

    expect(response.statusCode, response.body).toBe(202);
    const rows = await harness.db.selectFrom('resumes').selectAll().execute();
    expect(rows[0]!.mode).toBe('original');
    // Ready at once: there is nothing to generate, which is the whole point.
    expect(rows[0]!.status).toBe('ready');
    expect(rows[0]!.input_file_id).toBe(fileId);
    expect(rows[0]!.document_json).toBeNull();
    expect(rows[0]!.task_id).toBeNull();

    // No render task was queued.
    expect(await claimTask(harness, 'render_cv')).toBeNull();
  });

  it('requires the file to send', async () => {
    await seedProfile();
    const response = await create({ mode: 'original' });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields).toHaveProperty('input_file_id');
  });

  it('404s for a file in another workspace', async () => {
    await seedProfile();
    const response = await create({
      mode: 'original',
      input_file_id: '00000000-0000-4000-8000-000000000000',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('approval', () => {
  async function readyResume(): Promise<string> {
    await seedProfile();
    const created = await create({ mode: 'tailored' });
    const taskId = created.json().task_id as string;
    await runRender(taskId);
    return (await readResume(taskId)).id;
  }

  function approve(id: string, approved: boolean) {
    return harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/resumes/${id}/approve`,
        payload: { approved },
      }),
    );
  }

  it('is never set by generation alone', async () => {
    const id = await readyResume();
    const view = await readResume(id);

    expect(view.status).toBe('ready');
    expect(view.approved_at).toBeNull();
  });

  it('records an explicit user approval', async () => {
    const id = await readyResume();
    const response = await approve(id, true);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().approved_at).not.toBeNull();
  });

  it('can be withdrawn', async () => {
    const id = await readyResume();
    await approve(id, true);
    const response = await approve(id, false);

    expect(response.json().approved_at).toBeNull();
  });

  it('refuses to approve a CV that is not ready', async () => {
    await seedProfile();
    const created = await create({ mode: 'tailored' });
    const rows = await harness.db.selectFrom('resumes').selectAll().execute();

    const response = await approve(rows[0]!.id, true);
    expect(response.statusCode).toBe(409);
    void created;
  });
});

describe('reading a resume', () => {
  it('resolves the render task id as well as the resume id', async () => {
    await seedProfile();
    const created = await create({ mode: 'tailored' });
    const taskId = created.json().task_id as string;
    await runRender(taskId);

    const viaTask = await readResume(taskId);
    const viaId = await readResume(viaTask.id);
    expect(viaId.id).toBe(viaTask.id);
  });

  it('404s for a resume in another workspace', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'GET',
        url: '/api/v1/resumes/00000000-0000-4000-8000-000000000000',
      }),
    );
    expect(response.statusCode).toBe(404);
  });
});
