/**
 * 0002_discovery: the M2 tables obey the same structural invariants as the
 * foundation schema, and every CHECK constraint matches its contract
 * enumeration. Compared literal-by-literal so a value added to a contract
 * union without a migration fails CI rather than a production INSERT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ALL_CONNECTOR_IDS,
  ALL_JOB_STATUSES,
  BOARD_CONNECTOR_IDS,
  JobEmploymentType,
  RemoteType,
  ScanStatus,
  SourceHealthState,
} from '@job-getter/contracts';
import { runMigrations } from '../../src/db/migrate.js';
import { WORKSPACE_SCOPED_TABLES } from '../../src/db/types.js';
import { JOB_IMPORT_STATUSES } from '../../src/discovery/imports.js';
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
  ]);
}, 180_000);

afterAll(async () => {
  await pool.end().catch(() => undefined);
  await database.stop();
});

async function constraintDefinition(name: string): Promise<string> {
  const result = await pool.query<{ def: string }>(
    'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1',
    [name],
  );
  return result.rows[0]?.def ?? '';
}

function literalsIn(definition: string): string[] {
  return [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

/** The literal values of a TypeBox union of literals. */
function unionLiterals(schema: { anyOf: { const: unknown }[] }): string[] {
  return schema.anyOf.map((entry) => String(entry.const));
}

async function seedWorkspace(): Promise<string> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (normalized_email, email, password_hash) VALUES ($1, $1, 'x') RETURNING id`,
    [`m2-${randomUUID()}@job-getter.invalid`],
  );
  const workspace = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (owner_user_id, mode) VALUES ($1, 'local') RETURNING id`,
    [user.rows[0]!.id],
  );
  return workspace.rows[0]!.id;
}

const M2_TABLES = ['sources', 'scans', 'jobs', 'job_sources', 'job_imports'] as const;

