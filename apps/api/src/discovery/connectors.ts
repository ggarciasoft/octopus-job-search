/**
 * Connector policy on the API side.
 *
 * The Python worker owns *fetching* (05_DISCOVERY_CONNECTORS.md); the API owns
 * what a user may register and how a posting's identity is written down. Two
 * things live here:
 *
 *  * the hosts a source's `base_url` may point at — "Each connector declares
 *    id, version, allowed_hosts" — so a source cannot be configured to send
 *    the worker to an arbitrary destination; and
 *  * the canonical-key rule from 03_DATA_MODEL.md: "connector + board +
 *    external job ID when available; otherwise normalized employer job URL".
 *
 * Nothing enumerated here duplicates a contract enum: connector ids, versions
 * and limits are imported from @job-getter/contracts.
 */
import {
  BOARD_CONNECTOR_IDS,
  CONNECTOR_VERSIONS,
  type ConnectorId,
  type NormalizedJob,
} from '@job-getter/contracts';
import { unprocessable } from '../errors.js';

export type BoardConnectorId = (typeof BOARD_CONNECTOR_IDS)[number];

export function isBoardConnector(connector: string): connector is BoardConnectorId {
  return (BOARD_CONNECTOR_IDS as readonly string[]).includes(connector);
}

/**
 * Documented public endpoints only. A `base_url` exists for connectors with a
 * regional endpoint (Lever EU); Greenhouse has exactly one public boards API,
 * so it accepts none.
 */
const ALLOWED_BASE_HOSTS: Readonly<Record<BoardConnectorId, readonly string[]>> = {
  greenhouse: [],
  lever: ['api.lever.co', 'api.eu.lever.co'],
};

/**
 * Validates and normalises a user-supplied `base_url` for a board connector.
 * Returns null when the connector uses its default endpoint.
 */
export function validateBaseUrl(
  connector: BoardConnectorId,
  baseUrl: string | null | undefined,
): string | null {
  if (baseUrl === undefined || baseUrl === null || baseUrl.trim() === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw unprocessable('base_url is not a valid URL.', { base_url: 'Not a URL.' });
  }
  if (parsed.protocol !== 'https:') {
    throw unprocessable('base_url must use https.', { base_url: 'Only https is allowed.' });
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw unprocessable('base_url may not carry credentials.', {
      base_url: 'Credentials are not allowed.',
    });
  }
  const allowed = ALLOWED_BASE_HOSTS[connector];
  if (!allowed.includes(parsed.hostname.toLowerCase())) {
    throw unprocessable(
      allowed.length === 0
        ? `The ${connector} connector has no configurable endpoint; omit base_url.`
        : `base_url for ${connector} must be one of: ${allowed.join(', ')}.`,
      { base_url: 'Host is not a documented endpoint for this connector.' },
    );
  }
  // Origin only: the connector appends its own documented paths.
  return `${parsed.protocol}//${parsed.host}`;
}

export function connectorVersion(connector: BoardConnectorId): string {
  return CONNECTOR_VERSIONS[connector];
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Query parameters that identify a click, not a posting. */
const TRACKING_PARAM_PATTERN = /^(utm_|fbclid$|gclid$|msclkid$|mc_cid$|mc_eid$|ref$|source$)/i;

/**
 * Normalises an employer job URL so that two links to the same posting
 * produce the same key: lower-case scheme and host, default port dropped,
 * fragment dropped, tracking parameters removed, remaining parameters sorted,
 * trailing slash trimmed. A string that is not a URL is returned trimmed, so
 * a malformed value still gets a stable — if unhelpful — key.
 */
export function normalizeJobUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return trimmed;

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM_PATTERN.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([key, entry]) => `${key}=${entry}`).join('&');

  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  return `${url.protocol}//${url.host.toLowerCase()}${pathname}${query ? `?${query}` : ''}`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Where a normalised job came from, as far as identity is concerned. */
export interface JobOrigin {
  readonly connector: ConnectorId;
  /** The registered source, or null for a manual/URL import. */
  readonly sourceId: string | null;
  /** Board token or site slug; null for non-board connectors. */
  readonly boardKey: string | null;
}

/**
 * 03_DATA_MODEL.md: "Canonical key is connector + board + external job ID when
 * available; otherwise normalized employer job URL."
 *
 * A pasted description with no usable URL gets a key derived from its content
 * hash, so two pastes of the same text collapse and two different texts do
 * not.
 */
export function canonicalKeyFor(job: NormalizedJob, origin: JobOrigin): string {
  if (origin.boardKey !== null && isBoardConnector(origin.connector)) {
    return `${origin.connector}:${origin.boardKey}:${job.external_id}`;
  }
  const url = isHttpUrl(job.canonical_url)
    ? job.canonical_url
    : job.apply_url !== null && isHttpUrl(job.apply_url)
      ? job.apply_url
      : null;
  if (url !== null) return `url:${normalizeJobUrl(url)}`;
  return `manual:${job.content_hash}`;
}
