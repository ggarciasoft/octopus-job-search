import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';
import { AnswerSensitivity, AnswerValue, QuestionKey } from './answers.js';

/**
 * Applications, packets, approval and the tracker (docs/spec/03_DATA_MODEL.md
 * rows `applications`, `application_packets`, `application_events`;
 * docs/spec/07_APPLICATION_AUTOMATION.md; PR08 and PR09).
 *
 * An application is the record of one attempt to apply for one job. A
 * **packet** is the immutable thing the user approves: which CV, which
 * answers, which exact destination, which profile and job revisions. Approval
 * binds a content hash, not an id, so the sentence "the user approved this"
 * stays true only for as long as the content really is what they read.
 *
 * Three rules shape everything below.
 *
 *  1. **Approval is content-bound and short-lived.** A changed CV, changed
 *     answers, a new profile or job revision, a different destination or a
 *     changed form schema all invalidate it (03_DATA_MODEL.md), and it expires
 *     after `approval_ttl_hours` regardless. Invalidation is detected by
 *     recomputing, never by hoping some other code path remembered to clear a
 *     flag.
 *  2. **Nothing guesses an answer.** A required question with no answer moves
 *     the application to `needs_input` and filling pauses there. That is the
 *     whole of AT14: "Unknown required form question → filling pauses without
 *     guessing."
 *  3. **Uncertainty is a state, not a default.** An unverified post-submit
 *     observation is `outcome_unknown`, never an optimistic `submitted` and
 *     never a `failed`. Nothing retries automatically from there.
 */

/** Hash algorithm generation. Bump when the material below changes shape. */
export const PACKET_HASH_VERSION = 1;

/**
 * Upper bound on approval lifetime. `preferences.limits.approval_ttl_hours`
 * may choose a shorter one; it may not choose a longer one, because the spec
 * fixes 24 hours as the maximum ("Approval binds content_hash and expires
 * after 24 hours").
 */
export const PACKET_APPROVAL_MAX_TTL_HOURS = 24;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * The states from 07_APPLICATION_AUTOMATION.md, in full. Milestones decide
 * which *routes* exist, not which states the model admits: a status vocabulary
 * that grew one state at a time would need its CHECK constraint rewritten in
 * every migration, and the tracker would have to guess what an unknown value
 * written by a newer build meant.
 */
