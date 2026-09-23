/**
 * After the person submits: one look at the confirmation page, on their click.
 *
 * Driven through a fake `chrome` and a fake `fetch`, so what is asserted is
 * what the service worker asks of the tab and what it tells the API. The
 * rules it must keep:
 *
 *  * a page on another origin is never read and nothing is recorded;
 *  * a confirmation goes to the API with the page's own words, and no clock;
 *  * nothing recognisable goes as "could not tell", never as "not submitted";
 *  * a page that navigated away while being read records nothing.
 */
import { describe, expect, it } from 'vitest';
import type { AwaitingSubmission } from '@job-getter/contracts';
import { checkConfirmation } from '../src/background.js';
import type { ContentMessage, WorkerMessage } from '../src/messages.js';
import { checkableHere } from '../src/targets.js';

const BASE = 'http://127.0.0.1:3000';
const ORIGIN = 'https://boards.greenhouse.io';
const PAGE = `${ORIGIN}/northwind/jobs/1/confirmation`;

const ITEM: AwaitingSubmission = {
  fill_session_id: '00000000-0000-4000-8000-00000000000f',
  application_id: '00000000-0000-4000-8000-000000000002',
  job: {
    job_id: '00000000-0000-4000-8000-000000000004',
    company: 'Northwind Robotics',
    title: 'Senior Platform Engineer',
  },
  destination: {
    url: `${ORIGIN}/northwind/jobs/1`,
    origin: ORIGIN,
    connector: 'greenhouse',
    connector_version: 'greenhouse/v1',
  },
  filled_at: '2026-09-22T12:00:00.000Z',
};

