/**
 * Names shared across the HTTP boundary.
 *
 * These lived independently in `apps/api` and `apps/web` and happened to
 * agree. That agreement was accidental: nothing failed if they drifted, and a
 * rename on one side would have silently disabled CSRF protection on the
 * other rather than breaking a build. They are defined once here so the two
 * sides cannot disagree without a compile error.
 */

/** Opaque session token. HttpOnly: never readable from JavaScript. */
export const SESSION_COOKIE = 'jg_session';

/**
 * Double-submit anti-CSRF token. Deliberately NOT HttpOnly, because the web
 * client has to read it and echo it back in CSRF_HEADER. It is not a
 * credential on its own: it authorises nothing without the session cookie.
 */
export const CSRF_COOKIE = 'jg_csrf';

/** Header carrying the double-submit token on state-changing requests. */
export const CSRF_HEADER = 'x-csrf-token';

/** Required on the mutation commands flagged in the route manifest. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Correlates a client-visible error with a server log line. */
export const REQUEST_ID_HEADER = 'x-request-id';
