/**
 * Applications, packets, approval and the tracker (M4, PR08/PR09).
 *
 * The acceptance scenarios these cover directly:
 *
 *  * **AT13** — edit a packet after approval and the old approval is rejected;
 *    the user has to read and approve the new one.
 *  * **AT14** — a required question with no answer pauses the application in
 *    `needs_input`, and nothing fills it in.
 *  * The invalidation rules from 03_DATA_MODEL.md: a new profile revision, a
 *    replaced CV or an expired clock all withdraw an approval on the next read
 *    rather than leaving it standing.
 *
 * Everything runs against the real routes and a real PostgreSQL, so the
 * constraints in `0005_applications.sql` are part of what is being tested.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AnswerBankEntry,
  ApplicationEventView,
  ApplicationView,
  PacketAnswer,
} from '@job-getter/contracts';
import {
  authed,
  completeSetup,
  createHarness,
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
  normalizedJob,
  queueScan,
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

// ---------------------------------------------------------------------------
// Fixtures: a discovered job and an original-mode CV
// ---------------------------------------------------------------------------

/** Discovers one Greenhouse job so it arrives with a real apply URL. */
async function seedJob(
  externalId = 'eng-1',
  overrides: Record<string, unknown> = {},
  board = BOARD,
) {
  const source = await createSource(harness, session, {
    connector: 'greenhouse',
    board_key: board,
  });
  const queued = await queueScan(harness, session, source.id);
  expect(queued.statusCode, queued.body).toBe(202);
  const claimed = await claimTask(harness, 'fetch_board');
  expect(claimed).not.toBeNull();
  const completed = await completeTask(
    harness,
    claimed!.task_id,
    claimed!.lease_token,
    boardResult([normalizedJob({ external_id: externalId, board, ...overrides })]),
  );
  expect(completed.statusCode, completed.body).toBe(200);

  // Find it by its provenance rather than by title: a test that deliberately
  // gives two postings the same title cannot identify them by it.
  const provenance = await harness.db
    .selectFrom('job_sources')
    .select(['job_id'])
    .where('external_id', '=', externalId)
    .executeTakeFirstOrThrow();
  const jobs = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/jobs' }));
  expect(jobs.statusCode, jobs.body).toBe(200);
  const items = jobs.json().items as { id: string; company: string; title: string }[];
  const job = items.find((row) => row.id === provenance.job_id);
  expect(job, `no job for ${externalId}`).toBeDefined();
  return job!;
}

/** An original-mode CV: one upload, referenced unchanged, ready immediately. */
async function seedResume(): Promise<string> {
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
  const content = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';
  const tail = ['', `--${boundary}--`, ''].join('\r\n');

  const upload = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(head + content + tail, 'binary'),
    }),
  );
  expect(upload.statusCode, upload.body).toBe(201);

  const resume = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/resumes',
      headers: { 'idempotency-key': idempotencyKey() },
      payload: { mode: 'original', input_file_id: upload.json().file.id as string },
    }),
  );
  expect(resume.statusCode, resume.body).toBe(202);
  // Original mode has no task, so the id it returns is the resume itself.
  return resume.json().task_id as string;
}

function answer(overrides: Partial<PacketAnswer> = {}): PacketAnswer {
  return {
    question_key: 'why_this_role',
    label: 'Why do you want this role?',
    answer: 'Because the work is interesting.',
    required: true,
    sensitivity: 'standard',
    provenance: 'user_entered',
    source_id: null,
    ...overrides,
  };
}

async function createApplication(jobId: string): Promise<ApplicationView> {
  const response = await harness.app.inject(
    authed(session, { method: 'POST', url: '/api/v1/applications', payload: { job_id: jobId } }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ApplicationView;
}

async function readApplication(id: string): Promise<ApplicationView> {
  const response = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/applications/${id}` }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ApplicationView;
}

function postPacket(application: ApplicationView, body: Record<string, unknown>) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/applications/${application.id}/packets`,
      headers: { 'idempotency-key': idempotencyKey() },
      payload: { expected_revision: application.revision, ...body },
    }),
  );
}

function postApprove(application: ApplicationView, body: Record<string, unknown>) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/applications/${application.id}/approve`,
      payload: { expected_revision: application.revision, ...body },
    }),
  );
}

function postOutcome(application: ApplicationView, body: Record<string, unknown>) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/applications/${application.id}/outcome`,
      payload: { expected_revision: application.revision, ...body },
    }),
  );
}

