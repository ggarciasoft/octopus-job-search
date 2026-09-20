/**
 * Model provider configuration.
 *
 * Three rules from the specification shape this module:
 *
 *  * **The API key is write-only.** `PUT` accepts it; `GET` returns
 *    `api_key_set` and a masked hint and nothing else (04_API_CONTRACTS.md:
 *    "secret values accepted on PUT, never returned"). The plaintext exists in
 *    process memory for the duration of one request and is then encrypted.
 *  * **Honest external-transfer flag.** "Tell users that API use sends task
 *    input externally" (06_AI_PROFILE_AND_CV.md). `sends_data_externally` is
 *    *derived* from the provider id rather than stored, so it cannot be left
 *    stale by a row written before the flag existed.
 *  * **No automatic fallback** from a local provider to a cloud one (ADR07).
 *    There is one configured provider; nothing here silently substitutes
 *    another, and `POST /settings/providers/test` probes only that one.
 */
import type { Selectable } from 'kysely';
import {
  DEFAULT_PROVIDER_LIMITS,
  ProviderLimits as ProviderLimitsSchema,
  RateCard as RateCardSchema,
  type ProviderId,
  type ProviderLimits,
  type ProviderSettingsPutRequest,
  type ProviderSettingsView,
  type RateCard,
} from '@job-getter/contracts';
import type { Config } from '../config.js';
import type { ProviderSettingsTable } from '../db/types.js';
import { unprocessable } from '../errors.js';
import type { WorkspaceScope } from '../auth/scope.js';
import { checkSchema } from '../validation.js';
import {
  FetchNotAllowedError,
  assertUrlAllowed,
  isAllowlisted,
  type FetchPolicy,
} from './network.js';

export type ProviderSettingsRow = Selectable<ProviderSettingsTable>;

/**
 * Which providers transmit task input off this machine.
 *
 * `fake` is deterministic and in-process; `ollama` is the operator's own
 * local endpoint; `none` performs no inference at all. Only an
 * OpenAI-compatible HTTP endpoint is, by construction, somewhere else.
 */
export function sendsDataExternally(provider: ProviderId): boolean {
  return provider === 'openai_compatible';
}

/** Non-secret configuration kept in `provider_settings.validated_config`. */
export interface ValidatedProviderConfig {
  readonly limits: ProviderLimits;
  readonly rate_card: RateCard | null;
  /** Last four characters only; see `maskSecret`. Never the key itself. */
  readonly api_key_masked: string | null;
  /** Which `ENCRYPTION_KEY` version produced `secret_ciphertext`. */
  readonly key_version: number | null;
}

export function readValidatedConfig(row: ProviderSettingsRow | undefined): ValidatedProviderConfig {
  const raw = (row?.validated_config ?? {}) as Partial<ValidatedProviderConfig>;
  const limits = checkSchema(ProviderLimitsSchema, raw.limits).ok
    ? (raw.limits as ProviderLimits)
    : DEFAULT_PROVIDER_LIMITS;
  const rateCard =
    raw.rate_card != null && checkSchema(RateCardSchema, raw.rate_card).ok
      ? (raw.rate_card as RateCard)
      : null;
  return {
    limits,
    rate_card: rateCard,
    api_key_masked: typeof raw.api_key_masked === 'string' ? raw.api_key_masked : null,
    key_version: typeof raw.key_version === 'number' ? raw.key_version : null,
  };
}

/**
 * The view returned by `GET` and `PUT`.
 *
 * There is deliberately no code path from `secret_ciphertext` to this object:
 * the row's secret is reduced to a boolean and a mask before it ever reaches a
 * serialiser.
 */
