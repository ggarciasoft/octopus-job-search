/**
 * POST /applications/:id/fill — hand an approved packet to a paired runner.
 *
 * This is the most consequential command in the product: after it, a browser
 * on the user's desktop types their answers into an employer's form. Every
 * check below is a case where proceeding would mean acting on something the
 * user did not approve, or acting twice.
 *
 *  * **Only from `approved`.** Not from `ready_for_review`, not from
 *    `preparing`. The state *is* the record that a person read this packet.
 *  * **Only the current packet, and only if it is still fresh.** Staleness is
 *    recomputed here rather than trusted from the last read: the profile may
 *    have moved in the seconds since the screen rendered.
 *  * **Never with an unanswered required question.** AT14 starts here, before
 *    a browser is even opened.
 *  * **One fill at a time.** A second request while one is queued or leased is
 *    a conflict, not a second browser (AT15).
 *  * **Within the day's budget.** `fill_attempts_per_day` is a real limit, and
 *    exceeding it is 429 rather than a silently dropped request.
 *  * **Only to the destination this packet binds.** The origins handed to the
 *    runner are the narrowest set that lets it do the job, and a device paired
 *    for other origins cannot be sent here at all.
 */
import {
  type AcceptedResponse,
  type FillApplicationRequest,
  type FillField,
  type FillLocalInput,
  type PacketAnswer,
} from '@job-getter/contracts';
import { conflict, notFound, quotaExceeded, staleRevision, unprocessable } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import type { ApplicationPacketRow, ResumeRow } from '../db/types.js';
import { enqueueTask } from '../tasks/enqueue.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { workspacePreferences } from '../discovery/scans.js';
import { requireJob } from '../matching/matches.js';
import { deviceStatus, requireDevice } from '../devices/service.js';
import {
  attachmentFileId,
  loadApplicationContexts,
  packetStaleness,
  reconcileApplications,
  requireApplication,
  transitionApplication,
  unresolvedQuestionKeys,
} from '../applications/service.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The origins the runner may visit.
 *
 * A device paired with declared origins may only be sent to one of them; a
 * device paired with none is sent exactly the destination's own origin and
 * nothing wider. Either way the runner receives the narrowest set that lets it
 * reach this packet's page, because "never navigate through unexpected
 * external origins" is only meaningful if the list is not a wildcard.
 */
export function resolveAllowedOrigins(
  declared: readonly string[],
  destinationOrigin: string,
): string[] {
  if (declared.length === 0) return [destinationOrigin];
  if (!declared.includes(destinationOrigin)) {
    throw unprocessable(
      `This device is not paired for ${destinationOrigin}, so it may not fill this page.`,
      { device_id: 'Pair a device for this origin, or apply in your own browser.' },
    );
  }
  return [destinationOrigin];
}

