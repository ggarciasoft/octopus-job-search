/**
 * Reading a Lever-hosted application form from the DOM.
 *
 * A port of the JavaScript snippets in
 * `services/worker/src/job_getter_worker/runner/adapters/lever.py`, the same
 * way `greenhouse.ts` ports its sibling: the same code in TypeScript, returning
 * the same plain shape, which `@job-getter/fill-planner` interprets
 * identically for both clients. `fixtures/fill-planner/lever-page.json` records
 * what Chromium read from the synthetic page, and `tests/parity.test.ts`
 * demands jsdom read the same.
 *
 * **What "tested" means here, exactly.** A synthetic Lever-shaped page,
 * `fixtures/ats-pages/lever-application.html`, whose shape was copied from one
 * public Lever demo posting. No live Lever board has been filled through this
 * and nothing has been submitted.
 *
 * The four ways Lever differs from Greenhouse are each a rule below: the
 * question is named by its `.application-label` rather than by a wrapping
 * `<label>`; the location autocomplete is reported, not typed into; every
 * control in a voluntary self-identification section is labelled as one, so
 * the planner leaves it to the person; and a choice group's own free-text box
 * is part of that group.
 */
import { LEVER_HOSTS, LEVER_MARKER_SELECTOR } from './lever-shape.js';
import type { RawFieldRow } from './greenhouse.js';

export { readConfirmation, type RawConfirmation } from './confirmation.js';
export { LEVER_HOSTS, LEVER_MARKER_SELECTOR };

export const ADAPTER_NAME = 'lever';
export const ADAPTER_VERSION = 'v1';

export const FORM_SELECTOR = 'form#application-form';

/** The prefix every control in a voluntary self-identification section gets. */
export const VOLUNTARY_PREFIX = 'Voluntary self-identification: ';

export function findForm(root: Document): Element | null {
  return root.querySelector(FORM_SELECTOR);
}

/** Whether the page carries a Lever form, by structure. */
export function marker(root: Document): boolean {
  return root.querySelector(LEVER_MARKER_SELECTOR) !== null;
}

