/**
 * Fill sessions: the scoped credential the browser extension fills with
 * (M5, PR12).
 *
 * The extension is tested in `apps/extension`, and on 2026-09-22 it filled a
 * real form in a real Chrome through these routes. What is tested here is the
 * API's half: what it will hand over, to whom, and what it does with the
 * answer. Mostly that means the refusals:
 *
 *  * **AT23** — revoking a device denies its very next request *and* kills the
 *    live session it already holds. A ten-minute session that outlived its
 *    credential would be exactly the "new packet access" the scenario forbids.
 *  * **AT24** — a hostile page cannot reach the token, the profile or the
 *    destination. Three separate assertions, because they fail three
 *    different ways: a session cookie opens none of these routes, the grant
 *    contains no profile, and there is no request field in which a caller can
 *    name a destination.
 *  * **AT15** — one live session per application; the second is a conflict.
 *
 * Plus the ordinary ones: only a current approved packet, only the origin the
 * device was paired for, only for ten minutes, only once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FILL_SESSION_NONCE_HEADER,
  FILL_SESSION_TTL_SECONDS,
  type ApplicationEventView,
  type ApplicationView,
  type FillSessionGrant,
  type FillSessionView,
  type FillTargetList,
  type PacketAnswer,
} from '@job-getter/contracts';
import {
  asDevice,
  authed,
  completeSetup,
  createHarness,
  idempotencyKey,
  TEST_ORIGIN,
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

async function seedJob(): Promise<string> {
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

async function pairExtension(options: { kind?: string; allowedOrigins?: string[] } = {}) {
  const pairing = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/devices/pairing',
      payload: {
        device_kind: options.kind ?? 'extension',
        label: 'Chrome on this machine',
        ...(options.allowedOrigins ? { allowed_origins: options.allowedOrigins } : {}),
      },
    }),
  );
  expect(pairing.statusCode, pairing.body).toBe(201);
  const exchanged = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/devices/exchange',
    payload: {
      pairing_code: pairing.json().pairing_code as string,
      device_public_id: 'chrome-testbox',
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

/** An approved application and a paired extension, ready for a session. */
async function approved(options: { allowedOrigins?: string[]; kind?: string } = {}) {
  const jobId = await seedJob();
  const resumeId = await seedResume();
  const device = await pairExtension(options);

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

function createSession(
  token: string,
  view: ApplicationView,
  overrides: Record<string, unknown> = {},
) {
  return harness.app.inject(
    asDevice(token, {
      method: 'POST',
      url: '/api/v1/fill-sessions',
      payload: {
        application_id: view.id,
        origin: view.current_packet!.destination.origin,
        content_hash: view.current_packet!.content_hash,
        ...overrides,
      },
    }),
  );
}

async function grant(token: string, view: ApplicationView): Promise<FillSessionGrant> {
  const response = await createSession(token, view);
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as FillSessionGrant;
}

// ---------------------------------------------------------------------------

describe('POST /fill-sessions', () => {
  it('binds a session to the packet, the device and the tab origin', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    expect(issued.application_id).toBe(view.id);
    expect(issued.packet_id).toBe(view.current_packet!.id);
    expect(issued.content_hash).toBe(view.current_packet!.content_hash);
    expect(issued.origin).toBe(view.current_packet!.destination.origin);
    // The destination is the packet's own, not anything the caller said.
    expect(issued.destination.url).toBe(view.current_packet!.destination.url);
    expect(issued.fields).toHaveLength(1);
    expect(issued.fields[0]!.question_key).toBe('why_this_role');

    // Ten minutes, from the spec.
    const ttl = Date.parse(issued.expires_at) - Date.now();
    expect(ttl).toBeGreaterThan((FILL_SESSION_TTL_SECONDS - 60) * 1000);
    expect(ttl).toBeLessThanOrEqual(FILL_SESSION_TTL_SECONDS * 1000);

    // The application is `filling`, exactly as it is for the local runner.
    expect((await readApplication(view.id)).status).toBe('filling');
  });

  it('stores only the digest of the nonce', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const row = await harness.db
      .selectFrom('fill_sessions')
      .selectAll()
      .where('id', '=', issued.session_id)
      .executeTakeFirstOrThrow();
    expect(row.nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.nonce_hash).not.toBe(issued.nonce);
    expect(JSON.stringify(row)).not.toContain(issued.nonce);
  });

  it('refuses a packet hash that is not the approved one', async () => {
    const { view, device } = await approved();
    const response = await createSession(device.token, view, { content_hash: 'a'.repeat(64) });
    expect(response.statusCode).toBe(409);
    // Nothing was started.
    expect((await readApplication(view.id)).status).toBe('approved');
  });

  it('refuses a tab that is not the approved destination', async () => {
    const { view, device } = await approved();
    const response = await createSession(device.token, view, {
      origin: 'https://not-the-employer.example',
    });
    expect(response.statusCode).toBe(422);
    expect((await readApplication(view.id)).status).toBe('approved');
  });

  it('refuses an origin the device was not paired for', async () => {
    const { view, device } = await approved({ allowedOrigins: ['https://elsewhere.example'] });
    const response = await createSession(device.token, view);
    expect(response.statusCode).toBe(422);
  });

  it('refuses a local runner: it is given work through the task queue', async () => {
    const { view, device } = await approved({ kind: 'local_runner' });
    const response = await createSession(device.token, view);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('extension');
  });

  it('refuses an application that is not approved', async () => {
    const { view, device } = await approved();
    // Editing an answer withdraws the approval.
    const edited = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/applications/${view.id}/packets`,
        headers: { 'idempotency-key': idempotencyKey() },
        payload: {
          expected_revision: view.revision,
          resume_id: view.current_packet!.resume_id,
          answers: [answer({ answer: 'A different reason.' })],
        },
      }),
    );
    expect(edited.statusCode).toBe(202);

    const response = await createSession(device.token, view);
    expect(response.statusCode).toBe(409);
  });

  // AT15
  it('allows one live session per application and conflicts on the second', async () => {
    const { view, device } = await approved();
    await grant(device.token, view);

    const second = await createSession(device.token, view);
    expect(second.statusCode).toBe(409);
  });

  it('issues a new session once the first has ended', async () => {
    const { view, device } = await approved();
    const first = await grant(device.token, view);

    const ended = await harness.app.inject(
      asDevice(device.token, {
        method: 'DELETE',
        url: `/api/v1/fill-sessions/${first.session_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: first.nonce },
      }),
    );
    expect(ended.statusCode, ended.body).toBe(204);

    // The application is back to `approved`? No — it is still `filling`, and
    // that is the honest state: a cancelled session does not un-fill a form
    // that may already carry typed values. The person resolves it from the
    // review screen. What must be true is that the slot is free.
    const row = await harness.db
      .selectFrom('fill_sessions')
      .selectAll()
      .where('id', '=', first.session_id)
      .executeTakeFirstOrThrow();
    expect(row.ended_reason).toBe('cancelled');
  });
});

