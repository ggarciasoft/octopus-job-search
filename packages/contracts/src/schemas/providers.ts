import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';

/**
 * `none` is a first-class choice: with no provider configured the manual
 * profile, job import and tracker flows must still work (AT28). There is no
 * automatic fallback from a local provider to a cloud one (ADR07).
 */
export const ProviderId = Type.Union([
  Type.Literal('none'),
  Type.Literal('fake'),
  Type.Literal('ollama'),
  Type.Literal('openai_compatible'),
]);
export type ProviderId = Static<typeof ProviderId>;

export const ALL_PROVIDER_IDS = [
  'none',
  'fake',
  'ollama',
  'openai_compatible',
] as const satisfies readonly ProviderId[];

export const ProviderLimits = Type.Object(
  {
    context_limit: Type.Integer({ minimum: 512, maximum: 2_000_000 }),
    output_token_limit: Type.Integer({ minimum: 64, maximum: 200_000 }),
    temperature: Type.Number({ minimum: 0, maximum: 2 }),
    timeout_seconds: Type.Integer({ minimum: 5, maximum: 600 }),
    daily_token_budget: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    daily_cost_budget: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderLimits = Static<typeof ProviderLimits>;

export const DEFAULT_PROVIDER_LIMITS: ProviderLimits = {
  context_limit: 32_768,
  output_token_limit: 4096,
  temperature: 0,
  timeout_seconds: 120,
  daily_token_budget: null,
  daily_cost_budget: null,
};

/**
 * A rate card is required before any cost cap can be enforced. Without one the
 * system enforces token and request caps and reports cost as unknown.
 */
export const RateCard = Type.Object(
  {
    currency: Type.String({ pattern: '^[A-Z]{3}$' }),
    input_cost_per_million: Type.Number({ minimum: 0 }),
    output_cost_per_million: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type RateCard = Static<typeof RateCard>;

export const ProviderSettingsPutRequest = Type.Object(
  {
    provider: ProviderId,
    model: Type.String({ minLength: 1, maxLength: 128 }),
    /** Operator-allowlisted for local endpoints; never an arbitrary internal host. */
    base_url: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
    /** Write-only. GET never returns it, only a masked readiness flag. */
    api_key: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
    limits: ProviderLimits,
    rate_card: Type.Union([RateCard, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderSettingsPutRequest = Static<typeof ProviderSettingsPutRequest>;

export const ProviderSettingsView = Type.Object(
  {
    provider: ProviderId,
    model: Type.String(),
    base_url: Type.Union([Type.String(), Type.Null()]),
    api_key_set: Type.Boolean(),
    api_key_masked: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
    limits: ProviderLimits,
    rate_card: Type.Union([RateCard, Type.Null()]),
    /** True when this provider sends task input to an external service. */
    sends_data_externally: Type.Boolean(),
    updated_at: Type.Union([Timestamp, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ProviderSettingsView = Static<typeof ProviderSettingsView>;

/**
 * Connectivity test. It probes the configured provider only; it is never a
 * general-purpose URL fetcher (04_API_CONTRACTS.md).
 */
export const ProviderTestResult = Type.Object(
  {
    reachable: Type.Boolean(),
    structured_output_supported: Type.Union([Type.Boolean(), Type.Null()]),
    model_available: Type.Union([Type.Boolean(), Type.Null()]),
    latency_ms: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    detail: Type.String({ maxLength: 1000 }),
  },
  { additionalProperties: false },
);
export type ProviderTestResult = Static<typeof ProviderTestResult>;

export const UsageLedgerEntry = Type.Object(
  {
    id: Uuid,
    task_id: Type.Union([Uuid, Type.Null()]),
    provider: ProviderId,
    input_tokens: Type.Integer({ minimum: 0 }),
    output_tokens: Type.Integer({ minimum: 0 }),
    measured_cost: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    reserved_cost: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    currency: Type.Union([Type.String({ pattern: '^[A-Z]{3}$' }), Type.Null()]),
    status: Type.Union([
      Type.Literal('reserved'),
      Type.Literal('settled'),
      Type.Literal('released'),
    ]),
    created_at: Timestamp,
  },
  { additionalProperties: false },
);
export type UsageLedgerEntry = Static<typeof UsageLedgerEntry>;
