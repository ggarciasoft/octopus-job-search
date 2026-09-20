import type { MeResponse } from '@job-getter/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useApi } from '../api/ApiProvider';
import { describeFailure, isApiError, type FailureDescription } from '../api/errors';

export const ME_QUERY_KEY = ['me'] as const;

export type AuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'authenticated'; readonly me: MeResponse }
  | { readonly status: 'anonymous' }
  /** The session could not be determined — a network or server fault, not a sign-out. */
  | {
      readonly status: 'error';
      readonly failure: FailureDescription;
      /** The original error, so the notice can show the real request id. */
      readonly error: unknown;
    };

export interface AuthContextValue {
  readonly state: AuthState;
  readonly refresh: () => void;
  /** Records the session returned by login or setup without a second round trip. */
  readonly setSession: (me: MeResponse) => void;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const api = useApi();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => api.getMe({ signal }),
    // 401 is the normal "not signed in" answer, not a fault, so it must not be
    // retried and must not surface as an error screen.
    retry: (failureCount, error) => !isApiError(error) && failureCount < 2,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const setSession = useCallback(
    (me: MeResponse) => {
      queryClient.setQueryData(ME_QUERY_KEY, me);
    },
    [queryClient],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    try {
      await api.logout({});
    } finally {
      // Whatever the server said, this browser no longer holds a usable
      // session view; clear the cache so no stale workspace data is shown.
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, null);
    }
  }, [api, queryClient]);

  const state = useMemo<AuthState>(() => {
    if (query.data) return { status: 'authenticated', me: query.data };
    if (query.isPending) return { status: 'loading' };
    const error = query.error;
    if (error === null || query.data === null) return { status: 'anonymous' };
    if (isApiError(error) && error.status === 401) return { status: 'anonymous' };
    return { status: 'error', failure: describeFailure(error), error };
  }, [query.data, query.isPending, query.error]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, refresh, setSession, signOut }),
    [state, refresh, setSession, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}

/** Convenience for screens that are only reachable behind `RequireAuth`. */
export function useSession(): MeResponse | null {
  const { state } = useAuth();
  return state.status === 'authenticated' ? state.me : null;
}
