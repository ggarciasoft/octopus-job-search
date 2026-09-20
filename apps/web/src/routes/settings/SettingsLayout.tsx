import { Callout } from '@job-getter/ui';
import { NavLink, Outlet } from 'react-router-dom';
import { ImplementationStatusLink } from '../../components/ImplementationStatusLink';
import { useTranslation } from '../../i18n/I18nProvider';

const SETTINGS_TABS = [
  { path: '/settings/preferences', labelKey: 'settings.preferencesTab' },
  { path: '/settings/provider', labelKey: 'settings.providerTab' },
] as const;

/**
 * Settings shell. M1 delivers preferences and the model provider; the rest of
 * the settings screen from 08_UX_AND_CUSTOMIZATION.md (schedules, devices,
 * export and deletion) is listed as missing rather than shown as controls.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">{t('settings.title')}</h1>
        <p className="max-w-3xl text-sm text-slate-700">{t('settings.intro')}</p>
      </header>

      <nav aria-label={t('settings.tabsLabel')}>
        <ul className="flex flex-wrap gap-2">
          {SETTINGS_TABS.map((tab) => (
            <li key={tab.path}>
              <NavLink
                to={tab.path}
                className={({ isActive }) =>
                  [
                    'inline-block rounded border px-3 py-1.5 text-sm',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600',
                    isActive
                      ? 'border-sky-700 bg-sky-100 font-semibold text-sky-950'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
                  ].join(' ')
                }
              >
                {t(tab.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />

      <Callout tone="info" live={false} title={t('settings.missingTitle')}>
        <p>{t('settings.missingBody')}</p>
        <ImplementationStatusLink />
      </Callout>
    </div>
  );
}
