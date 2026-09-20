import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, createQueryClient } from './App';
import { ME_QUERY_KEY } from './auth/AuthProvider';
import { createApiClient } from './api/client';
import './index.css';

const queryClient = createQueryClient();

/**
 * A 401 anywhere in the app means the session is gone. Re-reading `/me` is the
 * single place that decides what the session is, so invalidating it here lets
 * `RequireAuth` route to the sign-in screen without any component having to
 * know about authentication.
 */
const apiClient = createApiClient({
  onUnauthenticated: () => {
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('The #root element is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App client={apiClient} queryClient={queryClient} />
  </StrictMode>,
);
