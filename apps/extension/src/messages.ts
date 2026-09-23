/**
 * The message protocol between the service worker and the content script, and
 * the rule that decides which messages are privileged.
 *
 * docs/spec/07_APPLICATION_AUTOMATION.md: "Service worker verifies message
 * sender/tab/origin; do not trust page-origin window messages as privileged
 * commands." That sentence is AT24's other half, and it is this file.
 *
 * The shape of the trust here is worth stating plainly, because it is the
 * whole security argument for putting filling in an extension at all:
 *
 *  * **The content script is not trusted.** It shares a DOM with the
 *    employer's page and with anything that page loaded. What it sends is
 *    *evidence about a page*, never an instruction. There is no message in
 *    this union that names a destination, an application, a file or a
 *    credential — the service worker already knows all four from the fill
 *    session, and it would refuse to learn them from a tab.
 *  * **The service worker holds the credentials.** The device token and the
 *    session nonce never cross this boundary. A content script cannot read
 *    them, so a page that fully compromises the content script still cannot
 *    read them.
 *  * **A message with no tab is not from a content script.** Anything can call
 *    `chrome.runtime.sendMessage` if it learns the extension id — another
 *    extension, or a page on a site the user visits. `verifySender` refuses
 *    every such caller, and refuses a content script in a frame or on an
 *    origin this session was not opened for.
 */

/** What the content script may tell the service worker. Evidence, not orders. */
export type ContentMessage =
  | {
      /** "Here is what this page looks like." */
      readonly type: 'page/inspected';
      readonly url: string;
      /** Which reader read it. Checked against `KNOWN_ADAPTERS`, never trusted. */
      readonly adapter: unknown;
      readonly identity: unknown;
      readonly fields: unknown;
    }
  | {
      /** "Here is what I typed, and what I could not." */
      readonly type: 'page/filled';
      readonly url: string;
      readonly filled: readonly { key: string; outcome: string; label: string | null }[];
      readonly failed: readonly string[];
    }
  | {
      /** "This page is not one I can read." */
      readonly type: 'page/unsupported';
      readonly url: string;
      readonly reason: string;
    }
  | {
      /**
       * "Here is what this page says about a submission", or null for
       * nothing recognisable. Evidence like the rest: the service worker and
       * then the API decide what it means.
       */
      readonly type: 'page/confirmation';
      readonly url: string;
      readonly adapter: unknown;
      readonly confirmation: {
        readonly confirmation_text: string;
        readonly reference: string | null;
      } | null;
    };

/** What the service worker may ask of the content script. */
export type WorkerMessage =
  | { readonly type: 'page/inspect' }
  /** After the person submitted: read the page for a confirmation, change nothing. */
  | { readonly type: 'page/read-confirmation' }
  | {
      readonly type: 'page/fill';
      /**
       * Exactly the values to type, already decided by the shared planner in
       * the service worker. The content script does no matching of its own:
       * given a plan it types it, and given nothing it types nothing.
       */
      readonly values: readonly { selector: string; kind: string; values: readonly string[] }[];
      /**
       * The CV to attach, as bytes the service worker fetched through the
       * session. The content script never learns where it came from.
       */
      readonly attachment: { readonly name: string; readonly bytes: number[] } | null;
      readonly attachmentSelector: string | null;
    };

export interface SenderFacts {
  /** `chrome.runtime.MessageSender.tab.id`, absent for a non-tab caller. */
  readonly tabId: number | undefined;
  /** `0` is the top frame. A subframe is refused. */
  readonly frameId: number | undefined;
  /** The sender's own URL, as the browser reports it — not as it claims. */
  readonly url: string | undefined;
}

export interface SessionBinding {
  readonly tabId: number;
  readonly origin: string;
}

export type SenderVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Whether a message may be treated as coming from our content script, in the
 * tab this fill session was opened for.
 *
 * Every refusal here is a real attack, not a hypothetical:
 *
 *  * **No tab.** Another extension, or a page calling `sendMessage` with the
 *    extension id, which is not a secret.
 *  * **Wrong tab.** A second tab the user has open — possibly the attacker's —
 *    answering for the one being filled.
 *  * **A subframe.** An advertisement or an embedded widget inside the
 *    employer's page, which is exactly where hostile content lives.
 *  * **Wrong origin.** A navigation that happened after the session was
 *    granted. The origin is re-derived from the browser's own view of the
 *    sender, never from anything inside the message.
 */
export function verifySender(sender: SenderFacts, session: SessionBinding): SenderVerdict {
  if (sender.tabId === undefined) {
    return { ok: false, reason: 'the message did not come from a tab' };
  }
  if (sender.tabId !== session.tabId) {
    return { ok: false, reason: 'the message came from a different tab' };
  }
  if (sender.frameId !== 0) {
    return { ok: false, reason: 'the message came from a subframe' };
  }
  if (sender.url === undefined) {
    return { ok: false, reason: 'the sender has no URL' };
  }
  let origin: string;
  try {
    origin = new URL(sender.url).origin;
  } catch {
    return { ok: false, reason: 'the sender URL is not a URL' };
  }
  if (origin !== session.origin) {
    return { ok: false, reason: `the tab is on ${origin}, not ${session.origin}` };
  }
  return { ok: true };
}
