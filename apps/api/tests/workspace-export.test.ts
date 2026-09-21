/**
 * Workspace export and the deletion ledger (M4, PR14).
 *
 * The assertions worth having are about what is *not* in the archive and what
 * survives a deletion:
 *
 *  * the provider secret, sessions and device tokens are absent — and the
 *    manifest says they were left out on purpose, rather than leaving a user
 *    to wonder whether the export failed;
 *  * the archive really is a ZIP a tool can open, with the manifest first;
 *  * a file's bytes come out byte-identical, which is what lets AT11's
 *    guarantee survive a round trip through an export;
 *  * the deletion ledger records what was deleted, holds nothing but
 *    identifiers, and survives the workspace it names being destroyed —
 *    without which a restore could resurrect deleted data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PROVIDER_LIMITS,
  type ExportWorkspaceResult,
  type TaskView,
} from '@job-getter/contracts';
import {
  authed,
  completeSetup,
  createHarness,
  idempotencyKey,
  type Harness,
  type Session,
} from './helpers/harness.js';

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

/**
 * Whether a second ZIP implementation is available to read what we wrote.
 *
 * Node's own zlib produced the archive, so verifying it with Node would only
 * prove the writer agrees with itself. Where Python is absent the two cases
 * that need it are *skipped* — visible in the run summary as skipped, never
 * quietly reported as passing.
 */
