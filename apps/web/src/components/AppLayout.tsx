import { Badge, Button, VisuallyHidden } from '@job-getter/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useTranslation } from '../i18n/I18nProvider';
import { NAV_ITEMS } from '../navigation';
import { LocaleSwitcher } from './LocaleSwitcher';

/**
 * Application shell: a skip link, a labelled navigation landmark and a main
 * landmark that can receive focus (08_UX_AND_CUSTOMIZATION.md: accessible
 * labels, keyboard navigation, visible focus).
 *
 * Unbuilt screens stay in the navigation but are visibly marked as unavailable
 * and carry their milestone, so nothing looks clickable-and-broken. Following
 * one leads to an explanation, which is a real destination, not a dead control.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { state, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="absolute left-2 top-2 -translate-y-20 rounded bg-white px-3 py-2 text-sm font-medium text-sky-900 shadow focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        {t('nav.skipToContent')}
      </a>

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{t('app.name')}</p>
            <p className="text-xs text-slate-600">{t('app.tagline')}</p>
          </div>
          <div className="flex items-end gap-4">
            <LocaleSwitcher className="w-44" />
            {state.status === 'authenticated' ? (
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-slate-700">
                  {t('auth.signedInAs', { email: state.me.user.email })}
                </span>
                <Button onClick={() => void signOut()}>{t('action.signOut')}</Button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <nav aria-label={t('nav.primary')} className="md:w-60 md:shrink-0">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    [
                      'flex items-center justify-between gap-2 rounded px-3 py-2 text-sm',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                      isActive
                        ? 'bg-sky-100 font-semibold text-sky-950'
                        : 'text-slate-800 hover:bg-slate-100',
                      item.available ? '' : 'text-slate-600',
                    ].join(' ')
                  }
                >
                  <span>
                    {t(item.labelKey)}
                    {item.available ? null : (
                      <VisuallyHidden> — {t('nav.unavailable')}</VisuallyHidden>
                    )}
                  </span>
                  {item.available ? null : (
                    <Badge tone="warning" title={t('nav.unavailableHint')}>
                      {item.milestone}
                    </Badge>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
