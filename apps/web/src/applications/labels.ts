import type {
  ApplicationEventType,
  ApplicationStatus,
  DeviceStatus,
  EvidenceType,
  PacketAnswerProvenance,
  PacketStalenessReason,
  UnresolvedReason,
} from '@job-getter/contracts';
import type { BadgeTone } from '@job-getter/ui';
import type { MessageKey } from '../i18n/messages';

/**
 * Human copy for the closed enums of the application contract.
 *
 * Every map is a *total* `Record`, so adding a status, a staleness reason or an
 * outcome to the contract stops this file compiling until the UI can explain
 * it. A tracker that renders an unknown value as a raw identifier is a tracker
 * that has stopped telling the user what happened.
 *
 * 08_UX_AND_CUSTOMIZATION.md requires several of these to read *distinctly*:
 * "Not checked", "Unknown", "Needs your answer", "Ready for review", "Waiting
 * for submission", "Submitted—verified" and "Submitted—reported by you". The
 * last two are the reason `submitted` has no single label here: what to call it
 * depends on the evidence, and `submittedLabel` below decides.
 */

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, MessageKey> = {
  draft: 'application.status.draft',
  preparing: 'application.status.preparing',
  needs_input: 'application.status.needsInput',
  ready_for_review: 'application.status.readyForReview',
  approved: 'application.status.approved',
  filling: 'application.status.filling',
  awaiting_user_submit: 'application.status.awaitingUserSubmit',
  submitted: 'application.status.submitted',
  outcome_unknown: 'application.status.outcomeUnknown',
  failed: 'application.status.failed',
  cancelled: 'application.status.cancelled',
  interview: 'application.status.interview',
  rejected: 'application.status.rejected',
  offer: 'application.status.offer',
  withdrawn: 'application.status.withdrawn',
};

export const APPLICATION_STATUS_DESCRIPTION: Record<ApplicationStatus, MessageKey> = {
  draft: 'application.status.draft.description',
  preparing: 'application.status.preparing.description',
  needs_input: 'application.status.needsInput.description',
  ready_for_review: 'application.status.readyForReview.description',
  approved: 'application.status.approved.description',
  filling: 'application.status.filling.description',
  awaiting_user_submit: 'application.status.awaitingUserSubmit.description',
  submitted: 'application.status.submitted.description',
  outcome_unknown: 'application.status.outcomeUnknown.description',
  failed: 'application.status.failed.description',
  cancelled: 'application.status.cancelled.description',
  interview: 'application.status.interview.description',
  rejected: 'application.status.rejected.description',
  offer: 'application.status.offer.description',
  withdrawn: 'application.status.withdrawn.description',
};

export const APPLICATION_STATUS_TONE: Record<ApplicationStatus, BadgeTone> = {
  draft: 'neutral',
  preparing: 'info',
  needs_input: 'warning',
  ready_for_review: 'info',
  approved: 'success',
  filling: 'info',
  awaiting_user_submit: 'warning',
  submitted: 'success',
  // Not a failure and not a success. The whole point of the state is that we
  // do not know, so it must not be coloured as either.
  outcome_unknown: 'unknown',
  failed: 'danger',
  cancelled: 'neutral',
  interview: 'success',
  rejected: 'danger',
  offer: 'success',
  withdrawn: 'neutral',
};

/**
 * "Submitted — verified" and "Submitted — reported by you" are different
 * claims, and the spec requires the tracker to keep them apart. A submission
 * the system watched happen and one the user told us about are not the same
 * fact, however identical the row looks.
 */
export function submittedLabel(evidence: EvidenceType | null): MessageKey {
  if (evidence === 'adapter_observed') return 'application.submitted.verified';
  if (evidence === 'user_report') return 'application.submitted.reported';
  return 'application.submitted.unevidenced';
}

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, MessageKey> = {
  adapter_observed: 'evidence.adapterObserved',
  user_report: 'evidence.userReport',
  none: 'evidence.none',
};

export const APPLICATION_EVENT_LABEL: Record<ApplicationEventType, MessageKey> = {
  created: 'applicationEvent.created',
  packet_created: 'applicationEvent.packetCreated',
  packet_approved: 'applicationEvent.packetApproved',
  approval_invalidated: 'applicationEvent.approvalInvalidated',
  approval_expired: 'applicationEvent.approvalExpired',
  fill_requested: 'applicationEvent.fillRequested',
  fill_paused: 'applicationEvent.fillPaused',
  fill_failed: 'applicationEvent.fillFailed',
  submitted: 'applicationEvent.submitted',
  outcome_recorded: 'applicationEvent.outcomeRecorded',
  cancelled: 'applicationEvent.cancelled',
  note: 'applicationEvent.note',
};

export const STALENESS_LABEL: Record<PacketStalenessReason, MessageKey> = {
  profile_revision_changed: 'staleness.profileRevisionChanged',
  job_revision_changed: 'staleness.jobRevisionChanged',
  resume_changed: 'staleness.resumeChanged',
  destination_changed: 'staleness.destinationChanged',
  form_schema_changed: 'staleness.formSchemaChanged',
  approval_expired: 'staleness.approvalExpired',
};

export const PROVENANCE_LABEL: Record<PacketAnswerProvenance, MessageKey> = {
  user_entered: 'answerProvenance.userEntered',
  answer_bank: 'answerProvenance.answerBank',
  profile_fact: 'answerProvenance.profileFact',
  preference: 'answerProvenance.preference',
};

export const UNRESOLVED_REASON_LABEL: Record<UnresolvedReason, MessageKey> = {
  no_answer: 'unresolved.noAnswer',
  new_question: 'unresolved.newQuestion',
  unsupported_widget: 'unresolved.unsupportedWidget',
  needs_exact_mapping: 'unresolved.needsExactMapping',
  never_inferable: 'unresolved.neverInferable',
  file_upload_blocked: 'unresolved.fileUploadBlocked',
};

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, MessageKey> = {
  pending: 'device.status.pending',
  paired: 'device.status.paired',
  revoked: 'device.status.revoked',
  expired: 'device.status.expired',
};

export const DEVICE_STATUS_TONE: Record<DeviceStatus, BadgeTone> = {
  pending: 'warning',
  paired: 'success',
  revoked: 'neutral',
  expired: 'danger',
};
