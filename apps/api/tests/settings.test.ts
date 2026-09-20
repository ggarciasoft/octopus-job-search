/**
 * Preferences and model-provider settings.
 *
 * The two security properties asserted here are:
 *
 *  * a provider API key is **write-only** — no response body ever contains the
 *    plaintext, the database holds authenticated ciphertext, and a tampered
 *    ciphertext fails authentication rather than decrypting to something;
 *  * `POST /settings/providers/test` is not a URL fetcher — loopback,
 *    private, link-local and cloud-metadata destinations are refused in both
 *    address families, including through DNS and through a redirect.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROVIDER_LIMITS,
  PreferencesView,
  ProviderSettingsView,
} from '@job-getter/contracts';
import {
  decryptSecret,
  encryptSecret,
  envelopeKeyVersion,
  keyringFromConfig,
  maskSecret,
  SecretCryptoError,
} from '../src/crypto/secrets.js';
import {
  FetchNotAllowedError,
  assertUrlAllowed,
  isPrivateAddress,
} from '../src/settings/network.js';
import { probeProvider } from '../src/settings/provider-test.js';
import { fetchPolicyFor, type ProviderSettingsRow } from '../src/settings/providers.js';
import type { Config } from '../src/config.js';
import {
  authed,
  completeSetup,
  createHarness,
  createSecondWorkspace,
  type Harness,
  type Session,
} from './helpers/harness.js';

let harness: Harness;
let session: Session;

beforeAll(async () => {
  harness = await createHarness();
}, 180_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  session = await completeSetup(harness);
});

const SECRET = 'sk-test-0123456789abcdefTAIL';

function getPreferences(as: Session = session) {
  return harness.app.inject(authed(as, { method: 'GET', url: '/api/v1/preferences' }));
}

function putPreferences(payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(authed(as, { method: 'PUT', url: '/api/v1/preferences', payload }));
}

function getProviders(as: Session = session) {
  return harness.app.inject(authed(as, { method: 'GET', url: '/api/v1/settings/providers' }));
}

function putProviders(payload: Record<string, unknown>, as: Session = session) {
  return harness.app.inject(
    authed(as, { method: 'PUT', url: '/api/v1/settings/providers', payload }),
  );
}

function testProviders(as: Session = session) {
  return harness.app.inject(
    authed(as, { method: 'POST', url: '/api/v1/settings/providers/test', payload: {} }),
  );
}

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'openai_compatible',
    model: 'gpt-4o-mini',
    base_url: 'https://api.example.com/v1',
    limits: DEFAULT_PROVIDER_LIMITS,
    rate_card: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

describe('GET/PUT /preferences', () => {
  it('returns the defaults written at setup', async () => {
    const response = await getPreferences();
    expect(response.statusCode).toBe(200);
    expect(Value.Check(PreferencesView, response.json())).toBe(true);
    expect(response.json().revision).toBe(1);
    expect(response.json().config).toEqual(DEFAULT_PREFERENCES);
  });

  it('creates the row on demand for a workspace provisioned outside setup', async () => {
    const other = await createSecondWorkspace(harness);
    const response = await getPreferences(other);
    expect(response.statusCode).toBe(200);
    expect(response.json().config).toEqual(DEFAULT_PREFERENCES);
  });

  it('stores a replacement and bumps the revision', async () => {
    const response = await putPreferences({
      expected_revision: 1,
      config: { ...DEFAULT_PREFERENCES, target_titles: ['Robotics Engineer'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().revision).toBe(2);
    expect(response.json().config.target_titles).toEqual(['Robotics Engineer']);
    expect((await getPreferences()).json().config.target_titles).toEqual(['Robotics Engineer']);
  });

  it('rejects an unknown key rather than ignoring it', async () => {
    const response = await putPreferences({
      expected_revision: 1,
      config: { ...DEFAULT_PREFERENCES, target_tiles: ['typo'] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(response.json().error.fields).join(' ')).toContain('target_tiles');

    // Nothing was stored, and in particular the typo was not silently dropped
    // while the rest of the config was accepted.
    const after = await getPreferences();
    expect(after.json().revision).toBe(1);
    expect(after.json().config).toEqual(DEFAULT_PREFERENCES);
  });

  it('rejects an unknown key nested inside limits', async () => {
    const response = await putPreferences({
      expected_revision: 1,
      config: {
        ...DEFAULT_PREFERENCES,
        limits: { ...DEFAULT_PREFERENCES.limits, unlimited: true },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it.each([99, 101])('rejects match weights summing to %i', async (sum) => {
    const response = await putPreferences({
      expected_revision: 1,
      config: {
        ...DEFAULT_PREFERENCES,
        match_weights: { ...DEFAULT_PREFERENCES.match_weights, skills: 40 + (sum - 100) },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNPROCESSABLE');
    expect(response.json().error.fields).toHaveProperty('match_weights');
    expect((await getPreferences()).json().revision).toBe(1);
  });

  it('accepts a redistribution that still sums to 100', async () => {
    const response = await putPreferences({
      expected_revision: 1,
      config: {
        ...DEFAULT_PREFERENCES,
        match_weights: {
          skills: 50,
          role_title: 20,
          seniority: 10,
          work_arrangement: 10,
          industry: 10,
        },
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a stale expected_revision with 409 STALE_REVISION', async () => {
    await putPreferences({
      expected_revision: 1,
      config: { ...DEFAULT_PREFERENCES, scan_interval_hours: 12 },
    });

    const stale = await putPreferences({
      expected_revision: 1,
      config: { ...DEFAULT_PREFERENCES, scan_interval_hours: 6 },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('STALE_REVISION');
    expect((await getPreferences()).json().config.scan_interval_hours).toBe(12);
  });

  it('keeps each workspace on its own preferences', async () => {
    const other = await createSecondWorkspace(harness);
    await putPreferences({
      expected_revision: 1,
      config: { ...DEFAULT_PREFERENCES, target_titles: ['Mine'] },
    });
    expect((await getPreferences(other)).json().config.target_titles).toEqual([]);
    expect((await getPreferences(other)).json().revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Provider settings
// ---------------------------------------------------------------------------

describe('GET/PUT /settings/providers', () => {
  it('reports "none" with no external transfer before anything is configured', async () => {
    const response = await getProviders();
    expect(response.statusCode).toBe(200);
    expect(Value.Check(ProviderSettingsView, response.json())).toBe(true);
    expect(response.json()).toMatchObject({
      provider: 'none',
      api_key_set: false,
      api_key_masked: null,
      sends_data_externally: false,
    });
  });

  it('marks openai_compatible as sending data externally and the local ones as not', async () => {
    const cloud = await putProviders(providerBody({ api_key: SECRET }));
    expect(cloud.statusCode).toBe(200);
    expect(cloud.json().sends_data_externally).toBe(true);

    const fake = await putProviders(
      providerBody({ provider: 'fake', model: 'fake-1', base_url: null, api_key: null }),
    );
    expect(fake.statusCode).toBe(200);
    expect(fake.json().sends_data_externally).toBe(false);

    const none = await putProviders(
      providerBody({ provider: 'none', model: 'unused', base_url: null }),
    );
    expect(none.json().sends_data_externally).toBe(false);
  });

  describe('the API key is write-only', () => {
    it('never appears in any response body', async () => {
      const put = await putProviders(providerBody({ api_key: SECRET }));
      expect(put.statusCode).toBe(200);

      const get = await getProviders();
      const test = await testProviders();
      const me = await harness.app.inject(authed(session, { method: 'GET', url: '/api/v1/me' }));

      for (const response of [put, get, test, me]) {
        expect(response.body).not.toContain(SECRET);
        expect(response.body).not.toContain(SECRET.slice(0, 12));
      }

      expect(get.json().api_key_set).toBe(true);
      expect(get.json().api_key_masked).toBe(maskSecret(SECRET));
      expect(get.json().api_key_masked).not.toContain('0123456789');
      expect(get.json()).not.toHaveProperty('api_key');
    });

    it('stores authenticated ciphertext that differs from the plaintext', async () => {
      await putProviders(providerBody({ api_key: SECRET }));

      const row = await harness.db
        .selectFrom('provider_settings')
        .selectAll()
        .executeTakeFirstOrThrow();

      const stored = row.secret_ciphertext as Buffer;
      expect(stored).toBeInstanceOf(Buffer);
      expect(stored.includes(Buffer.from(SECRET, 'utf8'))).toBe(false);
      expect(stored.toString('utf8')).not.toContain('sk-test');
      // version byte + 12-byte nonce + 16-byte tag + ciphertext
      expect(stored.byteLength).toBe(1 + 12 + 16 + Buffer.byteLength(SECRET));
      expect(envelopeKeyVersion(stored)).toBe(1);

      const keyring = keyringFromConfig(harness.config);
      expect(decryptSecret(keyring, stored)).toBe(SECRET);
    });

    it('produces a different ciphertext each time the same secret is stored', async () => {
      await putProviders(providerBody({ api_key: SECRET }));
      const first = (
        await harness.db.selectFrom('provider_settings').selectAll().executeTakeFirstOrThrow()
      ).secret_ciphertext as Buffer;

      await putProviders(providerBody({ api_key: SECRET, model: 'gpt-4o' }));
      const second = (
        await harness.db.selectFrom('provider_settings').selectAll().executeTakeFirstOrThrow()
      ).secret_ciphertext as Buffer;

      expect(first.equals(second)).toBe(false);
    });

    it('keeps the stored key when api_key is omitted and clears it when null', async () => {
      await putProviders(providerBody({ api_key: SECRET }));

      const omitted = await putProviders(providerBody({ model: 'gpt-4o' }));
      expect(omitted.json().api_key_set).toBe(true);
      expect(omitted.json().api_key_masked).toBe(maskSecret(SECRET));

      const cleared = await putProviders(providerBody({ api_key: null }));
      expect(cleared.json().api_key_set).toBe(false);
      expect(cleared.json().api_key_masked).toBeNull();

      const row = await harness.db
        .selectFrom('provider_settings')
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(row.secret_ciphertext).toBeNull();
    });

    it('fails authentication on a tampered ciphertext instead of returning garbage', async () => {
      const keyring = keyringFromConfig(harness.config);
      const envelope = encryptSecret(keyring, SECRET);

      /** Flips one bit at `offset` and returns the altered envelope. */
      const tamper = (offset: number): Buffer => {
        const copy = Buffer.from(envelope);
        copy.writeUInt8(copy.readUInt8(offset) ^ 0x01, offset);
        return copy;
      };

      // ciphertext, auth tag and nonce in turn: each must fail authentication.
      expect(() => decryptSecret(keyring, tamper(envelope.length - 1))).toThrow(SecretCryptoError);
      expect(() => decryptSecret(keyring, tamper(20))).toThrow(SecretCryptoError);
      expect(() => decryptSecret(keyring, tamper(5))).toThrow(SecretCryptoError);

      // An unknown key version is refused rather than decrypted with whatever
      // key happens to be current.
      const wrongVersion = Buffer.from(envelope);
      wrongVersion.writeUInt8(9, 0);
      expect(() => decryptSecret(keyring, wrongVersion)).toThrow(SecretCryptoError);

      expect(decryptSecret(keyring, envelope)).toBe(SECRET);
    });

    it('refuses the probe when the stored ciphertext will not authenticate', async () => {
      await putProviders(providerBody({ api_key: SECRET }));
      await harness.pool.query(
        `UPDATE provider_settings SET secret_ciphertext = decode($1, 'hex')`,
        [Buffer.alloc(64, 3).toString('hex')],
      );

      const response = await testProviders();
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
      expect(response.body).not.toContain(SECRET);
    });
  });

  it('keeps provider settings scoped to their workspace', async () => {
    const other = await createSecondWorkspace(harness);
    await putProviders(providerBody({ api_key: SECRET }));

    const view = await getProviders(other);
    expect(view.json().provider).toBe('none');
    expect(view.json().api_key_set).toBe(false);
    expect(view.body).not.toContain(SECRET);
  });
});

