import { STATUS_DESCRIPTORS, StatusBadge } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';

/**
 * Reference list of the seven product status words
 * (08_UX_AND_CUSTOMIZATION.md). It documents the vocabulary; it does not claim
 * that anything currently has these states.
 *
 * "Submitted — verified" and "Submitted — reported by you" are rendered as
 * separate entries with separate explanations, which is the point: a user
 * report is never displayed as verified evidence.
 */
export function StatusLegend() {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-slate-900">
        {t('dashboard.statusVocabularyTitle')}
      </h2>
      <p className="text-sm text-slate-600">{t('dashboard.statusVocabularyIntro')}</p>
      <dl className="flex flex-col gap-2">
        {STATUS_DESCRIPTORS.map((descriptor) => (
          <div
            key={descriptor.key}
            data-testid={`status-${descriptor.key}`}
            data-evidence={descriptor.evidence}
            className="flex flex-col gap-1 rounded border border-slate-200 bg-white p-3 sm:flex-row sm:items-baseline sm:gap-3"
          >
            <dt className="sm:w-56 sm:shrink-0">
              <StatusBadge
                status={descriptor.key}
                label={t(descriptor.labelKey)}
                description={t(descriptor.descriptionKey)}
              />
            </dt>
            <dd className="text-sm text-slate-700">{t(descriptor.descriptionKey)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
