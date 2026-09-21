/**
 * 0003_matches: the M3 table obeys the same structural invariants as the rest
 * of the schema, and the database itself enforces the two rules a score must
 * never break.
 *
 * Those two rules are the reason this file exists rather than trusting the
 * application code:
 *
 *  * the revision tuple is unique, so re-scoring unchanged inputs cannot
 *    accumulate duplicate history;
 *  * a null score and a zero coverage are one statement ("nothing was
 *    evaluable") and may not disagree, so no code path can store a score of
 *    0 while claiming it evaluated nothing, or a score while claiming it
 *    evaluated nothing at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TriState } from '@job-getter/contracts';
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

function unionLiterals(schema: { anyOf: { const: unknown }[] }): string[] {
  return schema.anyOf.map((entry) => String(entry.const));
}

async function seedJob(): Promise<{ workspace: string; job: string }> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (normalized_email, email, password_hash) VALUES ($1, $1, 'x') RETURNING id`,
    [`m3-${randomUUID()}@job-getter.invalid`],
  );
  const workspace = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (owner_user_id, mode) VALUES ($1, 'local') RETURNING id`,
    [user.rows[0]!.id],
  );
  const workspaceId = workspace.rows[0]!.id;
  const job = await pool.query<{ id: string }>(
    `INSERT INTO jobs (
       workspace_id, canonical_key, company, title, description_text,
       content_hash, first_seen_at, last_seen_at
     ) VALUES ($1, $2, 'Orbital Foods', 'Senior Backend Engineer', 'text',
       repeat('a', 64), now(), now())
     RETURNING id`,
    [workspaceId, `key-${randomUUID()}`],
  );
  return { workspace: workspaceId, job: job.rows[0]!.id };
}

async function insertMatch(
  workspace: string,
  job: string,
  overrides: Partial<{
    job_revision: number;
    profile_revision: number;
    preferences_revision: number;
    algorithm_version: string;
    eligible: string;
    score: number | null;
    coverage_percent: number;
  }> = {},
): Promise<void> {
  const values = {
    job_revision: 1,
    profile_revision: 1,
    preferences_revision: 1,
    algorithm_version: 'v1',
    eligible: 'unknown',
    score: 72,
    coverage_percent: 90,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO matches (
       workspace_id, job_id, job_revision, profile_revision, preferences_revision,
       algorithm_version, eligible, score, coverage_percent, explanation, computed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, now())`,
    [
      workspace,
      job,
      values.job_revision,
      values.profile_revision,
      values.preferences_revision,
      values.algorithm_version,
      values.eligible,
      values.score,
      values.coverage_percent,
    ],
  );
}

describe('enum drift between 0003_matches.sql and @job-getter/contracts', () => {
  it('matches_eligible_check matches TriState exactly', async () => {
    const result = await pool.query<{ def: string }>(
      'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1',
      ['matches_eligible_check'],
    );
    const definition = result.rows[0]?.def ?? '';
    expect(definition).not.toBe('');
    const literals = [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
    expect(literals.sort()).toEqual(unionLiterals(TriState).sort());
  });
});

describe('structural invariants', () => {
  it('registers matches in WORKSPACE_SCOPED_TABLES', () => {
    expect(WORKSPACE_SCOPED_TABLES as readonly string[]).toContain('matches');
  });

  it('has a UNIQUE (workspace_id, id) target', async () => {
    const unique = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'matches' AND con.contype = 'u'`,
    );
    expect(unique.rows.some((row) => /UNIQUE \(workspace_id, id\)/.test(row.def))).toBe(true);
  });

  it('references the job compositely, so a match cannot cross workspaces', async () => {
    const rows = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE con.contype = 'f' AND rel.relname = 'matches'
         AND pg_get_constraintdef(con.oid) NOT LIKE '%REFERENCES workspaces(%'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.def).toMatch(/FOREIGN KEY \(workspace_id, job_id\) REFERENCES jobs/);
  });

  it('deletes matches with their job', async () => {
    const { workspace, job } = await seedJob();
    await insertMatch(workspace, job);
    await pool.query('DELETE FROM jobs WHERE id = $1', [job]);
    const remaining = await pool.query('SELECT 1 FROM matches WHERE job_id = $1', [job]);
    expect(remaining.rowCount).toBe(0);
  });
});

describe('the rules the database itself enforces', () => {
  it('rejects a second row for the same revision tuple', async () => {
    const { workspace, job } = await seedJob();
    await insertMatch(workspace, job);
    await expect(insertMatch(workspace, job)).rejects.toMatchObject({ code: '23505' });
  });

  it('accepts a new row once any input revision moves on', async () => {
    const { workspace, job } = await seedJob();
    await insertMatch(workspace, job, { profile_revision: 1 });
    await expect(insertMatch(workspace, job, { profile_revision: 2 })).resolves.toBeUndefined();
  });

  it('rejects a null score that claims it evaluated something', async () => {
    const { workspace, job } = await seedJob();
    await expect(
      insertMatch(workspace, job, { score: null, coverage_percent: 40 }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a score that claims it evaluated nothing', async () => {
    const { workspace, job } = await seedJob();
    await expect(
      insertMatch(workspace, job, { score: 0, coverage_percent: 0 }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts the honest "nothing was evaluable" row', async () => {
    const { workspace, job } = await seedJob();
    await expect(
      insertMatch(workspace, job, { score: null, coverage_percent: 0 }),
    ).resolves.toBeUndefined();
  });

  it('rejects a score outside 0-100', async () => {
    const { workspace, job } = await seedJob();
    await expect(insertMatch(workspace, job, { score: 101 })).rejects.toMatchObject({
      code: '23514',
    });
  });
});
