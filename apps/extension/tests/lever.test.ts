/**
 * The TypeScript Lever reader, against the same synthetic page the Python
 * adapter is tested on in `services/worker/tests/test_runner_lever.py`.
 *
 * `tests/parity.test.ts` already demands this reader and Chromium agree about
 * every field. This suite says what the fields must *be*, through the shared
 * planner, on the questions where a Lever page invites a false answer.
 *
 * **This is a fixture, not a live board.** Nothing here establishes that a
 * real Lever page still has this shape, and the support matrix must not claim
 * otherwise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { buildPlan, parseFields } from '@job-getter/fill-planner';
import type { FillField } from '@job-getter/contracts';
import {
  VOLUNTARY_PREFIX,
  handles,
  marker,
  readFields,
  readIdentity,
} from '../src/adapters/lever.js';

const URL_ = 'https://jobs.lever.co/orbital-foods/6f2c1a3e-1111-4a2b-9c3d-000000000001/apply';

function load(name: string): Document {
  const path = resolve(process.cwd(), '../../fixtures/ats-pages', name);
  return new JSDOM(readFileSync(path, 'utf-8'), { url: URL_ }).window.document;
}

const page = load('lever-application.html');
const fields = parseFields(readFields(page));
const byKey = new Map(fields.map((field) => [field.key, field]));

function answer(question_key: string, value: FillField['answer']): FillField {
  return {
    question_key,
    label: question_key,
    answer: value,
    required: true,
    sensitivity: 'standard',
  } as FillField;
}

describe('handles', () => {
  it('claims a Lever host even before the page is read', () => {
    expect(handles(URL_, false)).toBe(true);
    expect(handles(URL_.replace('jobs.', 'jobs.eu.'), false)).toBe(true);
  });

  it('claims a Lever form by its structure, and nothing else', () => {
    expect(marker(page)).toBe(true);
    expect(marker(load('greenhouse-application.html'))).toBe(false);
    expect(handles('https://careers.acme.example/apply', false)).toBe(false);
    expect(handles('not a url', false)).toBe(false);
  });
});

describe('reading the synthetic Lever form', () => {
  it('reads who the page says it is', () => {
    expect(readIdentity(page)).toEqual({ company: 'Orbital Foods', title: 'Platform Engineer' });
  });

  it('names a question by its label, not by everything inside the <label>', () => {
    // The wrapping label also holds "ATTACH RESUME/CV" and "Analyzing resume...".
    expect(byKey.get('resume_cv')).toMatchObject({ label: 'Resume/CV', kind: 'file' });
    expect(byKey.get('which_of_these_have_you_worked_with')?.label).toBe(
      'Which of these have you worked with?',
    );
  });

  it('treats Lever’s heavy asterisk as required, with or without the attribute', () => {
    expect(byKey.get('full_name')?.required).toBe(true);
    expect(byKey.get('why_do_you_want_to_work_at_orbital_foods')?.required).toBe(true);
    expect(byKey.get('current_company')?.required).toBe(false);
  });

  it('reads pronouns as one question, without the Custom scaffolding', () => {
    expect(fields.filter((field) => field.key.includes('pronoun'))).toHaveLength(1);
    expect(byKey.get('pronouns')?.options).toEqual(['He/him', 'She/her', 'They/them']);
  });

  it('reports the location autocomplete rather than typing into it', () => {
    expect(byKey.get('current_location')?.kind).toBe('unsupported');
  });

  it('reads an EEO option by its name, not its description', () => {
    expect(byKey.get('voluntary_self_identification_race')?.options).toEqual([
      'Group A',
      'Group B',
      'Decline to self-identify',
    ]);
  });

  it('finds no hidden input and no button', () => {
    expect(fields).toHaveLength(21);
    expect(fields.every((field) => field.key !== '')).toBe(true);
  });
});

describe('planning a Lever form', () => {
  const plan = buildPlan(
    fields,
    [
      answer('full_name', 'Ada Lovelace'),
      answer('are_you_legally_authorized_to_work_in_spain', 'Yes'),
      answer('current_location', 'Madrid, Spain'),
      // Every one of these is a key the page really produces.
      answer('pronouns', ['She/her']),
      answer('voluntary_self_identification_gender', 'Female'),
      answer('voluntary_self_identification_name', 'Ada Lovelace'),
      answer('voluntary_self_identification_what_is_your_age_range', '30 or older'),
    ],
    { hasAttachment: true },
  );
  const planned = new Map(plan.values.map((value) => [value.field.key, value.values]));
  const reasons = new Map(plan.unresolved.map((item) => [item.question_key, item.reason]));

  it('fills what the packet answers', () => {
    expect(planned.get('full_name')).toEqual(['Ada Lovelace']);
    expect(planned.get('are_you_legally_authorized_to_work_in_spain')).toEqual(['Yes']);
  });

  it('never signs the disability form, or answers any voluntary question', () => {
    for (const field of fields.filter((item) => item.label.startsWith(VOLUNTARY_PREFIX))) {
      expect(planned.has(field.key), field.key).toBe(false);
      expect(reasons.get(field.key), field.key).toBe('never_inferable');
    }
    expect(reasons.get('pronouns')).toBe('never_inferable');
  });

  it('leaves the location to the person, and pauses on the referral code', () => {
    expect(reasons.get('current_location')).toBe('unsupported_widget');
    expect(reasons.get('internal_referral_code')).toBe('new_question');
  });
});
