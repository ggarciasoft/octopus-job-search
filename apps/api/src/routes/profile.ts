/**
 * GET /profile and PATCH /profile.
 *
 * `PATCH` is the only way a user edits facts directly. It is optimistic:
 * `expected_revision` must match the stored revision or the request is
 * rejected with `409 STALE_REVISION` and nothing is written
 * (03_DATA_MODEL.md).
 *
 * Fact values are validated against the schema their own `kind` selects, plus
 * the date-consistency rules — a `value` that does not match its `kind` is
 * `422`, not a stored blob that breaks a CV three milestones later.
 */
import type { Profile, ProfilePatchRequest } from '@job-getter/contracts';
import { recordAuditEvent } from '../auth/scope.js';
import {
  applyProfilePatch,
  assertProfileRevision,
  buildProfileView,
  ensureProfile,
  lockProfile,
} from '../profile/service.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const getProfile: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const profile = await ensureProfile(scope);
  const view: Profile = await buildProfileView(scope, profile);
  return reply.status(200).send(view);
};

export const patchProfile: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as ProfilePatchRequest;

  // The row must exist before it can be locked; a workspace that has never
  // read its profile still gets one here rather than a confusing 404.
  await ensureProfile(scope);

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const profile = await lockProfile(scoped);
    assertProfileRevision(profile, body.expected_revision);

    const result = await applyProfilePatch(trx, scope, profile, body);

    await recordAuditEvent(scoped, {
      action: 'profile.patched',
      actorId: principal.userId,
      objectId: profile.id,
      objectType: 'profile',
      // Counts only: fact values are CV content and never enter the audit
      // trail (09_SECURITY_PRIVACY.md, "Do not log CV text").
      metadata: {
        revision: result.revision,
        changes: body.changes.length,
        upserts: body.changes.filter((change) => change.op === 'upsert').length,
        deletes: body.changes.filter((change) => change.op === 'delete').length,
        confirmed_changed: result.confirmedChanged,
        contact_changed: body.contact !== undefined,
      },
    });

    return lockProfile(scoped);
  });

  const view: Profile = await buildProfileView(scope, updated);
  return reply.status(200).send(view);
};
