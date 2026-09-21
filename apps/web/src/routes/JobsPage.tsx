import {
  ALL_JOB_STATUSES,
  type JobStatus,
  type JobView,
  type JobsListQuery,
  type TriState,
} from '@job-getter/contracts';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Select,
  SkeletonRow,
  Table,
  TextField,
} from '@job-getter/ui';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { describeFailure } from '../api/errors';
import { JobStatusBadge } from '../components/DiscoveryBadges';
import { ErrorNotice } from '../components/ErrorNotice';
import { FreshnessCell, LocationsCell, SalaryCell } from '../discovery/JobCells';
import { MatchCell } from '../discovery/MatchViews';
import {
  ELIGIBILITY_VERDICT_LABEL,
  JOB_EMPLOYMENT_TYPE_LABEL,
  JOB_STATUS_LABEL,
} from '../discovery/labels';
import { useTranslation } from '../i18n/I18nProvider';
import { formatNumber } from '../i18n/format';

const PAGE_LIMIT = 25;

const LINK_CLASS =
  'text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

export interface JobFilters {
  readonly query: string;
  readonly status: JobStatus | '';
  readonly savedOnly: boolean;
  readonly includeExcluded: boolean;
  /** Empty string means "no threshold", which is not the same as zero. */
  readonly minScore: string;
  readonly eligible: TriState | '';
}

const NO_FILTERS: JobFilters = {
  query: '',
  status: '',
  savedOnly: false,
  includeExcluded: false,
  minScore: '',
  eligible: '',
};

/** The thresholds offered. Not free text: a slider of noise helps nobody. */
const MIN_SCORE_CHOICES = [50, 60, 70, 80, 90] as const;

/**
 * The list query from the filter form.
 *
 * `min_score` and `eligible` only ever match a job someone has checked. An
 * unchecked job is dropped rather than assumed to be a poor one, which is why
 * the form says so beneath the control instead of leaving the user to guess
 * where their jobs went.
 */
export function toListQuery(filters: JobFilters, cursor: string | undefined): JobsListQuery {
  return {
    limit: PAGE_LIMIT,
    ...(cursor === undefined ? {} : { cursor }),
    ...(filters.query.trim() === '' ? {} : { query: filters.query.trim() }),
    ...(filters.status === '' ? {} : { status: filters.status }),
    ...(filters.savedOnly ? { saved: true } : {}),
    ...(filters.includeExcluded ? { include_excluded: true } : {}),
    ...(filters.minScore === '' ? {} : { min_score: Number(filters.minScore) }),
    ...(filters.eligible === '' ? {} : { eligible: filters.eligible }),
  };
}

function hasActiveFilters(filters: JobFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.status !== '' ||
    filters.savedOnly ||
    filters.includeExcluded ||
    filters.minScore !== '' ||
    filters.eligible !== ''
  );
}

type JobsPage = { items: JobView[]; next_cursor: string | null };

