import { useTranslation } from '../i18n/I18nProvider';
import { implementationStatusUrl } from '../navigation';

/**
 * The one record of what is actually built. Every "not implemented" surface
 * points here rather than inventing a roadmap of its own.
 */
export function ImplementationStatusLink({ className }: { readonly className?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={implementationStatusUrl()}
      className={`inline-block rounded text-sm font-medium text-sky-800 underline underline-offset-2 hover:text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${className ?? ''}`}
    >
      {t('common.implementationStatus')}
    </a>
  );
}