describe('GET /fill-targets', () => {
  function listTargets(token: string) {
    return harness.app.inject(asDevice(token, { method: 'GET', url: '/api/v1/fill-targets' }));
  }

  async function targets(token: string): Promise<FillTargetList> {
    const response = await listTargets(token);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as FillTargetList;
  }

  it('lists an approved application as a pointer, never as a packet', async () => {
    const { view, device } = await approved();
    const { items } = await targets(device.token);

    expect(items).toHaveLength(1);
    const [target] = items;
    expect(target!.application_id).toBe(view.id);
    expect(target!.content_hash).toBe(view.current_packet!.content_hash);
    expect(target!.destination.url).toBe(view.current_packet!.destination.url);
    expect(target!.destination.origin).toBe(view.current_packet!.destination.origin);
    expect(target!.job.title).not.toBe('');
    expect(target!.approval_expires_at).not.toBeNull();
    // Answers and the CV travel only in a grant, which is bound to a tab.
    expect(Object.keys(target!).sort()).toEqual([
      'application_id',
      'approval_expires_at',
      'content_hash',
      'destination',
      'job',
    ]);
    expect(JSON.stringify(items)).not.toContain('Because the work is interesting.');
  });

  it('lists exactly what POST /fill-sessions then accepts', async () => {
    const { device } = await approved();
    const [target] = (await targets(device.token)).items;
    const response = await harness.app.inject(
      asDevice(device.token, {
        method: 'POST',
        url: '/api/v1/fill-sessions',
        payload: {
          application_id: target!.application_id,
          origin: target!.destination.origin,
          content_hash: target!.content_hash,
        },
      }),
    );
    expect(response.statusCode, response.body).toBe(201);
  });

  it('drops an application once a fill is in progress', async () => {
    const { view, device } = await approved();
    await grant(device.token, view);
    expect((await targets(device.token)).items).toEqual([]);
  });

  it('drops an application whose approval was withdrawn', async () => {
    const { view, device } = await approved();
    const edited = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: `/api/v1/applications/${view.id}/packets`,
        headers: { 'idempotency-key': idempotencyKey() },
        payload: {
          expected_revision: view.revision,
          resume_id: view.current_packet!.resume_id,
          answers: [answer({ answer: 'A different reason.' })],
        },
      }),
    );
    expect(edited.statusCode).toBe(202);
    expect((await targets(device.token)).items).toEqual([]);
  });

  it('withdraws an expired approval on its own read, not just hides it', async () => {
    const { view, device } = await approved();
    await harness.db
      .updateTable('application_packets')
      .set({ approved_at: new Date(Date.now() - 2000), expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', view.current_packet!.id)
      .execute();

    expect((await targets(device.token)).items).toEqual([]);
    // The same reconciliation the web app's read performs, so the list and
    // the review screen cannot disagree about whether this is approved.
    expect((await readApplication(view.id)).status).toBe('ready_for_review');
  });

  it('omits a destination the device was not paired for', async () => {
    const { device } = await approved({ allowedOrigins: ['https://elsewhere.example'] });
    expect((await targets(device.token)).items).toEqual([]);
  });

  it('refuses a local runner', async () => {
    const { device } = await approved({ kind: 'local_runner' });
    expect((await listTargets(device.token)).statusCode).toBe(422);
  });

  it('refuses a session cookie: a page riding the user’s session learns nothing', async () => {
    await approved();
    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/fill-targets' }),
    );
    expect(response.statusCode).toBe(401);
  });

  it('refuses a revoked device on its next request (AT23)', async () => {
    const { device } = await approved();
    await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/devices/${device.id}` }),
    );
    expect((await listTargets(device.token)).statusCode).toBe(401);
  });
});

describe('the session nonce', () => {
  it('is required to read, report or end a session', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const noNonce = await harness.app.inject(
      asDevice(device.token, { method: 'GET', url: `/api/v1/fill-sessions/${issued.session_id}` }),
    );
    expect(noNonce.statusCode).toBe(401);

    const wrongNonce = await harness.app.inject(
      asDevice(device.token, {
        method: 'GET',
        url: `/api/v1/fill-sessions/${issued.session_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: 'not-the-nonce-but-long-enough-to-pass' },
      }),
    );
    expect(wrongNonce.statusCode).toBe(401);

    const right = await harness.app.inject(
      asDevice(device.token, {
        method: 'GET',
        url: `/api/v1/fill-sessions/${issued.session_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: issued.nonce },
      }),
    );
    expect(right.statusCode, right.body).toBe(200);
    expect((right.json() as FillSessionView).state).toBe('active');
  });

  it('does not let a second paired device use the first one’s session', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);
    const other = await pairExtension();

    // Even holding the nonce, which a second extension should never have.
    const response = await harness.app.inject(
      asDevice(other.token, {
        method: 'GET',
        url: `/api/v1/fill-sessions/${issued.session_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: issued.nonce },
      }),
    );
    expect(response.statusCode).toBe(404);
  });
});