export function toProviderSettingsView(row: ProviderSettingsRow | undefined): ProviderSettingsView {
  const config = readValidatedConfig(row);
  const provider = (row?.provider ?? 'none') as ProviderId;
  return {
    provider,
    model: row?.model ?? '',
    base_url: row?.base_url ?? null,
    api_key_set: row?.secret_ciphertext != null,
    api_key_masked: row?.secret_ciphertext == null ? null : config.api_key_masked,
    limits: config.limits,
    rate_card: config.rate_card,
    sends_data_externally: sendsDataExternally(provider),
    updated_at: row?.updated_at.toISOString() ?? null,
  };
}

export async function loadProviderSettings(
  scope: WorkspaceScope,
): Promise<ProviderSettingsRow | undefined> {
  const row = await scope.selectFrom('provider_settings').selectAll().executeTakeFirst();
  return row as ProviderSettingsRow | undefined;
}

/**
 * The destination policy for a given provider.
 *
 * `openai_compatible` gets the strict public-internet rule with no allowlist
 * bypass. `ollama` gets the operator-controlled local policy: the hosts the
 * operator listed in `ALLOWED_FETCH_HOSTS`, plus the host of
 * `LOCAL_MODEL_BASE_URL` if one is configured. That is the separation
 * 05_DISCOVERY_CONNECTORS.md requires — the local-model exception must not
 * widen anything else.
 */
export function fetchPolicyFor(config: Config, provider: ProviderId): FetchPolicy {
  if (provider === 'ollama') {
    const allowed = new Set<string>(config.allowedFetchHosts);
    if (config.localModelBaseUrl !== null) {
      try {
        const url = new URL(config.localModelBaseUrl);
        const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        allowed.add(host);
        if (url.port !== '') allowed.add(`${host}:${url.port}`);
      } catch {
        // A malformed LOCAL_MODEL_BASE_URL grants nothing; config validation
        // does not parse it as a URL, so this must not throw here.
      }
    }
    return { requireHttps: false, allowedHosts: [...allowed] };
  }
  return { requireHttps: true, allowedHosts: [] };
}

export function parseBaseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw unprocessable('base_url must be an absolute URL.', {
      base_url: 'Not a valid absolute URL.',
    });
  }
}

/**
 * Validates a `PUT` body beyond its schema.
 *
 * The base URL is checked here, at write time, as well as before every probe:
 * refusing a forbidden destination when it is *stored* means the operator sees
 * the error while configuring rather than discovering it at the first request,
 * and it keeps a disallowed value out of the database entirely.
 */
export async function assertProviderRequestAllowed(
  config: Config,
  body: ProviderSettingsPutRequest,
): Promise<void> {
  if (body.provider === 'none' || body.provider === 'fake') {
    if (body.base_url !== null) {
      throw unprocessable(`The "${body.provider}" provider does not use a base_url.`, {
        base_url: 'Must be null for this provider.',
      });
    }
    return;
  }

  if (body.base_url === null) {
    throw unprocessable(`The "${body.provider}" provider requires a base_url.`, {
      base_url: 'Required for this provider.',
    });
  }

  const url = parseBaseUrl(body.base_url);
  const policy = fetchPolicyFor(config, body.provider);

  if (body.provider === 'ollama' && !isAllowlisted(url, policy.allowedHosts)) {
    // Say exactly which operator setting grants it, so a self-hoster can fix
    // it and a hosted tenant learns that they cannot.
    throw unprocessable(
      'This local model endpoint is not permitted by the operator. ' +
        'Add its host to ALLOWED_FETCH_HOSTS or set LOCAL_MODEL_BASE_URL.',
      { base_url: 'Not in the operator allowlist.' },
    );
  }

  try {
    // `best_effort` DNS: storing a setting must not require the endpoint to be
    // resolvable at that instant. Every address it *does* resolve to is still
    // checked here, and the probe re-validates with `required` before it
    // connects, so nothing is reachable that this check would have refused.
    await assertUrlAllowed(url, { ...policy, dns: 'best_effort' });
  } catch (error) {
    if (error instanceof FetchNotAllowedError) {
      throw unprocessable(error.reason, { base_url: 'Destination not allowed.' });
    }
    throw error;
  }
}
