/**
 * POST /applications, GET /applications, GET /applications/:id,
 * POST /applications/:id/packets, POST /applications/:id/approve,
 * POST /applications/:id/outcome, GET /applications/:id/events.
 *
 * What these routes will not do, and why:
 *
 *  * **They never approve anything on the user's behalf.** `approved_at` moves
 *    in exactly one place, the approve route, and only when the caller quotes
 *    the content hash they read back to us.
 *  * **They never claim verification the system did not perform.** A browser
 *    session may report `user_report` or `none`; only a paired runner can
 *    record `adapter_observed`, because only it ever sees a confirmation page.
 *    The tracker's "Submitted — verified" and "Submitted — reported by you"
 *    are different sentences and must stay different.
 *  * **They never answer a question.** The packet routes validate provenance
 *    and refuse anything the user did not enter or confirm; a required
 *    question left blank puts the application in `needs_input` and keeps it
 *    there.
 *
 * Packet creation answers 202 with the packet id in `task_id`, the same shape
 * `POST /resumes` uses for original mode. No task is enqueued: a packet is a
 * snapshot of rows this process already holds, and routing it through the
 * queue would add a failure mode without adding any work. The client follows
 * one shape for every command either way.
 */
import {
  APPLICATION_OUTCOME_STATUS,
  SUBMITTED_APPLICATION_STATUSES,
  type AcceptedResponse,
  type ApplicationOutcomeRequest,
  type ApplicationStatus,
  type ApplicationView,
  type ApproveApplicationRequest,
  type CreateApplicationRequest,
  type CreatePacketRequest,
  type EvidenceType,
  type PacketAnswer,
  type ResumeValidation,
  type SubmissionEvidence,
} from '@job-getter/contracts';
import { conflict, notFound, staleRevision, unprocessable } from '../errors.js';
import { recordAuditEvent, type WorkspaceScope } from '../auth/scope.js';
import type { ApplicationPacketRow, ApplicationRow, JobRow, ResumeRow } from '../db/types.js';
import { readIdempotencyKey, sendOutcome, withIdempotency } from '../tasks/idempotency.js';
import { workspacePreferences } from '../discovery/scans.js';
import { possibleDuplicatesFor } from '../discovery/jobs.js';
import { requireJob } from '../matching/matches.js';
import { assertPacketAnswers } from '../applications/answers.js';
import {
  appendApplicationEvent,
  approvalExpiry,
  attachmentSha256,
  buildPacketHashMaterial,
  computeContentHash,
  loadApplicationContexts,
  packetStaleness,
  reconcileApplications,
  requireApplication,
  resolveDestination,
  toApplicationEventView,
  toApplicationView,
  transitionApplication,
  unresolvedQuestionKeys,
  type ApplicationContext,
} from '../applications/service.js';
import { requireScope, requireSession, type RouteContext, type RouteHandler } from './context.js';
import { decodeCursor, encodeCursor } from './tasks.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------------
// Shared reading
// ---------------------------------------------------------------------------

/**
 * Other applications for jobs this one may duplicate.
 *
 * The definition of "may duplicate" is the discovery layer's own, reused
 * rather than re-stated: same employer and title at an overlapping location.
 * It is reported and never acted on — "Similar title/location alone creates a
 * possible-duplicate warning, not an automatic merge" — but before filling,
 * "check all linked identities" means the user has to be able to see it.
 */
