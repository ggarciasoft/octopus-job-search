import { ApiError } from '@job-getter/api-client';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROVIDER_LIMITS,
  type ApplicationEventView,
  type ApplicationPacketView,
  type ApplicationView,
  type Capabilities,
  type DeviceView,
  type DraftFact,
  type JobDetailView,
  type JobView,
  type MatchExplanation,
  type MatchSummary,
  type MeResponse,
  type PreferencesView,
  type Profile,
  type ProfileFact,
  type ProfileImportView,
  type ProviderSettingsView,
  type ResumeView,
  type ScanView,
  type SourceView,
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
export const SOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const SCAN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const JOB_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const JOB_ID_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
export const JOB_SOURCE_ID = '12121212-1212-4121-8121-121212121212';

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

export function makeSource(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: SOURCE_ID,
    connector: 'greenhouse',
    connector_version: '1',
    board_key: 'acme',
    base_url: null,
    enabled: true,
    last_success_at: null,
    last_scan_id: null,
    next_scan_after: null,
    health: {
      state: 'unknown',
      consecutive_failures: 0,
      last_error_code: null,
      last_error_at: null,
      detail: null,
    },
    job_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeScan(overrides: Partial<ScanView> = {}): ScanView {
  return {
    id: SCAN_ID,
    source_id: SOURCE_ID,
    task_id: TASK_ID,
    status: 'queued',
    complete_snapshot: false,
    counts: { fetched: 0, created: 0, updated: 0, unchanged: 0, closed: 0, pages: 0 },
    error_code: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A job as the M2 API returns it: nothing invented. `match` is null (no M3),
 * salary and eligibility null unless a test states them.
 */
export function makeJob(overrides: Partial<JobView> = {}): JobView {
  return {
    id: JOB_ID,
    canonical_key: 'greenhouse:acme:1001',
    company: 'Acme Corp',
    title: 'Backend Engineer',
    status: 'active',
    remote_type: 'unknown',
    locations: [],
    eligible_countries: null,
    employment_type: null,
    salary: null,
    language: null,
    published_at: null,
    first_seen_at: '2026-01-01T00:00:00.000Z',
    last_seen_at: '2026-01-02T00:00:00.000Z',
    last_fetched_at: new Date().toISOString(),
    revision: 1,
    saved: false,
    excluded_reason: null,
    sources: [
      {
        id: JOB_SOURCE_ID,
        source_id: SOURCE_ID,
        connector: 'greenhouse',
        external_id: '1001',
        canonical_url: 'https://boards.greenhouse.io/acme/jobs/1001',
        apply_url: null,
        retrieved_at: '2026-01-02T00:00:00.000Z',
      },
    ],
    match: null,
    possible_duplicates: [],
    ...overrides,
  };
}

export function makeJobDetail(overrides: Partial<JobDetailView> = {}): JobDetailView {
  return {
    ...makeJob(),
    description_text: 'We are hiring a backend engineer.',
    requirements: [],
    inferred: [],
    content_hash: 'a'.repeat(64),
    // Null, not a stub explanation: the default job is one nobody has scored.
    match_explanation: null,
    ...overrides,
  };
}

/** A scored match. `stale` defaults to false; the stale path is set explicitly. */
export function makeMatchSummary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: '99999999-9999-4999-8999-999999999999',
    eligible: 'unknown',
    score: 72,
    coverage_percent: 90,
    algorithm_version: 'v1',
    stale: false,
    computed_at: '2026-09-20T12:00:00.000Z',
    ...overrides,
  };
}

export function makeMatchExplanation(overrides: Partial<MatchExplanation> = {}): MatchExplanation {
  return {
    algorithm_version: 'v1',
    alias_map_version: 'v1',
    components: [],
    eligibility: [],
    requirements: [],
    unknown_components: [],
    fact_ids: [],
    evaluated_weight: 90,
    ...overrides,
  };
}

export const RESUME_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** A generated CV that passed its checks and was not approved by generating. */
export function makeResume(overrides: Partial<ResumeView> = {}): ResumeView {
  return {
    id: RESUME_ID,
    mode: 'tailored',
    status: 'ready',
    job_id: null,
    job_revision: null,
    profile_revision: 1,
    language: 'en',
    template_id: 'simple',
    document: {
      schema_version: 1,
      language: 'en',
      contact: {
        full_name: 'Ada Lovelace',
        email: 'ada@example.invalid',
        phone: null,
        location: 'Montevideo, Uruguay',
        links: [],
        fact_ids: [],
      },
      sections: [
        {
          kind: 'experience',
          heading: 'Experience',
          entries: [
            {
              title: 'Senior Backend Engineer',
              organization: 'Orbital Foods',
              start_month: '2019-03',
              end_month: null,
              current: true,
              detail: null,
              bullets: [{ text: 'Ran the ingestion pipeline', fact_ids: ['fact-1'] }],
              fact_ids: ['fact-1'],
            },
          ],
        },
      ],
    },
    validation: {
      passed_automatic_checks: true,
      findings: [],
      fact_ids: ['fact-1'],
      provenance: {
        template_version: 'simple/v1',
        prompt_version: null,
        provider: null,
        model: null,
        deterministic: true,
      },
      pdf_pages: 1,
    },
    input_file_id: null,
    pdf_file_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    docx_file_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    approved_at: null,
    error_code: null,
    error_message: null,
    task_id: RESUME_ID,
    created_at: '2026-09-21T10:00:00.000Z',
    updated_at: '2026-09-21T10:00:00.000Z',
    ...overrides,
  };
}

export const APPLICATION_ID = '77777777-7777-4777-8777-777777777777';
export const PACKET_ID = '66666666-6666-4666-8666-666666666666';
export const DEVICE_ID = '55555555-5555-4555-8555-555555555555';

export function makePacket(overrides: Partial<ApplicationPacketView> = {}): ApplicationPacketView {
  return {
    id: PACKET_ID,
    application_id: APPLICATION_ID,
    revision: 1,
    profile_revision: 3,
    job_revision: 1,
    resume_id: RESUME_ID,
    resume_sha256: 'b'.repeat(64),
    destination: {
      url: 'https://boards.greenhouse.io/acme/jobs/1#app',
      origin: 'https://boards.greenhouse.io',
      connector: 'greenhouse',
      connector_version: 'greenhouse/v1',
    },
    answers: [
      {
        question_key: 'why_this_role',
        label: 'Why do you want this role?',
        answer: 'Because the work is interesting.',
        required: true,
        sensitivity: 'standard',
        provenance: 'user_entered',
        source_id: null,
      },
    ],
    form_fingerprint: null,
    content_hash: 'c'.repeat(64),
    approved_hash: null,
    approved_at: null,
    expires_at: null,
    unresolved_question_keys: [],
    staleness: [],
    created_at: '2026-09-21T10:00:00.000Z',
    ...overrides,
  };
}

export function makeApplication(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: APPLICATION_ID,
    job_id: JOB_ID,
    company: 'Acme Robotics',
    title: 'Senior Backend Engineer',
    status: 'ready_for_review',
    revision: 2,
    current_packet: makePacket(),
    submission_evidence: null,
    submitted_at: null,
    possible_duplicate_application_ids: [],
    created_at: '2026-09-21T09:00:00.000Z',
    updated_at: '2026-09-21T10:00:00.000Z',
    ...overrides,
  };
}