export function JobsPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<JobFilters>(NO_FILTERS);
  const [applied, setApplied] = useState<JobFilters>(NO_FILTERS);
  const [rowError, setRowError] = useState<{
    readonly job: JobView;
    readonly error: unknown;
  } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const nowMs = Date.now();

  const queryKey = ['jobs', applied] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.listJobs({ query: toListQuery(applied, pageParam), signal }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const rows: JobView[] = (query.data?.pages ?? []).flatMap((page) => page.items);

  const onApply = (event: FormEvent) => {
    event.preventDefault();
    setApplied(draft);
  };

  const toggleSaved = async (job: JobView) => {
    setSavingId(job.id);
    setRowError(null);
    try {
      const updated = await api.patchJob({
        params: { id: job.id },
        body: { expected_revision: job.revision, saved: !job.saved },
      });
      queryClient.setQueryData<InfiniteData<JobsPage, string | undefined>>(queryKey, (data) =>
        data === undefined
          ? data
          : {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.map((item) => (item.id === updated.id ? updated : item)),
              })),
            },
      );
    } catch (caught) {
      setRowError({ job, error: caught });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('jobs.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('jobs.intro')}</p>
      </header>

      <form
        className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4"
        onSubmit={onApply}
        aria-label={t('jobs.filtersLegend')}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            label={t('jobs.query')}
            type="search"
            value={draft.query}
            onChange={(event) => setDraft({ ...draft, query: event.currentTarget.value })}
          />
          <Select
            label={t('jobs.status')}
            value={draft.status}
            options={[
              { value: '', label: t('jobs.statusAny') },
              ...ALL_JOB_STATUSES.map((status) => ({
                value: status,
                label: t(JOB_STATUS_LABEL[status]),
              })),
            ]}
            onChange={(event) =>
              setDraft({ ...draft, status: event.currentTarget.value as JobStatus | '' })
            }
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={t('jobs.minScore')}
            description={t('jobs.minScoreDescription')}
            value={draft.minScore}
            options={[
              { value: '', label: t('jobs.minScoreAny') },
              ...MIN_SCORE_CHOICES.map((score) => ({
                value: String(score),
                label: formatNumber(locale, score),
              })),
            ]}
            onChange={(event) => setDraft({ ...draft, minScore: event.currentTarget.value })}
          />
          <Select
            label={t('jobs.eligible')}
            value={draft.eligible}
            options={[
              { value: '', label: t('jobs.eligibleAny') },
              ...(['yes', 'no', 'unknown'] as const).map((verdict) => ({
                value: verdict,
                label: t(ELIGIBILITY_VERDICT_LABEL[verdict]),
              })),
            ]}
            onChange={(event) =>
              setDraft({ ...draft, eligible: event.currentTarget.value as TriState | '' })
            }
          />
        </div>
        <Checkbox
          label={t('jobs.savedOnly')}
          checked={draft.savedOnly}
          onChange={(event) => setDraft({ ...draft, savedOnly: event.currentTarget.checked })}
        />
        <Checkbox
          label={t('jobs.includeExcluded')}
          description={t('jobs.includeExcludedDescription')}
          checked={draft.includeExcluded}
          onChange={(event) => setDraft({ ...draft, includeExcluded: event.currentTarget.checked })}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary">
            {t('jobs.applyFilters')}
          </Button>
          <Button
            onClick={() => {
              setDraft(NO_FILTERS);
              setApplied(NO_FILTERS);
            }}
          >
            {t('jobs.clearFilters')}
          </Button>
        </div>
      </form>

      {query.isError ? (
        <ErrorNotice error={query.error} overrideMessage={t('jobs.loadFailed')} />
      ) : null}

      {rowError === null ? null : (
        <div className="flex flex-col gap-2">
          <ErrorNotice
            error={rowError.error}
            overrideMessage={t('jobs.updateFailed', { title: rowError.job.title })}
          />
          {describeFailure(rowError.error).isStale ? (
            <div>
              <Button onClick={() => void query.refetch()}>{t('jobs.reload')}</Button>
            </div>
          ) : null}
        </div>
      )}

      {query.isPending ? (
        <SkeletonRow label={t('jobs.loading')} columns={8} rows={4} />
      ) : (
        <Table<JobView>
          caption={t('jobs.caption')}
          captionHidden
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <div data-testid="jobs-empty">
              <EmptyState
                title={t('jobs.emptyTitle')}
                body={t('jobs.emptyBody')}
                suggestions={[
                  <Link key="boards" to="/discover" className={LINK_CLASS}>
                    {t('jobs.emptySuggestionBoards')}
                  </Link>,
                  t('jobs.emptySuggestionScan'),
                  ...(hasActiveFilters(applied) ? [t('jobs.emptySuggestionFilters')] : []),
                ]}
              />
            </div>
          }
          columns={[
            {
              key: 'job',
              header: t('jobs.columnJob'),
              rowHeader: true,
              cell: (row) => (
                <span className="flex flex-col gap-1" data-testid="job-row" data-job-id={row.id}>
                  {/* Title and company are the posting's words: verbatim. */}
                  <Link to={`/jobs/${row.id}`} className={LINK_CLASS}>
                    {row.title}
                  </Link>
                  <span className="text-sm font-normal text-slate-700">{row.company}</span>
                  <span className="flex flex-wrap gap-1">
                    {row.saved ? <Badge tone="info">{t('jobs.savedBadge')}</Badge> : null}
                    {row.excluded_reason === null ? null : (
                      <Badge tone="attention">
                        <span data-testid="excluded-reason">
                          {t('jobs.excluded', { reason: row.excluded_reason })}
                        </span>
                      </Badge>
                    )}
                    {row.possible_duplicates.length > 0 ? (
                      <Badge tone="warning" title={t('jobs.duplicatesFlagDescription')}>
                        <span data-testid="duplicates-flag">
                          {t('jobs.duplicatesFlag')} (
                          {formatNumber(locale, row.possible_duplicates.length)})
                        </span>
                      </Badge>
                    ) : null}
                  </span>
                </span>
              ),
            },
            {
              key: 'where',
              header: t('jobs.columnWhere'),
              cell: (row) => <LocationsCell job={row} />,
            },
            {
              key: 'type',
              header: t('jobs.columnType'),
              cell: (row) =>
                row.employment_type === null ? (
                  <span className="text-slate-600">{t('jobs.employmentTypeNotStated')}</span>
                ) : (
                  t(JOB_EMPLOYMENT_TYPE_LABEL[row.employment_type])
                ),
            },
            {
              key: 'salary',
              header: t('jobs.columnSalary'),
              cell: (row) => <SalaryCell salary={row.salary} />,
            },
            {
              key: 'status',
              header: t('jobs.columnStatus'),
              cell: (row) => <JobStatusBadge status={row.status} />,
            },
            {
              key: 'freshness',
              header: t('jobs.columnFreshness'),
              cell: (row) => <FreshnessCell job={row} nowMs={nowMs} />,
            },
            {
              key: 'match',
              header: t('jobs.columnMatch'),
              cell: (row) => <MatchCell match={row.match} />,
            },
            {
              key: 'sources',
              header: t('jobs.columnSources'),
              cell: (row) => (
                <span data-testid="sources-count">
                  {row.sources.length === 1
                    ? t('jobs.sourceOne')
                    : t('jobs.sourceMany', { count: formatNumber(locale, row.sources.length) })}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('jobs.columnActions'),
              cell: (row) => (
                <Button
                  size="sm"
                  busy={savingId === row.id}
                  busyLabel={t('jobs.saving')}
                  disabled={savingId !== null}
                  onClick={() => void toggleSaved(row)}
                >
                  {row.saved ? t('jobs.unsave') : t('jobs.save')}
                </Button>
              ),
            },
          ]}
        />
      )}

      {rows.length > 0 ? (
        <div className="flex items-center gap-3">
          {query.hasNextPage ? (
            <Button
              busy={query.isFetchingNextPage}
              busyLabel={t('jobs.loading')}
              onClick={() => void query.fetchNextPage()}
            >
              {t('action.loadMore')}
            </Button>
          ) : (
            <p className="text-sm text-slate-600">{t('jobs.endOfList')}</p>
          )}
          <Button onClick={() => void query.refetch()}>{t('action.refresh')}</Button>
        </div>
      ) : null}
    </div>
  );
}
