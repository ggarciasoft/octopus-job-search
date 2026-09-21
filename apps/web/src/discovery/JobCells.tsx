import {
  CLOSURE_RULES,
  type JobLocation,
  type JobSalary,
  type JobView,
} from '@job-getter/contracts';
import { Badge } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime, formatNumber } from '../i18n/format';
import { REMOTE_TYPE_LABEL } from './labels';
import { freshnessOf, salaryParts } from './presentation';

/**
 * Salary exactly as stated. A null salary is the "Salary unknown" badge in
 * the `unknown` tone — never zero, never a dash. A stated one shows the
 * numbers, then the currency code and period verbatim; a missing currency or
 * period says so rather than assuming one (no conversion, ever).
 */
export function SalaryCell({ salary }: { readonly salary: JobSalary | null }) {
  const { t, locale } = useTranslation();
  if (salary === null) {
    return (
      <span data-testid="salary-cell" data-salary="unknown">
        <Badge tone="unknown" title={t('jobs.salaryUnknownDescription')}>
          {t('jobs.salaryUnknown')}
        </Badge>
      </span>
    );
  }
  const parts = salaryParts(locale, salary);
  const period =
    parts.period === null ? t('jobs.salaryPeriodUnknown') : t(`salaryPeriod.${parts.period}`);
  const currency = parts.currency ?? t('jobs.salaryCurrencyUnknown');
  return (
    <span data-testid="salary-cell" data-salary="stated" title={salary.source_excerpt}>
      {parts.amount === null ? (
        // Neither bound stated: only the excerpt carries the information.
        <span className="text-slate-700">“{salary.source_excerpt}”</span>
      ) : (
        <>
          <span>{parts.amount}</span> <span data-testid="salary-currency">{currency}</span>{' '}
          <span data-testid="salary-period">{period}</span>
        </>
      )}
    </span>
  );
}

export function locationText(location: JobLocation): string {
  return [location.city, location.region, location.country].filter(Boolean).join(', ');
}

export function LocationsCell({
  job,
}: {
  readonly job: Pick<JobView, 'locations' | 'remote_type'>;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-col gap-1">
      {job.locations.length === 0 ? (
        <span className="text-slate-600">{t('jobs.locationNone')}</span>
      ) : (
        <span>{job.locations.map(locationText).filter(Boolean).join(' · ')}</span>
      )}
      <span
        className="text-xs text-slate-600"
        data-testid="remote-type"
        data-remote={job.remote_type}
      >
        {t(REMOTE_TYPE_LABEL[job.remote_type])}
      </span>
    </span>
  );
}

/**
 * Freshness: last seen, plus the recheck flag when the last successful fetch
 * is older than `CLOSURE_RULES.recheckBeforePacketHours` or absent
 * (05_DISCOVERY_CONNECTORS.md, "Freshness and closure").
 */
export function FreshnessCell({
  job,
  nowMs,
}: {
  readonly job: Pick<JobView, 'last_seen_at' | 'last_fetched_at'>;
  readonly nowMs: number;
}) {
  const { t, locale } = useTranslation();
  const freshness = freshnessOf(job, nowMs);
  const hours = formatNumber(locale, CLOSURE_RULES.recheckBeforePacketHours);
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-xs text-slate-700">
        {t('jobs.lastSeen', {
          when: formatDateTime(locale, job.last_seen_at) ?? t('common.notReported'),
        })}
      </span>
      {freshness === 'fresh' ? (
        <span className="text-xs text-slate-600" data-testid="fresh-flag">
          {t('jobs.fresh', { hours })}
        </span>
      ) : (
        <Badge
          tone="warning"
          title={freshness === 'stale' ? t('jobs.staleDescription', { hours }) : undefined}
        >
          <span data-testid="stale-flag" data-freshness={freshness}>
            {freshness === 'stale' ? t('jobs.stale') : t('jobs.neverFetched')}
          </span>
        </Badge>
      )}
    </span>
  );
}
