/**
 * The `applications` domain: the state machine, the packet snapshot, the
 * content hash an approval binds to, and the append-only history.
 *
 * Four decisions, each one the place where the convenient behaviour would have
 * been the one that eventually sends an employer something the user did not
 * agree to.
 *
 * **Staleness is recomputed, never remembered.** Nothing sets a "this approval
 * is stale now" flag when the profile changes, because whichever code path
 * forgot to set it would be the one that mattered. Instead every read of an
 * application compares the packet's snapshot against the live profile
 * revision, job revision, CV bytes and destination, and an approval that no
 * longer matches is withdrawn on the spot.
 *
 * **The destination comes from the job, not from the caller.** A packet whose
 * URL the client could choose would be an approval for one page that
 * authorises filling another, so `resolveDestination` reads the job's own
 * provenance and the request has no say in it.
 *
 * **A blank is not an answer.** A required question with a null value puts the
 * application into `needs_input` and keeps it there. Nothing fills it in from
 * a similar question, a profile fact that looks close, or a model.
 *
 * **Every transition is checked against the machine.** `transitionApplication`
 * refuses anything `APPLICATION_TRANSITIONS` does not permit, so a handler
 * cannot invent a path from, say, `submitted` back to `draft` by writing the
 * column directly.
 */
import { sql } from 'kysely';
import {
  PACKET_APPROVAL_MAX_TTL_HOURS,
  PACKET_HASH_VERSION,
  isAllowedApplicationTransition,
  type ApplicationEventType,
  type ApplicationEventView,
  type ApplicationActor,
  type ApplicationPacketView,
  type ApplicationStatus,
  type ApplicationView,
  type PacketAnswer,
  type PacketDestination,
  type PacketHashMaterial,
  type PacketStalenessReason,
  type SubmissionEvidence,
} from '@job-getter/contracts';
import type { WorkspaceScope } from '../auth/scope.js';
import type {
  ApplicationEventRow,
  ApplicationPacketRow,
  ApplicationRow,
  JobRow,
  ResumeRow,
} from '../db/types.js';
import type { Db } from '../db/pool.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import { canonicalJson, sha256Hex } from '../util/crypto.js';

export async function requireApplication(
  scope: WorkspaceScope,
  id: string,
): Promise<ApplicationRow> {
  const row = await scope
    .selectFrom('applications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw notFound('No such application.');
  return row as ApplicationRow;
}

// ---------------------------------------------------------------------------
// Destination
// ---------------------------------------------------------------------------

/**
 * Where these applications are actually sent, one query for the whole set.
 *
 * Preference order is the employer's apply URL, then the canonical posting
 * URL, taking the most recently retrieved provenance row. A job with neither
 * is simply absent from the map: "exact destination"
 * (07_APPLICATION_AUTOMATION.md) has to be exact, so a job with nowhere to
 * send an application gets no plausible-looking substitute.
 */
export async function resolveDestinations(
  scope: WorkspaceScope,
  jobIds: readonly string[],
): Promise<Map<string, PacketDestination>> {
  const found = new Map<string, PacketDestination>();
  if (jobIds.length === 0) return found;

  const rows = await scope
    .selectFrom('job_sources')
    .leftJoin('sources', (join) =>
      join
        .onRef('sources.id', '=', 'job_sources.source_id')
        .onRef('sources.workspace_id', '=', 'job_sources.workspace_id'),
    )
    .select([
      'job_sources.job_id as job_id',
      'job_sources.connector as connector',
      'job_sources.apply_url as apply_url',
      'job_sources.canonical_url as canonical_url',
      'sources.connector_version as connector_version',
    ])
    .where('job_sources.job_id', 'in', [...jobIds])
    // Newest provenance first, and an apply URL beats a bare posting URL.
    .orderBy('job_sources.retrieved_at', 'desc')
    .orderBy('job_sources.id', 'desc')
    .execute();

  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = best.get(row.job_id);
    if (current === undefined || (current.apply_url === null && row.apply_url !== null)) {
      best.set(row.job_id, row);
    }
  }

  for (const [jobId, row] of best) {
    const raw = row.apply_url ?? row.canonical_url;
    const parsed = parseDestination(raw);
    if (parsed === null) continue;
    found.set(jobId, {
      url: parsed.toString(),
      origin: parsed.origin,
      connector: row.connector ?? null,
      connector_version: row.connector_version ?? null,
    });
  }
  return found;
}

