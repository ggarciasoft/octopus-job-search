import { Badge, StatusBadge } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';

/**
 * Draft versus confirmed, rendered as two different things.
 *
 * A confirmed fact is a plain success badge. An unconfirmed one is the shared
 * "Ready for review" status from 08_UX_AND_CUSTOMIZATION.md: a draft is
 * prepared and waiting for the user, and nothing has been asserted on their
 * behalf (invariant 2). The two never share a tone, a glyph or a label.
 */
export function FactStateBadge({ confirmed }: { readonly confirmed: boolean }) {
  const { t } = useTranslation();
  if (confirmed) {
    return (
      <span data-testid="fact-state" data-confirmed="true">
        <Badge tone="success" title={t('fact.confirmedDescription')}>
          {t('fact.confirmed')}
        </Badge>
      </span>
    );
  }
  return (
    <span data-testid="fact-state" data-confirmed="false">
      <StatusBadge
        status="ready_for_review"
        label={t('fact.draft')}
        description={t('fact.draftDescription')}
      />
    </span>
  );
}
