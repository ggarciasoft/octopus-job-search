/**
 * POST /applications/:id/observe — ask a paired runner whether the employer's
 * page says the application went through.
 *
 * `07_APPLICATION_AUTOMATION.md`: _"After manual submission, an adapter may
 * observe a confirmation message/reference on the allowed page. [...] If
 * adapter cannot verify, ask the user to report outcome. Absence of evidence
 * is not failure or success. Disable a second attempt until resolved."_
 *
 * The order of events matters and is worth stating, because it is the opposite
 * of what an automation-shaped guess would assume. The runner fills the form
 * and stops. **The person clicks submit.** Only then is this route called, and
 * all it does is look. Nothing here submits anything, and there is no field in
 * the task that could ask for it.
 *
 * Three guards:
 *
 *  * **Only from `awaiting_user_submit`.** That state is the record that a
 *    runner filled this packet and stopped for the person. Observing from
 *    anywhere else would be watching a page nobody was sent to.
 *  * **One observation at a time**, and none while a fill is still running.
 *  * **Never from `outcome_unknown`.** "Disable a second attempt until
 *    resolved" — once we have said we cannot tell, the way out is the person
 *    saying what happened, not another look. This is the AT16 rule, and it is
 *    enforced here rather than left to the UI.
 */
import {
  DEFAULT_OBSERVE_TIMEOUT_SECONDS,
  MAX_OBSERVE_TIMEOUT_SECONDS,
  type AcceptedResponse,
  type ObserveApplicationRequest,
  type ObserveConfirmationInput,
} from '@job-getter/contracts';
import { conflict, notFound, staleRevision, unprocessable } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import type { ApplicationPacketRow } from '../db/types.js';
import { enqueueTask } from '../tasks/enqueue.js';
import { sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { workspacePreferences } from '../discovery/scans.js';
import { deviceStatus, requireDevice } from '../devices/service.js';
import {
  loadApplicationContexts,
  reconcileApplications,
  requireApplication,
  transitionApplication,
} from '../applications/service.js';
import { resolveAllowedOrigins } from './fill.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const observeApplication: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };
  const body = request.body as ObserveApplicationRequest;

  const existing = await requireApplication(scope, id);
  // Reconcile first, as the fill route does: an approval may have expired in
  // the seconds since the screen rendered, and the status this route branches
  // on must be the current one.
  const [loaded] = await reconcileApplications(
    context.db,
    scope,
    await loadApplicationContexts(scope, [existing], new Date()),
  );
  if (loaded === undefined) throw notFound('No such application.');
  const application = loaded.application;

  if (application.revision !== body.expected_revision) {
    throw staleRevision('This application changed since you read it.');
  }

  if (application.status === 'outcome_unknown') {
    throw conflict(
      'This application is already waiting for you to say what happened. ' +
        'Looking again will not settle it — record the outcome instead.',
    );
  }
  if (application.status !== 'awaiting_user_submit') {
    throw conflict(
      `An observation only makes sense once a runner has filled the form and ` +
        `stopped for you. This application is "${application.status}".`,
    );
  }

  if (application.current_packet_id !== body.packet_id) {
    throw conflict('That packet has been superseded by a newer revision.');
  }
  const packet = loaded.packet as ApplicationPacketRow | null;
  if (packet === null) {
    throw conflict('This application has no packet to observe.');
  }

  const device = await requireDevice(scope, body.device_id);
  if (device.kind !== 'local_runner') {
    throw unprocessable('Only a paired local runner can observe a page.', {
      device_id: `This device is a "${device.kind}".`,
    });
  }
  const status = deviceStatus(device);
  if (status !== 'paired') {
    throw unprocessable(`That device is ${status}, so it cannot be given work.`, {
      device_id: 'Pair the device again.',
    });
  }

  // Neither a fill nor another observation may be in flight. Two browsers on
  // one employer's page is the shape of a double submission even when neither
  // of them is allowed to submit.
  const active = await scope
    .selectFrom('tasks')
    .select(['id', 'type'])
    .where('type', 'in', ['fill_local', 'observe_confirmation'])
    .where('state', 'in', ['queued', 'leased'])
    .executeTakeFirst();
  if (active) {
    throw conflict(
      active.type === 'fill_local'
        ? 'A fill is still running. Wait for it to finish before observing.'
        : 'An observation is already in progress.',
    );
  }

  const preferences = await workspacePreferences(scope);
  const timeoutSeconds = Math.min(
    body.timeout_seconds ?? DEFAULT_OBSERVE_TIMEOUT_SECONDS,
    MAX_OBSERVE_TIMEOUT_SECONDS,
  );

  const payload: ObserveConfirmationInput = {
    application_id: application.id,
    packet_id: packet.id,
    device_id: device.id,
    destination: {
      url: packet.destination_url,
      origin: packet.destination_origin,
      connector: packet.connector,
      connector_version: packet.connector_version,
    },
    allowed_origins: resolveAllowedOrigins(
      (device.allowed_origins as string[] | null) ?? [],
      packet.destination_origin,
    ),
    timeout_seconds: timeoutSeconds,
    adapter: packet.connector,
    // Opt-in, and off by default. A screenshot of a confirmation page carries
    // the applicant's own details back into storage.
    capture_evidence: preferences.limits.consented_evidence_capture,
  };

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /applications/:id/observe',
    async () => {
      const taskId = await context.db.transaction().execute(async (trx) => {
        const scoped = scope.withExecutor(trx);
        const enqueued = await enqueueTask(trx, {
          workspaceId: scope.workspaceId,
          type: 'observe_confirmation',
          payload,
          // One attempt, like the fill. A retry would be a second chance to
          // guess at an outcome the first attempt correctly declined to guess.
          maxAttempts: 1,
        });

        // The application does not change state yet: it is still waiting for
        // the person, and will be until the runner reports. Recording the
        // request as an event keeps the history complete without asserting
        // anything about the outcome.
        await transitionApplication(scoped, application, 'awaiting_user_submit', {
          type: 'note',
          actor: 'user',
          reason: 'observation_requested',
          data: {
            packet_id: packet.id,
            device_id: device.id,
            task_id: enqueued.id,
            timeout_seconds: timeoutSeconds,
          },
        });

        await recordAuditEvent(scoped, {
          action: 'application.observation_requested',
          actorId: principal.userId,
          objectId: application.id,
          objectType: 'application',
          metadata: {
            device_id: device.id,
            origin: packet.destination_origin,
            timeout_seconds: timeoutSeconds,
          },
        });

        return enqueued.id;
      });

      return {
        status: 202,
        body: { task_id: taskId, status: 'queued' } satisfies AcceptedResponse,
      };
    },
  );

  return sendOutcome(reply, outcome);
};
