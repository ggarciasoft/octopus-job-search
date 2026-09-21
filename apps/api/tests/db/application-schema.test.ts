/**
 * 0005_applications: the structural invariants, the enum literals, and the
 * rules the database refuses to let application code break.
 *
 * Every rule here is about a user sending an employer something they never
 * agreed to send:
 *
 *  * an approval may only ever name this packet's own content hash, so
 *    "approved" can never point at content nobody read;
 *  * an approval is when, what and until when — all three or none — so no
 *    half-written approval sits around with no clock on it;
 *  * a submission timestamp and its evidence exist only on an application that
 *    actually reached submission;
 *  * the event log cannot be edited, only appended to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ALL_ANSWER_SCOPES,
  ALL_ANSWER_SENSITIVITIES,
  ALL_APPLICATION_ACTORS,
  ALL_APPLICATION_EVENT_TYPES,
  ALL_APPLICATION_STATUSES,
} from '@job-getter/contracts';
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

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

interface Seed {
  workspace: string;
  job: string;
  resume: string;
  application: string;
}

async function seed(): Promise<Seed> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (normalized_email, email, password_hash) VALUES ($1, $1, 'x') RETURNING id`,
    [`m4-${randomUUID()}@job-getter.invalid`],
  );
  const workspace = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (owner_user_id, mode) VALUES ($1, 'local') RETURNING id`,
    [user.rows[0]!.id],
  );
  const workspaceId = workspace.rows[0]!.id;

  const job = await pool.query<{ id: string }>(
    `INSERT INTO jobs (workspace_id, canonical_key, company, title, description_text,
                       content_hash, first_seen_at, last_seen_at)
     VALUES ($1, $2, 'Acme', 'Engineer', 'Build things.', repeat('c', 64), now(), now())
     RETURNING id`,
    [workspaceId, `greenhouse:acme:${randomUUID()}`],
  );
  const file = await pool.query<{ id: string }>(
    `INSERT INTO files (workspace_id, storage_key, original_name, mime, bytes, sha256, purpose, state)
     VALUES ($1, $2, 'cv.pdf', 'application/pdf', 10, repeat('d', 64), 'cv_original', 'ready')
     RETURNING id`,
    [workspaceId, `key-${randomUUID()}`],
  );
  const resume = await pool.query<{ id: string }>(
    `INSERT INTO resumes (workspace_id, mode, status, profile_revision, language, input_file_id)
     VALUES ($1, 'original', 'ready', 1, 'en', $2) RETURNING id`,
    [workspaceId, file.rows[0]!.id],
  );
  const application = await pool.query<{ id: string }>(
    `INSERT INTO applications (workspace_id, job_id) VALUES ($1, $2) RETURNING id`,
    [workspaceId, job.rows[0]!.id],
  );

  return {
    workspace: workspaceId,
    job: job.rows[0]!.id,
    resume: resume.rows[0]!.id,
    application: application.rows[0]!.id,
  };
}

function insertPacket(s: Seed, overrides: Record<string, unknown> = {}): Promise<unknown> {
  const values: Record<string, unknown> = {
    revision: 1,
    content_hash: HASH_A,
    approved_hash: null,
    approved_at: null,
    expires_at: null,
    ...overrides,
  };
  return pool.query(
    `INSERT INTO application_packets (
       workspace_id, application_id, revision, profile_revision, job_revision,
       resume_id, destination_url, destination_origin, content_hash,
       approved_hash, approved_at, expires_at
     ) VALUES ($1, $2, $3, 1, 1, $4, 'https://boards.example.invalid/apply',
               'https://boards.example.invalid', $5, $6, $7, $8)`,
    [
      s.workspace,
      s.application,
      values.revision,
      s.resume,
      values.content_hash,
      values.approved_hash,
      values.approved_at,
      values.expires_at,
    ],
  );
}

describe('enum drift between 0005_applications.sql and @job-getter/contracts', () => {
  it('applications_status_check matches ApplicationStatus exactly', async () => {
    expect((await constraintLiterals('applications_status_check')).sort()).toEqual(
      [...ALL_APPLICATION_STATUSES].sort(),
    );
  });

  it('application_events_type_check matches ApplicationEventType exactly', async () => {
    expect((await constraintLiterals('application_events_type_check')).sort()).toEqual(
      [...ALL_APPLICATION_EVENT_TYPES].sort(),
    );
  });

  it('application_events_actor_check matches ApplicationActor exactly', async () => {
    expect((await constraintLiterals('application_events_actor_check')).sort()).toEqual(
      [...ALL_APPLICATION_ACTORS].sort(),
    );
  });

  it('answer_bank_scope_check matches AnswerScope exactly', async () => {
    expect((await constraintLiterals('answer_bank_scope_check')).sort()).toEqual(
      [...ALL_ANSWER_SCOPES].sort(),
    );
  });

  it('answer_bank_sensitivity_check matches AnswerSensitivity exactly', async () => {
    expect((await constraintLiterals('answer_bank_sensitivity_check')).sort()).toEqual(
      [...ALL_ANSWER_SENSITIVITIES].sort(),
    );
  });

  it('both event status columns accept the full status vocabulary', async () => {
    for (const name of [
      'application_events_status_before_check',
      'application_events_status_after_check',
    ]) {
      expect((await constraintLiterals(name)).sort(), name).toEqual(
        [...ALL_APPLICATION_STATUSES].sort(),
      );
    }
  });
});

describe('structural invariants', () => {
  const tables = ['answer_bank', 'applications', 'application_packets', 'application_events'];

  it('registers every new table in WORKSPACE_SCOPED_TABLES', () => {
    for (const table of tables) {
      expect(WORKSPACE_SCOPED_TABLES as readonly string[], table).toContain(table);
    }
  });

  it('gives every new table a UNIQUE (workspace_id, id) target', async () => {
    for (const table of tables) {
      const unique = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE rel.relname = $1 AND con.contype = 'u'`,
        [table],
      );
      expect(
        unique.rows.some((row) => /UNIQUE \(workspace_id, id\)/.test(row.def)),
        table,
      ).toBe(true);
    }
  });

  it('references every private table compositely', async () => {
    const rows = await pool.query<{ conname: string; def: string }>(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE con.contype = 'f' AND rel.relname = ANY($1)
         AND pg_get_constraintdef(con.oid) NOT LIKE '%REFERENCES workspaces(%'`,
      [tables],
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows.rows) {
      expect(row.def, row.conname).toMatch(/FOREIGN KEY \(workspace_id, \w+\)/);
    }
  });

  it('keeps one application per job so two creates cannot become two rows', async () => {
    const s = await seed();
    await expect(
      pool.query(`INSERT INTO applications (workspace_id, job_id) VALUES ($1, $2)`, [
        s.workspace,
        s.job,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps one packet per application revision', async () => {
    const s = await seed();
    await insertPacket(s);
    await expect(insertPacket(s)).rejects.toMatchObject({ code: '23505' });
  });
});

describe('the approval rules the database enforces', () => {
  it('accepts an unapproved packet', async () => {
    const s = await seed();
    await expect(insertPacket(s)).resolves.toBeDefined();
  });

  it('accepts an approval of this packet own content', async () => {
    const s = await seed();
    const approvedAt = new Date();
    await expect(
      insertPacket(s, {
        approved_hash: HASH_A,
        approved_at: approvedAt,
        expires_at: new Date(approvedAt.getTime() + 3_600_000),
      }),
    ).resolves.toBeDefined();
  });

  it('refuses an approval of content this packet does not contain', async () => {
    const s = await seed();
    const approvedAt = new Date();
    await expect(
      insertPacket(s, {
        approved_hash: HASH_B,
        approved_at: approvedAt,
        expires_at: new Date(approvedAt.getTime() + 3_600_000),
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an approval with no expiry', async () => {
    const s = await seed();
    await expect(
      insertPacket(s, { approved_hash: HASH_A, approved_at: new Date(), expires_at: null }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an expiry that precedes the approval', async () => {
    const s = await seed();
    const approvedAt = new Date();
    await expect(
      insertPacket(s, {
        approved_hash: HASH_A,
        approved_at: approvedAt,
        expires_at: new Date(approvedAt.getTime() - 1000),
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a content hash that is not a SHA-256 digest', async () => {
    const s = await seed();
    await expect(insertPacket(s, { content_hash: 'not-a-hash' })).rejects.toMatchObject({
      code: '23514',
    });
  });
});

describe('the submission rules the database enforces', () => {
  it('refuses a submitted application with no submission time', async () => {
    const s = await seed();
    await expect(
      pool.query(`UPDATE applications SET status = 'submitted' WHERE id = $1`, [s.application]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a submission time on an application that never got there', async () => {
    const s = await seed();
    await expect(
      pool.query(`UPDATE applications SET submitted_at = now() WHERE id = $1`, [s.application]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses evidence on an application that never got there', async () => {
    const s = await seed();
    await expect(
      pool.query(
        `UPDATE applications SET submission_evidence = '{"evidence_type":"user_report"}'::jsonb
         WHERE id = $1`,
        [s.application],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('the answer bank rules the database enforces', () => {
  function insertAnswer(s: Seed, overrides: Record<string, unknown> = {}): Promise<unknown> {
    const values = { question_key: 'notice_period', scope: 'general', scope_id: '', ...overrides };
    return pool.query(
      `INSERT INTO answer_bank (workspace_id, question_key, answer, scope, scope_id)
       VALUES ($1, $2, '"30 days"'::jsonb, $3, $4)`,
      [s.workspace, values.question_key, values.scope, values.scope_id],
    );
  }

  it('keeps one answer per question, scope and scope id', async () => {
    const s = await seed();
    await insertAnswer(s);
    await expect(insertAnswer(s)).rejects.toMatchObject({ code: '23505' });
  });

  it('allows the same question at two different scopes', async () => {
    const s = await seed();
    await insertAnswer(s);
    await expect(insertAnswer(s, { scope: 'company', scope_id: 'acme' })).resolves.toBeDefined();
  });

  it('refuses a general answer that carries a scope id', async () => {
    const s = await seed();
    await expect(insertAnswer(s, { scope_id: 'acme' })).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a company answer with nothing to scope it to', async () => {
    const s = await seed();
    await expect(insertAnswer(s, { scope: 'company' })).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a question key that is not a stable identifier', async () => {
    const s = await seed();
    await expect(insertAnswer(s, { question_key: 'Notice Period?' })).rejects.toMatchObject({
      code: '23514',
    });
  });
});

describe('the event log', () => {
  async function insertEvent(s: Seed, sequence: number): Promise<void> {
    await pool.query(
      `INSERT INTO application_events (workspace_id, application_id, sequence, type, actor)
       VALUES ($1, $2, $3, 'created', 'user')`,
      [s.workspace, s.application, sequence],
    );
  }

  it('refuses two events at the same sequence', async () => {
    const s = await seed();
    await insertEvent(s, 1);
    await expect(insertEvent(s, 1)).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses an update, so history cannot be rewritten', async () => {
    const s = await seed();
    await insertEvent(s, 1);
    await expect(
      pool.query(`UPDATE application_events SET reason = 'rewritten' WHERE application_id = $1`, [
        s.application,
      ]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('still allows deletion, which privacy erasure and the cascade need', async () => {
    const s = await seed();
    await insertEvent(s, 1);
    await expect(
      pool.query('DELETE FROM application_events WHERE application_id = $1', [s.application]),
    ).resolves.toBeDefined();
  });
});