// ---------------------------------------------------------------------------
// Destination policy
// ---------------------------------------------------------------------------

const BLOCKED_BASE_URLS = [
  'http://127.0.0.1:11434',
  'http://[::1]:11434',
  'http://169.254.169.254',
  'http://10.0.0.1:11434',
  'http://192.168.1.10:11434',
  'http://172.16.4.4:11434',
  'http://[fd00:ec2::254]',
  'http://[fe80::1]:11434',
  'http://metadata.google.internal',
];

describe('address classification', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.1',
    '172.16.4.4',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::',
    'fd00:ec2::254',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-address',
  ])('treats %s as private or unusable', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'treats %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('the operator allowlist for a local model endpoint', () => {
  function configWith(overrides: Partial<Config>): Config {
    return { ...harness.config, ...overrides } as Config;
  }

  it('grants exactly the host of LOCAL_MODEL_BASE_URL, and only to ollama', () => {
    const config = configWith({
      localModelBaseUrl: 'http://127.0.0.1:11434',
      allowedFetchHosts: [],
    });

    expect(fetchPolicyFor(config, 'ollama')).toEqual({
      requireHttps: false,
      allowedHosts: ['127.0.0.1', '127.0.0.1:11434'],
    });

    // The local-model exception must not widen anything else
    // (05_DISCOVERY_CONNECTORS.md).
    expect(fetchPolicyFor(config, 'openai_compatible')).toEqual({
      requireHttps: true,
      allowedHosts: [],
    });
  });

  it('grants nothing when the operator configured nothing', () => {
    const config = configWith({ localModelBaseUrl: null, allowedFetchHosts: [] });
    expect(fetchPolicyFor(config, 'ollama').allowedHosts).toEqual([]);
  });

  it('accepts a loopback endpoint once the operator has allowlisted it', async () => {
    const config = configWith({ localModelBaseUrl: null, allowedFetchHosts: ['127.0.0.1:11434'] });
    await expect(
      assertUrlAllowed(new URL('http://127.0.0.1:11434'), fetchPolicyFor(config, 'ollama')),
    ).resolves.toBeUndefined();

    // A different local port is still refused: the grant is per host:port.
    await expect(
      assertUrlAllowed(new URL('http://127.0.0.1:9999'), fetchPolicyFor(config, 'ollama')),
    ).rejects.toBeInstanceOf(FetchNotAllowedError);
  });
});

