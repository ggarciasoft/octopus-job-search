/**
 * The `resumes` domain: register an original file, queue a generation, store
 * what came back, record an approval.
 *
 * Three decisions, each one a place where the convenient behaviour would have
 * been the dishonest one.
 *
 * **Original mode copies nothing.** The user's uploaded file is referenced,
 * not converted, not re-rendered and not tailored. Downloading it returns the
 * bytes they uploaded, which is what makes the SHA-256 identity in AT11 true
 * rather than approximately true.
 *
 * **Every generation is a new row.** Regenerating never mutates a resume the
 * user may already have read and approved. An approval therefore always refers
 * to content that still exists exactly as approved, and changing the profile,
 * the job or the template simply produces a different resume.
 *
 * **Approval is only ever a user action.** Nothing in the task path sets
 * `approved_at`; the worker cannot, and neither can a successful render. The
 * spec makes user review mandatory, so the column moves in exactly one place:
 * the approve route, called by a person.
 */
import {
  RESUME_PAGE_TARGET,
  type Locale,
  type JobRequirement,
  type Preferences,
  type ProfileFact,
  type RenderCvInput,
  type RenderCvResult,
  type ResumeDocument,
  type ResumeValidation,
  type ResumeView,
} from '@job-getter/contracts';
import type { DbTransaction } from '../db/pool.js';
import type { JobRow, ResumeRow, TaskRow } from '../db/types.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { notFound, unprocessable } from '../errors.js';

export function toResumeView(row: ResumeRow): ResumeView {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    job_id: row.job_id,
    job_revision: row.job_revision,
    profile_revision: row.profile_revision,
    language: row.language,
    template_id: row.template_id,
    document: (row.document_json as ResumeDocument | null) ?? null,
    validation: (row.validation as ResumeValidation | null) ?? null,
    input_file_id: row.input_file_id,
    pdf_file_id: row.pdf_file_id,
    docx_file_id: row.docx_file_id,
    approved_at: row.approved_at === null ? null : row.approved_at.toISOString(),
    error_code: row.error_code,
    error_message: row.error_message,
    task_id: row.task_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function requireResume(scope: WorkspaceScope, id: string): Promise<ResumeRow> {
  const row = await scope.selectFrom('resumes').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('No such resume.');
  return row as ResumeRow;
}

/**
 * Validate the mode against what was supplied.
 *
 * The two modes are genuinely different products, so a request that mixes them
 * is rejected rather than resolved by precedence. Guessing which one the user
 * meant is how somebody ends up sending a generated CV when they asked to send
 * their own file.
 */
export function assertModeShape(body: {
  mode: 'original' | 'tailored';
  input_file_id?: string;
  job_id?: string;
}): void {
  if (body.mode === 'original') {
    if (body.input_file_id === undefined) {
      throw unprocessable('Original mode needs the file to send, so input_file_id is required.', {
        input_file_id: 'Required when mode is "original".',
      });
    }
    return;
  }
  if (body.input_file_id !== undefined) {
    throw unprocessable('Tailored mode generates the document, so input_file_id is not accepted.', {
      input_file_id: 'Only valid when mode is "original".',
    });
  }
}

export interface ResumeContext {
  readonly profileRevision: number;
  readonly locale: Locale;
  readonly confirmedFacts: ProfileFact[];
  readonly preferences: Preferences;
}

function toProfileFact(row: Record<string, unknown>): ProfileFact {
  return {
    id: row.id as string,
    kind: row.kind as ProfileFact['kind'],
    value: row.value,
    source_file_id: (row.source_file_id as string | null) ?? null,
    source_excerpt: (row.source_excerpt as string | null) ?? null,
    confirmed: row.confirmed as boolean,
    revision: row.revision as number,
    supersedes_id: (row.supersedes_id as string | null) ?? null,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
  };
}

export async function readResumeContext(
  scope: WorkspaceScope,
  preferences: Preferences,
): Promise<ResumeContext> {
  const [profile, factRows] = await Promise.all([
    scope.selectFrom('profiles').select(['revision', 'locale']).executeTakeFirst(),
    scope
      .selectFrom('profile_facts')
      .selectAll()
      .where('confirmed', '=', true)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute(),
  ]);

  return {
    profileRevision: profile?.revision ?? 1,
    locale: (profile?.locale as Locale | undefined) ?? 'en',
    confirmedFacts: factRows.map((row) => toProfileFact(row as Record<string, unknown>)),
    preferences,
  };
}

export function buildRenderInput(
  resumeId: string,
  context: ResumeContext,
  options: {
    readonly language: Locale;
    readonly pageTarget: number;
    readonly job: JobRow | null;
  },
): RenderCvInput {
  return {
    resume_id: resumeId,
    profile_revision: context.profileRevision,
    language: options.language,
    template_id: 'simple',
    page_target: options.pageTarget,
    confirmed_facts: context.confirmedFacts,
    job:
      options.job === null
        ? null
        : {
            job_id: options.job.id,
            job_revision: options.job.revision,
            company: options.job.company,
            title: options.job.title,
            requirements: (options.job.requirements as JobRequirement[] | null) ?? [],
          },
    prompt_style_suffix: context.preferences.prompt_style_suffix,
  };
}

/**
 * Refuse a tailored CV with no name to put on it.
 *
 * The worker guards this too, but failing here is what the user actually
 * needs: an immediate, actionable 422 naming the missing fact, rather than a
 * queued task that comes back failed a few seconds later. The worker keeps its
 * own guard because it may not assume the API validated anything.
 */
export function assertContactFact(context: ResumeContext): void {
  const hasContact = context.confirmedFacts.some(
    (fact) => fact.kind === 'contact' && fact.confirmed,
  );
  if (!hasContact) {
    throw unprocessable('A generated CV needs a name, and no confirmed contact fact exists yet.', {
      profile: 'Confirm your contact details on the profile screen first.',
    });
  }
}

export function resolvePageTarget(requested: number | undefined): number {
  return requested ?? RESUME_PAGE_TARGET.default;
}

/**
 * Store a completed `render_cv` result.
 *
 * The document and its validation land together: a document without the
 * findings that qualify it is exactly the unreviewable artefact this feature
 * exists to avoid.
 */
export async function applyRenderCvResult(
  trx: DbTransaction,
  task: TaskRow,
  result: RenderCvResult,
): Promise<void> {
  const input = task.payload as RenderCvInput;
  await trx
    .updateTable('resumes')
    .set({
      status: 'ready',
      document_json: JSON.stringify(result.document_json),
      validation: JSON.stringify(result.validation),
      pdf_file_id: result.pdf_file_id,
      docx_file_id: result.docx_file_id,
      error_code: null,
      error_message: null,
      updated_at: new Date(),
    })
    .where('id', '=', input.resume_id)
    .where('workspace_id', '=', task.workspace_id)
    .execute();
}

/**
 * A failed generation leaves a visible failed resume rather than nothing.
 *
 * The alternative — deleting the row — would leave a user who pressed
 * "Generate" looking at a screen where nothing happened and no error is
 * recorded anywhere they can see.
 */
export async function applyRenderCvFailure(
  trx: DbTransaction,
  task: TaskRow,
  code: string,
  message: string,
): Promise<void> {
  const input = task.payload as RenderCvInput;
  await trx
    .updateTable('resumes')
    .set({
      status: 'failed',
      error_code: code.slice(0, 60),
      error_message: message.slice(0, 600),
      updated_at: new Date(),
    })
    .where('id', '=', input.resume_id)
    .where('workspace_id', '=', task.workspace_id)
    .execute();
}
