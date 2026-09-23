/**
 * Two DOM engines, one fingerprint.
 *
 * `packages/fill-planner`'s parity suite pins the two *planners* to each
 * other. It cannot pin the two *readers*: the Python runner reads an
 * employer's form through Chromium and this extension reads it through its own
 * content script. If those two disagree about what is on a page — one extra
 * field, one different required flag, one option read with a stray space — the
 * form fingerprints differ, and every packet approved through one client reads
 * as stale to the other. Silently, on a real employer's page, at the moment
 * someone is trying to apply.
 *
 * `fixtures/fill-planner/greenhouse-page.json` records what Chromium saw,
 * written by `generate-page.py` beside it and re-asserted against a live
 * Chromium in `services/worker/tests/test_planner_parity.py`. This suite reads
 * the same page in jsdom and demands the same answer.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { fingerprint, parseFields } from '@job-getter/fill-planner';
import { readConfirmation, readFields, readIdentity } from '../src/adapters/greenhouse.js';

interface RecordedPage {
  page: string;
  rows: unknown;
  identity: { company: string; title: string };
  fingerprint: string;
  keys: string[];
}

const recorded = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../fixtures/fill-planner/greenhouse-page.json'), 'utf-8'),
) as RecordedPage[];

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

function read(name: string) {
  const html = readFileSync(resolve(process.cwd(), '../../fixtures/ats-pages', name), 'utf-8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:9999/' + name });
  return dom.window.document;
}

describe('the extension reads a page the way the runner does', () => {
  for (const expected of recorded) {
    describe(expected.page, () => {
      const document = read(expected.page);
      const fields = parseFields(readFields(document));

      it('finds the same question keys, in the same order', () => {
        expect(fields.map((field) => field.key)).toEqual(expected.keys);
      });

      it('produces the same form fingerprint as Chromium did', () => {
        // The assertion this whole package exists to make.
        expect(fingerprint(fields, sha256Hex)).toBe(expected.fingerprint);
      });

      it('reads the same company and role', () => {
        const identity = readIdentity(document);
        expect(identity.company).toBe(expected.identity.company);
        expect(identity.title).toBe(expected.identity.title);
      });

      it('agrees field for field about kind, requiredness and options', () => {
        const chromium = parseFields(expected.rows);
        expect(
          fields.map((field) => ({
            key: field.key,
            kind: field.kind,
            required: field.required,
            options: field.options,
            optionValues: field.optionValues,
          })),
        ).toEqual(
          chromium.map((field) => ({
            key: field.key,
            kind: field.kind,
            required: field.required,
            options: field.options,
            optionValues: field.optionValues,
          })),
        );
      });
    });
  }

  it('records two pages that really are different forms', () => {
    // If the "changed" fixture ever stopped differing, the staleness mechanism
    // would be untested in both clients at once.
    expect(recorded).toHaveLength(2);
    expect(recorded[0]!.fingerprint).not.toBe(recorded[1]!.fingerprint);
  });
});

interface RecordedConfirmation {
  page: string;
  confirmation: { confirmation_text: string; reference: string | null; url: string } | null;
}

const recordedConfirmations = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../fixtures/fill-planner/greenhouse-confirmation.json'),
    'utf-8',
  ),
) as RecordedConfirmation[];

describe('the extension reads a confirmation the way the runner does', () => {
  // Both clients turn this reading into `submitted` evidence. A page one of
  // them calls a confirmation and the other does not would record a
  // submission through one client that the other would never have claimed.
  for (const expected of recordedConfirmations) {
    it(`${expected.page}: ${expected.confirmation ? 'the same words and reference' : 'nothing'}`, () => {
      const url = 'http://127.0.0.1:9999/' + expected.page;
      const found = readConfirmation(read(expected.page), url);
      expect(found === null ? null : { ...found, url: new URL(found.url).pathname }).toEqual(
        expected.confirmation,
      );
    });
  }
});
