import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { EXPORTED_SCHEMAS } from '../src/exports.js';
// Importing the package registers the `uuid` and `date-time` formats; without
// them TypeBox rejects every payload that carries one.
import '../src/index.js';
import { DEFAULT_PREFERENCES } from '../src/schemas/preferences.js';
import { DEFAULT_PROVIDER_LIMITS } from '../src/schemas/providers.js';

const UUID = '3f1d4b5e-9a2c-4f1e-8c3a-7b6d5e4f3a2b';
const TIMESTAMP = '2026-02-03T04:05:06.000Z';
const LEASE_TOKEN = 'l'.repeat(48);

/**
 * Behaviour, not restatement: every fixture below is a payload the API or the
 * worker would really exchange, and every negative case is something the
 * specification says must be rejected rather than quietly accepted.
 */

const VALID_PARSE_PROFILE_RESULT = {
  draft_facts: [
    {
      draft_id: 'draft-1',
      kind: 'skill',
      value: {
        canonical_name: 'TypeScript',
        aliases: ['ts'],
        user_declared_proficiency: null,
        years: null,
      },
      source_excerpt: 'Built a TypeScript service',
      source_locator: 'page 1',
      confidence: 0.42,
    },
  ],
  warnings: [{ code: 'EXTRACTION_SHORT', message: 'Only 180 characters extracted.' }],
  extracted_chars: 180,
  provider: { id: 'fake', model: 'fake-deterministic', input_tokens: null, output_tokens: null },
};

const VALID_PROFILE_PATCH_REQUEST = {
  expected_revision: 7,
  changes: [
    { op: 'upsert', kind: 'summary', value: { text: 'Backend engineer.' }, confirmed: true },
    { op: 'delete', id: UUID },
  ],
};

const VALID_PROVIDER_SETTINGS_PUT = {
  provider: 'openai_compatible',
  model: 'local-model',
  base_url: 'http://127.0.0.1:11434/v1',
  api_key: null,
  limits: DEFAULT_PROVIDER_LIMITS,
  rate_card: null,
};

const VALID_CLAIM_RESPONSE = {
  task_id: UUID,
  type: 'parse_profile',
  lease_token: LEASE_TOKEN,
  lease_expires_at: TIMESTAMP,
  attempt: 1,
  max_attempts: 3,
  input_schema_version: 1,
  input: { profile_import_id: UUID },
  files: [],
};

describe('exported schemas', () => {
  it('every entry is a usable TypeBox schema', () => {
    const names = Object.keys(EXPORTED_SCHEMAS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const schema = EXPORTED_SCHEMAS[name];
      expect(schema, name).toBeDefined();
      // Compiling/checking must not throw for any exported schema.
      expect(() => Value.Check(schema!, {})).not.toThrow();
    }
  });
});

describe('ParseProfileResult', () => {
  it('accepts a worker result carrying evidence and a provider record', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['ParseProfileResult']!, VALID_PARSE_PROFILE_RESULT)).toBe(
      true,
    );
  });

  it('rejects a confidence outside 0..1 so a parsing aid cannot be inflated', () => {
    const invalid = {
      ...VALID_PARSE_PROFILE_RESULT,
      draft_facts: [{ ...VALID_PARSE_PROFILE_RESULT.draft_facts[0], confidence: 1.4 }],
    };
    expect(Value.Check(EXPORTED_SCHEMAS['ParseProfileResult']!, invalid)).toBe(false);
  });

  it('rejects a draft fact with no source_excerpt key at all', () => {
    const { source_excerpt: _omitted, ...withoutExcerpt } = VALID_PARSE_PROFILE_RESULT
      .draft_facts[0] as Record<string, unknown>;
    const invalid = { ...VALID_PARSE_PROFILE_RESULT, draft_facts: [withoutExcerpt] };
    expect(Value.Check(EXPORTED_SCHEMAS['ParseProfileResult']!, invalid)).toBe(false);
  });
});

