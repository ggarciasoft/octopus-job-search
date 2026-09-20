import { createContext, useContext, type ReactNode } from 'react';
import type { JobGetterApi } from './client';

/**
 * The API client is injected rather than imported directly by screens, so a
 * test can supply a fake that behaves like the real server (including throwing
 * real `ApiError`s) without stubbing `fetch`.
 */
const ApiContext = createContext<JobGetterApi | null>(null);

export interface ApiProviderProps {
  readonly client: JobGetterApi;
  readonly children: ReactNode;
}

export function ApiProvider({ client, children }: ApiProviderProps) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): JobGetterApi {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('useApi must be used inside <ApiProvider>.');
  }
  return client;
}
