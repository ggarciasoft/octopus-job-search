/**
 * Handing an approved packet to a paired runner, and what comes back
 * (M4, PR09).
 *
 * The acceptance scenarios here:
 *
 *  * **AT14** — a form that asks something the packet does not answer pauses
 *    the application in `needs_input`, with the new question written into a
 *    fresh packet revision for the user to answer.
 *  * **AT15** — two simultaneous fill requests produce one session; the second
 *    is a conflict.
 *  * **AT17** — an unsupported page is an honest fallback: the packet is kept,
 *    the approval survives, and the user is told to apply themselves.
 *
 * The runner itself is tested in `services/worker/tests/test_runner_*.py`
 * against a real browser. What is tested here is the API's half: what it will
 * hand over, to whom, and what it does with the answer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OBSERVE_TIMEOUT_SECONDS,
  PROTOCOL_VERSION,
  type ApplicationEventView,
  type ApplicationView,
  type ClaimResponse,
  type FillLocalInput,
  type FillLocalResult,
  type ObserveConfirmationInput,
  type ObserveConfirmationResult,
  type PacketAnswer,
} from '@job-getter/contracts';
import {
  asDevice,
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
// Fixtures
// ---------------------------------------------------------------------------

async function seedJob() {
  const source = await createSource(harness, session);
  expect((await queueScan(harness, session, source.id)).statusCode).toBe(202);
  const claimed = await claimTask(harness, 'fetch_board');
  await completeTask(
    harness,
    claimed!.task_id,
    claimed!.lease_token,
    boardResult([normalizedJob({ external_id: 'eng-1', board: BOARD })]),
  );
  const provenance = await harness.db
    .selectFrom('job_sources')
    .select(['job_id'])
    .executeTakeFirstOrThrow();
  return provenance.job_id;
}

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
  const tail = ['', `--${boundary}--`, ''].join('\r\n');
  const upload = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        head + '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n' + tail,
        'binary',
      ),
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
  return resume.json().task_id as string;
}

async function pairRunner(allowedOrigins?: string[]): Promise<{ id: string; token: string }> {
  const pairing = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/devices/pairing',
      payload: {
        device_kind: 'local_runner',
        label: 'Laptop',
        ...(allowedOrigins ? { allowed_origins: allowedOrigins } : {}),
      },
    }),
  );
  expect(pairing.statusCode, pairing.body).toBe(201);
  const exchanged = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/devices/exchange',
    payload: {
      pairing_code: pairing.json().pairing_code as string,
      device_public_id: 'linux-testbox',
    },
  });
  expect(exchanged.statusCode, exchanged.body).toBe(200);
  return { id: pairing.json().device_id as string, token: exchanged.json().token as string };
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

async function readApplication(id: string): Promise<ApplicationView> {
  const response = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/applications/${id}` }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ApplicationView;
}

/** An application approved and ready to be filled, plus a paired runner. */
async function approved(allowedOrigins?: string[]) {
  const jobId = await seedJob();
  const resumeId = await seedResume();
  const device = await pairRunner(allowedOrigins);

  const created = await harness.app.inject(
    authed(session, { method: 'POST', url: '/api/v1/applications', payload: { job_id: jobId } }),
  );
  expect(created.statusCode, created.body).toBe(200);
  let view = created.json() as ApplicationView;

  const packet = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/applications/${view.id}/packets`,
      headers: { 'idempotency-key': idempotencyKey() },
      payload: { expected_revision: view.revision, resume_id: resumeId, answers: [answer()] },
    }),
  );
  expect(packet.statusCode, packet.body).toBe(202);

  view = await readApplication(view.id);
  const approvedResponse = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/applications/${view.id}/approve`,
      payload: {
        expected_revision: view.revision,
        packet_id: view.current_packet!.id,
        content_hash: view.current_packet!.content_hash,
      },
    }),
  );
  expect(approvedResponse.statusCode, approvedResponse.body).toBe(200);
  return { view: approvedResponse.json() as ApplicationView, device };
}

