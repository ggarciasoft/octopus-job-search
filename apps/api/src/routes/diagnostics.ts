/**
 * POST /api/v1/diagnostics/echo — the M0 end-to-end probe.
 *
 * 12_IMPLEMENTATION_PLAN.md M0 exit criterion: "Deliver web → API → queued
 * task → Python → stored result → UI." This route is the first link: it
 * enqueues the contract's `noop_echo` task in the same transaction as the
 * audit row that records it, exactly like a real domain command would.
 */
import type { AcceptedResponse, NoopEchoInput } from '@job-getter/contracts';
import { conflict } from '../errors.js';
import { enqueueTask } from '../tasks/enqueue.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const createDiagnosticTask: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as NoopEchoInput;
  const idempotencyKey = readIdempotencyKey(request);

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /diagnostics/echo',
    async () => {
      try {
        const task = await context.db.transaction().execute(async (trx) => {
          // Domain mutation and task row in one transaction
          // (02_ARCHITECTURE.md step 2). For the probe the "domain mutation"
          // is the audit record; the pattern is what matters.
          const enqueued = await enqueueTask(trx, {
            workspaceId: scope.workspaceId,
            type: 'noop_echo',
            payload: body,
            idempotencyKey,
          });

          await trx
            .insertInto('audit_events')
            .values({
              workspace_id: scope.workspaceId,
              actor_id: principal.userId,
              action: 'diagnostics.echo_queued',
              object_id: enqueued.id,
              object_type: 'task',
              // Redacted metadata: the echoed message itself is user content
              // and is not copied into the audit trail.
              metadata: JSON.stringify({ message_length: body.message.length }),
            })
            .execute();

          return enqueued;
        });

        return {
          status: 202,
          body: { task_id: task.id, status: 'queued' } satisfies AcceptedResponse,
        };
      } catch (error) {
        // The unique index on (workspace_id, type, idempotency_key) is what
        // keeps a retry safe once the 24-hour replay record has expired.
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === '23505'
        ) {
          throw conflict('A task with this Idempotency-Key already exists for this workspace.');
        }
        throw error;
      }
    },
  );

  return sendOutcome(reply, outcome);
};
