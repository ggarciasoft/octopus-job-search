/**
 * The TypeScript planner must agree with the Python one, exactly.
 *
 * Two clients fill the same employer forms from the same packets: the desktop
 * runner (Python, M4) and the browser extension (TypeScript, M5). A packet
 * records the form fingerprint it was approved against, and an approval is
 * withdrawn when the live schema no longer matches — so if the two
 * implementations digest a form differently, every packet approved through one
 * reads as stale to the other. Silently, and only on a real employer's page.
 *
 * `fixtures/fill-planner/vectors.json` is generated from the Python
 * implementation (see `generate.py` beside it) and asserted here and by
 * `services/worker/tests/test_planner_parity.py`. Regenerating after a
 * deliberate Python change breaks this suite immediately, which is the signal
 * to port the change rather than discover the drift in production.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FillField, UnresolvedField } from '@job-getter/contracts';
import {
  buildPlan,
  checkIdentity,
  fingerprint,
  fingerprintMaterial,
  hasUnresolvedRequired,
  normalizeQuestionKey,
  parseFields,
  parseIdentity,
  sensitivityFor,
  type FieldKind,
  type FormField,
} from '../src/index.js';

const VECTORS_PATH = fileURLToPath(
  new URL('../../../fixtures/fill-planner/vectors.json', import.meta.url),
);

interface FieldVector {
  key: string;
  label: string;
  kind: string;
  required: boolean;
  options: string[];
  option_values: string[];
  selector: string;
}

interface Vectors {
  normalize_question_key: { label: string; key: string }[];
  sensitivity_for: { label: string; sensitivity: string }[];
  fingerprint: {
    name: string;
    fields: FieldVector[];
    material: string;
    fingerprint: string;
  }[];
  parse_fields: { name: string; raw: unknown; fields: FieldVector[] }[];
  check_identity: {
    name: string;
    raw: unknown;
    expected_company: string;
    expected_title: string;
    identity: { company: string | null; title: string | null };
    result: { matches: boolean; reason: string | null };
  }[];
  build_plan: {
    name: string;
    fields: FieldVector[];
    answers: FillField[];
    has_attachment: boolean;
    plan: {
      values: { key: string; values: string[]; upload: boolean }[];
      unresolved: UnresolvedField[];
      has_unresolved_required: boolean;
    };
  }[];
}

const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf-8')) as Vectors;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

function toField(vector: FieldVector): FormField {
  return {
    key: vector.key,
    label: vector.label,
    kind: vector.kind as FieldKind,
    required: vector.required,
    options: vector.options,
    optionValues: vector.option_values,
    selector: vector.selector,
  };
}

function fromField(field: FormField): FieldVector {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    required: field.required,
    options: [...field.options],
    option_values: [...field.optionValues],
    selector: field.selector,
  };
}

describe('the fixture itself', () => {
  it('covers every branch it claims to', () => {
    // A parity suite that silently lost its cases would pass forever.
    expect(vectors.normalize_question_key.length).toBeGreaterThanOrEqual(13);
    expect(vectors.sensitivity_for.length).toBeGreaterThanOrEqual(25);
    expect(vectors.fingerprint.length).toBeGreaterThanOrEqual(8);
    expect(vectors.parse_fields.length).toBeGreaterThanOrEqual(9);
    expect(vectors.check_identity.length).toBeGreaterThanOrEqual(8);
    expect(vectors.build_plan.length).toBeGreaterThanOrEqual(19);

    // Every reason the contract defines is exercised by some plan vector.
    const reasons = new Set(
      vectors.build_plan.flatMap((vector) => vector.plan.unresolved.map((item) => item.reason)),
    );
    for (const reason of [
      'new_question',
      'unsupported_widget',
      'needs_exact_mapping',
      'never_inferable',
      'file_upload_blocked',
      'no_answer',
    ]) {
      expect(reasons, `no vector produces ${reason}`).toContain(reason);
    }
  });
});

describe('normalizeQuestionKey', () => {
  for (const vector of vectors.normalize_question_key) {
    it(`matches Python for ${JSON.stringify(vector.label).slice(0, 48)}`, () => {
      expect(normalizeQuestionKey(vector.label)).toBe(vector.key);
    });
  }
});

describe('sensitivityFor', () => {
  for (const vector of vectors.sensitivity_for) {
    it(`matches Python for "${vector.label}"`, () => {
      expect(sensitivityFor(vector.label)).toBe(vector.sensitivity);
    });
  }
});

describe('fingerprint', () => {
  for (const vector of vectors.fingerprint) {
    it(`matches Python for ${vector.name}`, () => {
      const fields = vector.fields.map(toField);
      // The material first: a mismatch here names the field that diverged,
      // where a mismatched digest only says that something did.
      expect(fingerprintMaterial(fields)).toBe(vector.material);
      expect(fingerprint(fields, sha256Hex)).toBe(vector.fingerprint);
    });
  }

  it('is insensitive to option order and field order, and sensitive to required', () => {
    const byName = new Map(vectors.fingerprint.map((vector) => [vector.name, vector]));
    const sorted = byName.get('options_sorted_and_joined')!;
    const reordered = byName.get('reordered_options_are_the_same_form')!;
    const optional = byName.get('required_changes_the_digest')!;

    expect(reordered.fingerprint).toBe(sorted.fingerprint);
    expect(optional.fingerprint).not.toBe(sorted.fingerprint);
  });
});

describe('parseFields', () => {
  for (const vector of vectors.parse_fields) {
    it(`matches Python for ${vector.name}`, () => {
      expect(parseFields(vector.raw).map(fromField)).toEqual(vector.fields);
    });
  }
});

describe('checkIdentity', () => {
  for (const vector of vectors.check_identity) {
    it(`matches Python for ${vector.name}`, () => {
      const identity = parseIdentity(vector.raw, 'https://x.example/a', 'https://x.example');
      expect({ company: identity.company, title: identity.title }).toEqual(vector.identity);

      const result = checkIdentity(identity, vector.expected_company, vector.expected_title);
      expect({ matches: result.matches, reason: result.reason }).toEqual(vector.result);
    });
  }
});

describe('buildPlan', () => {
  for (const vector of vectors.build_plan) {
    it(`matches Python for ${vector.name}`, () => {
      const plan = buildPlan(vector.fields.map(toField), vector.answers, {
        hasAttachment: vector.has_attachment,
      });

      expect(
        plan.values.map((value) => ({
          key: value.field.key,
          values: [...value.values],
          upload: value.upload,
        })),
      ).toEqual(vector.plan.values);
      expect(plan.unresolved.map((item) => ({ ...item, options: [...item.options] }))).toEqual(
        vector.plan.unresolved,
      );
      expect(hasUnresolvedRequired(plan)).toBe(vector.plan.has_unresolved_required);
    });
  }
});
