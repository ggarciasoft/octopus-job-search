/**
 * `POST /settings/providers/test` — probe the configured provider.
 *
 * 04_API_CONTRACTS.md describes this route as "provider_id → connectivity /
 * schema capability, **never arbitrary URL fetch**". The request body is
 * empty: the destination comes from the stored `provider_settings` row and
 * from nowhere else, so there is no parameter a caller could point at an
 * internal service. The stored URL is then validated against the destination
 * policy again — before the connection and after every redirect — because a
 * row could have been written before a policy change, or by a future code
 * path that forgot.
 *
 * What is reported is only what was actually observed:
 *
 *  * `reachable` — a response was received.
 *  * `model_available` — the configured model appeared in the endpoint's own
 *    model list; `null` when the endpoint does not publish one.
 *  * `structured_output_supported` — `null` for a real endpoint. Deciding it
 *    truthfully means issuing a structured generation and inspecting the
 *    result (06_AI_PROFILE_AND_CV.md: "Compatibility is tested, not assumed"),
 *    which spends the user's tokens and budget; that detection belongs to the
 *    worker's first real request, not to a connectivity check. Reporting
 *    `true` here would be a guess presented as a fact.
 *
 * There is no fallback: if the configured provider is unreachable, that is the
 * answer (ADR07).
 */
import { type ProviderId, type ProviderTestResult } from '@job-getter/contracts';
import type { Config } from '../config.js';
import { unprocessable } from '../errors.js';
import {
  FetchNotAllowedError,
  MAX_REDIRECTS,
  assertUrlAllowed,
  type FetchPolicy,
} from './network.js';
import { fetchPolicyFor, parseBaseUrl, type ProviderSettingsRow } from './providers.js';
import { readValidatedConfig } from './providers.js';

/** Bounded by 05_DISCOVERY_CONNECTORS.md: 20 s ceiling; a probe uses less. */
const PROBE_TIMEOUT_MS = 10_000;
/** The probe reads a short JSON index; anything larger is not one. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ProbeDeps {
  /** Injectable so redirect handling can be tested without a network. */
  readonly fetch?: FetchLike;
  /** Injectable resolver, so the policy can be exercised without DNS. */
  readonly resolve?: (hostname: string) => Promise<string[]>;
  readonly now?: () => number;
}

/**
 * Follows redirects manually, validating every hop.
 *
 * `redirect: 'manual'` is essential: the platform fetch would otherwise follow
 * a `Location` to a private address without ever consulting the policy, which
 * is the classic way an SSRF guard is bypassed.
 */
async function fetchWithPolicy(
  url: URL,
  headers: Record<string, string>,
  provider: ProviderId,
  config: Config,
  doFetch: FetchLike,
  resolve?: (hostname: string) => Promise<string[]>,
): Promise<Response> {
  const base = fetchPolicyFor(config, provider);
  // `required`: this path connects, so an unresolvable name is refused rather
  // than handed to the platform resolver a second time.
  const policy: FetchPolicy = { ...base, dns: 'required', ...(resolve ? { resolve } : {}) };
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertUrlAllowed(current, policy);

    const response = await doFetch(current.toString(), {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (location === null) return response;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new FetchNotAllowedError('The endpoint returned an unparseable redirect target.');
    }
    current = next;
  }

  throw new FetchNotAllowedError(`The endpoint redirected more than ${MAX_REDIRECTS} times.`);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number.parseInt(declared, 10) > MAX_BODY_BYTES) return null;
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Extracts model identifiers from an Ollama `/api/tags` or OpenAI `/models`. */
function modelNames(payload: unknown): string[] | null {
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const list = Array.isArray(record['models'])
    ? record['models']
    : Array.isArray(record['data'])
      ? record['data']
      : null;
  if (list === null) return null;
  const names: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') names.push(entry);
    else if (entry !== null && typeof entry === 'object') {
      const item = entry as Record<string, unknown>;
      const name = item['name'] ?? item['id'] ?? item['model'];
      if (typeof name === 'string') names.push(name);
    }
  }
  return names;
}

