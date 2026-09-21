import { Callout } from '@job-getter/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useApi } from '../api/ApiProvider';
import { useSession } from '../auth/AuthProvider';
import { BoardsPanel } from '../discovery/BoardsPanel';
import { ImportPanel } from '../discovery/ImportPanel';
import { ScanPanel } from '../discovery/ScanPanel';
import { useTranslation } from '../i18n/I18nProvider';

export const SOURCES_QUERY_KEY = ['sources'] as const;

/**
 * Discover: the board registry, "scan now", one followed scan, and manual
 * import. The coverage note at the top is not decoration: 01_PRODUCT_
 * REQUIREMENTS.md, "Explicit boundaries" — pilot discovery scans configured
 * boards and user-provided URLs, never the whole internet.
 */
export function DiscoverPage() {
  const api = useApi();
  const { t } = useTranslation();
  const session = useSession();
  const queryClient = useQueryClient();

  const discoveryUnavailable = session !== null && !session.capabilities.job_discovery;
  const workerOffline = session !== null && !session.capabilities.worker_online;

  const sourcesQuery = useQuery({
    queryKey: SOURCES_QUERY_KEY,
    queryFn: ({ signal }) => api.listSources({ signal }),
  });

  const [followedScanId, setFollowedScanId] = useState<string | null>(null);

  const refreshSources = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY });
  }, [queryClient]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('discover.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('discover.intro')}</p>
      </header>

      <Callout tone="info" title={t('discover.coverageTitle')} live={false}>
        <p data-testid="coverage-note">{t('discover.coverageBody')}</p>
      </Callout>

      {discoveryUnavailable ? (
        <Callout tone="warning" title={t('discover.unavailableTitle')}>
          <p>{t('discover.unavailableBody')}</p>
        </Callout>
      ) : null}

      {workerOffline ? (
        <Callout tone="warning" title={t('dashboard.workerTitle')}>
          <p>{t('discover.workerOfflineWarning')}</p>
        </Callout>
      ) : null}

      <BoardsPanel
        sources={sourcesQuery.data?.items}
        isLoading={sourcesQuery.isPending}
        loadError={sourcesQuery.error}
        discoveryUnavailable={discoveryUnavailable}
        onChanged={refreshSources}
        onFollowScan={setFollowedScanId}
      />

      <ScanPanel
        scanId={followedScanId}
        sources={sourcesQuery.data?.items}
        workerOffline={workerOffline}
        onStop={() => setFollowedScanId(null)}
        onFinished={refreshSources}
      />

      <ImportPanel discoveryUnavailable={discoveryUnavailable} workerOffline={workerOffline} />
    </div>
  );
}
