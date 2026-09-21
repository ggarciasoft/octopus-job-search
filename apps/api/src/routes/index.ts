/**
 * Public route registration, driven by the `ROUTES` manifest.
 *
 * Routes are not written out by hand here: the manifest from
 * `@job-getter/contracts` is iterated and each entry is matched to a handler
 * by `operationId`. A route therefore cannot exist in the API but be missing
 * from the contract, and `tests/routes/manifest.test.ts` asserts the reverse
 * direction as well — every manifest entry is either registered or listed in
 * `DEFERRED_OPERATIONS` below.
 *
 * Authentication, origin verification and anti-CSRF are all derived from the
 * manifest flags, so a new route gets them by declaration rather than by the
 * author remembering.
 */
import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import { API_PREFIX, ROUTES, type RouteDefinition } from '@job-getter/contracts';
import { isStateChanging, verifyCsrfToken, verifyOrigin } from '../auth/csrf.js';
import { resolveSession } from '../auth/sessions.js';
import { unauthenticated } from '../errors.js';
import { completeSetup, getSetupStatus } from './setup.js';
import { login, logout } from './auth.js';
import { getMe } from './me.js';
import { cancelTaskRoute, getTask, listTasks } from './tasks.js';
import { createDiagnosticTask } from './diagnostics.js';
import { downloadFile, uploadFile } from './files.js';
import { getProfile, patchProfile } from './profile.js';
import { confirmProfileImport, createProfileImport, getProfileImport } from './imports.js';
import { getPreferences, putPreferences } from './preferences.js';
import { getProviderSettings, putProviderSettings, testProviderSettings } from './providers.js';
import { createSource, deleteSource, listSources, patchSource, scanSource } from './sources.js';
import { getScan } from './scans.js';
import { getJob, importJob, listJobs, matchJob, patchJob } from './jobs.js';
import { approveResume, createResume, getResume } from './resumes.js';
import type { RouteContext, RouteHandler } from './context.js';

/**
 * Manifest entries that this milestone deliberately does not register.
 *
 * Invariant 10 and "Never replace missing backend behaviour with a button that
 * reports success": an unimplemented route is *absent*, so the generated
 * client fails at the call site and the UI can show an honest "not built yet"
 * state. It is not a 200 with an empty object, and not a 501 pretending to be
 * a feature flag.
 *
 * `tests/routes/manifest.test.ts` asserts this list exactly, so an agent
 * that implements a deferred route must delete its entry here for the suite
 * to pass — the list cannot rot silently. M1 and M2 have done so; only the
 * three routes that need an email service remain.
 */
export const DEFERRED_OPERATIONS: Readonly<Record<string, string>> = {
  // --- Milestone M6: hosted authentication (needs email delivery) --------
  register: 'M6 — hosted invitation signup requires the email service',
  requestPasswordReset: 'M6 — password reset requires the email service',
  confirmPasswordReset: 'M6 — password reset requires the email service',
};

/** Non-manifest routes this service exposes, and why. Asserted by the tests. */
export const OPERATIONAL_ROUTES: Readonly<Record<string, string>> = {
  'GET /health/live': 'liveness probe (process only) — 10_DEPLOYMENT.md',
  'GET /health/ready': 'readiness probe (database, schema, storage) — 10_DEPLOYMENT.md',
};

/**
 * Built on demand rather than as a module-level constant.
 *
 * `routes/capabilities.ts` reads `DEFERRED_OPERATIONS` from this module, and
 * `routes/me.ts` reads `capabilities.ts`, so this module sits in an import
 * cycle with the handler modules it names. Evaluating the table eagerly makes
 * its contents depend on which module an entry point happened to load first —
 * a handler imported while its own module was still initialising would be
 * `undefined`, and the route would silently fail to register. Building it
 * inside a function defers every read until after all modules have finished
 * evaluating, so the table is complete regardless of entry point.
 */
