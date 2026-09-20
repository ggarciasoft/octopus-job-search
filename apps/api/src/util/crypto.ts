/**
 * Small cryptographic helpers shared by sessions, lease tokens, CSRF and the
 * worker credential.
 *
 * Two rules apply everywhere in this file:
 *
 *  * Secrets are compared in constant time. A `===` on a setup token or worker
 *    bearer token leaks its prefix through timing.
 *  * Secrets are stored as digests, never as the value itself, so a database
 *    dump does not hand over live sessions or leases.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits of entropy, URL-safe. 43 characters, above the contract's 32. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(key: string | Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

/**
 * Constant-time string comparison.
 *
 * Both inputs are hashed first so that `timingSafeEqual` always receives equal
 * length buffers; otherwise a length mismatch would throw and reveal the
 * expected length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/**
 * Canonical JSON for hashing a request body: object keys sorted recursively so
 * `{a:1,b:2}` and `{b:2,a:1}` are the same idempotent request.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

export function hashRequestBody(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
