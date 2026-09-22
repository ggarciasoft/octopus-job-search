/**
 * Fill sessions — the only thing a browser extension may do with a packet.
 *
 * docs/spec/07_APPLICATION_AUTOMATION.md: "Extension requests a fill session
 * from API. The session binds device_id, tab origin, application_id,
 * packet_hash, nonce and ten-minute expiry. API allows only current approved
 * packets."
 *
 * These routes, and `GET /fill-targets` beside them, are the whole API surface
 * a device token can reach. What they refuse is the design:
 *
 *  * **A session cookie cannot call them.** `auth: 'device'` resolves the
 *    `x-device-token` header and nothing else, so a page that makes the user's
 *    browser issue one of these requests supplies no credential at all — the
 *    token lives in the extension's service worker, where page scripts cannot
 *    reach it (AT24).
 *  * **A revoked device is denied on its next call.** Both at authentication,
 *    which reads `revoked_at` every time, and on the session itself, because
 *    revoking a device ends its live sessions in the same statement (AT23).
 *  * **The destination is never the caller's to choose.** It comes from the
 *    approved packet. There is no request field in which a page could name a
 *    different employer, a different form or a different file.
 *  * **The origin is checked against what the user paired.** A device paired
 *    for nothing may act only on the packet's own destination origin; a device
 *    paired for specific origins must have this one among them.
 *  * **One live session per application.** Enforced by a partial unique index
 *    rather than by this query, so two extensions racing cannot both win
 *    (AT15).
 */
import {
  FILL_SESSION_TTL_SECONDS,
  FILL_SESSION_NONCE_HEADER,
  FILL_TARGET_LIMIT,
  type ApplicationStatus,
  type CreateFillSessionRequest,
  type FillSessionGrant,
  type FillSessionState,
  type FillSessionView,
  type FillTarget,
  type FillTargetList,
  type ReportFillSessionRequest,
} from '@job-getter/contracts';
import type { FastifyRequest } from 'fastify';
import { conflict, notFound, unauthenticated, unprocessable } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import type { WorkspaceScope } from '../auth/scope.js';
import type {
  ApplicationPacketRow,
  ApplicationRow,
  FillSessionRow,
  PairedDeviceRow,
} from '../db/types.js';
import { contentDispositionFor, downloadContentType } from '../files/service.js';
import { generateToken, sha256Hex } from '../util/crypto.js';
import { requireDevice } from '../devices/service.js';
import { requireJob } from '../matching/matches.js';
import {
  fillableFields,
  fillRefusal,
  packetAttachment,
  requireFillablePacket,
} from '../applications/fillable.js';
import {
  loadApplicationContexts,
  reconcileApplications,
  transitionApplication,
} from '../applications/service.js';
import { resolveAllowedOrigins } from './fill.js';
import { requireDeviceScope, type RouteHandler } from './context.js';

/**
 * The outcome mapping, identical to the local runner's in
 * `applications/fill.ts`. `unsupported` returns the application to `approved`:
 * no tested adapter matched, nothing was typed, and the packet is still good
 * for the person to use by hand (AT17).
 */
const FILL_STATUS: Readonly<Record<ReportFillSessionRequest['outcome'], ApplicationStatus>> = {
  awaiting_user_submit: 'awaiting_user_submit',
  needs_input: 'needs_input',
  unsupported: 'approved',
};

const FILL_REASON: Readonly<Record<ReportFillSessionRequest['outcome'], string>> = {
  awaiting_user_submit: 'filled_awaiting_user_submit',
  needs_input: 'unanswered_required_questions',
  unsupported: 'no_tested_adapter',
};

/** Derived on every read, never stored. See `FillSessionState`. */
export function fillSessionState(row: FillSessionRow, now: Date): FillSessionState {
  if (row.ended_at !== null) return 'ended';
  if (row.expires_at.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

function view(row: FillSessionRow, now: Date): FillSessionView {
  return {
    id: row.id,
    application_id: row.application_id,
    packet_id: row.packet_id,
    device_id: row.device_id,
    content_hash: row.content_hash,
    origin: row.origin,
    state: fillSessionState(row, now),
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    ended_at: row.ended_at?.toISOString() ?? null,
    ended_reason: row.ended_reason,
  };
}

/**
 * Normalises a caller-supplied origin.
 *
 * `new URL().origin` collapses a URL to scheme, host and port, so a caller
 * that sends a full page URL — with its path, its query and whatever a hostile
 * page put in them — cannot smuggle any of it into the bound origin.
 */
function normalizeOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw unprocessable('That is not a valid origin.', { origin: 'Expected https://host.' });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw unprocessable('Only http and https pages can be filled.', {
      origin: `Received "${parsed.protocol}".`,
    });
  }
  return parsed.origin;
}

