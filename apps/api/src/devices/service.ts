/**
 * Paired devices: minting a code, exchanging it once, and deciding on every
 * request whether a token is still allowed to act.
 *
 * Three decisions carry the security of this feature.
 *
 * **Status is derived, never stored.** `deviceStatus` recomputes from
 * `revoked_at`, `expires_at` and whether a token exists at all. A stored status
 * column would be one more thing that can disagree with the columns
 * authentication actually reads — and the disagreement that matters is the one
 * where a revoked device still works (AT23).
 *
 * **Both secrets are digests.** The pairing code and the token are hashed
 * before they touch the database and compared by lookup on the digest. Neither
 * can be read back out, so a database dump yields no usable credential.
 *
 * **A code is consumed by the statement that reads it.** Exchange is a single
 * conditional UPDATE, so two processes racing on one code produce exactly one
 * token; the loser sees no matching row and is told the code is invalid,
 * without learning why.
 */
import {
  DEVICE_PAIRING_TTL_SECONDS,
  DEVICE_TOKEN_TTL_DAYS,
  type DeviceStatus,
  type DeviceView,
} from '@job-getter/contracts';
import type { Db } from '../db/pool.js';
import type { WorkspaceScope } from '../auth/scope.js';
import type { PairedDeviceRow } from '../db/types.js';
import { notFound, unprocessable } from '../errors.js';
import { sha256Hex } from '../util/crypto.js';

export const DEVICE_TOKEN_TTL_MS = DEVICE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
export const DEVICE_PAIRING_TTL_MS = DEVICE_PAIRING_TTL_SECONDS * 1000;

export function hashDeviceSecret(value: string): string {
  return sha256Hex(value);
}

export function deviceStatus(row: PairedDeviceRow, now: Date = new Date()): DeviceStatus {
  if (row.revoked_at !== null) return 'revoked';
  if (row.token_hash === null) {
    // Still waiting to be paired; an unused code that ran out is expired, not
    // pending, because nothing can ever be done with it again.
    return row.pairing_expires_at !== null && row.pairing_expires_at.getTime() <= now.getTime()
      ? 'expired'
      : 'pending';
  }
  if (row.expires_at !== null && row.expires_at.getTime() <= now.getTime()) return 'expired';
  return 'paired';
}

export function toDeviceView(row: PairedDeviceRow, now: Date = new Date()): DeviceView {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    status: deviceStatus(row, now),
    device_public_id: row.device_public_id,
    allowed_origins: (row.allowed_origins as string[] | null) ?? [],
    expires_at: row.expires_at === null ? null : row.expires_at.toISOString(),
    revoked_at: row.revoked_at === null ? null : row.revoked_at.toISOString(),
    last_seen_at: row.last_seen_at === null ? null : row.last_seen_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Normalise the origins a device may act on.
 *
 * Only the scheme and host survive: an origin carrying a path would read as a
 * permission for one page while actually permitting the whole host, which is
 * the sort of difference nobody notices until it matters.
 */
export function normalizeAllowedOrigins(values: readonly string[] | undefined): string[] {
  const origins = new Set<string>();
  for (const value of values ?? []) {
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw unprocessable(`"${value}" is not a valid origin.`, {
        allowed_origins: 'Use a scheme and host, for example https://boards.greenhouse.io.',
      });
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw unprocessable(`"${value}" is not an http or https origin.`, {
        allowed_origins: 'Only http and https origins can be filled.',
      });
    }
    origins.add(url.origin);
  }
  return [...origins];
}

export async function requireDevice(scope: WorkspaceScope, id: string): Promise<PairedDeviceRow> {
  const row = await scope
    .selectFrom('paired_devices')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('No such device.');
  return row as PairedDeviceRow;
}

export interface AuthenticatedDevice {
  readonly row: PairedDeviceRow;
}

/**
 * Resolve a presented device token, or null.
 *
 * Every condition is checked here rather than split between a query and a
 * caller: a token that is revoked, expired or never exchanged is the same
 * answer — no device — and the caller cannot accidentally skip one of them.
 */
export async function resolveDeviceToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<PairedDeviceRow | null> {
  if (token.length < 32) return null;
  const row = await db
    .selectFrom('paired_devices')
    .selectAll()
    .where('token_hash', '=', hashDeviceSecret(token))
    .executeTakeFirst();
  if (!row) return null;
  const device = row as PairedDeviceRow;
  if (deviceStatus(device, now) !== 'paired') return null;
  return device;
}

/** Records that a device was seen, at most once a minute to avoid write churn. */
export async function touchDevice(
  db: Db,
  device: PairedDeviceRow,
  now = new Date(),
): Promise<void> {
  const last = device.last_seen_at?.getTime() ?? 0;
  if (now.getTime() - last < 60_000) return;
  await db
    .updateTable('paired_devices')
    .set({ last_seen_at: now, updated_at: now })
    .where('id', '=', device.id)
    .execute();
}
