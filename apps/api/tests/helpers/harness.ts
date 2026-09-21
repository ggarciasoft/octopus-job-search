/**
 * Builds the *real* application against an ephemeral database.
 *
 * Nothing here is a stand-in: the same `buildApp`, the same migrations, the
 * same local storage driver and the same route registration that production
 * uses. Tests drive it with `app.inject`, so the only thing not exercised is
 * the TCP listener itself.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type pg from 'pg';
import { DEVICE_TOKEN_HEADER } from '@job-getter/contracts';
import { buildApp, type RegisteredRoute } from '../../src/app.js';
import { loadConfig, type Config, type RawEnv } from '../../src/config.js';
import { closeDb, createDb, createPool, type Db } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';
import { LocalStorageDriver, type StorageDriver } from '../../src/files/storage.js';
import { createLogger } from '../../src/logging.js';
import { startTestDatabase, type TestDatabase } from './postgres.js';

export const TEST_ORIGIN = 'http://localhost:3000';
export const TEST_SETUP_TOKEN = 'setup-token-for-tests-0123456789';
export const TEST_WORKER_TOKEN = 'worker-auth-token-for-tests-0123456789abcd';
export const TEST_OWNER_EMAIL = 'owner@job-getter.invalid';
export const TEST_OWNER_PASSWORD = 'correct horse battery staple';

/** A deterministic 32-byte base64 key; synthetic, never a real secret. */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

export function testEnv(overrides: RawEnv = {}): RawEnv {
  return {
    APP_MODE: 'local',
    APP_ORIGIN: TEST_ORIGIN,
    PORT: '3001',
    DATABASE_URL: 'postgres://unused',
    SESSION_SECRET: 'test-session-secret-at-least-32-chars-long',
    SETUP_TOKEN: TEST_SETUP_TOKEN,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    WORKER_AUTH_TOKEN: TEST_WORKER_TOKEN,
    STORAGE_DRIVER: 'local',
    FILES_ROOT: './data/files',
    PROVIDER_DEFAULT: 'none',
    LOG_LEVEL: 'silent',
    BILLING_ENABLED: 'false',
    ...overrides,
  };
}

export interface Harness {
  readonly app: FastifyInstance;
  readonly config: Config;
  readonly db: Db;
  readonly pool: pg.Pool;
  readonly storage: StorageDriver;
  readonly filesRoot: string;
  readonly routes: readonly RegisteredRoute[];
  readonly database: TestDatabase;
  /** Applies all migrations. Safe to call more than once. */
  migrate(): Promise<void>;
  /** Empties every domain table, leaving the schema in place. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Skip migrations so a test can observe the un-migrated state (AT01). */
  readonly migrate?: boolean;
  readonly env?: RawEnv;
  readonly rateLimitEnabled?: boolean;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const database = await startTestDatabase();
  const filesRoot = await mkdtemp(join(tmpdir(), 'job-getter-files-'));

  const config = loadConfig(
    testEnv({
      DATABASE_URL: database.connectionString,
      FILES_ROOT: filesRoot,
      ...options.env,
    }),
  );

  const pool = createPool({ connectionString: config.databaseUrl, max: 20 });
  const db = createDb(pool);
  const storage = new LocalStorageDriver(filesRoot);
  const logger = createLogger({ level: 'silent' });

  const migrate = async () => {
    await runMigrations(pool);
  };
  if (options.migrate !== false) await migrate();

  const built = await buildApp(config, {
    pool,
    db,
    storage,
    logger,
    rateLimitEnabled: options.rateLimitEnabled ?? false,
  });

