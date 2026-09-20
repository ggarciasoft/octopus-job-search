/**
 * The status vocabulary required by 08_UX_AND_CUSTOMIZATION.md:
 *
 *   "Explain 'Not checked', 'Unknown', 'Needs your answer', 'Ready for
 *    review', 'Waiting for submission', 'Submitted—verified', and
 *    'Submitted—reported by you' distinctly."
 *
 * It is a *closed* union with a tone, an icon hint and a description so that no
 * screen can invent a status string, and so that the two submitted states can
 * never be collapsed into one another. Invariant 5 of
 * 00_AI_IMPLEMENTATION_INSTRUCTIONS.md forbids calling an application submitted
 * without evidence or an explicit, labeled user report, and `evidence` is the
 * field that keeps those apart in code rather than in prose.
 */
import type { BadgeTone } from './Badge';

export const STATUS_KEYS = [
  'not_checked',
  'unknown',
  'needs_your_answer',
  'ready_for_review',
  'waiting_for_submission',
  'submitted_verified',
  'submitted_reported_by_you',
] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

/**
 * How the state came to be known.
 *
 * - `none`        nothing has been attempted yet
 * - `insufficient` it was attempted and the answer is genuinely not knowable
 * - `user_input`  the user still has to supply something
 * - `system`      derived by the system from data it holds
 * - `verified`    observed evidence of submission exists
 * - `user_reported` the user told us, and we say so out loud
 */
export type StatusEvidence =
  | 'none'
  | 'insufficient'
  | 'user_input'
  | 'system'
  | 'verified'
  | 'user_reported';

/** Icon *hint*: the design layer picks the glyph, the vocabulary picks meaning. */
export type StatusIconHint =
  | 'dash'
  | 'question'
  | 'inbox'
  | 'eye'
  | 'clock'
  | 'check-verified'
  | 'check-reported';

export interface StatusDescriptor {
  readonly key: StatusKey;
  readonly tone: BadgeTone;
  readonly icon: StatusIconHint;
  readonly evidence: StatusEvidence;
  /** True for both submitted states; never a substitute for `evidence`. */
  readonly submitted: boolean;
  /** English fallback. Localised screens pass `labelKey` through a catalogue. */
  readonly defaultLabel: string;
  readonly defaultDescription: string;
  readonly labelKey: `status.${StatusKey}.label`;
  readonly descriptionKey: `status.${StatusKey}.description`;
}

const descriptor = (
  key: StatusKey,
  tone: BadgeTone,
  icon: StatusIconHint,
  evidence: StatusEvidence,
  submitted: boolean,
  defaultLabel: string,
  defaultDescription: string,
): StatusDescriptor => ({
  key,
  tone,
  icon,
  evidence,
  submitted,
  defaultLabel,
  defaultDescription,
  labelKey: `status.${key}.label`,
  descriptionKey: `status.${key}.description`,
});

export const STATUS_VOCABULARY: Readonly<Record<StatusKey, StatusDescriptor>> = {
  not_checked: descriptor(
    'not_checked',
    'neutral',
    'dash',
    'none',
    false,
    'Not checked',
    'Nothing has looked at this yet. It is not a negative result.',
  ),
  unknown: descriptor(
    'unknown',
    'unknown',
    'question',
    'insufficient',
    false,
    'Unknown',
    'This was checked and the answer could not be determined. Unknown never counts as a yes.',
  ),
  needs_your_answer: descriptor(
    'needs_your_answer',
    'attention',
    'inbox',
    'user_input',
    false,
    'Needs your answer',
    'Something cannot continue until you supply or confirm a fact. Nothing is guessed on your behalf.',
  ),
  ready_for_review: descriptor(
    'ready_for_review',
    'info',
    'eye',
    'system',
    false,
    'Ready for review',
    'A draft is prepared and waiting for you to read it. Nothing has been sent.',
  ),
  waiting_for_submission: descriptor(
    'waiting_for_submission',
    'warning',
    'clock',
    'system',
    false,
    'Waiting for submission',
    'You approved this, and the final submit still has to be performed by you in your browser.',
  ),
  submitted_verified: descriptor(
    'submitted_verified',
    'success',
    'check-verified',
    'verified',
    true,
    'Submitted — verified',
    'Evidence of the submission was captured, such as a confirmation page or an acknowledgement email.',
  ),
  submitted_reported_by_you: descriptor(
    'submitted_reported_by_you',
    'info',
    'check-reported',
    'user_reported',
    true,
    'Submitted — reported by you',
    'You told us you submitted this. No evidence was captured, so it is recorded as your report, not as a verified fact.',
  ),
};

export const STATUS_DESCRIPTORS: readonly StatusDescriptor[] = STATUS_KEYS.map(
  (key) => STATUS_VOCABULARY[key],
);

export function describeStatus(key: StatusKey): StatusDescriptor {
  return STATUS_VOCABULARY[key];
}

export function isStatusKey(value: unknown): value is StatusKey {
  return typeof value === 'string' && (STATUS_KEYS as readonly string[]).includes(value);
}

/**
 * The one question the rest of the product is allowed to ask about evidence.
 * Only `submitted_verified` answers true: a user report is a report.
 */
export function isVerifiedSubmission(key: StatusKey): boolean {
  return STATUS_VOCABULARY[key].evidence === 'verified';
}

export function isSubmitted(key: StatusKey): boolean {
  return STATUS_VOCABULARY[key].submitted;
}