/**
 * A destination must be an ordinary http(s) URL with no embedded credentials.
 * Anything else is not a page a person can open and check, which is the whole
 * premise of the manual-submission flow.
 */
function parseDestination(raw: string | null): URL | null {
  if (raw === null || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url;
}

/** The single-job form, used when preparing a packet. Refuses, never guesses. */
export async function resolveDestination(
  scope: WorkspaceScope,
  jobId: string,
): Promise<PacketDestination> {
  const destination = (await resolveDestinations(scope, [jobId])).get(jobId);
  if (destination === undefined) {
    throw unprocessable(
      'This job has no usable application URL, so there is nowhere to send a packet.',
      { job_id: 'Add an https apply URL to the job before preparing an application.' },
    );
  }
  return destination;
}

// ---------------------------------------------------------------------------
// The CV attachment
// ---------------------------------------------------------------------------

/**
 * Which file would actually be attached.
 *
 * Original mode sends the user's own upload. Tailored mode sends the PDF, and
 * falls back to the DOCX only when no PDF was produced (the `PDF_UNAVAILABLE`
 * finding). Hashing *that* file, rather than the resume row, is what makes
 * "the CV changed" detectable: a regenerated document is a different resume
 * row, but a re-rendered file under the same row would otherwise slip past.
 */
export function attachmentFileId(resume: ResumeRow): string | null {
  if (resume.mode === 'original') return resume.input_file_id;
  return resume.pdf_file_id ?? resume.docx_file_id;
}

export async function attachmentSha256(
  scope: WorkspaceScope,
  resume: ResumeRow,
): Promise<string | null> {
  const fileId = attachmentFileId(resume);
  if (fileId === null) return null;
  const row = await scope
    .selectFrom('files')
    .select(['sha256'])
    .where('id', '=', fileId)
    .executeTakeFirst();
  return row?.sha256 ?? null;
}

// ---------------------------------------------------------------------------
// The content hash
// ---------------------------------------------------------------------------

export interface PacketMaterialInput {
  readonly profileRevision: number;
  readonly jobId: string;
  readonly jobRevision: number;
  readonly resumeId: string;
  readonly resumeSha256: string | null;
  readonly destination: PacketDestination;
  readonly formFingerprint: string | null;
  readonly answers: readonly PacketAnswer[];
}

/**
 * Build the exact object `content_hash` covers.
 *
 * Answers are reduced to key, value and provenance and sorted by key: the
 * label is presentation, and the order the UI happened to send fields in is
 * not a difference in what would be submitted.
 */
export function buildPacketHashMaterial(input: PacketMaterialInput): PacketHashMaterial {
  return {
    hash_version: PACKET_HASH_VERSION,
    profile_revision: input.profileRevision,
    job_id: input.jobId,
    job_revision: input.jobRevision,
    resume_id: input.resumeId,
    resume_sha256: input.resumeSha256,
    destination: input.destination,
    form_fingerprint: input.formFingerprint,
    answers: [...input.answers]
      .sort((a, b) =>
        a.question_key < b.question_key ? -1 : a.question_key > b.question_key ? 1 : 0,
      )
      .map((answer) => ({
        question_key: answer.question_key,
        answer: answer.answer,
        provenance: answer.provenance,
      })),
  };
}

/** SHA-256 hex of the canonical JSON of the material. See PacketHashMaterial. */
export function computeContentHash(material: PacketHashMaterial): string {
  return sha256Hex(canonicalJson(material));
}

/**
 * Required questions with no answer. These are what hold an application in
 * `needs_input`, and the fill path refuses to start while any remain (AT14).
 */
export function unresolvedQuestionKeys(answers: readonly PacketAnswer[]): string[] {
  return answers
    .filter((answer) => answer.required && answer.answer === null)
    .map((answer) => answer.question_key);
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/** The world as it is now, against which a packet's snapshot is compared. */
export interface PacketLiveState {
  readonly profileRevision: number;
  readonly jobRevision: number;
  readonly resumeSha256: string | null;
  readonly destination: PacketDestination;
}

/**
 * Everything 03_DATA_MODEL.md names as invalidating an approval: "Replacing
 * CV, changing answers, source profile or job invalidates approval."
 *
 * Changed *answers* do not appear as a comparison because they cannot change
 * in place — a packet is immutable, so a different set of answers is a
 * different packet with a different hash, and the application's current packet
 * moves with it.
 *
 * `form_schema_changed` is not raised here. It is raised by the fill path,
 * which is the only thing that ever sees the real form: comparing a stored
 * fingerprint against nothing would be an assertion we cannot make from a
 * read.
 */
export function packetStaleness(
  packet: ApplicationPacketRow,
  live: PacketLiveState,
  now: Date,
): PacketStalenessReason[] {
  const reasons: PacketStalenessReason[] = [];
  if (live.profileRevision !== packet.profile_revision) reasons.push('profile_revision_changed');
  if (live.jobRevision !== packet.job_revision) reasons.push('job_revision_changed');
  if (live.resumeSha256 !== packet.resume_sha256) reasons.push('resume_changed');
  if (
    live.destination.url !== packet.destination_url ||
    live.destination.origin !== packet.destination_origin
  ) {
    reasons.push('destination_changed');
  }
  if (packet.expires_at !== null && packet.expires_at.getTime() <= now.getTime()) {
    reasons.push('approval_expired');
  }
  return reasons;
}

/** Expiry is the shorter of the user's configured TTL and the spec's 24 hours. */
export function approvalExpiry(approvedAt: Date, configuredTtlHours: number): Date {
  const hours = Math.min(Math.max(configuredTtlHours, 1), PACKET_APPROVAL_MAX_TTL_HOURS);
  return new Date(approvedAt.getTime() + hours * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Events and transitions
// ---------------------------------------------------------------------------

export interface EventInput {
  readonly type: ApplicationEventType;
  readonly actor: ApplicationActor;
  readonly statusBefore?: ApplicationStatus | null;
  readonly statusAfter?: ApplicationStatus | null;
  readonly reason?: string | null;
  /** Counts, ids and codes only. Never answer text, never CV text. */
  readonly data?: Record<string, unknown>;
}

/**
 * Append one event.
 *
 * The sequence is allocated by the same statement that inserts the row, so two
 * concurrent writers cannot both read "max is 4". If they race anyway the
 * UNIQUE (workspace_id, application_id, sequence) constraint rejects the
 * loser, which the caller surfaces as a 409 — a retry then lands cleanly.
 */
export async function appendApplicationEvent(
  scope: WorkspaceScope,
  applicationId: string,
  event: EventInput,
): Promise<void> {
  await scope
    .insertInto('application_events', {
      application_id: applicationId,
      sequence: sql<number>`(
        SELECT coalesce(max(e.sequence), 0) + 1
        FROM application_events e
        WHERE e.workspace_id = ${scope.workspaceId}::uuid
          AND e.application_id = ${applicationId}::uuid
      )` as never,
      type: event.type,
      actor: event.actor,
      status_before: event.statusBefore ?? null,
      status_after: event.statusAfter ?? null,
      reason: event.reason ?? null,
      data: JSON.stringify(event.data ?? {}),
    })
    .execute();
}

export interface TransitionOptions {
  readonly submittedAt?: Date | null;
  readonly evidence?: SubmissionEvidence | null;
  readonly currentPacketId?: string | null;
}

/**
 * Move an application along `to`, bump its revision once and record why.
 *
 * `to` may be a path. Preparing a packet really does go draft → preparing →
 * ready_for_review, and every hop is checked against
 * `APPLICATION_TRANSITIONS`, but it is one act by one person: writing three
 * rows into the history for it would bury the thing that happened under the
 * bookkeeping of how it happened. The intermediate states are recorded in the
 * event's `data.path` instead, so nothing is lost.
 *
 * This is the only place the `status` column is written, so an illegal
 * transition is impossible to perform by accident rather than merely
 * discouraged.
 */
export async function transitionApplication(
  scope: WorkspaceScope,
  application: ApplicationRow,
  to: ApplicationStatus | readonly ApplicationStatus[],
  event: EventInput,
  options: TransitionOptions = {},
): Promise<ApplicationRow> {
  const path = Array.isArray(to)
    ? [...(to as readonly ApplicationStatus[])]
    : [to as ApplicationStatus];
  const from = application.status;
  let cursor = from;
  for (const next of path) {
    if (!isAllowedApplicationTransition(cursor, next)) {
      throw conflict(`An application cannot move from "${cursor}" to "${next}".`);
    }
    cursor = next;
  }

  const patch: Record<string, unknown> = {
    status: cursor,
    revision: application.revision + 1,
    updated_at: new Date(),
  };
  if (options.submittedAt !== undefined) patch.submitted_at = options.submittedAt;
  if (options.evidence !== undefined) {
    patch.submission_evidence = options.evidence === null ? null : JSON.stringify(options.evidence);
  }
  if (options.currentPacketId !== undefined) patch.current_packet_id = options.currentPacketId;

  const updated = await scope
    .updateTable('applications')
    .set(patch as never)
    .where('id', '=', application.id)
    .where('revision', '=', application.revision)
    .returningAll()
    .executeTakeFirst();

  // The revision moved under us between the read and the write.
  if (!updated) throw conflict('This application changed while you were working on it.');

  const data = { ...(event.data ?? {}) };
  if (path.length > 1) data.path = [from, ...path];

  await appendApplicationEvent(scope, application.id, {
    ...event,
    statusBefore: event.statusBefore ?? from,
    statusAfter: event.statusAfter ?? cursor,
    data,
  });

  return updated as ApplicationRow;
}

// ---------------------------------------------------------------------------
// Reading: contexts, reconciliation and views
// ---------------------------------------------------------------------------

export interface ApplicationContext {
  readonly application: ApplicationRow;
  readonly job: JobRow;
  readonly packet: ApplicationPacketRow | null;
  readonly live: PacketLiveState | null;
  readonly staleness: readonly PacketStalenessReason[];
}

/**
 * Load everything a page of applications needs, in a fixed number of queries
 * rather than one round trip per row.
 *
 * A job whose row is missing cannot happen — the composite foreign key
 * cascades — so an application with no job row is dropped rather than rendered
 * with invented company and title.
 */
export async function loadApplicationContexts(
  scope: WorkspaceScope,
  applications: readonly ApplicationRow[],
  now: Date,
): Promise<ApplicationContext[]> {
  if (applications.length === 0) return [];

  const jobIds = [...new Set(applications.map((row) => row.job_id))];
  const packetIds = applications
    .map((row) => row.current_packet_id)
    .filter((id): id is string => id !== null);

  const [profile, jobRows, packetRows] = await Promise.all([
    scope.selectFrom('profiles').select(['revision']).executeTakeFirst(),
    scope.selectFrom('jobs').selectAll().where('id', 'in', jobIds).execute(),
    packetIds.length === 0
      ? Promise.resolve([])
      : scope.selectFrom('application_packets').selectAll().where('id', 'in', packetIds).execute(),
  ]);

  const profileRevision = profile?.revision ?? 1;
  const jobsById = new Map((jobRows as JobRow[]).map((row) => [row.id, row]));
  const packetsById = new Map((packetRows as ApplicationPacketRow[]).map((row) => [row.id, row]));

  // The live CV bytes and the live destination, for the jobs and resumes the
  // page's packets actually reference.
  const resumeIds = [...new Set([...packetsById.values()].map((row) => row.resume_id))];
  const resumeRows =
    resumeIds.length === 0
      ? []
      : ((await scope
          .selectFrom('resumes')
          .selectAll()
          .where('id', 'in', resumeIds)
          .execute()) as ResumeRow[]);
  const fileIds = resumeRows
    .map((row) => attachmentFileId(row))
    .filter((id): id is string => id !== null);
  const fileRows =
    fileIds.length === 0
      ? []
      : await scope
          .selectFrom('files')
          .select(['id', 'sha256'])
          .where('id', 'in', fileIds)
          .execute();
  const shaByFile = new Map(fileRows.map((row) => [row.id, row.sha256]));
  const shaByResume = new Map(
    resumeRows.map((row) => {
      const fileId = attachmentFileId(row);
      return [row.id, fileId === null ? null : (shaByFile.get(fileId) ?? null)];
    }),
  );

  const destinations = await resolveDestinations(
    scope,
    applications.filter((row) => row.current_packet_id !== null).map((row) => row.job_id),
  );

  const contexts: ApplicationContext[] = [];
  for (const application of applications) {
    const job = jobsById.get(application.job_id);
    if (!job) continue;
    const packet =
      application.current_packet_id === null
        ? null
        : (packetsById.get(application.current_packet_id) ?? null);

    let live: PacketLiveState | null = null;
    let staleness: PacketStalenessReason[] = [];
    if (packet !== null) {
      const destination = destinations.get(application.job_id);
      live = {
        profileRevision,
        jobRevision: job.revision,
        resumeSha256: shaByResume.get(packet.resume_id) ?? null,
        destination: destination ?? {
          // No resolvable destination now: report it as a changed destination
          // rather than silently comparing against the stored one.
          url: '',
          origin: '',
          connector: null,
          connector_version: null,
        },
      };
      staleness = packetStaleness(packet, live, now);
    }
    contexts.push({ application, job, packet, live, staleness });
  }
  return contexts;
}

/**
 * Withdraw approvals that no longer describe reality, and move the application
 * back to where the user has work to do.
 *
 * Expiry alone returns it to `ready_for_review`: the content is still exactly
 * what they read, only the clock ran out, so the same packet can be approved
 * again. Anything else returns it to `preparing`, because the packet no longer
 * matches the profile, job, CV or destination it snapshotted and a new
 * revision is required.
 *
 * Writes happen only for applications that actually changed.
 *
 * This runs on reads, which is where a user next sees the application. It is
 * not the only guard and must not become one: the fill path has to re-verify
 * approval, origin and job identity at the moment it acts, because a read five
 * minutes ago says nothing about now.
 */
export async function reconcileApplications(
  db: Db,
  scope: WorkspaceScope,
  contexts: readonly ApplicationContext[],
): Promise<ApplicationContext[]> {
  const result: ApplicationContext[] = [];
  for (const context of contexts) {
    const { application, packet, staleness } = context;
    const approved = packet !== null && packet.approved_at !== null;
    if (!approved || staleness.length === 0 || application.status !== 'approved') {
      result.push(context);
      continue;
    }

    const expiredOnly = staleness.length === 1 && staleness[0] === 'approval_expired';
    const target: ApplicationStatus = expiredOnly ? 'ready_for_review' : 'preparing';

    const updated = await db.transaction().execute(async (trx) => {
      const scoped = scope.withExecutor(trx);
      await scoped
        .updateTable('application_packets')
        .set({ approved_at: null, approved_hash: null, expires_at: null })
        .where('id', '=', packet.id)
        .execute();
      return transitionApplication(scoped, application, target, {
        type: expiredOnly ? 'approval_expired' : 'approval_invalidated',
        actor: 'system',
        reason: staleness.join(','),
        data: { packet_id: packet.id, reasons: staleness },
      });
    });

    result.push({
      ...context,
      application: updated,
      packet: { ...packet, approved_at: null, approved_hash: null, expires_at: null },
    });
  }
  return result;
}

export function toPacketView(
  packet: ApplicationPacketRow,
  staleness: readonly PacketStalenessReason[],
): ApplicationPacketView {
  const answers = (packet.answers as PacketAnswer[] | null) ?? [];
  return {
    id: packet.id,
    application_id: packet.application_id,
    revision: packet.revision,
    profile_revision: packet.profile_revision,
    job_revision: packet.job_revision,
    resume_id: packet.resume_id,
    resume_sha256: packet.resume_sha256,
    destination: {
      url: packet.destination_url,
      origin: packet.destination_origin,
      connector: packet.connector,
      connector_version: packet.connector_version,
    },
    answers,
    form_fingerprint: packet.form_fingerprint,
    content_hash: packet.content_hash,
    approved_hash: packet.approved_hash,
    approved_at: packet.approved_at === null ? null : packet.approved_at.toISOString(),
    expires_at: packet.expires_at === null ? null : packet.expires_at.toISOString(),
    unresolved_question_keys: unresolvedQuestionKeys(answers),
    staleness: [...staleness],
    created_at: packet.created_at.toISOString(),
  };
}

export function toApplicationView(
  context: ApplicationContext,
  duplicateApplicationIds: readonly string[],
): ApplicationView {
  const { application, job, packet, staleness } = context;
  return {
    id: application.id,
    job_id: application.job_id,
    company: job.company,
    title: job.title,
    status: application.status,
    revision: application.revision,
    current_packet: packet === null ? null : toPacketView(packet, staleness),
    submission_evidence: (application.submission_evidence as SubmissionEvidence | null) ?? null,
    submitted_at: application.submitted_at === null ? null : application.submitted_at.toISOString(),
    possible_duplicate_application_ids: [...duplicateApplicationIds],
    created_at: application.created_at.toISOString(),
    updated_at: application.updated_at.toISOString(),
  };
}

export function toApplicationEventView(row: ApplicationEventRow): ApplicationEventView {
  return {
    id: row.id,
    sequence: row.sequence,
    type: row.type,
    actor: row.actor,
    status_before: row.status_before,
    status_after: row.status_after,
    reason: row.reason,
    data: (row.data as Record<string, unknown>) ?? {},
    occurred_at: row.occurred_at.toISOString(),
  };
}
