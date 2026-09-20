/**
 * Opaque session tokens stored as digests, delivered as an HttpOnly cookie.
 *
 * 09_SECURITY_PRIVACY.md: "Cookies: HttpOnly, Secure hosted, SameSite=Lax;
 * anti-CSRF token plus origin verification on state-changing routes."
 *
 * The anti-CSRF value is derived from the session token with an HMAC keyed by
 * SESSION_SECRET rather than stored in its own column. That keeps revocation
 * automatic (killing the session kills the CSRF token) and means the database
 * holds nothing that could be replayed.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { DbExecutor } from '../db/pool.js';
import type { SessionPrincipal } from './scope.js';
import { constantTimeEqual, generateToken, hmacHex, sha256Hex } from '../util/crypto.js';

/**
 * Re-exported from the contracts package rather than declared here. The web
 * client has to read CSRF_COOKIE and echo it in CSRF_HEADER, so these names
 * are part of the HTTP contract between the two sides. Defining them twice
 * would mean a rename on one side silently disabled CSRF protection on the
 * other instead of breaking a build.
 */
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@job-getter/contracts';

export { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE };

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Refresh the sliding expiry at most once every 15 minutes. */
const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

export function deriveCsrfToken(sessionSecret: string, sessionToken: string): string {
  return hmacHex(sessionSecret, `jg-csrf:${sessionToken}`);
}

export interface CreatedSession {
  readonly token: string;
  readonly csrfToken: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export async function createSession(
  db: DbExecutor,
  config: Config,
  input: { userId: string; workspaceId: string },
): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const inserted = await db
    .insertInto('sessions')
    .values({
      token_hash: hashSessionToken(token),
      user_id: input.userId,
      workspace_id: input.workspaceId,
      expires_at: expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    token,
    csrfToken: deriveCsrfToken(config.sessionSecret, token),
    sessionId: inserted.id,
    expiresAt,
  };
}

function baseCookieOptions(config: Config) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
  };
}

export function setSessionCookies(
  reply: FastifyReply,
  config: Config,
  session: CreatedSession,
): void {
  const maxAge = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
  reply.setCookie(SESSION_COOKIE, session.token, { ...baseCookieOptions(config), maxAge });
  // Deliberately not HttpOnly: the SPA must read it to echo it back in the
  // x-csrf-token header. It grants nothing on its own — an attacker on another
  // origin can neither read it nor forge the session cookie.
  reply.setCookie(CSRF_COOKIE, session.csrfToken, {
    ...baseCookieOptions(config),
    httpOnly: false,
    maxAge,
  });
}

export function clearSessionCookies(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { ...baseCookieOptions(config) });
  reply.clearCookie(CSRF_COOKIE, { ...baseCookieOptions(config), httpOnly: false });
}

export interface ResolvedSession {
  readonly principal: SessionPrincipal;
  readonly expiresAt: Date;
}

/**
 * Looks up the session behind a cookie. Returns null for absent, unknown,
 * expired, revoked or disabled-user sessions — the caller cannot tell which,
 * which is the point.
 */
export async function resolveSession(
  db: DbExecutor,
  request: FastifyRequest,
): Promise<ResolvedSession | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 16) return null;

  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as session_id',
      'sessions.user_id',
      'sessions.workspace_id',
      'sessions.expires_at',
      'sessions.revoked_at',
      'sessions.last_seen_at',
      'users.disabled_at',
    ])
    .where('sessions.token_hash', '=', hashSessionToken(token))
    .executeTakeFirst();

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.disabled_at !== null) return null;
  if (row.expires_at.getTime() <= Date.now()) return null;

  // Sliding expiry, throttled so a polling UI does not write on every request.
  if (Date.now() - row.last_seen_at.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await db
      .updateTable('sessions')
      .set({
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
        updated_at: new Date(),
      })
      .where('id', '=', row.session_id)
      .execute();
  }

  return {
    principal: {
      kind: 'session',
      userId: row.user_id,
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      sessionToken: token,
    },
    expiresAt: row.expires_at,
  };
}

export async function revokeSession(db: DbExecutor, sessionId: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), updated_at: new Date() })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

/** Used by password reset and workspace deletion once those exist. */
export async function revokeAllUserSessions(db: DbExecutor, userId: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), updated_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
}

export function csrfTokenMatches(
  config: Config,
  principal: SessionPrincipal,
  presented: string | undefined,
): boolean {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  return constantTimeEqual(
    presented,
    deriveCsrfToken(config.sessionSecret, principal.sessionToken),
  );
}
