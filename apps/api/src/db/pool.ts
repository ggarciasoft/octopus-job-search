/**
 * PostgreSQL connection management.
 *
 * Timeouts are set deliberately: a request that hangs on the database is worse
 * than one that fails, because the caller cannot tell the difference between
 * "slow" and "never". `statement_timeout` bounds any single query and
 * `connectionTimeoutMillis` bounds waiting for a free connection.
 */
import pg from 'pg';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { Database } from './types.js';

const { Pool, types } = pg;
export type { Transaction };

/**
 * `bigint` (int8) arrives as a string by default so precision is not silently
 * lost. `files.bytes` is the only int8 column in M0 and it is typed as string
 * in `types.ts` to match; callers convert explicitly.
 *
 * `numeric` likewise stays a string: money must never round-trip through a
 * float.
 */
const INT8_OID = 20;
const NUMERIC_OID = 1700;
types.setTypeParser(INT8_OID, (value) => value);
types.setTypeParser(NUMERIC_OID, (value) => value);

export interface PoolOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
  readonly statementTimeoutMs?: number;
}

export function createPool(options: PoolOptions): pg.Pool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'job-getter-api',
    // Fail fast rather than queueing forever when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Bound every statement. The queue's `FOR UPDATE SKIP LOCKED` never waits
    // on a lock, so a long statement here means something is genuinely wrong.
    statement_timeout: options.statementTimeoutMs ?? 20_000,
    query_timeout: (options.statementTimeoutMs ?? 20_000) + 2_000,
    // Sessions are short-lived; keep TCP keepalive on for container networks.
    keepAlive: true,
  });

  // An idle client that errors (server restart, network drop) must not take
  // the process down: pg emits this on the pool, and an unhandled 'error'
  // event on an EventEmitter is fatal.
  pool.on('error', () => {
    /* Reported by the next query; swallowing here prevents process exit. */
  });

  return pool;
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Closes Kysely (which owns the pool handle) and then the pool itself. */
export async function closeDb(db: Kysely<Database>, pool: pg.Pool): Promise<void> {
  try {
    await db.destroy();
  } finally {
    // Kysely's destroy() ends the pool it was given; end() is idempotent but
    // may reject if already ended, so the result is ignored.
    await pool.end().catch(() => undefined);
  }
}

export type Db = Kysely<Database>;
export type DbTransaction = Transaction<Database>;
/** Anything that can run a query: the pool-backed instance or a transaction. */
export type DbExecutor = Db | DbTransaction;
