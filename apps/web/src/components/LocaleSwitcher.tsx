import type { Locale } from '@job-getter/contracts';
import { Select } from '@job-getter/ui';
import { useTranslation } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES, isLocale } from '../i18n/messages';

/**
 * Locale switcher. The choice is kept in this browser: the API has no route for
 * changing the workspace language yet, and reporting "saved" for a request that
 * was never made is exactly what invariant 10 forbids. The description says so.
 */
export function LocaleSwitcher({ className }: { readonly className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <Select
      label={t('locale.label')}
      value={locale}
      options={SUPPORTED_LOCALES.map((value: Locale) => ({
        value,
        label: t(value === 'es' ? 'locale.es' : 'locale.en'),
      }))}
      description={t('locale.storedLocally')}
      fieldClassName={className}
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (isLocale(next)) setLocale(next);
      }}
    />
  );
}
