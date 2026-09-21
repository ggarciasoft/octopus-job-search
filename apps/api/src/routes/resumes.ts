/**
 * POST /resumes, GET /resumes/:id, POST /resumes/:id/approve.
 *
 * Original mode completes synchronously: there is nothing to generate, because
 * the whole point is that the user's own file is sent unchanged. It still
 * answers 202 with a task id of null in the resume row, so the client follows
 * one shape for both modes rather than branching on which kind of CV it asked
 * for.
 *
 * Tailored mode queues `render_cv` and the resume stays `queued` until the
 * worker reports back. Nothing here writes a document, and nothing here
 * approves one.
 */
import {
  type AcceptedResponse,
  type ApproveResumeRequest,
  type CreateResumeRequest,
  type Locale,
  type RenderCvInput,
  type ResumeView,
} from '@job-getter/contracts';
import { conflict, notFound, unprocessable } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import type { JobRow } from '../db/types.js';
import { enqueueTask } from '../tasks/enqueue.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { workspacePreferences } from '../discovery/scans.js';
import {
  assertModeShape,
  buildRenderInput,
  readResumeContext,
  requireResume,
  resolvePageTarget,
  toResumeView,
} from '../resumes/service.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const createResume: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const body = request.body as CreateResumeRequest;
  const idempotencyKey = readIdempotencyKey(request);

  assertModeShape(body);

  const preferences = await workspacePreferences(scope);
  const resumeContext = await readResumeContext(scope, preferences);
  const language: Locale = body.language ?? preferences.cv_language ?? resumeContext.locale;
  const pageTarget = resolvePageTarget(body.page_target);

  let job: JobRow | null = null;
  if (body.job_id !== undefined) {
    const row = await scope
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', body.job_id)
      .executeTakeFirst();
    if (!row) throw notFound('No such job.');
    job = row as JobRow;
  }

  if (body.mode === 'original' && body.input_file_id !== undefined) {
    const file = await scope
      .selectFrom('files')
      .select(['id', 'state', 'purpose'])
      .where('id', '=', body.input_file_id)
      .executeTakeFirst();
    if (!file) throw notFound('No such file.');
    if (file.state !== 'ready') {
      throw unprocessable('That upload is not ready to send yet.', {
        input_file_id: 'The file is still being processed.',
      });
    }
  }

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /resumes',
    async () => {
      const created = await context.db.transaction().execute(async (trx) => {
        const scoped = scope.withExecutor(trx);

        const row = await scoped
          .insertInto('resumes', {
            mode: body.mode,
            // Original mode has nothing to generate, so it is ready at once.
            status: body.mode === 'original' ? 'ready' : 'queued',
            job_id: job?.id ?? null,
            job_revision: job?.revision ?? null,
            profile_revision: resumeContext.profileRevision,
            language,
            template_id: body.template_id ?? 'simple',
            page_target: pageTarget,
            document_json: null,
            validation: null,
            input_file_id: body.input_file_id ?? null,
            pdf_file_id: null,
            docx_file_id: null,
            task_id: null,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();

        let taskId: string | null = null;
        if (body.mode === 'tailored') {
          const payload: RenderCvInput = buildRenderInput(row.id, resumeContext, {
            language,
            pageTarget,
            job,
          });
          const enqueued = await enqueueTask(trx, {
            workspaceId: scope.workspaceId,
            type: 'render_cv',
            payload,
            idempotencyKey,
          });
          taskId = enqueued.id;
          await scoped
            .updateTable('resumes')
            .set({ task_id: taskId, updated_at: new Date() })
            .where('id', '=', row.id)
            .execute();
        }

        await recordAuditEvent(scoped, {
          action: 'resume.created',
          actorId: principal.userId,
          objectId: row.id,
          objectType: 'resume',
          // Counts and shapes only: no bullet text, no employer, no name.
          metadata: {
            mode: body.mode,
            language,
            job_id: job?.id ?? null,
            confirmed_fact_count: resumeContext.confirmedFacts.length,
          },
        });

        return { id: row.id, taskId };
      });

      return {
        status: 202,
        body: {
          // Original mode has no task; the resume id is what the client follows.
          task_id: created.taskId ?? created.id,
          status: 'queued',
        } satisfies AcceptedResponse,
      };
    },
  );

  return sendOutcome(reply, outcome);
};

export const getResume: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };

  const row = await scope.selectFrom('resumes').selectAll().where('id', '=', id).executeTakeFirst();
  if (row) return reply.status(200).send(toResumeView(row as never));

  // The client may hold a `render_cv` task id, exactly as the job importer and
  // the profile importer allow.
  const viaTask = await scope
    .selectFrom('resumes')
    .selectAll()
    .where('task_id', '=', id)
    .executeTakeFirst();
  if (viaTask) return reply.status(200).send(toResumeView(viaTask as never));

  throw notFound('No such resume.');
};

/**
 * Record the user's approval.
 *
 * Only a `ready` resume can be approved, and approving one that failed or is
 * still generating is a conflict rather than a no-op: the user is telling us
 * they read something, and there is nothing there to have read.
 */
export const approveResume: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };
  const body = request.body as ApproveResumeRequest;

  const existing = await requireResume(scope, id);
  if (existing.status !== 'ready') {
    throw conflict('This CV is not ready, so there is nothing to approve yet.');
  }

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    await scoped
      .updateTable('resumes')
      .set({
        approved_at: body.approved ? new Date() : null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    await recordAuditEvent(scoped, {
      action: body.approved ? 'resume.approved' : 'resume.approval_withdrawn',
      actorId: principal.userId,
      objectId: id,
      objectType: 'resume',
      metadata: { mode: existing.mode },
    });

    return scoped.selectFrom('resumes').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  return reply.status(200).send(toResumeView(updated as never) satisfies ResumeView);
};