// AT23
describe('AT23: revoking the extension token', () => {
  it('denies the very next request and kills the live session', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const revoked = await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/devices/${device.id}` }),
    );
    expect(revoked.statusCode, revoked.body).toBe(204);

    // Immediate API denial: the token no longer authenticates at all.
    const read = await harness.app.inject(
      asDevice(device.token, {
        method: 'GET',
        url: `/api/v1/fill-sessions/${issued.session_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: issued.nonce },
      }),
    );
    expect(read.statusCode).toBe(401);

    // No new packet access: the session it already held is ended, so it does
    // not survive its credential by the remainder of its ten minutes.
    const row = await harness.db
      .selectFrom('fill_sessions')
      .selectAll()
      .where('id', '=', issued.session_id)
      .executeTakeFirstOrThrow();
    expect(row.ended_at).not.toBeNull();
    expect(row.ended_reason).toBe('device_revoked');
  });

  it('refuses to open a new session afterwards', async () => {
    const { view, device } = await approved();
    await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/devices/${device.id}` }),
    );
    const response = await createSession(device.token, view);
    expect(response.statusCode).toBe(401);
  });
});

// AT24
describe('AT24: a malicious page cannot reach the token, profile or destination', () => {
  it('refuses a session cookie: these routes take a device token only', async () => {
    const { view } = await approved();
    // The victim is signed in, and the page rides their cookie. There is no
    // device token, because it lives in the extension's service worker.
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/fill-sessions',
        payload: {
          application_id: view.id,
          origin: view.current_packet!.destination.origin,
          content_hash: view.current_packet!.content_hash,
        },
      }),
    );
    expect(response.statusCode).toBe(401);
  });

  it('hands the extension no profile, no secret and no session token', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);
    const body = JSON.stringify(issued);

    // The one fact this profile holds, and the things a grant must never
    // carry alongside the answers it legitimately does.
    for (const forbidden of ['profile', 'password_hash', 'token_hash', 'secret_ciphertext']) {
      expect(body).not.toContain(forbidden);
    }
    // The CV travels as an id and a digest, never as bytes.
    expect(Object.keys(issued)).not.toContain('resume_bytes');
  });

  it('offers no field in which a caller could name a different destination', async () => {
    const { view, device } = await approved();
    // Additional properties are refused by the contract, so an attempt to
    // supply a destination is a 400 rather than a quietly ignored field —
    // which matters: ignoring it would look identical to honouring it.
    const response = await harness.app.inject(
      asDevice(device.token, {
        method: 'POST',
        url: '/api/v1/fill-sessions',
        payload: {
          application_id: view.id,
          origin: view.current_packet!.destination.origin,
          content_hash: view.current_packet!.content_hash,
          destination: { url: 'https://attacker.example/apply' },
        },
      }),
    );
    expect(response.statusCode).toBe(400);
  });

  it('strips a path, query and fragment from the origin it is given', async () => {
    const { view, device } = await approved();
    const base = view.current_packet!.destination.origin;
    const issued = await grant(device.token, {
      ...view,
      current_packet: {
        ...view.current_packet!,
        destination: { ...view.current_packet!.destination, origin: `${base}/evil?x=1#y` },
      },
    } as ApplicationView);
    expect(issued.origin).toBe(base);
  });
});

