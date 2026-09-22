import { JobGetterApiClient } from '@job-getter/api-client';
import { readCsrfToken } from './csrf';

/**
 * The slice of the generated client this milestone uses.
 *
 * It is a `Pick` of the real class rather than a hand-written interface, so it
 * cannot drift from `packages/contracts/src/routes.ts`: if a signature changes,
 * this type changes with it and every fake used in tests stops compiling.
 * Extend the key list as later milestones start calling more routes.
 */
export type JobGetterApi = Pick<
  JobGetterApiClient,
  | 'getSetupStatus'
  | 'completeSetup'
  | 'login'
  | 'logout'
  | 'getMe'
  | 'getTask'
  | 'cancelTask'
  | 'listTasks'
  | 'createDiagnosticTask'
  // M1: profile, import review, preferences and provider settings.
  | 'getProfile'
  | 'patchProfile'
  | 'uploadFile'
  | 'createProfileImport'
  | 'getProfileImport'
  | 'confirmProfileImport'
  | 'getPreferences'
  | 'putPreferences'
  | 'getProviderSettings'
  | 'putProviderSettings'
  | 'testProviderSettings'
  // M2: the board registry, scans, manual import and the jobs list/detail.
  | 'listSources'
  | 'createSource'
  | 'patchSource'
  | 'deleteSource'
  | 'scanSource'
  | 'getScan'
  | 'importJob'
  | 'listJobs'
  | 'getJob'
  | 'patchJob'
  // M3: the fit score and the CV studio.
  | 'matchJob'
  | 'createResume'
  | 'listResumes'
  | 'getResume'
  | 'approveResume'
  // M4: applications, packets, approval, filling, devices and the tracker.
  | 'createApplication'
  | 'listApplications'
  | 'getApplication'
  | 'createApplicationPacket'
  | 'approveApplication'
  | 'recordApplicationOutcome'
  | 'listApplicationEvents'
  | 'fillApplication'
  | 'listAnswerBank'
  | 'putAnswerBankEntry'
  | 'deleteAnswerBankEntry'
  | 'listDevices'
  | 'createDevicePairing'
  | 'getDevice'
  | 'revokeDevice'
  | 'exportWorkspace'
  | 'deleteWorkspace'
  | 'getWorkspaceDeletion'
>;

export interface CreateApiClientOptions {
  /**
   * Origin the API is mounted on. Empty string means "this origin", which is
   * the normal case: the dev server proxies `/api` and the production build is
   * served behind the same reverse proxy (10_DEPLOYMENT.md). The generated
   * client appends the `/api/v1` prefix itself, so this must NOT include it.
   */
  readonly baseUrl?: string;
  readonly onUnauthenticated?: () => void;
}

export function createApiClient(options: CreateApiClientOptions = {}): JobGetterApiClient {
  return new JobGetterApiClient({
    baseUrl: options.baseUrl ?? defaultBaseUrl(),
    // The session itself is an HttpOnly cookie and is never read by JavaScript.
    // Only the anti-CSRF token is readable, by design (09_SECURITY_PRIVACY.md).
    getCsrfToken: readCsrfToken,
    onUnauthenticated: options.onUnauthenticated,
  });
}

function defaultBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL;
  return typeof configured === 'string' ? configured : '';
}
