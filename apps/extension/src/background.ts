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
import type { AwaitingSubmission, FillSessionGrant, FillTarget } from '@job-getter/contracts';
import {
  createFillSession,
  downloadFillSessionResume,
  endFillSession,
  exchangePairingCode,
  FillSessionApiError,
  listFillTargets,
  reportFillSession,
  reportObservation,
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
import { knownAdapter } from './adapters/known.js';
import { normaliseBaseUrl, normalisePairingCode } from './targets.js';

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
      remove(keys: string[]): Promise<void>;
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

/** Everything a pairing leaves in storage, so forgetting it leaves nothing. */
const PAIRING_KEYS = ['baseUrl', 'token', 'deviceId', 'expiresAt'];

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

export async function forgetPairing(api: ChromeApi = chrome): Promise<void> {
  await api.storage.local.remove(PAIRING_KEYS);
}

export type PairResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface PairOptions {
  readonly api?: ChromeApi;
  readonly fetch?: typeof globalThis.fetch;
  /** How this browser names itself in Settings → Devices. */
  readonly publicId?: string;
}

/**
 * Redeem a pairing code from Settings → Devices, and keep the token.
 *
 * This replaces pasting a token. The person never sees one: the code they
 * copy is single-use and dies in five minutes, and the token it buys goes
 * straight from the response into `chrome.storage.local`, which no page and
 * no content script can read. The code itself is not stored anywhere.
 *
 * Host permission for the installation must already be held — see
 * `ensureApiPermission`, which has to run on the popup's own click.
 */
export async function pairWithCode(
  baseUrl: string,
  code: string,
  options: PairOptions = {},
): Promise<PairResult> {
  const api = options.api ?? chrome;
  const normalised = normaliseBaseUrl(baseUrl);
  if (normalised === null) {
    return { ok: false, message: 'That is not an http or https address.' };
  }
  const pairingCode = normalisePairingCode(code);
  if (pairingCode === '') return { ok: false, message: 'Paste the pairing code.' };

  let exchanged;
  try {
    exchanged = await exchangePairingCode(
      { baseUrl: normalised, fetch: options.fetch },
      {
        pairing_code: pairingCode,
        device_public_id: options.publicId ?? `job-getter-extension/${crypto.randomUUID()}`,
      },
    );
  } catch (error) {
    if (error instanceof FillSessionApiError) return { ok: false, message: error.message };
    return { ok: false, message: `Could not reach ${normalised}. Is it running?` };
  }

  await api.storage.local.set({
    baseUrl: normalised,
    token: exchanged.token,
    deviceId: exchanged.device_id,
    expiresAt: exchanged.expires_at,
  });
  return { ok: true };
}

export type TargetsResult =
  | { readonly kind: 'unpaired'; readonly message: string | null }
  | {
      readonly kind: 'ok';
      readonly baseUrl: string;
      readonly items: readonly FillTarget[];
      /** Fills this browser reported that are waiting for the person to submit. */
      readonly awaiting: readonly AwaitingSubmission[];
    }
  | { readonly kind: 'error'; readonly baseUrl: string; readonly message: string };

/**
 * What the popup can offer: the approved applications, or why there are none.
 *
 * A 401 means the token is dead — revoked in the web app, or thirty days
 * old. Keeping it would leave the popup offering fills that can only fail, so
 * it is forgotten and the person is asked to pair again.
 */
export async function loadTargets(
  options: { api?: ChromeApi; fetch?: typeof globalThis.fetch } = {},
): Promise<TargetsResult> {
  const api = options.api ?? chrome;
  const pairing = await readPairing(api);
  if (pairing === null) return { kind: 'unpaired', message: null };

  try {
    const list = await listFillTargets({ ...pairing, fetch: options.fetch });
    return {
      kind: 'ok',
      baseUrl: pairing.baseUrl,
      items: list.items,
      // An installation older than this extension does not send it.
      awaiting: list.awaiting_submission ?? [],
    };
  } catch (error) {
    if (error instanceof FillSessionApiError && error.status === 401) {
      await forgetPairing(api);
      return {
        kind: 'unpaired',
        message: 'This browser’s pairing was revoked or has expired. Pair it again.',
      };
    }
    const message =
      error instanceof FillSessionApiError
        ? error.message
        : `Could not reach ${pairing.baseUrl}. Is it running?`;
    return { kind: 'error', baseUrl: pairing.baseUrl, message };
  }
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
        // No adapter read it, so none is named.
        adapter: null,
        adapter_version: null,
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
      ...knownAdapter(inspected.adapter),
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

export interface CheckOptions {
  /** The tab the popup was opened over; see `FillOptions.tabId`. */
  readonly tabId?: number;
  readonly api?: ChromeApi;
  /** How many times to read the page while it settles, one second apart. */
  readonly attempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * After the person submitted: read the page in front of them for a
 * confirmation, and tell the API what it said.
 *
 * One look, on their click. The runner can watch a page for ninety seconds
 * because it opened that page itself; the extension may read an employer's
 * page only while the person invokes it there, and submitting usually
 * navigates, which ends that access. So the person opens the popup on the
 * page the employer showed after submit, and presses the button.
 *
 * The page gets a few seconds to finish rendering, because a confirmation is
 * often drawn a moment after the navigation. What happens next is the API's
 * decision, through the same rules the runner's observation follows: a
 * confirmation is recorded as submitted with the page's words as evidence,
 * and anything less as "could not tell", which asks the person. Nothing here
 * can record "not submitted".
 */
export async function checkConfirmation(
  item: AwaitingSubmission,
  options_: CheckOptions = {},
): Promise<FillReport> {
  const api = options_.api ?? chrome;
  const attempts = options_.attempts ?? 5;
  const sleep = options_.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));

  const pairing = await readPairing(api);
  if (pairing === null) {
    return { ok: false, message: 'Pair this browser with your installation first.' };
  }
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const tab =
    options_.tabId === undefined ? tabs[0] : ((await api.tabs.get(options_.tabId)) ?? undefined);
  if (tab?.id === undefined || tab.url === undefined) {
    return { ok: false, message: 'No tab to check.' };
  }
  // Before anything is read: a page on another origin is not this
  // application's confirmation, and nothing is recorded about it.
  if (originOf(tab.url) !== item.destination.origin) {
    return {
      ok: false,
      message: `Open the page ${item.destination.origin} showed after you submitted, then check again.`,
    };
  }
  const tabId = tab.id;

  let answer: ContentMessage | null = null;
  try {
    await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      answer = await api.tabs.sendMessage(tabId, { type: 'page/read-confirmation' });
      if (answer.type !== 'page/confirmation' || answer.confirmation !== null) break;
      if (attempt < attempts - 1) await sleep(1000);
    }
  } catch {
    return { ok: false, message: 'The page could not be read. Nothing was recorded.' };
  }
  if (
    answer === null ||
    (answer.type !== 'page/confirmation' && answer.type !== 'page/unsupported')
  ) {
    return { ok: false, message: 'The page did not answer. Nothing was recorded.' };
  }
  // The page may have navigated while it was being read.
  if (originOf(answer.url) !== item.destination.origin) {
    return { ok: false, message: 'The page moved to another site. Nothing was recorded.' };
  }

  const found = answer.type === 'page/confirmation' ? answer.confirmation : null;
  // An unsupported page was read by no adapter, so none is named.
  const reader =
    answer.type === 'page/confirmation'
      ? knownAdapter(answer.adapter)
      : { adapter: null, adapterVersion: null };
  try {
    const recorded = await reportObservation(
      { baseUrl: pairing.baseUrl, token: pairing.token, fetch: options_.fetch },
      item.fill_session_id,
      {
        outcome: found === null ? 'unknown' : 'observed',
        confirmation:
          found === null
            ? null
            : {
                confirmation_text: found.confirmation_text,
                reference: found.reference,
                url: answer.url,
              },
        unknown_reason:
          found !== null
            ? null
            : answer.type === 'page/unsupported'
              ? 'unsupported'
              : 'no_confirmation_found',
        page_url: answer.url,
        adapter: reader.adapter,
        adapter_version: reader.adapterVersion,
      },
    );
    return recorded.status === 'submitted'
      ? {
          ok: true,
          message:
            found?.reference == null
              ? 'The page confirms it. Recorded as submitted.'
              : `The page confirms it (reference ${found.reference}). Recorded as submitted.`,
        }
      : {
          ok: true,
          message:
            'No confirmation this extension recognises is on this page. ' +
            'Job Getter will ask you what happened.',
        };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The API refused.' };
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
