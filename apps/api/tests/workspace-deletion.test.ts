/**
 * Deleting a workspace (M4, PR14; AT26: "Access revoked, files erased,
 * completion recorded without PII").
 *
 * Each clause of AT26 is asserted where it can actually fail:
 *
 *  * **access revoked** — the session that asked, a second session, a paired
 *    device and a worker holding a lease are all refused afterwards, and the
 *    revocation holds even while erasure is still failing;
 *  * **files erased** — the bytes are gone from disk, including an object no
 *    `files` row names, and every private table is empty for the workspace;
 *  * **completion recorded without PII** — the receipt survives the workspace,
 *    is readable without a session, and contains no email, file name or
 *    answer. Nor does the ledger row that makes a restore re-delete it.
 *
 * And the parts that are this design's own: a wrong password deletes nothing,
 * another workspace is untouched, a local installation left with no owner goes
 * back to first-run, and `scripts/reapply-deletions.sql` removes the owner
 * account and reopens setup when it replays a workspace deletion.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  PROTOCOL_VERSION,
  type ClaimResponse,
  type WorkspaceDeletionView,
} from '@job-getter/contracts';
import {
  TEST_OWNER_EMAIL,
  TEST_OWNER_PASSWORD,
  asDevice,
  asWorker,
  authed,
  completeSetup,
  createHarness,
  createSecondWorkspace,
  idempotencyKey,
  type Harness,
  type Session,
} from './helpers/harness.js';
import { createLogger } from '../src/logging.js';
import { WORKSPACE_SCOPED_TABLES } from '../src/db/types.js';
import type { StorageDriver } from '../src/files/storage.js';
import {
  MAX_ERASE_ATTEMPTS,
  eraseWorkspace,
  requestWorkspaceDeletion,
  resumePendingErasures,
} from '../src/privacy/workspace-deletion.js';
import { scheduleDueScans } from '../src/discovery/scan-scheduler.js';

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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CV_NAME = 'Jane-Doe-CV.pdf';
const CV_BYTES = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';
const SECRET_ANSWER = 'my notice period is exactly 47 days';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function uploadCv(who: Session = session): Promise<string> {
  const boundary = '----jobgetterboundary';
  const head = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="purpose"',
    '',
    'cv_original',
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${CV_NAME}"`,
    'Content-Type: application/pdf',
    '',
    '',
  ].join('\r\n');
  const tail = ['', `--${boundary}--`, ''].join('\r\n');
  const response = await harness.app.inject(
    authed(who, {
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(head + CV_BYTES + tail, 'binary'),
    }),
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json().file.id as string;
}

async function storageKeyOf(fileId: string): Promise<string> {
  const row = await harness.db
    .selectFrom('files')
    .select('storage_key')
    .where('id', '=', fileId)
    .executeTakeFirstOrThrow();
  return row.storage_key;
}

async function storeAnswer(who: Session = session): Promise<void> {
  const response = await harness.app.inject(
    authed(who, {
      method: 'PUT',
      url: '/api/v1/answer-bank',
      payload: { question_key: 'notice_period', answer: SECRET_ANSWER },
    }),
  );
  expect(response.statusCode, response.body).toBe(200);
}

async function addSource(who: Session = session): Promise<string> {
  const response = await harness.app.inject(
    authed(who, {
      method: 'POST',
      url: '/api/v1/sources',
      payload: { connector: 'greenhouse', board_key: `acme-${randomUUID().slice(0, 8)}` },
    }),
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

async function pairDevice(): Promise<string> {
  const pairing = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/devices/pairing',
      payload: { device_kind: 'local_runner', label: 'Laptop' },
    }),
  );
  expect(pairing.statusCode, pairing.body).toBe(201);
  const exchanged = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/devices/exchange',
    payload: { pairing_code: pairing.json().pairing_code, device_public_id: 'test-runner' },
  });
  expect(exchanged.statusCode, exchanged.body).toBe(200);
  return exchanged.json().token as string;
}

function deleteRequest(who: Session, payload: Record<string, unknown>) {
  return harness.app.inject(authed(who, { method: 'DELETE', url: '/api/v1/workspace', payload }));
}

async function deleteWorkspace(who: Session = session): Promise<WorkspaceDeletionView> {
  const response = await deleteRequest(who, { confirm: true, password: TEST_OWNER_PASSWORD });
  expect(response.statusCode, response.body).toBe(202);
  return response.json() as WorkspaceDeletionView;
}

function getMe(who: Session) {
  return harness.app.inject(authed(who, { method: 'GET', url: '/api/v1/me' }));
}

/** Rows left in every workspace-scoped table for one workspace. */
async function privateRowsFor(workspaceId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of WORKSPACE_SCOPED_TABLES) {
    const result = await harness.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE workspace_id = $1`,
      [workspaceId],
    );
    const n = Number(result.rows[0]!.n);
    if (n > 0) counts[table] = n;
  }
  return counts;
}

function eraseContext(storage: StorageDriver = harness.storage) {
  return {
    db: harness.db,
    storage,
    config: harness.config,
    logger: createLogger({ level: 'silent' }),
  };
}

/** A storage driver whose deletes fail, standing in for an unreachable volume. */
function brokenStorage(): StorageDriver {
  return {
    ...harness.storage,
    kind: 'local',
    put: (key, data) => harness.storage.put(key, data),
    createReadStream: (key) => harness.storage.createReadStream(key),
    read: (key) => harness.storage.read(key),
    stat: (key) => harness.storage.stat(key),
    healthCheck: () => harness.storage.healthCheck(),
    delete: async () => {
      throw new Error('EIO: the storage volume is not responding');
    },
    deleteWorkspaceObjects: async () => {
      throw new Error('EIO: the storage volume is not responding');
    },
  };
}

// ---------------------------------------------------------------------------

describe('DELETE /workspace: what it demands', () => {
  it('refuses a wrong password with 403 and deletes nothing', async () => {
    await uploadCv();
    const response = await deleteRequest(session, { confirm: true, password: 'not the password' });
    expect(response.statusCode, response.body).toBe(403);

    // Still signed in, still active, nothing recorded.
    expect((await getMe(session)).statusCode).toBe(200);
    const workspace = await harness.db
      .selectFrom('workspaces')
      .select('deletion_state')
      .where('id', '=', session.workspaceId)
      .executeTakeFirstOrThrow();
    expect(workspace.deletion_state).toBe('active');
    expect(await harness.db.selectFrom('workspace_deletions').selectAll().execute()).toEqual([]);
    expect(await harness.db.selectFrom('deletion_ledger').selectAll().execute()).toEqual([]);
  });

  it('refuses a request without the explicit confirmation', async () => {
    for (const payload of [
      { password: TEST_OWNER_PASSWORD },
      { confirm: false, password: TEST_OWNER_PASSWORD },
      { confirm: 'yes', password: TEST_OWNER_PASSWORD },
    ]) {
      const response = await deleteRequest(session, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await getMe(session)).statusCode).toBe(200);
  });

  it('refuses without a session, and without the anti-CSRF token', async () => {
    const anonymous = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/workspace',
      headers: { origin: 'http://localhost:3000' },
      payload: { confirm: true, password: TEST_OWNER_PASSWORD },
    });
    expect(anonymous.statusCode).toBe(401);

    const noCsrf = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/workspace',
      headers: { origin: 'http://localhost:3000', cookie: session.cookie },
      payload: { confirm: true, password: TEST_OWNER_PASSWORD },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect((await getMe(session)).statusCode).toBe(200);
  });
});

describe('AT26: access revoked', () => {
  it('signs out the session that asked, and clears its cookies', async () => {
    const response = await deleteRequest(session, { confirm: true, password: TEST_OWNER_PASSWORD });
    expect(response.statusCode, response.body).toBe(202);
    const cookies = [response.headers['set-cookie']].flat().join('\n');
    expect(cookies).toMatch(/jg_session=;/);
    expect((await getMe(session)).statusCode).toBe(401);
  });

  it('signs out every other session of the workspace at the same instant', async () => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:3000' },
      payload: { email: TEST_OWNER_EMAIL, password: TEST_OWNER_PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    const raw = [login.headers['set-cookie']].flat().join(';');
    const token = /jg_session=([^;]+)/.exec(raw)![1]!;
    const csrf = /jg_csrf=([^;]+)/.exec(raw)![1]!;
    const second: Session = {
      ...session,
      cookie: `jg_session=${token}; jg_csrf=${csrf}`,
      csrfToken: csrf,
    };
    expect((await getMe(second)).statusCode).toBe(200);

    await deleteWorkspace();
    expect((await getMe(second)).statusCode).toBe(401);
  });

  it('refuses a paired device on its very next request', async () => {
    const token = await pairDevice();
    const before = await harness.app.inject(
      asDevice(token, {
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: { worker_id: 'runner-1', capabilities: ['fill_local'], protocol_version: 1 },
      }),
    );
    expect(before.statusCode).toBe(204);

    await deleteWorkspace();

    const after = await harness.app.inject(
      asDevice(token, {
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: { worker_id: 'runner-1', capabilities: ['fill_local'], protocol_version: 1 },
      }),
    );
    expect(after.statusCode).toBe(401);
  });

  it('stops a worker mid-task: its lease is void before erasure even starts', async () => {
    const queued = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/diagnostics/echo',
        headers: { 'idempotency-key': idempotencyKey() },
        payload: { message: 'hello' },
      }),
    );
    expect(queued.statusCode).toBe(202);
    const claimed = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'worker-1',
          capabilities: ['noop_echo'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    expect(claimed.statusCode).toBe(200);
    const lease = claimed.json() as ClaimResponse;

    // Revocation only, so the task row still exists to be asked about.
    await requestWorkspaceDeletion(harness.db, session.workspaceId);

    const completed = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${lease.task_id}/complete`,
        payload: {
          lease_token: lease.lease_token,
          result_schema_version: 1,
          result: {
            echoed: 'hello',
            worker_id: 'worker-1',
            worker_runtime: 'python-3.12',
            processed_at: new Date().toISOString(),
          },
        },
      }),
    );
    expect(completed.statusCode).toBe(409);
    const heartbeat = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${lease.task_id}/heartbeat`,
        payload: { lease_token: lease.lease_token, progress: { stage: 'x', percent: 50 } },
      }),
    );
    expect(heartbeat.statusCode).toBe(409);
  });

  it('refuses a fresh login while erasure is still running', async () => {
    await requestWorkspaceDeletion(harness.db, session.workspaceId);
    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:3000' },
      payload: { email: TEST_OWNER_EMAIL, password: TEST_OWNER_PASSWORD },
    });
    expect(login.statusCode).toBe(401);
  });

  it('queues no more scans for the workspace', async () => {
    await addSource();
    await requestWorkspaceDeletion(harness.db, session.workspaceId);
    const result = await scheduleDueScans(harness.db, { random: () => 0 });
    expect(result.queued).toEqual([]);
  });
});

describe('AT26: files erased', () => {
  it('removes the bytes, every private row and the owner account', async () => {
    const cvId = await uploadCv();
    const key = await storageKeyOf(cvId);
    await storeAnswer();
    await addSource();
    await pairDevice();
    // An object no row names, as a crashed upload would leave behind.
    const orphan = join(harness.filesRoot, session.workspaceId, randomUUID());
    writeFileSync(orphan, 'orphaned bytes');

    expect(existsSync(join(harness.filesRoot, key))).toBe(true);

    const receipt = await deleteWorkspace();
    expect(receipt.state).toBe('completed');
    expect(receipt.files_erased).toBe(1);

    expect(existsSync(join(harness.filesRoot, key))).toBe(false);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(join(harness.filesRoot, session.workspaceId))).toBe(false);

    expect(await privateRowsFor(session.workspaceId)).toEqual({});
    const workspace = await harness.db
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', session.workspaceId)
      .executeTakeFirst();
    expect(workspace).toBeUndefined();
    const user = await harness.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', session.userId)
      .executeTakeFirst();
    expect(user).toBeUndefined();
  });

  it('leaves another workspace, its files and its owner exactly as they were', async () => {
    const other = await createSecondWorkspace(harness);
    const otherFile = await uploadCv(other);
    const otherKey = await storageKeyOf(otherFile);
    await storeAnswer(other);
    const before = await privateRowsFor(other.workspaceId);

    await uploadCv();
    const receipt = await deleteWorkspace();
    expect(receipt.state).toBe('completed');

    expect(await privateRowsFor(other.workspaceId)).toEqual(before);
    expect(readFileSync(join(harness.filesRoot, otherKey), 'utf8')).toBe(CV_BYTES);
    expect((await getMe(other)).statusCode).toBe(200);
    // Someone is still here, so setup stays closed.
    expect(receipt.setup_reopened).toBe(false);
    const setup = await harness.app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(setup.json().setup_required).toBe(false);
  });
});

describe('AT26: completion recorded without PII', () => {
  it('keeps a receipt anyone holding its id can read, naming nobody', async () => {
    await uploadCv();
    await storeAnswer();
    const receipt = await deleteWorkspace();

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/workspace/deletions/${receipt.deletion_id}`,
    });
    expect(read.statusCode, read.body).toBe(200);
    const view = read.json() as WorkspaceDeletionView;
    expect(view).toMatchObject({
      deletion_id: receipt.deletion_id,
      state: 'completed',
      files_erased: 1,
      failure_code: null,
    });
    expect(view.completed_at).not.toBeNull();

    // What is stored about the deletion, anywhere that survives it.
    const stored = JSON.stringify([
      await harness.db.selectFrom('workspace_deletions').selectAll().execute(),
      await harness.db.selectFrom('deletion_ledger').selectAll().execute(),
    ]);
    for (const pii of [TEST_OWNER_EMAIL, 'owner@', CV_NAME, 'Jane', SECRET_ANSWER]) {
      expect(stored, pii).not.toContain(pii);
    }
  });

  it('records the workspace in the ledger, so a restore re-deletes it', async () => {
    await deleteWorkspace();
    const rows = await harness.db.selectFrom('deletion_ledger').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: session.workspaceId,
      object_kind: 'workspace',
      object_id: null,
      reason: 'user_request',
    });
  });

  it('answers 404 for a receipt that does not exist', async () => {
    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/workspace/deletions/${randomUUID()}`,
    });
    expect(read.statusCode).toBe(404);
  });
});

describe('a local installation with no owner left goes back to first-run', () => {
  it('reopens setup, and setup then works with the same token', async () => {
    const receipt = await deleteWorkspace();
    expect(receipt.setup_reopened).toBe(true);

    const status = await harness.app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(status.json().setup_required).toBe(true);

    const fresh = await completeSetup(harness);
    expect(fresh.workspaceId).not.toBe(session.workspaceId);
    expect((await getMe(fresh)).statusCode).toBe(200);
    // A clean slate: nothing from before.
    const answers = await harness.app.inject(
      authed(fresh, { method: 'GET', url: '/api/v1/answer-bank' }),
    );
    expect(answers.json().items ?? answers.json()).toEqual([]);
  });

  it('does not reopen setup in hosted mode', async () => {
    // Hosted mode will not boot without M6 settings, so the rule is asserted
    // on the erasure itself.
    const requested = await requestWorkspaceDeletion(harness.db, session.workspaceId);
    const done = await eraseWorkspace(
      { ...eraseContext(), config: { isHosted: true } },
      requested.id,
    );
    expect(done.state).toBe('completed');
    expect(done.setup_reopened).toBe(false);
    const flag = await harness.db
      .selectFrom('system_flags')
      .select('key')
      .where('key', '=', 'setup_completed')
      .executeTakeFirst();
    expect(flag).toBeDefined();
  });
});

describe('an erasure that cannot finish', () => {
  it('keeps access revoked, retries, and says failed when retries run out', async () => {
    const cvId = await uploadCv();
    const key = await storageKeyOf(cvId);
    const requested = await requestWorkspaceDeletion(harness.db, session.workspaceId);

    let receipt = await eraseWorkspace(eraseContext(brokenStorage()), requested.id);
    expect(receipt.state).toBe('erasing');
    expect(receipt.attempts).toBe(1);
    // Revocation does not wait for erasure.
    expect((await getMe(session)).statusCode).toBe(401);

    for (let attempt = 2; attempt <= MAX_ERASE_ATTEMPTS; attempt += 1) {
      receipt = await eraseWorkspace(eraseContext(brokenStorage()), requested.id);
    }
    expect(receipt.state).toBe('failed');
    expect(receipt.failure_code).toBe('erasure_failed');

    // The public view says so, which is the "show completion or failure" half.
    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/workspace/deletions/${requested.id}`,
    });
    expect(read.json().state).toBe('failed');
    // Nothing was half-deleted: the rows are there for an operator to retry.
    expect(existsSync(join(harness.filesRoot, key))).toBe(true);
  });

  it('is resumed by the scheduler once storage recovers', async () => {
    const cvId = await uploadCv();
    const key = await storageKeyOf(cvId);
    const requested = await requestWorkspaceDeletion(harness.db, session.workspaceId);
    await eraseWorkspace(eraseContext(brokenStorage()), requested.id);

    // Fresh receipts are left to the request still working on them.
    expect((await resumePendingErasures(eraseContext())).resumed).toBe(0);

    await harness.pool.query(
      `UPDATE workspace_deletions SET updated_at = now() - interval '5 minutes' WHERE id = $1`,
      [requested.id],
    );
    expect((await resumePendingErasures(eraseContext())).resumed).toBe(1);

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/workspace/deletions/${requested.id}`,
    });
    expect(read.json()).toMatchObject({ state: 'completed', files_erased: 1 });
    expect(existsSync(join(harness.filesRoot, key))).toBe(false);
  });

  it('is safe to run twice', async () => {
    await uploadCv();
    const requested = await requestWorkspaceDeletion(harness.db, session.workspaceId);
    const first = await eraseWorkspace(eraseContext(), requested.id);
    const second = await eraseWorkspace(eraseContext(), requested.id);
    expect(first.state).toBe('completed');
    expect(second).toEqual(first);
  });
});

describe('scripts/reapply-deletions.sql after a restore', () => {
  it('re-deletes a workspace, its owner, and reopens setup', async () => {
    await uploadCv();
    await storeAnswer();
    // A restored database: the rows are back, and the merged ledger says the
    // workspace was deleted after the backup was taken.
    await harness.db
      .insertInto('deletion_ledger')
      .values({ workspace_id: session.workspaceId, object_kind: 'workspace', object_id: null })
      .execute();

    const script = readFileSync(join(REPO_ROOT, 'scripts', 'reapply-deletions.sql'), 'utf8');
    await harness.pool.query(script);

    expect(await privateRowsFor(session.workspaceId)).toEqual({});
    const users = await harness.db.selectFrom('users').select('id').execute();
    expect(users).toEqual([]);
    const status = await harness.app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(status.json().setup_required).toBe(true);
  });

  it('leaves the owner of a surviving workspace alone', async () => {
    const other = await createSecondWorkspace(harness);
    await harness.db
      .insertInto('deletion_ledger')
      .values({ workspace_id: session.workspaceId, object_kind: 'workspace', object_id: null })
      .execute();

    const script = readFileSync(join(REPO_ROOT, 'scripts', 'reapply-deletions.sql'), 'utf8');
    await harness.pool.query(script);

    expect((await getMe(other)).statusCode).toBe(200);
    const status = await harness.app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(status.json().setup_required).toBe(false);
  });
});
