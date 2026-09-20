/**
 * The route manifest is the contract between this API, the generated client
 * and the OpenAPI document. These tests assert both directions:
 *
 *  * every `ROUTES` entry is either registered or explicitly deferred, and
 *  * no public route exists that the manifest does not declare.
 *
 * The second direction is the one that matters for security: an endpoint that
 * exists but is not in the contract is an endpoint nobody reviews.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, INTERNAL_PREFIX, ROUTES } from '@job-getter/contracts';
import { buildApp, type RegisteredRoute } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logging.js';
import { LocalStorageDriver } from '../../src/files/storage.js';
import {
  DEFERRED_OPERATIONS,
  OPERATIONAL_ROUTES,
  registeredOperations,
} from '../../src/routes/index.js';
import { testEnv } from '../helpers/harness.js';

let routes: readonly RegisteredRoute[];
let close: () => Promise<void>;

beforeAll(async () => {
  // No database is needed: building the app registers routes without querying.
  const config = loadConfig(testEnv({ DATABASE_URL: 'postgres://unused:5432/none' }));
  const built = await buildApp(config, {
    storage: new LocalStorageDriver(config.filesRoot),
    logger: createLogger({ level: 'silent' }),
    rateLimitEnabled: false,
  });
  routes = built.routes;
  close = async () => {
    await built.app.close();
    await built.context.pool.end().catch(() => undefined);
  };
});

afterAll(async () => {
  await close();
});

function publicRoutes(): RegisteredRoute[] {
  return routes.filter((route) => route.url.startsWith(API_PREFIX));
}

describe('route manifest', () => {
  it('registers every ROUTES entry that is not explicitly deferred', () => {
    const registered = new Set(registeredOperations());
    const missing = ROUTES.filter(
      (route) =>
        !registered.has(route.operationId) && DEFERRED_OPERATIONS[route.operationId] === undefined,
    ).map((route) => `${route.method} ${route.path} (${route.operationId})`);

    expect(missing).toEqual([]);
  });

  it('serves each registered manifest entry at its declared method and path', () => {
    const served = new Set(publicRoutes().map((route) => `${route.method} ${route.url}`));
    for (const operationId of registeredOperations()) {
      const definition = ROUTES.find((route) => route.operationId === operationId);
      expect(definition, `manifest entry for ${operationId}`).toBeDefined();
      expect(served).toContain(`${definition!.method} ${API_PREFIX}${definition!.path}`);
    }
  });

  it('exposes no public route the manifest does not declare', () => {
    const declared = new Set(ROUTES.map((route) => `${route.method} ${API_PREFIX}${route.path}`));
    const undeclared = publicRoutes()
      .map((route) => `${route.method} ${route.url}`)
      .filter((key) => !declared.has(key));

    expect(undeclared).toEqual([]);
  });

  it('documents every deferred operation with the milestone that owns it', () => {
    // The list must describe only real manifest entries, so an operation that
    // is later implemented cannot be quietly left "deferred" forever.
    for (const operationId of Object.keys(DEFERRED_OPERATIONS)) {
      expect(
        ROUTES.some((route) => route.operationId === operationId),
        `${operationId} is deferred but is not in ROUTES`,
      ).toBe(true);
      expect(DEFERRED_OPERATIONS[operationId]).toMatch(/^M\d/);
    }
  });

  it('defers exactly the M2 and M6 surfaces and nothing else', () => {
    // M1 landed: profile, imports, preferences and provider settings are all
    // registered. M2's contracts exist ahead of its routes, so its ten
    // operations are deferred; the three M6 routes need an email service.
    // This list is pinned on purpose: registering a route must delete its
    // entry here, and deferring a new one must add it, explicitly.
    expect(Object.keys(DEFERRED_OPERATIONS).sort()).toEqual(
      [
        'listSources',
        'createSource',
        'patchSource',
        'deleteSource',
        'scanSource',
        'getScan',
        'importJob',
        'listJobs',
        'getJob',
        'patchJob',
        'confirmPasswordReset',
        'register',
        'requestPasswordReset',
      ].sort(),
    );
  });

  it('registers the whole M1 surface', () => {
    const registered = new Set(registeredOperations());
    for (const operationId of [
      'getProfile',
      'patchProfile',
      'createProfileImport',
      'getProfileImport',
      'confirmProfileImport',
      'getPreferences',
      'putPreferences',
      'getProviderSettings',
      'putProviderSettings',
      'testProviderSettings',
    ]) {
      expect(registered.has(operationId), operationId).toBe(true);
    }
  });

  it('keeps internal worker routes out of the public manifest', () => {
    const internal = routes.filter((route) => route.url.startsWith(INTERNAL_PREFIX));
    expect(internal.length).toBeGreaterThan(0);

    for (const route of internal) {
      expect(
        ROUTES.some((manifest) => `${API_PREFIX}${manifest.path}` === route.url),
        `${route.url} must not appear in the public contract`,
      ).toBe(false);
    }
  });

  it('serves only documented operational routes outside the two prefixes', () => {
    const other = routes
      .filter(
        (route) => !route.url.startsWith(API_PREFIX) && !route.url.startsWith(INTERNAL_PREFIX),
      )
      .map((route) => `${route.method} ${route.url}`);

    expect(other.sort()).toEqual(Object.keys(OPERATIONAL_ROUTES).sort());
  });

  it('marks the idempotent commands the contract requires', () => {
    const diagnostics = ROUTES.find((route) => route.operationId === 'createDiagnosticTask');
    expect(diagnostics?.requiresIdempotencyKey).toBe(true);
  });
});
