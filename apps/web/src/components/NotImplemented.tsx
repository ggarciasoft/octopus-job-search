import { Badge, Callout } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { ImplementationStatusLink } from './ImplementationStatusLink';

export interface NotImplementedProps {
  readonly screenKey: MessageKey;
  readonly milestone: string;
  readonly missingKey: MessageKey;
}

/**
 * The honest placeholder for a milestone that has not been built.
 *
 * It deliberately contains no `<form>`, no input and no action button: there is
 * nothing here that could look like it saved, queued or found anything
 * (00_AI_IMPLEMENTATION_INSTRUCTIONS.md, invariant 10 and "Never replace
 * missing backend behavior with a button that reports success"). It also shows
 * no example jobs, matches or applications, because 08_UX_AND_CUSTOMIZATION.md
 * forbids fabricating examples as live results.
 */
export function NotImplemented({ screenKey, milestone, missingKey }: NotImplementedProps) {
  const { t } = useTranslation();
  const screen = t(screenKey);

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">
          {t('notImplemented.title', { screen })}
        </h1>
        <Badge tone="warning">{t('notImplemented.badge')}</Badge>
      </div>

      <Callout tone="info" title={t('notImplemented.milestone', { milestone })}>
        <p>{t('notImplemented.intro')}</p>
        <p>{t('notImplemented.noFakeData')}</p>
      </Callout>

      <div>
        <h2 className="text-base font-semibold text-slate-900">
          {t('notImplemented.missingTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-700">{t(missingKey)}</p>
      </div>

      <ImplementationStatusLink />
    </section>
  );
}
