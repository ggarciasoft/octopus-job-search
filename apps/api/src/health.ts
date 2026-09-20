/**
 * Health endpoints, per 10_DEPLOYMENT.md:
 *
 *   "Health endpoints: liveness process only; readiness database/schema/
 *    storage configuration."
 *
 * The distinction is operationally load-bearing. Liveness answering "the
 * process is alive" must not consult the database, or a database blip would
 * make an orchestrator kill healthy API containers. Readiness must fail before
 * migrations have run, because "Database migrations run as a one-shot service
 * before API readiness" — an API serving traffic against a half-created schema
 * looks like a product bug.
 *
 * These routes are operational, live outside `/api/v1`, and are deliberately
 * absent from the `ROUTES` contract manifest.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { isSchemaCurrent } from './db/migrate.js';
import type { StorageDriver } from './files/storage.js';

export interface HealthDeps {
  readonly config: Config;
  readonly pool: pg.Pool;
  readonly storage: StorageDriver;
  readonly startedAt: number;
}

export interface ReadinessCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly checks: readonly ReadinessCheck[];
}

async function checkDatabase(pool: pg.Pool): Promise<ReadinessCheck> {
  try {
    const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    return {
      name: 'database',
      ok: result.rows[0]?.ok === 1,
      detail: 'connection established',
    };
  } catch (error) {
    return {
      name: 'database',
      ok: false,
      detail: `unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkSchema(pool: pg.Pool): Promise<ReadinessCheck> {
  try {
    const status = await isSchemaCurrent(pool);
    if (status.current) return { name: 'schema', ok: true, detail: 'all migrations applied' };
    const parts: string[] = [];
    if (status.pending.length > 0) parts.push(`pending: ${status.pending.join(', ')}`);
    if (status.drifted.length > 0) parts.push(`checksum mismatch: ${status.drifted.join(', ')}`);
    return { name: 'schema', ok: false, detail: parts.join('; ') };
  } catch (error) {
    // The most common cause is that `schema_migrations` does not exist yet,
    // i.e. migrations have never run. Not ready is the correct answer.
    return {
      name: 'schema',
      ok: false,
      detail: `cannot read migration state: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function checkStorage(storage: StorageDriver): Promise<ReadinessCheck> {
  const result = await storage.healthCheck();
  return { name: 'storage', ok: result.ok, detail: result.detail };
}

export async function readiness(deps: HealthDeps): Promise<ReadinessReport> {
  const database = await checkDatabase(deps.pool);
  // Probing the schema without a connection just produces a second confusing
  // error; report the real cause instead.
  const schema = database.ok
    ? await checkSchema(deps.pool)
    : { name: 'schema', ok: false, detail: 'not checked: database unreachable' };
  const storage = await checkStorage(deps.storage);
  const checks = [database, schema, storage];
  return { ready: checks.every((check) => check.ok), checks };
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/health/live', async (_request, reply) => {
    // Process-only. No database, no storage, no dependency of any kind.
    return reply.status(200).send({
      status: 'ok',
      uptime_seconds: Math.round((Date.now() - deps.startedAt) / 1000),
    });
  });

  app.get('/health/ready', async (_request, reply) => {
    const report = await readiness(deps);
    return reply.status(report.ready ? 200 : 503).send({
      status: report.ready ? 'ready' : 'not_ready',
      mode: deps.config.appMode,
      checks: report.checks,
    });
  });
}
