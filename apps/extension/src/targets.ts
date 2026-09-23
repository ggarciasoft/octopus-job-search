/**
 * The popup's judgement, as pure functions: what address was typed, what code
 * was pasted, and which approved applications belong to the tab in front of
 * the person.
 *
 * Kept apart from `popup.ts` so each rule is asserted without a DOM or a
 * browser, the same way `session.ts` holds the fill's judgement.
 */
import type { AwaitingSubmission, FillTarget } from '@job-getter/contracts';

/**
 * The installation's address, or `null` if it cannot be one.
 *
 * Only http and https, and never with credentials in it: a
 * `https://user:pass@host` typed here would otherwise be stored beside the
 * token. A trailing slash is dropped because every path is appended to it.
 */
export function normaliseBaseUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (parsed.search !== '' || parsed.hash !== '') return null;
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

/**
 * A pasted pairing code, without the whitespace a copy from the web app tends
 * to bring along. Nothing else is altered: the code is compared as a digest,
 * so "fixing" it here could only turn a right code into a wrong one.
 */
export function normalisePairingCode(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export interface ArrangedTargets {
  /** Approved for the page in front of the person: these can be filled now. */
  readonly here: readonly FillTarget[];
  /** Approved for somewhere else: offered as "open the page", never as "fill". */
  readonly elsewhere: readonly FillTarget[];
}

/**
 * Splits the list by the tab's origin.
 *
 * The API would refuse a session for a tab on another origin anyway; this
 * only keeps the popup from offering a button that is certain to fail. It is
 * a convenience, not the check.
 */
export function arrangeTargets(
  targets: readonly FillTarget[],
  tabOrigin: string | null,
): ArrangedTargets {
  const here: FillTarget[] = [];
  const elsewhere: FillTarget[] = [];
  for (const target of targets) {
    (tabOrigin !== null && target.destination.origin === tabOrigin ? here : elsewhere).push(target);
  }
  return { here, elsewhere };
}

/**
 * Whether a waiting application can be checked from the tab in front of the
 * person: only on its own origin, where its confirmation page would be.
 * Like `arrangeTargets`, a convenience; the service worker and the API both
 * refuse another origin regardless.
 */
export function checkableHere(item: AwaitingSubmission, tabOrigin: string | null): boolean {
  return tabOrigin !== null && item.destination.origin === tabOrigin;
}

/**
 * The destination URL, if it is safe to open in a new tab.
 *
 * It came from the API, which took it from the job's own provenance, but it
 * is still text that reached this product from an employer's page. Opening a
 * `javascript:` or `data:` URL from an extension page is not something to
 * leave to that page's honesty.
 */
export function openableUrl(target: FillTarget): string | null {
  let parsed: URL;
  try {
    parsed = new URL(target.destination.url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.origin !== target.destination.origin) return null;
  return parsed.href;
}