/** Whether this adapter claims the page: a Lever host, or Lever's structure. */
export function handles(url: string, markerFound: boolean): boolean {
  if (markerFound) return true;
  try {
    return LEVER_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function readIdentity(root: Document): { company: string; title: string } {
  const text = (selector: string): string =>
    root.querySelector(selector)?.textContent?.trim() ?? '';
  // The page title is "Company - Role"; the logo's alt is "Company logo".
  const parts = (root.title || '').split(' - ');
  const logo = root.querySelector('.main-header-logo img');
  const alt = logo ? (logo.getAttribute('alt') ?? '').replace(/\s+logo\s*$/i, '').trim() : '';
  return {
    company: alt || (parts.length > 1 ? parts[0]!.trim() : ''),
    title:
      text('.posting-header h2') ||
      text('.posting-headline h2') ||
      (parts.length > 1 ? parts.slice(1).join(' - ').trim() : ''),
  };
}

/** Whitespace collapsed, and a trailing `*` or Lever's `✱` (U+2731) dropped. */
function clean(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[*✱]\s*$/, '')
    .trim();
}

function questionOf(el: Element): Element | null {
  return el.closest('.application-question');
}

function questionLabel(question: Element | null): string {
  const label = question?.querySelector('.application-label') ?? null;
  if (label === null) return '';
  // The survey puts a description beside the question; `.text` is the question.
  return (label.querySelector('.text') ?? label).textContent ?? '';
}

function marked(question: Element | null): boolean {
  return question !== null && question.querySelector('.application-label .required') !== null;
}

function labelFor(el: Element): string {
  const own = questionLabel(questionOf(el));
  if (own.trim()) return own;
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  const wrapping = el.closest('label');
  if (wrapping) return wrapping.textContent ?? '';
  return el.getAttribute('placeholder') || el.getAttribute('name') || '';
}

function voluntary(el: Element): boolean {
  return (
    el.closest('.eeo-section') !== null ||
    /^(eeo|surveysResponses)\[/.test(el.getAttribute('name') ?? '')
  );
}

function isRequired(el: Element, raw: string): boolean {
  return (
    (el as HTMLInputElement).required === true ||
    el.getAttribute('aria-required') === 'true' ||
    marked(questionOf(el)) ||
    /[*✱]\s*$/.test(raw)
  );
}

function optionLabel(member: HTMLInputElement): string {
  const wrapping = member.closest('label');
  const alternative = wrapping?.querySelector('.application-answer-alternative') ?? null;
  return (
    clean(alternative ? alternative.textContent : wrapping ? wrapping.textContent : '') ||
    member.value
  );
}

/** `CSS.escape` is absent from some test environments; the fallback is exact. */
function cssEscape(value: string): string {
  const escaper = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape;
  if (escaper) return escaper(value);
  return value.replace(/[^\w-]/g, (character) => `\\${character}`);
}

function selectorFor(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  return '';
}

/**
 * Read the form once and return a plain description.
 *
 * A faithful port of the runner's `_INSPECT_SCRIPT`, including the order of
 * the branches: a `<select>`, a `<textarea>`, a radio or checkbox group (one
 * entry per group, named by its question), a free-text box that belongs to
 * such a group (skipped), an autocomplete or custom widget (reported as
 * undriveable), then a plain input.
 */
export function readFields(root: Document): RawFieldRow[] {
  const form = findForm(root);
  if (form === null) return [];

  const controls = Array.from(form.querySelectorAll('input, select, textarea, [role="combobox"]'));
  const groupNames = new Set(
    controls
      .filter((el) => {
        const type = (el.getAttribute('type') ?? '').toLowerCase();
        return (type === 'radio' || type === 'checkbox') && Boolean(el.getAttribute('name'));
      })
      .map((el) => el.getAttribute('name')),
  );

  const out: RawFieldRow[] = [];
  const seenGroups = new Set<string>();

  for (const el of controls) {
    if ((el as HTMLInputElement).disabled) continue;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    const name = el.getAttribute('name') ?? '';
    const combobox = el.getAttribute('role') === 'combobox';
    // Never submitted with the form, so not a question: Lever's "Custom"
    // pronouns checkbox only reveals the text box below.
    if (!name && !combobox) continue;

    const rawLabel = labelFor(el);
    const label = (voluntary(el) ? VOLUNTARY_PREFIX : '') + clean(rawLabel);
    const required = isRequired(el, rawLabel);

    if (el.tagName === 'SELECT') {
      const options = Array.from((el as HTMLSelectElement).options).filter(
        (option) => option.value !== '',
      );
      out.push({
        selector: selectorFor(el),
        label,
        kind: 'select',
        required,
        options: options.map((option) => clean(option.textContent)),
        option_values: options.map((option) => option.value),
      });
      continue;
    }

    if (el.tagName === 'TEXTAREA') {
      out.push({ selector: selectorFor(el), label, kind: 'textarea', required, options: [] });
      continue;
    }

    if (type === 'radio' || type === 'checkbox') {
      const groupKey = `${type}:${name}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const members = Array.from(
        form.querySelectorAll<HTMLInputElement>(`input[type="${type}"][name="${cssEscape(name)}"]`),
      );
      out.push({
        selector: `input[type="${type}"][name="${cssEscape(name)}"]`,
        label,
        kind: type,
        required: required || members.some((member) => member.required === true),
        options: members.map(optionLabel),
        option_values: members.map((member) => member.value),
      });
      continue;
    }

    // The free-text answer that belongs to a choice group, not a question of its own.
    if (groupNames.has(name)) continue;

    if (combobox || el.tagName !== 'INPUT' || el.classList.contains('location-input')) {
      // An autocomplete or custom widget: named, and reported as undriveable.
      out.push({ selector: selectorFor(el), label, kind: 'custom', required, options: [] });
      continue;
    }

    out.push({ selector: selectorFor(el), label, kind: type || 'text', required, options: [] });
  }

  return out;
}