function postFill(view: ApplicationView, deviceId: string, packetId?: string) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/applications/${view.id}/fill`,
      headers: { 'idempotency-key': idempotencyKey() },
      payload: {
        expected_revision: view.revision,
        packet_id: packetId ?? view.current_packet!.id,
        device_id: deviceId,
      },
    }),
  );
}

async function claimFill(token: string): Promise<ClaimResponse> {
  const response = await harness.app.inject(
    asDevice(token, {
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: {
        worker_id: 'runner-1',
        capabilities: ['fill_local'],
        protocol_version: PROTOCOL_VERSION,
      },
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ClaimResponse;
}

function fillResult(
  input: FillLocalInput,
  overrides: Partial<FillLocalResult> = {},
): FillLocalResult {
  return {
    packet_id: input.packet_id,
    filled_fields: [{ question_key: 'why_this_role', outcome: 'filled', matched_label: 'Why?' }],
    unresolved_fields: [],
    page_url: input.destination.url,
    form_fingerprint: 'v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    outcome: 'awaiting_user_submit',
    adapter: 'greenhouse',
    adapter_version: 'greenhouse/v1',
    screenshot_file_id: null,
    ...overrides,
  };
}

async function events(id: string): Promise<ApplicationEventView[]> {
  const response = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/applications/${id}/events` }),
  );
  return response.json().items as ApplicationEventView[];
}

// ---------------------------------------------------------------------------

describe('POST /applications/:id/fill', () => {
  it('queues the fill and moves the application to filling', async () => {
    const { view, device } = await approved();
    const response = await postFill(view, device.id);

    expect(response.statusCode, response.body).toBe(202);
    const after = await readApplication(view.id);
    expect(after.status).toBe('filling');

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('type', '=', 'fill_local')
      .executeTakeFirstOrThrow();
    // Never retried: a second attempt is a second attempt at a real
    // application, against a page that may have changed.
    expect(task.max_attempts).toBe(1);
  });

  it('declares the CV as the only file the runner may fetch', async () => {
    const { view, device } = await approved();
    await postFill(view, device.id);

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('type', '=', 'fill_local')
      .executeTakeFirstOrThrow();
    const files = task.input_file_ids as string[];
    expect(files).toHaveLength(1);

    const payload = task.payload as FillLocalInput;
    expect(payload.resume_file_id).toBe(files[0]);
    expect(payload.allowed_origins).toEqual(['https://boards.greenhouse.io']);
    // The packet's answers travel; the profile does not.
    expect(payload.fields.map((item) => item.question_key)).toEqual(['why_this_role']);
    expect(JSON.stringify(payload)).not.toContain('confirmed_facts');
  });

  it('AT15: a second fill while one is in flight is a conflict', async () => {
    const { view, device } = await approved();
    expect((await postFill(view, device.id)).statusCode).toBe(202);

    const again = await readApplication(view.id);
    const second = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/applications/${view.id}/fill`,
        headers: { 'idempotency-key': idempotencyKey() },
        payload: {
          expected_revision: again.revision,
          packet_id: view.current_packet!.id,
          device_id: device.id,
        },
      }),
    );
    expect(second.statusCode, second.body).toBe(409);
  });

  it('refuses an application that is not approved', async () => {
    const { view, device } = await approved();
    // Editing the profile withdraws the approval on the next read.
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

    const stale = await readApplication(view.id);
    expect(stale.status).toBe('preparing');
    const response = await postFill(stale, device.id);
    expect(response.statusCode, response.body).toBe(409);
  });

  it('refuses a device paired for other origins', async () => {
    const { view, device } = await approved(['https://jobs.example.invalid']);
    const response = await postFill(view, device.id);
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.message).toContain('not paired for');
  });

  it('refuses a revoked device', async () => {
    const { view, device } = await approved();
    await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/devices/${device.id}` }),
    );
    const response = await postFill(view, device.id);
    expect(response.statusCode, response.body).toBe(422);
  });

  it('stops at the daily fill budget rather than dropping the request', async () => {
    const { view, device } = await approved();
    const preferences = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/preferences' }),
    );
    const current = preferences.json();
    const updated = await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/preferences',
        payload: {
          expected_revision: current.revision as number,
          config: {
            ...current.config,
            limits: { ...current.config.limits, fill_attempts_per_day: 0 },
          },
        },
      }),
    );
    expect(updated.statusCode, updated.body).toBe(200);

    const response = await postFill(view, device.id);
    expect(response.statusCode, response.body).toBe(429);
  });
});

