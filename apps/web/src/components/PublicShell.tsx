import type { ReactNode } from 'react';
import { useTranslation } from '../i18n/I18nProvider';
import { LocaleSwitcher } from './LocaleSwitcher';

/** Shell for the screens reachable without a session: setup and sign-in. */
export function PublicShell({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="absolute left-2 top-2 -translate-y-20 rounded bg-white px-3 py-2 text-sm font-medium text-sky-900 shadow focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        {t('nav.skipToContent')}
      </a>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">{t('app.name')}</p>
            <p className="text-xs text-slate-600">{t('app.tagline')}</p>
          </div>
          <LocaleSwitcher className="w-44" />
        </header>
        <main id="main" tabIndex={-1} className="flex flex-col gap-4">
          {children}
        </main>
      </div>
    </div>
  );
}