function fakeChrome(tabUrl: string, answers: ContentMessage[]) {
  const sent: WorkerMessage[] = [];
  let injected = 0;
  const api = {
    storage: {
      local: {
        get: async () => ({ baseUrl: BASE, token: 'device-token' }),
        set: async () => undefined,
        remove: async () => undefined,
      },
    },
    tabs: {
      query: async () => [{ id: 7, url: tabUrl }],
      get: async () => ({ id: 7, url: tabUrl }),
      sendMessage: async (_tabId: number, message: WorkerMessage) => {
        sent.push(message);
        return answers[Math.min(sent.length - 1, answers.length - 1)]!;
      },
    },
    scripting: {
      executeScript: async () => {
        injected += 1;
        return [];
      },
    },
  };
  return {
    api: api as unknown as NonNullable<Parameters<typeof checkConfirmation>[1]>['api'],
    sent,
    injected: () => injected,
  };
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const noWait = async () => undefined;

const GREENHOUSE = { name: 'greenhouse', version: 'v1' };

const CONFIRMED: ContentMessage = {
  type: 'page/confirmation',
  url: PAGE,
  adapter: GREENHOUSE,
  confirmation: {
    confirmation_text: 'Your application has been submitted',
    reference: 'NW-2026-4471',
  },
};
const NOTHING: ContentMessage = {
  type: 'page/confirmation',
  url: PAGE,
  adapter: GREENHOUSE,
  confirmation: null,
};

describe('checking a confirmation', () => {
  it('sends a confirmation with the page’s words, and lets the API keep time', async () => {
    const chrome = fakeChrome(PAGE, [CONFIRMED]);
    const api = fakeFetch(200, { application_id: ITEM.application_id, status: 'submitted' });

    const result = await checkConfirmation(ITEM, {
      api: chrome.api,
      fetch: api.fetch,
      sleep: noWait,
    });

    expect(result).toEqual({
      ok: true,
      message: 'The page confirms it (reference NW-2026-4471). Recorded as submitted.',
    });
    expect(chrome.sent).toEqual([{ type: 'page/read-confirmation' }]);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toBe(
      `${BASE}/api/v1/fill-sessions/${ITEM.fill_session_id}/observation`,
    );
    const body = JSON.parse(api.calls[0]!.init.body as string);
    expect(body).toEqual({
      outcome: 'observed',
      confirmation: {
        confirmation_text: 'Your application has been submitted',
        reference: 'NW-2026-4471',
        url: PAGE,
      },
      unknown_reason: null,
      page_url: PAGE,
      adapter: 'greenhouse',
      adapter_version: 'v1',
    });
    expect(JSON.stringify(body)).not.toContain('observed_at');
    // The device token, never the person's cookies.
    expect(api.calls[0]!.init.credentials).toBe('omit');
  });

  it('gives a page that is still rendering a few more looks before giving up', async () => {
    const chrome = fakeChrome(PAGE, [NOTHING, NOTHING, CONFIRMED]);
    const api = fakeFetch(200, { application_id: ITEM.application_id, status: 'submitted' });
    await checkConfirmation(ITEM, { api: chrome.api, fetch: api.fetch, sleep: noWait });
    expect(chrome.sent).toHaveLength(3);
    expect(JSON.parse(api.calls[0]!.init.body as string).outcome).toBe('observed');
  });

  it('reports nothing recognisable as could-not-tell, never as not submitted', async () => {
    const chrome = fakeChrome(PAGE, [NOTHING]);
    const api = fakeFetch(200, { application_id: ITEM.application_id, status: 'outcome_unknown' });

    const result = await checkConfirmation(ITEM, {
      api: chrome.api,
      fetch: api.fetch,
      sleep: noWait,
      attempts: 3,
    });

    expect(chrome.sent).toHaveLength(3);
    const body = JSON.parse(api.calls[0]!.init.body as string);
    expect(body).toMatchObject({
      outcome: 'unknown',
      confirmation: null,
      unknown_reason: 'no_confirmation_found',
    });
    expect(result.message).toContain('Job Getter will ask you what happened');
  });

  it('says unsupported when no adapter claims the page', async () => {
    const chrome = fakeChrome(PAGE, [
      { type: 'page/unsupported', url: PAGE, reason: 'no tested adapter matches this page' },
    ]);
    const api = fakeFetch(200, { application_id: ITEM.application_id, status: 'outcome_unknown' });
    await checkConfirmation(ITEM, { api: chrome.api, fetch: api.fetch, sleep: noWait });
    expect(chrome.sent).toHaveLength(1);
    const body = JSON.parse(api.calls[0]!.init.body as string);
    expect(body.unknown_reason).toBe('unsupported');
    // No adapter read the page, so the report names none.
    expect(body).toMatchObject({ adapter: null, adapter_version: null });
  });

  it('names the adapter the page reports only when this build has it', async () => {
    // The content script shares a DOM with the employer's page. Whatever it
    // claims read the page is checked, not passed through to the API.
    const lever = fakeChrome(PAGE, [{ ...CONFIRMED, adapter: { name: 'lever', version: 'v1' } }]);
    const forged = fakeChrome(PAGE, [
      { ...CONFIRMED, adapter: { name: 'anything', version: 'v9' } },
    ]);
    const first = fakeFetch(200, { application_id: ITEM.application_id, status: 'submitted' });
    const second = fakeFetch(200, { application_id: ITEM.application_id, status: 'submitted' });

    await checkConfirmation(ITEM, { api: lever.api, fetch: first.fetch, sleep: noWait });
    await checkConfirmation(ITEM, { api: forged.api, fetch: second.fetch, sleep: noWait });

    expect(JSON.parse(first.calls[0]!.init.body as string)).toMatchObject({
      adapter: 'lever',
      adapter_version: 'v1',
    });
    expect(JSON.parse(second.calls[0]!.init.body as string)).toMatchObject({
      adapter: null,
      adapter_version: null,
    });
  });

  it('never reads a page on another origin, and records nothing', async () => {
    const chrome = fakeChrome('https://attacker.example/thanks', [CONFIRMED]);
    const api = fakeFetch(200, {});
    const result = await checkConfirmation(ITEM, {
      api: chrome.api,
      fetch: api.fetch,
      sleep: noWait,
    });
    expect(result.ok).toBe(false);
    expect(chrome.injected()).toBe(0);
    expect(chrome.sent).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it('records nothing if the page left the origin while it was being read', async () => {
    const moved: ContentMessage = { ...CONFIRMED, url: 'https://elsewhere.example/thanks' };
    const chrome = fakeChrome(PAGE, [moved]);
    const api = fakeFetch(200, {});
    const result = await checkConfirmation(ITEM, {
      api: chrome.api,
      fetch: api.fetch,
      sleep: noWait,
    });
    expect(result).toEqual({
      ok: false,
      message: 'The page moved to another site. Nothing was recorded.',
    });
    expect(api.calls).toEqual([]);
  });

  it('passes the API’s refusal on in its own words', async () => {
    const chrome = fakeChrome(PAGE, [CONFIRMED]);
    const api = fakeFetch(409, {
      error: {
        code: 'CONFLICT',
        message: 'This application is "submitted", so there is nothing to confirm.',
      },
    });
    const result = await checkConfirmation(ITEM, {
      api: chrome.api,
      fetch: api.fetch,
      sleep: noWait,
    });
    expect(result).toEqual({
      ok: false,
      message: 'This application is "submitted", so there is nothing to confirm.',
    });
  });
});

describe('which waiting applications the popup offers to check', () => {
  it('only on their own origin', () => {
    expect(checkableHere(ITEM, ORIGIN)).toBe(true);
    expect(checkableHere(ITEM, 'https://boards.greenhouse.io.attacker.example')).toBe(false);
    expect(checkableHere(ITEM, null)).toBe(false);
  });
});
