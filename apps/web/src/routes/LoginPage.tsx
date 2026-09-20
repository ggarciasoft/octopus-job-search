import { Button, TextField } from '@job-getter/ui';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { describeFailure } from '../api/errors';
import { ErrorNotice } from '../components/ErrorNotice';
import { PublicShell } from '../components/PublicShell';
import { useAuth } from '../auth/AuthProvider';
import { useTranslation } from '../i18n/I18nProvider';

interface LocationState {
  readonly from?: string;
}

export function LoginPage() {
  const api = useApi();
  const { t } = useTranslation();
  const { state, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as LocationState | null)?.from;

  if (state.status === 'authenticated') {
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmailError = email.trim() === '' ? t('login.emailRequired') : null;
    const nextPasswordError = password === '' ? t('login.passwordRequired') : null;
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    setBusy(true);
    setError(null);
    try {
      const me = await api.login({ body: { email: email.trim(), password } });
      setSession(me);
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (caught) {
      // The form state is deliberately untouched: a failed sign-in must not
      // throw away what the user typed (08_UX_AND_CUSTOMIZATION.md).
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold text-slate-900">{t('login.title')}</h1>
      <p className="text-sm text-slate-700">{t('login.intro')}</p>

      {error === null ? null : <ErrorNotice error={error} overrideMessage={loginMessage()} showServerMessage={false} />}

      <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        <TextField
          label={t('login.email')}
          type="email"
          autoComplete="username"
          value={email}
          required
          error={emailError}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <TextField
          label={t('login.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          required
          error={passwordError}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <div>
          <Button type="submit" variant="primary" busy={busy} busyLabel={t('login.busy')}>
            {t('login.submit')}
          </Button>
        </div>
      </form>

      <Link
        to="/setup"
        className="text-sm text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        {t('login.setupLink')}
      </Link>
    </PublicShell>
  );

  /**
   * Sign-in failures are described without revealing whether the account
   * exists (09_SECURITY_PRIVACY.md); 429 says what to do instead of repeating
   * a generic quota message.
   */
  function loginMessage(): string | undefined {
    const failure = describeFailure(error);
    if (failure.isRateLimited) return t('login.rateLimited');
    if (failure.status === 401 || failure.status === 422 || failure.code === 'VALIDATION_ERROR') {
      return t('login.invalidCredentials');
    }
    return undefined;
  }
}
