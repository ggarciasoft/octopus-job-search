import type { ApplicationEventView } from '@job-getter/contracts';
import { Badge } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import { formatDateTime } from '../i18n/format';
import { APPLICATION_EVENT_LABEL, APPLICATION_STATUS_LABEL } from './labels';

/**
 * The append-only history, oldest first.
 *
 * It shows the actor on every row because "you approved this" and "the system
 * withdrew that approval" are different sentences, and a timeline that blurs
 * them is a timeline that cannot answer the question people actually bring to
 * it: why is this not approved any more?
 *
 * Event data is rendered only where it is a code or a count. The event log is
 * built to hold no answer text and no CV text, and the UI does not go looking
 * for any.
 */
export interface EventTimelineProps {
  readonly events: readonly ApplicationEventView[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  const { t, locale } = useTranslation();

  if (events.length === 0) {
    return (
      <p className="text-sm text-slate-700" data-testid="timeline-empty">
        {t('timeline.empty')}
      </p>
    );
  }

  return (
    <ol className="flex flex-col" data-testid="event-timeline">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-col gap-1 border-b border-slate-200 py-2 last:border-b-0"
          data-testid="timeline-event"
          data-type={event.type}
          data-actor={event.actor}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{t(APPLICATION_EVENT_LABEL[event.type])}</span>
            <span className="flex items-center gap-2">
              <Badge tone={event.actor === 'user' ? 'info' : 'neutral'}>
                {t(`timeline.actor.${event.actor}` as const)}
              </Badge>
              <time className="text-xs text-slate-600" dateTime={event.occurred_at}>
                {formatDateTime(locale, event.occurred_at)}
              </time>
            </span>
          </div>
          {event.status_before === null || event.status_after === null ? null : (
            <span className="text-xs text-slate-700" data-testid="timeline-transition">
              {t('timeline.transition', {
                from: t(APPLICATION_STATUS_LABEL[event.status_before]),
                to: t(APPLICATION_STATUS_LABEL[event.status_after]),
              })}
            </span>
          )}
          {event.reason === null ? null : (
            <span className="text-xs text-slate-600" data-testid="timeline-reason">
              {event.reason}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