describe('no automatic fallback to a cloud provider (ADR07)', () => {
  it('reports the configured local provider as unreachable instead of trying another', async () => {
    const attempted: string[] = [];
    const doFetch = async (input: string) => {
      attempted.push(input);
      throw new Error('ECONNREFUSED');
    };

    const config = {
      ...harness.config,
      localModelBaseUrl: 'http://127.0.0.1:11434',
    } as Config;

    const row = {
      provider: 'ollama',
      base_url: 'http://127.0.0.1:11434',
      model: 'llama3',
      secret_ciphertext: null,
      validated_config: {},
      updated_at: new Date(),
    } as unknown as ProviderSettingsRow;

    const result = await probeProvider(config, row, null, {
      fetch: doFetch as unknown as (input: string, init: RequestInit) => Promise<Response>,
    });

    expect(result.reachable).toBe(false);
    expect(result.model_available).toBeNull();
    // Exactly one endpoint was contacted: the configured one.
    expect(attempted).toEqual(['http://127.0.0.1:11434/api/tags']);
    expect(result.detail).not.toMatch(/openai|api\.openai|fallback/i);
  });
});

describe('assertUrlAllowed', () => {
  const publicPolicy = { requireHttps: false, allowedHosts: [] as string[] };

  it.each(BLOCKED_BASE_URLS)('refuses %s', async (url) => {
    await expect(assertUrlAllowed(new URL(url), publicPolicy)).rejects.toBeInstanceOf(
      FetchNotAllowedError,
    );
  });

  it('refuses a DNS name that resolves to a private address', async () => {
    const policy = {
      requireHttps: false,
      allowedHosts: [],
      resolve: async () => ['10.1.2.3'],
    };
    await expect(assertUrlAllowed(new URL('http://internal.example.com'), policy)).rejects.toThrow(
      /private, loopback or link-local/,
    );
  });

  it('refuses a name whose records mix a public and a private address', async () => {
    const policy = {
      requireHttps: false,
      allowedHosts: [],
      resolve: async () => ['93.184.216.34', '169.254.169.254'],
    };
    await expect(
      assertUrlAllowed(new URL('http://rebinding.example.com'), policy),
    ).rejects.toBeInstanceOf(FetchNotAllowedError);
  });

  it('refuses a metadata address even when the operator allowlisted the host', async () => {
    const policy = { requireHttps: false, allowedHosts: ['169.254.169.254'] };
    await expect(assertUrlAllowed(new URL('http://169.254.169.254'), policy)).rejects.toThrow(
      /instance-metadata/,
    );
  });

  it('permits a loopback host the operator explicitly allowlisted', async () => {
    const policy = { requireHttps: false, allowedHosts: ['127.0.0.1:11434'] };
    await expect(
      assertUrlAllowed(new URL('http://127.0.0.1:11434'), policy),
    ).resolves.toBeUndefined();
  });

  it('never allows an http downgrade for an https-only destination', async () => {
    const policy = { requireHttps: true, allowedHosts: ['api.example.com'] };
    await expect(assertUrlAllowed(new URL('http://api.example.com'), policy)).rejects.toThrow(
      /https/,
    );
  });

  it.each(['file:///etc/passwd', 'gopher://example.com', 'ftp://example.com'])(
    'refuses the %s scheme',
    async (url) => {
      await expect(assertUrlAllowed(new URL(url), publicPolicy)).rejects.toBeInstanceOf(
        FetchNotAllowedError,
      );
    },
  );

  it('refuses a URL carrying embedded credentials', async () => {
    await expect(
      assertUrlAllowed(new URL('https://user:pass@example.com'), {
        requireHttps: true,
        allowedHosts: [],
        resolve: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow(/credentials/);
  });
});

describe('PUT /settings/providers rejects a forbidden base_url', () => {
  it.each(BLOCKED_BASE_URLS)('refuses to store %s for ollama', async (url) => {
    const response = await putProviders(
      providerBody({ provider: 'ollama', model: 'llama3', base_url: url, api_key: null }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields).toHaveProperty('base_url');
    expect(await harness.db.selectFrom('provider_settings').selectAll().execute()).toEqual([]);
  });

  it('refuses a non-https endpoint for openai_compatible', async () => {
    const response = await putProviders(
      providerBody({ base_url: 'http://api.example.com/v1', api_key: SECRET }),
    );
    expect(response.statusCode).toBe(422);
  });

  it('requires a base_url for a provider that has an endpoint', async () => {
    const response = await putProviders(providerBody({ base_url: null }));
    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields).toHaveProperty('base_url');
  });

  it('refuses a base_url for a provider that has no endpoint', async () => {
    const response = await putProviders(
      providerBody({ provider: 'fake', model: 'fake-1', base_url: 'https://api.example.com' }),
    );
    expect(response.statusCode).toBe(422);
  });
});

describe('POST /settings/providers/test', () => {
  /** Writes a row the PUT route would have refused, to reach the probe path. */
  async function forceStoredBaseUrl(provider: string, baseUrl: string): Promise<void> {
    await harness.pool.query(
      `INSERT INTO provider_settings (workspace_id, provider, model, base_url, validated_config)
       VALUES ($1, $2, $3, $4, '{}'::jsonb)
       ON CONFLICT (workspace_id) DO UPDATE
         SET provider = EXCLUDED.provider, model = EXCLUDED.model, base_url = EXCLUDED.base_url`,
      [session.workspaceId, provider, 'llama3', baseUrl],
    );
  }

  it('is honest that nothing is configured', async () => {
    const response = await testProviders();
    expect(response.statusCode).toBe(200);
    expect(response.json().reachable).toBe(false);
    expect(response.json().model_available).toBeNull();
    expect(response.json().detail).toContain('No AI provider is configured');
  });

  it('reports the in-process fake provider without a network call', async () => {
    await putProviders(providerBody({ provider: 'fake', model: 'fake-1', base_url: null }));
    const response = await testProviders();
    expect(response.statusCode).toBe(200);
    expect(response.json().reachable).toBe(true);
    expect(response.json().detail).toContain('No network request');
  });

  it.each(BLOCKED_BASE_URLS)('refuses a stored base_url of %s', async (url) => {
    await forceStoredBaseUrl('ollama', url);
    const response = await testProviders();
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNPROCESSABLE');
    expect(response.json().error.fields).toHaveProperty('base_url');
  });

  describe('redirects', () => {
    /** Every destination resolves to a public address unless the URL is a literal. */
    const resolve = async () => ['93.184.216.34'];

    function row(baseUrl: string): ProviderSettingsRow {
      return {
        id: 'row',
        workspace_id: 'ws',
        provider: 'openai_compatible',
        base_url: baseUrl,
        model: 'gpt-4o-mini',
        secret_ciphertext: null,
        daily_budget: null,
        validated_config: {},
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as ProviderSettingsRow;
    }

    function redirectingFetch(location: string) {
      let calls = 0;
      const doFetch = async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location } });
      };
      return {
        fetch: doFetch as unknown as (input: string, init: RequestInit) => Promise<Response>,
        calls: () => calls,
      };
    }

    it('refuses a redirect to a private address after the first hop succeeded', async () => {
      const stub = redirectingFetch('http://169.254.169.254/latest/meta-data/');
      await expect(
        probeProvider(harness.config, row('https://api.example.com/v1'), null, {
          fetch: stub.fetch,
          resolve,
        }),
      ).rejects.toMatchObject({ status: 422 });
      // The first hop was made; the second was refused before connecting.
      expect(stub.calls()).toBe(1);
    });

    it('refuses a redirect to loopback', async () => {
      const stub = redirectingFetch('http://127.0.0.1:11434/api/tags');
      await expect(
        probeProvider(harness.config, row('https://api.example.com/v1'), null, {
          fetch: stub.fetch,
          resolve,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('refuses a redirect to an IPv6 loopback', async () => {
      const stub = redirectingFetch('http://[::1]:11434/api/tags');
      await expect(
        probeProvider(harness.config, row('https://api.example.com/v1'), null, {
          fetch: stub.fetch,
          resolve,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('refuses a redirect chain longer than the limit', async () => {
      const stub = redirectingFetch('https://api.example.com/v1/models');
      await expect(
        probeProvider(harness.config, row('https://api.example.com/v1'), null, {
          fetch: stub.fetch,
          resolve,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(stub.calls()).toBe(4);
    });

    it('reports the model list when the endpoint answers', async () => {
      const doFetch = async () =>
        new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });

      const result = await probeProvider(harness.config, row('https://api.example.com/v1'), null, {
        fetch: doFetch as unknown as (input: string, init: RequestInit) => Promise<Response>,
        resolve,
      });
      expect(result.reachable).toBe(true);
      expect(result.model_available).toBe(true);
      // Never asserted without being probed.
      expect(result.structured_output_supported).toBeNull();
      expect(result.detail).toContain('external service');
    });

    it('does not send the Authorization header to a redirect target it refuses', async () => {
      const seen: RequestInit[] = [];
      const doFetch = async (_input: string, init: RequestInit) => {
        seen.push(init);
        return new Response(null, {
          status: 302,
          headers: { location: 'http://10.0.0.1/v1/models' },
        });
      };

      await expect(
        probeProvider(harness.config, row('https://api.example.com/v1'), SECRET, {
          fetch: doFetch as unknown as (input: string, init: RequestInit) => Promise<Response>,
          resolve,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(seen).toHaveLength(1);
    });
  });
});