export const ApplicationStatus = Type.Union([
  Type.Literal('draft'),
  Type.Literal('preparing'),
  Type.Literal('needs_input'),
  Type.Literal('ready_for_review'),
  Type.Literal('approved'),
  Type.Literal('filling'),
  Type.Literal('awaiting_user_submit'),
  Type.Literal('submitted'),
  Type.Literal('outcome_unknown'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interview'),
  Type.Literal('rejected'),
  Type.Literal('offer'),
  Type.Literal('withdrawn'),
]);
export type ApplicationStatus = Static<typeof ApplicationStatus>;

export const ALL_APPLICATION_STATUSES = [
  'draft',
  'preparing',
  'needs_input',
  'ready_for_review',
  'approved',
  'filling',
  'awaiting_user_submit',
  'submitted',
  'outcome_unknown',
  'failed',
  'cancelled',
  'interview',
  'rejected',
  'offer',
  'withdrawn',
] as const satisfies readonly ApplicationStatus[];

/**
 * Every transition the domain permits, and nothing else.
 *
 * The primary path is the spec's: draft → preparing → needs_input OR
 * ready_for_review → approved → filling → awaiting_user_submit → submitted.
 * The rest of the table is the spec's exceptions, each one deliberate:
 *
 *  * `approved → preparing` is invalidation. Something the approval covered
 *    changed, so a new packet revision and a new approval are required.
 *  * `approved → ready_for_review` is expiry alone. The content is still
 *    exactly what the user read, so the same packet may be re-approved; only
 *    the clock ran out.
 *  * `approved → submitted` is the manual path. Where no adapter supports the
 *    site, the user applies in their own browser and reports it — the honest
 *    fallback AT17 asks for, rather than a fill state that never happens.
 *  * `filling → needs_input` is the new-question rule: "If the actual form
 *    contains new questions, pause, store the schema, collect answers".
 *  * `outcome_unknown → submitted` requires evidence; `outcome_unknown →
 *    preparing` is the user saying it never went through. Nothing leaves that
 *    state on its own, and nothing retries from it.
 *  * `failed → preparing` is "Failure before submission permits preparing
 *    again after correction".
 *  * Cancellation is available before submission only. After submission the
 *    equivalent is `withdrawn`, and only when the user confirms they withdrew.
 */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  draft: ['preparing', 'cancelled'],
  preparing: ['needs_input', 'ready_for_review', 'failed', 'cancelled'],
  needs_input: ['preparing', 'cancelled'],
  ready_for_review: ['approved', 'preparing', 'cancelled'],
  approved: ['filling', 'preparing', 'ready_for_review', 'submitted', 'cancelled'],
  filling: ['awaiting_user_submit', 'needs_input', 'failed', 'preparing', 'cancelled'],
  awaiting_user_submit: ['submitted', 'outcome_unknown', 'failed', 'cancelled'],
  submitted: ['interview', 'rejected', 'offer', 'withdrawn', 'outcome_unknown'],
  outcome_unknown: ['submitted', 'preparing'],
  failed: ['preparing', 'cancelled'],
  cancelled: [],
  interview: ['rejected', 'offer', 'withdrawn'],
  rejected: [],
  offer: [],
  withdrawn: [],
};

/** Statuses from which nothing further happens. */
export const TERMINAL_APPLICATION_STATUSES = [
  'cancelled',
  'rejected',
  'offer',
  'withdrawn',
] as const satisfies readonly ApplicationStatus[];

/** At or past submission: cancellation is no longer available. */
export const SUBMITTED_APPLICATION_STATUSES = [
  'submitted',
  'outcome_unknown',
  'interview',
  'rejected',
  'offer',
  'withdrawn',
] as const satisfies readonly ApplicationStatus[];

export function isAllowedApplicationTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  if (from === to) return true;
  return APPLICATION_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Who caused an event. `system` is the API's own reconciliation. */
export const ApplicationActor = Type.Union([
  Type.Literal('user'),
  Type.Literal('system'),
  Type.Literal('runner'),
]);
export type ApplicationActor = Static<typeof ApplicationActor>;

export const ALL_APPLICATION_ACTORS = [
  'user',
  'system',
  'runner',
] as const satisfies readonly ApplicationActor[];

export const ApplicationEventType = Type.Union([
  Type.Literal('created'),
  Type.Literal('packet_created'),
  Type.Literal('packet_approved'),
  Type.Literal('approval_invalidated'),
  Type.Literal('approval_expired'),
  Type.Literal('fill_requested'),
  Type.Literal('fill_paused'),
  Type.Literal('fill_failed'),
  Type.Literal('submitted'),
  Type.Literal('outcome_recorded'),
  Type.Literal('cancelled'),
  Type.Literal('note'),
]);
export type ApplicationEventType = Static<typeof ApplicationEventType>;

export const ALL_APPLICATION_EVENT_TYPES = [
  'created',
  'packet_created',
  'packet_approved',
  'approval_invalidated',
  'approval_expired',
  'fill_requested',
  'fill_paused',
  'fill_failed',
  'submitted',
  'outcome_recorded',
  'cancelled',
  'note',
] as const satisfies readonly ApplicationEventType[];

