/**
 * What happens to an application when a paired runner reports back.
 *
 * The runner has three honest endings and this module maps each to the state
 * that says the same thing:
 *
 *  * `awaiting_user_submit` — the form is filled and waiting for the person.
 *    The runner never clicks final submit, so this is the furthest it can get.
 *  * `needs_input` — the page asked something the packet does not answer. The
 *    spec's instruction is exact: "pause, store the schema, collect answers,
 *    create a new packet revision and reapprove". So a new revision is written
 *    here, carrying the answers that were already given plus the newly
 *    discovered questions with no value, and the old approval goes with it.
 *  * `unsupported` — no tested adapter matched. Nothing was typed and nothing
 *    changed, so the application returns to `approved` exactly as it was, and
 *    the user applies by hand. That is AT17's "honest manual fallback and
 *    saved packet"; marking it failed would put a red mark on a good packet.
 *
 * Nothing here retries. `fill_local` is in `NO_RETRY_TASK_TYPES` because a
 * second attempt is a second attempt at someone's real application, against a
 * page that may have changed under the first.
 */
import {
  type ApplicationStatus,
  type FillLocalInput,
  type FillLocalResult,
  type PacketAnswer,
} from '@job-getter/contracts';
import { WorkspaceScope } from '../auth/scope.js';
import type { DbTransaction } from '../db/pool.js';
import type { ApplicationPacketRow, ApplicationRow, TaskRow } from '../db/types.js';
import {
  appendApplicationEvent,
  buildPacketHashMaterial,
  computeContentHash,
  transitionApplication,
  unresolvedQuestionKeys,
} from './service.js';

/** The reason recorded on the pause event, per outcome. */
const PAUSE_REASON: Readonly<Record<FillLocalResult['outcome'], string>> = {
  awaiting_user_submit: 'filled_awaiting_user_submit',
  needs_input: 'unanswered_required_questions',
  unsupported: 'no_tested_adapter',
};

const PAUSE_STATUS: Readonly<Record<FillLocalResult['outcome'], ApplicationStatus>> = {
  awaiting_user_submit: 'awaiting_user_submit',
  needs_input: 'needs_input',
  unsupported: 'approved',
};

async function loadApplication(
  trx: DbTransaction,
  scope: WorkspaceScope,
  id: string,
): Promise<ApplicationRow | null> {
  const row = await scope
    .selectFrom('applications')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return (row as ApplicationRow | undefined) ?? null;
}

/**
 * Add the questions the page asked and the packet did not answer.
 *
 * They arrive `required: true` with a null value, which is what holds the
 * application in `needs_input`: the point of discovering a question is that
 * somebody has to answer it, not that we now have a new field to leave blank
 * quietly. `never_reuse` is the sensitivity used for anything the runner could
 * not resolve on its own, so it cannot later be satisfied from the bank.
 */
function mergeDiscoveredQuestions(
  existing: readonly PacketAnswer[],
  result: FillLocalResult,
): PacketAnswer[] {
  const byKey = new Map(existing.map((answer) => [answer.question_key, answer]));
  for (const field of result.unresolved_fields) {
    const current = byKey.get(field.question_key);
    if (current !== undefined) {
      // Known question, still unanswered on the page: keep the user's own
      // label and provenance, but make its required-ness the page's truth.
      byKey.set(field.question_key, { ...current, required: current.required || field.required });
      continue;
    }
    byKey.set(field.question_key, {
      question_key: field.question_key,
      label: field.label,
      answer: null,
      required: field.required,
      sensitivity: field.reason === 'never_inferable' ? 'never_reuse' : 'standard',
      provenance: 'user_entered',
      source_id: null,
    });
  }
  return [...byKey.values()];
}

/**
 * Apply a completed `fill_local` result inside the completing transaction.
 *
 * A missing application or packet is not an error to raise: the task committed
 * a result and the row it referred to is gone, which the cascade can do. There
 * is nothing to update and nothing to invent.
 */