describe('what the runner sends back', () => {
  it('a filled form leaves the application waiting for the person', async () => {
    const { view, device } = await approved();
    await postFill(view, device.id);
    const claimed = await claimFill(device.token);

    const completed = await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      fillResult(claimed.input as FillLocalInput),
    );
    expect(completed.statusCode, completed.body).toBe(200);

    const after = await readApplication(view.id);
    expect(after.status).toBe('awaiting_user_submit');
    // The schema the runner saw is recorded, so a later change is detectable.
    const row = await harness.db
      .selectFrom('applications')
      .select(['observed_form_fingerprint'])
      .executeTakeFirstOrThrow();
    expect(row.observed_form_fingerprint).toBe('v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('AT14: a new required question becomes a new packet revision to answer', async () => {
    const { view, device } = await approved();
    await postFill(view, device.id);
    const claimed = await claimFill(device.token);
    const input = claimed.input as FillLocalInput;

    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      fillResult(input, {
        outcome: 'needs_input',
        unresolved_fields: [
          {
            question_key: 'internal_referral_code',
            label: 'Internal referral code',
            required: true,
            reason: 'new_question',
            options: [],
          },
        ],
      }),
    );

    const after = await readApplication(view.id);
    expect(after.status).toBe('needs_input');
    expect(after.current_packet!.revision).toBe(2);
    expect(after.current_packet!.unresolved_question_keys).toEqual(['internal_referral_code']);
    // The answer the user already gave survives into the new revision.
    expect(after.current_packet!.answers.map((item) => item.question_key)).toContain(
      'why_this_role',
    );
    // And the approval does not.
    expect(after.current_packet!.approved_at).toBeNull();
    const previous = await harness.db
      .selectFrom('application_packets')
      .select(['approved_at'])
      .where('id', '=', input.packet_id)
      .executeTakeFirstOrThrow();
    expect(previous.approved_at).toBeNull();
  });

  it('a demographic question the runner refused is carried over as never_reuse', async () => {
    const { view, device } = await approved();
    await postFill(view, device.id);
    const claimed = await claimFill(device.token);

    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      fillResult(claimed.input as FillLocalInput, {
        outcome: 'needs_input',
        unresolved_fields: [
          {
            question_key: 'gender',
            label: 'Gender',
            required: true,
            reason: 'never_inferable',
            options: ['Female', 'Male'],
          },
        ],
      }),
    );

    const after = await readApplication(view.id);
    const gender = after.current_packet!.answers.find((item) => item.question_key === 'gender');
    expect(gender?.sensitivity).toBe('never_reuse');
    expect(gender?.answer).toBeNull();
  });

  it('AT17: an unsupported page keeps the packet and its approval', async () => {
    const { view, device } = await approved();
    await postFill(view, device.id);
    const claimed = await claimFill(device.token);
    const input = claimed.input as FillLocalInput;

    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      fillResult(input, {
        outcome: 'unsupported',
        filled_fields: [],
        form_fingerprint: null,
        adapter: null,
        adapter_version: null,
      }),
    );

    const after = await readApplication(view.id);
    // Nothing was typed and nothing changed, so the approval still stands and
    // the user can apply by hand.
    expect(after.status).toBe('approved');
    expect(after.current_packet!.id).toBe(input.packet_id);
    expect(after.current_packet!.approved_at).not.toBeNull();
  });

  it('a failed fill leaves a visible failed application', async () => {
    const { view, device } = await approved();
    await postFill(view, device.id);
    const claimed = await claimFill(device.token);

    const failed = await harness.app.inject(
      asDevice(device.token, {
        method: 'POST',
        url: `/internal/v1/tasks/${claimed.task_id}/fail`,
        payload: {
          lease_token: claimed.lease_token,
          code: 'TIMEOUT',
          retryable: true,
          redacted_message: 'The page did not finish loading.',
        },
      }),
    );
    expect(failed.statusCode, failed.body).toBe(200);
    // fill_local is never retried, whatever the runner asks for.
    expect(failed.json().state).toBe('failed');

    const after = await readApplication(view.id);
    expect(after.status).toBe('failed');
    const history = await events(view.id);
    expect(history.some((entry) => entry.type === 'fill_failed')).toBe(true);
  });

  it('records the fill as a runner-actor event, not a user one', async () => {
    const { view, device } = await approved();
    await postFill(view, device.id);
    const claimed = await claimFill(device.token);
    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      fillResult(claimed.input as FillLocalInput),
    );

    const history = await events(view.id);
    const requested = history.find((entry) => entry.type === 'fill_requested');
    const paused = history.find((entry) => entry.type === 'fill_paused');
    expect(requested?.actor).toBe('user');
    expect(paused?.actor).toBe('runner');
  });
});

