import { Type, type TSchema } from '@sinclair/typebox';
import { AcceptedResponse, PaginationQuery, Uuid } from './common.js';
import {
  LoginRequest,
  MeResponse,
  PasswordResetConfirm,
  PasswordResetRequest,
  RegisterRequest,
  SetupRequest,
  SetupStatus,
} from './schemas/auth.js';
import { FilePurpose, FileUploadResponse } from './schemas/files.js';
import { PreferencesPutRequest, PreferencesView } from './schemas/preferences.js';
import { Profile, ProfilePatchRequest } from './schemas/profile.js';
import {
  ProviderSettingsPutRequest,
  ProviderSettingsView,
  ProviderTestResult,
} from './schemas/providers.js';
import {
  ConfirmImportRequest,
  CreateProfileImportRequest,
  ProfileImportView,
} from './tasks/parse-profile.js';
import {
  ApproveResumeRequest,
  CreateResumeRequest,
  ResumeView,
  ResumesListQuery,
} from './schemas/resumes.js';
import { AnswerBankEntry, AnswerBankListQuery, AnswerBankPutRequest } from './schemas/answers.js';
import {
  ApplicationEventView,
  ApplicationOutcomeRequest,
  ApplicationView,
  ApplicationsListQuery,
  ApproveApplicationRequest,
  CreateApplicationRequest,
  CreatePacketRequest,
} from './schemas/applications.js';
import {
  CreatePairingRequest,
  DeviceExchangeRequest,
  DeviceExchangeResponse,
  DeviceView,
  PairingCodeResponse,
} from './schemas/devices.js';
import { FillApplicationRequest } from './tasks/fill-local.js';
import {
  CreateFillSessionRequest,
  FillSessionGrant,
  FillSessionView,
  ReportFillSessionRequest,
} from './schemas/fill-sessions.js';
import { ObserveApplicationRequest } from './tasks/observe-confirmation.js';
import { NoopEchoInput } from './tasks/noop-echo.js';
import { TaskView } from './tasks/protocol.js';
import {
  CreateSourceRequest,
  JobDetailView,
  JobImportRequest,
  JobView,
  JobsListQuery,
  PatchJobRequest,
  PatchSourceRequest,
  ScanView,
  SourceView,
} from './schemas/jobs.js';
import { DeleteWorkspaceRequest, WorkspaceDeletionView } from './schemas/workspace.js';

export type AuthMode = 'public' | 'session' | 'device' | 'worker';

export interface RouteDefinition {
  /** Stable identifier used for the generated client method name. */
  readonly operationId: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path relative to the version prefix, with :param placeholders. */
  readonly path: string;
  readonly auth: AuthMode;
  readonly summary: string;
  readonly params?: TSchema;
  readonly query?: TSchema;
  readonly body?: TSchema;
  readonly response: TSchema;
  readonly successStatus: 200 | 201 | 202 | 204;
  /** Idempotency-Key is mandatory for these commands (04_API_CONTRACTS.md). */
  readonly requiresIdempotencyKey?: boolean;
  /** multipart/form-data rather than JSON. */
  readonly multipart?: boolean;
  /** Streams a file attachment instead of JSON. */
  readonly binaryResponse?: boolean;
  /** Mutating routes require anti-CSRF token plus origin verification. */
  readonly csrf?: boolean;
  /**
   * Skips the same-origin check on a state-changing route.
   *
   * Few routes set this, and each needs a standing justification rather than
   * a flag someone can reach for. Origin verification exists to stop a
   * *browser* being used as a confused deputy: it only works because a browser
   * always sends `Origin`, and the check therefore rejects any client that
   * sends none. A paired desktop runner is not a browser and sends none.
   *
   * Exempting a route is only safe where there is no ambient authority to
   * forge — no cookie, no session, nothing the victim's browser would attach
   * automatically. Two kinds of route qualify.
   *
   *  * `POST /devices/exchange` authenticates solely on a single-use code that
   *    expires in five minutes, so anyone who can make the request already
   *    holds the only thing it checks.
   *  * The `/fill-sessions` routes authenticate on `x-device-token`, and the
   *    mutating ones additionally on a session nonce. A page that makes the
   *    victim's browser issue one of these requests supplies neither header,
   *    because neither is ambient: the token lives in the extension's service
   *    worker, where page scripts cannot reach it (AT24). The `Origin` such a
   *    caller does send is its own `chrome-extension://` id, which the
   *    same-origin check has nothing useful to compare against.
   */
  readonly originExempt?: boolean;
}

