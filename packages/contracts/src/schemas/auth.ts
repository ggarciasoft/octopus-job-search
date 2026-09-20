import { Type, type Static } from '@sinclair/typebox';
import { Locale, Timestamp, Uuid, WorkspaceMode } from '../common.js';

const Email = Type.String({ minLength: 3, maxLength: 320 });
/** Argon2id hashing is applied server-side; the API never stores the plaintext. */
const Password = Type.String({ minLength: 12, maxLength: 200 });

/**
 * One-time local bootstrap. The setup token is printed to the local terminal
 * only and the route permanently closes once an owner exists
 * (09_SECURITY_PRIVACY.md).
 */
export const SetupRequest = Type.Object(
  {
    setup_token: Type.String({ minLength: 16, maxLength: 200 }),
    email: Email,
    password: Password,
    locale: Type.Optional(Locale),
  },
  { additionalProperties: false },
);
export type SetupRequest = Static<typeof SetupRequest>;

export const LoginRequest = Type.Object(
  { email: Email, password: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
export type LoginRequest = Static<typeof LoginRequest>;

export const RegisterRequest = Type.Object(
  { email: Email, password: Password, invite_code: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
export type RegisterRequest = Static<typeof RegisterRequest>;

export const SetupStatus = Type.Object(
  {
    mode: WorkspaceMode,
    setup_required: Type.Boolean(),
    registration_open: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SetupStatus = Static<typeof SetupStatus>;

/**
 * Capability flags let the UI describe honestly what is available instead of
 * showing controls that silently do nothing (invariant 10).
 */
export const Capabilities = Type.Object(
  {
    implemented_task_types: Type.Array(Type.String()),
    ai_provider_configured: Type.Boolean(),
    profile_import: Type.Boolean(),
    job_discovery: Type.Boolean(),
    cv_generation: Type.Boolean(),
    applications: Type.Boolean(),
    browser_filling: Type.Boolean(),
    extension: Type.Boolean(),
    worker_online: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type Capabilities = Static<typeof Capabilities>;

export const UsageSummary = Type.Object(
  {
    ai_requests_today: Type.Integer({ minimum: 0 }),
    ai_requests_per_day_limit: Type.Integer({ minimum: 0 }),
    input_tokens_today: Type.Integer({ minimum: 0 }),
    output_tokens_today: Type.Integer({ minimum: 0 }),
    /** Null when no rate card is configured: unknown cost is never zero. */
    measured_cost_today: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    currency: Type.Union([Type.String({ pattern: '^[A-Z]{3}$' }), Type.Null()]),
    daily_cost_budget: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type UsageSummary = Static<typeof UsageSummary>;

export const MeResponse = Type.Object(
  {
    user: Type.Object(
      { id: Uuid, email: Email, verified_at: Type.Union([Timestamp, Type.Null()]) },
      { additionalProperties: false },
    ),
    workspace: Type.Object(
      { id: Uuid, mode: WorkspaceMode, locale: Locale, role: Type.Literal('owner') },
      { additionalProperties: false },
    ),
    mode: WorkspaceMode,
    capabilities: Capabilities,
    usage: UsageSummary,
  },
  { additionalProperties: false },
);
export type MeResponse = Static<typeof MeResponse>;

export const PasswordResetRequest = Type.Object({ email: Email }, { additionalProperties: false });
export const PasswordResetConfirm = Type.Object(
  { token: Type.String({ minLength: 16, maxLength: 400 }), new_password: Password },
  { additionalProperties: false },
);
