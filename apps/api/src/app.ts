/**
 * `buildApp` returns a fully configured Fastify instance and starts nothing.
 *
 * No listener, no scheduler, no pool creation unless one is not supplied. That
 * is what lets the test suite build the real application against an ephemeral
 * PostgreSQL container and exercise it with `app.inject`, rather than testing
 * a parallel wiring that production never uses.
 */
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { TSchema } from '@sinclair/typebox';
import type pg from 'pg';
import type { Config } from './config.js';
import { createDb, createPool, type Db } from './db/pool.js';
import { ApiError, toApiError, validationError } from './errors.js';
import { registerHealthRoutes } from './health.js';
import { generateRequestId, loggerFromConfig, type Logger } from './logging.js';
import { createStorageDriver, type StorageDriver } from './files/storage.js';
import { registerApiRoutes } from './routes/index.js';
import { registerInternalRoutes } from './routes/internal.js';
import type { RouteContext } from './routes/context.js';
import { Value, compile, registerFormats, toFieldErrors } from './validation.js';

export interface BuildAppDeps {
  readonly pool?: pg.Pool;
  readonly db?: Db;
  readonly storage?: StorageDriver;
  readonly logger?: Logger;
  /** Disable rate limiting for suites that drive many requests in a loop. */
  readonly rateLimitEnabled?: boolean;
}

export interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  readonly context: RouteContext;
  /** True when `buildApp` created the pool and therefore owns closing it. */
  readonly ownsPool: boolean;
  /**
   * Every route this instance actually serves, collected from Fastify's
   * `onRoute` hook. The manifest test asserts this against `ROUTES` so an
   * undeclared public endpoint cannot appear unnoticed.
   */
  readonly routes: readonly RegisteredRoute[];
}

export async function buildApp(config: Config, deps: BuildAppDeps = {}): Promise<BuiltApp> {
  // TypeBox's FormatRegistry is a global singleton that starts empty, and an
  // unregistered `format` makes validation *fail* rather than skip. The
  // contracts package registers `uuid` and `date-time` as an import side
  // effect, but calling it explicitly here means a future refactor to a
  // types-only import cannot silently disarm every schema in the system.
  registerFormats();

  const ownsPool = deps.pool === undefined;
  const pool = deps.pool ?? createPool({ connectionString: config.databaseUrl });
  const db = deps.db ?? createDb(pool);
  const storage = deps.storage ?? createStorageDriver(config);
  const logger = deps.logger ?? loggerFromConfig(config);

  const app = Fastify({
    // pino's `Logger` is structurally a superset of `FastifyBaseLogger`;
    // Fastify's generic defaults to the latter, so the instance is widened
    // rather than making every route generic over the concrete logger type.
    loggerInstance: logger as FastifyBaseLogger,
    genReqId: generateRequestId,
    // No proxy headers are trusted: `request.ip` must be the real peer for the
    // setup source check and for rate limiting to mean anything.
    trustProxy: false,
    bodyLimit: config.maxUploadBytes,
    // Fastify's own request/response lines are suppressed in favour of the
    // single structured line emitted by the onResponse hook below, which
    // carries request_id, route, status and duration together. Fastify 5
    // deprecates this flag in favour of `logController`, but that option's
    // type requires supplying the whole controller; the flag is kept until
    // Fastify 6 makes the replacement partial.
    disableRequestLogging: true,
  });

  const context: RouteContext = { config, db, pool, storage, logger };

  // Registered before any route so the record is complete. Fastify adds an
  // implicit HEAD for every GET; it is excluded because it is not a distinct
  // contract entry.
  const routes: RegisteredRoute[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD') continue;
      routes.push({ method, url: route.url });
    }
  });

  // --- Validation -----------------------------------------------------------
  // TypeBox compiles the contract schemas directly, so `additionalProperties:
  // false` and `format: uuid` behave exactly as the contract package declares
  // them rather than as an Ajv configuration happens to interpret them.
  app.setValidatorCompiler(({ schema, httpPart }) => {
    const compiled = compile(schema as TSchema);
    // Path and query values always arrive as strings. Fastify's default Ajv
    // setup coerces them; TypeBox does not, so `?limit=2` would fail an
    // integer schema. `Value.Convert` performs the same widening for those
    // parts only — a JSON body is never coerced, because there "2" and 2 are
    // genuinely different and silently accepting both hides client bugs.
    const coerce = httpPart === 'querystring' || httpPart === 'params' || httpPart === 'headers';
    return (data: unknown) => {
      const value = coerce ? Value.Convert(schema as TSchema, data) : data;
      if (compiled.Check(value)) return { value };
      return { error: validationError(toFieldErrors(compiled.Errors(value))) };
    };
  });

  // --- Security headers -----------------------------------------------------
  await app.register(helmet, {
    // This service returns JSON and file attachments only; a restrictive CSP
    // costs nothing here and blocks anything that manages to get rendered.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isHosted ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  // No CORS plugin is registered anywhere. A wildcard CORS policy with
  // credentials is explicitly forbidden (09_SECURITY_PRIVACY.md), and the web
  // client is served from the same origin behind the reverse proxy.

  await app.register(cookie, { secret: undefined, parseOptions: {} });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 8,
      fieldSize: 64 * 1024,
      parts: 12,
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: deps.rateLimitEnabled === false ? 100_000 : 600,
    timeWindow: '1 minute',
    // Internal worker polling is high-frequency by design and authenticated by
    // a bearer token, so it is not part of the anti-guessing budget.
    allowList: () => false,
    keyGenerator: (request) => `${request.ip}:${request.routeOptions.url ?? request.url}`,
  });

  // --- Request logging ------------------------------------------------------
  app.addHook('onRequest', async (request) => {
    request.principal = null;
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        request_id: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        status: reply.statusCode,
        duration_ms: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });

  // --- Error envelope -------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    const apiError = toApiError(error);

    const logPayload = {
      request_id: request.id,
      route: request.routeOptions.url ?? request.url,
      error_code: apiError.code,
      status: apiError.status,
      ...(apiError.logDetail ?? {}),
    };

    if (apiError.status >= 500) {
      // The full error, including its stack, is logged here and nowhere else:
      // the response body below carries a fixed message only.
      logger.error({ ...logPayload, err: error }, 'request failed');
    } else {
      logger.warn(logPayload, 'request rejected');
    }

    for (const [name, value] of Object.entries(apiError.headers ?? {})) {
      void reply.header(name, value);
    }

    return reply.status(apiError.status).send(apiError.toEnvelope(request.id));
  });

  app.setNotFoundHandler(
    { preHandler: app.rateLimit() },
    (request, reply) => {
      const error = new ApiError(404, 'NOT_FOUND', 'Not found.');
      return reply.status(404).send(error.toEnvelope(request.id));
    },
  );

  // --- Routes ---------------------------------------------------------------
  registerHealthRoutes(app, { config, pool, storage, startedAt: Date.now() });
  registerApiRoutes(app, context, { rateLimitEnabled: deps.rateLimitEnabled ?? true });
  registerInternalRoutes(app, context);

  await app.ready();
  return { app, context, ownsPool, routes };
}
