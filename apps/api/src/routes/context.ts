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
import {
  EXTENSION_PROTOCOL_HEADER,
  EXTENSION_PROTOCOL_VERSION,
  extensionProtocolVerdict,
} from '@job-getter/contracts';
import { protocolUnsupported, unauthenticated } from '../errors.js';
import {
  WorkspaceScope,
  type DevicePrincipal,
  type Principal,
  type SessionPrincipal,
} from '../auth/scope.js';

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
 * Narrows to a paired device or rejects with 401.
 *
 * Deliberately not interchangeable with `requireSession`: the two credentials
 * authorise different things, and a route that accepted either would be a
 * route where the weaker one silently sufficed. A device token reaches only
 * the fill-session routes (M5); a session cookie reaches none of them.
 */
export function requireDevicePrincipal(request: FastifyRequest): DevicePrincipal {
  const principal = request.principal;
  if (principal === null || principal.kind !== 'device') {
    throw unauthenticated('This request needs a paired device token.');
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

/**
 * The same, for a device principal. The workspace comes from the device row
 * the token resolved to, never from the request: an extension cannot name a
 * workspace any more than a browser session can.
 */
/**
 * Refuses an extension speaking a protocol this server cannot serve, before
 * anything else happens. See `EXTENSION_PROTOCOL_HEADER`.
 */
export function requireSupportedProtocol(request: FastifyRequest): void {
  const raw = request.headers[EXTENSION_PROTOCOL_HEADER];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  const verdict = extensionProtocolVerdict(sent);
  if (verdict.ok) return;
  const theirs = sent ?? '1.0';
  throw protocolUnsupported(
    verdict.reason === 'too_new'
      ? `This extension speaks protocol ${theirs}, newer than this installation's ` +
          `${EXTENSION_PROTOCOL_VERSION}. Upgrade Job Getter, or use an older extension.`
      : verdict.reason === 'too_old'
        ? `This extension speaks protocol ${theirs}, which this installation ` +
          `(${EXTENSION_PROTOCOL_VERSION}) no longer serves. Update the extension.`
        : `"${theirs}" is not a protocol version this installation understands.`,
  );
}

export function requireDeviceScope(
  context: RouteContext,
  request: FastifyRequest,
): { scope: WorkspaceScope; principal: DevicePrincipal } {
  requireSupportedProtocol(request);
  const principal = requireDevicePrincipal(request);
  const scope = WorkspaceScope.fromPrincipal(context.db, principal);
  if (scope === null) throw unauthenticated('This request needs a paired device token.');
  return { scope, principal };
}
