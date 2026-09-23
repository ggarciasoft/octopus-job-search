/**
 * Every page reader this extension has, and the rule for picking one.
 *
 * The same registry as `ADAPTERS` in the runner's `adapters/__init__.py`, and
 * the same rule: only tested adapters exist, a page no adapter claims is
 * `unsupported`, and no page may be claimed by two. Lever's form shares
 * Greenhouse's `#application-form` id, which is why Greenhouse's marker
 * refuses a Lever-shaped form, and `tests/adapters.test.ts` asserts every
 * fixture is claimed by exactly one adapter.
 *
 * Imported only by the content script. The service worker learns which
 * adapter read a page from the content script's report, and checks the name
 * against `KNOWN_ADAPTERS` in `known.ts`, so none of this DOM code is bundled
 * into it.
 */
import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import type { RawConfirmation } from './confirmation.js';
import type { RawFieldRow } from './greenhouse.js';

export interface PageAdapter {
  readonly name: string;
  readonly version: string;
  marker(root: Document): boolean;
  handles(url: string, markerFound: boolean): boolean;
  readIdentity(root: Document): { company: string; title: string };
  readFields(root: Document): RawFieldRow[];
  readConfirmation(root: Document, url: string): RawConfirmation | null;
}

function adapter(module: typeof greenhouse | typeof lever): PageAdapter {
  return {
    name: module.ADAPTER_NAME,
    version: module.ADAPTER_VERSION,
    marker: module.marker,
    handles: module.handles,
    readIdentity: module.readIdentity,
    readFields: module.readFields,
    readConfirmation: module.readConfirmation,
  };
}

/** Every adapter this build actually has. Order is preference order. */
export const ADAPTERS: readonly PageAdapter[] = [adapter(greenhouse), adapter(lever)];

/** The adapter that claims this page, or null for a page none has been tested on. */
export function pick(url: string, root: Document): PageAdapter | null {
  return ADAPTERS.find((candidate) => candidate.handles(url, candidate.marker(root))) ?? null;
}
