/**
 * What happens to an application when a runner reports what the page said.
 *
 * `07_APPLICATION_AUTOMATION.md`:
 *
 *     Any uncertain post-submit observation becomes outcome_unknown. From
 *     outcome_unknown the user may confirm submitted with evidence or mark not
 *     submitted and return to preparing. **Never retry filling/submission
 *     automatically in that state.**
 *
 * There are two endings and one of them is "I could not tell". That ending is
 * the point of the whole feature, and the easiest one to get wrong: it is
 * tempting to treat a watch that saw nothing as a failure, or — worse — to
 * treat a form that was filled and left alone as probably submitted. Neither
 * is true. _"Absence of evidence is not failure or success."_
 *
 *  * `observed` → `submitted`, with the page's own words as
 *    `adapter_observed` evidence and the moment it was seen as the submission
 *    time. This is the only path in the product that may record a submission
 *    without the user typing one, and it may do so precisely because a runner
 *    read it off the employer's page.
 *  * `unknown` → `outcome_unknown`, carrying **no** evidence and the reason we
 *    could not tell. The tracker then shows it as unresolved and asks the
 *    person, who is the only one who actually knows.
 *
 * A task-level failure lands in the same place as `unknown`, for the same
 * reason: a browser that crashed mid-watch has told us nothing about the
 * application either.
 */
import {
  observationResultIsCoherent,
  type ObserveConfirmationInput,
  type ObserveConfirmationResult,
  type SubmissionEvidence,
} from '@job-getter/contracts';
import { WorkspaceScope } from '../auth/scope.js';
import type { DbTransaction } from '../db/pool.js';
import type { ApplicationRow, TaskRow } from '../db/types.js';
import { appendApplicationEvent, transitionApplication } from './service.js';

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
 * States an observation may still land on.
 *
 * By the time a runner reports, the person may have recorded the outcome
 * themselves — they were, after all, sitting in front of the page. Their
 * answer wins: it is first-hand, and overwriting `submitted` with
 * `outcome_unknown` because a watcher timed out would replace something known
 * with something unknown.
 */
const OBSERVABLE_STATUSES: readonly string[] = ['awaiting_user_submit'];

export async function applyObserveConfirmationResult(
  trx: DbTransaction,
  task: TaskRow,
  result: ObserveConfirmationResult,
): Promise<void> {
  const input = task.payload as ObserveConfirmationInput;
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  const application = await loadApplication(trx, scope, input.application_id);
  if (application === null) return;
  await applyObservation(scope, application, result);
}

/**
 * The rules above, for whichever client looked: the runner's task result and
 * the extension's one look at the page both land here, so the two cannot
 * disagree about what an observation means. `extra` is added to the event,
 * for recording which client and which fill session it was.
 */
export async function applyObservation(
  scope: WorkspaceScope,
  application: ApplicationRow,
  result: ObserveConfirmationResult,
  extra: Record<string, unknown> = {},
): Promise<void> {
  // A result that claims to know and not know at once is refused rather than
  // stored. The schema cannot express the pairing, so it is checked here.
  const coherent = observationResultIsCoherent(result);
  const observed = coherent && result.outcome === 'observed';

  const eventData: Record<string, unknown> = {
    packet_id: result.packet_id,
    outcome: coherent ? result.outcome : 'unknown',
    // How long we waited is part of the answer: "we looked for 90 seconds and
    // saw nothing" is a different sentence from "we could not look".
    watched_seconds: result.watched_seconds,
    unknown_reason: coherent ? result.unknown_reason : 'runner_error',
    adapter: result.adapter,
    adapter_version: result.adapter_version,
    ...extra,
  };

  if (!OBSERVABLE_STATUSES.includes(application.status)) {
    // The person got there first. Record what was seen and change nothing.
    await appendApplicationEvent(scope, application.id, {
      type: 'note',
      actor: 'runner',
      reason: 'observation_superseded',
      data: { ...eventData, status: application.status },
    });
    return;
  }

  if (!observed) {
    await transitionApplication(scope, application, 'outcome_unknown', {
      type: 'outcome_recorded',
      actor: 'runner',
      reason: (coherent ? (result.unknown_reason ?? 'unknown') : 'runner_error').slice(0, 120),
      data: eventData,
    });
    return;
  }

  const confirmation = result.confirmation!;
  const observedAt = new Date(confirmation.observed_at);
  const evidence: SubmissionEvidence = {
    evidence_type: 'adapter_observed',
    confirmation_text: confirmation.confirmation_text,
    reference: confirmation.reference,
    url: confirmation.url,
    observed_at: observedAt.toISOString(),
    screenshot_file_id: result.screenshot_file_id,
    note: null,
  };

  // The evidence, the submission time and the status move in **one**
  // statement. `applications_evidence_scope` and
  // `applications_submitted_needs_time` (migration 0005) refuse a row that
  // carries evidence while still `awaiting_user_submit`, and they are right to:
  // an intermediate state where the row claims proof of a submission it has not
  // recorded is exactly the inconsistency those constraints exist to prevent.
  await transitionApplication(
    scope,
    application,
    'submitted',
    {
      type: 'submitted',
      actor: 'runner',
      reason: 'adapter_observed',
      data: {
        ...eventData,
        // The reference is an application number the employer showed; the
        // confirmation *text* is not copied into the event log, because it is
        // the employer's page content and the evidence column already holds it.
        reference: confirmation.reference,
        has_confirmation_text: confirmation.confirmation_text !== null,
      },
    },
    { submittedAt: observedAt, evidence },
  );
}

/**
 * A failed observation is not a failed application.
 *
 * The browser died, or the page never loaded, or the lease expired. None of
 * that is evidence about whether the person's application went through, so the
 * application lands exactly where an inconclusive watch lands: unresolved, and
 * waiting for them.
 */
export async function applyObserveConfirmationFailure(
  trx: DbTransaction,
  task: TaskRow,
  code: string,
  message: string,
): Promise<void> {
  const input = task.payload as ObserveConfirmationInput;
  const scope = WorkspaceScope.forTaskWorkspace(trx, task.workspace_id);
  const application = await loadApplication(trx, scope, input.application_id);
  if (application === null) return;

  const data = {
    packet_id: input.packet_id,
    outcome: 'unknown',
    unknown_reason: 'runner_error',
    code,
    detail: message.slice(0, 500),
  };

  if (!OBSERVABLE_STATUSES.includes(application.status)) {
    await appendApplicationEvent(scope, application.id, {
      type: 'note',
      actor: 'runner',
      reason: 'observation_superseded',
      data: { ...data, status: application.status },
    });
    return;
  }

  await transitionApplication(scope, application, 'outcome_unknown', {
    type: 'outcome_recorded',
    actor: 'runner',
    reason: code.slice(0, 120),
    data,
  });
}
