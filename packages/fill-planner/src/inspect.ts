/**
 * Turning what a page reader saw into fields, and checking the page is the
 * one the packet names.
 *
 * A port of the browser-free half of
 * `services/worker/src/job_getter_worker/runner/adapters/base.py`. The Python
 * runner splits each page operation into a JavaScript snippet that reads the
 * DOM and a pure function that interprets the result; the extension runs the
 * same snippet in a content script and needs the same interpretation. Keeping
 * the interpretation here rather than in the extension's adapter is what stops
 * "which control is required" and "what is this question called" from becoming
 * two different answers in two clients.
 *
 * The snippet's output shape is part of this contract rather than each
 * adapter's:
 *
 *     [{"selector", "label", "kind", "required", "options": [...],
 *       "option_values": [...]}]
 */
import { normalizeQuestionKey, type FieldKind, type FormField } from './forms.js';

/** Kinds the shared parser understands from an HTML input `type`. */
const INPUT_KINDS: Readonly<Record<string, FieldKind>> = {
  text: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  search: 'text',
  textarea: 'textarea',
  select: 'select',
  radio: 'radio',
  checkbox: 'checkbox',
  file: 'file',
};

/**
 * Map a control's reported type onto a planner kind.
 *
 * Anything unrecognised — a date picker, a rich text editor, a custom
 * combobox — becomes `unsupported` rather than being optimistically treated as
 * text. "Do not claim every iframe, shadow DOM or custom widget is supported."
 */
export function kindFromRaw(raw: string): FieldKind {
  return INPUT_KINDS[raw.trim().toLowerCase()] ?? 'unsupported';
}

/** One row as a page-reading snippet reports it. Every field is untrusted. */
export interface RawField {
  readonly selector?: unknown;
  readonly label?: unknown;
  readonly kind?: unknown;
  readonly required?: unknown;
  readonly options?: unknown;
  readonly option_values?: unknown;
}

function text(value: unknown): string {
  // Mirrors Python's `str(entry.get(...) or "")`: null, undefined, false, 0
  // and "" all collapse to the empty string.
  if (value === null || value === undefined || value === false || value === 0) return '';
  return String(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Turn the inspection snippet's JSON into fields.
 *
 * A row missing its selector or label is dropped to an unnamed unsupported
 * field rather than discarded: a control the client cannot name is still a
 * control the user needs to be told about. Two controls that normalise to one
 * key would make an answer ambiguous, so the second is reported as unsupported
 * and the user sees both rather than one silently overwriting the other.
 */
export function parseFields(
  raw: unknown,
  keyFor: (label: string) => string = normalizeQuestionKey,
): FormField[] {
  const fields: FormField[] = [];
  const seen = new Set<string>();

  for (const entry of list(raw)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const row = entry as RawField;

    const label = text(row.label).trim();
    const selector = text(row.selector);
    const kind = kindFromRaw(text(row.kind));
    const required = Boolean(row.required);

    // `zip(..., strict=False)` in Python stops at the shorter sequence; the
    // values default to the labels when the snippet supplied none.
    const rawOptions = list(row.options);
    const rawValues = list(row.option_values).length > 0 ? list(row.option_values) : rawOptions;
    const options: string[] = [];
    const optionValues: string[] = [];
    for (let index = 0; index < Math.min(rawOptions.length, rawValues.length); index += 1) {
      const option = String(rawOptions[index]);
      if (option.trim() === '') continue;
      options.push(option);
      optionValues.push(String(rawValues[index]));
    }

    const key = keyFor(label);
    if (seen.has(key)) {
      fields.push({
        key: '',
        label,
        kind: 'unsupported',
        required,
        options,
        optionValues,
        selector,
      });
      continue;
    }
    if (key !== '') seen.add(key);
    fields.push({ key, label, kind, required, options, optionValues, selector });
  }

  return fields;
}

/** What the page says it is, as the page says it. */
export interface PageIdentity {
  readonly company: string | null;
  readonly title: string | null;
  readonly url: string;
  readonly origin: string;
}

/** Whether the page matches the job this packet was approved for. */
export interface IdentityCheck {
  readonly matches: boolean;
  readonly reason: string | null;
}

export function parseIdentity(raw: unknown, url: string, origin: string): PageIdentity {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const company = text(data.company).trim();
  const title = text(data.title).trim();
  return {
    company: company === '' ? null : company,
    title: title === '' ? null : title,
    url,
    origin,
  };
}

function normalise(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

/**
 * Compare what the page says against what the packet was approved for.
 *
 * The comparison is containment in either direction after whitespace and case
 * normalisation, because boards decorate titles ("Senior Engineer (Remote)")
 * and companies ("Acme, Inc."). A page that states neither is *not* treated as
 * matching: "Check all linked identities before filling" cannot be satisfied
 * by a page that declines to say who it belongs to.
 */
export function checkIdentity(
  page: PageIdentity,
  expectedCompany: string,
  expectedTitle: string,
): IdentityCheck {
  if (page.company === null && page.title === null) {
    return { matches: false, reason: 'the page does not state a company or a role' };
  }

  const comparisons: readonly [string | null, string, string][] = [
    [page.company, expectedCompany, 'company'],
    [page.title, expectedTitle, 'role'],
  ];
  for (const [observed, expected, what] of comparisons) {
    if (observed === null || expected.trim() === '') continue;
    const left = normalise(observed);
    const right = normalise(expected);
    if (!right.includes(left) && !left.includes(right)) {
      return { matches: false, reason: `the page's ${what} is not the one this packet names` };
    }
  }
  return { matches: true, reason: null };
}
