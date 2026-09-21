import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';

/**
 * The answer bank (docs/spec/03_DATA_MODEL.md row `answer_bank`;
 * docs/spec/07_APPLICATION_AUTOMATION.md "Adapter interface"; PR08).
 *
 * Application forms ask the same handful of questions over and over, and
 * retyping them is most of the tedium this product exists to remove. The bank
 * therefore stores what the user has already answered — but the spec is
 * emphatic about where reuse stops, and those limits are encoded here rather
 * than left to a reviewer to remember:
 *
 *  1. **An answer is reused only under the scope it was approved for.** A
 *     salary expectation the user confirmed for one company is not an answer
 *     about every company, so `scope` and `scope_id` travel with the value and
 *     are checked before it may appear in a packet.
 *  2. **Some questions may never be answered from stored values at all.**
 *     Assessments, personality tests, identity verification and
 *     medical/demographic questions are `never_reuse`: the user answers them
 *     on the form, every time, or they go unanswered and filling pauses.
 *  3. **An answer expires if the user says it does.** "Available from" and
 *     notice periods go stale silently, and a stale answer sent to an employer
 *     is a false statement, so `expires_at` is honoured on read.
 */

/**
 * How widely an answer may be reused.
 *
 * `general` is the whole workspace, `company` is one employer, `job` is a
 * single posting. Widening an answer's scope is a user action, never an
 * inference from "they answered the same thing twice".
 */
export const AnswerScope = Type.Union([
  Type.Literal('general'),
  Type.Literal('company'),
  Type.Literal('job'),
]);
export type AnswerScope = Static<typeof AnswerScope>;

export const ALL_ANSWER_SCOPES = [
  'general',
  'company',
  'job',
] as const satisfies readonly AnswerScope[];

/**
 * What kind of question this is, which decides what may be done with the
 * answer without asking again.
 *
 *  * `standard` — ordinary application questions. Reusable within scope.
 *  * `sensitive` — personal data the user chose to store (phone number, right
 *    to work details). Reusable within scope, never logged, never exported
 *    into diagnostics.
 *  * `never_reuse` — assessments, personality tests, identity verification and
 *    medical or demographic questions. The spec forbids answering these with
 *    inferred values; a stored answer is an inference the moment it is applied
 *    to a different form, so these are stored for the user's own reference and
 *    are refused as packet provenance.
 */
export const AnswerSensitivity = Type.Union([
  Type.Literal('standard'),
  Type.Literal('sensitive'),
  Type.Literal('never_reuse'),
]);
export type AnswerSensitivity = Static<typeof AnswerSensitivity>;

export const ALL_ANSWER_SENSITIVITIES = [
  'standard',
  'sensitive',
  'never_reuse',
] as const satisfies readonly AnswerSensitivity[];

/**
 * The value shapes a form field can carry. Deliberately closed: a free-form
 * object would let a caller smuggle structure into a field the renderer and
 * the runner both treat as a scalar.
 */
export const AnswerValue = Type.Union([
  Type.String({ maxLength: 5000 }),
  Type.Number(),
  Type.Boolean(),
  Type.Array(Type.String({ maxLength: 500 }), { maxItems: 50 }),
]);
export type AnswerValue = Static<typeof AnswerValue>;

/** Stable identifier for a question, e.g. `work_authorization_us`. */
export const QuestionKey = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: '^[a-z0-9_.:-]+$',
});

export const AnswerBankEntry = Type.Object(
  {
    id: Uuid,
    question_key: QuestionKey,
    /** The question as the user last saw it, so the bank is readable. */
    label: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    answer: AnswerValue,
    sensitivity: AnswerSensitivity,
    scope: AnswerScope,
    /**
     * Normalised company name for `company` scope, job id for `job` scope,
     * null for `general`. The pairing is enforced by the database.
     */
    scope_id: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    /**
     * When the user confirmed this value. An unconfirmed row exists (the user
     * typed it into a packet) but may not be reused elsewhere.
     */
    confirmed_at: Type.Union([Timestamp, Type.Null()]),
    expires_at: Type.Union([Timestamp, Type.Null()]),
    created_at: Timestamp,
    updated_at: Timestamp,
  },
  { additionalProperties: false },
);
export type AnswerBankEntry = Static<typeof AnswerBankEntry>;

/**
 * Upsert on (question_key, scope, scope_id). PUT rather than POST because the
 * triple is the identity: answering the same question twice for the same
 * company replaces the answer instead of accumulating two of them, which is
 * what would eventually send an employer the older one.
 */
export const AnswerBankPutRequest = Type.Object(
  {
    question_key: QuestionKey,
    label: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    answer: AnswerValue,
    sensitivity: Type.Optional(AnswerSensitivity),
    scope: Type.Optional(AnswerScope),
    scope_id: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
    /** Defaults to true: a PUT from the settings screen is the user speaking. */
    confirmed: Type.Optional(Type.Boolean()),
    expires_at: Type.Optional(Type.Union([Timestamp, Type.Null()])),
  },
  { additionalProperties: false },
);
export type AnswerBankPutRequest = Static<typeof AnswerBankPutRequest>;

export const AnswerBankListQuery = Type.Object(
  {
    question_key: Type.Optional(QuestionKey),
    scope: Type.Optional(AnswerScope),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export type AnswerBankListQuery = Static<typeof AnswerBankListQuery>;
