/**
 * Anti-CSRF token lookup.
 *
 * 09_SECURITY_PRIVACY.md requires "anti-CSRF token plus origin verification on
 * state-changing routes", and the generated client sends whatever this returns
 * as `X-CSRF-Token`. The session cookie itself is HttpOnly and is never read
 * here — only the deliberately readable double-submit token is.
 *
 * The cookie name comes from the contracts package, which the API imports
 * too, so the two sides cannot drift apart without a compile error. This
 * previously guessed among four spellings because the API did not exist yet;
 * the guess happened to be right, but nothing would have failed if it had not
 * been -- CSRF protection would simply have stopped working.
 *
 * `setCsrfTokenFromSession()` remains for the case where the API delivers the
 * token in a response body instead of a cookie; that value takes priority.
 */
import { CSRF_COOKIE } from '@job-getter/contracts';

const COOKIE_CANDIDATES = [CSRF_COOKIE] as const;

let sessionToken: string | undefined;

/**
 * Overrides the cookie lookup with a token delivered in a response body.
 * Held in a module variable rather than storage: it must not outlive the tab.
 */
export function setCsrfTokenFromSession(token: string | undefined | null): void {
  sessionToken = token ?? undefined;
}

export function readCsrfToken(): string | undefined {
  if (sessionToken !== undefined && sessionToken !== '') return sessionToken;
  if (typeof document === 'undefined') return undefined;
  return readCookie(document.cookie, COOKIE_CANDIDATES);
}

export function readCookie(cookieHeader: string, names: readonly string[]): string | undefined {
  const jar = new Map<string, string>();
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name !== '') jar.set(name, value);
  }
  for (const name of names) {
    const value = jar.get(name);
    if (value !== undefined && value !== '') return decodeURIComponent(value);
  }
  return undefined;
}
