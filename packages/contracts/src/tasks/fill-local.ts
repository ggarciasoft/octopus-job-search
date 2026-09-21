import { Type, type Static } from '@sinclair/typebox';
import { Uuid } from '../common.js';
import { AnswerSensitivity, AnswerValue, QuestionKey } from '../schemas/answers.js';
import { PacketDestination } from '../schemas/applications.js';

/**
 * `fill_local`: the paired local desktop runner filling an approved packet
 * into the employer's own form (docs/spec/07_APPLICATION_AUTOMATION.md,
 * "Local browser runner M4"; PR09).
 *
 * This task type is claimable only by a paired runner, never by the operator
 * worker (`RUNNER_ONLY_CAPABILITIES`), and it is never retried
 * (`NO_RETRY_TASK_TYPES`): a second attempt would be a second attempt at
 * someone's real application, against a page that may have changed underneath
 * the first.
 *
 * Four things this input deliberately does **not** contain:
 *
 *  * **The profile.** The runner gets the answers for this one application and
 *    nothing else. A process on the user's desktop has no need for their
 *    employment history to fill a form that never asks for it.
 *  * **Provider secrets.** There is no inference in this path at all.
 *  * **A free-choice URL.** The destination is the one the approved packet
 *    binds, and `allowed_origins` bounds where the browser may go. "Never
 *    navigate through unexpected external origins without user interaction."
 *  * **A submit instruction.** There is no field that could ask for one. The
 *    runner never clicks final submit in v1; the outcome it reports at best is
 *    `awaiting_user_submit`.
 */

/**
 * One field the runner is allowed to type into, with the provenance already
 * resolved by the API. Sensitivity travels with the value so the runner can
 * keep it out of its own logs.
 */
export const FillField = Type.Object(
  {
    question_key: QuestionKey,
    label: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    answer: AnswerValue,
    required: Type.Boolean(),
    sensitivity: AnswerSensitivity,
  },
  { additionalProperties: false },
);
export type FillField = Static<typeof FillField>;

/**
 * What the runner compares the page against before it types anything.
 *
 * "Runner claims only its owner's fill_local work and rechecks origin, packet
 * approval, job identity and duplicate state." Job identity is here so the
 * recheck is possible without a second round trip: a page whose visible
 * employer and title do not match is a page this packet was not approved for.
 */
export const FillJobIdentity = Type.Object(
  {
    job_id: Uuid,
    company: Type.String({ maxLength: 200 }),
    title: Type.String({ maxLength: 300 }),
  },
  { additionalProperties: false },
);
export type FillJobIdentity = Static<typeof FillJobIdentity>;

export const FillLocalInput = Type.Object(
  {
    application_id: Uuid,
    packet_id: Uuid,
    /** The approved content hash, so the runner can verify what it is acting on. */
    content_hash: Type.String({ minLength: 64, maxLength: 64 }),
    device_id: Uuid,
    destination: PacketDestination,
    /** Scheme-and-host origins the browser may visit. Nothing else. */
    allowed_origins: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
    job: FillJobIdentity,
    /** The CV to attach, fetched through the lease-scoped task file endpoint. */
    resume_file_id: Type.Union([Uuid, Type.Null()]),
    resume_sha256: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    resume_filename: Type.Union([Type.String({ maxLength: 260 }), Type.Null()]),
    fields: Type.Array(FillField, { maxItems: 200 }),
    /** The form schema the packet was approved against, when one was known. */
    known_form_fingerprint: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    /** Which versioned site adapter to try; null means none is known. */
    adapter: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type FillLocalInput = Static<typeof FillLocalInput>;

/** Per-field result. `skipped` means the field was not on the page at all. */
export const FillFieldOutcome = Type.Union([
  Type.Literal('filled'),
  Type.Literal('skipped'),
  Type.Literal('failed'),
]);
export type FillFieldOutcome = Static<typeof FillFieldOutcome>;

export const ALL_FILL_FIELD_OUTCOMES = [
  'filled',
  'skipped',
  'failed',
] as const satisfies readonly FillFieldOutcome[];

export const FilledField = Type.Object(
  {
    question_key: QuestionKey,
    outcome: FillFieldOutcome,
    /** The accessible name the adapter matched, for the review screen. */
    matched_label: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type FilledField = Static<typeof FilledField>;

/**
 * Why a field on the page was left alone. Each of these is a case where the
 * only correct action is to stop and ask, and none of them is a case where a
 * plausible value may be supplied.
 */
export const UnresolvedReason = Type.Union([
  Type.Literal('no_answer'),
  Type.Literal('new_question'),
  Type.Literal('unsupported_widget'),
  Type.Literal('needs_exact_mapping'),
  Type.Literal('never_inferable'),
  Type.Literal('file_upload_blocked'),
]);
export type UnresolvedReason = Static<typeof UnresolvedReason>;

export const ALL_UNRESOLVED_REASONS = [
  'no_answer',
  'new_question',
  'unsupported_widget',
  'needs_exact_mapping',
  'never_inferable',
  'file_upload_blocked',
] as const satisfies readonly UnresolvedReason[];

export const UnresolvedField = Type.Object(
  {
    question_key: QuestionKey,
    label: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    required: Type.Boolean(),
    reason: UnresolvedReason,
    /** Exact option labels, when the field is a select or radio group. */
    options: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type UnresolvedField = Static<typeof UnresolvedField>;

/**
 * What the run amounted to.
 *
 *  * `awaiting_user_submit` — the form is filled and waiting for the person.
 *  * `needs_input` — the page asked something the packet does not answer, so
 *    the run paused (AT14).
 *  * `unsupported` — no tested adapter matched this page. The honest manual
 *    fallback of AT17: the packet is kept, and the user is told to apply in
 *    their own browser rather than being shown a half-filled form.
 *
 * There is no `submitted`. The runner cannot produce one, because it never
 * clicks final submit.
 */
export const FillOutcome = Type.Union([
  Type.Literal('awaiting_user_submit'),
  Type.Literal('needs_input'),
  Type.Literal('unsupported'),
]);
export type FillOutcome = Static<typeof FillOutcome>;

export const ALL_FILL_OUTCOMES = [
  'awaiting_user_submit',
  'needs_input',
  'unsupported',
] as const satisfies readonly FillOutcome[];

export const FillLocalResult = Type.Object(
  {
    packet_id: Uuid,
    filled_fields: Type.Array(FilledField, { maxItems: 200 }),
    unresolved_fields: Type.Array(UnresolvedField, { maxItems: 200 }),
    /** Where the browser actually ended up. Compared against the destination. */
    page_url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    /** A stable digest of the form's field set, so a changed form is visible. */
    form_fingerprint: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    outcome: FillOutcome,
    /** The adapter that handled the page, and its version. */
    adapter: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    adapter_version: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    /** Only when the user consented to evidence capture. Usually null. */
    screenshot_file_id: Type.Union([Uuid, Type.Null()]),
  },
  { additionalProperties: false },
);
export type FillLocalResult = Static<typeof FillLocalResult>;

/**
 * POST /applications/:id/fill. The device is named explicitly: a workspace may
 * have several paired runners, and "the one that happens to poll first" is not
 * a choice the user made.
 */
export const FillApplicationRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    packet_id: Uuid,
    device_id: Uuid,
  },
  { additionalProperties: false },
);
export type FillApplicationRequest = Static<typeof FillApplicationRequest>;
