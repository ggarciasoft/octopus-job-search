import type { ExportWorkspaceResult, TaskView } from '@job-getter/contracts';
import { Button, Callout, Spinner } from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { IdempotentIntent } from '../../api/idempotency';
import { ErrorNotice } from '../../components/ErrorNotice';
import { useTranslation } from '../../i18n/I18nProvider';
import { formatBytes } from '../../i18n/format';

/**
 * Settings → Privacy (M4, PR14).
 *
 * Two things this screen has to be honest about.
 *
 * **What the archive leaves out.** The manifest lists it, and so does this
 * page, before the download link rather than after it. A user who exports
 * their data and later finds no provider key should have been told, not left
 * to wonder whether the export was truncated.
 *
 * **What is not built.** Workspace deletion is a later milestone. There is no
 * delete button here that would 404, and no "coming soon" control that looks
 * pressable — only a sentence saying where it is and where the record of that
 * lives.
 */
const EXCLUSION_LABEL = {
  provider_secrets: 'privacy.excluded.providerSecrets',
  sessions: 'privacy.excluded.sessions',
  device_tokens: 'privacy.excluded.deviceTokens',
  browser_profile: 'privacy.excluded.browserProfile',
  operator_infrastructure: 'privacy.excluded.operatorInfrastructure',
  staging_files: 'privacy.excluded.stagingFiles',
} as const;

export function PrivacyPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const intent = useRef(new IdempotentIntent());

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: ({ signal }) => api.getTask({ params: { id: taskId as string }, signal }),
    enabled: taskId !== null,
  });

  const task: TaskView | undefined = taskQuery.data;
  const result = task?.state === 'succeeded' ? (task.result as ExportWorkspaceResult | null) : null;

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const accepted = await api.exportWorkspace({
        idempotencyKey: intent.current.keyFor({ export: true }),
      });
      intent.current.complete();
      setTaskId(accepted.task_id);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="privacy-page">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('privacy.title')}</h2>
        <p className="max-w-3xl text-sm text-slate-700">{t('privacy.intro')}</p>
      </section>

      <section className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">{t('privacy.exportHeading')}</h3>
        <p className="text-sm text-slate-700">{t('privacy.exportBody')}</p>

        {/* Stated before the button, not after the download. */}
        <div>
          <p className="text-sm font-medium">{t('privacy.excludedHeading')}</p>
          <ul className="list-disc pl-5 text-sm text-slate-700" data-testid="export-exclusions">
            {(Object.keys(EXCLUSION_LABEL) as (keyof typeof EXCLUSION_LABEL)[]).map((key) => (
              <li key={key}>{t(EXCLUSION_LABEL[key])}</li>
            ))}
          </ul>
        </div>

        <div>
          <Button type="button" onClick={() => void runExport()} disabled={busy}>
            {busy ? t('privacy.exporting') : t('privacy.export')}
          </Button>
        </div>

        {error === null ? null : <ErrorNotice error={error} />}
        {taskId !== null && task === undefined ? <Spinner label={t('common.loading')} /> : null}

        {result === null ? null : (
          <Callout tone="success" title={t('privacy.exportReadyTitle')}>
            <p data-testid="export-summary">
              {t('privacy.exportReady', {
                size: formatBytes(locale, result.bytes),
                files: String(result.manifest.files.length),
              })}
            </p>
            <p className="mt-2">
              <a
                className="underline"
                data-testid="export-download"
                href={`/api/v1/files/${result.file_id}/download`}
              >
                {t('privacy.download')}
              </a>
            </p>
            {/* The checksum, so a person can verify the file they kept is the
                file the server made. */}
            <p className="mt-2 break-all font-mono text-xs" data-testid="export-sha256">
              {result.sha256}
            </p>
          </Callout>
        )}

        {task?.state === 'failed' ? (
          <Callout tone="error" title={t('privacy.exportFailedTitle')}>
            <p>{task.error?.message ?? t('privacy.exportFailedBody')}</p>
          </Callout>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('privacy.deleteHeading')}</h3>
        {/* No button. A control that 404s is worse than a sentence. */}
        <p className="max-w-3xl text-sm text-slate-700" data-testid="delete-not-built">
          {t('privacy.deleteBody')}
        </p>
      </section>
    </div>
  );
}