export function makeApplicationEvent(
  overrides: Partial<ApplicationEventView> = {},
): ApplicationEventView {
  return {
    id: '99999999-9999-4999-8999-999999999991',
    sequence: 1,
    type: 'created',
    actor: 'user',
    status_before: null,
    status_after: 'draft',
    reason: null,
    data: {},
    occurred_at: '2026-09-21T09:00:00.000Z',
    ...overrides,
  };
}

export function makeDevice(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: DEVICE_ID,
    kind: 'local_runner',
    label: 'Work laptop',
    status: 'paired',
    device_public_id: 'linux-testbox',
    allowed_origins: ['https://boards.greenhouse.io'],
    expires_at: '2026-10-21T09:00:00.000Z',
    revoked_at: null,
    last_seen_at: null,
    created_at: '2026-09-21T09:00:00.000Z',
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
    // M2: empty registry and empty job list by default — a test that wants
    // rows must supply them; nothing is fabricated here either.
    listSources: vi.fn(async () => ({ items: [], next_cursor: null })),
    createSource: vi.fn(async () => makeSource()),
    patchSource: vi.fn(async () => makeSource()),
    deleteSource: vi.fn(async () => undefined),
    scanSource: vi.fn(async () => ({ task_id: TASK_ID, status: 'queued' as const })),
    getScan: vi.fn(async () => makeScan()),
    importJob: vi.fn(async () => ({ task_id: TASK_ID, status: 'queued' as const })),
    listJobs: vi.fn(async () => ({ items: [], next_cursor: null })),
    getJob: vi.fn(async () => makeJobDetail()),
    patchJob: vi.fn(async () => makeJob({ revision: 2 })),
    matchJob: vi.fn(async () => ({
      task_id: '88888888-8888-4888-8888-888888888888',
      status: 'queued' as const,
    })),
    createResume: vi.fn(async () => ({
      task_id: RESUME_ID,
      status: 'queued' as const,
    })),
    listResumes: vi.fn(async () => ({ items: [makeResume()], next_cursor: null })),
    getResume: vi.fn(async () => makeResume()),
    approveResume: vi.fn(async () => makeResume({ approved_at: '2026-09-21T12:00:00.000Z' })),
    // M4. Nothing is tracked and nothing is paired by default: a screen that
    // shows rows here must have been given them by the test.
    createApplication: vi.fn(async () =>
      makeApplication({ status: 'draft', current_packet: null }),
    ),
    listApplications: vi.fn(async () => ({ items: [], next_cursor: null })),
    getApplication: vi.fn(async () => makeApplication()),
    createApplicationPacket: vi.fn(async () => ({ task_id: PACKET_ID, status: 'queued' as const })),
    approveApplication: vi.fn(async () => makeApplication({ status: 'approved' })),
    recordApplicationOutcome: vi.fn(async () => makeApplication({ status: 'submitted' })),
    listApplicationEvents: vi.fn(async () => ({ items: [], next_cursor: null })),
    fillApplication: vi.fn(async () => ({ task_id: TASK_ID, status: 'queued' as const })),
    listAnswerBank: vi.fn(async () => ({ items: [], next_cursor: null })),
    putAnswerBankEntry: vi.fn(async () => ({
      id: '44444444-4444-4444-8444-444444444444',
      question_key: 'why_this_role',
      label: 'Why do you want this role?',
      answer: 'Because the work is interesting.',
      sensitivity: 'standard' as const,
      scope: 'general' as const,
      scope_id: null,
      confirmed_at: '2026-09-21T10:00:00.000Z',
      expires_at: null,
      created_at: '2026-09-21T10:00:00.000Z',
      updated_at: '2026-09-21T10:00:00.000Z',
    })),
    deleteAnswerBankEntry: vi.fn(async () => undefined),
    listDevices: vi.fn(async () => ({ items: [], next_cursor: null })),
    createDevicePairing: vi.fn(async () => ({
      device_id: DEVICE_ID,
      pairing_code: 'pairing-code-for-tests',
      expires_in: 300,
    })),
    getDevice: vi.fn(async () => makeDevice()),
    revokeDevice: vi.fn(async () => undefined),
    exportWorkspace: vi.fn(async () => ({ task_id: TASK_ID, status: 'queued' as const })),
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
