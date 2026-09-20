/**
 * Migrations — and the entrypoint — must survive compilation.
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
 * cannot pass against a stale `dist/`, and it uses the production tsconfig
 * rather than the typecheck one — asserting a property of a compilation nobody
 * deploys is how the `dist/server.js` break got in to begin with.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
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

/**
 * The *production* tsconfig, not the typecheck one.
 *
 * `tsconfig.json` keeps `rootDir: "."` so it can also cover `tests/`;
 * `tsconfig.build.json` sets `rootDir: "src"` and is what `pnpm build` and the
 * container image use.
 */
const BUILD_TSCONFIG = 'tsconfig.build.json';

interface BuiltMigrateModule {
  loadMigrations(): Promise<{ name: string; sql: string; checksum: string }[]>;
}

let built: BuiltMigrateModule;
/**
 * Resolved from the build output rather than assumed, so a `rootDir` change
 * fails loudly here instead of quietly testing nothing.
 */
let compiledMigratePath: string;
let compiledMigrationsDir: string;
let emittedFiles: string[];

/** Every file under `directory`, as `/`-separated paths relative to it. */
async function walk(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await walk(join(directory, entry.name), relativePath)));
    } else {
      found.push(relativePath);
    }
  }
  return found;
}

beforeAll(async () => {
  // A real compile with the production tsconfig. Declarations and source maps
  // are off purely for speed; they do not affect what is emitted.
  execFileSync(
    process.execPath,
    [
      join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      join(packageRoot, BUILD_TSCONFIG),
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

  emittedFiles = await walk(buildOutput);

  // Locate the compiled runner instead of hard-coding a layout. Exactly one
  // match is required: zero means the build dropped it, more than one means
  // the layout is ambiguous. Either way the test must fail rather than pick a
  // path and pass.
  const candidates = emittedFiles.filter((file) => file.endsWith('db/migrate.js'));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one compiled db/migrate.js under ${buildOutput}, found ` +
        `${candidates.length}: ${candidates.join(', ') || '(none)'}. ` +
        `Did ${BUILD_TSCONFIG} change its rootDir or include list?`,
    );
  }
  compiledMigratePath = join(buildOutput, candidates[0]!);
  compiledMigrationsDir = join(dirname(compiledMigratePath), 'migrations');

  built = (await import(pathToFileURL(compiledMigratePath).href)) as BuiltMigrateModule;
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
    const entries = await readdir(compiledMigrationsDir);

    // This is the whole point: there is no .sql here, and the runner still
    // resolves every migration.
    expect(entries.filter((entry) => entry.endsWith('.sql'))).toEqual([]);
    expect(entries).toContain('bundled.js');
    expect((await built.loadMigrations()).length).toBeGreaterThan(0);

    // Nowhere else in the image either. A copy step would reintroduce the
    // two-sources-of-truth problem the bundle exists to remove.
    expect(emittedFiles.filter((file) => file.endsWith('.sql'))).toEqual([]);
  });

  it('applies the built migrations to a real empty database', async () => {
    // Compiling correctly is not enough: the embedded SQL must still execute.
    const { startTestDatabase } = await import('../helpers/postgres.js');
    const { createPool } = await import('../../src/db/pool.js');
    const database = await startTestDatabase();
    const pool = createPool({ connectionString: database.connectionString, max: 2 });
    try {
      const module = (await import(pathToFileURL(compiledMigratePath).href)) as {
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

describe('built entrypoint', () => {
  it('emits the server at the path `pnpm start` invokes', async () => {
    // The break this guards: building with `tsconfig.json` (rootDir ".",
    // includes tests/) emits dist/src/server.js while package.json declares
    // `node dist/server.js`, so a container exits with MODULE_NOT_FOUND.
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    const startScript = manifest.scripts['start'] ?? '';
    const match = /node\s+(\S+)/.exec(startScript);
    expect(match, `could not read an entrypoint from start: "${startScript}"`).not.toBeNull();

    // `dist/server.js` -> `server.js`, relative to the output directory.
    const declared = relative('dist', match![1]!).split('\\').join('/');
    expect(emittedFiles, `package.json start runs ${match![1]}`).toContain(declared);
  });

  it('does not compile the test suite into the shipped artifact', () => {
    const testArtifacts = emittedFiles.filter(
      (file) => file.startsWith('tests/') || file.endsWith('.test.js'),
    );
    expect(testArtifacts).toEqual([]);
  });
});

describe('bundle drift', () => {
  it('is exactly what the generator would produce from the .sql files today', async () => {
    const fromDisk = await loadMigrationsFromDisk();
    const expected = renderBundle(fromDisk);
    const actual = await readFile(join(migrationsDirectory(), 'bundled.ts'), 'utf8');

    // If this fails, a .sql file was edited without regenerating the bundle —
    // or a formatter rewrote the generated file (see .prettierignore).
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
  it('is a fatal error, never a silent success', () => {
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
