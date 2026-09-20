import {
  ALL_PROVIDER_IDS,
  DEFAULT_PROVIDER_LIMITS,
  type ProviderId,
  type ProviderLimits,
  type ProviderSettingsPutRequest,
  type ProviderSettingsView,
  type ProviderTestResult,
  type RateCard,
} from '@job-getter/contracts';
import { Badge, Button, Callout, Checkbox, Select, Spinner, TextField } from '@job-getter/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/ApiProvider';
import { describeFailure } from '../../api/errors';
import { fieldError } from '../../api/fieldErrors';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useTranslation } from '../../i18n/I18nProvider';
import { formatNumber } from '../../i18n/format';

export const PROVIDER_QUERY_KEY = ['provider-settings'] as const;

/**
 * Providers that talk to an endpoint. Mirrors the API rule in
 * `assertProviderRequestAllowed`: `none` and `fake` must send `base_url: null`.
 */
function usesEndpoint(provider: ProviderId): boolean {
  return provider === 'ollama' || provider === 'openai_compatible';
}

export function ProviderPage() {
  const api = useApi();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: PROVIDER_QUERY_KEY,
    queryFn: ({ signal }) => api.getProviderSettings({ signal }),
  });
  // Held here rather than in the form, which remounts when the saved row changes.
  const [saved, setSaved] = useState(false);

  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <Spinner label={t('provider.loading')} />
        <span>{t('provider.loading')}</span>
      </div>
    );
  }
  if (query.data === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNotice error={query.error} overrideMessage={t('provider.loadFailed')} />
        <div>
          <Button variant="primary" onClick={() => void query.refetch()}>
            {t('action.retry')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      {saved ? (
        <Callout tone="success">
          <p>{t('provider.saved')}</p>
        </Callout>
      ) : null}
      <ProviderForm
        key={query.data.updated_at ?? 'unsaved'}
        view={query.data}
        onSaved={() => setSaved(true)}
      />
    </>
  );
}

interface LimitText {
  readonly context_limit: string;
  readonly output_token_limit: string;
  readonly temperature: string;
  readonly timeout_seconds: string;
  readonly daily_token_budget: string;
  readonly daily_cost_budget: string;
}

function toLimitText(limits: ProviderLimits): LimitText {
  return {
    context_limit: String(limits.context_limit),
    output_token_limit: String(limits.output_token_limit),
    temperature: String(limits.temperature),
    timeout_seconds: String(limits.timeout_seconds),
    daily_token_budget: limits.daily_token_budget === null ? '' : String(limits.daily_token_budget),
    daily_cost_budget: limits.daily_cost_budget === null ? '' : String(limits.daily_cost_budget),
  };
}

