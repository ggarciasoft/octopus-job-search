#!/usr/bin/env node
/**
 * SQL migration runner.
 *
 * Requirements from 00_AI_IMPLEMENTATION_INSTRUCTIONS.md and
 * 10_DEPLOYMENT.md:
 *
 *  * Repeatable from an empty database, and safe to re-run (it is invoked as a
 *    one-shot Compose service before the API becomes ready).
 *  * Self-contained in the compiled artifact. `tsc` copies no `.sql`, so the
 *    migrations are read from `migrations/bundled.ts` — a generated mirror of
 *    the `.sql` files that `tests/db/packaging.test.ts` proves is identical to
 *    them. Finding zero migrations is treated as a fatal error rather than a
 *    successful no-op.
 *  * Safe to run concurrently from several replicas: a PostgreSQL advisory
 *    lock serialises them, so the second instance waits and then finds nothing
 *    to do rather than racing.
 *  * `schema_migrations` records name + checksum + applied_at. If a migration
 *    that has already run is edited, the runner refuses to continue instead of
 *    leaving two installations with silently different schemas.
 *
 * Usage: `pnpm --filter @job-getter/api migrate [migrate|status]`
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type pg from 'pg';
import { createPool } from './pool.js';
import { BUNDLED_MIGRATIONS } from './migrations/bundled.js';

/**
 * Arbitrary but fixed 64-bit key. Every process that migrates this database
 * uses the same number, so they queue behind one another.
 */
const ADVISORY_LOCK_KEY = 7_395_140_022_119n;

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface MigrationStatus {
  readonly name: string;
  readonly applied: boolean;
  readonly appliedAt: Date | null;
  readonly checksumMatches: boolean;
}

/**
 * Raised when no migrations are available at all. This is the failure mode a
 * missing copy step produces, and it must never look like "nothing to do".
 */
export class EmptyMigrationSetError extends Error {
  constructor() {
    super(
      'No migrations are available. The compiled artifact should carry them in ' +
        'src/db/migrations/bundled.ts; regenerate it with ' +
        '`pnpm --filter @job-getter/api exec tsx src/db/bundle-migrations.ts`.',
    );
    this.name = 'EmptyMigrationSetError';
  }
}

export class MigrationChecksumError extends Error {
  constructor(name: string, expected: string, actual: string) {
    super(
      `Migration "${name}" has already been applied but its contents changed ` +
        `(recorded checksum ${expected.slice(0, 12)}…, file checksum ${actual.slice(0, 12)}…). ` +
        'Applied migrations are immutable: add a new numbered migration instead of editing this one.',
    );
    this.name = 'MigrationChecksumError';
  }
}

function checksum(sql: string): string {
  // Normalise line endings so a Windows checkout and a Linux container agree.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Resolves the migrations directory for both `tsx src/db/migrate.ts` and the
 * compiled `dist/db/migrate.js`. `tsc` does not copy .sql files, so the
 * compiled build falls back to the source tree.
 */
export function migrationsDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const adjacent = join(here, 'migrations');
  if (existsSync(adjacent)) return adjacent;
  const fromDist = resolve(here, '..', '..', 'src', 'db', 'migrations');
  if (existsSync(fromDist)) return fromDist;
  throw new Error(`Cannot locate the migrations directory (looked in ${adjacent} and ${fromDist}).`);
}

/**
 * Reads the authoritative `.sql` files. Used by the bundler and by the drift
 * test — never at runtime, because the source tree is absent from a container
 * image built to `dist/`.
 */
export async function loadMigrationsFromDisk(
  directory = migrationsDirectory(),
): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const files = entries.filter((entry) => entry.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const sql = await readFile(join(directory, file), 'utf8');
    migrations.push({ name: file.replace(/\.sql$/, ''), sql, checksum: checksum(sql) });
  }
  return migrations;
}

/**
 * The runtime migration set, read from the compiled-in bundle so that `tsx
 * src/...`, `node dist/...` and a container image all see exactly the same
 * migrations. Ordering is by name, which is why migrations are numbered.
 */
