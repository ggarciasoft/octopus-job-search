import { Callout } from '@job-getter/ui';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CapabilityPanel } from '../components/CapabilityPanel';
import { ImplementationStatusLink } from '../components/ImplementationStatusLink';
import { StatusLegend } from '../components/StatusLegend';
import { useTranslation } from '../i18n/I18nProvider';
import { formatCurrency, formatNumber } from '../i18n/format';

export function DashboardPage() {
  const { state } = useAuth();
  const { t, locale } = useTranslation();

  if (state.status !== 'authenticated') return null;
  const { me } = state;
  const { usage, workspace, user } = me;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('dashboard.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('dashboard.intro')}</p>
      </header>

      <CapabilityPanel capabilities={me.capabilities} />

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">{t('dashboard.usageTitle')}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Entry
            term={t('usage.aiRequests')}
            value={t('usage.aiRequestsValue', {
              used: formatNumber(locale, usage.ai_requests_today),
              limit: formatNumber(locale, usage.ai_requests_per_day_limit),
            })}
          />
          <Entry
            term={t('usage.cost')}
            value={
              // A null measured cost is "unknown", never zero: no rate card
              // means the cost was not measured (contracts/schemas/auth.ts).
              usage.measured_cost_today === null
                ? t('usage.costUnknown')
                : formatCurrency(locale, usage.measured_cost_today, usage.currency)
            }
          />
          <Entry
            term={t('usage.inputTokens')}
            value={formatNumber(locale, usage.input_tokens_today)}
          />
          <Entry
            term={t('usage.outputTokens')}
            value={formatNumber(locale, usage.output_tokens_today)}
          />
          <Entry
            term={t('usage.budget')}
            value={
              usage.daily_cost_budget === null
                ? t('usage.budgetNone')
                : formatCurrency(locale, usage.daily_cost_budget, usage.currency)
            }
          />
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">{t('dashboard.workspaceTitle')}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Account identifiers are user data: rendered verbatim, never translated. */}
          <Entry term={t('workspace.email')} value={user.email} />
          <Entry term={t('workspace.mode')} value={t(`mode.${workspace.mode}`)} />
          <Entry term={t('workspace.role')} value={t('role.owner')} />
          <Entry
            term={t('workspace.locale')}
            value={t(workspace.locale === 'es' ? 'locale.es' : 'locale.en')}
          />
          <Entry term={t('workspace.id')} value={workspace.id} mono />
        </dl>
        <p className="text-sm text-slate-600">{t('locale.factsNote')}</p>
      </section>

      <Callout tone="info" title={t('common.implementationStatus')} live={false}>
        <p>{t('dashboard.statusIntro')}</p>
        <ImplementationStatusLink />
        <p className="text-sm">
          <Link
            to="/diagnostics"
            className="text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            {t('diagnostics.title')}
          </Link>
        </p>
      </Callout>

      <StatusLegend />
    </div>
  );
}

function Entry({
  term,
  value,
  mono = false,
}: {
  readonly term: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-600">{term}</dt>
      <dd className={`mt-1 text-sm text-slate-900 ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
