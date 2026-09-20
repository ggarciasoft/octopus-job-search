/**
 * AT01 (schema half) plus the structural invariants of 03_DATA_MODEL.md.
 *
 * These run against a real PostgreSQL container because composite foreign
 * keys, partial unique indexes and CHECK constraints are exactly the things a
 * mock cannot have.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_TASK_STATES, ALL_TASK_TYPES } from '@job-getter/contracts';
import { randomUUID } from 'node:crypto';
import {
  MigrationChecksumError,
  isSchemaCurrent,
  loadMigrations,
  migrationStatus,
  runMigrations,
} from '../../src/db/migrate.js';
import { OPERATOR_GLOBAL_TABLES, WORKSPACE_SCOPED_TABLES } from '../../src/db/types.js';
import { createPool } from '../../src/db/pool.js';
import { startTestDatabase, type TestDatabase } from '../helpers/postgres.js';

let database: TestDatabase;
let pool: ReturnType<typeof createPool>;

beforeAll(async () => {
  database = await startTestDatabase();
  pool = createPool({ connectionString: database.connectionString, max: 5 });
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

/** Pulls the quoted literals out of a `CHECK (col IN ('a','b'))` definition. */
function literalsIn(definition: string): string[] {
  return [...definition.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

describe('AT01 — migrations apply to an empty database', () => {
  it('reports every migration as pending before anything runs', async () => {
    const statuses = await migrationStatus(pool);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((status) => !status.applied)).toBe(true);
  });

  it('readiness cannot pass before migrations have run', async () => {
    const before = await isSchemaCurrent(pool);
    expect(before.current).toBe(false);
    expect(before.pending.length).toBeGreaterThan(0);
  });

  it('applies cleanly from empty', async () => {
    const result = await runMigrations(pool);
    expect(result.applied).toContain('0001_foundation');
    expect(result.skipped).toEqual([]);

    const after = await isSchemaCurrent(pool);
    expect(after.current).toBe(true);
    expect(after.pending).toEqual([]);
    expect(after.drifted).toEqual([]);
  });

  it('is idempotent on re-run', async () => {
    const result = await runMigrations(pool);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('0001_foundation');
  });

  it('records name, checksum and applied_at for each migration', async () => {
    const files = await loadMigrations();
    const rows = await pool.query<{ name: string; checksum: string; applied_at: Date }>(
      'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
    );
    expect(rows.rows.map((row) => row.name)).toEqual(files.map((file) => file.name));
    for (const row of rows.rows) {
      expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(row.applied_at).toBeInstanceOf(Date);
    }
  });

  it('refuses to continue when an applied migration has been edited', async () => {
    // Simulate an edited file by corrupting the recorded checksum.
    const original = await pool.query<{ checksum: string }>(
      `SELECT checksum FROM schema_migrations WHERE name = '0001_foundation'`,
    );
    await pool.query(`UPDATE schema_migrations SET checksum = $1 WHERE name = '0001_foundation'`, [
      '0'.repeat(64),
    ]);

    await expect(runMigrations(pool)).rejects.toBeInstanceOf(MigrationChecksumError);

    const status = await migrationStatus(pool);
    expect(status[0]?.checksumMatches).toBe(false);
    const drift = await isSchemaCurrent(pool);
    expect(drift.current).toBe(false);
    expect(drift.drifted).toContain('0001_foundation');

    await pool.query(`UPDATE schema_migrations SET checksum = $1 WHERE name = '0001_foundation'`, [
      original.rows[0]!.checksum,
    ]);
  });

  it('status reports each migration as applied with a matching checksum', async () => {
    const statuses = await migrationStatus(pool);
    expect(statuses.every((status) => status.applied && status.checksumMatches)).toBe(true);
  });
});

describe('enum drift between SQL and @job-getter/contracts', () => {
  it('tasks_type_check matches ALL_TASK_TYPES exactly', async () => {
    const definition = await constraintDefinition('tasks_type_check');
    expect(definition).not.toBe('');
    expect(literalsIn(definition).sort()).toEqual([...ALL_TASK_TYPES].sort());
  });

  it('tasks_state_check matches ALL_TASK_STATES exactly', async () => {
    const definition = await constraintDefinition('tasks_state_check');
    expect(definition).not.toBe('');
    expect(literalsIn(definition).sort()).toEqual([...ALL_TASK_STATES].sort());
  });

  it('rejects a task type the contract does not define', async () => {
    const workspace = await seedWorkspace();
    await expect(
      pool.query(
        `INSERT INTO tasks (workspace_id, type, capability) VALUES ($1, 'summon_demon', 'summon_demon')`,
        [workspace],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

async function seedWorkspace(): Promise<string> {
  const email = `drift-${randomUUID()}@job-getter.invalid`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (normalized_email, email, password_hash) VALUES ($1, $1, 'x') RETURNING id`,
    [email],
  );
  const workspace = await pool.query<{ id: string }>(
    `INSERT INTO workspaces (owner_user_id, mode) VALUES ($1, 'local') RETURNING id`,
    [user.rows[0]!.id],
  );
  return workspace.rows[0]!.id;
}

describe('structural invariants (03_DATA_MODEL.md)', () => {
  it('gives every workspace-scoped table a UNIQUE (workspace_id, id) target', async () => {
    const rows = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_name = c.relname AND col.column_name = 'workspace_id'
        )
        AND c.relname <> 'worker_registrations'
    `);
    expect(rows.rows.length).toBeGreaterThan(8);

    for (const { table_name: table } of rows.rows) {
      const unique = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE rel.relname = $1 AND con.contype = 'u'`,
        [table],
      );
      const hasCompositeTarget = unique.rows.some((row) =>
        /UNIQUE \(workspace_id, id\)/.test(row.def),
      );
      expect(hasCompositeTarget, `${table} needs UNIQUE (workspace_id, id)`).toBe(true);
    }
  });

  it('references between private tables are composite, not bare id references', async () => {
    const rows = await pool.query<{ conname: string; def: string }>(`
      SELECT con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE con.contype = 'f' AND rel.relname IN
        ('task_artifacts', 'profile_facts', 'profile_imports', 'usage_ledger')
        AND pg_get_constraintdef(con.oid) NOT LIKE '%REFERENCES workspaces(%'
    `);
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.def, `${row.conname} must be a composite reference`).toMatch(
        /FOREIGN KEY \(workspace_id, \w+\) REFERENCES \w+\(workspace_id, id\)/,
      );
    }
  });

  it('makes a cross-workspace reference impossible at the database level', async () => {
    const workspaceA = await seedWorkspace();
    const workspaceB = await seedWorkspace();

    const task = await pool.query<{ id: string }>(
      `INSERT INTO tasks (workspace_id, type, capability) VALUES ($1, 'noop_echo', 'noop_echo') RETURNING id`,
      [workspaceA],
    );
    const file = await pool.query<{ id: string }>(
      `INSERT INTO files (workspace_id, storage_key, original_name, mime, bytes, sha256, purpose)
       VALUES ($1, $2, 'cv.pdf', 'application/pdf', 10, $3, 'cv_original') RETURNING id`,
      [workspaceB, `${workspaceB}/${randomUUID()}`, 'a'.repeat(64)],
    );

    // Workspace A's task cannot reference workspace B's file, whatever the
    // application layer believes.
    await expect(
      pool.query(
        `INSERT INTO task_artifacts (workspace_id, task_id, file_id, lease_token_hash)
         VALUES ($1, $2, $3, 'hash')`,
        [workspaceA, task.rows[0]!.id, file.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('enforces one owner per workspace', async () => {
    const workspace = await seedWorkspace();
    const owner = await pool.query<{ id: string }>(
      `SELECT owner_user_id AS id FROM workspaces WHERE id = $1`,
      [workspace],
    );
    await pool.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspace, owner.rows[0]!.id],
    );

    const second = await pool.query<{ id: string }>(
      `INSERT INTO users (normalized_email, email, password_hash)
       VALUES ($1, $1, 'x') RETURNING id`,
      [`second-${randomUUID()}@job-getter.invalid`],
    );
    await expect(
      pool.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        workspace,
        second.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces the uniqueness constraints the contract depends on', async () => {
    const workspace = await seedWorkspace();

    // tasks (workspace_id, type, idempotency_key)
    await pool.query(
      `INSERT INTO tasks (workspace_id, type, capability, idempotency_key)
       VALUES ($1, 'noop_echo', 'noop_echo', 'key-1')`,
      [workspace],
    );
    await expect(
      pool.query(
        `INSERT INTO tasks (workspace_id, type, capability, idempotency_key)
         VALUES ($1, 'noop_echo', 'noop_echo', 'key-1')`,
        [workspace],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    // A NULL idempotency_key must NOT collapse unrelated tasks.
    await pool.query(
      `INSERT INTO tasks (workspace_id, type, capability) VALUES ($1, 'noop_echo', 'noop_echo')`,
      [workspace],
    );
    await pool.query(
      `INSERT INTO tasks (workspace_id, type, capability) VALUES ($1, 'noop_echo', 'noop_echo')`,
      [workspace],
    );

    // files.storage_key is globally unique.
    const key = `${workspace}/${randomUUID()}`;
    await pool.query(
      `INSERT INTO files (workspace_id, storage_key, original_name, mime, bytes, sha256, purpose)
       VALUES ($1, $2, 'a.pdf', 'application/pdf', 1, $3, 'cv_original')`,
      [workspace, key, 'b'.repeat(64)],
    );
    await expect(
      pool.query(
        `INSERT INTO files (workspace_id, storage_key, original_name, mime, bytes, sha256, purpose)
         VALUES ($1, $2, 'b.pdf', 'application/pdf', 1, $3, 'cv_original')`,
        [workspace, key, 'c'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('creates the indexes the specification names', async () => {
    const rows = await pool.query<{ indexdef: string; indexname: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const definitions = rows.rows.map((row) => row.indexdef.replace(/\s+/g, ' '));

    expect(definitions.some((def) => /tasks USING btree \(state, run_after\)/.test(def))).toBe(
      true,
    );
    expect(
      definitions.some((def) =>
        /tasks USING btree \(lease_expires_at\) WHERE \(state = 'leased'::text\)/.test(def),
      ),
    ).toBe(true);
    expect(
      definitions.some((def) =>
        /audit_events USING btree \(workspace_id, occurred_at DESC\)/.test(def),
      ),
    ).toBe(true);
  });

  it('stores every timestamp as timestamptz', async () => {
    const rows = await pool.query<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'
    `);
    expect(rows.rows.length).toBeGreaterThan(20);
    for (const row of rows.rows) {
      expect(row.data_type, `${row.table_name}.${row.column_name}`).toBe(
        'timestamp with time zone',
      );
    }
  });

  it('marks worker_registrations as operator-global, not private data', async () => {
    // It holds a worker id, declared capabilities and a last-seen timestamp:
    // operator infrastructure, nothing a user entered.
    const comment = await pool.query<{ comment: string | null }>(
      `SELECT obj_description('public.worker_registrations'::regclass, 'pg_class') AS comment`,
    );
    expect(comment.rows[0]?.comment ?? '').toContain('operator-global');
    expect(comment.rows[0]?.comment ?? '').toContain('excluded from workspace export and deletion');

    // The application-side classification must agree with the database's.
    expect(OPERATOR_GLOBAL_TABLES).toContain('worker_registrations');
    expect(WORKSPACE_SCOPED_TABLES as readonly string[]).not.toContain('worker_registrations');
  });

  it('keeps no table in both the scoped and operator-global lists', () => {
    const overlap = (WORKSPACE_SCOPED_TABLES as readonly string[]).filter((table) =>
      (OPERATOR_GLOBAL_TABLES as readonly string[]).includes(table),
    );
    expect(overlap).toEqual([]);
  });

  it('does not cascade worker_registrations when a workspace is deleted', async () => {
    const workspace = await seedWorkspace();
    await pool.query(
      `INSERT INTO worker_registrations (worker_id, workspace_id, kind, protocol_version)
       VALUES ('runner-under-test', $1, 'device', 1)`,
      [workspace],
    );

    await pool.query('DELETE FROM memberships WHERE workspace_id = $1', [workspace]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspace]);

    // The operator's record of a running process survives; only the workspace
    // association is dropped. Cascading it would destroy infrastructure state
    // in response to a user action.
    const row = await pool.query<{ workspace_id: string | null }>(
      `SELECT workspace_id FROM worker_registrations WHERE worker_id = 'runner-under-test'`,
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.workspace_id).toBeNull();

    await pool.query(`DELETE FROM worker_registrations WHERE worker_id = 'runner-under-test'`);
  });

  it('gives append-only audit_events no updated_at column', async () => {
    const rows = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'audit_events'`,
    );
    const columns = rows.rows.map((row) => row.column_name);
    expect(columns).toContain('occurred_at');
    expect(columns).not.toContain('updated_at');
  });
});
