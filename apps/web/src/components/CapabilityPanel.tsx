import type { Capabilities } from '@job-getter/contracts';
import { Badge, Callout } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';

/**
 * Feature flags other than the worker, in display order.
 *
 * Typed as a total record over the contract's `Capabilities` keys, so adding a
 * flag to `packages/contracts/src/schemas/auth.ts` breaks this file until the
 * dashboard explains the new flag. That is deliberate: a capability the UI does
 * not mention is a capability the user cannot reason about.
 */
const FEATURE_LABELS: Record<
  Exclude<keyof Capabilities, 'implemented_task_types' | 'worker_online'>,
  { readonly label: MessageKey; readonly description: MessageKey }
> = {
  ai_provider_configured: {
    label: 'capability.ai_provider_configured',
    description: 'capability.ai_provider_configured.description',
  },
  profile_import: {
    label: 'capability.profile_import',
    description: 'capability.profile_import.description',
  },
  job_discovery: {
    label: 'capability.job_discovery',
    description: 'capability.job_discovery.description',
  },
  cv_generation: {
    label: 'capability.cv_generation',
    description: 'capability.cv_generation.description',
  },
  applications: {
    label: 'capability.applications',
    description: 'capability.applications.description',
  },
  browser_filling: {
    label: 'capability.browser_filling',
    description: 'capability.browser_filling.description',
  },
  extension: { label: 'capability.extension', description: 'capability.extension.description' },
};

const FEATURE_ORDER = Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[];

export interface CapabilityPanelProps {
  readonly capabilities: Capabilities;
}

/**
 * The honest capability panel: what works and what does not, driven entirely by
 * the flags the API reports. Nothing is inferred and nothing is hidden — an
 * unavailable feature is listed as unavailable rather than omitted, so the user
 * can tell "not built" apart from "I have not found it yet".
 */
export function CapabilityPanel({ capabilities }: CapabilityPanelProps) {
  const { t } = useTranslation();
  const workerOnline = capabilities.worker_online;

  return (
    <section className="flex flex-col gap-4">
      <Callout
        tone={workerOnline ? 'success' : 'warning'}
        title={t('dashboard.workerTitle')}
        live={false}
      >
        <p data-testid="worker-status" data-online={String(workerOnline)}>
          {workerOnline ? t('dashboard.workerOnline') : t('dashboard.workerOffline')}
        </p>
        {workerOnline ? null : <p>{t('dashboard.workerOfflineDetail')}</p>}
      </Callout>

      <div>
        <h2 className="text-base font-semibold text-slate-900">
          {t('dashboard.capabilitiesTitle')}
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {FEATURE_ORDER.map((key) => {
            const available = capabilities[key];
            const entry = FEATURE_LABELS[key];
            return (
              <li
                key={key}
                data-testid={`capability-${key}`}
                data-available={String(available)}
                className="flex flex-col gap-1 rounded border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-900">{t(entry.label)}</span>
                  <Badge tone={available ? 'success' : 'neutral'}>
                    {available
                      ? t('dashboard.capabilityAvailable')
                      : t('dashboard.capabilityUnavailable')}
                  </Badge>
                </div>
                <p className="text-sm text-slate-600">{t(entry.description)}</p>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h2 className="text-base font-semibold text-slate-900">
          {t('dashboard.taskTypesTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t('dashboard.taskTypesIntro')}</p>
        {capabilities.implemented_task_types.length === 0 ? (
          <p className="mt-2 text-sm text-slate-700">{t('dashboard.taskTypesNone')}</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {capabilities.implemented_task_types.map((type) => (
              <li key={type}>
                {/* Task type identifiers are contract values, not prose: shown verbatim. */}
                <Badge tone="info">
                  <code className="font-mono">{type}</code>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