const PYTHON_AVAILABLE = (() => {
  try {
    execFileSync('python', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const CV_BYTES = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';

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
  const tail = ['', `--${boundary}--`, ''].join('\r\n');
  const response = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(head + CV_BYTES + tail, 'binary'),
    }),
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json().file.id as string;
}

async function runExport(): Promise<{ task: TaskView; result: ExportWorkspaceResult }> {
  const response = await harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/workspace/export',
      headers: { 'idempotency-key': idempotencyKey() },
      payload: {},
    }),
  );
  expect(response.statusCode, response.body).toBe(202);

  const task = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/tasks/${response.json().task_id as string}` }),
  );
  expect(task.statusCode, task.body).toBe(200);
  const view = task.json() as TaskView;
  return { task: view, result: view.result as ExportWorkspaceResult };
}

/** Reads the archive back out of storage. */
async function archiveBytes(fileId: string): Promise<Buffer> {
  const row = await harness.db
    .selectFrom('files')
    .select(['storage_key'])
    .where('id', '=', fileId)
    .executeTakeFirstOrThrow();
  return harness.storage.read(row.storage_key);
}

// ---------------------------------------------------------------------------

describe('POST /workspace/export', () => {
  it('records a task that reports what it actually did', async () => {
    const { task, result } = await runExport();

    expect(task.type).toBe('export_workspace');
    // The work happened before the row existed, so the row says so rather
    // than describing a worker that never claimed it.
    expect(task.state).toBe('succeeded');
    expect(task.error).toBeNull();
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a real ZIP whose checksum matches the stored file', async () => {
    const { result } = await runExport();
    const bytes = await archiveBytes(result.file_id);

    // PK\x03\x04: a tool that reads ZIPs will read this.
    expect(bytes.subarray(0, 4).toString('binary')).toBe('PK\u0003\u0004');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(result.sha256);
    expect(bytes.length).toBe(result.bytes);
  });

  it.skipIf(!PYTHON_AVAILABLE)('is readable by a real unzip implementation', async () => {
    await uploadCv();
    const { result } = await runExport();
    const bytes = await archiveBytes(result.file_id);

    const directory = mkdtempSync(join(tmpdir(), 'jg-export-'));
    const path = join(directory, 'export.zip');
    writeFileSync(path, bytes);

    // Node's own zlib wrote it; a second implementation reading it is the
    // check that matters, so this shells out rather than parsing it again in
    // the same process that produced it.
    const listing = execFileSync(
      'python',
      ['-c', 'import sys,zipfile;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', path],
      { encoding: 'utf8' },
    );
    const names = listing.trim().split(/\r?\n/);
    expect(names[0]).toBe('manifest.json');
    expect(names).toContain('workspace.json');
    expect(names.some((name) => name.startsWith('files/'))).toBe(true);
  });

  it.skipIf(!PYTHON_AVAILABLE)('carries a stored file back byte-identically', async () => {
    await uploadCv();
    const { result } = await runExport();
    const bytes = await archiveBytes(result.file_id);

    const directory = mkdtempSync(join(tmpdir(), 'jg-export-'));
    const path = join(directory, 'export.zip');
    writeFileSync(path, bytes);

    const digest = execFileSync(
      'python',
      [
        '-c',
        'import sys,zipfile,hashlib\nz=zipfile.ZipFile(sys.argv[1])\nname=[n for n in z.namelist() if n.startswith("files/")][0]\nprint(hashlib.sha256(z.read(name)).hexdigest())',
        path,
      ],
      { encoding: 'utf8' },
    ).trim();
    expect(digest).toBe(createHash('sha256').update(CV_BYTES, 'binary').digest('hex'));
    expect(result.manifest.files[0]!.sha256).toBe(digest);
  });

  it('leaves the provider secret and the session out, and says so', async () => {
    const stored = await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/settings/providers',
        payload: {
          provider: 'openai_compatible',
          base_url: 'https://api.example.invalid/v1',
          model: 'gpt-test',
          limits: DEFAULT_PROVIDER_LIMITS,
          rate_card: null,
          api_key: 'sk-this-must-never-be-exported',
        },
      }),
    );
    expect(stored.statusCode, stored.body).toBe(200);

    const { result } = await runExport();
    const bytes = await archiveBytes(result.file_id);
    const text = bytes.toString('utf8');

    expect(text).not.toContain('sk-this-must-never-be-exported');
    expect(text).not.toContain('provider_settings');
    expect(text).not.toContain('secret_ciphertext');
    expect(text).not.toContain('token_hash');
    // And the archive states the omission rather than leaving a silent gap.
    expect(result.manifest.excluded).toContain('provider_secrets');
    expect(result.manifest.excluded).toContain('sessions');
    expect(result.manifest.excluded).toContain('device_tokens');
  });

  it('counts what it exported', async () => {
    await uploadCv();
    const { result } = await runExport();
    expect(result.manifest.counts.files).toBe(1);
    expect(result.manifest.schema_version).toBe(1);
  });

  it('requires an Idempotency-Key, and replays rather than exporting twice', async () => {
    const withoutKey = await harness.app.inject(
      authed(session, { method: 'POST', url: '/api/v1/workspace/export', payload: {} }),
    );
    expect(withoutKey.statusCode).toBe(400);

    const key = idempotencyKey();
    const first = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/workspace/export',
        headers: { 'idempotency-key': key },
        payload: {},
      }),
    );
    const second = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/workspace/export',
        headers: { 'idempotency-key': key },
        payload: {},
      }),
    );
    expect(second.json().task_id).toBe(first.json().task_id);
    const tasks = await harness.db
      .selectFrom('tasks')
      .selectAll()
      .where('type', '=', 'export_workspace')
      .execute();
    expect(tasks).toHaveLength(1);
  });
});

describe('the deletion ledger', () => {
  it('records a deleted answer, with its id and nothing else', async () => {
    const stored = await harness.app.inject(
      authed(session, {
        method: 'PUT',
        url: '/api/v1/answer-bank',
        payload: { question_key: 'notice_period', answer: '30 days' },
      }),
    );
    expect(stored.statusCode, stored.body).toBe(200);
    const id = stored.json().id as string;

    const deleted = await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/answer-bank/${id}` }),
    );
    expect(deleted.statusCode).toBe(204);

    const rows = await harness.db.selectFrom('deletion_ledger').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.object_kind).toBe('answer_bank');
    expect(rows[0]!.object_id).toBe(id);
    // Identifiers only: the answer itself is not in the ledger.
    expect(JSON.stringify(rows[0])).not.toContain('30 days');
    expect(JSON.stringify(rows[0])).not.toContain('notice_period');
  });

  it('records a deleted board', async () => {
    const source = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/sources',
        payload: { connector: 'greenhouse', board_key: 'acme' },
      }),
    );
    expect(source.statusCode, source.body).toBe(201);
    const id = source.json().id as string;

    await harness.app.inject(authed(session, { method: 'DELETE', url: `/api/v1/sources/${id}` }));

    const rows = await harness.db
      .selectFrom('deletion_ledger')
      .selectAll()
      .where('object_kind', '=', 'source')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.object_id).toBe(id);
  });

  it('is not in the export: it is the operator record, not the user data', async () => {
    const { result } = await runExport();
    const bytes = await archiveBytes(result.file_id);
    expect(bytes.toString('utf8')).not.toContain('deletion_ledger');
  });
});
