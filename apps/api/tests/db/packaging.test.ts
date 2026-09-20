/**
 * Migrations must survive compilation.
 *
 * `tsc` compiles `.ts` and copies nothing else, so a container image built
 * from `dist/` contains no `.sql` files. A directory-reading migration runner
 * would then find zero migrations, apply nothing, and exit 0 — the API would
 * come up against an empty database and every request would fail with a
 * missing-relation error that looks like a product bug.
 *
 * These tests assert the property from the *built artifact*, not from the
 * source tree, because the source tree is exactly what is absent in a
 * container. The build is performed here rather than assumed, so the test
 * cannot pass against a stale `dist/`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  EmptyMigrationSetError,
  loadMigrations,
  loadMigrationsFromDisk,
  migrationsDirectory,
} from '../../src/db/migrate.js';
import { renderBundle } from '../../src/db/bundle-migrations.js';
import { BUNDLED_MIGRATIONS } from '../../src/db/migrations/bundled.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Inside `dist/`, which is already git-ignored. */
const buildOutput = join(packageRoot, 'dist', '.packaging-test');

interface BuiltMigrateModule {
  loadMigrations(): Promise<{ name: string; sql: string; checksum: string }[]>;
}

let built: BuiltMigrateModule;

beforeAll(async () => {
  // A real compile with the package's own tsconfig. Declarations and source
  // maps are off purely for speed; they do not affect what is emitted.
  execFileSync(
    process.execPath,
    [
      join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      join(packageRoot, 'tsconfig.json'),
      '--outDir',
      buildOutput,
      '--declaration',
      'false',
      '--declarationMap',
      'false',
      '--sourceMap',
      'false',
    ],
    { cwd: packageRoot, stdio: 'pipe' },
  );

  // `rootDir` is the package root, so `src/` keeps its place under the output.
  const compiled = join(buildOutput, 'src', 'db', 'migrate.js');
  built = (await import(pathToFileURL(compiled).href)) as BuiltMigrateModule;
}, 180_000);

afterAll(async () => {
  await rm(buildOutput, { recursive: true, force: true });
});

function sha256(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

describe('migration packaging', () => {
  it('resolves a non-empty migration set from the compiled artifact', async () => {
    const migrations = await built.loadMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((migration) => migration.name)).toContain('0001_foundation');
    for (const migration of migrations) {
      expect(migration.sql.length).toBeGreaterThan(100);
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('carries SQL identical to the source .sql files', async () => {
    const fromDisk = await loadMigrationsFromDisk();
    const fromBuild = await built.loadMigrations();

    expect(fromBuild.map((migration) => migration.name)).toEqual(
      fromDisk.map((migration) => migration.name),
    );
    for (const [index, migration] of fromBuild.entries()) {
      // Byte-for-byte, so a shipped image cannot create a different schema
      // from the one that was reviewed.
      expect(migration.checksum, migration.name).toBe(fromDisk[index]!.checksum);
      expect(sha256(migration.sql), migration.name).toBe(sha256(fromDisk[index]!.sql));
    }
  });

  it('needs no .sql file at runtime: the built tree has none', async () => {
    const { readdir } = await import('node:fs/promises');
    const compiledDbDir = join(buildOutput, 'src', 'db', 'migrations');
    const entries = await readdir(compiledDbDir);

    // This is the whole point: there is no .sql here, and the runner still
    // resolves every migration.
    expect(entries.filter((entry) => entry.endsWith('.sql'))).toEqual([]);
    expect(entries).toContain('bundled.js');
    expect((await built.loadMigrations()).length).toBeGreaterThan(0);
  });

  it('applies the built migrations to a real empty database', async () => {
    // Compiling correctly is not enough: the embedded SQL must still execute.
    const { startTestDatabase } = await import('../helpers/postgres.js');
    const { createPool } = await import('../../src/db/pool.js');
    const database = await startTestDatabase();
    const pool = createPool({ connectionString: database.connectionString, max: 2 });
    try {
      const compiled = join(buildOutput, 'src', 'db', 'migrate.js');
      const module = (await import(pathToFileURL(compiled).href)) as {
        runMigrations(pool: unknown): Promise<{ applied: string[] }>;
        isSchemaCurrent(pool: unknown): Promise<{ current: boolean }>;
      };

      const result = await module.runMigrations(pool);
      expect(result.applied).toContain('0001_foundation');
      expect((await module.isSchemaCurrent(pool)).current).toBe(true);

      // And the schema it produced is the real one.
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const names = tables.rows.map((row) => row.table_name);
      expect(names).toEqual(expect.arrayContaining(['users', 'workspaces', 'tasks', 'files']));
    } finally {
      await pool.end().catch(() => undefined);
      await database.stop();
    }
  }, 180_000);
});

describe('bundle drift', () => {
  it('is exactly what the generator would produce from the .sql files today', async () => {
    const fromDisk = await loadMigrationsFromDisk();
    const expected = renderBundle(fromDisk);
    const { readFile } = await import('node:fs/promises');
    const actual = await readFile(join(migrationsDirectory(), 'bundled.ts'), 'utf8');

    // If this fails, a .sql file was edited without regenerating the bundle.
    expect(
      actual.replace(/\r\n/g, '\n'),
      'src/db/migrations/bundled.ts is stale. Run:\n' +
        '  pnpm --filter @job-getter/api exec tsx src/db/bundle-migrations.ts',
    ).toBe(expected.replace(/\r\n/g, '\n'));
  });

  it('covers every .sql file on disk, with no extras', async () => {
    const fromDisk = await loadMigrationsFromDisk();
    expect(BUNDLED_MIGRATIONS.map((migration) => migration.name).sort()).toEqual(
      fromDisk.map((migration) => migration.name).sort(),
    );
  });
});

describe('empty migration set', () => {
  it('is a fatal error, never a silent success', async () => {
    // The failure mode a missing copy step produces. It must not look like
    // "schema is up to date".
    const error = new EmptyMigrationSetError();
    expect(error.message).toContain('No migrations are available');
    expect(error.message).toContain('bundle-migrations');
  });

  it('never reports success from an empty runtime set', async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
  });
});
