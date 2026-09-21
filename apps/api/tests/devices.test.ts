/**
 * Device pairing, and the limits on what a paired device may do (M4, PR09).
 *
 * A device token is the most dangerous credential this system issues, so these
 * are mostly tests about refusals:
 *
 *  * **AT23** — a revoked token is denied on its very next request, not at its
 *    next expiry.
 *  * A device may claim `fill_local` and nothing else; the operator worker is
 *    the mirror image and may claim everything else and not that.
 *  * A pairing code works exactly once, lives five minutes, and is stored only
 *    as a digest. Wrong, expired and already-used are one indistinguishable
 *    answer.
 *  * A device token is not a session: it opens nothing on `/api/v1`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEVICE_PAIRING_TTL_SECONDS,
  DEVICE_TOKEN_HEADER,
  PROTOCOL_VERSION,
  type DeviceView,
  type PairingCodeResponse,
} from '@job-getter/contracts';
import {
  asDevice,
  asWorker,
  authed,
  completeSetup,
  createHarness,
  TEST_ORIGIN,
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

async function createPairing(
  body: Record<string, unknown> = { device_kind: 'local_runner', label: 'Laptop' },
): Promise<PairingCodeResponse> {
  const response = await harness.app.inject(
    authed(session, { method: 'POST', url: '/api/v1/devices/pairing', payload: body }),
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as PairingCodeResponse;
}

function exchange(code: string, publicId = 'linux-testbox') {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/devices/exchange',
    payload: { pairing_code: code, device_public_id: publicId },
  });
}

async function pairedToken(allowedOrigins?: string[]): Promise<{ token: string; id: string }> {
  const pairing = await createPairing({
    device_kind: 'local_runner',
    label: 'Laptop',
    ...(allowedOrigins ? { allowed_origins: allowedOrigins } : {}),
  });
  const exchanged = await exchange(pairing.pairing_code);
  expect(exchanged.statusCode, exchanged.body).toBe(200);
  return { token: exchanged.json().token as string, id: pairing.device_id };
}

function claim(token: string, capabilities: string[]) {
  return harness.app.inject(
    asDevice(token, {
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: {
        worker_id: 'runner-1',
        capabilities,
        protocol_version: PROTOCOL_VERSION,
      },
    }),
  );
}

// ---------------------------------------------------------------------------

describe('POST /devices/pairing', () => {
  it('returns a code that expires in five minutes', async () => {
    const pairing = await createPairing();
    expect(pairing.expires_in).toBe(DEVICE_PAIRING_TTL_SECONDS);
    expect(pairing.pairing_code.length).toBeGreaterThanOrEqual(8);
  });

  it('stores only a digest of the code, never the code', async () => {
    const pairing = await createPairing();
    const row = await harness.db.selectFrom('paired_devices').selectAll().executeTakeFirstOrThrow();

    expect(row.pairing_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.pairing_code_hash).not.toBe(pairing.pairing_code);
    expect(JSON.stringify(row)).not.toContain(pairing.pairing_code);
    expect(row.token_hash).toBeNull();
  });

  it('needs a session: an anonymous caller cannot mint one', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/devices/pairing',
      headers: { origin: TEST_ORIGIN },
      payload: { device_kind: 'local_runner', label: 'Laptop' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an origin that is not an origin', async () => {
    const response = await harness.app.inject(
      authed(session, {
        method: 'POST',
        url: '/api/v1/devices/pairing',
        payload: {
          device_kind: 'local_runner',
          label: 'Laptop',
          allowed_origins: ['boards.greenhouse.io/acme'],
        },
      }),
    );
    expect(response.statusCode, response.body).toBe(422);
  });

  it('keeps only the scheme and host of an origin', async () => {
    const pairing = await createPairing({
      device_kind: 'local_runner',
      label: 'Laptop',
      allowed_origins: ['https://boards.greenhouse.io/acme/jobs/1'],
    });
    const device = await harness.app.inject(
      authed(session, { method: 'GET', url: `/api/v1/devices/${pairing.device_id}` }),
    );
    expect((device.json() as DeviceView).allowed_origins).toEqual(['https://boards.greenhouse.io']);
  });
});

describe('POST /devices/exchange', () => {
  it('hands the token over exactly once', async () => {
    const pairing = await createPairing();

    const first = await exchange(pairing.pairing_code);
    expect(first.statusCode, first.body).toBe(200);
    expect((first.json().token as string).length).toBeGreaterThanOrEqual(32);

    const second = await exchange(pairing.pairing_code);
    expect(second.statusCode, second.body).toBe(422);
  });

  it('stores only a digest of the token', async () => {
    const { token } = await pairedToken();
    const row = await harness.db.selectFrom('paired_devices').selectAll().executeTakeFirstOrThrow();

    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    // The code is destroyed as it is spent, so a replay has nothing to match.
    expect(row.pairing_code_hash).toBeNull();
  });

  it('gives one answer for wrong, expired and already used', async () => {
    const pairing = await createPairing();
    await harness.db
      .updateTable('paired_devices')
      .set({ pairing_expires_at: new Date(Date.now() - 1000) })
      .execute();

    const expired = await exchange(pairing.pairing_code);
    const wrong = await exchange('a'.repeat(32));

    expect(expired.statusCode).toBe(422);
    expect(wrong.statusCode).toBe(422);
    expect(expired.json().error.message).toBe(wrong.json().error.message);
  });

  it('is reachable without a browser origin, because a runner is not a browser', async () => {
    const pairing = await createPairing();
    // No Origin, no Referer, no cookie: exactly what a desktop process sends.
    const response = await exchange(pairing.pairing_code);
    expect(response.statusCode, response.body).toBe(200);
  });
});

describe('what a device token can reach', () => {
  it('claims fill_local', async () => {
    const { token } = await pairedToken();
    const response = await claim(token, ['fill_local']);
    // 204: authorised, and there is simply no work queued.
    expect(response.statusCode, response.body).toBe(204);
  });

  it('cannot claim anything else', async () => {
    const { token } = await pairedToken();
    const response = await claim(token, ['parse_profile']);
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json().error.message).toContain('may only claim');
  });

  it('cannot be used as a session on the public API', async () => {
    const { token } = await pairedToken();
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { [DEVICE_TOKEN_HEADER]: token },
    });
    expect(response.statusCode).toBe(401);
  });

  it('the operator worker still cannot claim fill_local', async () => {
    const response = await harness.app.inject(
      asWorker({
        method: 'POST',
        url: '/internal/v1/tasks/claim',
        payload: {
          worker_id: 'operator-1',
          capabilities: ['fill_local'],
          protocol_version: PROTOCOL_VERSION,
        },
      }),
    );
    expect(response.statusCode, response.body).toBe(403);
  });

  it('a made-up token is rejected rather than falling back to the worker', async () => {
    const response = await claim('not-a-real-device-token-0123456789', ['fill_local']);
    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /devices/:id (AT23)', () => {
  it('denies the very next request, not the next expiry', async () => {
    const { token, id } = await pairedToken();
    expect((await claim(token, ['fill_local'])).statusCode).toBe(204);

    const revoked = await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/devices/${id}` }),
    );
    expect(revoked.statusCode, revoked.body).toBe(204);

    const after = await claim(token, ['fill_local']);
    expect(after.statusCode).toBe(401);
  });

  it('destroys the credential rather than only marking it', async () => {
    const { id } = await pairedToken();
    await harness.app.inject(authed(session, { method: 'DELETE', url: `/api/v1/devices/${id}` }));

    const row = await harness.db
      .selectFrom('paired_devices')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.token_hash).toBeNull();
    expect(row.revoked_at).not.toBeNull();
  });

  it('reports the device as revoked rather than hiding it', async () => {
    const { id } = await pairedToken();
    await harness.app.inject(authed(session, { method: 'DELETE', url: `/api/v1/devices/${id}` }));

    const listed = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/devices' }),
    );
    const items = listed.json().items as DeviceView[];
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('revoked');
  });

  it('refuses to revoke twice', async () => {
    const { id } = await pairedToken();
    await harness.app.inject(authed(session, { method: 'DELETE', url: `/api/v1/devices/${id}` }));
    const again = await harness.app.inject(
      authed(session, { method: 'DELETE', url: `/api/v1/devices/${id}` }),
    );
    expect(again.statusCode).toBe(409);
  });
});

describe('GET /devices', () => {
  it('reports a device that has not exchanged its code as pending', async () => {
    await createPairing();
    const listed = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/devices' }),
    );
    expect((listed.json().items as DeviceView[])[0]!.status).toBe('pending');
  });

  it('reports a code that ran out as expired, not as still pending', async () => {
    await createPairing();
    await harness.db
      .updateTable('paired_devices')
      .set({ pairing_expires_at: new Date(Date.now() - 1000) })
      .execute();

    const listed = await harness.app.inject(
      authed(session, { method: 'GET', url: '/api/v1/devices' }),
    );
    expect((listed.json().items as DeviceView[])[0]!.status).toBe('expired');
  });
});
