/**
 * The checks that decide whether an approved packet may be filled *now*, and
 * the payload a client is given when it may.
 *
 * Two clients reach this: the paired local runner through
 * `POST /applications/:id/fill` (M4), and the browser extension through
 * `POST /fill-sessions` (M5). They fill the same form from the same packet,
 * and the moment their preconditions differ, one of them is filling something
 * the person did not approve. So the rules live here once rather than being
 * written twice and drifting on the third change.
 *
 * Every check is a case where proceeding would mean acting on something the
 * user did not approve, or acting twice:
 *
 *  * **Only from `approved`.** Not `ready_for_review`, not `preparing`. The
 *    state *is* the record that a person read this packet.
 *  * **Never after an unknown outcome.** Nobody could establish whether the
 *    first attempt went through, so a second could be a second application.
 *  * **Only the current packet, and only if it is still fresh.** Staleness is
 *    recomputed here rather than trusted from the last read: the profile may
 *    have moved in the seconds since the screen rendered.
 *  * **Never with an unanswered required question.** AT14 starts here, before
 *    a browser is even opened.
 */
import type { FillField, PacketAnswer } from '@job-getter/contracts';
import { conflict, notFound, staleRevision } from '../errors.js';
import type { ApplicationPacketRow, ApplicationRow, ResumeRow } from '../db/types.js';
import type { WorkspaceScope } from '../auth/scope.js';
import {
  attachmentFileId,
  loadApplicationContexts,
  packetStaleness,
  reconcileApplications,
  requireApplication,
  unresolvedQuestionKeys,
} from './service.js';
import type { Db } from '../db/pool.js';

export interface FillablePacket {
  readonly application: ApplicationRow;
  readonly packet: ApplicationPacketRow;
  readonly answers: readonly PacketAnswer[];
}

/**
 * Loads an application and refuses unless its current packet may be filled.
 *
 * `expectedRevision` is optional because the two callers know different
 * things. The web app read the application a moment ago and can say which
 * revision it displayed, so a mismatch is a stale screen. The extension never
 * saw a revision — it holds a packet content hash instead, which is checked by
 * the caller against `packet.content_hash`.
 */
export async function requireFillablePacket(
  db: Db,
  scope: WorkspaceScope,
  applicationId: string,
  options: { expectedRevision?: number } = {},
): Promise<FillablePacket> {
  const existing = await requireApplication(scope, applicationId);
  if (options.expectedRevision !== undefined && existing.revision !== options.expectedRevision) {
    throw staleRevision('This application changed since you read it.');
  }

  // Reconcile before anything else: a packet that went stale between the
  // screen rendering and this call must not be filled.
  const [loaded] = await reconcileApplications(
    db,
    scope,
    await loadApplicationContexts(scope, [existing], new Date()),
  );
  if (loaded === undefined) throw notFound('No such application.');
  const application = loaded.application;

  if (options.expectedRevision !== undefined && application.revision !== options.expectedRevision) {
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

  const packet = loaded.packet as ApplicationPacketRow | null;
  if (packet === null || packet.approved_at === null) {
    throw conflict('This packet has not been approved.');
  }
  if (application.current_packet_id !== packet.id) {
    throw conflict('That packet has been superseded by a newer revision.');
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

  return { application, packet, answers };
}

/**
 * The fields a client is allowed to type.
 *
 * Only answered questions travel. An unanswered one has nothing to type, and
 * its presence in the payload would invite a client to improvise.
 */
export function fillableFields(answers: readonly PacketAnswer[]): FillField[] {
  return answers
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
}

export interface PacketAttachment {
  readonly fileId: string | null;
  readonly filename: string | null;
}

/** The one file a fill client may download: the CV this packet was approved with. */
export async function packetAttachment(
  scope: WorkspaceScope,
  packet: ApplicationPacketRow,
): Promise<PacketAttachment> {
  const resume = (await scope
    .selectFrom('resumes')
    .selectAll()
    .where('id', '=', packet.resume_id)
    .executeTakeFirst()) as ResumeRow | undefined;
  if (resume === undefined) throw conflict('The CV this packet references no longer exists.');

  const fileId = attachmentFileId(resume);
  if (fileId === null) return { fileId: null, filename: null };

  const file =
    (await scope
      .selectFrom('files')
      .select(['id', 'original_name'])
      .where('id', '=', fileId)
      .executeTakeFirst()) ?? null;
  return { fileId: file?.id ?? null, filename: file?.original_name ?? null };
}
