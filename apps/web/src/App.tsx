import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiProvider } from './api/ApiProvider';
import type { JobGetterApi } from './api/client';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './components/AppLayout';
import { AppErrorBoundary } from './components/ErrorBoundary';
import { NotImplemented } from './components/NotImplemented';
import { I18nProvider } from './i18n/I18nProvider';
import { PLACEHOLDER_SCREENS } from './navigation';
import { DashboardPage } from './routes/DashboardPage';
import { DiagnosticsPage } from './routes/DiagnosticsPage';
import { CvStudioPage } from './routes/CvStudioPage';
import { DiscoverPage } from './routes/DiscoverPage';
import { ImportPage } from './routes/ImportPage';
import { JobDetailPage } from './routes/JobDetailPage';
import { JobsPage } from './routes/JobsPage';
import { LoginPage } from './routes/LoginPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { ProfilePage } from './routes/ProfilePage';
import { SetupPage } from './routes/SetupPage';
import { TasksPage } from './routes/TasksPage';
import { PreferencesPage } from './routes/settings/PreferencesPage';
import { ProviderPage } from './routes/settings/ProviderPage';
import { SettingsLayout } from './routes/settings/SettingsLayout';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Failures are shown, not hidden behind silent retries; the task
        // polling hook does its own, deliberate, backoff.
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export interface AppProvidersProps {
  readonly client: JobGetterApi;
  readonly queryClient: QueryClient;
  readonly children: ReactNode;
}

/** Providers without a router, so tests can supply a `MemoryRouter`. */
export function AppProviders({ client, queryClient, children }: AppProvidersProps) {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={client}>
          <AuthProvider>
            <AppErrorBoundary>{children}</AppErrorBoundary>
          </AuthProvider>
        </ApiProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}

/**
 * Route table.
 *
 * Screens for milestones that do not exist are registered as explanations, not
 * as empty forms: `NotImplemented` renders no control that could report a
 * success the backend never produced.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/import" element={<ImportPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/cv-studio" element={<CvStudioPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/preferences" replace />} />
            <Route path="preferences" element={<PreferencesPage />} />
            <Route path="provider" element={<ProviderPage />} />
          </Route>
          {PLACEHOLDER_SCREENS.map((screen) => (
            <Route
              key={screen.path}
              path={screen.path}
              element={
                <NotImplemented
                  screenKey={screen.labelKey}
                  milestone={screen.milestone}
                  missingKey={screen.missingKey}
                />
              }
            />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export interface AppProps {
  readonly client: JobGetterApi;
  readonly queryClient: QueryClient;
}

export function App({ client, queryClient }: AppProps) {
  return (
    <AppProviders client={client} queryClient={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
