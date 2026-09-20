/**
 * Authenticated encryption for user-supplied provider secrets.
 *
 * 09_SECURITY_PRIVACY.md: "Encrypt user provider secrets using authenticated
 * encryption and an operator key stored outside the database; support
 * rotation."
 *
 * Three properties are load-bearing:
 *
 *  1. **Authenticated.** AES-256-GCM, so a tampered ciphertext fails
 *     authentication and throws instead of decrypting to attacker-chosen
 *     plaintext. `decryptSecret` never returns a "best effort" value.
 *  2. **Key outside the database.** The key comes from `ENCRYPTION_KEY`
 *     (`src/config.ts` decodes it to exactly 32 raw bytes); nothing here reads
 *     or writes a key column. A database dump alone is useless.
 *  3. **Rotatable.** Every envelope carries the version of the key that
 *     produced it, so more than one key can be live at once.
 *
 * ## Envelope layout
 *
 * ```text
 * | version (1 byte) | nonce (12 bytes) | auth tag (16 bytes) | ciphertext |
 * ```
 *
 * The version is *outside* the authenticated payload on purpose: it has to be
 * readable before a key is selected. Flipping it cannot forge anything —
 * decrypting with the wrong key fails the GCM tag check.
 *
 * ## How rotation would work
 *
 * `Keyring` maps a version number to raw key bytes, and `currentVersion`
 * selects the key used for *new* writes. To rotate:
 *
 *  1. Add the new key to the deployment as `ENCRYPTION_KEY` and keep the old
 *     one as `ENCRYPTION_KEY_PREVIOUS` (the operator keeps both for one
 *     release; `keyringFromConfig` is the single place that would learn to
 *     read the second variable).
 *  2. Build the keyring as `{2: new, 1: old}` with `currentVersion = 2`.
 *     Reads of old rows keep working because their envelope says version 1.
 *  3. Re-encrypt lazily (every `PUT /settings/providers` rewrites its row with
 *     the current version) or eagerly with a one-shot migration that decrypts
 *     each `provider_settings.secret_ciphertext` and writes it back.
 *  4. Once no row reports version 1 — `secret_ciphertext[0]` is the version
 *     byte, so that is a single SQL query — drop the old key.
 *
 * Nothing above needs a schema change, which is the point of spending a byte
 * on the version now rather than discovering the need later.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_OFFSET = 0;
const NONCE_OFFSET = 1;
const TAG_OFFSET = NONCE_OFFSET + NONCE_BYTES;
const CIPHERTEXT_OFFSET = TAG_OFFSET + TAG_BYTES;

/** The key version written into new envelopes by `keyringFromConfig`. */
export const CURRENT_KEY_VERSION = 1;

export interface Keyring {
  /** Version used for new encryptions. Must be present in `keys`. */
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCryptoError';
  }
}

/**
 * Builds the keyring from the validated configuration.
 *
 * Today there is exactly one key. This function, not its callers, is where a
 * second (previous) key would be added during a rotation.
 */
export function keyringFromConfig(config: { readonly encryptionKey: Buffer }): Keyring {
  if (config.encryptionKey.byteLength !== KEY_BYTES) {
    throw new SecretCryptoError(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${config.encryptionKey.byteLength}.`,
    );
  }
  return {
    currentVersion: CURRENT_KEY_VERSION,
    keys: new Map([[CURRENT_KEY_VERSION, config.encryptionKey]]),
  };
}

function keyFor(keyring: Keyring, version: number): Buffer {
  const key = keyring.keys.get(version);
  if (key === undefined) {
    throw new SecretCryptoError(
      `No encryption key is configured for key version ${version}. ` +
        'A secret encrypted with a retired key cannot be read; restore that key to decrypt it.',
    );
  }
  return key;
}

/** Encrypts a secret with the keyring's current key. */
export function encryptSecret(keyring: Keyring, plaintext: string): Buffer {
  const version = keyring.currentVersion;
  const key = keyFor(keyring, version);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([version & 0xff]), nonce, tag, ciphertext]);
}

/**
 * Decrypts an envelope.
 *
 * Throws `SecretCryptoError` on a truncated envelope, an unknown key version
 * or a failed authentication tag. It never returns partially decrypted or
 * garbage output — that is the whole reason for using GCM rather than CBC.
 */
export function decryptSecret(keyring: Keyring, envelope: Buffer): string {
  if (envelope.byteLength <= CIPHERTEXT_OFFSET) {
    throw new SecretCryptoError('The stored secret envelope is truncated.');
  }
  const version = envelope[VERSION_OFFSET] as number;
  const key = keyFor(keyring, version);
  const nonce = envelope.subarray(NONCE_OFFSET, TAG_OFFSET);
  const tag = envelope.subarray(TAG_OFFSET, CIPHERTEXT_OFFSET);
  const ciphertext = envelope.subarray(CIPHERTEXT_OFFSET);

  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // The GCM tag did not verify: the ciphertext, nonce or tag was altered, or
    // it was written under a different key of the same version.
    throw new SecretCryptoError(
      'The stored secret failed authentication and was not decrypted. ' +
        'It may have been tampered with, or encrypted under a different key.',
    );
  }
}

/** The key version recorded in an envelope, for rotation bookkeeping. */
export function envelopeKeyVersion(envelope: Buffer): number | null {
  if (envelope.byteLength <= CIPHERTEXT_OFFSET) return null;
  return envelope[VERSION_OFFSET] as number;
}

/**
 * The only thing about a secret the API will ever return.
 *
 * Four trailing characters is the usual "is this the key I think it is?"
 * affordance. Anything shorter than eight characters reveals nothing at all,
 * because for a short secret four characters would be most of it.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length < 8) return '••••';
  return `••••${plaintext.slice(-4)}`;
}
