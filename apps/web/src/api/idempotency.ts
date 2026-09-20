/**
 * Idempotency keys for the commands that require one
 * (04_API_CONTRACTS.md: "Mutation Idempotency-Key is required for scan,
 * generate, packet, fill and export commands; same key with different body
 * returns 409").
 *
 * The rule the UI must honour: one key per *user intent*, reused across every
 * retry of that intent. Generating a fresh key on retry would defeat the
 * header entirely and could queue the same work twice.
 */
export function newIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('No cryptographic random source is available for an idempotency key.');
}

/**
 * Holds the key for the intent currently being attempted.
 *
 * `keyFor(payload)` returns the same key while the payload is unchanged — that
 * is a retry — and a new key as soon as the user edits the request, which is a
 * different intent and must not collide with the previous key (the server
 * answers 409 IDEMPOTENCY_MISMATCH for a reused key with a different body).
 */
export class IdempotentIntent {
  #payload: string | null = null;
  #key: string | null = null;

  keyFor(payload: unknown): string {
    const serialized = JSON.stringify(payload);
    if (this.#payload !== serialized || this.#key === null) {
      this.#payload = serialized;
      this.#key = newIdempotencyKey();
    }
    return this.#key;
  }

  /** Call once the intent has been accepted, so the next attempt is new work. */
  complete(): void {
    this.#payload = null;
    this.#key = null;
  }
}
