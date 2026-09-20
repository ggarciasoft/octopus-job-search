import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  AuthorizationValue,
  ContactValue,
  CONTRACT_FORMATS,
  FACT_VALUE_SCHEMAS,
  EXPORTED_SCHEMAS,
  ExperienceValue,
  IsoMonth,
  Timestamp,
  Uuid,
  registerContractFormats,
} from '../src/index.js';

/**
 * Regression cover for two defects that were live in this package and that
 * both fail *silently*: they do not throw, they just reject valid data.
 *
 * 1. `IsoMonth` was written as '^\d{4}-...'. In a JavaScript string literal an
 *    unrecognised escape collapses, so the stored pattern was '^d{4}-...' and
 *    every real month was rejected.
 * 2. TypeBox's FormatRegistry is global and starts empty, so `Value.Check`
 *    rejected every payload carrying a `uuid` or `date-time` format — which is
 *    nearly every request, response and task result in the system.
 */

describe('regex patterns survive JavaScript string escaping', () => {
  it('IsoMonth accepts real months', () => {
    const pattern = new RegExp(IsoMonth.pattern as string);
    for (const month of ['2022-03', '2013-12', '1999-01', '2026-09']) {
      expect(pattern.test(month), `${month} should be accepted`).toBe(true);
    }
  });

  it('IsoMonth rejects impossible or malformed months', () => {
    const pattern = new RegExp(IsoMonth.pattern as string);
    for (const month of ['2022-13', '2022-00', '2022-3', '22-03', '2022/03', '', 'd{4}-03']) {
      expect(pattern.test(month), `${month} should be rejected`).toBe(false);
    }
  });

  it('no pattern in the contract contains a collapsed escape', () => {
    // A lone 'd', 'w' or 's' immediately after '^' or '-' is the fingerprint of
    // a '\d'/'\w'/'\s' that lost its backslash. Character classes are immune,
    // which is why the fix uses [0-9] rather than re-escaping.
    const offenders: string[] = [];
    for (const [name, schema] of Object.entries(EXPORTED_SCHEMAS)) {
      const seen = JSON.stringify(schema);
      for (const match of seen.matchAll(/"pattern":"([^"]*)"/g)) {
        const pattern = match[1] ?? '';
        if (/(?<![\\[])[dwsDWS]\{\d/.test(pattern)) {
          offenders.push(`${name}: ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('format registration', () => {
  it('is idempotent', () => {
    expect(() => {
      registerContractFormats();
      registerContractFormats();
    }).not.toThrow();
  });

  it('declares every format the schemas actually use', () => {
    const used = new Set<string>();
    for (const schema of Object.values(EXPORTED_SCHEMAS)) {
      for (const match of JSON.stringify(schema).matchAll(/"format":"([^"]*)"/g)) {
        const format = match[1];
        // `binary` is an OpenAPI documentation hint for multipart bytes, not a
        // value `Value.Check` is ever asked to validate.
        if (format !== undefined && format !== 'binary') used.add(format);
      }
    }
    expect([...used].sort()).toEqual([...CONTRACT_FORMATS].sort());
  });

  it('accepts valid uuids and rejects invalid ones', () => {
    expect(Value.Check(Uuid, '3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(Value.Check(Uuid, '3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
    expect(Value.Check(Uuid, 'not-a-uuid')).toBe(false);
    expect(Value.Check(Uuid, '3f2504e0-4f89-41d3-9a0c')).toBe(false);
  });

  it('accepts UTC timestamps and rejects other offsets', () => {
    expect(Value.Check(Timestamp, '2026-09-20T12:00:00Z')).toBe(true);
    expect(Value.Check(Timestamp, '2026-09-20T12:00:00.123Z')).toBe(true);
    expect(Value.Check(Timestamp, '2026-09-20T12:00:00+00:00')).toBe(true);
    // The data model stores timestamptz in UTC; a local offset here would make
    // freshness and last-seen comparisons quietly wrong.
    expect(Value.Check(Timestamp, '2026-09-20T12:00:00+02:00')).toBe(false);
    expect(Value.Check(Timestamp, '2026-09-20')).toBe(false);
  });

  it('rejects a well-formed but impossible date', () => {
    expect(Value.Check(Timestamp, '2026-02-30T00:00:00Z')).toBe(false);
    expect(Value.Check(Timestamp, '2026-13-01T00:00:00Z')).toBe(false);
  });
});

describe('a realistic fact validates end to end', () => {
  const experience = {
    employer: 'Northwind Logistics',
    title: 'Senior Backend Engineer',
    start_month: '2022-03',
    end_month: null,
    current: true,
    employment_type: 'full_time' as const,
    bullets: [
      { text: 'Led the migration of the shipment tracking service.', evidence_reference: 'page 1' },
    ],
    skills: ['Python', 'PostgreSQL'],
  };

  it('accepts the canonical fixture experience', () => {
    expect(Value.Check(ExperienceValue, experience)).toBe(true);
  });

  it('rejects an impossible start month', () => {
    expect(Value.Check(ExperienceValue, { ...experience, start_month: '2022-13' })).toBe(false);
  });

  it('requires an evidence reference on every bullet', () => {
    const withoutEvidence = {
      ...experience,
      bullets: [{ text: 'Did something impressive.' }],
    };
    expect(Value.Check(ExperienceValue, withoutEvidence)).toBe(false);
  });
});

describe('"not stated" survives both representations', () => {
  /**
   * A producer may serialise "nothing" either by omitting the key or by
   * sending null. Accepting only one of those silently discarded a work
   * authorization fact end to end: the worker emitted `note: null`, the API
   * rejected the value, and the whole fact vanished -- so a CV that said
   * "requires sponsorship for the United States" produced a profile with no
   * US entry at all. Unknown must stay unknown, not disappear.
   */
  const usAuthorization = {
    country: 'US',
    authorized: 'unknown' as const,
    sponsorship_required: 'yes' as const,
  };

  it('accepts an authorization note that is absent, null or present', () => {
    expect(Value.Check(AuthorizationValue, usAuthorization)).toBe(true);
    expect(Value.Check(AuthorizationValue, { ...usAuthorization, note: null })).toBe(true);
    expect(Value.Check(AuthorizationValue, { ...usAuthorization, note: 'Stated on the CV.' })).toBe(
      true,
    );
  });

  it('still rejects a note of the wrong type or over length', () => {
    expect(Value.Check(AuthorizationValue, { ...usAuthorization, note: 42 })).toBe(false);
    expect(Value.Check(AuthorizationValue, { ...usAuthorization, note: 'x'.repeat(301) })).toBe(
      false,
    );
  });

  it('accepts contact fields that are absent or null', () => {
    const contact = { full_name: 'Ana Rivera', email: 'ana.rivera@example.invalid' };
    expect(Value.Check(ContactValue, contact)).toBe(true);
    expect(Value.Check(ContactValue, { ...contact, phone: null, city: null, country: null })).toBe(
      true,
    );
  });

  it('leaves no optional string in a fact value that rejects null', () => {
    // The whole class of bug, not just the instance that was found.
    const offenders: string[] = [];
    for (const [kind, schema] of Object.entries(FACT_VALUE_SCHEMAS)) {
      const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
      const required = new Set((schema as { required?: string[] }).required ?? []);
      for (const [name, property] of Object.entries(properties)) {
        if (required.has(name)) continue;
        const json = JSON.stringify(property);
        if (json.includes('"string"') && !json.includes('"null"') && !json.includes('"array"')) {
          offenders.push(`${kind}.${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
