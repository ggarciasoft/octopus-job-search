/**
 * Workspace preferences.
 *
 * 08_UX_AND_CUSTOMIZATION.md: "Validate schema on import; reject unknown keys
 * rather than silently ignoring errors." The contract's `Preferences` object
 * is declared `additionalProperties: false`, and `buildApp` validates request
 * bodies with TypeBox rather than a permissive Ajv configuration, so an
 * unknown key is rejected at the route boundary with a per-field error — it is
 * never stripped and stored as if the user had not sent it.
 *
 * One rule cannot be expressed in JSON Schema and is enforced here: the match
 * weights must sum to exactly 100 ("Weights are configurable nonnegative
 * values summing to 100", 06_AI_PROFILE_AND_CV.md). `matchWeightsSum` comes
 * from the contracts package so the API and the worker agree on the arithmetic.
 */
import type { Selectable } from 'kysely';
import {
  DEFAULT_PREFERENCES,
  Preferences as PreferencesSchema,
  matchWeightsSum,
  type Preferences,
  type PreferencesView,
} from '@job-getter/contracts';
import type { PreferencesTable } from '../db/types.js';
import { notFound, staleRevision, unprocessable } from '../errors.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { checkSchema } from '../validation.js';

export type PreferencesRow = Selectable<PreferencesTable>;

/** Same lazy-creation rationale as `ensureProfile`. */
export async function ensurePreferences(scope: WorkspaceScope): Promise<PreferencesRow> {
  const existing = await scope.selectFrom('preferences').selectAll().executeTakeFirst();
  if (existing) return existing as PreferencesRow;

  await scope
    .insertInto('preferences', { revision: 1, config: JSON.stringify(DEFAULT_PREFERENCES) })
    .onConflict((builder) => builder.column('workspace_id').doNothing())
    .execute();

  const created = await scope.selectFrom('preferences').selectAll().executeTakeFirst();
  if (!created) throw notFound('No preferences exist for this workspace.');
  return created as PreferencesRow;
}

export async function lockPreferences(scope: WorkspaceScope): Promise<PreferencesRow> {
  const row = await scope.selectFrom('preferences').selectAll().forUpdate().executeTakeFirst();
  if (!row) throw notFound('No preferences exist for this workspace.');
  return row as PreferencesRow;
}

export function assertPreferencesRevision(row: PreferencesRow, expected: number): void {
  if (row.revision !== expected) {
    throw staleRevision(
      `Preferences are at revision ${row.revision}, not ${expected}. ` +
        'Reload and reapply your changes.',
    );
  }
}

/**
 * Domain validation beyond the schema.
 *
 * The route validator has already enforced the shape, the ranges and the
 * closed key set; what remains is the cross-field invariant.
 */
export function assertPreferencesValid(config: Preferences): void {
  const sum = matchWeightsSum(config.match_weights);
  if (sum !== 100) {
    throw unprocessable(`Match weights must sum to exactly 100; these sum to ${sum}.`, {
      match_weights: `Sums to ${sum}, not 100.`,
    });
  }
}

/**
 * Reads a stored config back.
 *
 * A row written by an older settings version would fail this check rather than
 * being served as if it were current: `settings_version` exists so a migration
 * is a deliberate act, not an implicit reinterpretation of stored JSON.
 */
export function readStoredConfig(row: PreferencesRow): Preferences {
  const check = checkSchema(PreferencesSchema, row.config);
  if (!check.ok) {
    throw unprocessable(
      'The stored preferences do not match the current settings schema and were not applied. ' +
        'Save your preferences again to migrate them.',
      check.fields,
    );
  }
  return row.config as Preferences;
}

export function toPreferencesView(row: PreferencesRow): PreferencesView {
  return {
    revision: row.revision,
    config: readStoredConfig(row),
    updated_at: row.updated_at.toISOString(),
  };
}
