/**
 * Pairing with a code, and the list of approved applications that replaces
 * pasting an id and a hash.
 *
 * The service worker's half is driven through a fake `chrome.storage` and a
 * fake `fetch`, so what is asserted is what reaches the network and what is
 * left in storage: the code goes out once and is never kept, the token comes
 * back and is kept, and a dead token is forgotten rather than retried.
 */
import { describe, expect, it } from 'vitest';
import type { FillTarget } from '@job-getter/contracts';
import { forgetPairing, loadTargets, pairWithCode, readPairing } from '../src/background.js';
import {
  arrangeTargets,
  normaliseBaseUrl,
  normalisePairingCode,
  openableUrl,
} from '../src/targets.js';

const BASE = 'http://127.0.0.1:3000';
const ORIGIN = 'https://boards.greenhouse.io';

function fakeChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const api = {
    storage: {
      local: {
        get: async (keys: string[]) =>
          Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
        remove: async (keys: string[]) => keys.forEach((key) => delete store[key]),
      },
    },
  };
  // Only the storage half is exercised here; the rest of ChromeApi is unused.
  return { api: api as unknown as Parameters<typeof readPairing>[0], store };
}

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(status === 204 ? null : text, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const EXCHANGED = {
  device_id: '00000000-0000-4000-8000-00000000000d',
  token: 't'.repeat(43),
  expires_at: '2026-10-22T00:00:00.000Z',
  allowed_origins: [],
};

function target(overrides: Partial<FillTarget> = {}): FillTarget {
  return {
    application_id: '00000000-0000-4000-8000-000000000002',
    content_hash: 'a'.repeat(64),
    job: {
      job_id: '00000000-0000-4000-8000-000000000004',
      company: 'Northwind Robotics',
      title: 'Senior Platform Engineer',
    },
    destination: {
      url: `${ORIGIN}/acme/jobs/1`,
      origin: ORIGIN,
      connector: 'greenhouse',
      connector_version: 'greenhouse/v1',
    },
    approval_expires_at: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('pairWithCode', () => {
  it('redeems the code once, without a token or cookies, and keeps the token', async () => {
    const { api, store } = fakeChrome();
    const { fetch, calls } = fakeFetch(200, EXCHANGED);

    const result = await pairWithCode(`${BASE}/`, '  abc DEF\n', {
      api,
      fetch,
      publicId: 'job-getter-extension/test',
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/devices/exchange`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(calls[0]!.init.headers).not.toHaveProperty('x-device-token');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      pairing_code: 'abcDEF',
      device_public_id: 'job-getter-extension/test',
    });

    expect(await readPairing(api)).toEqual({ baseUrl: BASE, token: EXCHANGED.token });
    expect(store.deviceId).toBe(EXCHANGED.device_id);
    // The code is spent; there is no reason for it to be anywhere now.
    expect(JSON.stringify(store)).not.toContain('abcDEF');
  });

  it('reports the API’s refusal and stores nothing', async () => {
    const { api, store } = fakeChrome();
    const { fetch } = fakeFetch(422, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'That pairing code is not valid. Generate a new one and try again.',
      },
    });

    const result = await pairWithCode(BASE, 'wrong-code', { api, fetch });

    expect(result).toEqual({
      ok: false,
      message: 'That pairing code is not valid. Generate a new one and try again.',
    });
    expect(store).toEqual({});
  });

  it('says plainly when the address is not a Job Getter installation', async () => {
    const { api } = fakeChrome();
    const { fetch } = fakeFetch(200, '<!doctype html><title>Router login</title>');
    const result = await pairWithCode(BASE, 'code-code', { api, fetch });
    expect(result).toEqual({
      ok: false,
      message: 'That address answered, but not as a Job Getter installation.',
    });
  });

  it('says so when the installation cannot be reached', async () => {
    const { api } = fakeChrome();
    const fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    const result = await pairWithCode(BASE, 'code-code', { api, fetch });
    expect(result).toEqual({ ok: false, message: `Could not reach ${BASE}. Is it running?` });
  });

  it('refuses an address that is not http or https, before any request', async () => {
    const { api } = fakeChrome();
    const { fetch, calls } = fakeFetch(200, EXCHANGED);
    const result = await pairWithCode('javascript:alert(1)', 'code-code', { api, fetch });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('needs a code', async () => {
    const { api } = fakeChrome();
    const { fetch, calls } = fakeFetch(200, EXCHANGED);
    expect(await pairWithCode(BASE, '   ', { api, fetch })).toEqual({
      ok: false,
      message: 'Paste the pairing code.',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('forgetPairing', () => {
  it('leaves nothing of the pairing in storage', async () => {
    const { api, store } = fakeChrome({
      baseUrl: BASE,
      token: 'x',
      deviceId: 'y',
      expiresAt: 'z',
    });
    await forgetPairing(api);
    expect(store).toEqual({});
  });
});

describe('loadTargets', () => {
  const paired = { baseUrl: BASE, token: 't'.repeat(43) };

  it('is unpaired, without a request, when there is no token', async () => {
    const { api } = fakeChrome();
    const { fetch, calls } = fakeFetch(200, { items: [] });
    expect(await loadTargets({ api, fetch })).toEqual({ kind: 'unpaired', message: null });
    expect(calls).toHaveLength(0);
  });

  it('asks with the device token, never with cookies', async () => {
    const { api } = fakeChrome(paired);
    const { fetch, calls } = fakeFetch(200, { items: [target()] });

    const result = await loadTargets({ api, fetch });

    expect(result).toEqual({ kind: 'ok', baseUrl: BASE, items: [target()] });
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/fill-targets`);
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.credentials).toBe('omit');
    expect(calls[0]!.init.headers).toEqual({ 'x-device-token': paired.token });
  });

  it('forgets a revoked or expired token rather than keep offering fills', async () => {
    const { api, store } = fakeChrome({ ...paired, deviceId: 'd', expiresAt: 'e' });
    const { fetch } = fakeFetch(401, {
      error: { code: 'UNAUTHENTICATED', message: 'This request needs a paired device token.' },
    });

    const result = await loadTargets({ api, fetch });

    expect(result.kind).toBe('unpaired');
    expect(store).toEqual({});
  });

  it('keeps the pairing through an outage', async () => {
    const { api, store } = fakeChrome(paired);
    const fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;

    const result = await loadTargets({ api, fetch });

    expect(result).toEqual({
      kind: 'error',
      baseUrl: BASE,
      message: `Could not reach ${BASE}. Is it running?`,
    });
    expect(store.token).toBe(paired.token);
  });
});

describe('normaliseBaseUrl', () => {
  it('drops trailing slashes and keeps a path prefix', () => {
    expect(normaliseBaseUrl(' http://127.0.0.1:3000/ ')).toBe(BASE);
    expect(normaliseBaseUrl('https://jobs.example.com/getter//')).toBe(
      'https://jobs.example.com/getter',
    );
  });

  it('refuses anything that is not a plain http or https address', () => {
    expect(normaliseBaseUrl('not a url')).toBeNull();
    expect(normaliseBaseUrl('file:///etc/passwd')).toBeNull();
    expect(normaliseBaseUrl('javascript:alert(1)')).toBeNull();
    // Credentials in the address would be stored beside the token.
    expect(normaliseBaseUrl('https://user:secret@jobs.example.com')).toBeNull();
    expect(normaliseBaseUrl('https://jobs.example.com/?next=elsewhere')).toBeNull();
  });
});

describe('normalisePairingCode', () => {
  it('removes whitespace and nothing else', () => {
    expect(normalisePairingCode(' Ab-c_D\n\te ')).toBe('Ab-c_De');
  });
});

describe('arrangeTargets', () => {
  it('offers to fill only what was approved for the tab’s own origin', () => {
    const mine = target();
    const other = target({
      application_id: '00000000-0000-4000-8000-000000000009',
      destination: {
        url: 'https://jobs.lever.co/acme/1',
        origin: 'https://jobs.lever.co',
        connector: null,
        connector_version: null,
      },
    });
    expect(arrangeTargets([mine, other], ORIGIN)).toEqual({ here: [mine], elsewhere: [other] });
  });

  it('offers nothing to fill on a tab with no readable origin', () => {
    expect(arrangeTargets([target()], null)).toEqual({ here: [], elsewhere: [target()] });
  });

  it('does not treat a lookalike host as the same origin', () => {
    const result = arrangeTargets([target()], 'https://boards.greenhouse.io.evil.example');
    expect(result.here).toEqual([]);
  });
});

describe('openableUrl', () => {
  it('opens the packet’s own destination', () => {
    expect(openableUrl(target())).toBe(`${ORIGIN}/acme/jobs/1`);
  });

  it('refuses a script URL or one that leaves the destination origin', () => {
    const base = target();
    expect(
      openableUrl({ ...base, destination: { ...base.destination, url: 'javascript:alert(1)' } }),
    ).toBeNull();
    expect(
      openableUrl({
        ...base,
        destination: { ...base.destination, url: 'https://evil.example/apply' },
      }),
    ).toBeNull();
  });
});