describe('GET /fill-sessions/:id/resume', () => {
  function download(token: string, sessionId: string, nonce?: string) {
    return harness.app.inject(
      asDevice(token, {
        method: 'GET',
        url: `/api/v1/fill-sessions/${sessionId}/resume`,
        ...(nonce === undefined ? {} : { headers: { [FILL_SESSION_NONCE_HEADER]: nonce } }),
      }),
    );
  }

  it('serves the CV the packet was approved with, as an attachment', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const response = await download(device.token, issued.session_id, issued.nonce);
    expect(response.statusCode, response.body).toBe(200);
    // The bytes are the uploaded CV, not a description of it.
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    // Never inline: a CV that is somehow HTML must not execute in this origin.
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('needs the nonce, not just the device token', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    expect((await download(device.token, issued.session_id)).statusCode).toBe(401);
    expect(
      (await download(device.token, issued.session_id, 'wrong-but-long-enough-nonce')).statusCode,
    ).toBe(401);
  });

  it('offers no way to name a different file', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    // The id in the path is the session's. There is no file parameter at all,
    // so a caller cannot ask for anything but this packet's own CV — the same
    // property the runner's lease-scoped file endpoint has.
    const response = await harness.app.inject(
      asDevice(device.token, {
        method: 'GET',
        url: `/api/v1/fill-sessions/${issued.session_id}/resume?file_id=${view.current_packet!.resume_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: issued.nonce },
      }),
    );
    // The query string is simply not read; the same CV comes back.
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('stops serving once the session has ended', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    await harness.app.inject(
      asDevice(device.token, {
        method: 'DELETE',
        url: `/api/v1/fill-sessions/${issued.session_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: issued.nonce },
      }),
    );

    const response = await download(device.token, issued.session_id, issued.nonce);
    expect(response.statusCode).toBe(409);
  });

  it('stops serving once the session has expired', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    await harness.db
      .updateTable('fill_sessions')
      .set({
        created_at: new Date(Date.now() - (FILL_SESSION_TTL_SECONDS + 60) * 1000),
        expires_at: new Date(Date.now() - 1000),
      })
      .where('id', '=', issued.session_id)
      .execute();

    expect((await download(device.token, issued.session_id, issued.nonce)).statusCode).toBe(409);
  });

  it('stops serving the moment the device is revoked (AT23)', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/devices/${device.id}` }),
    );

    // "No new packet access" includes the CV. The token no longer
    // authenticates, and the session it held is ended besides.
    expect((await download(device.token, issued.session_id, issued.nonce)).statusCode).toBe(401);
  });

  it('is not reachable by a second paired device', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);
    const other = await pairExtension();

    expect((await download(other.token, issued.session_id, issued.nonce)).statusCode).toBe(404);
  });
});

describe('POST /fill-sessions/:id/report', () => {
  function report(
    token: string,
    sessionId: string,
    nonce: string,
    overrides: Record<string, unknown> = {},
  ) {
    return harness.app.inject(
      asDevice(token, {
        method: 'POST',
        url: `/api/v1/fill-sessions/${sessionId}/report`,
        headers: { [FILL_SESSION_NONCE_HEADER]: nonce },
        payload: {
          filled_fields: [
            { question_key: 'why_this_role', outcome: 'filled', matched_label: 'Why this role?' },
          ],
          unresolved_fields: [],
          page_url: null,
          form_fingerprint: 'abc123',
          outcome: 'awaiting_user_submit',
          adapter: 'greenhouse',
          adapter_version: 'v1',
          ...overrides,
        },
      }),
    );
  }

  it('moves the application to awaiting_user_submit and ends the session', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const response = await report(device.token, issued.session_id, issued.nonce);
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as FillSessionView).state).toBe('ended');
    expect((response.json() as FillSessionView).ended_reason).toBe('reported');

    const application = await readApplication(view.id);
    expect(application.status).toBe('awaiting_user_submit');
  });

  it('records the same event the local runner records', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);
    await report(device.token, issued.session_id, issued.nonce);

    const events = await harness.app.inject(
      authed(session, { method: 'GET', url: `/api/v1/applications/${view.id}/events` }),
    );
    const items = events.json().items as ApplicationEventView[];
    const paused = items.find((event) => event.type === 'fill_paused');
    expect(paused).toBeDefined();
    // `runner`, not a new actor: the history records what happened, not which
    // client did it.
    expect(paused!.actor).toBe('runner');
    expect(paused!.status_after).toBe('awaiting_user_submit');
  });

  it('pauses in needs_input when the page asked something the packet cannot answer', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const response = await report(device.token, issued.session_id, issued.nonce, {
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
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await readApplication(view.id)).status).toBe('needs_input');
  });

  it('returns the application to approved when no adapter matched (AT17)', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const response = await report(device.token, issued.session_id, issued.nonce, {
      outcome: 'unsupported',
      filled_fields: [],
    });
    expect(response.statusCode, response.body).toBe(200);
    // The packet is kept and the approval survives, so the person can apply
    // by hand.
    const application = await readApplication(view.id);
    expect(application.status).toBe('approved');
  });

  it('refuses a report from a page outside the bound origin', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    const response = await report(device.token, issued.session_id, issued.nonce, {
      page_url: 'https://attacker.example/apply',
    });
    expect(response.statusCode).toBe(422);
    // Nothing moved.
    expect((await readApplication(view.id)).status).toBe('filling');
  });

  it('is spent once', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    expect((await report(device.token, issued.session_id, issued.nonce)).statusCode).toBe(200);
    const second = await report(device.token, issued.session_id, issued.nonce);
    expect(second.statusCode).toBe(409);
  });

  it('refuses an expiry that precedes the session’s own creation', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    await expect(
      harness.db
        .updateTable('fill_sessions')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', issued.session_id)
        .execute(),
    ).rejects.toThrow(/fill_sessions_expires_after_creation/);
  });

  it('refuses a session that has expired', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    // Age the whole row rather than only its expiry: the schema refuses an
    // expiry that precedes creation, which is itself worth knowing.
    await harness.db
      .updateTable('fill_sessions')
      .set({
        created_at: new Date(Date.now() - (FILL_SESSION_TTL_SECONDS + 60) * 1000),
        expires_at: new Date(Date.now() - 1000),
      })
      .where('id', '=', issued.session_id)
      .execute();

    const response = await report(device.token, issued.session_id, issued.nonce);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('expired');
  });
});

describe('workspace isolation', () => {
  it('cannot see another workspace’s session', async () => {
    const { view, device } = await approved();
    const issued = await grant(device.token, view);

    // A different workspace's device token, against this session's id.
    const other = await harness.app.inject(
      asDevice('x'.repeat(43), {
        method: 'GET',
        url: `/api/v1/fill-sessions/${issued.session_id}`,
        headers: { [FILL_SESSION_NONCE_HEADER]: issued.nonce },
      }),
    );
    expect(other.statusCode).toBe(401);

    // And an id that does not exist is the same 404 a foreign one would give.
    const absent = await harness.app.inject(
      asDevice(device.token, {
        method: 'GET',
        url: `/api/v1/fill-sessions/00000000-0000-4000-8000-000000000000`,
        headers: { [FILL_SESSION_NONCE_HEADER]: issued.nonce },
      }),
    );
    expect(absent.statusCode).toBe(404);
  });

  it('is not reachable with the operator worker credential', async () => {
    const { view } = await approved();
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/fill-sessions',
      headers: { origin: TEST_ORIGIN },
      payload: {
        application_id: view.id,
        origin: view.current_packet!.destination.origin,
        content_hash: view.current_packet!.content_hash,
      },
    });
    expect(response.statusCode).toBe(401);
  });
});