async function duplicateApplicationIds(
  scope: WorkspaceScope,
  contexts: readonly ApplicationContext[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (contexts.length === 0) return result;

  const duplicates = await possibleDuplicatesFor(
    scope,
    contexts.map((context) => context.job),
  );
  const duplicateJobIds = [
    ...new Set([...duplicates.values()].flat().map((duplicate) => duplicate.job_id)),
  ];
  if (duplicateJobIds.length === 0) return result;

  const rows = await scope
    .selectFrom('applications')
    .select(['id', 'job_id'])
    .where('job_id', 'in', duplicateJobIds)
    .execute();
  const applicationsByJob = new Map<string, string[]>();
  for (const row of rows) {
    applicationsByJob.set(row.job_id, [...(applicationsByJob.get(row.job_id) ?? []), row.id]);
  }

  for (const context of contexts) {
    const ids = (duplicates.get(context.job.id) ?? [])
      .flatMap((duplicate) => applicationsByJob.get(duplicate.job_id) ?? [])
      .filter((id) => id !== context.application.id);
    if (ids.length > 0) result.set(context.application.id, [...new Set(ids)].slice(0, 20));
  }
  return result;
}

/** Load, reconcile and render one page of applications. */
async function renderApplications(
  context: RouteContext,
  scope: WorkspaceScope,
  rows: readonly ApplicationRow[],
): Promise<ApplicationView[]> {
  const loaded = await loadApplicationContexts(scope, rows, new Date());
  const reconciled = await reconcileApplications(context.db, scope, loaded);
  const duplicates = await duplicateApplicationIds(scope, reconciled);
  return reconciled.map((entry) =>
    toApplicationView(entry, duplicates.get(entry.application.id) ?? []),
  );
}

async function renderApplication(
  context: RouteContext,
  scope: WorkspaceScope,
  row: ApplicationRow,
): Promise<ApplicationView> {
  const [view] = await renderApplications(context, scope, [row]);
  // The job row is guaranteed by the composite foreign key, so a missing view
  // would mean the cascade failed rather than that the user asked for nothing.
  if (view === undefined) throw notFound('No such application.');
  return view;
}

// ---------------------------------------------------------------------------
// POST /applications
// ---------------------------------------------------------------------------

/**
 * Start tracking an application, or hand back the one that already exists.
 *
 * Creation is idempotent on the job because the database says so: the UNIQUE
 * (workspace_id, job_id) constraint resolves two simultaneous creates into one
 * application rather than two half-tracked ones.
 */
export const createApplication: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const body = request.body as CreateApplicationRequest;

  const job = await requireJob(scope, body.job_id);

  const row = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const inserted = await scoped
      .insertInto('applications', { job_id: job.id, status: 'draft' })
      .onConflict((builder) => builder.columns(['workspace_id', 'job_id']).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted === undefined) {
      return (await scoped
        .selectFrom('applications')
        .selectAll()
        .where('job_id', '=', job.id)
        .executeTakeFirstOrThrow()) as ApplicationRow;
    }

    await appendApplicationEvent(scoped, inserted.id, {
      type: 'created',
      actor: 'user',
      statusAfter: 'draft',
      data: { job_id: job.id },
    });
    await recordAuditEvent(scoped, {
      action: 'application.created',
      actorId: principal.userId,
      objectId: inserted.id,
      objectType: 'application',
      metadata: { job_id: job.id },
    });
    return inserted as ApplicationRow;
  });

  return reply.status(200).send(await renderApplication(context, scope, row));
};

// ---------------------------------------------------------------------------
// GET /applications and GET /applications/:id
// ---------------------------------------------------------------------------

export const listApplications: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const query = request.query as {
    status?: ApplicationStatus;
    job_id?: string;
    cursor?: string;
    limit?: number;
  };
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  let builder = scope
    .selectFrom('applications')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1);

  if (query.status !== undefined) builder = builder.where('status', '=', query.status);
  if (query.job_id !== undefined) builder = builder.where('job_id', '=', query.job_id);
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    // An unreadable cursor yields the first page rather than an error.
    if (cursor) {
      builder = builder.where((eb) =>
        eb.or([
          eb('created_at', '<', new Date(cursor.createdAt)),
          eb.and([eb('created_at', '=', new Date(cursor.createdAt)), eb('id', '<', cursor.id)]),
        ]),
      );
    }
  }

  const rows = (await builder.execute()) as ApplicationRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
      : null;

  return reply.status(200).send({
    items: await renderApplications(context, scope, page),
    next_cursor: nextCursor,
  });
};

export const getApplication: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const row = await requireApplication(scope, id);
  return reply.status(200).send(await renderApplication(context, scope, row));
};

// ---------------------------------------------------------------------------
// POST /applications/:id/packets
// ---------------------------------------------------------------------------

