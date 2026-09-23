/**
 * The adapters this build has, by name and version only.
 *
 * The service worker reports which adapter read a page, and it learns that
 * from the content script — which shares a DOM with the employer's page and is
 * not trusted. So the name is checked against this list rather than passed
 * through: a report never names an adapter this extension does not have.
 * Kept free of DOM code so the service worker stays small.
 */
export const KNOWN_ADAPTERS: readonly { readonly name: string; readonly version: string }[] = [
  { name: 'greenhouse', version: 'v1' },
  { name: 'lever', version: 'v1' },
];

/** The adapter as reported, or nulls if it is not one this build has. */
export function knownAdapter(claimed: unknown): {
  readonly adapter: string | null;
  readonly adapterVersion: string | null;
} {
  const value = (typeof claimed === 'object' && claimed !== null ? claimed : {}) as {
    name?: unknown;
    version?: unknown;
  };
  const found = KNOWN_ADAPTERS.find(
    (entry) => entry.name === value.name && entry.version === value.version,
  );
  return found === undefined
    ? { adapter: null, adapterVersion: null }
    : { adapter: found.name, adapterVersion: found.version };
}