export const ApplicationEventView = Type.Object(
  {
    id: Uuid,
    /** Dense, per application, starting at 1. Append-only. */
    sequence: Type.Integer({ minimum: 1 }),
    type: ApplicationEventType,
    actor: ApplicationActor,
    status_before: Type.Union([ApplicationStatus, Type.Null()]),
    status_after: Type.Union([ApplicationStatus, Type.Null()]),
    /** Machine-readable reason, e.g. a staleness code. */
    reason: Type.Union([Type.String({ maxLength: 120 }), Type.Null()]),
    /** Redacted detail: counts, ids and codes, never answer text. */
    data: Type.Record(Type.String(), Type.Unknown()),
    occurred_at: Timestamp,
  },
  { additionalProperties: false },
);
export type ApplicationEventView = Static<typeof ApplicationEventView>;

// ---------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------

/**
 * Where an answer came from, which decides whether it may be used at all.
 *
 *  * `user_entered` — typed for this application. Always permitted.
 *  * `answer_bank` — a previously confirmed answer, reused within its
 *    approved scope. Refused for `never_reuse` questions.
 *  * `profile_fact` — copied from a confirmed profile fact.
 *  * `preference` — copied from validated preferences, e.g. a salary minimum.
 *
 * There is deliberately no `inferred` or `model_generated` member. A value the
 * system invented is not an answer the user can stand behind, and a shape that
 * cannot express one cannot accidentally send one.
 */
export const PacketAnswerProvenance = Type.Union([
  Type.Literal('user_entered'),
  Type.Literal('answer_bank'),
  Type.Literal('profile_fact'),
  Type.Literal('preference'),
]);
export type PacketAnswerProvenance = Static<typeof PacketAnswerProvenance>;

export const ALL_PACKET_ANSWER_PROVENANCES = [
  'user_entered',
  'answer_bank',
  'profile_fact',
  'preference',
] as const satisfies readonly PacketAnswerProvenance[];

export const PacketAnswer = Type.Object(
  {
    question_key: QuestionKey,
    /** The question as it appears on the form, for the review screen. */
    label: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    /**
     * Null means "not answered yet". Combined with `required`, that is what
     * puts the application into `needs_input` rather than letting a blank
     * through as though it were an answer.
     */
    answer: Type.Union([AnswerValue, Type.Null()]),
    required: Type.Boolean(),
    sensitivity: AnswerSensitivity,
    provenance: PacketAnswerProvenance,
    /** The answer-bank entry or profile fact this came from, when it did. */
    source_id: Type.Union([Uuid, Type.Null()]),
  },
  { additionalProperties: false },
);
export type PacketAnswer = Static<typeof PacketAnswer>;

/**
 * The exact destination, resolved server-side from the job's provenance rather
 * than accepted from the client. A packet whose destination the caller chose
 * would be an approval for one page that authorises filling another.
 */