export async function applyFillLocalResult(
  trx: DbTransaction,
  task: TaskRow,
  result: FillLocalResult,
): Promise<void> {
  const input = task.payload as FillLocalInput;
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  const application = await loadApplication(trx, scope, input.application_id);
  if (application === null) return;

  const now = new Date();

  // Record the schema the runner actually saw. A later packet snapshots this,
  // and an approval whose schema stops matching is withdrawn on the next read.
  if (result.form_fingerprint !== null) {
    await scope
      .updateTable('applications')
      .set({ observed_form_fingerprint: result.form_fingerprint, form_observed_at: now })
      .where('id', '=', application.id)
      .execute();
  }

  const filled = result.filled_fields.filter((field) => field.outcome === 'filled').length;
  const eventData: Record<string, unknown> = {
    packet_id: result.packet_id,
    outcome: result.outcome,
    filled_count: filled,
    // Keys and reasons only. The labels a page shows are the employer's words
    // and the answers are the user's; neither belongs in an event log.
    unresolved_question_keys: result.unresolved_fields.map((field) => field.question_key),
    adapter: result.adapter,
    adapter_version: result.adapter_version,
  };

  if (result.outcome === 'needs_input') {
    const packetId = await writeDiscoveredPacket(trx, scope, application, input, result, now);
    if (packetId !== null) eventData.packet_id = packetId;
    const refreshed = (await loadApplication(trx, scope, application.id)) ?? application;
    await transitionApplication(
      scope,
      refreshed,
      'needs_input',
      {
        type: 'fill_paused',
        actor: 'runner',
        reason: PAUSE_REASON.needs_input,
        data: eventData,
      },
      packetId === null ? {} : { currentPacketId: packetId },
    );
    return;
  }

  await transitionApplication(scope, application, PAUSE_STATUS[result.outcome], {
    type: 'fill_paused',
    actor: 'runner',
    reason: PAUSE_REASON[result.outcome],
    data: eventData,
  });
}

/**
 * Write the new packet revision a discovered question requires.
 *
 * Returns null when the packet the runner was given is no longer the current
 * one — the user changed something while the browser was open, and their newer
 * packet must not be silently replaced by one built from the older answers.
 */
async function writeDiscoveredPacket(
  trx: DbTransaction,
  scope: WorkspaceScope,
  application: ApplicationRow,
  input: FillLocalInput,
  result: FillLocalResult,
  now: Date,
): Promise<string | null> {
  if (application.current_packet_id !== input.packet_id) return null;

  const previous = (await scope
    .selectFrom('application_packets')
    .selectAll()
    .where('id', '=', input.packet_id)
    .executeTakeFirst()) as ApplicationPacketRow | undefined;
  if (previous === undefined) return null;

  const answers = mergeDiscoveredQuestions(
    (previous.answers as PacketAnswer[] | null) ?? [],
    result,
  );
  // Nothing new and nothing newly required: the previous packet already says
  // everything this revision would, so do not write a duplicate.
  if (unresolvedQuestionKeys(answers).length === 0) return null;

  const destination = {
    url: previous.destination_url,
    origin: previous.destination_origin,
    connector: previous.connector,
    connector_version: previous.connector_version,
  };
  const contentHash = computeContentHash(
    buildPacketHashMaterial({
      profileRevision: previous.profile_revision,
      jobId: application.job_id,
      jobRevision: previous.job_revision,
      resumeId: previous.resume_id,
      resumeSha256: previous.resume_sha256,
      destination,
      formFingerprint: result.form_fingerprint,
      answers,
    }),
  );

  const inserted = await scope
    .insertInto('application_packets', {
      application_id: application.id,
      revision: previous.revision + 1,
      profile_revision: previous.profile_revision,
      job_revision: previous.job_revision,
      resume_id: previous.resume_id,
      resume_sha256: previous.resume_sha256,
      destination_url: previous.destination_url,
      destination_origin: previous.destination_origin,
      connector: previous.connector,
      connector_version: previous.connector_version,
      answers: JSON.stringify(answers),
      form_fingerprint: result.form_fingerprint,
      content_hash: contentHash,
      created_at: now,
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  // The previous packet's approval refers to content that no longer describes
  // the form. It is withdrawn here rather than left standing on a superseded
  // row, and the event log keeps the record that it was once given.
  await scope
    .updateTable('application_packets')
    .set({ approved_at: null, approved_hash: null, expires_at: null })
    .where('id', '=', previous.id)
    .execute();

  return inserted.id;
}

/**
 * A failed fill leaves a visible failed application, not silence.
 *
 * `failed → preparing` is available, which is the spec's "Failure before
 * submission permits preparing again after correction". Nothing retries on its
 * own.
 */
export async function applyFillLocalFailure(
  trx: DbTransaction,
  task: TaskRow,
  code: string,
  message: string,
): Promise<void> {
  const input = task.payload as FillLocalInput;
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  const application = await loadApplication(trx, scope, input.application_id);
  if (application === null) return;

  if (application.status !== 'filling') {
    // Something already moved it on — a cancellation, most likely. Record the
    // failure without forcing a transition the machine would refuse.
    await appendApplicationEvent(scope, application.id, {
      type: 'fill_failed',
      actor: 'runner',
      reason: code.slice(0, 120),
      data: { packet_id: input.packet_id, code },
    });
    return;
  }

  await transitionApplication(scope, application, 'failed', {
    type: 'fill_failed',
    actor: 'runner',
    reason: code.slice(0, 120),
    // The redacted worker message, which the protocol already requires to
    // carry no page content or answers.
    data: { packet_id: input.packet_id, code, message: message.slice(0, 600) },
  });
}
