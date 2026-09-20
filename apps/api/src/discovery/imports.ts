/**
 * Manual job import: the `job_imports` row and the `fetch_job` result.
 *
 * `POST /jobs/import` takes a URL *or* a pasted description with the user's
 * own provenance hints. The worker resolves it under the arbitrary-URL policy
 * and answers with one normalised job, or with candidates when the page held
 * several postings ("Require user review if there are several postings on a
 * page", 05_DISCOVERY_CONNECTORS.md). Only a resolved job becomes a `jobs`
 * row; candidates wait on the import row for the user to choose.
 *
 * ## Deliberate deviation: no `GET /jobs/imports/:id`
 *
 * The contract declares no route that reads an import, and adding one would
 * be an undeclared endpoint. Instead:
 *
 *  * `GET /jobs/:id` also accepts the id of the task that produced an import,
 *    and answers 404 until that import has a job (the same pattern as
 *    `GET /profile/imports/:id`);
 *  * the stored `fetch_job` task result — readable through `GET /tasks/:id`
 *    — is extended with a `job_import` block `{id, status, job_id}` beside
 *    the contract's own `job`, `candidates` and `warnings`, so a client that
 *    holds only the task id can learn what happened and where the job is.
 *
 * The extension is additive: every contract field is stored unchanged.
 */
import type { FetchJobResult, FetchWarning, NormalizedJob } from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import type { JobImportRow, TaskRow } from '../db/types.js';
import { WorkspaceScope } from '../auth/scope.js';
import { upsertNormalizedJob } from './jobs.js';

/**
 * Import states. Not a contract enum — the contract exposes an import only
 * through its task — so the SQL CHECK is compared against this list by
 * tests/db/discovery-schema.test.ts.
 */
export const JOB_IMPORT_STATUSES = ['queued', 'resolved', 'needs_choice', 'failed'] as const;
export type JobImportStatus = (typeof JOB_IMPORT_STATUSES)[number];

/** What `job_imports.input` records: the request minus the pasted text. */
export interface JobImportInput {
  readonly url: string | null;
  readonly description_chars: number;
  readonly company: string | null;
  readonly title: string | null;
  readonly apply_url: string | null;
}

export function readImportInput(row: JobImportRow): JobImportInput {
  const raw = (row.input ?? {}) as Partial<JobImportInput>;
  return {
    url: typeof raw.url === 'string' ? raw.url : null,
    description_chars: typeof raw.description_chars === 'number' ? raw.description_chars : 0,
    company: typeof raw.company === 'string' ? raw.company : null,
    title: typeof raw.title === 'string' ? raw.title : null,
    apply_url: typeof raw.apply_url === 'string' ? raw.apply_url : null,
  };
}

/** The block appended to the stored task result (see the module comment). */
export interface JobImportResultExtension {
  readonly id: string;
  readonly status: JobImportStatus;
  readonly job_id: string | null;
}

async function lockImportForTask(
  scope: WorkspaceScope,
  taskId: string,
): Promise<JobImportRow | null> {
  const row = await scope
    .selectFrom('job_imports')
    .selectAll()
    .where('task_id', '=', taskId)
    .forUpdate()
    .executeTakeFirst();
  return (row as JobImportRow | undefined) ?? null;
}

async function extendTaskResult(
  scope: WorkspaceScope,
  task: TaskRow,
  result: FetchJobResult,
  extension: JobImportResultExtension,
): Promise<void> {
  await scope
    .updateTable('tasks')
    .set({ result: JSON.stringify({ ...result, job_import: extension }), updated_at: new Date() })
    .where('id', '=', task.id)
    .execute();
}

/**
 * The user's `apply_url` hint fills a gap the fetch left; it never overrides
 * a URL the page itself stated.
 */
function withHints(job: NormalizedJob, input: JobImportInput): NormalizedJob {
  if (job.apply_url !== null || input.apply_url === null) return job;
  return { ...job, apply_url: input.apply_url };
}

export async function applyFetchJobResult(
  trx: DbTransaction,
  task: TaskRow,
  result: FetchJobResult,
): Promise<void> {
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  const row = await lockImportForTask(scope, task.id);
  if (row === null) return;
  const input = readImportInput(row);
  const warnings: FetchWarning[] = result.warnings.slice(0, 100);
  const now = new Date();

  if (result.job !== null) {
    const outcome = await upsertNormalizedJob(
      scope,
      withHints(result.job, input),
      { connector: input.url === null ? 'manual' : 'url', sourceId: null, boardKey: null },
      now,
    );
    await scope
      .updateTable('job_imports')
      .set({
        status: 'resolved',
        job_id: outcome.jobId,
        candidates: JSON.stringify([]),
        warnings: JSON.stringify(warnings),
        error_code: null,
        error_message: null,
        updated_at: now,
      })
      .where('id', '=', row.id)
      .execute();
    await extendTaskResult(scope, task, result, {
      id: row.id,
      status: 'resolved',
      job_id: outcome.jobId,
    });
    return;
  }

  const status: JobImportStatus = result.candidates.length > 0 ? 'needs_choice' : 'failed';
  const firstWarning = warnings[0];
  await scope
    .updateTable('job_imports')
    .set({
      status,
      job_id: null,
      candidates: JSON.stringify(result.candidates),
      warnings: JSON.stringify(warnings),
      error_code:
        status === 'failed' ? (firstWarning?.code ?? 'EXTRACTION_EMPTY').slice(0, 64) : null,
      error_message:
        status === 'failed'
          ? (firstWarning?.message ?? 'No job posting could be read from the input.').slice(0, 500)
          : null,
      updated_at: now,
    })
    .where('id', '=', row.id)
    .execute();
  await extendTaskResult(scope, task, result, { id: row.id, status, job_id: null });
}

/** Terminal task failure: the import is failed, not left at `queued`. */
export async function applyFetchJobFailure(
  trx: DbTransaction,
  task: TaskRow,
  code: string,
  message: string,
): Promise<void> {
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  await scope
    .updateTable('job_imports')
    .set({
      status: 'failed',
      error_code: code.slice(0, 64),
      error_message: message.slice(0, 500),
      updated_at: new Date(),
    })
    .where('task_id', '=', task.id)
    .where('status', '=', 'queued')
    .execute();
}
