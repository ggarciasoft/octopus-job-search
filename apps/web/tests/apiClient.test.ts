import { ApiError, JobGetterApiClient } from '@job-getter/api-client';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api/client';
import { IdempotentIntent } from '../src/api/idempotency';
import { readCookie, readCsrfToken, setCsrfTokenFromSession } from '../src/api/csrf';
import { describeFailure } from '../src/api/errors';
import { CSRF_COOKIE, SESSION_COOKIE } from '@job-getter/contracts';

/**
 * The web app is generated-client-shaped by assumption; this test makes the
 * assumption fail loudly rather than at runtime in a browser.
 */
describe('generated API client', () => {
  it('exports a constructor with the routes this milestone calls', () => {
    expect(typeof JobGetterApiClient).toBe('function');
    for (const method of [
      'getSetupStatus',
      'completeSetup',
      'login',
      'logout',
      'getMe',
      'getTask',
      'cancelTask',
      'listTasks',
      'createDiagnosticTask',
    ]) {
      const prototype = JobGetterApiClient.prototype as unknown as Record<string, unknown>;
      expect(typeof prototype[method]).toBe('function');
    }
  });

  it('sends the session cookie and the anti-CSRF token on a mutating route', async () => {
    setCsrfTokenFromSession('csrf-value');
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '' });
    // The client is constructed with `readCsrfToken`; swap the transport only.
    const probe = new JobGetterApiClient({
      baseUrl: '',
      fetch: fetchMock,
      getCsrfToken: readCsrfToken,
    });
    expect(client).toBeInstanceOf(JobGetterApiClient);

    await probe.logout({});

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/logout');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-value');
    setCsrfTokenFromSession(undefined);
  });

  it('raises ApiError with the envelope from 04_API_CONTRACTS.md', async () => {
    const body = JSON.stringify({
      error: {
        code: 'STALE_REVISION',
        message: 'The profile changed',
        fields: { expected_revision: 'stale' },
        request_id: '66666666-6666-4666-8666-666666666666',
      },
    });
    const probe = new JobGetterApiClient({
      baseUrl: '',
      fetch: async () =>
        new Response(body, { status: 409, headers: { 'Content-Type': 'application/json' } }),
    });

    await expect(probe.getMe({})).rejects.toBeInstanceOf(ApiError);

    const failure = await probe.getMe({}).catch((error: unknown) => describeFailure(error));
    expect(failure).toMatchObject({
      code: 'STALE_REVISION',
      status: 409,
      isStale: true,
      requestId: '66666666-6666-4666-8666-666666666666',
      messageKey: 'error.STALE_REVISION',
    });
  });
});

describe('CSRF token lookup', () => {
  it('parses the cookie jar, ignoring unrelated entries', () => {
    expect(readCookie(`a=1; ${CSRF_COOKIE}=abc; b=2`, [CSRF_COOKIE])).toBe('abc');
    expect(readCookie(`${CSRF_COOKIE}=enc%20oded`, [CSRF_COOKIE])).toBe('enc oded');
    expect(readCookie('unrelated=1', [CSRF_COOKIE])).toBeUndefined();
    expect(readCookie('', [CSRF_COOKIE])).toBeUndefined();
  });

  it('reads the cookie name the API actually sets', () => {
    // Asserted against the contract constant rather than a literal, because
    // the API imports the same constant. A rename now breaks this test
    // instead of silently disabling CSRF protection in the browser.
    document.cookie = `${CSRF_COOKIE}=from-cookie`;
    expect(readCsrfToken()).toBe('from-cookie');
  });

  it('never reads the HttpOnly session cookie', () => {
    // document.cookie cannot expose an HttpOnly cookie, but this pins the
    // intent: the session token must never be reachable from script.
    document.cookie = `${CSRF_COOKIE}=from-cookie`;
    expect(readCookie(document.cookie, [SESSION_COOKIE])).toBeUndefined();
  });

  it('prefers a token supplied by the session over the cookie', () => {
    document.cookie = `${CSRF_COOKIE}=from-cookie`;
    expect(readCsrfToken()).toBe('from-cookie');
    setCsrfTokenFromSession('from-session');
    expect(readCsrfToken()).toBe('from-session');
    setCsrfTokenFromSession(undefined);
    expect(readCsrfToken()).toBe('from-cookie');
  });
});

describe('idempotency keys', () => {
  it('reuses one key while the request is unchanged and issues a new one when it changes', () => {
    const intent = new IdempotentIntent();
    const first = intent.keyFor({ message: 'a' });

    expect(intent.keyFor({ message: 'a' })).toBe(first);
    const second = intent.keyFor({ message: 'b' });
    expect(second).not.toBe(first);

    // After the command is accepted, the next attempt is new work.
    intent.complete();
    expect(intent.keyFor({ message: 'b' })).not.toBe(second);
  });
});
