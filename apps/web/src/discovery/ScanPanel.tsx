import type { ScanCounts, ScanView, SourceView } from '@job-getter/contracts';
import { Button, Callout, Spinner } from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ScanStatusBadge } from '../components/DiscoveryBadges';
import { ErrorNotice } from '../components/ErrorNotice';
import { ACTIVE_POLL_INTERVAL_MS } from '../hooks/useTaskPolling';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime, formatNumber } from '../i18n/format';
import type { MessageKey } from '../i18n/messages';
import { CONNECTOR_LABEL, FETCH_WARNING_LABEL, isScanInFlight } from './labels';
import { presentScan, readScanWarnings } from './presentation';

const LINK_CLASS =
  'text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

/** Display order of the contract's `ScanCounts`; total over its keys. */
const COUNT_LABELS: Record<keyof ScanCounts, MessageKey> = {
  fetched: 'scan.count.fetched',
  created: 'scan.count.created',
  updated: 'scan.count.updated',
  unchanged: 'scan.count.unchanged',
  closed: 'scan.count.closed',
  pages: 'scan.count.pages',
};
const COUNT_ORDER = Object.keys(COUNT_LABELS) as (keyof ScanCounts)[];

export interface ScanPanelProps {
  /** A scan id or the task id `scanSource` returned; `GET /scans/:id` takes either. */
  readonly scanId: string | null;
  readonly sources: readonly SourceView[] | undefined;
  readonly workerOffline: boolean;
  readonly onStop: () => void;
  /** Fired once per scan when it reaches a final status, so the boards refresh. */
  readonly onFinished: () => void;
}

/**
 * Follows one scan: status, whether the snapshot was complete, counts, error.
 *
 * Two things a user must never misread here. A partial snapshot closes
 * nothing, and the panel says so in words. And a re-scan the board answered
 * with 304 is stored as `partial` with zero counts — technically incomplete,
 * because nothing was re-fetched — but it is "unchanged since the last scan",
 * not a half-finished scan; the `NOT_MODIFIED` warning on the task result is
 * what tells the two apart, so the task is read once the scan is final.
 */
export function ScanPanel({ scanId, sources, workerOffline, onStop, onFinished }: ScanPanelProps) {
  const api = useApi();
  const { t } = useTranslation();

  const scanQuery = useQuery({
    queryKey: ['scan', scanId],
    queryFn: ({ signal }) => api.getScan({ params: { id: scanId as string }, signal }),
    enabled: scanId !== null,
    refetchInterval: (query) => {
      const scan = query.state.data;
      return scan !== undefined && isScanInFlight(scan.status) ? ACTIVE_POLL_INTERVAL_MS : false;
    },
  });
  const scan: ScanView | undefined = scanQuery.data;
  const finished = scan !== undefined && !isScanInFlight(scan.status);

  const taskQuery = useQuery({
    queryKey: ['scan-task', scan?.task_id ?? null],
    queryFn: ({ signal }) => api.getTask({ params: { id: scan?.task_id as string }, signal }),
    enabled: finished && scan.task_id !== null,
  });
  const warnings = taskQuery.data === undefined ? [] : readScanWarnings(taskQuery.data.result);
  // Until the task has been read, a partial scan cannot be told apart from an
  // unchanged one, so neither message is shown yet.
  const warningsKnown =
    !finished || scan.task_id === null || taskQuery.data !== undefined || taskQuery.isError;

  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (!finished || scan === undefined) return;
    if (notified.current === scan.id) return;
    notified.current = scan.id;
    onFinished();
  }, [finished, scan, onFinished]);

  const source = scan === undefined ? undefined : sources?.find((s) => s.id === scan.source_id);
  const boardLabel =
    source === undefined
      ? (scan?.source_id ?? '')
      : `${t(CONNECTOR_LABEL[source.connector])} · ${source.board_key}`;

  return (
    <section
      className="flex flex-col gap-4 rounded border border-slate-200 bg-white p-4"
      data-testid="scan-panel"
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t('scan.title')}</h2>
        <p className="mt-1 text-sm text-slate-700">{t('scan.intro')}</p>
      </div>

      {scanId === null ? (
        <p className="text-sm text-slate-700">{t('scan.none')}</p>
      ) : scanQuery.isPending ? (
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <Spinner label={t('scan.loading')} />
          <span>{t('scan.loading')}</span>
        </div>
      ) : scan === undefined ? (
        <div className="flex flex-col gap-2">
          <ErrorNotice error={scanQuery.error} overrideMessage={t('scan.loadFailed')} />
          <div className="flex gap-2">
            <Button onClick={() => void scanQuery.refetch()}>{t('action.retry')}</Button>
            <Button onClick={onStop}>{t('scan.stopFollowing')}</Button>
          </div>
        </div>
      ) : (
        <ScanDetails
          scan={scan}
          boardLabel={boardLabel}
          jobCount={source?.job_count ?? null}
          warnings={warnings}
          warningsKnown={warningsKnown}
          workerOffline={workerOffline}
          onStop={onStop}
        />
      )}
    </section>
  );
}

