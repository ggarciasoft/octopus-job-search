/**
 * Packaging a workspace as an archive the user can keep.
 *
 * 09_SECURITY_PRIVACY.md: "Export includes profile, preferences, job records,
 * submitted CVs, answer bank and application history in versioned JSON plus
 * files. Exclude secrets/session/browser data."
 *
 * Three decisions, each one a place where the easy version would have been
 * quietly wrong.
 *
 * **The exclusion list is allow-list shaped.** `EXPORTED_TABLES` names what
 * goes in. A deny-list would mean the next table anyone adds is exported by
 * default, and the first time that matters it will be the table with the
 * secrets in it. `provider_settings` and `sessions` are not "filtered out"
 * here; they were never in the list.
 *
 * **The archive says what it left out.** A user who exports their data and
 * finds no provider key should be told that was deliberate, in the manifest,
 * rather than left to wonder whether the export failed.
 *
 * **It runs in the API, not in the worker.** The export is SQL and stored
 * files, which is the API's own responsibility (02_ARCHITECTURE.md), and the
 * worker has neither database access nor the files. The task row is real and
 * is written in the state the work actually reached, so `GET /tasks/:id`
 * answers truthfully; nothing pretends a worker claimed it.
 */
import { createHash } from 'node:crypto';
import {
  EXPORT_DATA_PATH,
  EXPORT_FILES_PREFIX,
  EXPORT_MANIFEST_PATH,
  EXPORT_SCHEMA_VERSION,
  type ExportCounts,
  type ExportExclusion,
  type ExportWorkspaceResult,
  type ExportedFile,
  type WorkspaceExportManifest,
} from '@job-getter/contracts';
import type { WorkspaceScope } from '../auth/scope.js';
import type { StorageDriver } from '../files/storage.js';
import { buildZip, type ZipEntry } from './zip.js';

/**
 * Exactly what the archive contains, in the order a reader would want it.
 *
 * Deliberately absent, and each for its own reason:
 *
 *  * `provider_settings` — holds the encrypted provider secret.
 *  * `sessions`, `paired_devices` — credentials; exporting them would export
 *    the ability to act as the user.
 *  * `idempotency_records`, `tasks`, `task_artifacts`, `usage_ledger`,
 *    `audit_events` — operational rather than the user's data.
 *  * `memberships`, `users` — account plumbing, and `users` holds a password
 *    digest.
 */
export const EXPORTED_TABLES = [
  'profiles',
  'profile_facts',
  'preferences',
  'profile_imports',
  'sources',
  'scans',
  'jobs',
  'job_sources',
  'job_imports',
  'matches',
  'resumes',
  'answer_bank',
  'applications',
  'application_packets',
  'application_events',
  'files',
] as const;

export type ExportedTable = (typeof EXPORTED_TABLES)[number];

/** What is deliberately left out, reported in the manifest. */
export const EXPORT_EXCLUSIONS: readonly ExportExclusion[] = [
  'provider_secrets',
  'sessions',
  'device_tokens',
  'browser_profile',
  'operator_infrastructure',
  'staging_files',
];

export interface BuiltExport {
  readonly archive: Buffer;
  readonly manifest: WorkspaceExportManifest;
  readonly sha256: string;
}

function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Read every exported table for this workspace.
 *
 * `selectAll` through the scope, so the workspace predicate is applied by the
 * same chokepoint every other read uses: an export is the one operation where
 * a missing `WHERE workspace_id` would hand one user another user's data in a
 * single file.
 */
async function readTables(
  scope: WorkspaceScope,
): Promise<Record<string, readonly Record<string, unknown>[]>> {
  const data: Record<string, readonly Record<string, unknown>[]> = {};
  for (const table of EXPORTED_TABLES) {
    const rows = await scope.selectFrom(table).selectAll().execute();
    data[table] = rows as unknown as Record<string, unknown>[];
  }
  return data;
}

function countsOf(data: Record<string, readonly unknown[]>): ExportCounts {
  return {
    profile_facts: data.profile_facts?.length ?? 0,
    jobs: data.jobs?.length ?? 0,
    matches: data.matches?.length ?? 0,
    resumes: data.resumes?.length ?? 0,
    applications: data.applications?.length ?? 0,
    application_packets: data.application_packets?.length ?? 0,
    application_events: data.application_events?.length ?? 0,
    answer_bank: data.answer_bank?.length ?? 0,
    files: data.files?.length ?? 0,
  };
}

export interface FileRecord {
  readonly id: string;
  readonly storage_key: string;
  readonly original_name: string;
  readonly mime: string;
  readonly bytes: number | string;
  readonly sha256: string;
  readonly purpose: string;
  readonly state: string;
}

/**
 * Build the archive.
 *
 * Only `ready` files are included: a `staging` row is a half-finished upload
 * whose bytes may not be there, and a `deleting` one is on its way out. An
 * object the storage driver cannot produce is reported in the manifest as
 * missing by simple absence from `files` — the JSON row is still exported, so
 * the record of the document survives even where the bytes did not.
 */
export async function buildWorkspaceExport(
  scope: WorkspaceScope,
  storage: StorageDriver,
  workspace: { id: string; mode: 'local' | 'hosted'; locale: string },
  now: Date,
): Promise<BuiltExport> {
  const data = await readTables(scope);
  const fileRows = (data.files ?? []) as unknown as readonly FileRecord[];

  const entries: ZipEntry[] = [];
  const exported: ExportedFile[] = [];

  for (const file of fileRows) {
    if (file.state !== 'ready') continue;
    let bytes: Buffer;
    try {
      bytes = await storage.read(file.storage_key);
    } catch {
      // The row stays in workspace.json; the bytes simply are not here. An
      // export that silently dropped the record too would hide the loss.
      continue;
    }
    const path = `${EXPORT_FILES_PREFIX}${file.id}-${file.original_name.replace(/[^\w.-]+/g, '_')}`;
    entries.push({ path, data: bytes });
    exported.push({
      path,
      file_id: file.id,
      original_name: file.original_name,
      mime: file.mime,
      bytes: Number(file.bytes),
      sha256: file.sha256,
      purpose: file.purpose,
    });
  }

  const manifest: WorkspaceExportManifest = {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: now.toISOString(),
    workspace: { id: workspace.id, mode: workspace.mode, locale: workspace.locale },
    counts: countsOf(data),
    files: exported,
    excluded: [...EXPORT_EXCLUSIONS],
  };

  // The manifest first, so a reader who opens the archive sees what it claims
  // to contain before they see the contents.
  const archive = buildZip([
    { path: EXPORT_MANIFEST_PATH, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    {
      path: EXPORT_DATA_PATH,
      data: Buffer.from(
        `${JSON.stringify({ schema_version: EXPORT_SCHEMA_VERSION, tables: data }, null, 2)}\n`,
      ),
    },
    ...entries,
  ]);

  return { archive, manifest, sha256: sha256Of(archive) };
}

export function toExportResult(built: BuiltExport, fileId: string): ExportWorkspaceResult {
  return {
    file_id: fileId,
    bytes: built.archive.length,
    sha256: built.sha256,
    manifest: built.manifest,
  };
}
