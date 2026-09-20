/**
 * Cross-site request forgery defence: origin verification *plus* an anti-CSRF
 * token, as 09_SECURITY_PRIVACY.md requires.
 *
 * Two independent checks, because each covers the other's blind spot:
 *
 *  * Origin/Referer verification stops a cross-site form post outright, and
 *    works even before a session exists (login, setup).
 *  * The double-submit token stops anything that can reach the API with the
 *    cookie but cannot read a response — including a same-site subdomain,
 *    where SameSite=Lax alone would not help.
 *
 * There is no CORS plugin registered anywhere in this API. That is deliberate:
 * "Never expose a wildcard CORS policy with credentials." With no
 * `Access-Control-Allow-Origin` header at all, a browser refuses to hand a
 * cross-origin response to script, and a preflighted request never arrives.
 */
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { forbidden } from '../errors.js';
import { CSRF_HEADER, csrfTokenMatches } from './sessions.js';
import type { Principal } from './scope.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Verifies the request came from the application's own origin.
 *
 * An absent Origin *and* absent Referer is rejected rather than allowed: every
 * browser sends Origin on cross-origin state-changing requests, so the absent
 * case is either a non-browser client (which should use the worker credential
 * on `/internal/v1`) or an attempt to dodge the check.
 */
export function verifyOrigin(config: Config, request: FastifyRequest): void {
  const headerOrigin = originOf(request.headers.origin);
  if (headerOrigin !== null) {
    if (headerOrigin !== config.appOrigin) {
      throw forbidden('Request origin is not permitted.');
    }
    return;
  }

  const refererOrigin = originOf(request.headers.referer);
  if (refererOrigin !== null) {
    if (refererOrigin !== config.appOrigin) {
      throw forbidden('Request origin is not permitted.');
    }
    return;
  }

  throw forbidden('A same-origin Origin or Referer header is required for this request.');
}

/**
 * Verifies the double-submit token. Only applicable to session principals:
 * the worker credential is not a browser and is not cookie-authenticated, so
 * CSRF does not apply to `/internal/v1`.
 */
export function verifyCsrfToken(
  config: Config,
  principal: Principal | null,
  request: FastifyRequest,
): void {
  if (principal === null || principal.kind !== 'session') {
    throw forbidden('A session is required for this request.');
  }
  const presented = request.headers[CSRF_HEADER];
  const token = Array.isArray(presented) ? presented[0] : presented;
  if (!csrfTokenMatches(config, principal, token)) {
    throw forbidden('Missing or invalid anti-CSRF token.');
  }
}