function handlers(): Readonly<Record<string, RouteHandler>> {
  return {
    getSetupStatus,
    completeSetup,
    login,
    logout,
    getMe,
    uploadFile,
    downloadFile,
    getTask,
    listTasks,
    cancelTask: cancelTaskRoute,
    createDiagnosticTask,
    getProfile,
    patchProfile,
    createProfileImport,
    getProfileImport,
    confirmProfileImport,
    getPreferences,
    putPreferences,
    getProviderSettings,
    putProviderSettings,
    testProviderSettings,
    listSources,
    createSource,
    patchSource,
    deleteSource,
    scanSource,
    getScan,
    importJob,
    listJobs,
    getJob,
    matchJob,
    patchJob,
    createResume,
    getResume,
    approveResume,
  };
}

/** Rate limits for the credential-guessing surface (09_SECURITY_PRIVACY.md). */
const ROUTE_RATE_LIMITS: Readonly<Record<string, { max: number; timeWindow: string }>> = {
  login: { max: 10, timeWindow: '1 minute' },
  completeSetup: { max: 5, timeWindow: '1 minute' },
  register: { max: 5, timeWindow: '1 minute' },
  requestPasswordReset: { max: 5, timeWindow: '1 minute' },
  confirmPasswordReset: { max: 5, timeWindow: '1 minute' },
};

export interface RegisterRoutesOptions {
  /** Disables per-route rate limiting; used by suites that drive many calls. */
  readonly rateLimitEnabled?: boolean;
}

/**
 * Builds the per-route preHandler chain from the manifest flags.
 *
 * Order matters: origin verification runs before authentication so a
 * cross-origin probe learns nothing about whether a session exists.
 */
function buildPreHandler(
  context: RouteContext,
  route: RouteDefinition,
): (request: FastifyRequest) => Promise<void> {
  return async (request: FastifyRequest) => {
    if (isStateChanging(route.method)) {
      verifyOrigin(context.config, request);
    }

    const session = await resolveSession(context.db, request);
    request.principal = session?.principal ?? null;

    if (route.auth === 'session' && request.principal === null) {
      throw unauthenticated('Sign in to continue.');
    }

    if (route.csrf === true) {
      verifyCsrfToken(context.config, request.principal, request);
    }
  };
}

export function registerApiRoutes(
  app: FastifyInstance,
  context: RouteContext,
  options: RegisterRoutesOptions = {},
): void {
  const rateLimitEnabled = options.rateLimitEnabled ?? true;

  app.register(
    async (api) => {
      const table = handlers();
      for (const route of ROUTES) {
        const handler = table[route.operationId];
        if (!handler) {
          if (DEFERRED_OPERATIONS[route.operationId] === undefined) {
            // A manifest entry with neither a handler nor a documented
            // deferral is a mistake that must fail loudly at boot.
            throw new Error(
              `Route "${route.operationId}" (${route.method} ${route.path}) has no handler and ` +
                'is not listed in DEFERRED_OPERATIONS.',
            );
          }
          continue;
        }

        const rateLimit = ROUTE_RATE_LIMITS[route.operationId];
        const routeOptions: RouteOptions = {
          method: route.method,
          url: route.path,
          preHandler: buildPreHandler(context, route),
          handler: async (request, reply) => handler(context, request, reply),
          schema: buildSchema(route),
          config:
            rateLimit && rateLimitEnabled
              ? { rateLimit: { max: rateLimit.max, timeWindow: rateLimit.timeWindow } }
              : {},
        };

        api.route(routeOptions);
      }
    },
    { prefix: API_PREFIX },
  );
}

/**
 * Only *request* schemas are attached.
 *
 * Response schemas are validated in the contract tests with `Value.Check`
 * rather than handed to Fastify's serializer: fast-json-stringify silently
 * drops properties a schema does not mention, which would turn a contract
 * mismatch into missing data in production instead of a failing test.
 */
function buildSchema(route: RouteDefinition): RouteOptions['schema'] {
  const schema: Record<string, unknown> = {};
  if (route.params) schema['params'] = route.params;
  if (route.query) schema['query'] = route.query;
  // Multipart bodies are parsed by @fastify/multipart, not by the JSON
  // validator; attaching a schema would reject the stream.
  if (route.body && !route.multipart) schema['body'] = route.body;
  return schema;
}

/** The public surface this build actually serves. Used by the manifest test. */
export function registeredOperations(): string[] {
  const table = handlers();
  return ROUTES.filter((route) => table[route.operationId] !== undefined).map(
    (route) => route.operationId,
  );
}
