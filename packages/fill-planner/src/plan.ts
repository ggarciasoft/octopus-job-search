/**
 * Deciding what to type, and what to refuse to type.
 *
 * A port of `services/worker/src/job_getter_worker/runner/plan.py`, kept
 * behaviourally identical and pinned to it by the golden vectors in
 * `fixtures/fill-planner/`. This is the whole of a fill client's judgement,
 * and it is deliberately a pure function over `FormField` and the packet's
 * answers: no page, no network, no model. Everything it will not do is easier
 * to see that way.
 *
 * `docs/spec/07_APPLICATION_AUTOMATION.md` sets the rules and each one is a
 * branch below:
 *
 *  * "Checkbox/select answers require exact confirmed mappings; do not
 *    fuzzy-match legal authorization." A choice field is filled only when the
 *    answer equals an offered option exactly, ignoring surrounding whitespace
 *    and case. Nothing else — no prefix match, no synonym table, no "the
 *    closest one".
 *  * "Never answer assessments, personality tests, identity verification, or
 *    medical/demographic questions using inferred values." Those labels are
 *    classified `never_reuse` and are left for the person even when an answer
 *    with the same key happens to be in the packet.
 *  * "Questions such as salary expectation or years of experience need
 *    explicit facts/preferences, not free-form guesses." There is no code path
 *    that produces a value the packet did not contain, for any field.
 *  * "Do not claim every iframe, shadow DOM or custom widget is supported." A
 *    widget the adapter could not model is reported as unsupported, not
 *    skipped silently.
 *
 * A field the planner cannot fill is not a gap to paper over. It becomes an
 * `UnresolvedField`, which the API turns into a question in the next packet
 * revision for the user to answer.
 */
import type {
  AnswerValue,
  FillField,
  UnresolvedField,
  UnresolvedReason,
} from '@job-getter/contracts';
import { CHOICE_KINDS, FREE_TEXT_KINDS, sensitivityFor, type FormField } from './forms.js';

/** One field the client will actually type into. */
export interface PlannedValue {
  readonly field: FormField;
  /**
   * For a choice field this is the exact option label. For free text it is the
   * answer rendered as a string. For a checkbox group, several options.
   */
  readonly values: readonly string[];
  /** The attachment to upload, when the field is a file input. */
  readonly upload: boolean;
}

export interface FillPlan {
  readonly values: readonly PlannedValue[];
  readonly unresolved: readonly UnresolvedField[];
}

export function hasUnresolvedRequired(plan: FillPlan): boolean {
  return plan.unresolved.some((item) => item.required);
}

/**
 * Render a packet answer for comparison and typing.
 *
 * A boolean becomes `yes`/`no` because that is what forms offer; it is still
 * only *used* when it matches an option exactly, so this is a rendering
 * choice, not a mapping one.
 *
 * The number branch mirrors Python's `float.is_integer()`: `60000.0` is the
 * same expectation as `60000` and should read that way. JavaScript has one
 * numeric type, so `Number.isInteger` covers both of Python's `int` and
 * integral `float`, and a non-integral value goes through `String()` — which
 * agrees with Python's `str()` for every value a JSON packet can carry.
 */
function asStrings(answer: AnswerValue): readonly string[] {
  if (typeof answer === 'boolean') return [answer ? 'yes' : 'no'];
  if (Array.isArray(answer)) return answer.map((item) => String(item));
  if (typeof answer === 'number') return [String(answer)];
  return [String(answer)];
}

/**
 * Exact match on an offered option, ignoring case and surrounding space.
 *
 * This is the only comparison in the module. Anything looser would let
 * "Yes, with sponsorship" satisfy an answer of "Yes".
 *
 * Python compares with `casefold()`; the nearest JavaScript has is
 * `toLocaleLowerCase()`, and the two differ on a few characters (German ß
 * being the well-known one). The fixtures pin the cases that matter; a form
 * whose options differ only by such a character is a form both clients will
 * decline to fill rather than fill differently, because a failed match is an
 * unresolved field, never a guess.
 */
function matchOption(value: string, options: readonly string[]): string | null {
  const wanted = value.trim().toLowerCase();
  for (const option of options) {
    if (option.trim().toLowerCase() === wanted) return option;
  }
  return null;
}

function unresolved(
  field: FormField,
  reason: UnresolvedReason,
  overrides: { required?: boolean } = {},
): UnresolvedField {
  return {
    question_key: field.key,
    // Passed through as-is, exactly as `_unresolved` in `plan.py` does. Only
    // the unnamed-control branch below maps an empty label to null, and it is
    // the only branch that can reach one: a key is derived from a label, so a
    // field with a key has a label.
    label: field.label,
    required: overrides.required ?? field.required,
    reason,
    options: [...field.options],
  };
}

/** Decide, field by field, what will be typed and what will be asked. */
export function buildPlan(
  fields: readonly FormField[],
  answers: readonly FillField[],
  options: { hasAttachment: boolean },
): FillPlan {
  const byKey = new Map(answers.map((answer) => [answer.question_key, answer]));

  const values: PlannedValue[] = [];
  const unresolvedFields: UnresolvedField[] = [];

  for (const field of fields) {
    if (field.key === '') {
      // A control nobody can name cannot be matched to an answer and cannot be
      // asked about coherently either. Reported, never guessed.
      unresolvedFields.push({
        question_key: 'unnamed_field',
        label: field.label === '' ? null : field.label,
        required: field.required,
        reason: 'unsupported_widget',
        options: [...field.options],
      });
      continue;
    }

    if (field.kind === 'unsupported') {
      unresolvedFields.push(unresolved(field, 'unsupported_widget'));
      continue;
    }

    if (field.kind === 'file') {
      if (options.hasAttachment) {
        values.push({ field, values: [], upload: true });
      } else {
        unresolvedFields.push(unresolved(field, 'file_upload_blocked'));
      }
      continue;
    }

    // The question is one the spec forbids answering from a stored value. It
    // stays unresolved whether or not the packet happens to carry a matching
    // key: the person answers it, on this form, this time.
    if (sensitivityFor(field.label) === 'never_reuse') {
      unresolvedFields.push(unresolved(field, 'never_inferable'));
      continue;
    }

    const answer = byKey.get(field.key);
    if (answer === undefined) {
      // Python computes `"no_answer" if key in known_keys else "new_question"`
      // at this point, where `known_keys` is the key set of the very map the
      // lookup just missed — so the condition cannot hold and the branch is
      // always `new_question`. Ported as it behaves, not as it reads: the API
      // sends only answered fields, so a field with no matching answer is
      // genuinely a question this packet has never seen. `no_answer` is still
      // reachable below, for an answer that renders to empty text.
      unresolvedFields.push(unresolved(field, 'new_question'));
      continue;
    }

    const rendered = asStrings(answer.answer);

    if (CHOICE_KINDS.has(field.kind)) {
      const matched = rendered
        .map((value) => matchOption(value, field.options))
        .filter((option): option is string => option !== null);
      if (matched.length !== rendered.length || matched.length === 0) {
        unresolvedFields.push(unresolved(field, 'needs_exact_mapping'));
        continue;
      }
      values.push({ field, values: matched, upload: false });
      continue;
    }

    if (FREE_TEXT_KINDS.has(field.kind)) {
      const text = rendered.join(', ').trim();
      if (text === '') {
        unresolvedFields.push(unresolved(field, 'no_answer'));
        continue;
      }
      values.push({ field, values: [text], upload: false });
      continue;
    }

    unresolvedFields.push(unresolved(field, 'unsupported_widget'));
  }

  return { values, unresolved: unresolvedFields };
}