// ---------------------------------------------------------------------------
// AT16 — "Submit observation times out → outcome_unknown; no automated retry."
// ---------------------------------------------------------------------------
//
// The order of events is the opposite of what an automation-shaped guess would
// assume, so it is worth stating: the runner fills the form and stops, **the
// person clicks submit**, and only then does anyone look at the page.
//
// The case AT16 names is the one where looking does not settle it. A watch that
// runs out has not gone wrong, and has not established that nothing was
// submitted — 07_APPLICATION_AUTOMATION.md is explicit that "absence of
// evidence is not failure or success" — so it lands in `outcome_unknown`, the
// state that means exactly "nobody could tell", and stays there until the
// person says what happened. Nothing retries out of it, which is the half of
// AT16 with teeth: a retry from that state could be a second application to the
// same employer.

/** Drives an application to `awaiting_user_submit`, where an observation begins. */
async function awaitingUserSubmit() {
  const { view, device } = await approved();
  await postFill(view, device.id);
  const claimed = await claimFill(device.token);
  await completeTask(
    harness,
    claimed.task_id,
    claimed.lease_token,
    fillResult(claimed.input as FillLocalInput),
  );
  const after = await readApplication(view.id);
  expect(after.status).toBe('awaiting_user_submit');
  return { view: after, device };
}

