/**
 * AT24's other half: a malicious page's message cannot become a command.
 *
 * `docs/spec/07_APPLICATION_AUTOMATION.md`: "Service worker verifies message
 * sender/tab/origin; do not trust page-origin window messages as privileged
 * commands." The API half of this scenario is asserted in
 * `apps/api/tests/fill-sessions.test.ts`; this is the extension half.
 *
 * The extension id is not a secret — it is in the URL of every injected
 * resource — so `chrome.runtime.sendMessage` is reachable by any page that
 * learns it, and by any other installed extension. Every one of those callers
 * is refused here.
 */
import { describe, expect, it } from 'vitest';
import { verifySender } from '../src/messages.js';

const SESSION = { tabId: 7, origin: 'https://boards.greenhouse.io' } as const;

function sender(overrides: Partial<Parameters<typeof verifySender>[0]> = {}) {
  return {
    tabId: 7,
    frameId: 0,
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    ...overrides,
  };
}

describe('verifySender', () => {
  it('accepts our content script in the bound tab, top frame, bound origin', () => {
    expect(verifySender(sender(), SESSION)).toEqual({ ok: true });
  });

  it('refuses a caller with no tab: another extension, or a page with our id', () => {
    const verdict = verifySender(sender({ tabId: undefined }), SESSION);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('did not come from a tab') });
  });

  it('refuses a different tab answering for the one being filled', () => {
    const verdict = verifySender(sender({ tabId: 8 }), SESSION);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('different tab') });
  });

  it('refuses a subframe, which is where hostile content lives', () => {
    // An advert or an embedded widget inside the employer's own page.
    const verdict = verifySender(sender({ frameId: 3 }), SESSION);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('subframe') });
  });

  it('refuses the right tab on the wrong origin: it navigated after the grant', () => {
    const verdict = verifySender(sender({ url: 'https://attacker.example/apply' }), SESSION);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('attacker.example') });
  });

  it('refuses a sender whose URL is absent or unparseable', () => {
    expect(verifySender(sender({ url: undefined }), SESSION).ok).toBe(false);
    expect(verifySender(sender({ url: 'not a url' }), SESSION).ok).toBe(false);
  });

  it('does not accept an origin smuggled in the path or a lookalike host', () => {
    for (const url of [
      'https://attacker.example/https://boards.greenhouse.io',
      'https://boards.greenhouse.io.attacker.example/a',
      'http://boards.greenhouse.io/a', // scheme is part of an origin
      'https://boards.greenhouse.io:8443/a', // so is the port
    ]) {
      expect(verifySender(sender({ url }), SESSION).ok, url).toBe(false);
    }
  });
});

describe('handleContentMessage', () => {
  it('refuses everything when no fill session is open', async () => {
    // Importing the service worker module is safe outside a browser: its
    // listener registration is guarded on `chrome` being defined.
    const { handleContentMessage, setBinding } = await import('../src/background.js');
    setBinding(null);

    expect(
      handleContentMessage({ tab: { id: 7 }, frameId: 0, url: 'https://x.example/a' }),
    ).toEqual({ ok: false, reason: 'no fill session is open' });
  });

  it('applies the sender check to a message that arrives during a session', async () => {
    const { handleContentMessage, setBinding } = await import('../src/background.js');
    setBinding({ tabId: 7, origin: 'https://boards.greenhouse.io' });

    expect(
      handleContentMessage({
        tab: { id: 7 },
        frameId: 0,
        url: 'https://boards.greenhouse.io/acme/jobs/1',
      }),
    ).toEqual({ ok: true });

    // The same three refusals, now reached through the handler rather than
    // through `verifySender` directly: the wiring is what a page would meet.
    expect(handleContentMessage({ frameId: 0, url: 'https://boards.greenhouse.io/a' }).ok).toBe(
      false,
    );
    expect(
      handleContentMessage({ tab: { id: 7 }, frameId: 2, url: 'https://boards.greenhouse.io/a' })
        .ok,
    ).toBe(false);
    expect(
      handleContentMessage({ tab: { id: 7 }, frameId: 0, url: 'https://attacker.example/a' }).ok,
    ).toBe(false);

    setBinding(null);
  });
});
