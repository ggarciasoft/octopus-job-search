/**
 * The service worker: the only place a credential lives.
 *
 * It holds the paired device token, asks the API for a fill session, decides
 * what may be typed using the shared planner, and hands the content script a
 * list of values and nothing else. The token and the session nonce never cross
 * into a tab, so a page that entirely owns its content script still cannot
 * read them (AT24).
 *
 * `chrome.storage.local` is not reachable from a content script or a page —
 * only from extension contexts — which is why the token lives there rather
 * than anywhere the page's world can see. It survives a browser restart, which
 * matters because the alternative is asking the person to re-pair daily; the
 * token expires in thirty days and is revocable from the web app either way.
 *
 * The flow is deliberately linear and deliberately gives up rather than
 * improvising. Every branch that could act on the wrong page ends the session
 * instead of continuing, because a fill session left open blocks the next
 * attempt for ten minutes and a fill on the wrong page is someone's real
 * application.
 */
import type { FillSessionGrant } from '@job-getter/contracts';
import {
  createFillSession,
  downloadFillSessionResume,
  endFillSession,
  reportFillSession,
  type ApiOptions,
  type ResumeBytes,
} from './api.js';
import { verifySender, type ContentMessage, type WorkerMessage } from './messages.js';
import {
  decide,
  formFingerprint,
  formFingerprintMaterial,
  originOf,
  withBlockedAttachment,
} from './session.js';
import { ADAPTER_NAME, ADAPTER_VERSION } from './adapters/greenhouse.js';