function postObserve(view: ApplicationView, deviceId: string, timeoutSeconds?: number) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/applications/${view.id}/observe`,
      headers: { 'idempotency-key': idempotencyKey() },
      payload: {
        expected_revision: view.revision,
        packet_id: view.current_packet!.id,
        device_id: deviceId,
        ...(timeoutSeconds === undefined ? {} : { timeout_seconds: timeoutSeconds }),
      },
    }),
  );
}

async function claimObserve(token: string): Promise<ClaimResponse> {
  const response = await harness.app.inject(
    asDevice(token, {
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: {
        worker_id: 'runner-1',
        capabilities: ['observe_confirmation'],
        protocol_version: PROTOCOL_VERSION,
      },
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ClaimResponse;
}

function observeResult(
  input: ObserveConfirmationInput,
  overrides: Partial<ObserveConfirmationResult> = {},
): ObserveConfirmationResult {
  return {
    application_id: input.application_id,
    packet_id: input.packet_id,
    outcome: 'unknown',
    confirmation: null,
    unknown_reason: 'timed_out',
    watched_seconds: input.timeout_seconds,
    page_url: input.destination.url,
    adapter: 'greenhouse',
    adapter_version: 'greenhouse/v1',
    screenshot_file_id: null,
    ...overrides,
  };
}

describe('POST /applications/:id/observe', () => {
  it('hands the page and a deadline to the paired runner', async () => {
    const { view, device } = await awaitingUserSubmit();

    const response = await postObserve(view, device.id);
    expect(response.statusCode, response.body).toBe(202);

    const claimed = await claimObserve(device.token);
    const input = claimed.input as ObserveConfirmationInput;
    expect(input.application_id).toBe(view.id);
    expect(input.destination.url).toBe(view.current_packet!.destination.url);
    expect(input.timeout_seconds).toBe(DEFAULT_OBSERVE_TIMEOUT_SECONDS);
    // Evidence capture is opt-in and off by default: a confirmation page
    // carries the applicant's own details back into storage.
    expect(input.capture_evidence).toBe(false);
  });

  it('gets exactly one attempt, because a second look is a second guess', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('type', '=', 'observe_confirmation')
      .executeTakeFirstOrThrow();
    expect(task.max_attempts).toBe(1);
  });

  it('refuses a second observation while one is in flight', async () => {
    const { view, device } = await awaitingUserSubmit();
    expect((await postObserve(view, device.id)).statusCode).toBe(202);

    const second = await postObserve(await readApplication(view.id), device.id);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.message).toContain('already in progress');
  });

  it('refuses to observe an application nobody has filled', async () => {
    const { view, device } = await approved();
    const response = await postObserve(view, device.id);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('filled the form and stopped');
  });

  it('does not change the status just because someone asked', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);

    // Asking to look is not an outcome. It is still waiting for the person.
    expect((await readApplication(view.id)).status).toBe('awaiting_user_submit');
  });
});

describe('AT16: the observation times out', () => {
  it('records outcome_unknown, with no evidence and the reason it could not tell', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);

    const claimed = await claimObserve(device.token);
    const input = claimed.input as ObserveConfirmationInput;
    const completed = await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observeResult(input),
    );
    expect(completed.statusCode, completed.body).toBe(200);

    const after = await readApplication(view.id);
    expect(after.status).toBe('outcome_unknown');
    // Absence of evidence is not evidence. Nothing is attached, and in
    // particular nothing claims a submission time.
    expect(after.submission_evidence).toBeNull();
    expect(after.submitted_at).toBeNull();

    const recorded = (await events(view.id)).at(-1)!;
    expect(recorded.type).toBe('outcome_recorded');
    expect(recorded.actor).toBe('runner');
    expect(recorded.reason).toBe('timed_out');
    expect((recorded.data as { watched_seconds: number }).watched_seconds).toBe(
      input.timeout_seconds,
    );
  });

  it('is not a failed task, so nothing is queued to try again', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);

    const claimed = await claimObserve(device.token);
    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observeResult(claimed.input as ObserveConfirmationInput),
    );

    const task = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', claimed.task_id)
      .executeTakeFirstOrThrow();
    // A timeout is a *result*. Failing it would have put it on the retry path,
    // and "no automated retry" is half of AT16.
    expect(task.state).toBe('succeeded');
    expect(task.error_code).toBeNull();

    const pending = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('state', 'in', ['queued', 'leased'])
      .execute();
    expect(pending).toEqual([]);
  });

  it('refuses to fill again until the person resolves it', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);
    const claimed = await claimObserve(device.token);
    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observeResult(claimed.input as ObserveConfirmationInput),
    );

    const unresolved = await readApplication(view.id);
    expect(unresolved.status).toBe('outcome_unknown');

    const refill = await postFill(unresolved, device.id);
    // "Disable a second attempt until resolved." The first submission may well
    // have gone through, so filling again could be a second application.
    expect(refill.statusCode).toBe(409);
    expect(refill.json().error.message).toContain('second attempt could be a second application');
  });

  it('refuses another observation from outcome_unknown', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);
    const claimed = await claimObserve(device.token);
    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observeResult(claimed.input as ObserveConfirmationInput),
    );

    const again = await postObserve(await readApplication(view.id), device.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toContain('record the outcome instead');
  });

  it('lets the person resolve it themselves afterwards', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);
    const claimed = await claimObserve(device.token);
    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observeResult(claimed.input as ObserveConfirmationInput),
    );

    const unresolved = await readApplication(view.id);
    const confirmed = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/applications/${view.id}/outcome`,
        payload: {
          expected_revision: unresolved.revision,
          outcome: 'submitted',
          evidence_type: 'user_report',
          evidence: { note: 'I saw the confirmation page myself.' },
        },
      }),
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect((confirmed.json() as ApplicationView).status).toBe('submitted');
  });

  it('treats a crashed runner exactly like a watch that saw nothing', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);
    const claimed = await claimObserve(device.token);

    const failed = await harness.app.inject(
      asDevice(device.token, {
        method: 'POST',
        url: `/internal/v1/tasks/${claimed.task_id}/fail`,
        payload: {
          lease_token: claimed.lease_token,
          code: 'INTERNAL_ERROR',
          retryable: false,
          redacted_message: 'the browser died mid-watch',
        },
      }),
    );
    expect(failed.statusCode, failed.body).toBe(200);

    // A browser that crashed has said nothing about whether the application
    // went through. Unresolved — not failed, which is what the tracker would
    // otherwise show for a perfectly good application.
    const after = await readApplication(view.id);
    expect(after.status).toBe('outcome_unknown');
    expect(after.submission_evidence).toBeNull();
  });
});

