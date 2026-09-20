/**
 * GET /preferences and PUT /preferences.
 *
 * `PUT` replaces the whole config. Unknown keys are **rejected**, not ignored
 * (08_UX_AND_CUSTOMIZATION.md): the contract's `Preferences` object is closed
 * and the route validator is TypeBox, so an extra key produces a
 * `400 VALIDATION_ERROR` naming the offending field. A settings file with a
 * typo therefore fails loudly instead of silently running with a default the
 * user believed they had changed.
 *
 * The one rule JSON Schema cannot state — match weights summing to exactly
 * 100 — is enforced as a domain rule and answered with `422`.
 */
import type { PreferencesPutRequest, PreferencesView } from '@job-getter/contracts';
import { recordAuditEvent } from '../auth/scope.js';
import {
  assertPreferencesRevision,
  assertPreferencesValid,
  ensurePreferences,
  lockPreferences,
  toPreferencesView,
} from '../settings/preferences.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const getPreferences: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const row = await ensurePreferences(scope);
  const view: PreferencesView = toPreferencesView(row);
  return reply.status(200).send(view);
};

export const putPreferences: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as PreferencesPutRequest;

  assertPreferencesValid(body.config);
  await ensurePreferences(scope);

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const row = await lockPreferences(scoped);
    assertPreferencesRevision(row, body.expected_revision);

    const next = row.revision + 1;
    await scoped
      .updateTable('preferences')
      .set({
        revision: next,
        config: JSON.stringify(body.config),
        updated_at: new Date(),
      })
      .where('id', '=', row.id)
      .execute();

    await recordAuditEvent(scoped, {
      action: 'preferences.updated',
      actorId: principal.userId,
      objectId: row.id,
      objectType: 'preferences',
      // Shape only. Target titles and excluded companies are user content.
      metadata: {
        revision: next,
        settings_version: body.config.settings_version,
        // 08: "Editing weights makes matches stale." Recording that the
        // weights moved is what a later milestone needs to invalidate cached
        // matches; the values themselves are already in the row.
        weights_changed:
          JSON.stringify(body.config.match_weights) !==
          JSON.stringify((row.config as { match_weights?: unknown }).match_weights),
      },
    });

    return lockPreferences(scoped);
  });

  const view: PreferencesView = toPreferencesView(updated);
  return reply.status(200).send(view);
};
