import { Button, Spinner } from '@job-getter/ui';
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ErrorNotice } from '../components/ErrorNotice';
import { useTranslation } from '../i18n/I18nProvider';
import { useAuth } from './AuthProvider';

/**
 * Applies the workspace language the API reports, unless the user has already
 * chosen one in this browser. It only ever changes UI chrome — stored facts are
 * untouched (08_UX_AND_CUSTOMIZATION.md).
 */
function LocaleSync() {
  const { state } = useAuth();
  const { adoptWorkspaceLocale } = useTranslation();
  const workspaceLocale = state.status === 'authenticated' ? state.me.workspace.locale : null;

  useEffect(() => {
    if (workspaceLocale) adoptWorkspaceLocale(workspaceLocale);
  }, [workspaceLocale, adoptWorkspaceLocale]);

  return null;
}

/**
 * Gate for authenticated screens.
 *
 * A 401 is treated as "signed out" and redirects to the sign-in screen; any
 * other failure is shown as the failure it is, because silently sending a user
 * to a login form when the API is simply down would misdescribe the problem.
 */
export function RequireAuth() {
  const { state, refresh } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-700">
        <Spinner label={t('auth.checking')} />
        <span>{t('auth.checking')}</span>
      </div>
    );
  }

  if (state.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (state.status === 'error') {
    return (
      <div className="flex max-w-2xl flex-col gap-3 p-6">
        <ErrorNotice error={state.error} />
        <div>
          <Button variant="primary" onClick={refresh}>
            {t('action.retry')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <LocaleSync />
      <Outlet />
    </>
  );
}
