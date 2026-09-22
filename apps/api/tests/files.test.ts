/**
 * File upload validation, storage-key generation, attachment downloads and
 * task-artifact staging (09_SECURITY_PRIVACY.md).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ARTIFACT_STAGING_TTL_HOURS, PROTOCOL_VERSION } from '@job-getter/contracts';
import { sanitizeFilename, contentDispositionFor } from '../src/files/service.js';
import { S3StorageDriver } from '../src/files/storage.js';
import { sweepStaleArtifacts } from '../src/tasks/scheduler.js';
import {
  asWorker,
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

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer\n%%EOF\n');
/** A real 1x1 PNG: `file-type` needs the IHDR chunk, not just the signature. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(
  parts: { name: string; value?: string; filename?: string; content?: Buffer; type?: string }[],
): { body: Buffer; contentType: string } {
  const boundary = `----jobgetter${randomUUID()}`;
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
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(options: {
  filename: string;
  content: Buffer;
  purpose?: string;
  type?: string;
}) {
  const { body, contentType } = multipart([
    { name: 'purpose', value: options.purpose ?? 'cv_original' },
    {
      name: 'file',
      filename: options.filename,
      content: options.content,
      type: options.type ?? 'application/octet-stream',
    },
  ]);
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': contentType },
      payload: body,
    }),
  );
}

describe('upload validation', () => {
  it('accepts a PDF and records size, sha256 and honest validation detail', async () => {
    const response = await upload({
      filename: 'my resume.pdf',
      content: PDF_BYTES,
      type: 'application/pdf',
    });
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.file.mime).toBe('application/pdf');
    expect(body.file.bytes).toBe(PDF_BYTES.byteLength);
    expect(body.file.sha256).toBe(createHash('sha256').update(PDF_BYTES).digest('hex'));
    expect(body.file.state).toBe('ready');
    expect(body.validation.signature_ok).toBe(true);
    expect(body.validation.extension_matches_signature).toBe(true);
    // No scanner is configured locally; the status says exactly that rather
    // than implying the file is clean.
    expect(body.validation.malware_scan).toBe('skipped_not_configured');
  });

  it('generates a storage key that is not the user filename', async () => {
    const response = await upload({
      filename: 'Sensitive Name 2026.pdf',
      content: PDF_BYTES,
      type: 'application/pdf',
    });
    const fileId = response.json().file.id as string;

    const row = await harness.db
      .selectFrom('files')
      .selectAll()
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();

    expect(row.storage_key).toBe(`${session.workspaceId}/${fileId}`);
    expect(row.storage_key).not.toContain('Sensitive');
    expect(row.storage_key).not.toContain('.pdf');
    // The original name is still recorded for display.
    expect(row.original_name).toBe('Sensitive Name 2026.pdf');

    // And on disk, the path contains no user-controlled text either.
    const workspaceDir = join(harness.filesRoot, session.workspaceId);
    const entries = await readdir(workspaceDir);
    expect(entries).toEqual([fileId]);
  });

  it('rejects a file whose magic bytes contradict its extension', async () => {
    const response = await upload({
      filename: 'definitely-a-cv.pdf',
      content: PNG_BYTES,
      type: 'application/pdf',
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNPROCESSABLE');
    expect(response.json().error.fields?.file).toContain('signature');

    // Nothing was written.
    expect(await harness.db.selectFrom('files').selectAll().execute()).toEqual([]);
  });

  it('rejects a type that is not accepted for the declared purpose', async () => {
    const response = await upload({
      filename: 'photo.png',
      content: PNG_BYTES,
      type: 'image/png',
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('not accepted for cv_original');
  });

  it('rejects an oversized upload with 413', async () => {
    const small = await createHarness({ env: { MAX_UPLOAD_BYTES: '2048' } });
    try {
      const smallSession = await completeSetup(small);
      const oversized = Buffer.concat([PDF_BYTES, Buffer.alloc(8192, 0x20)]);
      const { body, contentType } = multipart([
        { name: 'purpose', value: 'cv_original' },
        { name: 'file', filename: 'big.pdf', content: oversized, type: 'application/pdf' },
      ]);

      const response = await small.app.inject(
        authed(smallSession, {
          method: 'POST',
          url: '/api/v1/files',
          headers: { 'content-type': contentType },
          payload: body,
        }),
      );
      expect(response.statusCode).toBe(413);
      expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(await small.db.selectFrom('files').selectAll().execute()).toEqual([]);
    } finally {
      await small.close();
    }
  }, 240_000);

  it('rejects an upload with no purpose', async () => {
    const { body, contentType } = multipart([
      { name: 'file', filename: 'cv.pdf', content: PDF_BYTES, type: 'application/pdf' },
    ]);
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/files',
        headers: { 'content-type': contentType },
        payload: body,
      }),
    );
    expect(response.statusCode).toBe(422);
  });

  it('accepts plain text for profile_text and says how it was validated', async () => {
    const response = await upload({
      filename: 'profile.txt',
      content: Buffer.from('Software engineer with ten years of experience.', 'utf8'),
      purpose: 'profile_text',
      type: 'text/plain',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().file.mime).toBe('text/plain');
    expect(response.json().validation.warnings.join(' ')).toContain('no magic-byte signature');
  });

  it('rejects binary content masquerading as plain text', async () => {
    const response = await upload({
      filename: 'profile.txt',
      content: Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]),
      purpose: 'profile_text',
      type: 'text/plain',
    });
    expect(response.statusCode).toBe(422);
  });

  it('flags an encrypted PDF rather than silently accepting it as parseable', async () => {
    const encrypted = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('trailer<</Encrypt 9 0 R/Root 1 0 R>>\n%%EOF\n'),
    ]);
    const response = await upload({
      filename: 'locked.pdf',
      content: encrypted,
      type: 'application/pdf',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().validation.encrypted).toBe(true);
    expect(response.json().validation.warnings.join(' ')).toContain('encrypted');
  });
});

describe('download', () => {
  it('serves an attachment with a sanitised filename and nosniff', async () => {
    const uploaded = await upload({
      filename: 'my weird/name;drop.pdf',
      content: PDF_BYTES,
      type: 'application/pdf',
    });
    const fileId = uploaded.json().file.id as string;

    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: `/api/v1/files/${fileId}/download` }),
    );
    expect(response.statusCode).toBe(200);

    const disposition = response.headers['content-disposition'] as string;
    expect(disposition.startsWith('attachment;')).toBe(true);
    expect(disposition).not.toContain('/');
    expect(disposition.split(';')[1]).not.toContain('drop.pdf;');
    expect(disposition).toMatch(/filename="[A-Za-z0-9._()\- ]+"/);
    expect(disposition).toContain("filename*=UTF-8''");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.rawPayload.equals(PDF_BYTES)).toBe(true);
  });

  it('never serves uploaded content inline as HTML', async () => {
    // A .txt upload whose content is HTML must still arrive as an attachment
    // and must not be labelled text/html.
    const uploaded = await upload({
      filename: 'notes.txt',
      content: Buffer.from('<script>alert(1)</script>', 'utf8'),
      purpose: 'profile_text',
      type: 'text/plain',
    });
    const fileId = uploaded.json().file.id as string;

    const response = await harness.app.inject(
      authed(session, { method: 'GET', url: `/api/v1/files/${fileId}/download` }),
    );
    expect(response.headers['content-type']).not.toContain('text/html');
    expect(response.headers['content-disposition']).toContain('attachment');
  });

  it('requires a session: there is no public permanent URL', async () => {
    const uploaded = await upload({
      filename: 'cv.pdf',
      content: PDF_BYTES,
      type: 'application/pdf',
    });
    const fileId = uploaded.json().file.id as string;

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}/download`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('filename sanitisation', () => {
  it('strips path separators, control characters and quotes', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('..\\..\\windows\\system32')).not.toContain('\\');
    expect(sanitizeFilename('a"b\r\nc.pdf')).not.toMatch(/["\r\n]/);
    expect(sanitizeFilename('')).toBe('download');
    expect(sanitizeFilename('...')).toBe('download');
    expect(sanitizeFilename('a'.repeat(400)).length).toBeLessThanOrEqual(100);
  });

  it('preserves the original through the RFC 5987 parameter', () => {
    const header = contentDispositionFor('Currículum Vítae.pdf');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain('Curr%C3%ADculum');
  });
});

describe('task artifacts', () => {
  async function leaseATask(): Promise<{ taskId: string; leaseToken: string }> {
    const queued = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/diagnostics/echo',
        headers: { 'idempotency-key': idempotencyKey() },
        payload: { message: 'artifact test' },
      }),
    );
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
    return { taskId: queued.json().task_id, leaseToken: claim.json().lease_token };
  }

  async function uploadArtifact(taskId: string, leaseToken: string) {
    const { body, contentType } = multipart([
      { name: 'lease_token', value: leaseToken },
      { name: 'purpose', value: 'generated_cv' },
      { name: 'file', filename: 'generated.pdf', content: PDF_BYTES, type: 'application/pdf' },
    ]);
    return harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/artifacts`,
        headers: { 'content-type': contentType },
        payload: body,
      }),
    );
  }

  it('creates a staging file tied to the lease, committed only on completion', async () => {
    const { taskId, leaseToken } = await leaseATask();

    const response = await uploadArtifact(taskId, leaseToken);
    expect(response.statusCode).toBe(201);
    expect(response.json().committed).toBe(false);
    const fileId = response.json().file_id as string;

    const staged = await harness.db
      .selectFrom('files')
      .selectAll()
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(staged.state).toBe('staging');
    expect(staged.expires_at).not.toBeNull();
    const ttlHours = (staged.expires_at!.getTime() - Date.now()) / 3_600_000;
    expect(Math.round(ttlHours)).toBe(ARTIFACT_STAGING_TTL_HOURS);

    const artifact = await harness.db
      .selectFrom('task_artifacts')
      .selectAll()
      .where('file_id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(artifact.committed).toBe(false);

    await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: leaseToken,
          result_schema_version: 1,
          result: {
            echoed: 'artifact test',
            worker_id: 'w',
            worker_runtime: 'python-3.12',
            processed_at: new Date().toISOString(),
          },
        },
      }),
    );

    const committed = await harness.db
      .selectFrom('files')
      .selectAll()
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(committed.state).toBe('ready');
    expect(committed.expires_at).toBeNull();
  });

  it('refuses an artifact upload with a stale lease token and writes nothing', async () => {
    const { taskId } = await leaseATask();
    const response = await uploadArtifact(taskId, 'x'.repeat(43));
    expect(response.statusCode).toBe(409);
    expect(await harness.db.selectFrom('files').selectAll().execute()).toEqual([]);
  });

  it('AT18: an artifact staged by a reclaimed lease is never committed', async () => {
    const { taskId, leaseToken: crashed } = await leaseATask();

    // The first worker uploads a real artifact, then stops heartbeating.
    const staged = await uploadArtifact(taskId, crashed);
    expect(staged.statusCode).toBe(201);
    const abandonedFileId = staged.json().file_id as string;

    await harness.pool.query(
      `UPDATE tasks SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [taskId],
    );
    const reclaimed = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'w2',
          capabilities: ['noop_echo'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    expect(reclaimed.statusCode).toBe(200);
    const freshToken = reclaimed.json().lease_token as string;

    const redone = await uploadArtifact(taskId, freshToken);
    expect(redone.statusCode).toBe(201);
    const committedFileId = redone.json().file_id as string;

    await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: freshToken,
          result_schema_version: 1,
          result: {
            echoed: 'artifact test',
            worker_id: 'w2',
            worker_runtime: 'python-3.12',
            processed_at: new Date().toISOString(),
          },
        },
      }),
    );

    // Completion commits only what the *winning* lease uploaded. The crashed
    // worker's file is a half-made document nobody reviewed; it stays staging
    // and the sweeper takes it, rather than becoming part of the user's data
    // alongside the real one.
    const abandoned = await harness.db
      .selectFrom('files')
      .selectAll()
      .where('id', '=', abandonedFileId)
      .executeTakeFirstOrThrow();
    expect(abandoned.state).toBe('staging');
    expect(abandoned.expires_at).not.toBeNull();

    const committed = await harness.db
      .selectFrom('files')
      .selectAll()
      .where('id', '=', committedFileId)
      .executeTakeFirstOrThrow();
    expect(committed.state).toBe('ready');
    expect(committed.expires_at).toBeNull();

    const rows = await harness.db
      .selectFrom('task_artifacts')
      .selectAll()
      .where('task_id', '=', taskId)
      .execute();
    expect(rows.filter((row) => row.committed)).toHaveLength(1);
  });

  it('sweeps unreferenced staging artifacts after their 24-hour window', async () => {
    const { taskId, leaseToken } = await leaseATask();
    const uploaded = await uploadArtifact(taskId, leaseToken);
    const fileId = uploaded.json().file_id as string;

    const stored = await harness.db
      .selectFrom('files')
      .select('storage_key')
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();
    expect(await harness.storage.stat(stored.storage_key)).not.toBeNull();

    // Nothing to sweep while the window is open.
    expect((await sweepStaleArtifacts(harness.db, harness.storage)).deleted).toBe(0);

    await harness.pool.query(`UPDATE files SET expires_at = now() - interval '1 minute'`);
    const swept = await sweepStaleArtifacts(harness.db, harness.storage);
    expect(swept.deleted).toBe(1);

    expect(
      await harness.db.selectFrom('files').selectAll().where('id', '=', fileId).executeTakeFirst(),
    ).toBeUndefined();
    // The bytes are gone from storage too, not just the row.
    expect(await harness.storage.stat(stored.storage_key)).toBeNull();
  });

  it('never sweeps an artifact a completed task committed', async () => {
    const { taskId, leaseToken } = await leaseATask();
    const uploaded = await uploadArtifact(taskId, leaseToken);
    await harness.app.inject(
      asWorker({
        method: 'POST',
        url: `/internal/v1/tasks/${taskId}/complete`,
        payload: {
          lease_token: leaseToken,
          result_schema_version: 1,
          result: {
            echoed: 'artifact test',
            worker_id: 'w',
            worker_runtime: 'python-3.12',
            processed_at: new Date().toISOString(),
          },
        },
      }),
    );

    await harness.pool.query(`UPDATE files SET expires_at = now() - interval '1 minute'`);
    expect((await sweepStaleArtifacts(harness.db, harness.storage)).deleted).toBe(0);
    expect(
      await harness.db
        .selectFrom('files')
        .selectAll()
        .where('id', '=', uploaded.json().file_id)
        .executeTakeFirst(),
    ).toBeDefined();
  });
});

describe('S3 driver placeholder', () => {
  it('throws rather than silently succeeding', async () => {
    const driver = new S3StorageDriver();
    await expect(driver.put()).rejects.toThrow(/not implemented/);
    await expect(driver.read()).rejects.toThrow(/milestone M6/);
    expect((await driver.healthCheck()).ok).toBe(false);
  });
});
