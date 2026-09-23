/**
 * GET /settings/export and POST /settings/import.
 *
 * The file is described in `packages/contracts/src/schemas/settings-file.ts`.
 * The route validator has already refused any key the contract does not know,
 * anywhere in the document, so what arrives here has the right shape; this
 * adds the rules JSON Schema cannot state, then applies the whole file in one
 * transaction or none of it.
 *
 * **Preferences are replaced, boards are only added.** Preferences are one
 * document with one revision, and importing a settings file means "make them
 * this"; the revision check stops that from overwriting an edit made in
 * another tab. Boards are different: each one carries health and history, so
 * a board already registered is left exactly as it is. An import never clears
 * a 403/429 block (only the person pressing "try again" does that) and never
 * deletes a board the file happens not to mention.
 */
import {
  SETTINGS_FILE_FORMAT,
  SETTINGS_FILE_VERSION,
  type SettingsFile,
  type SettingsFileSource,
  type SettingsImportRequest,
  type SettingsImportResult,
} from '@job-getter/contracts';
import { recordAuditEvent } from '../auth/scope.js';
import { connectorVersion, validateBaseUrl } from '../discovery/connectors.js';
import { ApiError, unprocessable } from '../errors.js';
import {
  assertPreferencesRevision,
  assertPreferencesValid,
  ensurePreferences,
  lockPreferences,
  readStoredConfig,
  toPreferencesView,
} from '../settings/preferences.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

/** Only boards can be re-created from a file; a manual or URL import is a job, not a source. */
const BOARD_CONNECTORS = ['greenhouse', 'lever'] as const;

export const exportSettings: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const preferences = readStoredConfig(await ensurePreferences(scope));

  const sources = await scope
    .selectFrom('sources')
    .select(['connector', 'board_key', 'base_url', 'enabled'])
    .where('connector', 'in', BOARD_CONNECTORS)
    // A stable order, so two exports of the same settings are the same file
    // and a person keeping it under version control sees only real changes.
    .orderBy('connector', 'asc')
    .orderBy('board_key', 'asc')
    .execute();

  const file: SettingsFile = {
    format: SETTINGS_FILE_FORMAT,
    format_version: SETTINGS_FILE_VERSION,
    exported_at: new Date().toISOString(),
    preferences,
    sources: sources.map((row) => ({
      connector: row.connector as SettingsFileSource['connector'],
      board_key: row.board_key,
      base_url: row.base_url,
      enabled: row.enabled,
    })),
  };
  return reply.status(200).send(file);
};

export const importSettings: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as SettingsImportRequest;
  const { preferences, sources } = body.settings;

  assertPreferencesValid(preferences);
  const boards = validateBoards(sources);
  await ensurePreferences(scope);

  const result = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const row = await lockPreferences(scoped);
    assertPreferencesRevision(row, body.expected_revision);

    const next = row.revision + 1;
    await scoped
      .updateTable('preferences')
      .set({ revision: next, config: JSON.stringify(preferences), updated_at: new Date() })
      .where('id', '=', row.id)
      .execute();

    let created = 0;
    for (const board of boards) {
      // `DO NOTHING` rather than a prior SELECT: a board registered by another
      // request between the two would otherwise fail the whole import on the
      // unique constraint.
      const inserted = await scoped
        .insertInto('sources', {
          connector: board.connector,
          connector_version: connectorVersion(board.connector),
          board_key: board.board_key,
          base_url: board.base_url,
          enabled: board.enabled,
          next_scan_after: null,
        })
        .onConflict((builder) =>
          builder.columns(['workspace_id', 'connector', 'board_key']).doNothing(),
        )
        .returning('id')
        .executeTakeFirst();
      if (inserted === undefined) continue;
      created += 1;
      await recordAuditEvent(scoped, {
        action: 'source.created',
        actorId: principal.userId,
        objectId: inserted.id,
        objectType: 'source',
        metadata: {
          connector: board.connector,
          has_base_url: board.base_url !== null,
          via: 'settings_import',
        },
      });
    }

    await recordAuditEvent(scoped, {
      action: 'settings.imported',
      actorId: principal.userId,
      objectId: row.id,
      objectType: 'preferences',
      // Shape only, as for `preferences.updated`: the values are user content.
      metadata: {
        revision: next,
        settings_version: preferences.settings_version,
        weights_changed:
          JSON.stringify(preferences.match_weights) !==
          JSON.stringify((row.config as { match_weights?: unknown }).match_weights),
        sources_in_file: boards.length,
        sources_created: created,
      },
    });

    return { row: await lockPreferences(scoped), created };
  });

  const response: SettingsImportResult = {
    preferences: toPreferencesView(result.row),
    sources_created: result.created,
    sources_already_present: boards.length - result.created,
  };
  return reply.status(200).send(response);
};

/**
 * The per-board rules the schema cannot express: a board listed twice, and a
 * `base_url` that is not a documented endpoint for its connector. Every
 * problem is reported against the board's position in the file, so a person
 * editing it by hand can find the line.
 */
function validateBoards(sources: readonly SettingsFileSource[]): SettingsFileSource[] {
  const fields: Record<string, string> = {};
  const seen = new Map<string, number>();
  const boards: SettingsFileSource[] = [];

  sources.forEach((source, index) => {
    const field = `settings.sources.${index}`;
    const identity = `${source.connector}:${source.board_key}`;
    const first = seen.get(identity);
    if (first !== undefined) {
      fields[`${field}.board_key`] = `Listed already as board ${first + 1}.`;
      return;
    }
    seen.set(identity, index);
    try {
      boards.push({ ...source, base_url: validateBaseUrl(source.connector, source.base_url) });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      fields[`${field}.base_url`] = error.message;
    }
  });

  if (Object.keys(fields).length > 0) {
    throw unprocessable('Some boards in this settings file cannot be imported.', fields);
  }
  return boards;
}
