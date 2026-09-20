/**
 * The seed fixtures must be idempotent and synthetic: `scripts/` runs them on
 * every local start, and CI must never contain real personal data
 * (00_AI_IMPLEMENTATION_INSTRUCTIONS.md).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_EMAIL, seedWorkspace } from '../../src/db/seed.js';
import { SETUP_COMPLETED_FLAG } from '../../src/routes/setup.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
}, 180_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('seed fixtures', () => {
  it('creates a complete synthetic workspace', async () => {
    const result = await seedWorkspace(harness.db);
    expect(result.created).toBe(true);

    const user = await harness.db.selectFrom('users').selectAll().executeTakeFirstOrThrow();
    // RFC 2606 reserved TLD: this address can never reach a real inbox.
    expect(user.normalized_email).toBe(SEED_EMAIL);
    expect(user.normalized_email.endsWith('.invalid')).toBe(true);
    expect(user.password_hash).toMatch(/^\$argon2id\$/);

    const membership = await harness.db
      .selectFrom('memberships')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(membership.role).toBe('owner');
    expect(membership.workspace_id).toBe(result.workspaceId);

    const profile = await harness.db.selectFrom('profiles').selectAll().executeTakeFirstOrThrow();
    // No invented work history (12_IMPLEMENTATION_PLAN.md).
    expect(profile.contact).toBeNull();
    expect(await harness.db.selectFrom('profile_facts').selectAll().execute()).toEqual([]);

    const preferences = await harness.db
      .selectFrom('preferences')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(preferences.revision).toBe(1);
  });

  it('closes one-time setup, because a seeded install already has an owner', async () => {
    await seedWorkspace(harness.db);
    const flag = await harness.db
      .selectFrom('system_flags')
      .selectAll()
      .where('key', '=', SETUP_COMPLETED_FLAG)
      .executeTakeFirst();
    expect(flag).toBeDefined();

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(response.json().setup_required).toBe(false);
  });

  it('is idempotent: running it twice changes nothing', async () => {
    const first = await seedWorkspace(harness.db);
    const second = await seedWorkspace(harness.db);

    expect(second.created).toBe(false);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(second.userId).toBe(first.userId);

    expect(await harness.db.selectFrom('users').selectAll().execute()).toHaveLength(1);
    expect(await harness.db.selectFrom('workspaces').selectAll().execute()).toHaveLength(1);
    expect(await harness.db.selectFrom('memberships').selectAll().execute()).toHaveLength(1);
    expect(await harness.db.selectFrom('profiles').selectAll().execute()).toHaveLength(1);
    expect(await harness.db.selectFrom('preferences').selectAll().execute()).toHaveLength(1);
  });
});
