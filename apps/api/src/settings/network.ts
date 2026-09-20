/**
 * Destination policy for every outbound request this service makes.
 *
 * 05_DISCOVERY_CONNECTORS.md: "HTTPS only, public IP validation before connect
 * and after each redirect, max 3 redirects... Block private, loopback,
 * link-local and cloud metadata destinations including IPv6 and DNS
 * rebinding. Local model URLs have a separate operator-controlled policy and
 * must not weaken the job fetcher."
 *
 * That last sentence is why this module takes an explicit `FetchPolicy` rather
 * than having one global rule. A locally installed Ollama genuinely lives on
 * `127.0.0.1`, so the *operator* may allow specific local hosts through
 * `LOCAL_MODEL_BASE_URL` / `ALLOWED_FETCH_HOSTS`. A hosted user cannot grant
 * themselves that: the allowlist is configuration, not request input, so a
 * tenant who stores `base_url = http://10.0.0.5:11434` is refused.
 *
 * Two things are refused unconditionally, allowlist or not:
 *
 *  * cloud instance-metadata addresses (`169.254.169.254`, `169.254.170.2`,
 *    `fd00:ec2::254`, `metadata.google.internal`). No model endpoint lives
 *    there; anything pointing at them is trying to read instance credentials.
 *  * non-http(s) schemes, credentials in the URL, and hosts that resolve to
 *    nothing.
 *
 * ## DNS rebinding
 *
 * Every address the name resolves to is checked, not just the first — a name
 * with one public and one private A record is refused. A resolve-then-connect
 * sequence still has a TOCTOU window: the kernel re-resolves at connect time
 * and could get a different answer. Closing it completely requires pinning the
 * connection to the validated address, which needs a custom dispatcher
 * (`undici` is a devDependency here, not a runtime one). The residual risk is
 * bounded by the fact that the only destinations this build ever fetches are
 * the operator-allowlisted local model endpoint and an https provider
 * endpoint, and the response body is never echoed to the caller — only a
 * boolean reachability and a model name list are reported.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class FetchNotAllowedError extends Error {
  /** Safe to show the user: it names the policy, never internal topology. */
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'FetchNotAllowedError';
    this.reason = reason;
  }
}

export interface FetchPolicy {
  /** Job-board style destinations are https-only; a local model may be http. */
  readonly requireHttps: boolean;
  /**
   * Hostnames (or `host:port`) the operator has explicitly permitted even when
   * they resolve to a private address. Empty means "public internet only".
   */
  readonly allowedHosts: readonly string[];
  /** Injectable for tests; defaults to the system resolver. */
  readonly resolve?: (hostname: string) => Promise<string[]>;
  /**
   * `required` — a name that cannot be resolved is refused. Use this before
   * actually connecting.
   *
   * `best_effort` — a name that cannot be resolved right now is *not* refused,
   * but any address it does return is still checked. Use this when validating
   * a URL the operator is *storing*: a provider endpoint that is briefly
   * unresolvable (offline laptop, DNS blip, an internal CI network) must not
   * make the settings page unsaveable, and nothing is connected to at save
   * time. The connection path always uses `required`.
   */
  readonly dns?: 'required' | 'best_effort';
}

export const MAX_REDIRECTS = 3;

/** Names that must never be fetched, whatever they resolve to. */
const FORBIDDEN_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** Literal metadata addresses, refused even when a host is allowlisted. */
const METADATA_ADDRESSES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200', // Alibaba Cloud
  'fd00:ec2::254',
]);

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number.parseInt(part, 10);
    if (byte > 255) return null;
    bytes.push(byte);
  }
  return bytes;
}

/** Expands an IPv6 literal (including `::` and a trailing IPv4) to 16 bytes. */
function parseIpv6(value: string): number[] | null {
  let text = value;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  // A zone index (fe80::1%eth0) is not part of the address.
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  // A trailing dotted-quad (::ffff:127.0.0.1) is rewritten into the two hex
  // groups it stands for, so the rest of the parser only sees hex groups and
  // the `::` fill lands in the right place.
  const lastColon = text.lastIndexOf(':');
  const trailing = lastColon === -1 ? '' : text.slice(lastColon + 1);
  if (trailing.includes('.')) {
    const v4 = parseIpv4(trailing);
    if (v4 === null) return null;
    const high = (((v4[0] as number) << 8) | (v4[1] as number)).toString(16);
    const low = (((v4[2] as number) << 8) | (v4[3] as number)).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[][] | null => {
    if (part === '') return [];
    const groups: number[][] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const word = Number.parseInt(group, 16);
      groups.push([(word >> 8) & 0xff, word & 0xff]);
    }
    return groups;
  };

  const head = toGroups(halves[0] ?? '');
  if (head === null) return null;
  const rest = halves.length === 2 ? toGroups(halves[1] ?? '') : null;
  if (halves.length === 2 && rest === null) return null;

  const headBytes = head.flat();
  const restBytes = (rest ?? []).flat();
  if (halves.length === 1) {
    return headBytes.length === 16 ? headBytes : null;
  }
  const fill = 16 - headBytes.length - restBytes.length;
  if (fill < 0) return null;
  return headBytes.concat(new Array<number>(fill).fill(0), restBytes);
}

