/**
 * Argon2id password hashing (09_SECURITY_PRIVACY.md).
 *
 * Cost parameters follow the OWASP "second recommended option" configuration
 * (19 MiB memory, 2 iterations, 1 degree of parallelism), which is affordable
 * on the 8 GB local target from 10_DEPLOYMENT.md while remaining well above
 * the interactive minimum. They are recorded inside the encoded hash, so a
 * later increase re-hashes on next login rather than invalidating passwords.
 */
import argon2, { type HashOptions } from 'argon2';

export const ARGON2_OPTIONS: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * A pre-computed hash of a value no user can have. Login verifies against this
 * when the email is unknown so that "no such user" and "wrong password" take
 * the same time and cannot be used to enumerate accounts.
 */
let dummyHashPromise: Promise<string> | null = null;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed stored hash must fail closed, not throw a 500 that tells the
    // caller their password was probably right.
    return false;
  }
}

/** Burns equivalent CPU time when the account does not exist. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  const pending =
    dummyHashPromise ??
    (dummyHashPromise = argon2.hash(
      'job-getter-nonexistent-account-placeholder',
      ARGON2_OPTIONS,
    ));
  const hash = await pending;
  await argon2.verify(hash, password).catch(() => false);
  return false;
}

/** Lower-cased and trimmed; `users.normalized_email` is unique on this form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
