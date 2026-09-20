import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FORMATS,
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
