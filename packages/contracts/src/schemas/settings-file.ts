/**
 * The settings file: a workspace's configuration as a document a person can
 * keep, diff and carry to another installation (08_UX_AND_CUSTOMIZATION.md,
 * customization level 2, "local YAML/JSON import/export for reproducible
 * settings"). JSON only for now; nothing here needs YAML's extra syntax.
 *
 * **What it holds is configuration, not data.** The preferences document
 * (which carries the CV template and language and the prompt style suffix)
 * and the list of boards being watched. Deliberately absent:
 *
 * - provider settings, because a provider without its key would import
 *   half-configured, and the key must never be in a file ("Export preferences
 *   without tokens, provider keys or browser sessions");
 * - the answer bank, which is personal data (phone numbers, right-to-work
 *   answers) and belongs to the full workspace export instead;
 * - anything operational: board health, scan state, conditional-request hints.
 *
 * Every object is closed. A file with a key this version does not know is
 * refused whole, naming the key, rather than imported minus the part the
 * person believed they had set.
 */
import { Type, type Static } from '@sinclair/typebox';
import { Timestamp } from '../common.js';
import { CreateSourceRequest } from './jobs.js';
import { Preferences, PreferencesView } from './preferences.js';

export const SETTINGS_FILE_FORMAT = 'job-getter-settings';
export const SETTINGS_FILE_VERSION = 1;
export const SETTINGS_FILE_MAX_SOURCES = 500;

export const SettingsFileSource = Type.Object(
  {
    connector: CreateSourceRequest.properties.connector,
    board_key: CreateSourceRequest.properties.board_key,
    base_url: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SettingsFileSource = Static<typeof SettingsFileSource>;

export const SettingsFile = Type.Object(
  {
    format: Type.Literal(SETTINGS_FILE_FORMAT),
    format_version: Type.Literal(SETTINGS_FILE_VERSION),
    exported_at: Timestamp,
    preferences: Preferences,
    sources: Type.Array(SettingsFileSource, { maxItems: SETTINGS_FILE_MAX_SOURCES }),
  },
  { additionalProperties: false },
);
export type SettingsFile = Static<typeof SettingsFile>;

export const SettingsImportRequest = Type.Object(
  {
    /** The preferences revision the person was looking at when they chose the file. */
    expected_revision: Type.Integer({ minimum: 1 }),
    settings: SettingsFile,
  },
  { additionalProperties: false },
);
export type SettingsImportRequest = Static<typeof SettingsImportRequest>;

export const SettingsImportResult = Type.Object(
  {
    preferences: PreferencesView,
    /** Boards in the file that this workspace did not have, now added. */
    sources_created: Type.Integer({ minimum: 0 }),
    /**
     * Boards in the file that were already here. Left exactly as they were:
     * an import never re-enables a board a site blocked, and never deletes
     * one the file does not mention.
     */
    sources_already_present: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type SettingsImportResult = Static<typeof SettingsImportResult>;
