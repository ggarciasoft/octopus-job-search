import type { Locale } from '@job-getter/contracts';
import { Button, Callout, Select, Spinner, TextField } from '@job-getter/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNotice } from '../components/ErrorNotice';
import { PublicShell } from '../components/PublicShell';
import { useTranslation } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES, isLocale } from '../i18n/messages';

/** Matches `SetupRequest.password` in packages/contracts (minLength 12). */
const MIN_PASSWORD_LENGTH = 12;

export function SetupPage() {
  const api = useApi();
  const { t, locale } = useTranslation();
  const { state, setSession } = useAuth();
  const navigate = useNavigate();

  const setupStatus = useQuery({
    queryKey: ['setup-status'],
    queryFn: ({ signal }) => api.getSetupStatus({ signal }),
    retry: false,
  });

  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [chosenLocale, setChosenLocale] = useState<Locale>(locale);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTokenError = token.trim() === '' ? t('setup.tokenRequired') : null;
    const nextEmailError = email.trim() === '' ? t('setup.emailRequired') : null;
    const nextPasswordError =
      password.length < MIN_PASSWORD_LENGTH ? t('setup.passwordTooShort') : null;
    setTokenError(nextTokenError);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextTokenError || nextEmailError || nextPasswordError) return;

    setBusy(true);
    setError(null);
    try {
      const me = await api.completeSetup({
        body: {
          setup_token: token.trim(),
          email: email.trim(),
          password,
          locale: chosenLocale,
        },
      });
      setSession(me);
      navigate('/', { replace: true });
    } catch (caught) {
      // Entered values are kept so a mistyped token does not cost the rest.
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold text-slate-900">{t('setup.title')}</h1>

      <Callout tone="info" title={t('setup.modeTitle')} live={false}>
        <p>{t('setup.modeLocal')}</p>
        <p>{t('setup.modeHosted')}</p>
        {setupStatus.data ? (
          <p className="font-medium">
            {t('setup.modeDetected', { mode: t(`mode.${setupStatus.data.mode}`) })}
          </p>
        ) : null}
      </Callout>

      {setupStatus.isPending ? (
        <p className="flex items-center gap-2 text-sm text-slate-700">
          <Spinner label={t('setup.checking')} />
          {t('setup.checking')}
        </p>
      ) : null}

      {setupStatus.isError ? <ErrorNotice error={setupStatus.error} /> : null}

      {setupStatus.data && !setupStatus.data.setup_required ? (
        <>
          <Callout tone="warning" title={t('setup.closedTitle')}>
            <p>{t('setup.closedBody')}</p>
          </Callout>
          <Link
            to="/login"
            className="text-sm font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            {t('setup.closedLogin')}
          </Link>
        </>
      ) : null}

      {setupStatus.data?.setup_required === true ? (
        <>
          <h2 className="text-lg font-semibold text-slate-900">{t('setup.requiredTitle')}</h2>
          <p className="text-sm text-slate-700">{t('setup.requiredIntro')}</p>
          {setupStatus.data.registration_open ? null : (
            <p className="text-sm text-slate-600">{t('setup.registrationClosed')}</p>
          )}

          {error === null ? null : <ErrorNotice error={error} />}

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void onSubmit(event)}
            noValidate
          >
            <TextField
              label={t('setup.tokenLabel')}
              description={t('setup.tokenDescription')}
              value={token}
              required
              autoComplete="off"
              spellCheck={false}
              error={tokenError}
              onChange={(event) => setToken(event.currentTarget.value)}
            />
            <TextField
              label={t('setup.emailLabel')}
              description={t('setup.emailDescription')}
              type="email"
              autoComplete="username"
              value={email}
              required
              error={emailError}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <TextField
              label={t('setup.passwordLabel')}
              description={t('setup.passwordDescription')}
              type="password"
              autoComplete="new-password"
              value={password}
              required
              minLength={MIN_PASSWORD_LENGTH}
              error={passwordError}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <Select
              label={t('setup.localeLabel')}
              value={chosenLocale}
              options={SUPPORTED_LOCALES.map((value) => ({
                value,
                label: t(value === 'es' ? 'locale.es' : 'locale.en'),
              }))}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (isLocale(next)) setChosenLocale(next);
              }}
            />
            <div>
              <Button type="submit" variant="primary" busy={busy} busyLabel={t('setup.busy')}>
                {t('setup.submit')}
              </Button>
            </div>
          </form>

          <Callout tone="info" title={t('setup.nextTitle')} live={false}>
            <p>{t('setup.nextBody')}</p>
          </Callout>
        </>
      ) : null}
    </PublicShell>
  );
}
