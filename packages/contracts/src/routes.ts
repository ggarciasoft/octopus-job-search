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
import { NoopEchoInput } from './tasks/noop-echo.js';
import { TaskView } from './tasks/protocol.js';

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
];

export const INTERNAL_PREFIX = '/internal/v1';
