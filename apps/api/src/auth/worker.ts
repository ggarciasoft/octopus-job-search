/**
 * Authentication for `/internal/v1/*`.
 *
 * 04_API_CONTRACTS.md: "separate operator worker credential for internal
 * polling" and "Never issue global worker credentials to a user device."
 *
 * Consequences implemented here:
 *
 *  * A session cookie is never accepted on an internal route, and the worker
 *    bearer token is never accepted on `/api/v1`. They are different
 *    principals with different reachable surfaces.
 *  * The operator worker may serve every workspace but may *not* claim
 *    runner-only capabilities (`fill_local`). A paired device may claim only
 *    runner-only work, and only inside its own workspace.
 *
 * Device pairing landed in M4: `authenticateDevice` resolves a token issued by
 * `POST /devices/exchange`, and the authorization rules below have had a real
 * principal to act on ever since.
 */
import type { FastifyRequest } from 'fastify';
import {
  DEVICE_TOKEN_HEADER,
  RUNNER_ONLY_CAPABILITIES,
  type TaskType,
} from '@job-getter/contracts';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { forbidden, unauthenticated } from '../errors.js';
import { constantTimeEqual } from '../util/crypto.js';
import { resolveDeviceToken, touchDevice } from '../devices/service.js';
import type { DevicePrincipal, Principal, WorkerPrincipal } from './scope.js';

const RUNNER_ONLY = new Set<string>(RUNNER_ONLY_CAPABILITIES);

export function isRunnerOnlyCapability(capability: string): boolean {
  return RUNNER_ONLY.has(capability);
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Validates the operator worker credential in constant time. Returns the
 * worker principal or throws 401; it never reveals whether the token was
 * absent or merely wrong.
 */
export function authenticateWorker(config: Config, request: FastifyRequest): WorkerPrincipal {
  const token = bearerToken(request);
  if (token === null || !constantTimeEqual(token, config.workerAuthToken)) {
    throw unauthenticated('A valid worker credential is required.');
  }
  return { kind: 'worker', workerId: workerIdFromRequest(request) };
}

/**
 * The worker names itself in the claim body; for other internal routes the
 * identity comes from the lease it presents, so a stable placeholder is used
 * for logging only.
 */
function workerIdFromRequest(request: FastifyRequest): string {
  const header = request.headers['x-worker-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    ? value
    : 'operator-worker';
}

/**
 * Capability authorization for a claim.
 *
 * The operator worker must not be able to claim `fill_local`: browser filling
 * happens on the user's own machine, in their own browser session
 * (02_ARCHITECTURE.md, invariant 7). Asking for it is rejected loudly rather
 * than silently filtered, so a misconfigured worker is visible.
 *
 * A device principal is the mirror image: it may claim *only* runner-only
 * capabilities, and the claim query is additionally restricted to its own
 * workspace.
 */
export function assertCapabilitiesAllowed(
  principal: Principal,
  capabilities: readonly TaskType[],
): void {
  if (principal.kind === 'worker') {
    const forbiddenCapabilities = capabilities.filter((capability) =>
      isRunnerOnlyCapability(capability),
    );
    if (forbiddenCapabilities.length > 0) {
      throw forbidden(
        `Capability ${forbiddenCapabilities.join(', ')} may only be claimed by a paired local ` +
          'runner, not by an operator worker credential.',
      );
    }
    return;
  }

  if (principal.kind === 'device') {
    const notAllowed = capabilities.filter((capability) => !isRunnerOnlyCapability(capability));
    if (notAllowed.length > 0) {
      throw forbidden(
        `A paired device may only claim ${RUNNER_ONLY_CAPABILITIES.join(', ')}; ` +
          `it requested ${notAllowed.join(', ')}.`,
      );
    }
    return;
  }

  throw forbidden('A session may not claim tasks.');
}

/**
 * Resolves a paired device from the `x-device-token` header.
 *
 * Returns null when no device header is present, so the caller can fall
 * through to the operator worker credential. It throws — rather than returning
 * null — when a header *is* present but does not resolve: a revoked, expired
 * or unknown token must be a 401, not a silent downgrade to "no device", or a
 * revocation would merely change which error the runner eventually sees.
 *
 * Every condition lives in `resolveDeviceToken`, which reads `revoked_at` on
 * every request. That is what makes AT23 true: revocation denies the next call
 * rather than waiting for the token's own expiry.
 */
export async function authenticateDevice(
  db: Db,
  request: FastifyRequest,
): Promise<DevicePrincipal | null> {
  const raw = request.headers[DEVICE_TOKEN_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (typeof token !== 'string' || token.trim() === '') return null;

  const device = await resolveDeviceToken(db, token.trim());
  if (device === null) {
    throw unauthenticated('This device token is not valid. Pair the device again.');
  }
  await touchDevice(db, device);
  return { kind: 'device', deviceId: device.id, workspaceId: device.workspace_id };
}