function ScanDetails({
  scan,
  boardLabel,
  jobCount,
  warnings,
  warningsKnown,
  workerOffline,
  onStop,
}: {
  readonly scan: ScanView;
  readonly boardLabel: string;
  readonly jobCount: number | null;
  readonly warnings: ReturnType<typeof readScanWarnings>;
  readonly warningsKnown: boolean;
  readonly workerOffline: boolean;
  readonly onStop: () => void;
}) {
  const { t, locale } = useTranslation();
  const presentation = presentScan(scan, warnings);
  return (
    <div className="flex flex-col gap-3" data-scan-presentation={presentation}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-slate-900">
            {t('scan.heading', { id: scan.id })}
          </span>
          <span className="text-xs text-slate-600">
            {t('scan.forBoard', { board: boardLabel })}
          </span>
        </div>
        <ScanStatusBadge status={scan.status} />
      </div>

      {scan.status === 'queued' && workerOffline ? (
        <Callout tone="warning" title={t('diagnostics.queuedNoWorkerTitle')}>
          <p data-testid="scan-queued-no-worker">{t('scan.queuedNoWorker')}</p>
        </Callout>
      ) : null}

      {presentation === 'in_flight' ? (
        <p className="text-sm text-slate-700">{t('scan.snapshotPending')}</p>
      ) : null}
      {presentation === 'complete' ? (
        <p className="text-sm text-slate-700" data-testid="scan-complete">
          {t('scan.snapshotComplete')}
        </p>
      ) : null}
      {(presentation === 'partial' || presentation === 'unchanged') && !warningsKnown ? (
        <p className="text-sm text-slate-700">{t('scan.warningsPending')}</p>
      ) : null}
      {presentation === 'unchanged' && warningsKnown ? (
        <Callout tone="info" title={t('scan.unchangedTitle')} live={false}>
          <p data-testid="scan-unchanged">
            {t('scan.unchangedBody', {
              count: jobCount === null ? t('common.notReported') : formatNumber(locale, jobCount),
            })}
          </p>
        </Callout>
      ) : null}
      {presentation === 'partial' && warningsKnown ? (
        <Callout tone="warning" title={t('scan.snapshotPartialTitle')}>
          <p data-testid="scan-partial">{t('scan.snapshotPartialBody')}</p>
        </Callout>
      ) : null}

      {scan.error_code !== null || scan.error_message !== null ? (
        <Callout tone="error" title={t('scan.errorTitle')}>
          {scan.error_code === null ? null : (
            <p>
              <span className="font-medium">{t('diagnostics.failureCode')}: </span>
              <code className="font-mono" data-testid="scan-error-code">
                {scan.error_code}
              </code>
            </p>
          )}
          {scan.error_message === null ? null : (
            <p data-testid="scan-error-message">
              <span className="font-medium">{t('diagnostics.failureMessage')}: </span>
              {scan.error_message}
            </p>
          )}
        </Callout>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold text-slate-900">{t('scan.countsTitle')}</h3>
        <dl className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {COUNT_ORDER.map((key) => (
            <div key={key} className="rounded border border-slate-200 bg-slate-50 p-2">
              <dt className="text-xs uppercase tracking-wide text-slate-600">
                {t(COUNT_LABELS[key])}
              </dt>
              <dd className="text-sm text-slate-900" data-testid={`scan-count-${key}`}>
                {formatNumber(locale, scan.counts[key])}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {warnings.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{t('scan.notesTitle')}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <span>{t(FETCH_WARNING_LABEL[warning.code])}</span>{' '}
                <code className="font-mono text-xs">{warning.code}</code>
                {/* The worker's own message is data: verbatim. */}
                {warning.message ? <span className="block text-xs">{warning.message}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-600">{t('scan.startedAt')}</dt>
          <dd>{formatDateTime(locale, scan.started_at) ?? t('scan.notYet')}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-600">
            {t('scan.completedAt')}
          </dt>
          <dd>{formatDateTime(locale, scan.completed_at) ?? t('scan.notYet')}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <Link to="/jobs" className={LINK_CLASS}>
          {t('scan.viewJobs')}
        </Link>
        <Button size="sm" onClick={onStop}>
          {t('scan.stopFollowing')}
        </Button>
      </div>
    </div>
  );
}