export async function loadMigrations(): Promise<MigrationFile[]> {
  const migrations = BUNDLED_MIGRATIONS.map((migration) => ({
    name: migration.name,
    sql: migration.sql,
    checksum: checksum(migration.sql),
  })).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  if (migrations.length === 0) throw new EmptyMigrationSetError();
  return migrations;
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

interface AppliedRow {
  name: string;
  checksum: string;
  applied_at: Date;
}

async function readApplied(client: pg.PoolClient): Promise<Map<string, AppliedRow>> {
  const result = await client.query<AppliedRow>(
    'SELECT name, checksum, applied_at FROM schema_migrations',
  );
  return new Map(result.rows.map((row) => [row.name, row]));
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Applies every pending migration inside the advisory lock. Each migration
 * runs in its own transaction, so a failure leaves earlier migrations applied
 * and recorded, and the failing one fully rolled back.
 */
export async function runMigrations(
  pool: pg.Pool,
  options: { log?: (message: string) => void } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined);
  const migrations = await loadMigrations();
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY.toString()]);
    await ensureMigrationsTable(client);
    const already = await readApplied(client);

    for (const migration of migrations) {
      const record = already.get(migration.name);
      if (record) {
        if (record.checksum !== migration.checksum) {
          throw new MigrationChecksumError(migration.name, record.checksum, migration.checksum);
        }
        skipped.push(migration.name);
        continue;
      }

      log(`applying ${migration.name}`);
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      applied.push(migration.name);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY.toString()]).catch(
      () => undefined,
    );
    client.release();
  }

  return { applied, skipped };
}

export async function migrationStatus(pool: pg.Pool): Promise<MigrationStatus[]> {
  const migrations = await loadMigrations();
  const client = await pool.connect();
  try {
    const tableExists = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
    );
    if (!tableExists.rows[0]?.exists) {
      return migrations.map((migration) => ({
        name: migration.name,
        applied: false,
        appliedAt: null,
        checksumMatches: false,
      }));
    }
    const already = await readApplied(client);
    return migrations.map((migration) => {
      const record = already.get(migration.name);
      return {
        name: migration.name,
        applied: record !== undefined,
        appliedAt: record?.applied_at ?? null,
        checksumMatches: record ? record.checksum === migration.checksum : false,
      };
    });
  } finally {
    client.release();
  }
}

/**
 * True when every migration on disk is applied with a matching checksum. The
 * readiness probe uses this: an API that is up but un-migrated must report
 * not-ready (10_DEPLOYMENT.md).
 */
export async function isSchemaCurrent(
  pool: pg.Pool,
): Promise<{ current: boolean; pending: string[]; drifted: string[] }> {
  const statuses = await migrationStatus(pool);
  const pending = statuses.filter((status) => !status.applied).map((status) => status.name);
  const drifted = statuses
    .filter((status) => status.applied && !status.checksumMatches)
    .map((status) => status.name);
  return { current: pending.length === 0 && drifted.length === 0, pending, drifted };
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'migrate';
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is required to run migrations.\n');
    process.exitCode = 1;
    return;
  }

  const pool = createPool({
    connectionString: databaseUrl,
    max: 2,
    applicationName: 'job-getter-migrate',
    // Creating extensions and indexes can legitimately take a while.
    statementTimeoutMs: 120_000,
  });

  try {
    if (command === 'status') {
      const statuses = await migrationStatus(pool);
      for (const status of statuses) {
        const state = !status.applied
          ? 'pending'
          : status.checksumMatches
            ? 'applied'
            : 'CHECKSUM MISMATCH';
        const when = status.appliedAt ? status.appliedAt.toISOString() : '-';
        process.stdout.write(`${status.name.padEnd(32)} ${state.padEnd(18)} ${when}\n`);
      }
      const pendingCount = statuses.filter((status) => !status.applied).length;
      const driftedCount = statuses.filter(
        (status) => status.applied && !status.checksumMatches,
      ).length;
      process.stdout.write(
        `\n${statuses.length} migration(s): ${statuses.length - pendingCount} applied, ` +
          `${pendingCount} pending, ${driftedCount} drifted\n`,
      );
      if (driftedCount > 0) process.exitCode = 1;
      return;
    }

    if (command !== 'migrate' && command !== 'up') {
      process.stderr.write(`Unknown command "${command}". Use "migrate" or "status".\n`);
      process.exitCode = 1;
      return;
    }

    const result = await runMigrations(pool, {
      log: (message) => process.stdout.write(`${message}\n`),
    });
    if (result.applied.length === 0) {
      process.stdout.write(`Schema is up to date (${result.skipped.length} migration(s)).\n`);
    } else {
      process.stdout.write(`Applied ${result.applied.length} migration(s).\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  void main();
}
