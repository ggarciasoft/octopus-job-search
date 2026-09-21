import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid, WorkspaceMode } from '../common.js';

/**
 * Workspace export (docs/spec/09_SECURITY_PRIVACY.md, "Retention defaults";
 * PR14).
 *
 * The spec sentence this implements is short and load-bearing: "Export
 * includes profile, preferences, job records, submitted CVs, answer bank and
 * application history in versioned JSON plus files. Exclude secrets/session/
 * browser data."
 *
 * Two consequences are in these shapes rather than left to the handler.
 *
 * **The archive says what it left out.** `excluded` is not documentation, it
 * is part of the manifest: a user who exports their data is entitled to know
 * that their provider API key and their sessions were deliberately not in the
 * file, rather than discovering the gap later and wondering whether the export
 * was complete.
 *
 * **Every file carries its digest.** A restore, or a person, can check that
 * the bytes in the archive are the bytes the record refers to — which is what
 * makes the original-CV guarantee (AT11) survive a round trip through an
 * export.
 */

/** Bump when the JSON layout changes in a way a reader must notice. */
export const EXPORT_SCHEMA_VERSION = 1;

/** Where the JSON and the files live inside the archive. */
export const EXPORT_MANIFEST_PATH = 'manifest.json';
export const EXPORT_DATA_PATH = 'workspace.json';
export const EXPORT_FILES_PREFIX = 'files/';

export const ExportedFile = Type.Object(
  {
    /** Path inside the archive, always under `files/`. */
    path: Type.String({ maxLength: 500 }),
    file_id: Uuid,
    original_name: Type.String({ maxLength: 260 }),
    mime: Type.String({ maxLength: 200 }),
    bytes: Type.Integer({ minimum: 0 }),
    sha256: Type.String({ maxLength: 64 }),
    purpose: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);
export type ExportedFile = Static<typeof ExportedFile>;

/**
 * What was deliberately left out, and why, in the user's terms. Codes rather
 * than prose so the UI can translate them, and so the list cannot quietly
 * shrink without a contract change.
 */
export const ExportExclusion = Type.Union([
  Type.Literal('provider_secrets'),
  Type.Literal('sessions'),
  Type.Literal('device_tokens'),
  Type.Literal('browser_profile'),
  Type.Literal('operator_infrastructure'),
  Type.Literal('staging_files'),
]);
export type ExportExclusion = Static<typeof ExportExclusion>;

export const ALL_EXPORT_EXCLUSIONS = [
  'provider_secrets',
  'sessions',
  'device_tokens',
  'browser_profile',
  'operator_infrastructure',
  'staging_files',
] as const satisfies readonly ExportExclusion[];

export const ExportCounts = Type.Object(
  {
    profile_facts: Type.Integer({ minimum: 0 }),
    jobs: Type.Integer({ minimum: 0 }),
    matches: Type.Integer({ minimum: 0 }),
    resumes: Type.Integer({ minimum: 0 }),
    applications: Type.Integer({ minimum: 0 }),
    application_packets: Type.Integer({ minimum: 0 }),
    application_events: Type.Integer({ minimum: 0 }),
    answer_bank: Type.Integer({ minimum: 0 }),
    files: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ExportCounts = Static<typeof ExportCounts>;

export const WorkspaceExportManifest = Type.Object(
  {
    schema_version: Type.Literal(EXPORT_SCHEMA_VERSION),
    exported_at: Timestamp,
    workspace: Type.Object(
      { id: Uuid, mode: WorkspaceMode, locale: Type.String({ maxLength: 8 }) },
      { additionalProperties: false },
    ),
    counts: ExportCounts,
    files: Type.Array(ExportedFile, { maxItems: 10_000 }),
    excluded: Type.Array(ExportExclusion, { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export type WorkspaceExportManifest = Static<typeof WorkspaceExportManifest>;

/**
 * The task result. `POST /workspace/export` answers 202 with a task id, and
 * this is what `GET /tasks/:id` carries once it has succeeded.
 */
export const ExportWorkspaceResult = Type.Object(
  {
    file_id: Uuid,
    bytes: Type.Integer({ minimum: 0 }),
    sha256: Type.String({ maxLength: 64 }),
    manifest: WorkspaceExportManifest,
  },
  { additionalProperties: false },
);
export type ExportWorkspaceResult = Static<typeof ExportWorkspaceResult>;

// ---------------------------------------------------------------------------
// The deletion ledger
// ---------------------------------------------------------------------------

/**
 * What kinds of thing a deletion can be recorded against.
 *
 * 03_DATA_MODEL.md: "Restore must reapply a deletion ledger before exposing
 * data." Restoring a backup taken before a deletion would otherwise bring the
 * deleted data back, which is the one failure mode a privacy deletion cannot
 * have. The ledger is the list a restore replays.
 */
export const DeletedObjectKind = Type.Union([
  Type.Literal('workspace'),
  Type.Literal('file'),
  Type.Literal('answer_bank'),
  Type.Literal('source'),
  Type.Literal('application'),
  Type.Literal('resume'),
  Type.Literal('profile_fact'),
]);
export type DeletedObjectKind = Static<typeof DeletedObjectKind>;

export const ALL_DELETED_OBJECT_KINDS = [
  'workspace',
  'file',
  'answer_bank',
  'source',
  'application',
  'resume',
  'profile_fact',
] as const satisfies readonly DeletedObjectKind[];