// A minimal structural view of the parts of the extension API this file uses,
// typed here rather than through `@types/chrome`, which is not in the lock.
interface Tab {
  readonly id?: number;
  readonly url?: string;
}
interface MessageSender {
  readonly tab?: { readonly id?: number };
  readonly frameId?: number;
  readonly url?: string;
}
interface ChromeApi {
  permissions: {
    contains(request: { origins: string[] }): Promise<boolean>;
    request(request: { origins: string[] }): Promise<boolean>;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    query(info: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    get(tabId: number): Promise<Tab | undefined>;
    sendMessage(tabId: number, message: WorkerMessage): Promise<ContentMessage>;
  };
  scripting: {
    executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
  runtime: {
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          respond: (value: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
}
declare const chrome: ChromeApi;

export interface StoredPairing {
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * The tab and origin the open session is bound to.
 *
 * Module state rather than storage: a binding that outlived the service
 * worker would be a binding nobody is watching, and the session it names
 * expires in ten minutes anyway.
 */
let binding: { tabId: number; origin: string } | null = null;

export function currentBinding(): { tabId: number; origin: string } | null {
  return binding;
}

export function setBinding(next: { tabId: number; origin: string } | null): void {
  binding = next;
}

export async function readPairing(api: ChromeApi = chrome): Promise<StoredPairing | null> {
  const stored = await api.storage.local.get(['baseUrl', 'token']);
  const { baseUrl, token } = stored;
  if (typeof baseUrl !== 'string' || typeof token !== 'string') return null;
  return { baseUrl, token };
}

export async function savePairing(pairing: StoredPairing, api: ChromeApi = chrome): Promise<void> {
  await api.storage.local.set({ baseUrl: pairing.baseUrl, token: pairing.token });
}

/**
 * Ask for permission to talk to the user's own installation.
 *
 * The API registers no CORS plugin anywhere, deliberately: "never expose a
 * wildcard CORS policy with credentials", and with no
 * `Access-Control-Allow-Origin` header a browser refuses to hand any other
 * origin the response. An extension's fetch is subject to that like anyone
 * else's — *unless* the extension holds host permission for the origin, which
 * exempts it.
 *
 * So one host permission is genuinely necessary, and it is requested rather
 * than declared: `optional_host_permissions` in the manifest makes it
 * requestable, and this asks for exactly the origin the person typed, on their
 * own gesture, with Chrome's own prompt naming it. The extension ships with no
 * host access to anywhere, which is what "request additional host permissions
 * only when necessary with a clear explanation" means in practice.
 */
export async function ensureApiPermission(
  baseUrl: string,
  api: ChromeApi = chrome,
): Promise<boolean> {
  const origins = [`${new URL(baseUrl).origin}/*`];
  if (await api.permissions.contains({ origins })) return true;
  return api.permissions.request({ origins });
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export interface FillReport {
  readonly ok: boolean;
  readonly message: string;
}

export interface FillOptions {
  /**
   * The tab to fill, resolved when the popup opened rather than when the
   * button was clicked.
   *
   * These are not the same moment. A person can open the popup over an
   * employer's form, change their mind, switch tabs and come back to click —
   * and a fill that re-queried "the active tab" at click time would then act
   * on whatever is in front of them now. The popup resolves the tab once, as
   * it renders, and says which one it meant.
   */
  readonly tabId?: number;
  readonly api?: ChromeApi;
  readonly digest?: (input: string) => Promise<string>;
}

/** The whole flow, from the person pressing "Fill" to the API being told. */
export async function fillActiveTab(
  applicationId: string,
  contentHash: string,
  options_: FillOptions = {},
): Promise<FillReport> {
  const api = options_.api ?? chrome;
  const digest = options_.digest ?? sha256Hex;

  const pairing = await readPairing(api);
  if (pairing === null) {
    return { ok: false, message: 'Pair this browser with your installation first.' };
  }

  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const tab =
    options_.tabId === undefined ? tabs[0] : ((await api.tabs.get(options_.tabId)) ?? undefined);
  if (tab?.id === undefined || tab.url === undefined) {
    return { ok: false, message: 'No tab to fill.' };
  }
  const origin = originOf(tab.url);
  if (origin === null) return { ok: false, message: 'That tab has no readable address.' };

  const options: ApiOptions = { baseUrl: pairing.baseUrl, token: pairing.token };

  let grant: FillSessionGrant;
  try {
    grant = await createFillSession(options, {
      application_id: applicationId,
      origin,
      content_hash: contentHash,
    });
  } catch (error) {
    // The API refused: a stale packet, a revoked device, a wrong origin, or a
    // fill already in progress. Its message is written for the person.
    return { ok: false, message: error instanceof Error ? error.message : 'The API refused.' };
  }

  setBinding({ tabId: tab.id, origin: grant.origin });
  const tabId = tab.id;

  try {
    await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const inspected = await api.tabs.sendMessage(tabId, { type: 'page/inspect' });

    if (inspected.type === 'page/unsupported') {
      // AT17: the packet and its approval survive, so the person can apply by
      // hand. Reported rather than silently abandoned.
      await reportFillSession(options, grant.session_id, grant.nonce, {
        filled_fields: [],
        unresolved_fields: [],
        page_url: inspected.url,
        form_fingerprint: null,
        outcome: 'unsupported',
        adapter: ADAPTER_NAME,
        adapter_version: ADAPTER_VERSION,
      });
      return { ok: false, message: 'No tested adapter matches this page. Apply in your browser.' };
    }
    if (inspected.type !== 'page/inspected') {
      await endFillSession(options, grant.session_id, grant.nonce);
      return { ok: false, message: 'The page did not answer.' };
    }

    const material = formFingerprintMaterial(inspected);
    const decision = decide(grant, inspected, {
      fingerprint: material === '' ? null : formFingerprint(await digest(material)),
      adapter: ADAPTER_NAME,
      adapterVersion: ADAPTER_VERSION,
    });

    if (decision.kind === 'refuse') {
      await reportFillSession(options, grant.session_id, grant.nonce, decision.report);
      return { ok: false, message: decision.reason };
    }

    // The CV, if this packet has one and the page has somewhere to put it.
    // Fetched here, in the service worker, and handed to the content script
    // as bytes: the tab never learns where the file came from or how to ask
    // for it again.
    let attachment: ResumeBytes | null = null;
    if (decision.attachment !== null && grant.resume_file_id !== null) {
      try {
        attachment = await downloadFillSessionResume(
          options,
          grant.session_id,
          grant.nonce,
          grant.resume_filename ?? 'cv.pdf',
        );
      } catch {
        // "Where browser/site restrictions prevent it, show a
        // download-and-attach step." A CV that cannot be fetched is the same
        // situation: the field is left for the person rather than the run
        // being abandoned.
        attachment = null;
      }
    }

    const filled = await api.tabs.sendMessage(tabId, {
      type: 'page/fill',
      values: decision.instructions,
      attachment,
      attachmentSelector: decision.attachment?.selector ?? null,
    });
    if (filled.type !== 'page/filled') {
      await endFillSession(options, grant.session_id, grant.nonce);
      return { ok: false, message: 'The page did not report what was filled.' };
    }

    // What the page actually accepted, not what was planned for it.
    const attached =
      decision.attachment === null ||
      filled.filled.some(
        (field) => field.key === decision.attachment!.selector && field.outcome === 'filled',
      );
    const report = attached
      ? decision.report
      : withBlockedAttachment(decision.report, decision.attachment!);

    await reportFillSession(options, grant.session_id, grant.nonce, report);
    return {
      ok: true,
      message:
        report.outcome === 'needs_input'
          ? 'Filled what the packet answers. Some questions still need you.'
          : 'Filled. Check it, then press the employer’s own submit button.',
    };
  } catch (error) {
    // A session left open blocks the next attempt for ten minutes.
    await endFillSession(options, grant.session_id, grant.nonce).catch(() => undefined);
    return { ok: false, message: error instanceof Error ? error.message : 'The fill failed.' };
  } finally {
    setBinding(null);
  }
}

/**
 * Anything may call `chrome.runtime.sendMessage` if it learns the extension
 * id, which is not a secret. Every such caller is refused unless it is our
 * content script, in the tab this session was opened for, in the top frame,
 * on the bound origin.
 */
export function handleContentMessage(
  sender: MessageSender,
): { ok: true } | { ok: false; reason: string } {
  const session = currentBinding();
  if (session === null) return { ok: false, reason: 'no fill session is open' };
  return verifySender({ tabId: sender.tab?.id, frameId: sender.frameId, url: sender.url }, session);
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((_message, sender, respond) => {
    respond(handleContentMessage(sender));
    return true;
  });
}
