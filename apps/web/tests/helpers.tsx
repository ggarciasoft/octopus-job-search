import { ApiError } from '@job-getter/api-client';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROVIDER_LIMITS,
  type Capabilities,
  type DraftFact,
  type MeResponse,
  type PreferencesView,
  type Profile,
  type ProfileFact,
  type ProfileImportView,
  type ProviderSettingsView,
  type TaskView,
} from '@job-getter/contracts';
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
export const PROFILE_ID = '55555555-5555-4555-8555-555555555555';
export const IMPORT_ID = '66666666-6666-4666-8666-666666666666';
export const FILE_ID = '77777777-7777-4777-8777-777777777777';
export const FACT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const FACT_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

export function makeFact(overrides: Partial<ProfileFact> = {}): ProfileFact {
  return {
    id: FACT_ID,
    kind: 'skill',
    value: {
      canonical_name: 'TypeScript',
      aliases: [],
      user_declared_proficiency: null,
      years: null,
    },
    source_file_id: null,
    source_excerpt: null,
    confirmed: true,
    revision: 1,
    supersedes_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: PROFILE_ID,
    revision: 3,
    confirmed_revision: null,
    contact: null,
    locale: 'en',
    facts: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<DraftFact> = {}): DraftFact {
  return {
    draft_id: 'draft-1',
    kind: 'skill',
    value: {
      canonical_name: 'Python',
      aliases: ['py'],
      user_declared_proficiency: null,
      years: null,
    },
    source_excerpt: 'Skills: Python, SQL',
    source_locator: 'page 1',
    confidence: 0.8,
    ...overrides,
  };
}

export function makeImportView(overrides: Partial<ProfileImportView> = {}): ProfileImportView {
  return {
    id: IMPORT_ID,
    status: 'ready_for_review',
    task_id: TASK_ID,
    format_hint: 'plain_text',
    source_file_id: null,
    draft_facts: [makeDraft()],
    warnings: [],
    conflicts: [],
    error: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makePreferencesView(overrides: Partial<PreferencesView> = {}): PreferencesView {
  return {
    revision: 2,
    config: DEFAULT_PREFERENCES,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeProviderView(
  overrides: Partial<ProviderSettingsView> = {},
): ProviderSettingsView {
  return {
    provider: 'none',
    model: '',
    base_url: null,
    api_key_set: false,
    api_key_masked: null,
    limits: DEFAULT_PROVIDER_LIMITS,
    rate_card: null,
    sends_data_externally: false,
    updated_at: null,
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
    getProfile: vi.fn(async () => makeProfile()),
    patchProfile: vi.fn(async () => makeProfile({ revision: 4 })),
    uploadFile: vi.fn(async () => ({
      file: {
        id: FILE_ID,
        original_name: 'cv.pdf',
        mime: 'application/pdf',
        bytes: 1234,
        sha256: 'a'.repeat(64),
        purpose: 'cv_original' as const,
        state: 'ready' as const,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      validation: {
        signature_ok: true,
        extension_matches_signature: true,
        encrypted: false,
        malware_scan: 'skipped_not_configured' as const,
        warnings: [],
      },
    })),
    createProfileImport: vi.fn(async () => ({ task_id: TASK_ID, status: 'queued' as const })),
    getProfileImport: vi.fn(async () => makeImportView()),
    confirmProfileImport: vi.fn(async () => makeProfile({ revision: 4 })),
    getPreferences: vi.fn(async () => makePreferencesView()),
    putPreferences: vi.fn(async () => makePreferencesView({ revision: 3 })),
    getProviderSettings: vi.fn(async () => makeProviderView()),
    putProviderSettings: vi.fn(async () => makeProviderView()),
    testProviderSettings: vi.fn(async () => ({
      reachable: true,
      structured_output_supported: null,
      model_available: null,
      latency_ms: 42,
      detail: 'probe ok',
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

/** A 409 with the contract's stale-revision code, as the API sends it. */
export function staleRevisionError(message = 'The profile is at revision 4, not 3.'): ApiError {
  return new ApiError({
    status: 409,
    code: 'STALE_REVISION',
    message,
    requestId: '99999999-9999-4999-8999-999999999999',
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