export const PacketDestination = Type.Object(
  {
    url: Type.String({ maxLength: 2000 }),
    /** Scheme and host only. The runner refuses to fill anywhere else. */
    origin: Type.String({ maxLength: 500 }),
    connector: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    connector_version: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type PacketDestination = Static<typeof PacketDestination>;

/**
 * Exactly what `content_hash` is computed over.
 *
 * The hash is the SHA-256, hex-encoded, of this object serialised as canonical
 * JSON: object keys sorted lexicographically at every level, no insignificant
 * whitespace, UTF-8. `answers` is sorted by `question_key` before hashing, so
 * two packets differing only in the order the UI happened to send fields are
 * the same packet.
 *
 * It is a named, exported schema because the local runner must be able to
 * recompute it independently before it fills anything. A hash only one side
 * can compute is a hash the other side has to take on trust.
 */
export const PacketHashMaterial = Type.Object(
  {
    hash_version: Type.Integer({ minimum: 1 }),
    profile_revision: Type.Integer({ minimum: 1 }),
    job_id: Uuid,
    job_revision: Type.Integer({ minimum: 1 }),
    resume_id: Uuid,
    /** SHA-256 of the bytes that would actually be attached. */
    resume_sha256: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    destination: PacketDestination,
    /** Known form schema, once the runner has inspected the page. */
    form_fingerprint: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    answers: Type.Array(
      Type.Object(
        {
          question_key: QuestionKey,
          answer: Type.Union([AnswerValue, Type.Null()]),
          provenance: PacketAnswerProvenance,
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
  },
  { additionalProperties: false },
);
export type PacketHashMaterial = Static<typeof PacketHashMaterial>;

/**
 * Why a packet no longer matches the world it snapshotted. Each code is one of
 * the things 03_DATA_MODEL.md names as invalidating an approval.
 */
export const PacketStalenessReason = Type.Union([
  Type.Literal('profile_revision_changed'),
  Type.Literal('job_revision_changed'),
  Type.Literal('resume_changed'),
  Type.Literal('destination_changed'),
  Type.Literal('form_schema_changed'),
  Type.Literal('approval_expired'),
]);
export type PacketStalenessReason = Static<typeof PacketStalenessReason>;

export const ALL_PACKET_STALENESS_REASONS = [
  'profile_revision_changed',
  'job_revision_changed',
  'resume_changed',
  'destination_changed',
  'form_schema_changed',
  'approval_expired',
] as const satisfies readonly PacketStalenessReason[];

export const ApplicationPacketView = Type.Object(
  {
    id: Uuid,
    application_id: Uuid,
    revision: Type.Integer({ minimum: 1 }),
    profile_revision: Type.Integer({ minimum: 1 }),
    job_revision: Type.Integer({ minimum: 1 }),
    resume_id: Uuid,
    resume_sha256: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    destination: PacketDestination,
    answers: Type.Array(PacketAnswer, { maxItems: 200 }),
    form_fingerprint: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    content_hash: Type.String({ maxLength: 64 }),
    /**
     * The hash the user approved. Null until they do; equal to `content_hash`
     * while the approval still refers to the content they read.
     */
    approved_hash: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    approved_at: Type.Union([Timestamp, Type.Null()]),
    expires_at: Type.Union([Timestamp, Type.Null()]),
    /** Required questions still unanswered. Filling cannot start with any. */
    unresolved_question_keys: Type.Array(QuestionKey, { maxItems: 200 }),
    /** Live comparison against the current profile, job, CV and destination. */
    staleness: Type.Array(PacketStalenessReason, { maxItems: 10 }),
    created_at: Timestamp,
  },
  { additionalProperties: false },
);
export type ApplicationPacketView = Static<typeof ApplicationPacketView>;

// ---------------------------------------------------------------------------
// Evidence and outcomes
// ---------------------------------------------------------------------------

/**
 * How we know what happened. `user_report` entries "remain visibly labeled"
 * (07_APPLICATION_AUTOMATION.md), which is why the tracker distinguishes
 * "Submitted — verified" from "Submitted — reported by you"
 * (08_UX_AND_CUSTOMIZATION.md).
 */
export const EvidenceType = Type.Union([
  Type.Literal('adapter_observed'),
  Type.Literal('user_report'),
  Type.Literal('none'),
]);
export type EvidenceType = Static<typeof EvidenceType>;

export const ALL_EVIDENCE_TYPES = [
  'adapter_observed',
  'user_report',
  'none',
] as const satisfies readonly EvidenceType[];

export const SubmissionEvidence = Type.Object(
  {
    evidence_type: EvidenceType,
    /** Normalised confirmation text observed on the page, if any. */
    confirmation_text: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    /** Application or requisition reference the employer showed. */
    reference: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    observed_at: Type.Union([Timestamp, Type.Null()]),
    /** Only ever set when the user consented to evidence capture. */
    screenshot_file_id: Type.Union([Uuid, Type.Null()]),
    note: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SubmissionEvidence = Static<typeof SubmissionEvidence>;

/**
 * What the user can report. These are outcomes, not arbitrary state writes:
 * the API maps each to a transition and refuses it when the machine does not
 * allow it from where the application currently is.
 *
 * `not_submitted` exists for exactly one case — leaving `outcome_unknown` by
 * saying it never went through — and returns the application to `preparing`.
 */
export const ApplicationOutcome = Type.Union([
  Type.Literal('submitted'),
  Type.Literal('not_submitted'),
  Type.Literal('outcome_unknown'),
  Type.Literal('interview'),
  Type.Literal('rejected'),
  Type.Literal('offer'),
  Type.Literal('withdrawn'),
  Type.Literal('cancelled'),
]);
export type ApplicationOutcome = Static<typeof ApplicationOutcome>;

export const ALL_APPLICATION_OUTCOMES = [
  'submitted',
  'not_submitted',
  'outcome_unknown',
  'interview',
  'rejected',
  'offer',
  'withdrawn',
  'cancelled',
] as const satisfies readonly ApplicationOutcome[];

// ---------------------------------------------------------------------------
// Views and requests
// ---------------------------------------------------------------------------

export const ApplicationView = Type.Object(
  {
    id: Uuid,
    job_id: Uuid,
    /** Denormalised for the tracker list so it need not fetch every job. */
    company: Type.String({ maxLength: 200 }),
    title: Type.String({ maxLength: 300 }),
    status: ApplicationStatus,
    /** Optimistic concurrency for every mutation on this application. */
    revision: Type.Integer({ minimum: 1 }),
    current_packet: Type.Union([ApplicationPacketView, Type.Null()]),
    submission_evidence: Type.Union([SubmissionEvidence, Type.Null()]),
    submitted_at: Type.Union([Timestamp, Type.Null()]),
    /**
     * Other applications in this workspace for jobs this one may duplicate.
     * Reported, never merged: "Similar title/location alone creates a
     * possible-duplicate warning, not an automatic merge."
     */
    possible_duplicate_application_ids: Type.Array(Uuid, { maxItems: 20 }),
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);
export type ApplicationView = Static<typeof ApplicationView>;

/**
 * Creating an application for a job that already has one returns the existing
 * one rather than failing: "Two simultaneous application creates return the
 * existing application using the unique job constraint."
 */
export const CreateApplicationRequest = Type.Object(
  { job_id: Uuid },
  { additionalProperties: false },
);
export type CreateApplicationRequest = Static<typeof CreateApplicationRequest>;

/**
 * A new packet revision. Packets are never edited: "Only explicit revision
 * creation alters a packet", so every change to the CV or the answers is a new
 * row with a new hash, and an approval of the old one stays attached to the
 * content it was given.
 */
export const CreatePacketRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    resume_id: Uuid,
    answers: Type.Array(PacketAnswer, { maxItems: 200 }),
    /** Supplied once the runner has inspected the real form. */
    form_fingerprint: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type CreatePacketRequest = Static<typeof CreatePacketRequest>;

/**
 * The caller must name the hash it read. If the packet's content hash has
 * moved on, the approval is refused with 409 rather than applied to whatever
 * the packet says now — that is AT13 ("Edit packet after approval → old
 * approval rejected; user must reapprove").
 */
export const ApproveApplicationRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    packet_id: Uuid,
    content_hash: Type.String({ minLength: 64, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type ApproveApplicationRequest = Static<typeof ApproveApplicationRequest>;

export const ApplicationOutcomeRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    outcome: ApplicationOutcome,
    evidence_type: EvidenceType,
    evidence: Type.Optional(
      Type.Object(
        {
          confirmation_text: Type.Optional(
            Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
          ),
          reference: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
          url: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
          observed_at: Type.Optional(Type.Union([Timestamp, Type.Null()])),
          screenshot_file_id: Type.Optional(Type.Union([Uuid, Type.Null()])),
          note: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ApplicationOutcomeRequest = Static<typeof ApplicationOutcomeRequest>;

export const ApplicationsListQuery = Type.Object(
  {
    status: Type.Optional(ApplicationStatus),
    job_id: Type.Optional(Uuid),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type ApplicationsListQuery = Static<typeof ApplicationsListQuery>;
