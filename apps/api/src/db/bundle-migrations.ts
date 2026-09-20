#!/usr/bin/env node
/**
 * Regenerates `src/db/migrations/bundled.ts` from `src/db/migrations/*.sql`.
 *
 * Why a bundle exists at all: `tsc` compiles `.ts` and copies nothing else, so
 * a container image built from `dist/` contains no `.sql` files. A migration
 * runner that reads a directory would then find *zero* migrations, apply
 * nothing, and report success — which is exactly the "replaced missing
 * behaviour with something that reports success" failure the specification
 * forbids.
 *
 * A post-build copy step would also solve it, but it lives outside this
 * package's source and is easy to omit from a Dockerfile. Embedding the SQL in
 * a module makes the compiled artifact self-contained by construction: there
 * is no build step to forget.
 *
 * The `.sql` files remain the authoritative source — they are what a reviewer
 * reads and what `psql -f` can run. `tests/db/packaging.test.ts` asserts the
 * bundle is byte-identical to them, so a forgotten regeneration fails CI
 * rather than shipping a stale schema.
 *
 * Usage: pnpm --filter @job-getter/api exec tsx src/db/bundle-migrations.ts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMigrationsFromDisk, migrationsDirectory } from './migrate.js';

export const BUNDLE_FILENAME = 'bundled.ts';

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by \`src/db/bundle-migrations.ts\` from the \`.sql\` files beside it.
 * Regenerate with:
 *
 *   pnpm --filter @job-getter/api exec tsx src/db/bundle-migrations.ts
 *
 * The \`.sql\` files are the authoritative source; this module exists so the
 * compiled \`dist/\` artifact carries the migrations without a copy step.
 * \`tests/db/packaging.test.ts\` fails if the two ever disagree.
 */

export interface BundledMigration {
  readonly name: string;
  readonly sql: string;
}
`;

/** Emits the module text. Exported so the drift test can compare without I/O. */
export function renderBundle(migrations: readonly { name: string; sql: string }[]): string {
  const entries = migrations
    .map(
      (migration) =>
        `  {\n    name: ${JSON.stringify(migration.name)},\n` +
        // JSON.stringify rather than a template literal: SQL may legitimately
        // contain a backtick or `${`, and an escaped string cannot be broken
        // by its own content.
        `    sql: ${JSON.stringify(migration.sql)},\n  },`,
    )
    .join('\n');

  return `${HEADER}
export const BUNDLED_MIGRATIONS: readonly BundledMigration[] = [
${entries}
];
`;
}

export async function writeBundle(directory = migrationsDirectory()): Promise<string> {
  const migrations = await loadMigrationsFromDisk(directory);
  if (migrations.length === 0) {
    throw new Error(`No .sql migrations found in ${directory}; refusing to write an empty bundle.`);
  }
  const contents = renderBundle(migrations);
  await writeFile(join(directory, BUNDLE_FILENAME), contents, 'utf8');
  return contents;
}

async function main(): Promise<void> {
  const directory = migrationsDirectory();
  const contents = await writeBundle(directory);
  const count = (contents.match(/^ {4}name: /gm) ?? []).length;
  process.stdout.write(`Bundled ${count} migration(s) into ${join(directory, BUNDLE_FILENAME)}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('bundle-migrations.ts');

if (invokedDirectly) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
