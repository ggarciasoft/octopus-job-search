import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { TASK_IO_SCHEMAS } from '../src/exports.js';
import {
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_PREFERENCES,
  MATCH_WEIGHT_KEYS,
  Preferences,
  matchWeightsSum,
} from '../src/schemas/preferences.js';
import { AuthorizationValue } from '../src/schemas/profile.js';
import { ALL_TASK_TYPES, IMPLEMENTED_TASK_TYPES } from '../src/tasks/registry.js';

describe('AuthorizationValue tri-state (invariant: unknown is never positive)', () => {
  const base = { country: 'US', authorized: 'unknown', sponsorship_required: 'unknown' };

  it('accepts "unknown" for both tri-states', () => {
    expect(Value.Check(AuthorizationValue, base)).toBe(true);
  });

  it('rejects a payload that omits sponsorship_required instead of defaulting it', () => {
    const { sponsorship_required: _omitted, ...missing } = base;
    expect(Value.Check(AuthorizationValue, missing)).toBe(false);
  });

  it('rejects a payload that omits authorized', () => {
    const { authorized: _omitted, ...missing } = base;
    expect(Value.Check(AuthorizationValue, missing)).toBe(false);
  });

  it('rejects a boolean, which would collapse unknown into a yes/no answer', () => {
    expect(Value.Check(AuthorizationValue, { ...base, authorized: true })).toBe(false);
    expect(Value.Check(AuthorizationValue, { ...base, authorized: null })).toBe(false);
  });

  it('keeps authorized and sponsorship_required independent', () => {
    expect(
      Value.Check(AuthorizationValue, {
        country: 'DE',
        authorized: 'no',
        sponsorship_required: 'unknown',
      }),
    ).toBe(true);
  });
});

describe('match weights', () => {
  it('the shipped defaults sum to exactly 100', () => {
    expect(matchWeightsSum(DEFAULT_MATCH_WEIGHTS)).toBe(100);
  });

  it('covers every weight key when summing', () => {
    expect(MATCH_WEIGHT_KEYS.length).toBe(Object.keys(DEFAULT_MATCH_WEIGHTS).length);
  });

  it('the schema alone cannot catch a bad sum, so the helper must', () => {
    const skewed = {
      skills: 50,
      role_title: 20,
      seniority: 15,
      work_arrangement: 15,
      industry: 10,
    };
    // Every individual weight is inside its 0..100 range...
    expect(Value.Check(Preferences, { ...DEFAULT_PREFERENCES, match_weights: skewed })).toBe(true);
    // ...but the set is invalid, which is exactly why matchWeightsSum exists.
    expect(matchWeightsSum(skewed)).toBe(110);
    expect(matchWeightsSum(skewed)).not.toBe(100);
  });

  it('rejects a negative weight at the schema level', () => {
    const negative = { ...DEFAULT_MATCH_WEIGHTS, industry: -10 };
    expect(Value.Check(Preferences, { ...DEFAULT_PREFERENCES, match_weights: negative })).toBe(
      false,
    );
  });
});

describe('closed objects (unknown keys are rejected, not ignored)', () => {
  it('rejects an unknown top-level preference key', () => {
    const invalid = { ...DEFAULT_PREFERENCES, auto_submit: true };
    expect(Value.Check(Preferences, invalid)).toBe(false);
  });

  it('rejects an unknown key nested inside match_weights', () => {
    const invalid = {
      ...DEFAULT_PREFERENCES,
      match_weights: { ...DEFAULT_MATCH_WEIGHTS, luck: 0 },
    };
    expect(Value.Check(Preferences, invalid)).toBe(false);
  });

  it('rejects an unknown key nested inside limits', () => {
    const invalid = {
      ...DEFAULT_PREFERENCES,
      limits: { ...DEFAULT_PREFERENCES.limits, bypass_captcha: true },
    };
    expect(Value.Check(Preferences, invalid)).toBe(false);
  });
});

describe('task registry (invariant 10: never advertise an unimplemented task)', () => {
  it('every implemented task type has a closed input/output schema pair', () => {
    for (const type of IMPLEMENTED_TASK_TYPES) {
      const pair = TASK_IO_SCHEMAS[type];
      expect(pair, `missing TASK_IO_SCHEMAS entry for ${type}`).toBeDefined();
      expect(pair!.input).toBeDefined();
      expect(pair!.output).toBeDefined();
    }
  });

  it('no task type outside IMPLEMENTED_TASK_TYPES has schemas', () => {
    const implemented = new Set<string>(IMPLEMENTED_TASK_TYPES);
    for (const type of ALL_TASK_TYPES) {
      if (implemented.has(type)) continue;
      expect(TASK_IO_SCHEMAS[type], `${type} is not implemented but has schemas`).toBeUndefined();
    }
  });

  it('TASK_IO_SCHEMAS has no key that is not a declared task type', () => {
    const declared = new Set<string>(ALL_TASK_TYPES);
    for (const key of Object.keys(TASK_IO_SCHEMAS)) {
      expect(declared.has(key), `${key} is not in ALL_TASK_TYPES`).toBe(true);
    }
  });

  it('the two sets are exactly equal', () => {
    expect(Object.keys(TASK_IO_SCHEMAS).sort()).toEqual([...IMPLEMENTED_TASK_TYPES].sort());
  });
});
