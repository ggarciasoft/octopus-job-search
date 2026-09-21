/**
 * 0004_resumes: the structural invariants, and the two rules the database
 * refuses to let application code break.
 *
 * Both rules are about a user sending the wrong document to an employer:
 *
 *  * a row may not mix the modes -- an original CV carries the user's file and
 *    no generated document, a tailored one the reverse -- because a row that
 *    is both is a row where nobody can say what would actually be sent;
 *  * only a `ready` resume may be approved, so an approval always refers to
 *    something that exists and was readable at the moment it was approved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ALL_RESUME_MODES, ALL_RESUME_STATUSES } from '@job-getter/contracts';
import { runMigrations } from '../../src/db/migrate.js';
import { WORKSPACE_SCOPED_TABLES } from '../../src/db/types.js';
import { createPool } from '../../src/db/pool.js';
import { startTestDatabase, type TestDatabase } from '../helpers/postgres.js';

let database: TestDatabase;
let pool: ReturnType<typeof createPool>;

beforeAll(async () => {
  database = await startTestDatabase();
  pool = createPool({ connectionString: database.connectionString, max: 5 });
  const result = await runMigrations(pool);
  expect(result.applied).toEqual([
    '0001_foundation',
    '0002_discovery',
    '0003_matches',
    '0004_resumes',
    '0005_applications',
    '0006_devices',
    '0007_privacy',
    '0008_job_user_edits',
  ]);
}, 180_000);

afterAll(async () => {
  await pool.end().catch(() => undefined);
  await database.stop();
});

async function constraintLiterals(name: string): Promise<string[]> {
  const result = await pool.query<{ def: string }>(
    'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1',
    [name],
  );
  const definition = result.rows[0]?.def ?? '';
  expect(definition, name).not.toBe('');
  return [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

async function seedWorkspace(): Promise<{ workspace: string; file: string }> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (normalized_email, email, password_hash) VALUES ($1, $1, 'x') RETURNING id`,
    [`m3cv-${randomUUID()}@job-getter.invalid`],
  );
  const workspace = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (owner_user_id, mode) VALUES ($1, 'local') RETURNING id`,
    [user.rows[0]!.id],
  );
  const workspaceId = workspace.rows[0]!.id;
  const file = await pool.query<{ id: string }>(
    `INSERT INTO files (workspace_id, storage_key, original_name, mime, bytes, sha256, purpose, state)
     VALUES ($1, $2, 'cv.pdf', 'application/pdf', 10, repeat('b', 64), 'cv_original', 'ready')
     RETURNING id`,
    [workspaceId, `key-${randomUUID()}`],
  );
  return { workspace: workspaceId, file: file.rows[0]!.id };
}

function insertResume(
  workspace: string,
  overrides: Record<string, unknown> = {},
): Promise<unknown> {
  const values: Record<string, unknown> = {
    mode: 'tailored',
    status: 'queued',
    profile_revision: 1,
    language: 'en',
    document_json: null,
    input_file_id: null,
    approved_at: null,
    job_id: null,
    job_revision: null,
    ...overrides,
  };
  return pool.query(
    `INSERT INTO resumes (
       workspace_id, mode, status, profile_revision, language,
       document_json, input_file_id, approved_at, job_id, job_revision
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
    [
      workspace,
      values.mode,
      values.status,
      values.profile_revision,
      values.language,
      values.document_json === null ? null : JSON.stringify(values.document_json),
      values.input_file_id,
      values.approved_at,
      values.job_id,
      values.job_revision,
    ],
  );
}

describe('enum drift between 0004_resumes.sql and @job-getter/contracts', () => {
  it('resumes_mode_check matches ResumeMode exactly', async () => {
    expect((await constraintLiterals('resumes_mode_check')).sort()).toEqual(
      [...ALL_RESUME_MODES].sort(),
    );
  });

  it('resumes_status_check matches ResumeStatus exactly', async () => {
    expect((await constraintLiterals('resumes_status_check')).sort()).toEqual(
      [...ALL_RESUME_STATUSES].sort(),
    );
  });
});

describe('structural invariants', () => {
  it('registers resumes in WORKSPACE_SCOPED_TABLES', () => {
    expect(WORKSPACE_SCOPED_TABLES as readonly string[]).toContain('resumes');
  });

  it('has a UNIQUE (workspace_id, id) target', async () => {
    const unique = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'resumes' AND con.contype = 'u'`,
    );
    expect(unique.rows.some((row) => /UNIQUE \(workspace_id, id\)/.test(row.def))).toBe(true);
  });

  it('references every private table compositely', async () => {
    const rows = await pool.query<{ conname: string; def: string }>(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE con.contype = 'f' AND rel.relname = 'resumes'
         AND pg_get_constraintdef(con.oid) NOT LIKE '%REFERENCES workspaces(%'`,
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows.rows) {
      expect(row.def, row.conname).toMatch(/FOREIGN KEY \(workspace_id, \w+\)/);
    }
  });
});

describe('the rules the database itself enforces', () => {
  it('accepts a tailored resume with no input file', async () => {
    const { workspace } = await seedWorkspace();
    await expect(insertResume(workspace)).resolves.toBeDefined();
  });

  it('refuses a tailored resume that carries an uploaded file', async () => {
    const { workspace, file } = await seedWorkspace();
    await expect(
      insertResume(workspace, { mode: 'tailored', input_file_id: file }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a ready tailored resume with no document', async () => {
    const { workspace } = await seedWorkspace();
    await expect(
      insertResume(workspace, { mode: 'tailored', status: 'ready', document_json: null }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts an original resume that references the uploaded file', async () => {
    const { workspace, file } = await seedWorkspace();
    await expect(
      insertResume(workspace, { mode: 'original', status: 'ready', input_file_id: file }),
    ).resolves.toBeDefined();
  });

  it('refuses an original resume with no file to send', async () => {
    const { workspace } = await seedWorkspace();
    await expect(
      insertResume(workspace, { mode: 'original', input_file_id: null }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an original resume that also carries a generated document', async () => {
    const { workspace, file } = await seedWorkspace();
    await expect(
      insertResume(workspace, {
        mode: 'original',
        status: 'ready',
        input_file_id: file,
        document_json: { schema_version: 1 },
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses to approve a resume that is not ready', async () => {
    const { workspace } = await seedWorkspace();
    await expect(
      insertResume(workspace, { status: 'queued', approved_at: new Date() }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a job revision with no job', async () => {
    const { workspace } = await seedWorkspace();
    await expect(insertResume(workspace, { job_revision: 2 })).rejects.toMatchObject({
      code: '23514',
    });
  });
});
