import type { TaskState, TaskView } from '@job-getter/contracts';
import { Badge, Button, EmptyState, SkeletonRow, Table } from '@job-getter/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ErrorNotice } from '../components/ErrorNotice';
import { TaskStateBadge } from '../components/TaskLifecycle';
import { pollIntervalFor } from '../hooks/useTaskPolling';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime, formatNumber } from '../i18n/format';

const PAGE_LIMIT = 25;

export function TasksPage() {
  const api = useApi();
  const { t, locale } = useTranslation();

  const query = useInfiniteQuery({
    queryKey: ['tasks', PAGE_LIMIT],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.listTasks({
        query: pageParam === undefined ? { limit: PAGE_LIMIT } : { cursor: pageParam, limit: PAGE_LIMIT },
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    // Same two cadences as `useTaskPolling`: 2 s while anything is running,
    // 15 s when the list is idle (02_ARCHITECTURE.md).
    refetchInterval: (activeQuery) => {
      const states: TaskState[] = (activeQuery.state.data?.pages ?? []).flatMap((page) =>
        page.items.map((item) => item.state),
      );
      return pollIntervalFor(states);
    },
  });

  const rows: TaskView[] = (query.data?.pages ?? []).flatMap((page) => page.items);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('tasks.title')}</h1>
        <p className="text-sm text-slate-700">{t('tasks.intro')}</p>
      </header>

      {query.isError ? (
        <ErrorNotice error={query.error} overrideMessage={t('tasks.loadFailed')} />
      ) : null}

      {query.isPending ? (
        <SkeletonRow label={t('tasks.loading')} columns={5} rows={4} />
      ) : (
        <Table<TaskView>
          caption={t('tasks.caption')}
          rows={rows}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title={t('tasks.emptyTitle')}
              body={t('tasks.emptyBody')}
              suggestions={[
                <Link
                  key="diagnostics"
                  to="/diagnostics"
                  className="text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                >
                  {t('tasks.emptySuggestionDiagnostics')}
                </Link>,
                t('tasks.emptySuggestionWorker'),
              ]}
            />
          }
          columns={[
            {
              key: 'type',
              header: t('tasks.columnType'),
              rowHeader: true,
              // Contract identifier, not prose: never translated.
              cell: (row) => <code className="font-mono text-xs">{row.type}</code>,
            },
            {
              key: 'state',
              header: t('tasks.columnState'),
              cell: (row) => (
                <span className="flex flex-col items-start gap-1">
                  <TaskStateBadge state={row.state} />
                  {row.cancel_requested ? (
                    <Badge tone="warning">{t('tasks.cancelRequestedShort')}</Badge>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'progress',
              header: t('tasks.columnProgress'),
              cell: (row) =>
                row.progress === null ? (
                  <span className="text-slate-600">{t('common.notReported')}</span>
                ) : (
                  <span>
                    {row.progress.stage} · {formatNumber(locale, row.progress.percent)}%
                  </span>
                ),
            },
            {
              key: 'attempt',
              header: t('tasks.columnAttempt'),
              cell: (row) =>
                `${formatNumber(locale, row.attempt)} / ${formatNumber(locale, row.max_attempts)}`,
            },
            {
              key: 'created',
              header: t('tasks.columnCreated'),
              cell: (row) => formatDateTime(locale, row.created_at) ?? t('common.notReported'),
            },
            {
              key: 'updated',
              header: t('tasks.columnUpdated'),
              cell: (row) => formatDateTime(locale, row.updated_at) ?? t('common.notReported'),
            },
          ]}
        />
      )}

      {rows.length > 0 ? (
        <div className="flex items-center gap-3">
          {query.hasNextPage ? (
            <Button
              busy={query.isFetchingNextPage}
              busyLabel={t('tasks.loading')}
              onClick={() => void query.fetchNextPage()}
            >
              {t('action.loadMore')}
            </Button>
          ) : (
            <p className="text-sm text-slate-600">{t('tasks.endOfList')}</p>
          )}
          <Button onClick={() => void query.refetch()}>{t('action.refresh')}</Button>
        </div>
      ) : null}
    </div>
  );
}