/** A CV that failed validation is not a CV this route will let anyone approve. */
function assertResumeUsable(resume: ResumeRow, job: JobRow): void {
  if (resume.status !== 'ready') {
    throw unprocessable('That CV is not finished yet, so there is nothing to send.', {
      resume_id: `The CV is "${resume.status}".`,
    });
  }
  if (resume.job_id !== null && resume.job_id !== job.id) {
    throw unprocessable('That CV was tailored for a different job.', {
      resume_id: 'Generate a CV for this job, or use an original-mode CV.',
    });
  }
  const validation = resume.validation as ResumeValidation | null;
  const blocking = (validation?.findings ?? []).filter(
    (finding) => finding.severity === 'blocking',
  );
  if (blocking.length > 0) {
    throw unprocessable('That CV still has blocking validation findings.', {
      resume_id: `${blocking.length} finding(s) must be resolved before it can be sent.`,
    });
  }
}

export const createApplicationPacket: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };
  const body = request.body as CreatePacketRequest;
  readIdempotencyKey(request);

  const application = await requireApplication(scope, id);
  if (application.revision !== body.expected_revision) {
    throw staleRevision('This application changed since you read it.');
  }
  if ((SUBMITTED_APPLICATION_STATUSES as readonly string[]).includes(application.status)) {
    throw conflict('This application has already been submitted.');
  }
  if (application.status === 'cancelled') {
    throw conflict('This application was cancelled.');
  }

  const job = await requireJob(scope, application.job_id);
  const resume = (await scope
    .selectFrom('resumes')
    .selectAll()
    .where('id', '=', body.resume_id)
    .executeTakeFirst()) as ResumeRow | undefined;
  if (resume === undefined) throw notFound('No such CV.');
  assertResumeUsable(resume, job);

  await assertPacketAnswers(scope, job, body.answers);

  const destination = await resolveDestination(scope, job.id);
  const resumeSha = await attachmentSha256(scope, resume);
  if (resumeSha === null) {
    throw unprocessable('That CV has no file to attach yet.', {
      resume_id: 'Wait for the document to finish rendering.',
    });
  }

  const profile = await scope.selectFrom('profiles').select(['revision']).executeTakeFirst();
  const profileRevision = profile?.revision ?? 1;

  const answers = body.answers as PacketAnswer[];
  const contentHash = computeContentHash(
    buildPacketHashMaterial({
      profileRevision,
      jobId: job.id,
      jobRevision: job.revision,
      resumeId: resume.id,
      resumeSha256: resumeSha,
      destination,
      formFingerprint: body.form_fingerprint ?? null,
      answers,
    }),
  );

  const unresolved = unresolvedQuestionKeys(answers);
  const target: ApplicationStatus = unresolved.length > 0 ? 'needs_input' : 'ready_for_review';

  const outcome = await withIdempotency<AcceptedResponse>(
    context.db,
    scope,
    request,
    'POST /applications/:id/packets',
    async () => {
      const packetId = await context.db.transaction().execute(async (trx) => {
        const scoped = scope.withExecutor(trx);

        const previous = await scoped
          .selectFrom('application_packets')
          .select(['revision'])
          .where('application_id', '=', application.id)
          .orderBy('revision', 'desc')
          .limit(1)
          .executeTakeFirst();

        const packet = await scoped
          .insertInto('application_packets', {
            application_id: application.id,
            revision: (previous?.revision ?? 0) + 1,
            profile_revision: profileRevision,
            job_revision: job.revision,
            resume_id: resume.id,
            resume_sha256: resumeSha,
            destination_url: destination.url,
            destination_origin: destination.origin,
            connector: destination.connector,
            connector_version: destination.connector_version,
            answers: JSON.stringify(answers),
            form_fingerprint: body.form_fingerprint ?? null,
            content_hash: contentHash,
          })
          .returning(['id', 'revision'])
          .executeTakeFirstOrThrow();

        // `preparing` is where an application is while its packet is being
        // assembled. It is real, it is just brief, so it is recorded as part
        // of the path rather than skipped.
        await transitionApplication(
          scoped,
          application,
          application.status === 'preparing' ? [target] : ['preparing', target],
          {
            type: 'packet_created',
            actor: 'user',
            reason: unresolved.length > 0 ? 'unanswered_required_questions' : null,
            // Counts and keys only: an answer's text never enters the log.
            data: {
              packet_id: packet.id,
              packet_revision: packet.revision,
              answer_count: answers.length,
              unresolved_question_keys: unresolved,
              resume_id: resume.id,
            },
          },
          { currentPacketId: packet.id },
        );

        await recordAuditEvent(scoped, {
          action: 'application.packet_created',
          actorId: principal.userId,
          objectId: packet.id,
          objectType: 'application_packet',
          metadata: {
            application_id: application.id,
            revision: packet.revision,
            answer_count: answers.length,
            unresolved_count: unresolved.length,
          },
        });

        return packet.id;
      });

      return {
        status: 202,
        // No task exists; the packet id is what the client follows, exactly as
        // `POST /resumes` does for original mode.
        body: { task_id: packetId, status: 'queued' } satisfies AcceptedResponse,
      };
    },
  );

  return sendOutcome(reply, outcome);
};

