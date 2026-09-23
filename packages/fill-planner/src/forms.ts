/**
 * The vendor-neutral description of a form, and how a question is named.
 *
 * This is a port of `services/worker/src/job_getter_worker/runner/forms.py`,
 * and the port is the point: the local desktop runner (Python, M4) and the
 * browser extension (TypeScript, M5) fill the same employer forms from the
 * same packets, and they must agree about what a form *is*.
 *
 * **The fingerprint is the hard constraint.** A packet records the form schema
 * it was approved against, and an approval is withdrawn when the live schema
 * no longer matches. If these two implementations digest the same form
 * differently, then every packet approved through one client reads as stale to
 * the other — silently, and only on a real employer's page. So the two are
 * pinned to each other by shared golden vectors in `fixtures/fill-planner/`,
 * asserted by `tests/parity.test.ts` here and by
 * `services/worker/tests/test_planner_parity.py` there. Change the rules in
 * one and both suites fail, which is the only arrangement that survives
 * someone editing one file and not the other.
 *
 * Two rules matter more than the rest, and they are the Python module's
 * verbatim:
 *
 * **A question key is derived, never invented.** It comes from the field's
 * accessible label by a deterministic normalisation, so the same question on
 * the same form is the same key on every run, and an answer stored under that
 * key means what it says.
 *
 * **Classification only ever narrows.** `sensitivityFor` marks a label as
 * `never_reuse` when it looks like a demographic, identity or assessment
 * question. It can be wrong in one direction only: it may refuse to reuse an
 * answer that would have been fine, and it may not permit reuse of one that
 * would not.
 */
import type { AnswerSensitivity } from '@job-getter/contracts';

/** Longest key the contract's `QuestionKey` pattern accepts. */
export const MAX_QUESTION_KEY_LENGTH = 120;

/** What kind of control this is, from the planner's point of view. */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'file'
  /**
   * A widget the adapter recognised but cannot drive: a rich text editor, a
   * custom combobox, a date picker with no text input behind it. Named rather
   * than omitted, so the user is told it needs them.
   */
  | 'unsupported';

export const ALL_FIELD_KINDS: readonly FieldKind[] = [
  'text',
  'textarea',
  'email',
  'tel',
  'url',
  'number',
  'select',
  'radio',
  'checkbox',
  'file',
  'unsupported',
];

/**
 * Kinds whose value must exactly match one of the offered options. Guessing
 * here is how a "no" becomes a "yes" on a work-authorization question.
 */
export const CHOICE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'select',
  'radio',
  'checkbox',
]);

/** Kinds a plain string can be typed into. */
export const FREE_TEXT_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'text',
  'textarea',
  'email',
  'tel',
  'url',
  'number',
]);

/**
 * Label fragments that mark a question as one the spec forbids answering from
 * a stored or inferred value. Matched case-insensitively as substrings, which
 * over-matches on purpose: the cost of an unnecessary pause is a question the
 * user answers themselves, and the cost of a miss is a false statement about
 * their health, ethnicity or identity sent to an employer.
 *
 * Order and contents must match `NEVER_REUSE_LABEL_FRAGMENTS` in `forms.py`.
 */
export const NEVER_REUSE_LABEL_FRAGMENTS: readonly string[] = [
  'gender',
  'race',
  'ethnic',
  'hispanic',
  'latino',
  'veteran',
  'disability',
  'disabled',
  'sexual orientation',
  'date of birth',
  'birth date',
  'social security',
  'ssn',
  'national id',
  'identity verification',
  'passport number',
  "driver's license",
  'assessment',
  'personality',
  'criminal',
  'background check',
  'medical',
  'pregnan',
  'religio',
  // Lever asks for pronouns beside the name, an age range in its demographic
  // survey, and a name and date as the signature on a disability form. The
  // Lever reader prefixes every control in those voluntary sections with
  // "Voluntary self-identification", so the last fragment catches all of them,
  // including a signature labelled only "Name".
  'pronoun',
  'age range',
  'self-identif',
];