describe('enum drift between 0002_discovery.sql and @job-getter/contracts', () => {
  it.each([
    ['sources_connector_check', [...BOARD_CONNECTOR_IDS]],
    ['sources_health_state_check', unionLiterals(SourceHealthState)],
    ['scans_status_check', unionLiterals(ScanStatus)],
    ['jobs_status_check', [...ALL_JOB_STATUSES]],
    ['jobs_remote_type_check', unionLiterals(RemoteType)],
    ['jobs_employment_type_check', unionLiterals(JobEmploymentType)],
    ['job_sources_connector_check', [...ALL_CONNECTOR_IDS]],
    ['job_imports_status_check', [...JOB_IMPORT_STATUSES]],
  ])('%s matches the contract list exactly', async (constraint, expected) => {
    const definition = await constraintDefinition(constraint);
    expect(definition, constraint).not.toBe('');
    expect(literalsIn(definition).sort()).toEqual([...expected].sort());
  });

  it('rejects a connector the contract does not define', async () => {
    const workspace = await seedWorkspace();
    await expect(
      pool.query(
        `INSERT INTO sources (workspace_id, connector, connector_version, board_key)
         VALUES ($1, 'workday', '1', 'acme')`,
        [workspace],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('structural invariants of the M2 tables', () => {
  it('registers every M2 table in WORKSPACE_SCOPED_TABLES', () => {
    for (const table of M2_TABLES) {
      expect(WORKSPACE_SCOPED_TABLES as readonly string[]).toContain(table);
    }
  });

  it('gives every M2 table a UNIQUE (workspace_id, id) target', async () => {
    for (const table of M2_TABLES) {
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

  it('references between M2 private tables are composite', async () => {
    const rows = await pool.query<{ conname: string; def: string }>(
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE con.contype = 'f' AND rel.relname = ANY($1)
         AND pg_get_constraintdef(con.oid) NOT LIKE '%REFERENCES workspaces(%'`,
      [[...M2_TABLES]],
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(6);
    for (const row of rows.rows) {
      expect(row.def, row.conname).toMatch(
        /FOREIGN KEY \(workspace_id, \w+\) REFERENCES \w+\(workspace_id, id\)/,
      );
    }
  });

  it('enforces the uniqueness the dedup rules depend on', async () => {
    const workspace = await seedWorkspace();
    await pool.query(
      `INSERT INTO sources (workspace_id, connector, connector_version, board_key)
       VALUES ($1, 'greenhouse', '1', 'acme')`,
      [workspace],
    );
    // One board per connector per workspace.
    await expect(
      pool.query(
        `INSERT INTO sources (workspace_id, connector, connector_version, board_key)
         VALUES ($1, 'greenhouse', '1', 'acme')`,
        [workspace],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const hash = 'a'.repeat(64);
    await pool.query(
      `INSERT INTO jobs (workspace_id, canonical_key, company, title, description_text,
                         content_hash, first_seen_at, last_seen_at)
       VALUES ($1, 'greenhouse:acme:1', 'Acme', 'Eng', 'd', $2, now(), now())`,
      [workspace, hash],
    );
    // One canonical key per workspace.
    await expect(
      pool.query(
        `INSERT INTO jobs (workspace_id, canonical_key, company, title, description_text,
                           content_hash, first_seen_at, last_seen_at)
         VALUES ($1, 'greenhouse:acme:1', 'Acme', 'Eng', 'd', $2, now(), now())`,
        [workspace, hash],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows at most one in-flight scan per source', async () => {
    const workspace = await seedWorkspace();
    const source = await pool.query<{ id: string }>(
      `INSERT INTO sources (workspace_id, connector, connector_version, board_key)
       VALUES ($1, 'lever', '1', 'acme') RETURNING id`,
      [workspace],
    );
    await pool.query(
      `INSERT INTO scans (workspace_id, source_id, status) VALUES ($1, $2, 'queued')`,
      [workspace, source.rows[0]!.id],
    );
    await expect(
      pool.query(`INSERT INTO scans (workspace_id, source_id, status) VALUES ($1, $2, 'running')`, [
        workspace,
        source.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    // A finished scan does not occupy the slot.
    await pool.query(
      `INSERT INTO scans (workspace_id, source_id, status) VALUES ($1, $2, 'succeeded')`,
      [workspace, source.rows[0]!.id],
    );
  });

  it('creates the index the specification names for jobs', async () => {
    const rows = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'jobs'`,
    );
    const definitions = rows.rows.map((row) => row.indexdef.replace(/\s+/g, ' '));
    expect(
      definitions.some((def) =>
        /jobs USING btree \(workspace_id, status, last_seen_at DESC\)/.test(def),
      ),
    ).toBe(true);
  });

  it('keeps provenance and nulls its source pointer when a source is deleted', async () => {
    const workspace = await seedWorkspace();
    const source = await pool.query<{ id: string }>(
      `INSERT INTO sources (workspace_id, connector, connector_version, board_key)
       VALUES ($1, 'greenhouse', '1', 'keep-me') RETURNING id`,
      [workspace],
    );
    const job = await pool.query<{ id: string }>(
      `INSERT INTO jobs (workspace_id, canonical_key, company, title, description_text,
                         content_hash, first_seen_at, last_seen_at)
       VALUES ($1, 'greenhouse:keep-me:1', 'Acme', 'Eng', 'd', $2, now(), now()) RETURNING id`,
      [workspace, 'b'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO job_sources (workspace_id, job_id, source_id, connector, external_id,
                                source_key, canonical_url, retrieved_at)
       VALUES ($1, $2, $3, 'greenhouse', '1', 'greenhouse:keep-me:1', 'https://x/1', now())`,
      [workspace, job.rows[0]!.id, source.rows[0]!.id],
    );

    await pool.query(`DELETE FROM sources WHERE id = $1`, [source.rows[0]!.id]);

    const jobs = await pool.query(`SELECT id FROM jobs WHERE id = $1`, [job.rows[0]!.id]);
    expect(jobs.rows).toHaveLength(1);
    const provenance = await pool.query<{ source_id: string | null }>(
      `SELECT source_id FROM job_sources WHERE job_id = $1`,
      [job.rows[0]!.id],
    );
    expect(provenance.rows).toHaveLength(1);
    expect(provenance.rows[0]!.source_id).toBeNull();
  });
});
