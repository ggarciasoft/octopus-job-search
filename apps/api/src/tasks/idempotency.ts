/**
 * Idempotency-Key handling (04_API_CONTRACTS.md).
 *
 *  * "Mutation Idempotency-Key is required for scan, generate, packet, fill
 *    and export commands" — in this codebase, for every route the contract
 *    marks `requiresIdempotencyKey`.
 *  * "same key with different body returns 409".
 *  * "Store response for 24 hours; domain uniqueness remains after
 *    expiration."
 *
 * That last clause is why the replay store is not the only defence: after the
 * stored response expires, re-using a key still hits the
 * `tasks (workspace_id, type, idempotency_key)` unique constraint, which
 * surfaces as 409 rather than creating a second task.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY_HEADER } from '@job-getter/contracts';
import type { Db } from '../db/pool.js';
import { idempotencyMismatch, validationError } from '../errors.js';
import { hashRequestBody } from '../util/crypto.js';
import type { WorkspaceScope } from '../auth/scope.js';

/**
 * Re-exported from the contracts package rather than declared here: the web
 * client must send this exact header name, so defining it twice would let a
 * rename on one side turn a required header into a silently ignored one.
 */
export { IDEMPOTENCY_HEADER };

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_KEY_LENGTH = 200;
const MIN_KEY_LENGTH = 8;

export function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(
      { 'idempotency-key': 'This header is required for this operation.' },
      'An Idempotency-Key header is required so a retry cannot create a duplicate.',
    );
  }
  const key = value.trim();
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw validationError({
      'idempotency-key': `Must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.`,
    });
  }
  return key;
}

export interface IdempotentOutcome<T> {
  readonly status: number;
  readonly body: T;
}

/**
 * Runs `handler` at most once per (workspace, route, key).
 *
 * The stored response is written in its own statement after the handler's own
 * transaction has committed. A crash between the two leaves no replay record,
 * so the retry re-runs the handler and is caught by the *domain* uniqueness
 * constraint instead — a duplicate is prevented either way.
 */
export async function withIdempotency<T>(
  db: Db,
  scope: WorkspaceScope,
  request: FastifyRequest,
  routeKey: string,
  handler: () => Promise<IdempotentOutcome<T>>,
): Promise<IdempotentOutcome<T>> {
  const key = readIdempotencyKey(request);
  const requestHash = hashRequestBody(request.body ?? {});

  const existing = await scope
    .selectFrom('idempotency_records')
    .select(['request_hash', 'response_status', 'response_body', 'expires_at'])
    .where('route_key', '=', routeKey)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();

  if (existing) {
    if (existing.request_hash !== requestHash) throw idempotencyMismatch();
    if (existing.expires_at.getTime() > Date.now()) {
      return { status: existing.response_status, body: existing.response_body as T };
    }
    // Expired replay window: fall through and let domain uniqueness decide.
  }

  const outcome = await handler();

  try {
    await scope
      .insertInto('idempotency_records', {
        route_key: routeKey,
        idempotency_key: key,
        request_hash: requestHash,
        response_status: outcome.status,
        response_body: JSON.stringify(outcome.body),
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      })
      .onConflict((builder) =>
        builder.columns(['workspace_id', 'route_key', 'idempotency_key']).doUpdateSet({
          request_hash: requestHash,
          response_status: outcome.status,
          response_body: JSON.stringify(outcome.body),
          expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          updated_at: new Date(),
        }),
      )
      .execute();
  } catch {
    // Recording the replay is best-effort. Losing it costs a duplicate
    // *request*, not a duplicate domain object, which the unique constraint on
    // tasks still prevents.
  }

  return outcome;
}

/** Removes replay records past their 24-hour window. */
export async function pruneIdempotencyRecords(db: Db): Promise<number> {
  const result = await db
    .deleteFrom('idempotency_records')
    .where('expires_at', '<=', new Date())
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0n);
}

/** Convenience for handlers: send an `IdempotentOutcome` through Fastify. */
export function sendOutcome<T>(reply: FastifyReply, outcome: IdempotentOutcome<T>): FastifyReply {
  return reply.status(outcome.status).send(outcome.body);
}
