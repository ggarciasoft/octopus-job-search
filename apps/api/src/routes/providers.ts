/**
 * GET/PUT /settings/providers and POST /settings/providers/test.
 *
 * The API key is **write-only**. It arrives on `PUT`, is encrypted with
 * AES-256-GCM under `ENCRYPTION_KEY` (`src/crypto/secrets.ts`) and stored as
 * `provider_settings.secret_ciphertext`. `GET` returns `api_key_set` and a
 * four-character mask; there is no code path from the ciphertext to a response
 * body except the probe, which uses the plaintext as an `Authorization` header
 * and never echoes it.
 *
 * `PUT` semantics for `api_key`:
 *
 *  * absent  — keep whatever is stored (so a settings form that does not
 *    re-send the secret does not silently erase it);
 *  * `null`  — clear it;
 *  * string  — replace it, re-encrypting under the current key version.
 *
 * That last case is also how key rotation completes lazily: every write
 * produces an envelope stamped with `keyring.currentVersion`.
 */
import {
  DEFAULT_PROVIDER_LIMITS,
  type ProviderSettingsPutRequest,
  type ProviderSettingsView,
  type ProviderTestResult,
} from '@job-getter/contracts';
import { internalError } from '../errors.js';
import { recordAuditEvent } from '../auth/scope.js';
import {
  SecretCryptoError,
  decryptSecret,
  encryptSecret,
  keyringFromConfig,
  maskSecret,
} from '../crypto/secrets.js';
import {
  assertProviderRequestAllowed,
  loadProviderSettings,
  sendsDataExternally,
  toProviderSettingsView,
  readValidatedConfig,
  type ValidatedProviderConfig,
} from '../settings/providers.js';
import { probeProvider } from '../settings/provider-test.js';
import { requireScope, requireSession, type RouteHandler } from './context.js';

export const getProviderSettings: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const row = await loadProviderSettings(scope);
  const view: ProviderSettingsView = toProviderSettingsView(row);
  return reply.status(200).send(view);
};

export const putProviderSettings: RouteHandler = async (context, request, reply) => {
  const principal = requireSession(request);
  const scope = requireScope(context, request);
  const body = request.body as ProviderSettingsPutRequest;

  // Destination policy is applied before the row is written, so a forbidden
  // base_url never reaches the database at all.
  await assertProviderRequestAllowed(context.config, body);

  const keyring = keyringFromConfig(context.config);
  const existing = await loadProviderSettings(scope);
  const existingConfig = readValidatedConfig(existing);

  let ciphertext: Buffer | null | undefined;
  let masked: string | null = existingConfig.api_key_masked;
  let keyVersion: number | null = existingConfig.key_version;

  if (body.api_key === null) {
    ciphertext = null;
    masked = null;
    keyVersion = null;
  } else if (typeof body.api_key === 'string' && body.api_key.length > 0) {
    ciphertext = encryptSecret(keyring, body.api_key);
    masked = maskSecret(body.api_key);
    keyVersion = keyring.currentVersion;
  } else if (typeof body.api_key === 'string') {
    // An explicit empty string means "no key", which is clearer to honour than
    // to store as a zero-length secret.
    ciphertext = null;
    masked = null;
    keyVersion = null;
  }

  const validatedConfig: ValidatedProviderConfig = {
    limits: body.limits ?? DEFAULT_PROVIDER_LIMITS,
    rate_card: body.rate_card,
    api_key_masked: masked,
    key_version: keyVersion,
  };

  const updated = await context.db.transaction().execute(async (trx) => {
    const scoped = scope.withExecutor(trx);
    const current = await scoped
      .selectFrom('provider_settings')
      .selectAll()
      .forUpdate()
      .executeTakeFirst();

    const values = {
      provider: body.provider,
      base_url: body.base_url,
      model: body.model,
      // `daily_budget` mirrors the cost cap into a typed numeric column so a
      // future budget query does not have to reach inside the JSON blob. A
      // cost cap is only enforceable with a rate card (06_AI_PROFILE_AND_CV);
      // without one the token and request caps in `limits` apply instead.
      daily_budget:
        body.rate_card === null || body.limits.daily_cost_budget === null
          ? null
          : String(body.limits.daily_cost_budget),
      validated_config: JSON.stringify(validatedConfig),
      updated_at: new Date(),
    };

    if (current === undefined) {
      await scoped
        .insertInto('provider_settings', {
          ...values,
          secret_ciphertext: ciphertext ?? null,
        })
        .execute();
    } else {
      await scoped
        .updateTable('provider_settings')
        .set(ciphertext === undefined ? values : { ...values, secret_ciphertext: ciphertext })
        .where('id', '=', current.id)
        .execute();
    }

    await recordAuditEvent(scoped, {
      action: 'provider_settings.updated',
      actorId: principal.userId,
      objectId: current?.id ?? null,
      objectType: 'provider_settings',
      // Never the key, never the mask. Whether a secret is present, and where
      // the data goes, are the facts worth auditing.
      metadata: {
        provider: body.provider,
        model: body.model,
        api_key_present: (ciphertext ?? current?.secret_ciphertext ?? null) !== null,
        api_key_changed: ciphertext !== undefined,
        key_version: keyVersion,
        sends_data_externally: sendsDataExternally(body.provider),
      },
    });

    return loadProviderSettings(scoped);
  });

  const view: ProviderSettingsView = toProviderSettingsView(updated);
  return reply.status(200).send(view);
};

export const testProviderSettings: RouteHandler = async (context, request, reply) => {
  const scope = requireScope(context, request);
  const row = await loadProviderSettings(scope);

  let apiKey: string | null = null;
  if (row?.secret_ciphertext != null) {
    try {
      apiKey = decryptSecret(keyringFromConfig(context.config), row.secret_ciphertext);
    } catch (error) {
      if (error instanceof SecretCryptoError) {
        // The stored secret is unreadable (tampered, or written under another
        // key). Failing is the honest outcome: probing without the credential
        // would report "credentials rejected" and blame the user's key.
        throw internalError({ reason: 'provider_secret_unreadable' });
      }
      throw error;
    }
  }

  const result: ProviderTestResult = await probeProvider(context.config, row, apiKey);
  return reply.status(200).send(result);
};
