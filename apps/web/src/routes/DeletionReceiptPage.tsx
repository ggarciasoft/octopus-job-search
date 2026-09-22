import type { WorkspaceDeletionView } from '@job-getter/contracts';
import { Callout, Spinner } from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ErrorNotice } from '../components/ErrorNotice';
import { PublicShell } from '../components/PublicShell';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';

/** How often an unfinished erasure is re-read. The scheduler retries once a minute. */
const POLL_MS = 3_000;

/**
 * The deletion receipt (AT26: "show completion or failure").
 *
 * Public, because deleting the workspace ended the session that asked. The
 * receipt names nobody, so there is nothing here a stranger could learn from
 * it, and its id is only known to the browser that made the request.
 *
 * The answer the DELETE gave is shown at once, from navigation state, and the
 * receipt is only polled while it still says `erasing`.
 */
export function DeletionReceiptPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const { id = '' } = useParams();
  const location = useLocation();
  const initial = (location.state as { receipt?: WorkspaceDeletionView } | null)?.receipt;

  const query = useQuery({
    queryKey: ['workspace-deletion', id],
    queryFn: ({ signal }) => api.getWorkspaceDeletion({ params: { id }, signal }),
    initialData: initial?.deletion_id === id ? initial : undefined,
    refetchInterval: (current) => (current.state.data?.state === 'erasing' ? POLL_MS : false),
  });
  const receipt = query.data;

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold text-slate-900">{t('deletion.title')}</h1>

      {receipt === undefined && query.error === null ? (
        <Spinner label={t('common.loading')} />
      ) : null}
      {receipt === undefined && query.error !== null ? <ErrorNotice error={query.error} /> : null}

      {receipt?.state === 'erasing' ? (
        <Callout tone="info" title={t('deletion.erasingTitle')}>
          <p data-testid="deletion-erasing">{t('deletion.erasingBody')}</p>
        </Callout>
      ) : null}

      {receipt?.state === 'completed' ? (
        <Callout tone="success" title={t('deletion.completedTitle')}>
          <p data-testid="deletion-completed">
            {t('deletion.completedBody', {
              files: String(receipt.files_erased),
              when: formatDateTime(locale, receipt.completed_at) ?? '',
            })}
          </p>
        </Callout>
      ) : null}

      {receipt?.state === 'failed' ? (
        <Callout tone="error" title={t('deletion.failedTitle')}>
          <p data-testid="deletion-failed">{t('deletion.failedBody')}</p>
        </Callout>
      ) : null}

      {receipt === undefined ? null : (
        <p className="text-sm text-slate-700">
          {t('deletion.reference')}{' '}
          <span className="break-all font-mono text-xs" data-testid="deletion-id">
            {receipt.deletion_id}
          </span>
        </p>
      )}

      {receipt?.state === 'completed' && receipt.setup_reopened ? (
        <Link
          to="/setup"
          className="text-sm text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          {t('deletion.setupAgain')}
        </Link>
      ) : null}
    </PublicShell>
  );
}