export const fillApplication: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };
  const body = request.body as FillApplicationRequest;
  readIdempotencyKey(request);

  const existing = await requireApplication(scope, id);
  if (existing.revision !== body.expected_revision) {
    throw staleRevision('This application changed since you read it.');
  }

  // Reconcile before anything else: a packet that went stale between the
  // screen rendering and this call must not be filled.
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
  // "Disable a second attempt until resolved" (07_APPLICATION_AUTOMATION.md).
  // An application whose outcome nobody could establish is the one case where
  // filling again could mean applying twice to the same job — the first
  // submission may well have gone through. Only the person can settle it, and
  // they settle it by recording the outcome, not by filling again. This is
  // called out separately from the general status check because the reason
  // matters and "this one is outcome_unknown" does not explain itself.
  if (application.status === 'outcome_unknown') {
    throw conflict(
      'Nobody could confirm whether this application went through, so it will not ' +
        'be filled again — a second attempt could be a second application. ' +
        'Record what happened first.',
    );
  }
  if (application.status !== 'approved') {
    throw conflict(
      `Only an approved application can be filled; this one is "${application.status}".`,
    );
  }
  if (application.current_packet_id !== body.packet_id) {
    throw conflict('That packet has been superseded by a newer revision.');
  }

  const packet = loaded.packet as ApplicationPacketRow | null;
  if (packet === null || packet.approved_at === null) {
    throw conflict('This packet has not been approved.');
  }
  const staleness = packetStaleness(packet, loaded.live!, new Date());
  if (staleness.length > 0) {
    throw conflict(`This packet is out of date (${staleness.join(', ')}) and must be rebuilt.`);
  }

  const answers = (packet.answers as PacketAnswer[] | null) ?? [];
  const unresolved = unresolvedQuestionKeys(answers);
  if (unresolved.length > 0) {
    throw conflict(`${unresolved.length} required question(s) still need an answer.`);
  }

  const device = await requireDevice(scope, body.device_id);
  if (device.kind !== 'local_runner') {
    throw unprocessable('Only a paired local runner can fill a form.', {
      device_id: `This device is a "${device.kind}".`,
    });
  }
  const status = deviceStatus(device);
  if (status !== 'paired') {
    throw unprocessable(`That device is ${status}, so it cannot be given work.`, {
      device_id: 'Pair the device again.',
    });
  }
  const allowedOrigins = resolveAllowedOrigins(
    (device.allowed_origins as string[] | null) ?? [],
    packet.destination_origin,
  );

  // AT15: one active fill per application. A second browser filling the same
  // employer's form is how one person submits twice.
  const active = await scope
    .selectFrom('tasks')
    .select(['id'])
    .where('type', '=', 'fill_local')
    .where('state', 'in', ['queued', 'leased'])
    .executeTakeFirst();
  if (active) {
    throw conflict('A fill is already in progress. Wait for it to finish or cancel it.');
  }

  const preferences = await workspacePreferences(scope);
  const limit = preferences.limits.fill_attempts_per_day;
  const spent = await scope
    .selectFrom('tasks')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('type', '=', 'fill_local')
    .where('created_at', '>', new Date(Date.now() - DAY_MS))
    .executeTakeFirst();
  if (Number(spent?.count ?? 0) >= limit) {
    throw quotaExceeded();
  }

  const job = await requireJob(scope, application.job_id);
  const resume = (await scope
    .selectFrom('resumes')
    .selectAll()
    .where('id', '=', packet.resume_id)
    .executeTakeFirst()) as ResumeRow | undefined;
  if (resume === undefined) throw conflict('The CV this packet references no longer exists.');
  const resumeFileId = attachmentFileId(resume);
  const resumeFile =
    resumeFileId === null
      ? null
      : ((await scope
          .selectFrom('files')
          .select(['id', 'original_name'])
          .where('id', '=', resumeFileId)
          .executeTakeFirst()) ?? null);

  // Only answered questions travel. An unanswered one has nothing to type and
  // its presence in the payload would invite a runner to improvise.
  const fields: FillField[] = answers
    .filter(
      (answer): answer is PacketAnswer & { answer: NonNullable<PacketAnswer['answer']> } =>
        answer.answer !== null,
    )
    .map((answer) => ({
      question_key: answer.question_key,
      label: answer.label,
      answer: answer.answer,
      required: answer.required,
      sensitivity: answer.sensitivity,
    }));

  const payload: FillLocalInput = {
    application_id: application.id,
    packet_id: packet.id,
    content_hash: packet.content_hash,
    device_id: device.id,
    destination: {
      url: packet.destination_url,
      origin: packet.destination_origin,
      connector: packet.connector,
      connector_version: packet.connector_version,
    },
    allowed_origins: allowedOrigins,
    job: { job_id: job.id, company: job.company, title: job.title },
    resume_file_id: resumeFile?.id ?? null,
    resume_sha256: packet.resume_sha256,
    resume_filename: resumeFile?.original_name ?? null,
    fields,
    known_form_fingerprint: packet.form_fingerprint,
    adapter: packet.connector,
  };

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /applications/:id/fill',
    async () => {
      const taskId = await context.db.transaction().execute(async (trx) => {
        const scoped = scope.withExecutor(trx);
        const enqueued = await enqueueTask(trx, {
          workspaceId: scope.workspaceId,
          type: 'fill_local',
          payload,
          // One attempt. A retry is a second attempt at a real application
          // against a page that may have changed; the server decides, and the
          // answer is no.
          maxAttempts: 1,
          // The CV is the only file the runner may download, and only through
          // the lease-scoped endpoint.
          inputFileIds: resumeFile === null ? [] : [resumeFile.id],
        });

        await transitionApplication(scoped, application, 'filling', {
          type: 'fill_requested',
          actor: 'user',
          data: {
            packet_id: packet.id,
            device_id: device.id,
            task_id: enqueued.id,
            field_count: fields.length,
            origin: packet.destination_origin,
          },
        });

        await recordAuditEvent(scoped, {
          action: 'application.fill_requested',
          actorId: principal.userId,
          objectId: application.id,
          objectType: 'application',
          metadata: {
            device_id: device.id,
            origin: packet.destination_origin,
            field_count: fields.length,
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