/** Joins a base URL and a path without doubling or dropping a separator. */
function endpoint(base: URL, path: string): URL {
  const trimmed = base.pathname.replace(/\/+$/, '');
  const next = new URL(base.toString());
  next.pathname = `${trimmed}${path}`;
  next.search = '';
  next.hash = '';
  return next;
}

export async function probeProvider(
  config: Config,
  row: ProviderSettingsRow | undefined,
  apiKey: string | null,
  deps: ProbeDeps = {},
): Promise<ProviderTestResult> {
  const provider = (row?.provider ?? 'none') as ProviderId;
  const model = row?.model ?? '';
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => Date.now());

  if (provider === 'none') {
    return {
      reachable: false,
      structured_output_supported: null,
      model_available: null,
      latency_ms: null,
      detail:
        'No AI provider is configured. Manual profile entry, job import and the application ' +
        'tracker do not require one.',
    };
  }

  if (provider === 'fake') {
    // In-process and deterministic: there is nothing to reach, and saying so
    // is more useful than reporting a meaningless latency.
    return {
      reachable: true,
      structured_output_supported: true,
      model_available: true,
      latency_ms: 0,
      detail:
        'The deterministic fake provider runs in-process. No network request is made and no ' +
        'data leaves this machine.',
    };
  }

  if (row?.base_url == null) {
    throw unprocessable(`The "${provider}" provider has no base_url configured.`, {
      base_url: 'Required for this provider.',
    });
  }

  const base = parseBaseUrl(row.base_url);
  const path = provider === 'ollama' ? '/api/tags' : '/models';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (provider === 'openai_compatible' && apiKey !== null) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  const started = now();
  let response: Response;
  try {
    response = await fetchWithPolicy(
      endpoint(base, path),
      headers,
      provider,
      config,
      doFetch,
      deps.resolve,
    );
  } catch (error) {
    if (error instanceof FetchNotAllowedError) {
      // A refused destination is a configuration error, not "unreachable":
      // reporting it as a failed connection would hide that the request was
      // never made at all.
      throw unprocessable(error.reason, { base_url: 'Destination not allowed.' });
    }
    return {
      reachable: false,
      structured_output_supported: null,
      model_available: null,
      latency_ms: Math.max(0, Math.round(now() - started)),
      // Redacted: the class of failure only. A provider error body may echo
      // the request, including the Authorization header on some gateways.
      detail: `The endpoint could not be reached (${describeFailure(error)}).`,
    };
  }

  const latency = Math.max(0, Math.round(now() - started));

  if (response.status === 401 || response.status === 403) {
    return {
      reachable: true,
      structured_output_supported: null,
      model_available: null,
      latency_ms: latency,
      detail: `The endpoint answered but rejected the credentials (HTTP ${response.status}).`,
    };
  }

  if (!response.ok) {
    return {
      reachable: true,
      structured_output_supported: null,
      model_available: null,
      latency_ms: latency,
      detail: `The endpoint answered with HTTP ${response.status}.`,
    };
  }

  const names = modelNames(await readBoundedJson(response));
  const available = names === null ? null : names.includes(model);
  const limits = readValidatedConfig(row).limits;

  return {
    reachable: true,
    // Not probed here; see the module comment. `null` means unknown, and
    // unknown is never reported as supported.
    structured_output_supported: null,
    model_available: available,
    latency_ms: latency,
    detail:
      (available === null
        ? 'The endpoint answered but does not publish a model list, so model availability is unknown.'
        : available
          ? `The endpoint answered and lists "${model}".`
          : `The endpoint answered but does not list "${model}".`) +
      (provider === 'openai_compatible'
        ? ' Requests to this provider send task input to an external service.'
        : '') +
      ` Timeout ${limits.timeout_seconds}s.`,
  };
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timed out';
    return error.name;
  }
  return 'unknown error';
}
