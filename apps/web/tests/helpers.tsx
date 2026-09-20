import { ApiError } from '@job-getter/api-client';
import type { Capabilities, MeResponse, TaskView } from '@job-getter/contracts';
import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AppProviders, AppRoutes } from '../src/App';
import type { JobGetterApi } from '../src/api/client';

export const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const TASK_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Capability flags default to "nothing is built", which is the honest M0 state.
 * A test that wants a feature available must say so.
 */
export function makeCapabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    implemented_task_types: ['noop_echo', 'parse_profile'],
    ai_provider_configured: false,
    profile_import: false,
    job_discovery: false,
    cv_generation: false,
    applications: false,
    browser_filling: false,
    extension: false,
    worker_online: true,
    ...overrides,
  };
}

export function makeMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: USER_ID, email: 'owner@example.test', verified_at: null },
    workspace: { id: WORKSPACE_ID, mode: 'local', locale: 'en', role: 'owner' },
    mode: 'local',
    capabilities: makeCapabilities(),
    usage: {
      ai_requests_today: 0,
      ai_requests_per_day_limit: 50,
      input_tokens_today: 0,
      output_tokens_today: 0,
      measured_cost_today: null,
      currency: null,
      daily_cost_budget: null,
    },
    ...overrides,
  };
}

export function makeTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: TASK_ID,
    type: 'noop_echo',
    state: 'queued',
    progress: null,
    attempt: 0,
    max_attempts: 3,
    cancel_requested: false,
    run_after: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    result: null,
    error: null,
    ...overrides,
  };
}

/**
 * A fake that satisfies the same `JobGetterApi` type the real generated client
 * satisfies, so a contract change breaks these tests instead of letting them
 * pass against a stale shape.
 */
export function createFakeApi(overrides: Partial<JobGetterApi> = {}): JobGetterApi {
  return {
    getSetupStatus: vi.fn(async () => ({
      mode: 'local' as const,
      setup_required: false,
      registration_open: false,
    })),
    completeSetup: vi.fn(async () => makeMe()),
    login: vi.fn(async () => makeMe()),
    logout: vi.fn(async () => undefined),
    getMe: vi.fn(async () => makeMe()),
    getTask: vi.fn(async () => makeTask()),
    cancelTask: vi.fn(async () => makeTask({ cancel_requested: true })),
    listTasks: vi.fn(async () => ({ items: [], next_cursor: null })),
    createDiagnosticTask: vi.fn(async () => ({
      task_id: TASK_ID,
      status: 'queued' as const,
    })),
    ...overrides,
  };
}

/** The API's answer for a browser with no session: 401, not an error page. */
export function unauthenticatedError(): ApiError {
  return new ApiError({
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Authentication required',
    requestId: '44444444-4444-4444-8444-444444444444',
  });
}

/** A fake API that reports nobody is signed in. */
export function createAnonymousApi(overrides: Partial<JobGetterApi> = {}): JobGetterApi {
  return createFakeApi({
    getMe: vi.fn(async () => {
      throw unauthenticatedError();
    }),
    ...overrides,
  });
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
}

export interface RenderAppOptions {
  readonly client?: JobGetterApi;
  readonly route?: string;
}

/** Renders the real route table at a real URL with a fake API behind it. */
export function renderApp({ client, route = '/' }: RenderAppOptions = {}): RenderResult & {
  readonly api: JobGetterApi;
} {
  const api = client ?? createFakeApi();
  const result = render(
    <AppProviders client={api} queryClient={createTestQueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return Object.assign(result, { api });
}

/** Renders an isolated component inside the app's providers. */
export function renderWithProviders(
  ui: ReactNode,
  { client }: { readonly client?: JobGetterApi } = {},
): RenderResult & { readonly api: JobGetterApi } {
  const api = client ?? createFakeApi();
  const result = render(
    <AppProviders client={api} queryClient={createTestQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </AppProviders>,
  );
  return Object.assign(result, { api });
}