const IdParam = Type.Object({ id: Uuid }, { additionalProperties: false });
const Empty = Type.Object({}, { additionalProperties: false });
const NoContent = Type.Null();

/**
 * Single source of truth for the public HTTP surface. OpenAPI, the typed
 * TypeScript client and the API's route registration all derive from this
 * list, so a route cannot exist in one place and be missing from another.
 *
 * Routes for milestones beyond M1 are intentionally absent rather than
 * present-but-stubbed: invariant 10 forbids presenting unimplemented
 * behaviour as a working integration.
 */
export const API_PREFIX = '/api/v1';

export const ROUTES: readonly RouteDefinition[] = [
  {
    operationId: 'getSetupStatus',
    method: 'GET',
    path: '/setup',
    auth: 'public',
    summary: 'Whether one-time local setup is still required.',
    response: SetupStatus,
    successStatus: 200,
  },
  {
    operationId: 'completeSetup',
    method: 'POST',
    path: '/setup',
    auth: 'public',
    summary: 'One-time local owner bootstrap; permanently closes afterwards.',
    body: SetupRequest,
    response: MeResponse,
    successStatus: 201,
    csrf: false,
  },
  {
    operationId: 'register',
    method: 'POST',
    path: '/auth/register',
    auth: 'public',
    summary: 'Hosted beta invitation signup.',
    body: RegisterRequest,
    response: Type.Object(
      { status: Type.Literal('verification_pending') },
      { additionalProperties: false },
    ),
    successStatus: 202,
  },
  {
    operationId: 'login',
    method: 'POST',
    path: '/auth/login',
    auth: 'public',
    summary: 'Exchange credentials for an HttpOnly session cookie.',
    body: LoginRequest,
    response: MeResponse,
    successStatus: 200,
  },
  {
    operationId: 'logout',
    method: 'POST',
    path: '/auth/logout',
    auth: 'session',
    summary: 'Revoke the current session.',
    body: Empty,
    response: NoContent,
    successStatus: 204,
    csrf: true,
  },
  {
    operationId: 'requestPasswordReset',
    method: 'POST',
    path: '/auth/password-reset/request',
    auth: 'public',
    summary: 'Always returns 202 so accounts cannot be enumerated.',
    body: PasswordResetRequest,
    response: Type.Object({ status: Type.Literal('accepted') }, { additionalProperties: false }),
    successStatus: 202,
  },
  {
    operationId: 'confirmPasswordReset',
    method: 'POST',
    path: '/auth/password-reset/confirm',
    auth: 'public',
    summary: 'Consume a single-use token and revoke existing sessions.',
    body: PasswordResetConfirm,
    response: NoContent,
    successStatus: 204,
  },
  {
    operationId: 'getMe',
    method: 'GET',
    path: '/me',
    auth: 'session',
    summary: 'Current user, workspace, honest capability flags and usage.',
    response: MeResponse,
    successStatus: 200,
  },

  {
    operationId: 'getProfile',
    method: 'GET',
    path: '/profile',
    auth: 'session',
    summary: 'Profile with facts and the current revision.',
    response: Profile,
    successStatus: 200,
  },
  {
    operationId: 'patchProfile',
    method: 'PATCH',
    path: '/profile',
    auth: 'session',
    summary: 'Apply fact changes against an expected revision.',
    body: ProfilePatchRequest,
    response: Profile,
    successStatus: 200,
    csrf: true,
  },

  {
    operationId: 'uploadFile',
    method: 'POST',
    path: '/files',
    auth: 'session',
    summary: 'Upload a private document; returns validation detail.',
    // Declared explicitly rather than left open so the generated OpenAPI
    // documents the real form fields. The bytes arrive as a multipart part
    // named `file`; `purpose` decides which MIME types are accepted.
    body: Type.Object(
      {
        file: Type.String({ format: 'binary', description: 'Document bytes.' }),
        purpose: FilePurpose,
      },
      { additionalProperties: false },
    ),
    response: FileUploadResponse,
    successStatus: 201,
    multipart: true,
    csrf: true,
  },
  {
    operationId: 'downloadFile',
    method: 'GET',
    path: '/files/:id/download',
    auth: 'session',
    summary: 'Authorized attachment stream; never a public permanent URL.',
    params: IdParam,
    response: Type.Unknown(),
    successStatus: 200,
    binaryResponse: true,
  },

  {
    operationId: 'createProfileImport',
    method: 'POST',
    path: '/profile/imports',
    auth: 'session',
    summary: 'Queue extraction from an uploaded document or pasted text.',
    body: CreateProfileImportRequest,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'getProfileImport',
    method: 'GET',
    path: '/profile/imports/:id',
    auth: 'session',
    summary: 'Extraction draft, warnings, conflicts and evidence.',
    params: IdParam,
    response: ProfileImportView,
    successStatus: 200,
  },
  {
    operationId: 'confirmProfileImport',
    method: 'POST',
    path: '/profile/imports/:id/confirm',
    auth: 'session',
    summary: 'Promote user-accepted drafts into confirmed facts.',
    params: IdParam,
    body: ConfirmImportRequest,
    response: Profile,
    successStatus: 200,
    csrf: true,
  },

  {
    operationId: 'getPreferences',
    method: 'GET',
    path: '/preferences',
    auth: 'session',
    summary: 'Validated preference config and revision.',
    response: PreferencesView,
    successStatus: 200,
  },
  {
    operationId: 'putPreferences',
    method: 'PUT',
    path: '/preferences',
    auth: 'session',
    summary: 'Replace preferences; unknown keys are rejected.',
    body: PreferencesPutRequest,
    response: PreferencesView,
    successStatus: 200,
    csrf: true,
  },

  {
    operationId: 'getProviderSettings',
    method: 'GET',
    path: '/settings/providers',
    auth: 'session',
    summary: 'Provider configuration with masked readiness only.',
    response: ProviderSettingsView,
    successStatus: 200,
  },
  {
    operationId: 'putProviderSettings',
    method: 'PUT',
    path: '/settings/providers',
    auth: 'session',
    summary: 'Store provider configuration; secrets are write-only.',
    body: ProviderSettingsPutRequest,
    response: ProviderSettingsView,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'testProviderSettings',
    method: 'POST',
    path: '/settings/providers/test',
    auth: 'session',
    summary: 'Probe the configured provider only; not a URL fetcher.',
    body: Empty,
    response: ProviderTestResult,
    successStatus: 200,
    csrf: true,
  },

  {
    operationId: 'getTask',
    method: 'GET',
    path: '/tasks/:id',
    auth: 'session',
    summary: 'Task state, progress, result references and error.',
    params: IdParam,
    response: TaskView,
    successStatus: 200,
  },
  {
    operationId: 'cancelTask',
    method: 'POST',
    path: '/tasks/:id/cancel',
    auth: 'session',
    summary: 'Request cancellation; running work stops at a safe checkpoint.',
    params: IdParam,
    body: Empty,
    response: TaskView,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'listTasks',
    method: 'GET',
    path: '/tasks',
    auth: 'session',
    summary: 'Recent tasks for the workspace.',
    query: PaginationQuery,
    response: Type.Object(
      { items: Type.Array(TaskView), next_cursor: Type.Union([Type.String(), Type.Null()]) },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'createDiagnosticTask',
    method: 'POST',
    path: '/diagnostics/echo',
    auth: 'session',
    summary: 'Queue the M0 end-to-end probe task.',
    body: NoopEchoInput,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },

  // --- Milestone M2: discovery ------------------------------------------------
  {
    operationId: 'listSources',
    method: 'GET',
    path: '/sources',
    auth: 'session',
    summary: 'Configured boards with health and last-scan state.',
    response: Type.Object(
      { items: Type.Array(SourceView), next_cursor: Type.Union([Type.String(), Type.Null()]) },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'createSource',
    method: 'POST',
    path: '/sources',
    auth: 'session',
    summary: 'Register a Greenhouse board token or Lever site slug.',
    body: CreateSourceRequest,
    response: SourceView,
    successStatus: 201,
    csrf: true,
  },
  {
    operationId: 'patchSource',
    method: 'PATCH',
    path: '/sources/:id',
    auth: 'session',
    summary: 'Enable, disable or reconfigure a source; jobs are kept.',
    params: IdParam,
    body: PatchSourceRequest,
    response: SourceView,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'deleteSource',
    method: 'DELETE',
    path: '/sources/:id',
    auth: 'session',
    summary: 'Remove a source; historical jobs and provenance are kept.',
    params: IdParam,
    response: NoContent,
    successStatus: 204,
    csrf: true,
  },
  {
    operationId: 'scanSource',
    method: 'POST',
    path: '/sources/:id/scan',
    auth: 'session',
    summary: 'Queue a fetch of this board now.',
    params: IdParam,
    body: Empty,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'getScan',
    method: 'GET',
    path: '/scans/:id',
    auth: 'session',
    summary: 'One scan: status, counts, whether the snapshot was complete.',
    params: IdParam,
    response: ScanView,
    successStatus: 200,
  },
  {
    operationId: 'importJob',
    method: 'POST',
    path: '/jobs/import',
    auth: 'session',
    summary: 'Import a job from a public URL or pasted description.',
    body: JobImportRequest,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'listJobs',
    method: 'GET',
    path: '/jobs',
    auth: 'session',
    summary: 'Jobs with provenance and the current match marker.',
    query: JobsListQuery,
    response: Type.Object(
      { items: Type.Array(JobView), next_cursor: Type.Union([Type.String(), Type.Null()]) },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'getJob',
    method: 'GET',
    path: '/jobs/:id',
    auth: 'session',
    summary: 'Normalised job, requirements with evidence, provenance, duplicates.',
    params: IdParam,
    response: JobDetailView,
    successStatus: 200,
  },
  {
    operationId: 'matchJob',
    method: 'POST',
    path: '/jobs/:id/match',
    auth: 'session',
    summary: 'Score this job against the confirmed profile and preferences.',
    params: IdParam,
    body: Type.Object({}, { additionalProperties: false }),
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'patchJob',
    method: 'PATCH',
    path: '/jobs/:id',
    auth: 'session',
    summary: 'Save, unsave or explicitly close a job.',
    params: IdParam,
    body: PatchJobRequest,
    response: JobView,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'createResume',
    method: 'POST',
    path: '/resumes',
    auth: 'session',
    summary: 'Generate a tailored CV, or register an original file unchanged.',
    body: CreateResumeRequest,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'listResumes',
    method: 'GET',
    path: '/resumes',
    auth: 'session',
    summary: 'CVs this workspace holds, newest first.',
    query: ResumesListQuery,
    response: Type.Object(
      { items: Type.Array(ResumeView), next_cursor: Type.Union([Type.String(), Type.Null()]) },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'getResume',
    method: 'GET',
    path: '/resumes/:id',
    auth: 'session',
    summary: 'The document, its validation findings and the generated files.',
    params: IdParam,
    response: ResumeView,
    successStatus: 200,
  },
  {
    operationId: 'approveResume',
    method: 'POST',
    path: '/resumes/:id/approve',
    auth: 'session',
    summary: 'Record the mandatory user approval of a generated CV.',
    params: IdParam,
    body: ApproveResumeRequest,
    response: ResumeView,
    successStatus: 200,
    csrf: true,
  },

  // --- Milestone M4: applications, packets and the tracker -------------------
  {
    operationId: 'createApplication',
    method: 'POST',
    path: '/applications',
    auth: 'session',
    summary: 'Start tracking an application, or return the existing one.',
    body: CreateApplicationRequest,
    // 200, not 201: the route is idempotent on job_id, because "two
    // simultaneous application creates return the existing application"
    // (03_DATA_MODEL.md). Answering 201 for a row that already existed would
    // be a claim about what happened, not a description of it.
    response: ApplicationView,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'listApplications',
    method: 'GET',
    path: '/applications',
    auth: 'session',
    summary: 'Tracked applications with their current packet and staleness.',
    query: ApplicationsListQuery,
    response: Type.Object(
      {
        items: Type.Array(ApplicationView),
        next_cursor: Type.Union([Type.String(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'getApplication',
    method: 'GET',
    path: '/applications/:id',
    auth: 'session',
    summary: 'One application, its current packet and any duplicate warning.',
    params: IdParam,
    response: ApplicationView,
    successStatus: 200,
  },
  {
    operationId: 'createApplicationPacket',
    method: 'POST',
    path: '/applications/:id/packets',
    auth: 'session',
    summary: 'Snapshot CV, answers, revisions and destination as a new packet.',
    params: IdParam,
    body: CreatePacketRequest,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'approveApplication',
    method: 'POST',
    path: '/applications/:id/approve',
    auth: 'session',
    summary: 'Bind the user approval to an exact packet content hash.',
    params: IdParam,
    body: ApproveApplicationRequest,
    response: ApplicationView,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'recordApplicationOutcome',
    method: 'POST',
    path: '/applications/:id/outcome',
    auth: 'session',
    summary: 'Record what happened, with its evidence type, and transition.',
    params: IdParam,
    body: ApplicationOutcomeRequest,
    response: ApplicationView,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'listApplicationEvents',
    method: 'GET',
    path: '/applications/:id/events',
    auth: 'session',
    summary: 'The append-only history: who changed what, when and why.',
    params: IdParam,
    query: PaginationQuery,
    response: Type.Object(
      {
        items: Type.Array(ApplicationEventView),
        next_cursor: Type.Union([Type.String(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'listAnswerBank',
    method: 'GET',
    path: '/answer-bank',
    auth: 'session',
    summary: 'Stored answers with their reuse scope and sensitivity.',
    query: AnswerBankListQuery,
    response: Type.Object(
      {
        items: Type.Array(AnswerBankEntry),
        next_cursor: Type.Union([Type.String(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'putAnswerBankEntry',
    method: 'PUT',
    path: '/answer-bank',
    auth: 'session',
    summary: 'Store or replace one answer for a question within a scope.',
    body: AnswerBankPutRequest,
    response: AnswerBankEntry,
    successStatus: 200,
    csrf: true,
  },
  {
    operationId: 'fillApplication',
    method: 'POST',
    path: '/applications/:id/fill',
    auth: 'session',
    summary: 'Hand an approved packet to a paired local runner to fill.',
    params: IdParam,
    body: FillApplicationRequest,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'observeApplication',
    method: 'POST',
    path: '/applications/:id/observe',
    auth: 'session',
    summary: "Ask a paired runner whether the employer's page confirms the submission.",
    params: IdParam,
    body: ObserveApplicationRequest,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },

  // --- Milestone M4: paired devices ------------------------------------------
  {
    operationId: 'listDevices',
    method: 'GET',
    path: '/devices',
    auth: 'session',
    summary: 'Paired devices with their status, origins and expiry.',
    response: Type.Object(
      { items: Type.Array(DeviceView), next_cursor: Type.Union([Type.String(), Type.Null()]) },
      { additionalProperties: false },
    ),
    successStatus: 200,
  },
  {
    operationId: 'createDevicePairing',
    method: 'POST',
    path: '/devices/pairing',
    auth: 'session',
    summary: 'Mint a single-use pairing code that expires in five minutes.',
    body: CreatePairingRequest,
    response: PairingCodeResponse,
    successStatus: 201,
    csrf: true,
  },
  {
    operationId: 'exchangeDevicePairing',
    method: 'POST',
    path: '/devices/exchange',
    auth: 'public',
    summary: 'Exchange a pairing code for a scoped device token, once.',
    body: DeviceExchangeRequest,
    response: DeviceExchangeResponse,
    successStatus: 200,
    // The redeeming client is a desktop runner, not a browser: it has no
    // Origin header and no cookie for anyone to ride. See `originExempt`.
    originExempt: true,
  },
  {
    operationId: 'getDevice',
    method: 'GET',
    path: '/devices/:id',
    auth: 'session',
    summary: 'One device and whether its token is still usable.',
    params: IdParam,
    response: DeviceView,
    successStatus: 200,
  },
  {
    operationId: 'revokeDevice',
    method: 'DELETE',
    path: '/devices/:id',
    auth: 'session',
    summary: 'Revoke a device token; denial takes effect on its next request.',
    params: IdParam,
    response: NoContent,
    successStatus: 204,
    csrf: true,
  },
  // --- Milestone M5: scoped fill sessions for the extension ------------------
  //
  // The only routes in the public API authenticated by a device token rather
  // than a session cookie. They are reachable through the proxy because the
  // caller is a browser extension: `/internal/v1`, where the local runner
  // talks, is deliberately not proxied to a browser (10_DEPLOYMENT.md).
  //
  // All three are `originExempt` for the reason documented on that flag: the
  // credential is a header the caller must already hold, not a cookie the
  // victim's browser would attach. An extension's `Origin` is its own
  // `chrome-extension://` id, which no same-origin rule could usefully check
  // against the API's configured origin.
  {
    operationId: 'createFillSession',
    method: 'POST',
    path: '/fill-sessions',
    auth: 'device',
    summary: 'Bind one approved packet to one tab origin for ten minutes.',
    body: CreateFillSessionRequest,
    response: FillSessionGrant,
    successStatus: 201,
    originExempt: true,
  },
  {
    operationId: 'getFillSession',
    method: 'GET',
    path: '/fill-sessions/:id',
    auth: 'device',
    summary: 'Whether this session is still live, without re-issuing its grant.',
    params: IdParam,
    response: FillSessionView,
    successStatus: 200,
  },
  {
    operationId: 'reportFillSession',
    method: 'POST',
    path: '/fill-sessions/:id/report',
    auth: 'device',
    summary: 'Report what was filled and what the page still needs; ends the session.',
    params: IdParam,
    body: ReportFillSessionRequest,
    response: FillSessionView,
    successStatus: 200,
    originExempt: true,
  },
  {
    operationId: 'endFillSession',
    method: 'DELETE',
    path: '/fill-sessions/:id',
    auth: 'device',
    summary: 'Give up a session without reporting a fill.',
    params: IdParam,
    response: NoContent,
    successStatus: 204,
    originExempt: true,
  },

  {
    operationId: 'exportWorkspace',
    method: 'POST',
    path: '/workspace/export',
    auth: 'session',
    summary: 'Package this workspace as a downloadable archive.',
    body: Empty,
    response: AcceptedResponse,
    successStatus: 202,
    requiresIdempotencyKey: true,
    csrf: true,
  },
  {
    operationId: 'deleteWorkspace',
    method: 'DELETE',
    path: '/workspace',
    auth: 'session',
    summary:
      'Delete this workspace: access is revoked at once, then the files and rows are erased.',
    // The one DELETE with a body: the password is the recent authentication,
    // and a password must never travel in a URL.
    body: DeleteWorkspaceRequest,
    response: WorkspaceDeletionView,
    successStatus: 202,
    csrf: true,
  },
  {
    operationId: 'getWorkspaceDeletion',
    method: 'GET',
    path: '/workspace/deletions/:id',
    // Public by necessity: the request that created the receipt also revoked
    // the session that could have read it. The receipt holds no PII, and its
    // id is an unguessable UUID that only the deleting browser was given.
    auth: 'public',
    summary: 'Whether a workspace deletion has finished erasing. Holds no personal data.',
    params: IdParam,
    response: WorkspaceDeletionView,
    successStatus: 200,
  },
  {
    operationId: 'deleteAnswerBankEntry',
    method: 'DELETE',
    path: '/answer-bank/:id',
    auth: 'session',
    summary: 'Forget a stored answer.',
    params: IdParam,
    response: NoContent,
    successStatus: 204,
    csrf: true,
  },
];

export const INTERNAL_PREFIX = '/internal/v1';
