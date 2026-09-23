import {
  DEFAULT_OPERATIONAL_LIMITS,
  DEFAULT_PREFERENCES,
  MATCH_WEIGHT_KEYS,
  Preferences as PreferencesSchema,
  RemoteMode as RemoteModeSchema,
  SalaryPeriod as SalaryPeriodSchema,
  matchWeightsSum,
  type MatchWeights,
  type OperationalLimits,
  type Preferences,
  type PreferencesView,
  type RemoteMode,
  type SalaryPeriod,
} from '@job-getter/contracts';
import {
  Button,
  Callout,
  Checkbox,
  RadioGroup,
  Select,
  Spinner,
  TextArea,
  TextField,
} from '@job-getter/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useApi } from '../../api/ApiProvider';
import { describeFailure } from '../../api/errors';
import { fieldError } from '../../api/fieldErrors';
import { ErrorNotice } from '../../components/ErrorNotice';
import { StringListField } from '../../components/StringListField';
import { useTranslation } from '../../i18n/I18nProvider';
import { formatNumber } from '../../i18n/format';
import { SUPPORTED_LOCALES } from '../../i18n/messages';
import { isCountryCode, isLanguageCode, literalOptions } from '../../profile/factValues';
import { SettingsFilePanel } from './SettingsFilePanel';

export const PREFERENCES_QUERY_KEY = ['preferences'] as const;

const REMOTE_MODES = literalOptions<RemoteMode>(RemoteModeSchema);
const SALARY_PERIODS = literalOptions<SalaryPeriod>(SalaryPeriodSchema);
const EMPLOYMENT_TYPES = literalOptions<Preferences['employment_types'][number]>(
  PreferencesSchema.properties.employment_types.items,
);
const SPONSORSHIP_POLICIES = literalOptions<Preferences['sponsorship_policy']>(
  PreferencesSchema.properties.sponsorship_policy,
);
const ELIGIBILITY_POLICIES = literalOptions<Preferences['unknown_eligibility_policy']>(
  PreferencesSchema.properties.unknown_eligibility_policy,
);
const CV_TEMPLATES = literalOptions<Preferences['cv_template']>(
  PreferencesSchema.properties.cv_template,
);
const RESUME_MODES = literalOptions<Preferences['resume_mode']>(
  PreferencesSchema.properties.resume_mode,
);

type NumericLimitKey = Exclude<keyof OperationalLimits, 'consented_evidence_capture' | 'raw_logs'>;
const NUMERIC_LIMIT_KEYS: readonly NumericLimitKey[] = [
  'scan_max_jobs',
  'request_concurrency_per_host',
  'ai_requests_per_day',
  'fill_attempts_per_day',
  'approval_ttl_hours',
];

export function PreferencesPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const query = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: ({ signal }) => api.getPreferences({ signal }),
  });
  const queryClient = useQueryClient();
  // Held here rather than in the form, which remounts on every new revision.
  const [savedRevision, setSavedRevision] = useState<number | null>(null);

  if (query.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <Spinner label={t('preferences.loading')} />
        <span>{t('preferences.loading')}</span>
      </div>
    );
  }
  if (query.data === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNotice error={query.error} overrideMessage={t('preferences.loadFailed')} />
        <div>
          <Button variant="primary" onClick={() => void query.refetch()}>
            {t('action.retry')}
          </Button>
        </div>
      </div>
    );
  }
  // Keyed by revision so a reload after a 409 rebuilds the form from the
  // server's copy only when the user asked for it. An import replaces the
  // revision too, which is what swaps the imported values into the form.
  return (
    <>
      {savedRevision === null ? null : (
        <Callout tone="success">
          <p>{t('preferences.saved', { revision: formatNumber(locale, savedRevision) })}</p>
        </Callout>
      )}
      <PreferencesForm key={query.data.revision} view={query.data} onSaved={setSavedRevision} />
      <div className="mt-8">
        <SettingsFilePanel
          view={query.data}
          onImported={(result) => {
            setSavedRevision(null);
            queryClient.setQueryData(PREFERENCES_QUERY_KEY, result.preferences);
          }}
        />
      </div>
    </>
  );
}

