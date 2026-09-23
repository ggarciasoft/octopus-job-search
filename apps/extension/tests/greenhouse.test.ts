/**
 * The TypeScript Greenhouse reader, against the same synthetic page the Python
 * adapter is tested on.
 *
 * `fixtures/ats-pages/greenhouse-application.html` is driven by a real
 * Chromium in `services/worker/tests/test_runner_greenhouse.py`; here it is
 * driven by jsdom. Using the one fixture for both is the point: two readers of
 * the same page that disagree about what is on it would produce two different
 * fingerprints and two different sets of questions for the person to answer.
 *
 * **This is a fixture, not a live board.** Nothing here establishes that a
 * real Greenhouse page still has this shape, and the support matrix must not
 * claim otherwise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { parseFields, normalizeQuestionKey } from '@job-getter/fill-planner';
import {
  findForm,
  handles,
  readConfirmation,
  readFields,
  readIdentity,
} from '../src/adapters/greenhouse.js';

function load(name: string): Document {
  // Resolved from the package root rather than `import.meta.url`: under jsdom
  // Vitest rewrites module URLs to its own `/@fs/` scheme, which is not a
  // filesystem path.
  const path = resolve(process.cwd(), '../../fixtures/ats-pages', name);
  return new JSDOM(readFileSync(path, 'utf-8'), { url: 'https://boards.greenhouse.io/acme/jobs/1' })
    .window.document;
}

const page = load('greenhouse-application.html');

describe('handles', () => {
  it('claims a Greenhouse host even before the page is read', () => {
    expect(handles('https://boards.greenhouse.io/acme/jobs/1', false)).toBe(true);
    expect(handles('https://job-boards.greenhouse.io/acme/jobs/1', false)).toBe(true);
  });

  it('claims an employer-hosted embed by its structure', () => {
    // An adapter that only recognised a hostname would be one redirect away
    // from filling a page it has never seen.
    expect(handles('https://careers.acme.example/apply', true)).toBe(true);
  });

  it('claims nothing else', () => {
    expect(handles('https://careers.acme.example/apply', false)).toBe(false);
    expect(handles('not a url', false)).toBe(false);
  });
});

describe('reading the synthetic Greenhouse form', () => {
  it('finds the application form', () => {
    expect(findForm(page)).not.toBeNull();
  });

  it('reads a company and a title', () => {
    const identity = readIdentity(page);
    expect(identity.company).not.toBe('');
    expect(identity.title).not.toBe('');
  });

  it('reports every control it can name, and names them stably', () => {
    const rows = readFields(page);
    expect(rows.length).toBeGreaterThan(3);

    const fields = parseFields(rows);
    const keys = fields.map((field) => field.key);
    // The keys are derived from labels by the shared normaliser, never from
    // the markup, so the same question is the same key in both clients.
    for (const field of fields) {
      if (field.key === '') continue;
      expect(field.key).toBe(normalizeQuestionKey(field.label));
      expect(field.key).toMatch(/^[a-z0-9_]+$/);
    }
    expect(new Set(keys.filter(Boolean)).size).toBe(keys.filter(Boolean).length);
  });

  it('marks the file input as a file, so the CV has somewhere to go', () => {
    const fields = parseFields(readFields(page));
    expect(fields.some((field) => field.kind === 'file')).toBe(true);
  });

  it('collapses a radio or checkbox group into one field carrying its options', () => {
    const fields = parseFields(readFields(page));
    const choices = fields.filter(
      (field) => field.kind === 'radio' || field.kind === 'checkbox' || field.kind === 'select',
    );
    for (const field of choices) {
      expect(field.options.length).toBeGreaterThan(0);
      expect(field.optionValues.length).toBe(field.options.length);
    }
  });

  it('reports a widget it cannot drive rather than treating it as text', () => {
    const dom = new JSDOM(
      `<form id="application_form">
         <label for="when">Start date</label>
         <div id="when" role="combobox" aria-label="Start date"></div>
       </form>`,
      { url: 'https://boards.greenhouse.io/a/b' },
    ).window.document;
    const fields = parseFields(readFields(dom));
    expect(fields[0]!.kind).toBe('unsupported');
  });

  it('returns nothing at all for a page with no application form', () => {
    const dom = new JSDOM('<p>A blog post.</p>', { url: 'https://example.invalid/post' }).window
      .document;
    expect(readFields(dom)).toEqual([]);
  });

  it('sees a different form when the page changes', () => {
    // The "changed" fixture exists to make an approval go stale. If the two
    // read identically, that mechanism is not being tested at all.
    const changed = parseFields(readFields(load('greenhouse-application-changed.html')));
    const original = parseFields(readFields(page));
    expect(changed).not.toEqual(original);
  });
});

describe('reading a confirmation', () => {
  function html(body: string) {
    return new JSDOM(`<body>${body}</body>`, { url: 'https://boards.greenhouse.io/x/jobs/1' })
      .window.document;
  }

  it('ignores a footer that merely says thank you', () => {
    const page = html('<main><h1>Open roles</h1></main><footer>Thank you for applying!</footer>');
    expect(readConfirmation(page, 'https://boards.greenhouse.io/x')).toBeNull();
  });

  it('accepts an explicit statement in a heading, and finds a reference beside it', () => {
    const page = html('<h2>Thank you for applying</h2><p>Reference number: AB-1234</p>');
    expect(readConfirmation(page, 'https://boards.greenhouse.io/x')).toEqual({
      confirmation_text: 'Thank you for applying',
      reference: 'AB-1234',
      url: 'https://boards.greenhouse.io/x',
    });
  });

  it('keeps a trailing asterisk: evidence is not a label to tidy', () => {
    const page = html('<div id="application_confirmation">Application received *</div>');
    expect(readConfirmation(page, 'u')?.confirmation_text).toBe('Application received *');
  });

  it('claims no reference when the page shows none', () => {
    const page = html('<div role="status">Your application has been received.</div>');
    expect(readConfirmation(page, 'u')?.reference).toBeNull();
  });
});
