/**
 * AT19 — "Different workspace UUID requested → 404/403; no data/file leak."
 *
 * Also covers the rule underneath it: "The API derives workspace from the
 * authenticated principal; it never trusts a client workspace_id."
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION } from '@job-getter/contracts';
import {
  asWorker,
  authed,
  completeSetup,
  createHarness,
  createSecondWorkspace,
  idempotencyKey,
  type Harness,
  type Session,
} from './helpers/harness.js';

let harness: Harness;
let alice: Session;
let bob: Session;

beforeAll(async () => {
  harness = await createHarness();
}, 180_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  alice = await completeSetup(harness);
  bob = await createSecondWorkspace(harness);
});

const PDF_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from('1 0 obj<</Type/Catalog>>endobj\n'),
  Buffer.from('trailer<</Root 1 0 R>>\n%%EOF\n'),
]);

function multipartBody(
  boundary: string,
  parts: { name: string; value?: string; filename?: string; content?: Buffer; type?: string }[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.type ?? 'application/octet-stream'}\r\n\r\n`,
        ),
      );
      chunks.push(part.content ?? Buffer.alloc(0));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
      chunks.push(Buffer.from(part.value ?? ''));
    }
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function uploadPdf(session: Session, filename = 'cv.pdf'): Promise<string> {
  const boundary = `----jobgetter${randomUUID()}`;
  const body = multipartBody(boundary, [
    { name: 'purpose', value: 'cv_original' },
    { name: 'file', filename, content: PDF_BYTES, type: 'application/pdf' },
  ]);
  const response = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    }),
  );
  expect(response.statusCode).toBe(201);
  return response.json().file.id as string;
}

async function queueEchoFor(session: Session, message: string): Promise<string> {
  const response = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/diagnostics/echo',
      headers: { 'idempotency-key': idempotencyKey() },
      payload: { message },
    }),
  );
  expect(response.statusCode).toBe(202);
  return response.json().task_id as string;
}

describe('AT19 — cross-workspace access', () => {
  it("returns 404 for another workspace's task id on every id-taking route", async () => {
    const bobTask = await queueEchoFor(bob, "bob's private message");

    const read = await harness.app.inject(
      authed(alice, { method: 'GET', url: `/api/v1/tasks/${bobTask}` }),
    );
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain("bob's private message");

    const cancel = await harness.app.inject(
      authed(alice, { method: 'POST', url: `/api/v1/tasks/${bobTask}/cancel`, payload: {} }),
    );
    expect(cancel.statusCode).toBe(404);

    // And Bob's task is untouched.
    const row = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', bobTask)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('queued');
    expect(row.cancel_requested).toBe(false);
  });

  it('is indistinguishable from a genuinely absent id', async () => {
    const bobTask = await queueEchoFor(bob, 'private');
    const absent = randomUUID();

    const foreign = await harness.app.inject(
      authed(alice, { method: 'GET', url: `/api/v1/tasks/${bobTask}` }),
    );
    const missing = await harness.app.inject(
      authed(alice, { method: 'GET', url: `/api/v1/tasks/${absent}` }),
    );

    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.json().error.code).toBe(missing.json().error.code);
    expect(foreign.json().error.message).toBe(missing.json().error.message);
  });

  it("leaks no file bytes from another workspace's file", async () => {
    const bobFile = await uploadPdf(bob, 'bob-cv.pdf');

    const response = await harness.app.inject(
      authed(alice, { method: 'GET', url: `/api/v1/files/${bobFile}/download` }),
    );
    expect(response.statusCode).toBe(404);
    expect(response.rawPayload.includes(Buffer.from('%PDF'))).toBe(false);
    expect(response.body).not.toContain('bob-cv.pdf');
  });

  it('never lists another workspace rows', async () => {
    await queueEchoFor(bob, 'bob one');
    await queueEchoFor(bob, 'bob two');
    const aliceTask = await queueEchoFor(alice, 'alice one');

    const response = await harness.app.inject(
      authed(alice, { method: 'GET', url: '/api/v1/tasks' }),
    );
    const items = response.json().items as { id: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(aliceTask);
  });

  it('ignores a client-supplied workspace_id in a request body', async () => {
    // A body key the schema does not declare is rejected outright, which is
    // the strongest possible answer: there is no path by which it could be
    // read, let alone trusted.
    const response = await harness.app.inject(
      authed(alice, {
        method: 'POST',
        url: '/api/v1/diagnostics/echo',
        headers: { 'idempotency-key': idempotencyKey() },
        payload: { message: 'hello', workspace_id: bob.workspaceId },
      }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    const bobTasks = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('workspace_id', '=', bob.workspaceId)
      .execute();
    expect(bobTasks).toEqual([]);
  });

  it('ignores a client-supplied workspace_id in a query string', async () => {
    await queueEchoFor(bob, 'bob only');

    const response = await harness.app.inject(
      authed(alice, {
        method: 'GET',
        url: `/api/v1/tasks?workspace_id=${bob.workspaceId}`,
      }),
    );
    // The query parameter is simply not part of the contract and changes
    // nothing: Alice sees her own (empty) list.
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });

  it('ignores a client-supplied workspace_id header on /me', async () => {
    const response = await harness.app.inject(
      authed(alice, {
        method: 'GET',
        url: '/api/v1/me',
        headers: { 'x-workspace-id': bob.workspaceId },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().workspace.id).toBe(alice.workspaceId);
  });

  it("scopes idempotency keys per workspace so one tenant cannot replay another's", async () => {
    const key = idempotencyKey();

    const aliceResponse = await harness.app.inject(
      authed(alice, {
        method: 'POST',
        url: '/api/v1/diagnostics/echo',
        headers: { 'idempotency-key': key },
        payload: { message: 'alice' },
      }),
    );
    expect(aliceResponse.statusCode).toBe(202);

    // Same key, same body, different workspace: a genuinely new task, not a
    // replay of Alice's response.
    const bobResponse = await harness.app.inject(
      authed(bob, {
        method: 'POST',
        url: '/api/v1/diagnostics/echo',
        headers: { 'idempotency-key': key },
        payload: { message: 'alice' },
      }),
    );
    expect(bobResponse.statusCode).toBe(202);
    expect(bobResponse.json().task_id).not.toBe(aliceResponse.json().task_id);
  });
});

describe('worker task scope', () => {
  it("will not serve a file that is not a declared input of the worker's task", async () => {
    const aliceFile = await uploadPdf(alice, 'alice-cv.pdf');
    const aliceTask = await queueEchoFor(alice, 'echo');

    const claim = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'w',
          capabilities: ['noop_echo'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    const leaseToken = claim.json().lease_token as string;

    // The file belongs to the same workspace but was never declared as an
    // input of this task, so it is unreachable.
    const response = await harness.app.inject(
      asWorker({
        method: 'GET',
        url: `/internal/v1/tasks/${aliceTask}/files/${aliceFile}`,
        headers: { 'x-lease-token': leaseToken },
      }),
    );
    expect(response.statusCode).toBe(404);
    expect(response.rawPayload.includes(Buffer.from('%PDF'))).toBe(false);
  });

  it('serves a declared input file only with the active lease token', async () => {
    const fileId = await uploadPdf(alice, 'input.pdf');
    const taskId = await queueEchoFor(alice, 'with input');
    await harness.pool.query(`UPDATE tasks SET input_file_ids = ARRAY[$1::uuid] WHERE id = $2`, [
      fileId,
      taskId,
    ]);

    const claim = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'w',
          capabilities: ['noop_echo'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    const claimed = claim.json();
    expect(claimed.files).toHaveLength(1);
    expect(claimed.files[0].file_id).toBe(fileId);
    // The worker receives metadata, never a storage key or a URL.
    expect(JSON.stringify(claimed.files[0])).not.toContain(alice.workspaceId);

    const ok = await harness.app.inject(
      asWorker({
        method: 'GET',
        url: `/internal/v1/tasks/${taskId}/files/${fileId}`,
        headers: { 'x-lease-token': claimed.lease_token },
      }),
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-disposition']).toContain('attachment');

    const wrongToken = await harness.app.inject(
      asWorker({
        method: 'GET',
        url: `/internal/v1/tasks/${taskId}/files/${fileId}`,
        headers: { 'x-lease-token': 'z'.repeat(43) },
      }),
    );
    expect(wrongToken.statusCode).toBe(409);
  });
});