// ---------------------------------------------------------------------------
// POST /applications/:id/approve
// ---------------------------------------------------------------------------

/**
 * Record the approval, bound to the exact content the user read.
 *
 * Every refusal here is a case where approving anyway would produce a true
 * database row and a false statement: the packet has been superseded, the hash
 * the user quoted is not the hash we hold, the snapshot no longer matches the
 * world, or a required question is still blank.
 */
export const approveApplication: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };
  const body = request.body as ApproveApplicationRequest;

  const existing = await requireApplication(scope, id);
  if (existing.revision !== body.expected_revision) {
    throw staleRevision('This application changed since you read it.');
  }

  // Reconcile first, so an approval can never be granted on top of a snapshot
  // that has already gone stale.
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
  if (application.current_packet_id !== body.packet_id) {
    throw conflict('That packet has been superseded by a newer revision.');
  }

  const packet = loaded.packet as ApplicationPacketRow | null;
  if (packet === null) throw conflict('This application has no packet to approve.');
  if (packet.content_hash !== body.content_hash) {
    throw conflict('The packet changed since you read it, so it must be reviewed again.');
  }

  const answers = (packet.answers as PacketAnswer[] | null) ?? [];
  const unresolved = unresolvedQuestionKeys(answers);
  if (unresolved.length > 0) {
    throw conflict(`${unresolved.length} required question(s) still need an answer.`);
  }

  const staleness = packetStaleness(packet, loaded.live!, new Date());
  if (staleness.length > 0) {
    throw conflict(`This packet is out of date (${staleness.join(', ')}) and must be rebuilt.`);
  }
  if (application.status !== 'ready_for_review') {
    throw conflict(`An application in "${application.status}" is not waiting for approval.`);
  }

  const preferences = await workspacePreferences(scope);
  const approvedAt = new Date();
  const expiresAt = approvalExpiry(approvedAt, preferences.limits.approval_ttl_hours);

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    await scoped
      .updateTable('application_packets')
      .set({
        approved_at: approvedAt,
        // The database refuses any value but this packet's own content hash.
        approved_hash: packet.content_hash,
        expires_at: expiresAt,
      })
      .where('id', '=', packet.id)
      .execute();

    const row = await transitionApplication(scoped, application, 'approved', {
      type: 'packet_approved',
      actor: 'user',
      data: {
        packet_id: packet.id,
        content_hash: packet.content_hash,
        expires_at: expiresAt.toISOString(),
      },
    });

    await recordAuditEvent(scoped, {
      action: 'application.approved',
      actorId: principal.userId,
      objectId: packet.id,
      objectType: 'application_packet',
      metadata: { application_id: application.id, expires_at: expiresAt.toISOString() },
    });
    return row;
  });

  return reply.status(200).send(await renderApplication(context, scope, updated));
};

// ---------------------------------------------------------------------------
// POST /applications/:id/outcome
// ---------------------------------------------------------------------------

/**
 * Record what happened.
 *
 * Two guards matter more than the rest. A browser session cannot claim
 * `adapter_observed`: only a paired runner ever loads the employer's
 * confirmation page, so a session asserting it would be manufacturing
 * verification. And `submitted` needs *some* account of how we know — the
 * distinction between a verified submission and a reported one is the whole
 * point of recording evidence at all.
 */