describe('ProfilePatchRequest', () => {
  it('accepts an upsert and a delete against an expected revision', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['ProfilePatchRequest']!, VALID_PROFILE_PATCH_REQUEST)).toBe(
      true,
    );
  });

  it('rejects an unknown change operation', () => {
    const invalid = {
      expected_revision: 1,
      changes: [{ op: 'replace', id: UUID, kind: 'summary', value: {}, confirmed: true }],
    };
    expect(Value.Check(EXPORTED_SCHEMAS['ProfilePatchRequest']!, invalid)).toBe(false);
  });

  it('rejects a patch without expected_revision: blind writes lose concurrency control', () => {
    const invalid = { changes: [] };
    expect(Value.Check(EXPORTED_SCHEMAS['ProfilePatchRequest']!, invalid)).toBe(false);
  });
});

describe('Preferences', () => {
  it('accepts the shipped defaults', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['Preferences']!, DEFAULT_PREFERENCES)).toBe(true);
  });

  it('rejects a settings_version the runtime does not understand', () => {
    const invalid = { ...DEFAULT_PREFERENCES, settings_version: 2 };
    expect(Value.Check(EXPORTED_SCHEMAS['Preferences']!, invalid)).toBe(false);
  });
});

describe('ProviderSettingsPutRequest', () => {
  it('accepts a local OpenAI-compatible endpoint with no rate card', () => {
    expect(
      Value.Check(EXPORTED_SCHEMAS['ProviderSettingsPutRequest']!, VALID_PROVIDER_SETTINGS_PUT),
    ).toBe(true);
  });

  it('rejects a provider id that is not in the supported set (invariant 10)', () => {
    const invalid = { ...VALID_PROVIDER_SETTINGS_PUT, provider: 'anthropic' };
    expect(Value.Check(EXPORTED_SCHEMAS['ProviderSettingsPutRequest']!, invalid)).toBe(false);
  });

  it('rejects a rate card missing its currency, because cost cannot be assumed', () => {
    const invalid = {
      ...VALID_PROVIDER_SETTINGS_PUT,
      rate_card: { input_cost_per_million: 1, output_cost_per_million: 2 },
    };
    expect(Value.Check(EXPORTED_SCHEMAS['ProviderSettingsPutRequest']!, invalid)).toBe(false);
  });
});

describe('ClaimResponse', () => {
  it('accepts a lease handed to a worker', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['ClaimResponse']!, VALID_CLAIM_RESPONSE)).toBe(true);
  });

  it('rejects a short lease token', () => {
    const invalid = { ...VALID_CLAIM_RESPONSE, lease_token: 'short' };
    expect(Value.Check(EXPORTED_SCHEMAS['ClaimResponse']!, invalid)).toBe(false);
  });

  it('rejects a task type outside the declared enum', () => {
    const invalid = { ...VALID_CLAIM_RESPONSE, type: 'scrape_linkedin' };
    expect(Value.Check(EXPORTED_SCHEMAS['ClaimResponse']!, invalid)).toBe(false);
  });
});

describe('NoopEchoInput', () => {
  it('accepts the minimal probe payload', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['NoopEchoInput']!, { message: 'ping' })).toBe(true);
  });

  it('rejects an empty message', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['NoopEchoInput']!, { message: '' })).toBe(false);
  });

  it('rejects an unknown key rather than silently dropping it', () => {
    expect(Value.Check(EXPORTED_SCHEMAS['NoopEchoInput']!, { message: 'ping', retries: 3 })).toBe(
      false,
    );
  });
});

describe('string formats', () => {
  it('rejects a malformed uuid', () => {
    const invalid = { ...VALID_CLAIM_RESPONSE, task_id: 'not-a-uuid' };
    expect(Value.Check(EXPORTED_SCHEMAS['ClaimResponse']!, invalid)).toBe(false);
  });

  it('rejects a malformed timestamp', () => {
    const invalid = { ...VALID_CLAIM_RESPONSE, lease_expires_at: '2026-02-03 04:05:06' };
    expect(Value.Check(EXPORTED_SCHEMAS['ClaimResponse']!, invalid)).toBe(false);
  });
});