  return {
    app: built.app,
    config,
    db,
    pool,
    storage,
    filesRoot,
    routes: built.routes,
    database,
    migrate,
    async reset() {
      // TRUNCATE ... CASCADE keeps the schema but clears every row, including
      // system_flags, so each test starts from a genuinely empty install.
      await pool.query(`
        TRUNCATE TABLE
          audit_events, task_artifacts, idempotency_records, tasks, files,
          usage_ledger, provider_settings, profile_imports, preferences,
          profile_facts, profiles, sessions, memberships, workspaces, users,
          worker_registrations, system_flags
        RESTART IDENTITY CASCADE
      `);
    },
    async close() {
      await built.app.close();
      await closeDb(db, pool);
      await rm(filesRoot, { recursive: true, force: true });
      await database.stop();
    },
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

export interface Session {
  readonly cookie: string;
  readonly csrfToken: string;
  readonly workspaceId: string;
  readonly userId: string;
}

function parseSetCookie(raw: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const cookies: Record<string, string> = {};
  for (const value of values) {
    const [pair] = value.split(';');
    if (!pair) continue;
    const index = pair.indexOf('=');
    if (index === -1) continue;
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

/** Completes one-time setup and returns the resulting authenticated session. */
export async function completeSetup(
  harness: Harness,
  overrides: { email?: string; password?: string; token?: string } = {},
): Promise<Session> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/setup',
    headers: { origin: TEST_ORIGIN },
    payload: {
      setup_token: overrides.token ?? TEST_SETUP_TOKEN,
      email: overrides.email ?? TEST_OWNER_EMAIL,
      password: overrides.password ?? TEST_OWNER_PASSWORD,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`setup failed: ${response.statusCode} ${response.body}`);
  }
  const cookies = parseSetCookie(response.headers['set-cookie']);
  const body = response.json() as { user: { id: string }; workspace: { id: string } };
  const session = cookies['jg_session'];
  const csrf = cookies['jg_csrf'];
  if (!session || !csrf) throw new Error('setup did not return session cookies');
  return {
    cookie: `jg_session=${session}; jg_csrf=${csrf}`,
    csrfToken: csrf,
    workspaceId: body.workspace.id,
    userId: body.user.id,
  };
}

/**
 * Creates a second, fully independent workspace directly in the database.
 *
 * One-time setup deliberately closes forever, so the isolation tests (AT19)
 * cannot create their second workspace through the API. Inserting it here is
 * the honest alternative: it produces exactly the rows a hosted second tenant
 * would have.
 */
export async function createSecondWorkspace(harness: Harness): Promise<Session> {
  const { hashPassword } = await import('../../src/auth/password.js');
  const { createSession } = await import('../../src/auth/sessions.js');

  const passwordHash = await hashPassword('another workspace password 123');
  const created = await harness.db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({
        normalized_email: `other-${randomUUID()}@job-getter.invalid`,
        email: 'other@job-getter.invalid',
        password_hash: passwordHash,
        verified_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const workspace = await trx
      .insertInto('workspaces')
      .values({ owner_user_id: user.id, mode: 'local' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('memberships')
      .values({ workspace_id: workspace.id, user_id: user.id, role: 'owner' })
      .execute();
    const session = await createSession(trx, harness.config, {
      userId: user.id,
      workspaceId: workspace.id,
    });
    return { user, workspace, session };
  });

  return {
    cookie: `jg_session=${created.session.token}; jg_csrf=${created.session.csrfToken}`,
    csrfToken: created.session.csrfToken,
    workspaceId: created.workspace.id,
    userId: created.user.id,
  };
}

export interface AuthedInject extends Omit<InjectOptions, 'headers'> {
  readonly headers?: Record<string, string>;
}

/** Injects a request carrying the session cookie, origin and CSRF token. */
export function authed(session: Session, options: AuthedInject): InjectOptions {
  return {
    ...options,
    headers: {
      origin: TEST_ORIGIN,
      cookie: session.cookie,
      'x-csrf-token': session.csrfToken,
      ...options.headers,
    },
  } satisfies InjectOptions;
}

/**
 * Injects a request authenticated as a paired device.
 *
 * A device presents its own header and never the operator bearer: the two
 * credentials reach different work, and sending both would make which one
 * authorised the call a matter of server-side precedence.
 */
export function asDevice(token: string, options: AuthedInject): InjectOptions {
  return {
    ...options,
    headers: {
      [DEVICE_TOKEN_HEADER]: token,
      ...options.headers,
    },
  } satisfies InjectOptions;
}

/** Injects a request authenticated as the operator worker. */
export function asWorker(options: AuthedInject): InjectOptions {
  return {
    ...options,
    headers: {
      authorization: `Bearer ${TEST_WORKER_TOKEN}`,
      ...options.headers,
    },
  } satisfies InjectOptions;
}

export const IDEMPOTENCY_HEADER_NAME = 'idempotency-key';

export function idempotencyKey(): string {
  return `test-${randomUUID()}`;
}
