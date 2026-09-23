/**
 * Reading a Greenhouse-shaped application form from the DOM.
 *
 * A port of the JavaScript snippets in
 * `services/worker/src/job_getter_worker/runner/adapters/greenhouse.py`, which
 * the Python runner evaluates through Playwright. They were already plain
 * DOM JavaScript with no Playwright API inside them, so this is the same code
 * in TypeScript rather than a second reader — and it returns the same plain
 * shape, which `@job-getter/fill-planner` then interprets identically for both
 * clients.
 *
 * **What "tested" means here, exactly.** These are exercised against the same
 * synthetic page the Python adapter is, `fixtures/ats-pages/greenhouse-application.html`,
 * through jsdom. They have not been run against a live Greenhouse board and no
 * application has been submitted through them. The support matrix must say
 * that rather than "Greenhouse supported": a fixture is not a live board.
 *
 * Nothing here interprets. It does not decide what a question is called, which
 * widget is unsupported or what may be typed — it reports what it saw, and the
 * shared planner decides. That split is why the interesting behaviour is
 * testable without a browser at all.
 */

import { LEVER_HOSTS, LEVER_MARKER_SELECTOR } from './lever-shape.js';

export const ADAPTER_NAME = 'greenhouse';
export const ADAPTER_VERSION = 'v1';

/** Hosts Greenhouse itself serves application forms from. */
export const GREENHOUSE_HOSTS: readonly string[] = [
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'my.greenhouse.io',
];

/**
 * The container every Greenhouse application form has had. Also what the
 * synthetic fixture carries, because the fixture is a copy of the shape.
 */
export const FORM_SELECTOR = "#application_form, #application-form, form[action*='greenhouse']";

/**
 * Whether this adapter claims the page.
 *
 * Structure matters as much as host, because Greenhouse serves the same form
 * from several of its own domains and from employers' own domains through an
 * embed — and because an adapter that only recognises a hostname is one
 * redirect away from filling a page it has never seen.
 */
export function handles(url: string, markerFound: boolean): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (GREENHOUSE_HOSTS.includes(host)) return true;
  if (LEVER_HOSTS.includes(host)) return false;
  return markerFound;
}

export function findForm(root: Document): Element | null {
  return root.querySelector(FORM_SELECTOR);
}

/**
 * Whether the page carries a Greenhouse form, by structure.
 *
 * Lever's form is also `#application-form`, so the container alone would claim
 * a Lever page. A form built from Lever's question blocks is `lever.ts`'s.
 */
export function marker(root: Document): boolean {
  return findForm(root) !== null && root.querySelector(LEVER_MARKER_SELECTOR) === null;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').replace(/\*$/, '').trim();
}

export function readIdentity(root: Document): { company: string; title: string } {
  const text = (selector: string): string => {
    const node = root.querySelector(selector);
    return node?.textContent?.trim() ?? '';
  };
  const siteName = root.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;
  return {
    company: text('[data-qa="company-name"]') || text('.company-name') || (siteName ?? ''),
    title: text('.app-title') || text('h1') || root.title,
  };
}

/** One row of the shape `@job-getter/fill-planner`'s `parseFields` consumes. */
export interface RawFieldRow {
  selector: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[];
  option_values?: string[];
}

function labelFor(form: Element, root: Document, el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => root.getElementById(id))
      .filter((node): node is HTMLElement => node !== null)
      .map((node) => node.textContent ?? '');
    if (parts.length > 0) return parts.join(' ');
  }

  if (el.id) {
    const explicit = form.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (explicit) return explicit.textContent ?? '';
  }

  const wrapping = el.closest('label');
  if (wrapping) return wrapping.textContent ?? '';

  const group = el.closest('fieldset');
  const legend = group?.querySelector('legend');
  if (legend) return legend.textContent ?? '';

  return el.getAttribute('placeholder') || (el as HTMLInputElement).name || '';
}

function isRequired(el: Element, label: string): boolean {
  return (
    (el as HTMLInputElement).required === true ||
    el.getAttribute('aria-required') === 'true' ||
    /\*\s*$/.test(label) ||
    /\(required\)/i.test(label)
  );
}

function selectorFor(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const name = (el as HTMLInputElement).name;
  if (name) return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  return '';
}

/** `CSS.escape` is absent from some test environments; the fallback is exact. */
function cssEscape(value: string): string {
  const escaper = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape;
  if (escaper) return escaper(value);
  return value.replace(/[^\w-]/g, (character) => `\\${character}`);
}

/**
 * Read the form once and return a plain description.
 *
 * Deliberately a faithful port, including the order of the branches: a
 * `<select>`, then a `<textarea>`, then a radio or checkbox *group* (one entry
 * per group, named by its legend, carrying every offered option), then
 * anything with `role="combobox"` or any non-`<input>` element as an
 * explicitly unsupported widget, then a plain input.
 */
export function readFields(root: Document): RawFieldRow[] {
  const form = findForm(root);
  if (form === null) return [];

  const out: RawFieldRow[] = [];
  const seenGroups = new Set<string>();

  for (const el of form.querySelectorAll('input, select, textarea, [role="combobox"]')) {
    if ((el as HTMLInputElement).disabled) continue;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;

    const rawLabel = labelFor(form, root, el);
    const label = clean(rawLabel);
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
      const name = (el as HTMLInputElement).name;
      const groupKey = `${type}:${name}`;
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);

      const members = Array.from(
        form.querySelectorAll<HTMLInputElement>(`input[type="${type}"][name="${cssEscape(name)}"]`),
      );
      const fieldset = el.closest('fieldset');
      const legend = fieldset ? clean(fieldset.querySelector('legend')?.textContent) : '';
      out.push({
        selector: `input[type="${type}"][name="${cssEscape(name)}"]`,
        label: legend || label,
        kind: type,
        required:
          members.some((member) => isRequired(member, labelFor(form, root, member))) ||
          (fieldset ? /\*\s*$/.test(legend) : false),
        options: members.map((member) => clean(labelFor(form, root, member)) || member.value),
        option_values: members.map((member) => member.value),
      });
      continue;
    }

    if (el.getAttribute('role') === 'combobox' || el.tagName !== 'INPUT') {
      // A custom widget: recognised, named, and reported as undriveable.
      out.push({ selector: selectorFor(el), label, kind: 'custom', required, options: [] });
      continue;
    }

    out.push({ selector: selectorFor(el), label, kind: type || 'text', required, options: [] });
  }

  return out;
}

/**
 * Confirmations are read by one conservative reader shared by every adapter;
 * re-exported so this module stays the Greenhouse reader in full.
 */
export { readConfirmation, type RawConfirmation } from './confirmation.js';
