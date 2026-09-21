/**
 * POST /workspace/export.
 *
 * The archive is built here rather than queued to the Python worker. Export is
 * SQL plus stored files, both of which belong to the API
 * (02_ARCHITECTURE.md); the worker has neither, and handing it the whole
 * workspace as a task payload so it could hand it straight back would add a
 * round trip, a size limit and a failure mode without adding any work.
 *
 * The task row is still real and is still what the client follows, so the
 * response shape matches every other long-running command. It is written in
 * the state the work actually reached — `succeeded` with its result, or
 * `failed` with its code — so `GET /tasks/:id` is telling the truth about
 * something that happened rather than describing a worker that never existed.
 */
import {
  type AcceptedResponse,
  type ExportWorkspaceResult,
  type WorkspaceMode,
} from '@job-getter/contracts';
import { internalError, payloadTooLarge } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { storeFile } from '../files/service.js';
import { buildWorkspaceExport, toExportResult } from '../workspace/export.js';
import { ZipTooLargeError } from '../workspace/zip.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const exportWorkspace: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  readIdempotencyKey(request);

  const workspace = await scope
    .unscoped()
    .selectFrom('workspaces')
    .select(['id', 'mode', 'locale'])
    .where('id', '=', scope.workspaceId)
    .executeTakeFirstOrThrow();

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /workspace/export',
    async () => {
      const now = new Date();
      let built;
      try {
        built = await buildWorkspaceExport(
          scope,
          context.storage,
          {
            id: workspace.id,
            mode: workspace.mode as WorkspaceMode,
            locale: workspace.locale,
          },
          now,
        );
      } catch (error) {
        if (error instanceof ZipTooLargeError) {
          // Refused before anything is written. An archive this size is a
          // hosting problem rather than a user error, and pretending to
          // produce a truncated one would be worse than saying no.
          throw payloadTooLarge(error.message);
        }
        throw internalError({ reason: 'export_failed' });
      }

      const result = await context.db.transaction().execute(async (trx) => {
        const scoped = scope.withExecutor(trx);

        const stored = await storeFile(
          scoped,
          context.storage,
          built.archive,
          {
            mime: 'application/zip',
            bytes: built.archive.length,
            sha256: built.sha256,
            validation: {
              signature_ok: true,
              extension_matches_signature: true,
              encrypted: false,
              malware_scan: 'skipped_not_configured',
              warnings: [],
            },
          },
          {
            originalName: `job-getter-export-${now.toISOString().slice(0, 10)}.zip`,
            purpose: 'export',
            state: 'ready',
          },
        );

        const payload = toExportResult(built, stored.id);
        const task = await scoped
          .insertInto('tasks', {
            type: 'export_workspace',
            // Written in the state the work reached. It succeeded before this
            // row existed, which is why there is no lease and no attempt loop.
            state: 'succeeded',
            capability: 'export_workspace',
            payload: JSON.stringify({}),
            result: JSON.stringify(payload),
            attempt: 1,
            max_attempts: 1,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();

        await recordAuditEvent(scoped, {
          action: 'workspace.exported',
          actorId: principal.userId,
          objectId: stored.id,
          objectType: 'file',
          // Counts and sizes. Never a filename from the archive, never a row.
          metadata: {
            bytes: built.archive.length,
            file_count: built.manifest.files.length,
            excluded: built.manifest.excluded.length,
          },
        });

        return { taskId: task.id, payload };
      });

      return {
        status: 202,
        body: { task_id: result.taskId, status: 'queued' } satisfies AcceptedResponse,
      };
    },
  );

  return sendOutcome(reply, outcome);
};

/** Re-exported for the tests, which assert the shape the task result carries. */
export type { ExportWorkspaceResult };
