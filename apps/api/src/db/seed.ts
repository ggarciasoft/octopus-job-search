#!/usr/bin/env node
/**
 * Idempotent synthetic seed fixtures.
 *
 * 00_AI_IMPLEMENTATION_INSTRUCTIONS.md: "no personal data in CI fixtures" and
 * 12_IMPLEMENTATION_PLAN.md: "Do not seed the owner's real work history from
 * chat memory". Everything here is obviously fake and uses the reserved
 * `.invalid` TLD (RFC 2606) so a seeded address can never reach a real inbox.
 *
 * Running it twice produces the same state as running it once, so it is safe
 * for `scripts/` to call on every local start.
 */
import { DEFAULT_PREFERENCES } from '@job-getter/contracts';
import type { Db } from './pool.js';
import { createDb, createPool } from './pool.js';
import { hashPassword, normalizeEmail } from '../auth/password.js';
import { SETUP_COMPLETED_FLAG } from '../routes/setup.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const SEED_EMAIL = 'owner@job-getter.invalid';
export const SEED_PASSWORD = 'seed-password-not-secret-1234';

export interface SeedResult {
  readonly userId: string;
  readonly workspaceId: string;
  readonly created: boolean;
}

/**
 * Creates (or finds) a synthetic owner, workspace, membership, empty profile
 * and default preferences.
 *
 * It also sets the `setup_completed` flag, because a seeded installation has
 * an owner: leaving one-time setup open on a database that already has one
 * would contradict the bootstrap invariant.
 */
export async function seedWorkspace(
  db: Db,
  options: { email?: string; password?: string } = {},
): Promise<SeedResult> {
  const email = options.email ?? SEED_EMAIL;
  const normalized = normalizeEmail(email);

  const existing = await db
    .selectFrom('users')
    .innerJoin('memberships', 'memberships.user_id', 'users.id')
    .select(['users.id as user_id', 'memberships.workspace_id'])
    .where('users.normalized_email', '=', normalized)
    .executeTakeFirst();

  if (existing) {
    return { userId: existing.user_id, workspaceId: existing.workspace_id, created: false };
  }

  const passwordHash = await hashPassword(options.password ?? SEED_PASSWORD);

  return db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({
        normalized_email: normalized,
        email,
        password_hash: passwordHash,
        verified_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const workspace = await trx
      .insertInto('workspaces')
      .values({ owner_user_id: user.id, mode: 'local', locale: 'en' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await trx
      .insertInto('memberships')
      .values({ workspace_id: workspace.id, user_id: user.id, role: 'owner' })
      .execute();

    await trx
      .insertInto('profiles')
      .values({ workspace_id: workspace.id, revision: 1, contact: null, locale: 'en' })
      .execute();

    await trx
      .insertInto('preferences')
      .values({
        workspace_id: workspace.id,
        revision: 1,
        config: JSON.stringify(DEFAULT_PREFERENCES),
      })
      .execute();

    await trx
      .insertInto('system_flags')
      .values({
        key: SETUP_COMPLETED_FLAG,
        value: JSON.stringify({ completed_at: new Date().toISOString(), source: 'seed' }),
      })
      .onConflict((builder) => builder.column('key').doNothing())
      .execute();

    await trx
      .insertInto('audit_events')
      .values({
        workspace_id: workspace.id,
        actor_id: user.id,
        action: 'workspace.seeded',
        object_id: workspace.id,
        object_type: 'workspace',
        metadata: JSON.stringify({ synthetic: true }),
      })
      .execute();

    return { userId: user.id, workspaceId: workspace.id, created: true };
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is required to seed.\n');
    process.exitCode = 1;
    return;
  }
  const pool = createPool({
    connectionString: databaseUrl,
    max: 2,
    applicationName: 'job-getter-seed',
  });
  const db = createDb(pool);
  try {
    const result = await seedWorkspace(db);
    process.stdout.write(
      `${result.created ? 'Seeded' : 'Already present'}: workspace ${result.workspaceId}\n` +
        `Synthetic owner: ${SEED_EMAIL}\n`,
    );
  } finally {
    await db.destroy().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  void main();
}