describe('the observation that does find a confirmation', () => {
  function observed(input: ObserveConfirmationInput, observedAt: string, text: string) {
    return observeResult(input, {
      outcome: 'observed',
      unknown_reason: null,
      confirmation: {
        confirmation_text: text,
        reference: 'NW-2026-4471',
        url: `${input.destination.url}/confirmation`,
        observed_at: observedAt,
      },
      watched_seconds: 4,
    });
  }

  it('records the submission with the page as evidence', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);
    const claimed = await claimObserve(device.token);
    const observedAt = new Date(Date.now() - 60_000).toISOString();

    const completed = await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observed(
        claimed.input as ObserveConfirmationInput,
        observedAt,
        'Your application has been submitted',
      ),
    );
    expect(completed.statusCode, completed.body).toBe(200);

    const after = await readApplication(view.id);
    expect(after.status).toBe('submitted');
    expect(after.submission_evidence).not.toBeNull();
    // Only a paired runner may claim this evidence type; a session asking for
    // it is refused by the outcome route.
    expect(after.submission_evidence!.evidence_type).toBe('adapter_observed');
    expect(after.submission_evidence!.reference).toBe('NW-2026-4471');
    expect(after.submitted_at).toBe(observedAt);
  });

  it("keeps the employer's words out of the event log", async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);
    const claimed = await claimObserve(device.token);

    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observed(
        claimed.input as ObserveConfirmationInput,
        new Date().toISOString(),
        'A sentence that should not be copied into the log',
      ),
    );

    const recorded = (await events(view.id)).at(-1)!;
    expect(recorded.type).toBe('submitted');
    expect(JSON.stringify(recorded.data)).not.toContain('should not be copied');
    // The reference is an identifier and does travel: it is what the user
    // would quote in a follow-up.
    expect((recorded.data as { reference: string }).reference).toBe('NW-2026-4471');
  });

  it('does not overwrite an outcome the person already recorded', async () => {
    const { view, device } = await awaitingUserSubmit();
    await postObserve(view, device.id);
    const claimed = await claimObserve(device.token);

    // They were sitting in front of the page; they got there first.
    const reported = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/applications/${view.id}/outcome`,
        payload: {
          expected_revision: (await readApplication(view.id)).revision,
          outcome: 'submitted',
          evidence_type: 'user_report',
          evidence: { note: 'Saw it go through.' },
        },
      }),
    );
    expect(reported.statusCode, reported.body).toBe(200);

    await completeTask(
      harness,
      claimed.task_id,
      claimed.lease_token,
      observeResult(claimed.input as ObserveConfirmationInput),
    );

    // First-hand beats a watcher that timed out. Replacing `submitted` with
    // `outcome_unknown` would swap something known for something unknown.
    const after = await readApplication(view.id);
    expect(after.status).toBe('submitted');
    expect(after.submission_evidence!.evidence_type).toBe('user_report');
  });
});
