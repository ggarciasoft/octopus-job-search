/**
 * GET /devices, POST /devices/pairing, POST /devices/exchange,
 * GET /devices/:id, DELETE /devices/:id.
 *
 * Pairing has two halves on purpose. The code is minted inside an
 * authenticated web session, so granting a device access is always an act by
 * someone already signed in — "Device pairing requires approval in an
 * authenticated web session, including device label and origin". The exchange
 * is the only unauthenticated route here, because the process redeeming the
 * code is a desktop runner with no cookie and no browser origin; it is
 * single-use, five minutes old at most, and rate limited.
 *
 * The token is returned exactly once. Only its digest is stored, so this API
 * cannot show it again, and neither can a database dump.
 */
import {
  DEVICE_PAIRING_TTL_SECONDS,
  EXTENSION_PROTOCOL_VERSION,
  type CreatePairingRequest,
  type DeviceExchangeRequest,
  type DeviceExchangeResponse,
  type DeviceView,
  type PairingCodeResponse,
} from '@job-getter/contracts';
import { conflict, unprocessable } from '../errors.js';
import { recordAuditEvent, WorkspaceScope } from '../auth/scope.js';
import type { PairedDeviceRow } from '../db/types.js';
import { generateToken } from '../util/crypto.js';
import {
  DEVICE_PAIRING_TTL_MS,
  DEVICE_TOKEN_TTL_MS,
  deviceStatus,
  hashDeviceSecret,
  normalizeAllowedOrigins,
  requireDevice,
  toDeviceView,
} from '../devices/service.js';
import {
  requireScope,
  requireSession,
  requireSupportedProtocol,
  type RouteHandler,
} from './context.js';

export const listDevices: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const rows = (await scope
    .selectFrom('paired_devices')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(100)
    .execute()) as PairedDeviceRow[];

  // Devices are a small, bounded list the user manages by hand; there is no
  // pagination to do, so the cursor is honestly null rather than invented.
  return reply.status(200).send({ items: rows.map((row) => toDeviceView(row)), next_cursor: null });
};

export const getDevice: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const row = await requireDevice(scope, id);
  return reply.status(200).send(toDeviceView(row) satisfies DeviceView);
};

/**
 * Mint a single-use pairing code.
 *
 * The code is shown once to the browser that asked for it. It is deliberately
 * not emailed, not written to a file and not passed on a command line: the
 * user types it into the runner, so it never reaches a shell history.
 */
export const createDevicePairing: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const body = request.body as CreatePairingRequest;
  const allowedOrigins = normalizeAllowedOrigins(body.allowed_origins);

  const code = generateToken(24);
  const now = new Date();

  const row = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const inserted = await scoped
      .insertInto('paired_devices', {
        kind: body.device_kind,
        label: body.label.trim(),
        pairing_code_hash: hashDeviceSecret(code),
        pairing_expires_at: new Date(now.getTime() + DEVICE_PAIRING_TTL_MS),
        allowed_origins: JSON.stringify(allowedOrigins),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await recordAuditEvent(scoped, {
      action: 'device.pairing_created',
      actorId: principal.userId,
      objectId: inserted.id,
      objectType: 'paired_device',
      // The label and kind, never the code.
      metadata: {
        kind: body.device_kind,
        origin_count: allowedOrigins.length,
      },
    });
    return inserted;
  });

  return reply.status(201).send({
    device_id: row.id,
    pairing_code: code,
    expires_in: DEVICE_PAIRING_TTL_SECONDS,
  } satisfies PairingCodeResponse);
};

/**
 * Exchange a code for a scoped token, once.
 *
 * The consumption is a single conditional UPDATE: two runners racing on one
 * code produce exactly one token, and the loser is told the code is invalid
 * without learning whether it was wrong, expired or already used.
 */
export const exchangeDevicePairing: RouteHandler = async (context, request, reply) => {
  // Before the code is spent: an extension that cannot talk to this server
  // should keep its code for after the upgrade, not burn it on a pairing
  // that will fail on its next request.
  requireSupportedProtocol(request);
  const body = request.body as DeviceExchangeRequest;
  const now = new Date();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + DEVICE_TOKEN_TTL_MS);

  const row = await context.db
    .updateTable('paired_devices')
    .set({
      token_hash: hashDeviceSecret(token),
      device_public_id: body.device_public_id.trim(),
      expires_at: expiresAt,
      pairing_consumed_at: now,
      // The code is destroyed as it is spent, so a replay has nothing to match.
      pairing_code_hash: null,
      pairing_expires_at: null,
      updated_at: now,
    })
    .where('pairing_code_hash', '=', hashDeviceSecret(body.pairing_code.trim()))
    .where('pairing_expires_at', '>', now)
    .where('token_hash', 'is', null)
    .where('revoked_at', 'is', null)
    .returningAll()
    .executeTakeFirst();

  if (!row) {
    // One message for wrong, expired and already-used. Which one it was is
    // information an attacker would use and the legitimate user does not need.
    throw unprocessable('That pairing code is not valid. Generate a new one and try again.', {
      pairing_code: 'Invalid, expired or already used.',
    });
  }

  const device = row as PairedDeviceRow;
  // No session, so no session-derived scope. The workspace comes from the row
  // the code matched -- a server-side value, never anything the request said.
  await recordAuditEvent(WorkspaceScope.forTaskWorkspace(context.db, device.workspace_id), {
    action: 'device.paired',
    // The actor is the device itself; no user was signed in for this call.
    actorId: null,
    objectId: device.id,
    objectType: 'paired_device',
    metadata: { kind: device.kind },
  });

  return reply.status(200).send({
    device_id: device.id,
    token,
    expires_at: expiresAt.toISOString(),
    allowed_origins: (device.allowed_origins as string[] | null) ?? [],
    protocol_version: EXTENSION_PROTOCOL_VERSION,
  } satisfies DeviceExchangeResponse);
};

export const revokeDevice: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };

  const existing = await requireDevice(scope, id);
  if (deviceStatus(existing) === 'revoked') {
    throw conflict('That device is already revoked.');
  }

  await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    await scoped
      .updateTable('paired_devices')
      .set({
        revoked_at: new Date(),
        // The credential goes with the revocation: there is nothing left to
        // present, so a leaked copy is inert rather than merely refused.
        token_hash: null,
        expires_at: null,
        pairing_code_hash: null,
        pairing_expires_at: null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    // AT23: "immediate API denial and no new packet access." Destroying the
    // token denies the next request; ending the sessions in the same
    // transaction is what makes the second half true. A live fill session is
    // packet access, and it would otherwise outlive the credential that
    // obtained it by up to ten minutes.
    await scoped
      .updateTable('fill_sessions')
      .set({ ended_at: new Date(), ended_reason: 'device_revoked' })
      .where('device_id', '=', id)
      .where('ended_at', 'is', null)
      .execute();

    await recordAuditEvent(scoped, {
      action: 'device.revoked',
      actorId: principal.userId,
      objectId: id,
      objectType: 'paired_device',
      metadata: { kind: existing.kind },
    });
  });

  return reply.status(204).send();
};
