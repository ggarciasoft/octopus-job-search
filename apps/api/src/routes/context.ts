/**
 * Shared per-application context handed to every route handler, plus the
 * Fastify type augmentation for the authenticated principal.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import type { Logger } from '../logging.js';
import type { StorageDriver } from '../files/storage.js';
import { unauthenticated } from '../errors.js';
import { WorkspaceScope, type Principal, type SessionPrincipal } from '../auth/scope.js';

export interface RouteContext {
  readonly config: Config;
  readonly db: Db;
  readonly pool: pg.Pool;
  readonly storage: StorageDriver;
  readonly logger: Logger;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the authentication hooks; never derived from the request body. */
    principal: Principal | null;
  }
}

export type RouteHandler = (
  context: RouteContext,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

/** Narrows to a session principal or rejects with 401. */
export function requireSession(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === null || principal.kind !== 'session') {
    throw unauthenticated('Sign in to continue.');
  }
  return principal;
}

/**
 * Builds the workspace scope for the current request. This is the only
 * supported way a handler obtains database access to private tables, so the
 * workspace always comes from the session row rather than from the client.
 */
export function requireScope(context: RouteContext, request: FastifyRequest): WorkspaceScope {
  const principal = requireSession(request);
  const scope = WorkspaceScope.fromPrincipal(context.db, principal);
  if (scope === null) throw unauthenticated('Sign in to continue.');
  return scope;
}