export const recordApplicationOutcome: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const principal = requireSession(request);
  const { id } = request.params as { id: string };
  const body = request.body as ApplicationOutcomeRequest;

  const application = await requireApplication(scope, id);
  if (application.revision !== body.expected_revision) {
    throw staleRevision('This application changed since you read it.');
  }

  const evidenceType: EvidenceType = body.evidence_type;
  if (evidenceType === 'adapter_observed') {
    throw unprocessable('Only a paired runner can record an observed confirmation.', {
      evidence_type: 'Use "user_report" for something you saw yourself.',
    });
  }
  if (body.outcome === 'submitted' && evidenceType === 'none') {
    throw unprocessable('Recording a submission needs to say how you know it happened.', {
      evidence_type: 'Use "user_report" and describe what you saw.',
    });
  }

  const target = APPLICATION_OUTCOME_STATUS[body.outcome];
  const observedAt =
    body.evidence?.observed_at === undefined || body.evidence.observed_at === null
      ? null
      : new Date(body.evidence.observed_at);

  const evidence: SubmissionEvidence | null =
    evidenceType === 'none' && body.evidence === undefined
      ? null
      : {
          evidence_type: evidenceType,
          confirmation_text: body.evidence?.confirmation_text ?? null,
          reference: body.evidence?.reference ?? null,
          url: body.evidence?.url ?? null,
          observed_at: observedAt === null ? null : observedAt.toISOString(),
          screenshot_file_id: body.evidence?.screenshot_file_id ?? null,
          note: body.evidence?.note ?? null,
        };

  // Only submission writes a submission time, and only forward: an outcome
  // recorded later (interview, rejection) must not move or erase it.
  const submittedAt =
    body.outcome === 'submitted' ? (observedAt ?? new Date()) : application.submitted_at;
  // Returning to `preparing` from outcome_unknown means it was never sent, so
  // the evidence and the timestamp go with it.
  const clearing = body.outcome === 'not_submitted';
  // Evidence is evidence *of a submission*. Attaching it to a cancellation
  // would be a row the database rejects and a sentence that means nothing.
  const keepsEvidence = (SUBMITTED_APPLICATION_STATUSES as readonly string[]).includes(target);

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const row = await transitionApplication(
      scoped,
      application,
      target,
      {
        type:
          body.outcome === 'cancelled'
            ? 'cancelled'
            : body.outcome === 'submitted'
              ? 'submitted'
              : 'outcome_recorded',
        actor: 'user',
        reason: body.outcome,
        // The note and confirmation text are the user's own words about an
        // employer and stay out of the log; whether they exist does not.
        data: {
          outcome: body.outcome,
          evidence_type: evidenceType,
          has_reference: (body.evidence?.reference ?? null) !== null,
          has_confirmation_text: (body.evidence?.confirmation_text ?? null) !== null,
        },
      },
      {
        submittedAt: clearing || !keepsEvidence ? null : submittedAt,
        evidence: clearing || !keepsEvidence ? null : evidence,
      },
    );

    await recordAuditEvent(scoped, {
      action: 'application.outcome_recorded',
      actorId: principal.userId,
      objectId: application.id,
      objectType: 'application',
      metadata: { outcome: body.outcome, evidence_type: evidenceType },
    });
    return row;
  });

  return reply.status(200).send(await renderApplication(context, scope, updated));
};

// ---------------------------------------------------------------------------
// GET /applications/:id/events
// ---------------------------------------------------------------------------

/**
 * The history, oldest first.
 *
 * The cursor is the last sequence number rather than a timestamp: the sequence
 * is dense and unique per application, so it orders the page exactly and needs
 * no tie-breaker.
 */
export const listApplicationEvents: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const { id } = request.params as { id: string };
  const query = request.query as { cursor?: string; limit?: number };
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  await requireApplication(scope, id);

  const after = Number.parseInt(query.cursor ?? '', 10);
  let builder = scope
    .selectFrom('application_events')
    .selectAll()
    .where('application_id', '=', id)
    .orderBy('sequence', 'asc')
    .limit(limit + 1);
  if (Number.isFinite(after) && after > 0) builder = builder.where('sequence', '>', after);

  const rows = await builder.execute();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? String(last.sequence) : null;

  return reply.status(200).send({
    items: page.map((row) => toApplicationEventView(row as never)),
    next_cursor: nextCursor,
  });
};