/** Fragments that mark a question as personal but reusable within its scope. */
export const SENSITIVE_LABEL_FRAGMENTS: readonly string[] = [
  'phone',
  'address',
  'salary',
  'compensation',
  'visa',
  'sponsor',
  'work authorization',
  'right to work',
  'notice period',
];

/**
 * Turn a visible label into a stable key.
 *
 * Lower-cased, non-alphanumeric runs collapsed to `_`, trimmed to the
 * contract's length. An empty or punctuation-only label yields `""`; the
 * caller decides what to do about a field nobody can name, which is always
 * "report it as unsupported", never "make one up".
 *
 * `[^a-z0-9]+` is applied *after* lower-casing, exactly as the Python does,
 * so a label in another script collapses to the empty string in both. The
 * comparison is ASCII on both sides: `toLowerCase()` and `str.lower()` differ
 * on a handful of non-ASCII characters, but none of them survive the
 * subsequent strip, so the result cannot diverge.
 */
export function normalizeQuestionKey(label: string): string {
  const collapsed = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  return collapsed.slice(0, MAX_QUESTION_KEY_LENGTH);
}

/** Classify a question by its label. Only ever narrows what may be reused. */
export function sensitivityFor(label: string): AnswerSensitivity {
  const lowered = label.toLowerCase();
  if (NEVER_REUSE_LABEL_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    return 'never_reuse';
  }
  if (SENSITIVE_LABEL_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    return 'sensitive';
  }
  return 'standard';
}

/** One control on the page, as the planner sees it. */
export interface FormField {
  readonly key: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  /** Exact option labels for a choice field, in page order. Empty otherwise. */
  readonly options: readonly string[];
  /**
   * The value each option submits, positionally aligned with `options`. The
   * label is what a person reads and what an answer is matched against; the
   * value is what the control needs.
   */
  readonly optionValues: readonly string[];
  /** How the driver reaches this control again. Opaque to the planner. */
  readonly selector: string;
}

export function formField(
  partial: Partial<FormField> & { key: string; kind: FieldKind },
): FormField {
  return {
    label: '',
    required: false,
    options: [],
    optionValues: [],
    selector: '',
    ...partial,
  };
}

export interface FormSchema {
  readonly fields: readonly FormField[];
}

/**
 * A stable digest of the *shape* of a form.
 *
 * Keys, kinds, required-ness and option sets, sorted by key. Deliberately not
 * the labels' exact text or the page's markup: a reworded heading is not a
 * different form, while a new required question or a changed option list is.
 * A packet approved against one fingerprint is not approved against another.
 *
 * Every detail here is load-bearing for parity with Python and none of it is
 * free to "improve":
 *
 *  * the sort is by key, and it is Python's `sorted()` — a plain code-unit
 *    ordering, which `Array.prototype.sort()` without a comparator also does;
 *  * `int(required)` renders `1`/`0`, not `true`/`false`;
 *  * options are sorted and joined with `|`, so a reordered `<select>` is the
 *    same form;
 *  * parts are joined with `\n`, hashed as UTF-8, and the digest is truncated
 *    to 32 hex characters behind a `v1:` prefix.
 */
export function fingerprintMaterial(fields: readonly FormField[]): string {
  const parts = [...fields]
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map((item) => {
      const options = [...item.options]
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .join('|');
      return `${item.key}:${item.kind}:${item.required ? 1 : 0}:${options}`;
    });
  return parts.join('\n');
}

/**
 * The fingerprint itself.
 *
 * The hash is injected rather than imported because this package must run
 * unchanged in a content script, in Node and in a test: `node:crypto` is
 * synchronous and absent from a browser, and `crypto.subtle` is present but
 * asynchronous. Splitting the material from the digest also makes the parity
 * fixtures sharper — a mismatched *string* names the field that diverged,
 * where a mismatched digest only says that something did.
 */
export function fingerprint(
  fields: readonly FormField[],
  sha256Hex: (input: string) => string,
): string {
  return `v1:${sha256Hex(fingerprintMaterial(fields)).slice(0, 32)}`;
}
