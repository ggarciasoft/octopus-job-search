import type { TaskState } from '@job-getter/contracts';
import { Badge, type BadgeTone } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';

/**
 * The queue's state machine from 02_ARCHITECTURE.md: queued, leased, then one
 * of succeeded, failed or cancelled. The order is declared once, here.
 */
const LIFECYCLE_ORDER: readonly TaskState[] = [
  'queued',
  'leased',
  'succeeded',
  'failed',
  'cancelled',
];

const TONES: Record<TaskState, BadgeTone> = {
  queued: 'neutral',
  leased: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

export function taskStateLabelKey(state: TaskState): MessageKey {
  return `taskState.${state}`;
}

export function taskStateDescriptionKey(state: TaskState): MessageKey {
  return `taskState.${state}.description`;
}

export function TaskStateBadge({ state }: { readonly state: TaskState }) {
  const { t } = useTranslation();
  return (
    <Badge tone={TONES[state]} title={t(taskStateDescriptionKey(state))}>
      <span data-testid="task-state" data-state={state}>
        {t(taskStateLabelKey(state))}
      </span>
    </Badge>
  );
}

/**
 * Shows the whole machine with the current state marked, so it is obvious
 * which states are still possible and which one the task is actually in.
 */
export function TaskLifecycle({ current }: { readonly current: TaskState }) {
  const { t } = useTranslation();

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{t('diagnostics.lifecycle')}</h3>
      <ol className="mt-2 flex flex-wrap items-center gap-2" aria-label={t('diagnostics.lifecycle')}>
        {LIFECYCLE_ORDER.map((state, index) => {
          const isCurrent = state === current;
          return (
            <li key={state} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-slate-400">
                  {index === 2 ? '→ / ' : index > 2 ? '/' : '→'}
                </span>
              ) : null}
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={
                  isCurrent
                    ? 'rounded bg-sky-100 px-2 py-0.5 text-sm font-semibold text-sky-950'
                    : 'px-2 py-0.5 text-sm text-slate-500'
                }
              >
                {t(taskStateLabelKey(state))}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-sm text-slate-700">
        {t('diagnostics.lifecycleCurrent', { state: t(taskStateLabelKey(current)) })}{' '}
        {t(taskStateDescriptionKey(current))}
      </p>
    </div>
  );
}