/**
 * Reads and verifies the session nonce.
 *
 * The device token says which browser this is; the nonce says which fill it is
 * acting on. Both are required for anything that touches a session, so a token
 * alone can create a session and nothing else — and a nonce that leaked out of
 * the service worker is useless without the token.
 *
 * The comparison is on digests, and a wrong nonce is 401 rather than 404: the
 * caller has already proved it holds a token for this workspace, so the
 * session's existence is not what is being protected here.
 */
function verifyNonce(request: FastifyRequest, row: FillSessionRow): void {
  const raw = request.headers[FILL_SESSION_NONCE_HEADER];
  const nonce = Array.isArray(raw) ? raw[0] : raw;
  if (typeof nonce !== 'string' || nonce.trim() === '') {
    throw unauthenticated('This request needs the fill session nonce.');
  }
  if (sha256Hex(nonce.trim()) !== row.nonce_hash) {
    throw unauthenticated('That fill session nonce is not valid.');
  }
}

async function loadSession(
  scope: WorkspaceScope,
  id: string,
  deviceId: string,
): Promise<FillSessionRow> {
  const row = (await scope
    .selectFrom('fill_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()) as FillSessionRow | undefined;
  // A session belonging to another device in the same workspace is as absent
  // as one that never existed: a second paired browser is not entitled to
  // finish the first one's work.
  if (row === undefined || row.device_id !== deviceId) throw notFound('No such fill session.');
  return row;
}

/** A local runner is given work through the task queue, never through these routes. */
function requireExtension(device: PairedDeviceRow): void {
  if (device.kind !== 'extension') {
    throw unprocessable('Only a paired browser extension can open a fill session.', {
      device_id: `This device is a "${device.kind}". A local runner is given work through the task queue.`,
    });
  }
}

/** Mirrors `resolveAllowedOrigins`, without throwing: a list skips, a session refuses. */
function devicePermitsOrigin(device: PairedDeviceRow, origin: string): boolean {
  const declared = (device.allowed_origins as string[] | null) ?? [];
  return declared.length === 0 || declared.includes(origin);
}

/**
 * GET /fill-targets — what this extension could fill right now.
 *
 * Replaces pasting an application id and a packet hash into the popup. Each
 * row is decided by `fillRefusal`, the same function `POST /fill-sessions`
 * throws with, after the same reconciliation — so an approval that lapsed or
 * a profile that moved since the web app last rendered is withdrawn here, on
 * the extension's read, rather than listed and then refused.
 *
 * It returns pointers, not packets: no answers and no CV. Those travel only in
 * a grant, which is bound to one tab's origin.
 */
export const listFillTargets: RouteHandler = async (context, request) => {
  const { scope, principal } = requireDeviceScope(context, request);
  const device = await requireDevice(scope, principal.deviceId);
  requireExtension(device);

  const approved = (await scope
    .selectFrom('applications')
    .selectAll()
    .where('status', '=', 'approved')
    .orderBy('updated_at', 'desc')
    .limit(FILL_TARGET_LIMIT)
    .execute()) as ApplicationRow[];

  const now = new Date();
  const reconciled = await reconcileApplications(
    context.db,
    scope,
    await loadApplicationContexts(scope, approved, now),
  );

  const items: FillTarget[] = [];
  for (const loaded of reconciled) {
    const packet = loaded.packet as ApplicationPacketRow | null;
    if (packet === null || fillRefusal(loaded, now) !== null) continue;
    if (!devicePermitsOrigin(device, packet.destination_origin)) continue;
    items.push({
      application_id: loaded.application.id,
      content_hash: packet.content_hash,
      job: { job_id: loaded.job.id, company: loaded.job.company, title: loaded.job.title },
      destination: {
        url: packet.destination_url,
        origin: packet.destination_origin,
        connector: packet.connector,
        connector_version: packet.connector_version,
      },
      approval_expires_at: packet.expires_at?.toISOString() ?? null,
    });
  }
  return { items } satisfies FillTargetList;
};

/**
 * POST /fill-sessions — bind one approved packet to one tab, for ten minutes.
 */
export const createFillSession: RouteHandler = async (context, request, reply) => {
  const { scope, principal } = requireDeviceScope(context, request);
  const body = request.body as CreateFillSessionRequest;
  const now = new Date();

  const device = await requireDevice(scope, principal.deviceId);
  requireExtension(device);

  const { application, packet, answers } = await requireFillablePacket(
    context.db,
    scope,
    body.application_id,
  );

  // The hash the extension believes it is filling must be the one that was
  // approved. This is what stops a session being issued against content that
  // moved while the tab sat open — the same 409 the approve route gives.
  if (body.content_hash !== packet.content_hash) {
    throw conflict(
      'That packet content hash is not the approved one; the packet changed. Reload and review it again.',
    );
  }

  const origin = normalizeOrigin(body.origin);
  if (origin !== packet.destination_origin) {
    throw unprocessable('This tab is not the page this packet was approved for.', {
      origin: `The approved destination is ${packet.destination_origin}.`,
    });
  }
  // Throws when the device was paired for other origins and not this one.
  resolveAllowedOrigins((device.allowed_origins as string[] | null) ?? [], origin);

  const job = await requireJob(scope, application.job_id);
  const attachment = await packetAttachment(scope, packet);
  const nonce = generateToken(32);

  const row = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);

    // Expired sessions are ended here rather than swept elsewhere, so expiry
    // frees the slot the unique index holds — but inside this transaction, so
    // it cannot free it for a concurrent caller.
    await scoped
      .updateTable('fill_sessions')
      .set({ ended_at: now, ended_reason: 'superseded' })
      .where('ended_at', 'is', null)
      .where('expires_at', '<=', now)
      .execute();

    let inserted: FillSessionRow;
    try {
      inserted = (await scoped
        .insertInto('fill_sessions', {
          device_id: device.id,
          application_id: application.id,
          packet_id: packet.id,
          content_hash: packet.content_hash,
          origin,
          nonce_hash: sha256Hex(nonce),
          expires_at: new Date(now.getTime() + FILL_SESSION_TTL_SECONDS * 1000),
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as FillSessionRow;
    } catch (error) {
      // The partial unique index, not a race we lost quietly.
      if (isUniqueViolation(error)) {
        throw conflict(
          'A fill is already in progress for this application. Finish or cancel it first.',
        );
      }
      throw error;
    }

    // The application enters `filling`, exactly as it does when a task is
    // queued for the local runner. That is what the state machine allows
    // (`approved → filling → awaiting_user_submit | needs_input`), and it is
    // also a second lock on AT15: a second session cannot be opened while the
    // application is no longer `approved`.
    await transitionApplication(scoped, application, 'filling', {
      type: 'fill_requested',
      actor: 'user',
      data: {
        packet_id: packet.id,
        device_id: device.id,
        fill_session_id: inserted.id,
        field_count: answers.length,
        origin,
      },
    });

    return inserted;
  });

  await recordAuditEvent(scope, {
    action: 'fill_session.created',
    actorId: null,
    objectId: row.id,
    objectType: 'fill_session',
    metadata: {
      device_id: device.id,
      application_id: application.id,
      origin,
      field_count: answers.length,
    },
  });

  const grant: FillSessionGrant = {
    session_id: row.id,
    nonce,
    expires_at: row.expires_at.toISOString(),
    application_id: application.id,
    packet_id: packet.id,
    content_hash: packet.content_hash,
    origin,
    destination: {
      url: packet.destination_url,
      origin: packet.destination_origin,
      connector: packet.connector,
      connector_version: packet.connector_version,
    },
    job: { job_id: job.id, company: job.company, title: job.title },
    resume_file_id: attachment.fileId,
    resume_sha256: packet.resume_sha256,
    resume_filename: attachment.filename,
    fields: fillableFields(answers),
    known_form_fingerprint: packet.form_fingerprint,
    adapter: packet.connector,
  };

  reply.code(201);
  return grant;
};

/** GET /fill-sessions/:id — is this session still live? */
export const getFillSession: RouteHandler = async (context, request) => {
  const { scope, principal } = requireDeviceScope(context, request);
  const { id } = request.params as { id: string };
  const row = await loadSession(scope, id, principal.deviceId);
  verifyNonce(request, row);
  return view(row, new Date());
};

/**
 * GET /fill-sessions/:id/resume — the CV this packet was approved with.
 *
 * The one file a fill session may fetch, and it is not named by the caller:
 * the id in the path is the *session's*, and the file is resolved from the
 * packet that session was granted against. There is no parameter in which a
 * page could ask for a different file, which is the same property the runner's
 * lease-scoped file endpoint has and for the same reason.
 *
 * Served as an attachment with `nosniff`, like every other download here, so
 * a CV that is somehow HTML cannot execute in the API's origin.
 */
export const downloadFillSessionResume: RouteHandler = async (context, request, reply) => {
  const { scope, principal } = requireDeviceScope(context, request);
  const { id } = request.params as { id: string };
  const now = new Date();

  const row = await loadSession(scope, id, principal.deviceId);
  verifyNonce(request, row);

  // An ended or expired session may not still be fetching the person's CV.
  const state = fillSessionState(row, now);
  if (state !== 'active') {
    throw conflict(`This fill session is ${state}, so it cannot download anything.`);
  }

  const packet = (await scope
    .selectFrom('application_packets')
    .selectAll()
    .where('id', '=', row.packet_id)
    .executeTakeFirst()) as ApplicationPacketRow | undefined;
  if (packet === undefined) throw notFound('That packet no longer exists.');

  const attachment = await packetAttachment(scope, packet);
  if (attachment.fileId === null) throw notFound('This packet has no CV to attach.');

  const file = await scope
    .selectFrom('files')
    .selectAll()
    .where('id', '=', attachment.fileId)
    .where('state', '!=', 'deleting')
    .executeTakeFirst();
  if (!file) throw notFound('This packet has no CV to attach.');

  const stream = await context.storage.createReadStream(file.storage_key).catch(() => null);
  if (stream === null) throw notFound('This packet has no CV to attach.');

  await scope
    .updateTable('fill_sessions')
    .set({ last_seen_at: now })
    .where('id', '=', row.id)
    .execute();

  return reply
    .status(200)
    .header('content-type', downloadContentType(file.mime))
    .header('content-disposition', contentDispositionFor(file.original_name))
    .header('content-length', String(file.bytes))
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'private, no-store')
    .send(stream);
};

/**
 * POST /fill-sessions/:id/report — what was filled, and what the page still
 * needs. Ends the session either way: a session is spent once.
 */
export const reportFillSession: RouteHandler = async (context, request) => {
  const { scope, principal } = requireDeviceScope(context, request);
  const { id } = request.params as { id: string };
  const body = request.body as ReportFillSessionRequest;
  const now = new Date();

  const row = await loadSession(scope, id, principal.deviceId);
  verifyNonce(request, row);

  const state = fillSessionState(row, now);
  if (state !== 'active') {
    throw conflict(`This fill session is ${state}, so it cannot report a fill.`);
  }

  // Where the tab actually was. A report from a page outside the bound origin
  // describes a form this packet was never approved for.
  if (body.page_url !== null) {
    const reported = normalizeOrigin(body.page_url);
    if (reported !== row.origin) {
      throw unprocessable('That page is not the origin this session was opened for.', {
        page_url: `This session is bound to ${row.origin}.`,
      });
    }
  }

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const ended = (await scoped
      .updateTable('fill_sessions')
      .set({ ended_at: now, ended_reason: 'reported', last_seen_at: now })
      .where('id', '=', row.id)
      .where('ended_at', 'is', null)
      .returningAll()
      .executeTakeFirst()) as FillSessionRow | undefined;
    if (ended === undefined) {
      throw conflict('This fill session was already finished.');
    }

    const application = await scoped
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', row.application_id)
      .executeTakeFirstOrThrow();

    // The same states, event type and reasons the local runner's result
    // produces (`applications/fill.ts`), because the application's history
    // must not record which client filled the form as if it were a different
    // kind of event. There is no `fill_completed`: even a fully filled form is
    // a pause, because the person still presses submit.
    await transitionApplication(scoped, application, FILL_STATUS[body.outcome], {
      type: 'fill_paused',
      actor: 'runner',
      reason: FILL_REASON[body.outcome],
      data: {
        fill_session_id: row.id,
        device_id: row.device_id,
        packet_id: row.packet_id,
        origin: row.origin,
        filled: body.filled_fields.length,
        unresolved: body.unresolved_fields.length,
        outcome: body.outcome,
        adapter: body.adapter,
        adapter_version: body.adapter_version,
      },
    });

    return ended;
  });

  return view(updated, now);
};

/** DELETE /fill-sessions/:id — give up without reporting a fill. */
export const endFillSession: RouteHandler = async (context, request, reply) => {
  const { scope, principal } = requireDeviceScope(context, request);
  const { id } = request.params as { id: string };
  const now = new Date();

  const row = await loadSession(scope, id, principal.deviceId);
  verifyNonce(request, row);

  await scope
    .updateTable('fill_sessions')
    .set({ ended_at: now, ended_reason: 'cancelled' })
    .where('id', '=', row.id)
    .where('ended_at', 'is', null)
    .execute();

  reply.code(204);
  return null;
};

/** PostgreSQL 23505, however the driver wrapped it. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
