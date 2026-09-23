/**
 * The content script: the only code that touches the employer's page.
 *
 * It is injected on a user gesture through `activeTab` and `scripting`, never
 * declared for a list of hosts, so it does not exist on any page the person
 * did not ask it to be on.
 *
 * Three rules hold here, and they are all about what this file is *not*
 * allowed to be:
 *
 *  * **It holds no credential.** The device token and the session nonce live
 *    in the service worker. This script shares a DOM with the page and with
 *    everything the page loaded, so anything it held, the page could
 *    eventually reach.
 *  * **It decides nothing.** It reports what it saw and types what it was
 *    given. Matching an answer to a control happens in the service worker,
 *    through the shared planner, so there is no second implementation of the
 *    exact-match rule that a page could confuse.
 *  * **It never listens to the page.** There is deliberately no
 *    `window.addEventListener('message', …)` in this file. "Do not trust
 *    page-origin window messages as privileged commands" is satisfied here by
 *    having nothing for such a message to arrive at.
 *
 * And the thing it cannot do at all: there is no code path that submits. No
 * `form.submit()`, no click on a submit control, nothing that dispatches one.
 * The person presses the button.
 */
import {
  ADAPTER_VERSION,
  handles,
  findForm,
  readConfirmation,
  readFields,
  readIdentity,
} from './adapters/greenhouse.js';
import type { ContentMessage, WorkerMessage } from './messages.js';

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        listener: (
          message: WorkerMessage,
          sender: unknown,
          respond: (response: ContentMessage) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
};

function inspect(): ContentMessage {
  const url = globalThis.location.href;
  if (!handles(url, findForm(globalThis.document) !== null)) {
    return { type: 'page/unsupported', url, reason: 'no tested adapter matches this page' };
  }
  return {
    type: 'page/inspected',
    url,
    identity: readIdentity(globalThis.document),
    fields: readFields(globalThis.document),
  };
}

/**
 * Read the page for a confirmation. Reads only: the person has already
 * submitted, and there is nothing left on this page for the extension to do.
 */
function confirmation(): ContentMessage {
  const url = globalThis.location.href;
  if (!handles(url, findForm(globalThis.document) !== null)) {
    return { type: 'page/unsupported', url, reason: 'no tested adapter matches this page' };
  }
  const found = readConfirmation(globalThis.document, url);
  return {
    type: 'page/confirmation',
    url,
    confirmation:
      found === null
        ? null
        : { confirmation_text: found.confirmation_text, reference: found.reference },
  };
}

/**
 * Type one planned value into one control.
 *
 * Each branch dispatches the events a framework-backed form listens for, which
 * is why a plain value assignment is never enough: React and its relatives
 * track their own state and would discard a value nobody told them about.
 */
function apply(instruction: WorkerMessage & { type: 'page/fill' }, index: number): string {
  const { selector, kind, values } = instruction.values[index]!;
  const first = values[0] ?? '';

  if (kind === 'radio' || kind === 'checkbox') {
    const members = Array.from(globalThis.document.querySelectorAll<HTMLInputElement>(selector));
    if (members.length === 0) return 'skipped';
    let matched = 0;
    for (const member of members) {
      const label = (member.labels?.[0]?.textContent ?? member.value).replace(/\s+/g, ' ').trim();
      const wanted = values.some(
        (value) => value.trim().toLowerCase() === label.toLowerCase() || value === member.value,
      );
      if (wanted) {
        member.checked = true;
        member.dispatchEvent(new Event('change', { bubbles: true }));
        matched += 1;
      }
    }
    return matched === values.length ? 'filled' : 'failed';
  }

  const element = globalThis.document.querySelector<HTMLElement>(selector);
  if (element === null) return 'skipped';

  if (kind === 'select') {
    const select = element as HTMLSelectElement;
    const option = Array.from(select.options).find(
      (candidate) =>
        (candidate.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() ===
        first.trim().toLowerCase(),
    );
    if (option === undefined) return 'failed';
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'filled';
  }

  const input = element as HTMLInputElement | HTMLTextAreaElement;
  input.focus();
  input.value = first;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.value === first ? 'filled' : 'failed';
}

/**
 * Attach the CV the session authorised.
 *
 * "For file upload, obtain only the authorized CV bytes and attempt supported
 * browser file input handling. Where browser/site restrictions prevent it,
 * show a download-and-attach step." A `DataTransfer` assignment is the
 * supported path and it fails on some sites; the failure is reported as such
 * rather than swallowed, so the person is told to attach it themselves.
 */
function attach(selector: string, file: { name: string; bytes: number[] }): string {
  const input = globalThis.document.querySelector<HTMLInputElement>(selector);
  if (input === null) return 'skipped';
  try {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(file.bytes)], file.name));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.files.length === 1 ? 'filled' : 'failed';
  } catch {
    return 'failed';
  }
}

function fill(message: WorkerMessage & { type: 'page/fill' }): ContentMessage {
  const filled: { key: string; outcome: string; label: string | null }[] = [];
  const failed: string[] = [];

  message.values.forEach((instruction, index) => {
    const outcome = apply(message, index);
    filled.push({ key: instruction.selector, outcome, label: null });
    if (outcome !== 'filled') failed.push(instruction.selector);
  });

  if (message.attachment !== null && message.attachmentSelector !== null) {
    const outcome = attach(message.attachmentSelector, message.attachment);
    filled.push({ key: message.attachmentSelector, outcome, label: null });
    if (outcome !== 'filled') failed.push(message.attachmentSelector);
  }

  return { type: 'page/filled', url: globalThis.location.href, filled, failed };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'page/inspect') {
      respond(inspect());
      return true;
    }
    if (message.type === 'page/fill') {
      respond(fill(message));
      return true;
    }
    if (message.type === 'page/read-confirmation') {
      respond(confirmation());
      return true;
    }
    return undefined;
  });
}

export { inspect, fill, confirmation, ADAPTER_VERSION };