function parseNumber(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function ProviderForm({
  view,
  onSaved,
}: {
  readonly view: ProviderSettingsView;
  readonly onSaved: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { t, locale } = useTranslation();

  const [provider, setProvider] = useState<ProviderId>(view.provider);
  const [model, setModel] = useState(view.model);
  const [baseUrl, setBaseUrl] = useState(view.base_url ?? '');
  // The key is write-only: this starts empty on every load and is never
  // populated from the API, which only ever reports whether one is set.
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [limits, setLimits] = useState<LimitText>(() => toLimitText(view.limits));
  const [rateCardEnabled, setRateCardEnabled] = useState(view.rate_card !== null);
  const [rateCurrency, setRateCurrency] = useState(view.rate_card?.currency ?? '');
  const [rateInput, setRateInput] = useState(
    view.rate_card === null ? '' : String(view.rate_card.input_cost_per_million),
  );
  const [rateOutput, setRateOutput] = useState(
    view.rate_card === null ? '' : String(view.rate_card.output_cost_per_million),
  );

  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<unknown>(null);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  const serverFields = useMemo(
    () => (saveError === null ? {} : describeFailure(saveError).fields),
    [saveError],
  );
  const errorFor = (name: string): string | null =>
    localErrors[name] ?? fieldError(serverFields, name);

  const dirty =
    provider !== view.provider ||
    model !== view.model ||
    (usesEndpoint(provider) ? baseUrl : '') !== (view.base_url ?? '') ||
    apiKey !== '' ||
    clearKey ||
    JSON.stringify(limits) !== JSON.stringify(toLimitText(view.limits)) ||
    rateCardEnabled !== (view.rate_card !== null) ||
    (rateCardEnabled &&
      (rateCurrency !== (view.rate_card?.currency ?? '') ||
        rateInput !== String(view.rate_card?.input_cost_per_million ?? '') ||
        rateOutput !== String(view.rate_card?.output_cost_per_million ?? '')));

  const costBudgetWithoutRateCard = !rateCardEnabled && limits.daily_cost_budget.trim() !== '';

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};

    if (model.trim() === '') errors['model'] = t('provider.modelRequired');
    if (usesEndpoint(provider) && baseUrl.trim() === '')
      errors['base_url'] = t('provider.baseUrlRequired');

    const parsed = {
      context_limit: parseNumber(limits.context_limit),
      output_token_limit: parseNumber(limits.output_token_limit),
      temperature: parseNumber(limits.temperature),
      timeout_seconds: parseNumber(limits.timeout_seconds),
      daily_token_budget: parseNumber(limits.daily_token_budget),
      daily_cost_budget: parseNumber(limits.daily_cost_budget),
    };
    for (const key of [
      'context_limit',
      'output_token_limit',
      'temperature',
      'timeout_seconds',
    ] as const) {
      if (parsed[key] === null) errors[key] = t('provider.numberRequired');
    }
    if (limits.daily_token_budget.trim() !== '' && parsed.daily_token_budget === null) {
      errors['daily_token_budget'] = t('provider.numberRequired');
    }
    if (limits.daily_cost_budget.trim() !== '' && parsed.daily_cost_budget === null) {
      errors['daily_cost_budget'] = t('provider.numberRequired');
    }

    let rateCard: RateCard | null = null;
    if (rateCardEnabled) {
      const input = parseNumber(rateInput);
      const output = parseNumber(rateOutput);
      if (!/^[A-Z]{3}$/.test(rateCurrency))
        errors['rate_currency'] = t('preferences.currencyInvalid');
      if (input === null) errors['input_cost_per_million'] = t('provider.numberRequired');
      if (output === null) errors['output_cost_per_million'] = t('provider.numberRequired');
      rateCard = {
        currency: rateCurrency,
        input_cost_per_million: input ?? 0,
        output_cost_per_million: output ?? 0,
      };
    }

    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const body: ProviderSettingsPutRequest = {
      provider,
      model: model.trim(),
      base_url: usesEndpoint(provider) ? baseUrl.trim() : null,
      limits: {
        context_limit: parsed.context_limit as number,
        output_token_limit: parsed.output_token_limit as number,
        temperature: parsed.temperature as number,
        timeout_seconds: parsed.timeout_seconds as number,
        daily_token_budget: parsed.daily_token_budget,
        daily_cost_budget: parsed.daily_cost_budget,
      },
      rate_card: rateCard,
      // Absent: keep the stored key. `null`: clear it. String: replace it.
      ...(clearKey ? { api_key: null } : apiKey === '' ? {} : { api_key: apiKey }),
    };

    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.putProviderSettings({ body });
      queryClient.setQueryData(PROVIDER_QUERY_KEY, updated);
      onSaved();
      // The key is write-only: once sent it is gone from this screen.
      setApiKey('');
      setClearKey(false);
    } catch (caught) {
      setSaveError(caught);
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      setTestResult(await api.testProviderSettings({}));
    } catch (caught) {
      setTestError(caught);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {view.sends_data_externally ? (
        <Callout tone="warning" title={t('provider.externalTitle')}>
          <p data-testid="external-notice">{t('provider.externalBody')}</p>
        </Callout>
      ) : null}

      {saveError === null ? null : <ErrorNotice error={saveError} />}

      <form className="flex flex-col gap-8" onSubmit={(event) => void onSubmit(event)} noValidate>
        <Section title={t('provider.connectionTitle')}>
          <Select
            label={t('provider.provider')}
            description={t('provider.providerHint')}
            value={provider}
            error={errorFor('provider')}
            options={ALL_PROVIDER_IDS.map((id) => ({ value: id, label: t(`providerId.${id}`) }))}
            onChange={(event) => setProvider(event.currentTarget.value as ProviderId)}
          />
          <p className="text-sm text-slate-700">{t(`providerId.${provider}.description`)}</p>
          <TextField
            label={t('provider.model')}
            description={t('provider.modelHint')}
            required
            value={model}
            error={errorFor('model')}
            onChange={(event) => setModel(event.currentTarget.value)}
          />
          {usesEndpoint(provider) ? (
            <TextField
              label={t('provider.baseUrl')}
              description={t('provider.baseUrlHint')}
              type="url"
              required
              value={baseUrl}
              error={errorFor('base_url')}
              onChange={(event) => setBaseUrl(event.currentTarget.value)}
            />
          ) : (
            <p className="text-sm text-slate-600">{t('provider.noBaseUrl')}</p>
          )}
          <div className="flex flex-col gap-2 rounded border border-slate-200 p-3">
            <p className="text-sm text-slate-800">
              <span className="font-medium">{t('provider.apiKeyStatus')}: </span>
              <span data-testid="api-key-status" data-set={String(view.api_key_set)}>
                {view.api_key_set
                  ? t('provider.apiKeySet', { masked: view.api_key_masked ?? '' })
                  : t('provider.apiKeyNotSet')}
              </span>
            </p>
            <TextField
              label={t('provider.apiKey')}
              description={t('provider.apiKeyHint')}
              type="password"
              autoComplete="off"
              value={apiKey}
              error={errorFor('api_key')}
              disabled={clearKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
            {view.api_key_set ? (
              <Checkbox
                label={t('provider.clearKey')}
                description={t('provider.clearKeyHint')}
                checked={clearKey}
                onChange={(event) => {
                  setClearKey(event.currentTarget.checked);
                  if (event.currentTarget.checked) setApiKey('');
                }}
              />
            ) : null}
          </div>
        </Section>

        <Section title={t('provider.limitsTitle')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumberInput
              label={t('providerLimit.context_limit')}
              value={limits.context_limit}
              error={errorFor('context_limit')}
              defaultValue={DEFAULT_PROVIDER_LIMITS.context_limit}
              onChange={(context_limit) => setLimits({ ...limits, context_limit })}
            />
            <NumberInput
              label={t('providerLimit.output_token_limit')}
              value={limits.output_token_limit}
              error={errorFor('output_token_limit')}
              defaultValue={DEFAULT_PROVIDER_LIMITS.output_token_limit}
              onChange={(output_token_limit) => setLimits({ ...limits, output_token_limit })}
            />
            <NumberInput
              label={t('providerLimit.temperature')}
              value={limits.temperature}
              error={errorFor('temperature')}
              defaultValue={DEFAULT_PROVIDER_LIMITS.temperature}
              step={0.1}
              onChange={(temperature) => setLimits({ ...limits, temperature })}
            />
            <NumberInput
              label={t('providerLimit.timeout_seconds')}
              value={limits.timeout_seconds}
              error={errorFor('timeout_seconds')}
              defaultValue={DEFAULT_PROVIDER_LIMITS.timeout_seconds}
              onChange={(timeout_seconds) => setLimits({ ...limits, timeout_seconds })}
            />
            <TextField
              label={t('providerLimit.daily_token_budget')}
              description={t('provider.optionalLimit')}
              type="number"
              min={0}
              value={limits.daily_token_budget}
              error={errorFor('daily_token_budget')}
              onChange={(event) =>
                setLimits({ ...limits, daily_token_budget: event.currentTarget.value })
              }
            />
            <TextField
              label={t('providerLimit.daily_cost_budget')}
              description={t('provider.costBudgetHint')}
              type="number"
              min={0}
              step={0.01}
              value={limits.daily_cost_budget}
              error={errorFor('daily_cost_budget')}
              onChange={(event) =>
                setLimits({ ...limits, daily_cost_budget: event.currentTarget.value })
              }
            />
          </div>
          {costBudgetWithoutRateCard ? (
            <Callout tone="warning">
              <p data-testid="cost-budget-unenforceable">{t('provider.costBudgetUnenforceable')}</p>
            </Callout>
          ) : null}
        </Section>

        <Section title={t('provider.rateCardTitle')}>
          <p className="text-sm text-slate-700">{t('provider.rateCardIntro')}</p>
          <Checkbox
            label={t('provider.rateCardEnabled')}
            checked={rateCardEnabled}
            onChange={(event) => setRateCardEnabled(event.currentTarget.checked)}
          />
          {rateCardEnabled ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField
                label={t('provider.rateCurrency')}
                required
                maxLength={3}
                placeholder="USD"
                value={rateCurrency}
                error={errorFor('rate_currency') ?? fieldError(serverFields, 'currency')}
                onChange={(event) => setRateCurrency(event.currentTarget.value.toUpperCase())}
              />
              <TextField
                label={t('provider.rateInput')}
                type="number"
                min={0}
                step={0.000001}
                required
                value={rateInput}
                error={errorFor('input_cost_per_million')}
                onChange={(event) => setRateInput(event.currentTarget.value)}
              />
              <TextField
                label={t('provider.rateOutput')}
                type="number"
                min={0}
                step={0.000001}
                required
                value={rateOutput}
                error={errorFor('output_cost_per_million')}
                onChange={(event) => setRateOutput(event.currentTarget.value)}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-700" data-testid="cost-unknown-note">
              {t('provider.noRateCard')}
            </p>
          )}
        </Section>

        <div>
          <Button type="submit" variant="primary" busy={saving} busyLabel={t('provider.saving')}>
            {t('provider.save')}
          </Button>
        </div>
      </form>

      <Section title={t('provider.testTitle')}>
        <p className="text-sm text-slate-700">{t('provider.testIntro')}</p>
        {dirty ? <p className="text-sm text-amber-900">{t('provider.testUnsaved')}</p> : null}
        <div>
          <Button busy={testing} busyLabel={t('provider.testing')} onClick={() => void onTest()}>
            {t('provider.test')}
          </Button>
        </div>
        {testError === null ? null : <ErrorNotice error={testError} />}
        {testResult === null ? null : (
          <dl
            className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-[14rem_1fr]"
            data-testid="test-result"
          >
            <dt className="font-medium">{t('provider.reachable')}</dt>
            <dd>
              <ProbeValue name="reachable" value={testResult.reachable} />
            </dd>
            <dt className="font-medium">{t('provider.modelAvailable')}</dt>
            <dd>
              <ProbeValue name="model_available" value={testResult.model_available} />
            </dd>
            <dt className="font-medium">{t('provider.structuredOutput')}</dt>
            <dd>
              <ProbeValue
                name="structured_output_supported"
                value={testResult.structured_output_supported}
              />
            </dd>
            <dt className="font-medium">{t('provider.latency')}</dt>
            <dd>
              {testResult.latency_ms === null
                ? t('common.notReported')
                : t('provider.latencyValue', { ms: formatNumber(locale, testResult.latency_ms) })}
            </dd>
            <dt className="font-medium">{t('provider.detail')}</dt>
            {/* The probe's own text, verbatim. */}
            <dd className="whitespace-pre-wrap">{testResult.detail}</dd>
          </dl>
        )}
      </Section>
    </div>
  );
}

/** `null` is "not determined", rendered with the unknown tone — never a pass. */
function ProbeValue({ name, value }: { readonly name: string; readonly value: boolean | null }) {
  const { t } = useTranslation();
  const tone = value === null ? 'unknown' : value ? 'success' : 'danger';
  return (
    <Badge tone={tone}>
      <span data-testid={`probe-${name}`} data-value={String(value)}>
        {value === null ? t('provider.notDetermined') : value ? t('common.yes') : t('common.no')}
      </span>
    </Badge>
  );
}

function NumberInput({
  label,
  value,
  error,
  defaultValue,
  step,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly error: string | null;
  readonly defaultValue: number;
  readonly step?: number;
  readonly onChange: (next: string) => void;
}) {
  const { t, locale } = useTranslation();
  return (
    <TextField
      label={label}
      description={t('preferences.pilotDefault', { value: formatNumber(locale, defaultValue) })}
      type="number"
      step={step}
      required
      value={value}
      error={error}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
