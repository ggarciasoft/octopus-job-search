/**
 * Header names and the extension protocol version, as plain values.
 *
 * This module imports nothing, and it is the one part of the contracts
 * package the browser extension needs at runtime. Everything else it uses is a
 * type, which costs nothing. It is published as `@job-getter/contracts/headers`
 * because the package's main entry registers TypeBox formats as it loads,
 * which a bundler must keep, and that pulls in every schema. Through the
 * main entry, the extension's service worker was about 110 kB. Through this
 * one it carries only what it uses.
 *
 * The schema modules re-export these, so every other import is unchanged.
 */

/** The header a paired device presents. Not a cookie: a runner is not a browser. */
export const DEVICE_TOKEN_HEADER = 'x-device-token';

/**
 * The extension/server protocol (10_DEPLOYMENT.md: "support current and
 * previous protocol minor version").
 *
 * The extension is installed separately from the server and updated on its
 * own schedule, so the two can drift. It sends its version on every request;
 * the API accepts the current minor version and the one before it, and
 * refuses anything else with `426 PROTOCOL_UNSUPPORTED` and a sentence that
 * says which side to update. Bump the minor version when a change needs both
 * sides, and the major version when the previous minor can no longer be
 * served.
 *
 * An extension that sends no header predates it and speaks 1.0.
 */
export const EXTENSION_PROTOCOL_HEADER = 'x-job-getter-protocol';
export const EXTENSION_PROTOCOL_VERSION = '1.0';

export type ProtocolVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'malformed' | 'too_old' | 'too_new' };

/**
 * Whether the API can serve an extension speaking `sent`. Pure, and
 * parameterised on the server's own version so the window is testable before
 * there is a second version to test it with.
 */
export function extensionProtocolVerdict(
  sent: string | undefined,
  current: string = EXTENSION_PROTOCOL_VERSION,
): ProtocolVerdict {
  const parse = (value: string): [number, number] | null => {
    const match = /^(\d{1,4})\.(\d{1,4})$/.exec(value.trim());
    return match === null ? null : [Number(match[1]), Number(match[2])];
  };
  const theirs = parse(sent ?? '1.0');
  const ours = parse(current);
  if (theirs === null || ours === null) return { ok: false, reason: 'malformed' };
  if (theirs[0] < ours[0]) return { ok: false, reason: 'too_old' };
  if (theirs[0] > ours[0]) return { ok: false, reason: 'too_new' };
  if (theirs[1] > ours[1]) return { ok: false, reason: 'too_new' };
  if (theirs[1] < ours[1] - 1) return { ok: false, reason: 'too_old' };
  return { ok: true };
}

/**
 * The header carrying the session nonce. Separate from `x-device-token`
 * because they authorise different things: the token says which browser this
 * is, the nonce says which fill it is acting on. A request that presents the
 * token alone can create a session and nothing else.
 */
export const FILL_SESSION_NONCE_HEADER = 'x-fill-session-nonce';