function isPrivateIpv4(bytes: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = bytes;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIpv6(bytes: readonly number[]): boolean {
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes;

  // ::, ::1 and any other address inside ::/64 that is not v4-mapped.
  const leadingZero = bytes.slice(0, 10).every((byte) => byte === 0);
  if (leadingZero && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4(bytes.slice(12));
  }
  if (leadingZero && bytes[10] === 0 && bytes[11] === 0) {
    // ::, ::1 and the deprecated ::a.b.c.d compatible form.
    const v4 = bytes.slice(12);
    if (v4.every((byte) => byte === 0)) return true;
    if (v4[0] === 0 && v4[1] === 0 && v4[2] === 0 && v4[3] === 1) return true;
    return isPrivateIpv4(v4);
  }
  if ((b0 & 0xfe) === 0xfc) return true; // fc00::/7 unique local (incl. fd00:ec2::254)
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true; // fe80::/10 link local
  if (b0 === 0xff) return true; // ff00::/8 multicast
  if (b0 === 0x20 && b1 === 0x01 && b2 === 0x0d && b3 === 0xb8) return true; // 2001:db8::/32
  if (b0 === 0x01 && b1 === 0x00 && b2 === 0x00 && b3 === 0x00) return true; // 100::/64 discard
  return false;
}

/**
 * True for anything that is not a globally routable unicast address.
 *
 * Unparseable input returns `true`: an address this code does not understand
 * is not an address it is willing to connect to.
 */
export function isPrivateAddress(address: string): boolean {
  const normalised = address.trim().toLowerCase();
  if (normalised === '') return true;
  const version = isIP(normalised);
  if (version === 4) {
    const bytes = parseIpv4(normalised);
    return bytes === null ? true : isPrivateIpv4(bytes);
  }
  if (version === 6) {
    const bytes = parseIpv6(normalised);
    return bytes === null ? true : isPrivateIpv6(bytes);
  }
  // Also accept the bracket/zone forms `isIP` rejects.
  const bytes = parseIpv6(normalised);
  if (bytes !== null) return isPrivateIpv6(bytes);
  const v4 = parseIpv4(normalised);
  if (v4 !== null) return isPrivateIpv4(v4);
  return true;
}

/** Strips brackets from an IPv6 URL host so it can be compared and resolved. */
function bareHostname(url: URL): string {
  const host = url.hostname.toLowerCase();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Whether the operator has explicitly permitted this destination.
 *
 * Entries are compared as `host` or `host:port`, lower-cased. This is
 * configuration, never request input, which is the whole reason a hosted user
 * cannot use it to reach an internal service.
 */
export function isAllowlisted(url: URL, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.length === 0) return false;
  const host = bareHostname(url);
  const hostPort = url.port === '' ? host : `${host}:${url.port}`;
  return allowedHosts.some((entry) => {
    const candidate = entry.trim().toLowerCase();
    return candidate === host || candidate === hostPort;
  });
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * Validates one URL against the policy. Throws `FetchNotAllowedError`.
 *
 * Call it for the initial URL *and* for every redirect `Location`.
 */
export async function assertUrlAllowed(url: URL, policy: FetchPolicy): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchNotAllowedError(`Only http and https URLs are allowed; got "${url.protocol}".`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new FetchNotAllowedError('A URL must not carry embedded credentials.');
  }

  const host = bareHostname(url);
  if (host === '') throw new FetchNotAllowedError('The URL has no host.');
  if (FORBIDDEN_HOSTNAMES.has(host)) {
    throw new FetchNotAllowedError(`"${host}" is an instance-metadata endpoint and is refused.`);
  }

  const allowlisted = isAllowlisted(url, policy.allowedHosts);

  // Unconditional: the allowlist can permit a *private address*, never a
  // downgrade to cleartext on a destination that is supposed to be https.
  if (policy.requireHttps && url.protocol !== 'https:') {
    throw new FetchNotAllowedError('Only https URLs are allowed for this provider.');
  }

  const literal = isIP(host) !== 0 || parseIpv6(host) !== null || parseIpv4(host) !== null;
  const addresses = literal ? [host] : await resolveOrRefuse(host, policy);

  for (const address of addresses) {
    if (METADATA_ADDRESSES.has(address.toLowerCase())) {
      throw new FetchNotAllowedError(
        'The destination is a cloud instance-metadata address and is refused.',
      );
    }
    if (isPrivateAddress(address) && !allowlisted) {
      throw new FetchNotAllowedError(
        `"${host}" resolves to a private, loopback or link-local address, which is not allowed. ` +
          'A local model endpoint must be listed in ALLOWED_FETCH_HOSTS or LOCAL_MODEL_BASE_URL.',
      );
    }
  }
}

async function resolveOrRefuse(hostname: string, policy: FetchPolicy): Promise<string[]> {
  const lenient = policy.dns === 'best_effort';
  let addresses: string[];
  try {
    addresses = await (policy.resolve ?? defaultResolve)(hostname);
  } catch {
    if (lenient) return [];
    throw new FetchNotAllowedError(`"${hostname}" could not be resolved.`);
  }
  if (addresses.length === 0 && !lenient) {
    throw new FetchNotAllowedError(`"${hostname}" could not be resolved.`);
  }
  return addresses;
}