async function events(id: string): Promise<ApplicationEventView[]> {
  const response = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/applications/${id}/events` }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json().items as ApplicationEventView[];
}

/** Prepares an approved application and returns its latest view. */
async function approvedApplication(): Promise<{ view: ApplicationView; resumeId: string }> {
  const job = await seedJob();
  const resumeId = await seedResume();
  let view = await createApplication(job.id);
  expect((await postPacket(view, { resume_id: resumeId, answers: [answer()] })).statusCode).toBe(
    202,
  );
  view = await readApplication(view.id);
  expect(view.status).toBe('ready_for_review');
  const approved = await postApprove(view, {
    packet_id: view.current_packet!.id,
    content_hash: view.current_packet!.content_hash,
  });
  expect(approved.statusCode, approved.body).toBe(200);
  return { view: approved.json() as ApplicationView, resumeId };
}

// ---------------------------------------------------------------------------

describe('POST /applications', () => {
  it('returns the same application for the same job rather than creating two', async () => {
    const job = await seedJob();
    const first = await createApplication(job.id);
    const second = await createApplication(job.id);

    expect(second.id).toBe(first.id);
    const rows = await harness.db.selectFrom('applications').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it('starts in draft with the job denormalised for the tracker', async () => {
    const job = await seedJob();
    const application = await createApplication(job.id);

    expect(application.status).toBe('draft');
    expect(application.company).toBe(job.company);
    expect(application.title).toBe(job.title);
    expect(application.current_packet).toBeNull();
  });

  it('404s for a job that does not exist', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/applications',
        payload: { job_id: '00000000-0000-4000-8000-000000000000' },
      }),
    );
    expect(response.statusCode).toBe(404);
  });

  it('records a created event as sequence 1', async () => {
    const job = await seedJob();
    const application = await createApplication(job.id);
    const history = await events(application.id);

    expect(history).toHaveLength(1);
    expect(history[0]!.sequence).toBe(1);
    expect(history[0]!.type).toBe('created');
    expect(history[0]!.actor).toBe('user');
  });
});

describe('POST /applications/:id/packets', () => {
  it('snapshots the destination from the job rather than from the caller', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);

    expect((await postPacket(application, { resume_id: resumeId, answers: [] })).statusCode).toBe(
      202,
    );
    const view = await readApplication(application.id);

    expect(view.current_packet!.destination.url).toContain('boards.greenhouse.io');
    expect(view.current_packet!.destination.origin).toBe('https://boards.greenhouse.io');
    expect(view.current_packet!.destination.connector).toBe('greenhouse');
  });

  it('reaches ready_for_review when every required question is answered', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);

    expect(
      (await postPacket(application, { resume_id: resumeId, answers: [answer()] })).statusCode,
    ).toBe(202);
    const view = await readApplication(application.id);

    expect(view.status).toBe('ready_for_review');
    expect(view.current_packet!.revision).toBe(1);
    expect(view.current_packet!.unresolved_question_keys).toEqual([]);
  });

  it('AT14: a blank required answer pauses in needs_input and is not guessed', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);

    expect(
      (
        await postPacket(application, {
          resume_id: resumeId,
          answers: [answer({ question_key: 'notice_period', answer: null })],
        })
      ).statusCode,
    ).toBe(202);
    const view = await readApplication(application.id);

    expect(view.status).toBe('needs_input');
    expect(view.current_packet!.unresolved_question_keys).toEqual(['notice_period']);
    // The stored answer is still null: nothing inferred one.
    expect(view.current_packet!.answers[0]!.answer).toBeNull();
  });

  it('records the transient preparing state in the event path', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);
    await postPacket(application, { resume_id: resumeId, answers: [answer()] });

    const history = await events(application.id);
    const created = history.find((entry) => entry.type === 'packet_created');
    expect(created?.status_before).toBe('draft');
    expect(created?.status_after).toBe('ready_for_review');
    expect(created?.data.path).toEqual(['draft', 'preparing', 'ready_for_review']);
  });

  it('rejects a stale expected_revision', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);

    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/applications/${application.id}/packets`,
        headers: { 'idempotency-key': idempotencyKey() },
        payload: { expected_revision: 99, resume_id: resumeId, answers: [] },
      }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('STALE_REVISION');
  });

  it('requires an Idempotency-Key', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);

    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/applications/${application.id}/packets`,
        payload: { expected_revision: application.revision, resume_id: resumeId, answers: [] },
      }),
    );
    expect(response.statusCode).toBe(400);
  });

  it('404s for a CV that does not exist', async () => {
    const job = await seedJob();
    const application = await createApplication(job.id);

    const response = await postPacket(application, {
      resume_id: '00000000-0000-4000-8000-000000000000',
      answers: [],
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses a CV that is still being generated', async () => {
    const job = await seedJob();
    const application = await createApplication(job.id);

    // A tailored CV needs a confirmed contact fact, so seed one and queue it.
    const profile = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/profile' }),
    );
    await harness.app.inject(
      authed(session, {
        method: 'PATCH',
        url: '/api/v1/profile',
        payload: {
          expected_revision: profile.json().revision as number,
          changes: [
            {
              op: 'upsert',
              kind: 'contact',
              value: { full_name: 'Ada Lovelace', email: 'ada@example.invalid' },
              confirmed: true,
            },
          ],
        },
      }),
    );
    const queued = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/resumes',
        headers: { 'idempotency-key': idempotencyKey() },
        payload: { mode: 'tailored', job_id: job.id },
      }),
    );
    expect(queued.statusCode, queued.body).toBe(202);
    const resumeRow = await harness.db
      .selectFrom('resumes')
      .select(['id'])
      .executeTakeFirstOrThrow();

    const fresh = await readApplication(application.id);
    const response = await postPacket(fresh, { resume_id: resumeRow.id, answers: [] });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.message).toContain('not finished yet');
  });
});

describe('answer provenance', () => {
  async function storeAnswer(body: Record<string, unknown>): Promise<AnswerBankEntry> {
    const response = await harness.app.inject(
      authed(session, { method: 'PUT', url: '/api/v1/answer-bank', payload: body }),
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as AnswerBankEntry;
  }

  it('accepts a general stored answer', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);
    const entry = await storeAnswer({ question_key: 'notice_period', answer: '30 days' });

    const response = await postPacket(application, {
      resume_id: resumeId,
      answers: [
        answer({
          question_key: 'notice_period',
          answer: '30 days',
          provenance: 'answer_bank',
          source_id: entry.id,
        }),
      ],
    });
    expect(response.statusCode, response.body).toBe(202);
  });

  it('refuses an answer confirmed for a different company', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);
    const entry = await storeAnswer({
      question_key: 'salary_expectation',
      answer: '60000',
      scope: 'company',
      scope_id: 'Other Corp',
    });

    const response = await postPacket(application, {
      resume_id: resumeId,
      answers: [
        answer({
          question_key: 'salary_expectation',
          answer: '60000',
          provenance: 'answer_bank',
          source_id: entry.id,
        }),
      ],
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.message).toContain('different company');
  });

  it('refuses an unconfirmed stored answer', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);
    const entry = await storeAnswer({
      question_key: 'notice_period',
      answer: '30 days',
      confirmed: false,
    });

    const response = await postPacket(application, {
      resume_id: resumeId,
      answers: [
        answer({
          question_key: 'notice_period',
          answer: '30 days',
          provenance: 'answer_bank',
          source_id: entry.id,
        }),
      ],
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.message).toContain('not been confirmed');
  });

  it('never reuses a demographic or assessment answer', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);
    const entry = await storeAnswer({
      question_key: 'veteran_status',
      answer: 'prefer_not_to_say',
      sensitivity: 'never_reuse',
    });

    const response = await postPacket(application, {
      resume_id: resumeId,
      answers: [
        answer({
          question_key: 'veteran_status',
          answer: 'prefer_not_to_say',
          sensitivity: 'never_reuse',
          provenance: 'answer_bank',
          source_id: entry.id,
        }),
      ],
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.message).toContain('on the form itself');
  });

  it('refuses the same question answered twice', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    const application = await createApplication(job.id);

    const response = await postPacket(application, {
      resume_id: resumeId,
      answers: [answer(), answer({ answer: 'A different reason.' })],
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.message).toContain('answered twice');
  });
});

describe('POST /applications/:id/approve', () => {
  it('binds the approval to the content hash and sets an expiry', async () => {
    const { view } = await approvedApplication();

    expect(view.status).toBe('approved');
    expect(view.current_packet!.approved_hash).toBe(view.current_packet!.content_hash);
    expect(view.current_packet!.approved_at).not.toBeNull();
    expect(view.current_packet!.expires_at).not.toBeNull();
    const ttlMs =
      Date.parse(view.current_packet!.expires_at!) - Date.parse(view.current_packet!.approved_at!);
    expect(ttlMs).toBe(24 * 60 * 60 * 1000);
  });

  it('refuses a hash the user did not read', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    let view = await createApplication(job.id);
    await postPacket(view, { resume_id: resumeId, answers: [answer()] });
    view = await readApplication(view.id);

    const response = await postApprove(view, {
      packet_id: view.current_packet!.id,
      content_hash: 'f'.repeat(64),
    });
    expect(response.statusCode, response.body).toBe(409);
  });

  it('AT13: a new packet revision rejects the old approval', async () => {
    const { view, resumeId } = await approvedApplication();
    const firstPacketId = view.current_packet!.id;
    const firstHash = view.current_packet!.content_hash;

    // Change an answer: a packet is never edited, so this is a new revision.
    const rebuilt = await postPacket(view, {
      resume_id: resumeId,
      answers: [answer({ answer: 'A better reason.' })],
    });
    expect(rebuilt.statusCode, rebuilt.body).toBe(202);

    const after = await readApplication(view.id);
    expect(after.status).toBe('ready_for_review');
    expect(after.current_packet!.id).not.toBe(firstPacketId);
    expect(after.current_packet!.revision).toBe(2);
    expect(after.current_packet!.content_hash).not.toBe(firstHash);
    expect(after.current_packet!.approved_at).toBeNull();

    // Re-presenting the approval the user gave to the old content is refused.
    const stale = await postApprove(after, {
      packet_id: firstPacketId,
      content_hash: firstHash,
    });
    expect(stale.statusCode, stale.body).toBe(409);
  });

  it('refuses to approve while a required question is unanswered', async () => {
    const job = await seedJob();
    const resumeId = await seedResume();
    let view = await createApplication(job.id);
    await postPacket(view, {
      resume_id: resumeId,
      answers: [answer({ question_key: 'notice_period', answer: null })],
    });
    view = await readApplication(view.id);

    const response = await postApprove(view, {
      packet_id: view.current_packet!.id,
      content_hash: view.current_packet!.content_hash,
    });
    expect(response.statusCode, response.body).toBe(409);
  });
});

describe('approval invalidation', () => {
  it('withdraws the approval when the profile moves on', async () => {
    const { view } = await approvedApplication();

    const profile = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/profile' }),
    );
    const patched = await harness.app.inject(
      authed(session, {
        method: 'PATCH',
        url: '/api/v1/profile',
        payload: {
          expected_revision: profile.json().revision as number,
          changes: [
            {
              op: 'upsert',
              kind: 'contact',
              value: { full_name: 'Ada Lovelace', email: 'ada@example.invalid' },
              confirmed: true,
            },
          ],
        },
      }),
    );
    expect(patched.statusCode, patched.body).toBe(200);

    const after = await readApplication(view.id);
    expect(after.status).toBe('preparing');
    expect(after.current_packet!.approved_at).toBeNull();
    expect(after.current_packet!.staleness).toContain('profile_revision_changed');

    const history = await events(view.id);
    const invalidated = history.find((entry) => entry.type === 'approval_invalidated');
    expect(invalidated?.actor).toBe('system');
    expect(invalidated?.reason).toContain('profile_revision_changed');
  });

  it('expiry alone returns the same packet to ready_for_review', async () => {
    const { view } = await approvedApplication();

    // Wind the clock forward: an approval given 25 hours ago, expiring an hour
    // ago. Both columns move, because the database refuses an expiry that
    // precedes its own approval.
    const approvedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await harness.db
      .updateTable('application_packets')
      .set({ approved_at: approvedAt, expires_at: new Date(approvedAt.getTime() + 86_400_000) })
      .where('id', '=', view.current_packet!.id)
      .execute();

    const after = await readApplication(view.id);
    expect(after.status).toBe('ready_for_review');
    expect(after.current_packet!.id).toBe(view.current_packet!.id);
    expect(after.current_packet!.approved_at).toBeNull();

    const history = await events(view.id);
    expect(history.some((entry) => entry.type === 'approval_expired')).toBe(true);

    // The same content can be approved again: only the clock had run out.
    const reapproved = await postApprove(after, {
      packet_id: after.current_packet!.id,
      content_hash: after.current_packet!.content_hash,
    });
    expect(reapproved.statusCode, reapproved.body).toBe(200);
  });
});

describe('POST /applications/:id/outcome', () => {
  it('records a manual submission as user_report with a timestamp', async () => {
    const { view } = await approvedApplication();

    const response = await postOutcome(view, {
      outcome: 'submitted',
      evidence_type: 'user_report',
      evidence: { reference: 'ACME-42', note: 'Confirmation page showed a reference.' },
    });
    expect(response.statusCode, response.body).toBe(200);

    const after = response.json() as ApplicationView;
    expect(after.status).toBe('submitted');
    expect(after.submitted_at).not.toBeNull();
    expect(after.submission_evidence!.evidence_type).toBe('user_report');
    expect(after.submission_evidence!.reference).toBe('ACME-42');
  });

  it('refuses a session claiming an adapter observed the confirmation', async () => {
    const { view } = await approvedApplication();

    const response = await postOutcome(view, {
      outcome: 'submitted',
      evidence_type: 'adapter_observed',
      evidence: { confirmation_text: 'Thanks for applying' },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.message).toContain('paired runner');
  });

  it('refuses to record a submission with no account of how we know', async () => {
    const { view } = await approvedApplication();

    const response = await postOutcome(view, { outcome: 'submitted', evidence_type: 'none' });
    expect(response.statusCode, response.body).toBe(422);
  });

  it('refuses cancellation after submission', async () => {
    const { view } = await approvedApplication();
    const submitted = await postOutcome(view, {
      outcome: 'submitted',
      evidence_type: 'user_report',
      evidence: { note: 'Sent it myself.' },
    });
    expect(submitted.statusCode).toBe(200);

    const response = await postOutcome(submitted.json() as ApplicationView, {
      outcome: 'cancelled',
      evidence_type: 'none',
    });
    expect(response.statusCode, response.body).toBe(409);
  });

  it('tracks a rejection after submission and keeps the submission time', async () => {
    const { view } = await approvedApplication();
    const submitted = (
      await postOutcome(view, {
        outcome: 'submitted',
        evidence_type: 'user_report',
        evidence: { note: 'Sent it myself.' },
      })
    ).json() as ApplicationView;

    const rejected = await postOutcome(submitted, {
      outcome: 'rejected',
      evidence_type: 'user_report',
      evidence: { note: 'Email said no.' },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const after = rejected.json() as ApplicationView;
    expect(after.status).toBe('rejected');
    expect(after.submitted_at).toBe(submitted.submitted_at);
  });

  it('cancels a draft application before submission', async () => {
    const job = await seedJob();
    const application = await createApplication(job.id);

    const response = await postOutcome(application, {
      outcome: 'cancelled',
      evidence_type: 'none',
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as ApplicationView).status).toBe('cancelled');
  });
});

describe('the event log', () => {
  it('is dense, ordered and append-only', async () => {
    const { view } = await approvedApplication();
    const history = await events(view.id);

    expect(history.map((entry) => entry.sequence)).toEqual(history.map((_, index) => index + 1));
    expect(history.map((entry) => entry.type)).toEqual([
      'created',
      'packet_created',
      'packet_approved',
    ]);

    // The database refuses an edit, whatever the application layer believes.
    await expect(
      harness.pool.query(`UPDATE application_events SET reason = 'rewritten' WHERE sequence = 1`),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('keeps answer text out of the history', async () => {
    const { view } = await approvedApplication();
    const history = await events(view.id);
    const serialised = JSON.stringify(history);

    expect(serialised).not.toContain('Because the work is interesting.');
  });
});

describe('GET /applications', () => {
  it('lists applications with their packet state', async () => {
    const { view } = await approvedApplication();

    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/applications' }),
    );
    expect(response.statusCode, response.body).toBe(200);
    const items = response.json().items as ApplicationView[];
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(view.id);
    expect(items[0]!.current_packet!.approved_at).not.toBeNull();
  });

  it('filters by status', async () => {
    const job = await seedJob();
    await createApplication(job.id);

    const matching = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/applications?status=draft' }),
    );
    expect((matching.json().items as ApplicationView[]).length).toBe(1);

    const other = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/applications?status=submitted' }),
    );
    expect((other.json().items as ApplicationView[]).length).toBe(0);
  });

  it('reports another application for a job that may be the same posting', async () => {
    const first = await seedJob('eng-1');
    // Same employer and title at the same location, discovered from a second
    // board: two rows, one posting, and the tracker has to say so.
    const second = await seedJob('eng-2', { title: first.title }, 'acme-eu');

    const a = await createApplication(first.id);
    const b = await createApplication(second.id);

    const viewA = await readApplication(a.id);
    expect(viewA.possible_duplicate_application_ids).toContain(b.id);
  });
});
