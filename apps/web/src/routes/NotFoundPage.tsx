import { Callout } from '@job-getter/ui';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n/I18nProvider';
import { ImplementationStatusLink } from '../components/ImplementationStatusLink';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">{t('notFound.title')}</h1>
      <Callout tone="info" live={false}>
        <p>{t('notFound.body')}</p>
      </Callout>
      <Link
        to="/"
        className="text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        {t('notFound.home')}
      </Link>
      <ImplementationStatusLink />
    </div>
  );
}