/** Numbers are edited as text so a half-typed value is never coerced to 0. */
interface NumberText {
  readonly weights: Record<keyof MatchWeights, string>;
  readonly limits: Record<NumericLimitKey, string>;
  readonly scan_interval_hours: string;
  readonly salary_minimum: string;
}

function toNumberText(config: Preferences): NumberText {
  return {
    weights: Object.fromEntries(
      MATCH_WEIGHT_KEYS.map((key) => [key, String(config.match_weights[key])]),
    ) as Record<keyof MatchWeights, string>,
    limits: Object.fromEntries(
      NUMERIC_LIMIT_KEYS.map((key) => [key, String(config.limits[key])]),
    ) as Record<NumericLimitKey, string>,
    scan_interval_hours: String(config.scan_interval_hours),
    salary_minimum: config.salary === null ? '' : String(config.salary.minimum),
  };
}

function parseInteger(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  return Number(text);
}

function PreferencesForm({
  view,
  onSaved,
}: {
  readonly view: PreferencesView;
  readonly onSaved: (revision: number) => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { t, locale } = useTranslation();

  const [config, setConfig] = useState<Preferences>(view.config);
  const [numbers, setNumbers] = useState<NumberText>(() => toNumberText(view.config));
  const [salaryEnabled, setSalaryEnabled] = useState(view.config.salary !== null);
  const [salaryCurrency, setSalaryCurrency] = useState(view.config.salary?.currency ?? '');
  const [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod>(
    view.config.salary?.period ?? 'year',
  );
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const patch = (partial: Partial<Preferences>) =>
    setConfig((current) => ({ ...current, ...partial }));

  const serverFields = useMemo(
    () => (saveError === null ? {} : describeFailure(saveError).fields),
    [saveError],
  );
  const errorFor = (name: string): string | null =>
    localErrors[name] ?? fieldError(serverFields, name);

  // Live weight sum. A non-numeric entry makes the sum undefined, which blocks
  // saving just as a wrong total does.
  const parsedWeights = MATCH_WEIGHT_KEYS.map((key) => parseInteger(numbers.weights[key]));
  const weightsValid = parsedWeights.every((value) => value !== null);
  const weightSum = weightsValid
    ? matchWeightsSum(
        Object.fromEntries(
          MATCH_WEIGHT_KEYS.map((key, index) => [key, parsedWeights[index] as number]),
        ) as MatchWeights,
      )
    : null;
  const weightsOk = weightSum === 100;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};

    const limits: Record<string, number> = {};
    for (const key of NUMERIC_LIMIT_KEYS) {
      const parsed = parseInteger(numbers.limits[key]);
      if (parsed === null) errors[key] = t('preferences.integerRequired');
      else limits[key] = parsed;
    }
    const scanInterval = parseInteger(numbers.scan_interval_hours);
    if (scanInterval === null) errors['scan_interval_hours'] = t('preferences.integerRequired');

    let salary: Preferences['salary'] = null;
    if (salaryEnabled) {
      const minimum = Number(numbers.salary_minimum);
      if (numbers.salary_minimum.trim() === '' || !Number.isFinite(minimum) || minimum < 0) {
        errors['salary_minimum'] = t('preferences.salaryMinimumInvalid');
      }
      if (!/^[A-Z]{3}$/.test(salaryCurrency))
        errors['salary_currency'] = t('preferences.currencyInvalid');
      salary = { minimum, currency: salaryCurrency, period: salaryPeriod };
    }
    if (config.countries.some((code) => !isCountryCode(code))) {
      errors['countries'] = t('preferences.countryCodesInvalid');
    }
    if (config.languages.some((code) => !isLanguageCode(code))) {
      errors['languages'] = t('preferences.languageCodesInvalid');
    }
    if (!weightsOk) errors['match_weights'] = t('preferences.weightsMustSum');

    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const next: Preferences = {
      ...config,
      salary,
      scan_interval_hours: scanInterval as number,
      match_weights: Object.fromEntries(
        MATCH_WEIGHT_KEYS.map((key, index) => [key, parsedWeights[index] as number]),
      ) as MatchWeights,
      limits: {
        ...config.limits,
        ...(limits as Pick<OperationalLimits, NumericLimitKey>),
      },
      prompt_style_suffix:
        config.prompt_style_suffix === null || config.prompt_style_suffix.trim() === ''
          ? null
          : config.prompt_style_suffix,
    };

    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.putPreferences({
        body: { expected_revision: view.revision, config: next },
      });
      queryClient.setQueryData(PREFERENCES_QUERY_KEY, saved);
      onSaved(saved.revision);
    } catch (caught) {
      setSaveError(caught);
    } finally {
      setSaving(false);
    }
  };

  const stale = saveError !== null && describeFailure(saveError).isStale;

  return (
    <form className="flex flex-col gap-8" onSubmit={(event) => void onSubmit(event)} noValidate>
      <p className="text-xs text-slate-600">
        {t('preferences.revision', {
          revision: formatNumber(locale, view.revision),
          version: formatNumber(locale, config.settings_version),
        })}
      </p>

      {saveError === null ? null : (
        <div className="flex flex-col gap-2">
          <ErrorNotice error={saveError} />
          {stale ? (
            <div>
              <Button
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY })
                }
              >
                {t('preferences.reload')}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <Section title={t('preferences.searchTitle')}>
        <StringListField
          label={t('preferences.target_titles')}
          description={t('preferences.listHint')}
          value={config.target_titles}
          error={errorFor('target_titles')}
          onChange={(target_titles) => patch({ target_titles })}
        />
        <StringListField
          label={t('preferences.excluded_titles')}
          description={t('preferences.listHint')}
          value={config.excluded_titles}
          error={errorFor('excluded_titles')}
          onChange={(excluded_titles) => patch({ excluded_titles })}
        />
        <StringListField
          label={t('preferences.required_skills')}
          description={t('preferences.requiredSkillsHint')}
          value={config.required_skills}
          error={errorFor('required_skills')}
          onChange={(required_skills) => patch({ required_skills })}
        />
        <StringListField
          label={t('preferences.preferred_skills')}
          description={t('preferences.listHint')}
          value={config.preferred_skills}
          error={errorFor('preferred_skills')}
          onChange={(preferred_skills) => patch({ preferred_skills })}
        />
        <StringListField
          label={t('preferences.excluded_companies')}
          description={t('preferences.excludedCompaniesHint')}
          value={config.excluded_companies}
          error={errorFor('excluded_companies')}
          onChange={(excluded_companies) => patch({ excluded_companies })}
        />
        <StringListField
          label={t('preferences.countries')}
          description={t('preferences.countriesHint')}
          value={config.countries}
          error={errorFor('countries')}
          onChange={(countries) =>
            patch({ countries: countries.map((code) => code.toUpperCase()) })
          }
        />
        <StringListField
          label={t('preferences.languages')}
          description={t('preferences.languagesHint')}
          value={config.languages}
          error={errorFor('languages')}
          onChange={(languages) => patch({ languages })}
        />
        <CheckboxSet
          legend={t('preferences.remote_modes')}
          description={t('preferences.remoteModesHint')}
          options={REMOTE_MODES.map((mode) => ({ value: mode, label: t(`remoteMode.${mode}`) }))}
          selected={config.remote_modes}
          error={errorFor('remote_modes')}
          onChange={(remote_modes) => patch({ remote_modes: remote_modes as RemoteMode[] })}
        />
        <CheckboxSet
          legend={t('preferences.employment_types')}
          options={EMPLOYMENT_TYPES.map((type) => ({
            value: type,
            label: t(`employmentType.${type}`),
          }))}
          selected={config.employment_types}
          error={errorFor('employment_types')}
          onChange={(employment_types) =>
            patch({ employment_types: employment_types as Preferences['employment_types'] })
          }
        />
      </Section>

      <Section title={t('preferences.salaryTitle')}>
        <p className="text-sm text-slate-700">{t('preferences.salaryNoConversion')}</p>
        <Checkbox
          label={t('preferences.salaryEnabled')}
          checked={salaryEnabled}
          onChange={(event) => setSalaryEnabled(event.currentTarget.checked)}
        />
        {salaryEnabled ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              label={t('preferences.salaryMinimum')}
              type="number"
              min={0}
              required
              value={numbers.salary_minimum}
              error={errorFor('salary_minimum') ?? fieldError(serverFields, 'minimum')}
              onChange={(event) =>
                setNumbers({ ...numbers, salary_minimum: event.currentTarget.value })
              }
            />
            <TextField
              label={t('preferences.salaryCurrency')}
              description={t('preferences.salaryCurrencyHint')}
              required
              maxLength={3}
              placeholder="USD"
              value={salaryCurrency}
              error={errorFor('salary_currency') ?? fieldError(serverFields, 'currency')}
              onChange={(event) => setSalaryCurrency(event.currentTarget.value.toUpperCase())}
            />
            <Select
              label={t('preferences.salaryPeriod')}
              value={salaryPeriod}
              error={fieldError(serverFields, 'period')}
              options={SALARY_PERIODS.map((period) => ({
                value: period,
                label: t(`salaryPeriod.${period}`),
              }))}
              onChange={(event) => setSalaryPeriod(event.currentTarget.value as SalaryPeriod)}
            />
          </div>
        ) : null}
      </Section>

      <Section title={t('preferences.eligibilityTitle')}>
        <RadioGroup<Preferences['sponsorship_policy']>
          legend={t('preferences.sponsorship_policy')}
          description={t('preferences.sponsorshipHint')}
          name="sponsorship_policy"
          value={config.sponsorship_policy}
          error={errorFor('sponsorship_policy')}
          options={SPONSORSHIP_POLICIES.map((policy) => ({
            value: policy,
            label: t(`sponsorshipPolicy.${policy}`),
            description: t(`sponsorshipPolicy.${policy}.description`),
          }))}
          onValueChange={(sponsorship_policy) => patch({ sponsorship_policy })}
        />
        <RadioGroup<Preferences['unknown_eligibility_policy']>
          legend={t('preferences.unknown_eligibility_policy')}
          description={t('preferences.eligibilityHint')}
          name="unknown_eligibility_policy"
          value={config.unknown_eligibility_policy}
          error={errorFor('unknown_eligibility_policy')}
          options={ELIGIBILITY_POLICIES.map((policy) => ({
            value: policy,
            label: t(`eligibilityPolicy.${policy}`),
            description: t(`eligibilityPolicy.${policy}.description`),
          }))}
          onValueChange={(unknown_eligibility_policy) => patch({ unknown_eligibility_policy })}
        />
      </Section>

      <Section title={t('preferences.weightsTitle')}>
        <p className="text-sm text-slate-700">{t('preferences.weightsIntro')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          {MATCH_WEIGHT_KEYS.map((key) => (
            <TextField
              key={key}
              label={t(`matchWeight.${key}`)}
              description={t('preferences.weightDefault', {
                value: DEFAULT_PREFERENCES.match_weights[key],
              })}
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={numbers.weights[key]}
              error={fieldError(serverFields, key)}
              onChange={(event) =>
                setNumbers({
                  ...numbers,
                  weights: { ...numbers.weights, [key]: event.currentTarget.value },
                })
              }
            />
          ))}
        </div>
        <p
          className={`text-sm font-medium ${weightsOk ? 'text-emerald-800' : 'text-rose-700'}`}
          data-testid="weight-sum"
          data-valid={String(weightsOk)}
          role={weightsOk ? undefined : 'alert'}
        >
          {weightSum === null
            ? t('preferences.weightsNotNumeric')
            : t('preferences.weightsSum', { sum: formatNumber(locale, weightSum) })}
          {weightsOk ? '' : ` ${t('preferences.weightsMustSum')}`}
        </p>
        {errorFor('match_weights') && weightsOk ? (
          <p role="alert" className="text-sm font-medium text-rose-700">
            {errorFor('match_weights')}
          </p>
        ) : null}
        <p className="text-xs text-slate-600">{t('preferences.weightsStaleNote')}</p>
      </Section>

      <Section title={t('preferences.cvTitle')}>
        <Select
          label={t('preferences.cv_language')}
          description={t('locale.factsNote')}
          value={config.cv_language}
          error={errorFor('cv_language')}
          options={SUPPORTED_LOCALES.map((value) => ({
            value,
            label: t(value === 'es' ? 'locale.es' : 'locale.en'),
          }))}
          onChange={(event) =>
            patch({ cv_language: event.currentTarget.value as Preferences['cv_language'] })
          }
        />
        <Select
          label={t('preferences.cv_template')}
          value={config.cv_template}
          error={errorFor('cv_template')}
          options={CV_TEMPLATES.map((template) => ({
            value: template,
            label: t(`cvTemplate.${template}`),
          }))}
          onChange={(event) =>
            patch({ cv_template: event.currentTarget.value as Preferences['cv_template'] })
          }
        />
        <RadioGroup<Preferences['resume_mode']>
          legend={t('preferences.resume_mode')}
          name="resume_mode"
          value={config.resume_mode}
          error={errorFor('resume_mode')}
          options={RESUME_MODES.map((mode) => ({
            value: mode,
            label: t(`resumeMode.${mode}`),
            description: t(`resumeMode.${mode}.description`),
          }))}
          onValueChange={(resume_mode) => patch({ resume_mode })}
        />
      </Section>

      <Section title={t('preferences.limitsTitle')}>
        <p className="text-sm text-slate-700">{t('preferences.limitsIntro')}</p>
        <TextField
          label={t('preferences.scan_interval_hours')}
          description={t('preferences.pilotDefault', {
            value: formatNumber(locale, DEFAULT_PREFERENCES.scan_interval_hours),
          })}
          type="number"
          min={1}
          max={168}
          inputMode="numeric"
          value={numbers.scan_interval_hours}
          error={errorFor('scan_interval_hours')}
          onChange={(event) =>
            setNumbers({ ...numbers, scan_interval_hours: event.currentTarget.value })
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {NUMERIC_LIMIT_KEYS.map((key) => (
            <TextField
              key={key}
              label={t(`limit.${key}`)}
              description={t('preferences.pilotDefault', {
                value: formatNumber(locale, DEFAULT_OPERATIONAL_LIMITS[key]),
              })}
              type="number"
              min={key === 'ai_requests_per_day' || key === 'fill_attempts_per_day' ? 0 : 1}
              inputMode="numeric"
              value={numbers.limits[key]}
              error={errorFor(key)}
              onChange={(event) =>
                setNumbers({
                  ...numbers,
                  limits: { ...numbers.limits, [key]: event.currentTarget.value },
                })
              }
            />
          ))}
        </div>
        <Checkbox
          label={t('limit.consented_evidence_capture')}
          description={t('preferences.pilotDefault', {
            value: t(
              DEFAULT_OPERATIONAL_LIMITS.consented_evidence_capture ? 'common.yes' : 'common.no',
            ),
          })}
          checked={config.limits.consented_evidence_capture}
          error={errorFor('consented_evidence_capture')}
          onChange={(event) =>
            patch({
              limits: { ...config.limits, consented_evidence_capture: event.currentTarget.checked },
            })
          }
        />
        <Checkbox
          label={t('limit.raw_logs')}
          description={t('preferences.pilotDefault', {
            value: t(DEFAULT_OPERATIONAL_LIMITS.raw_logs ? 'common.yes' : 'common.no'),
          })}
          checked={config.limits.raw_logs}
          error={errorFor('raw_logs')}
          onChange={(event) =>
            patch({ limits: { ...config.limits, raw_logs: event.currentTarget.checked } })
          }
        />
      </Section>

      <Section title={t('preferences.promptTitle')}>
        <TextArea
          label={t('preferences.prompt_style_suffix')}
          description={t('preferences.promptStyleHint')}
          rows={4}
          maxLength={1000}
          value={config.prompt_style_suffix ?? ''}
          error={errorFor('prompt_style_suffix')}
          onChange={(event) => patch({ prompt_style_suffix: event.currentTarget.value })}
        />
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          busy={saving}
          busyLabel={t('preferences.saving')}
          disabled={!weightsOk}
        >
          {t('preferences.save')}
        </Button>
        {weightsOk ? null : (
          <span className="text-sm text-rose-700">{t('preferences.saveBlocked')}</span>
        )}
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function CheckboxSet({
  legend,
  description,
  options,
  selected,
  error,
  onChange,
}: {
  readonly legend: string;
  readonly description?: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly selected: readonly string[];
  readonly error: string | null;
  readonly onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-sm font-medium text-slate-800">{legend}</legend>
      {description ? <p className="text-sm text-slate-600">{description}</p> : null}
      <div className="flex flex-wrap gap-4">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            onChange={(event) =>
              onChange(
                event.currentTarget.checked
                  ? [...selected, option.value]
                  : selected.filter((value) => value !== option.value),
              )
            }
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
