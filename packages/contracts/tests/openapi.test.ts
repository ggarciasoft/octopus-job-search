import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../scripts/generate.js';
import { API_PREFIX, INTERNAL_PREFIX, ROUTES } from '../src/routes.js';

type Json = Record<string, any>;

const document = buildOpenApiDocument() as Json;
const paths = document['paths'] as Json;

function openApiPath(route: (typeof ROUTES)[number]): string {
  return API_PREFIX + route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function operationFor(route: (typeof ROUTES)[number]): Json {
  const item = paths[openApiPath(route)] as Json | undefined;
  expect(item, `no path item for ${route.method} ${openApiPath(route)}`).toBeDefined();
  const operation = item![route.method.toLowerCase()] as Json | undefined;
  expect(operation, `no ${route.method} operation for ${openApiPath(route)}`).toBeDefined();
  return operation!;
}

describe('generated OpenAPI document', () => {
  it('is OpenAPI 3.1 and titled', () => {
    expect(document['openapi']).toBe('3.1.0');
    expect((document['info'] as Json)['title']).toBe('Job Getter API');
    expect(typeof (document['info'] as Json)['version']).toBe('string');
  });

  it('documents every route exactly once, with matching operationId', () => {
    for (const route of ROUTES) {
      expect(operationFor(route)['operationId']).toBe(route.operationId);
    }

    const publicOperationIds: string[] = [];
    for (const [path, item] of Object.entries(paths)) {
      if (!path.startsWith(API_PREFIX)) continue;
      for (const operation of Object.values(item as Json)) {
        publicOperationIds.push((operation as Json)['operationId'] as string);
      }
    }
    expect(publicOperationIds.sort()).toEqual(ROUTES.map((route) => route.operationId).sort());
  });

  it('has globally unique operationIds', () => {
    const ids: string[] = [];
    for (const item of Object.values(paths)) {
      for (const operation of Object.values(item as Json)) {
        ids.push((operation as Json)['operationId'] as string);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents a required Idempotency-Key header on every idempotent command', () => {
    const idempotent = ROUTES.filter((route) => route.requiresIdempotencyKey);
    expect(idempotent.length).toBeGreaterThan(0);
    for (const route of idempotent) {
      const parameters = (operationFor(route)['parameters'] ?? []) as Json[];
      const header = parameters.find(
        (parameter) => parameter['name'] === 'Idempotency-Key' && parameter['in'] === 'header',
      );
      expect(header, `${route.operationId} is missing the Idempotency-Key header`).toBeDefined();
      expect(header!['required']).toBe(true);
    }
  });

  it('never documents an Idempotency-Key on a route that does not require one', () => {
    for (const route of ROUTES) {
      if (route.requiresIdempotencyKey) continue;
      const parameters = (operationFor(route)['parameters'] ?? []) as Json[];
      expect(parameters.some((parameter) => parameter['name'] === 'Idempotency-Key')).toBe(false);
    }
  });

  it('gives public routes no security requirement and every other route exactly one', () => {
    for (const route of ROUTES) {
      const security = operationFor(route)['security'] as unknown[];
      expect(Array.isArray(security), route.operationId).toBe(true);
      if (route.auth === 'public') {
        expect(security, `${route.operationId} must not require auth`).toHaveLength(0);
      } else {
        expect(security.length, `${route.operationId} must require auth`).toBeGreaterThan(0);
        const scheme = Object.keys(security[0] as Json)[0];
        expect(scheme).toBe(
          { session: 'sessionCookie', device: 'deviceToken', worker: 'workerToken' }[route.auth],
        );
      }
    }
  });

  it('declares the three security schemes the specification requires', () => {
    const schemes = (document['components'] as Json)['securitySchemes'] as Json;
    expect(schemes['sessionCookie']).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'jg_session',
    });
    expect(schemes['deviceToken']).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(schemes['workerToken']).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('documents the specified error statuses on every operation', () => {
    for (const route of ROUTES) {
      const responses = operationFor(route)['responses'] as Json;
      for (const status of ['400', '401', '403', '404', '409', '413', '422', '429']) {
        expect(responses[status], `${route.operationId} is missing ${status}`).toBeDefined();
        expect(
          (((responses[status] as Json)['content'] as Json)['application/json'] as Json)['schema'],
        ).toEqual({ $ref: '#/components/schemas/ErrorEnvelope' });
      }
      expect(responses[String(route.successStatus)]).toBeDefined();
    }
  });

  it('uses octet-stream for binary routes and no content for 204 routes', () => {
    for (const route of ROUTES) {
      const success = (operationFor(route)['responses'] as Json)[
        String(route.successStatus)
      ] as Json;
      if (route.successStatus === 204) {
        expect(success['content']).toBeUndefined();
      } else if (route.binaryResponse) {
        expect((success['content'] as Json)['application/octet-stream']).toEqual({
          schema: { type: 'string', format: 'binary' },
        });
      }
    }
  });

  it('uses multipart/form-data only for multipart routes and omits bodies on GET', () => {
    for (const route of ROUTES) {
      const operation = operationFor(route);
      const requestBody = operation['requestBody'] as Json | undefined;
      // A DELETE is bodyless unless it declares a body (deleteWorkspace does).
      if (route.method === 'GET' || (route.method === 'DELETE' && !route.body)) {
        expect(requestBody, `${route.operationId} must not carry a body`).toBeUndefined();
        continue;
      }
      expect(requestBody, `${route.operationId} should document a body`).toBeDefined();
      const contentTypes = Object.keys(requestBody!['content'] as Json);
      expect(contentTypes).toEqual([route.multipart ? 'multipart/form-data' : 'application/json']);
    }
  });

  it('never declares a body on GET, and only deleteWorkspace declares one on DELETE', () => {
    expect(ROUTES.filter((route) => route.method === 'GET' && route.body)).toEqual([]);
    expect(
      ROUTES.filter((route) => route.method === 'DELETE' && route.body).map((r) => r.operationId),
    ).toEqual(['deleteWorkspace']);
  });

  it('references exported schemas instead of inlining them', () => {
    const components = (document['components'] as Json)['schemas'] as Json;
    expect(components['ErrorEnvelope']).toBeDefined();
    expect(components['TaskView']).toBeDefined();
    const getTask = ROUTES.find((route) => route.operationId === 'getTask')!;
    const success = (operationFor(getTask)['responses'] as Json)['200'] as Json;
    expect(((success['content'] as Json)['application/json'] as Json)['schema']).toEqual({
      $ref: '#/components/schemas/TaskView',
    });
  });

  it('resolves every $ref in the document', () => {
    const components = (document['components'] as Json)['schemas'] as Json;
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.push(value);
        else walk(value);
      }
    };
    walk(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('#/components/schemas/'), ref).toBe(true);
      expect(components[ref.slice('#/components/schemas/'.length)], ref).toBeDefined();
    }
  });

  it('documents the internal worker protocol separately, behind the worker credential', () => {
    const expected = [
      `${INTERNAL_PREFIX}/tasks/claim`,
      `${INTERNAL_PREFIX}/tasks/{id}/heartbeat`,
      `${INTERNAL_PREFIX}/tasks/{id}/complete`,
      `${INTERNAL_PREFIX}/tasks/{id}/fail`,
      `${INTERNAL_PREFIX}/tasks/{id}/files/{file_id}`,
      `${INTERNAL_PREFIX}/tasks/{id}/artifacts`,
    ];
    for (const path of expected) {
      const item = paths[path] as Json | undefined;
      expect(item, `missing internal path ${path}`).toBeDefined();
      for (const operation of Object.values(item!) as Json[]) {
        expect(operation['tags']).toEqual(['internal']);
        expect(operation['security']).toEqual([{ workerToken: [] }]);
        expect(String(operation['description'])).toContain('Not publicly routable');
      }
    }
    // Claim returns 204 when there is nothing to do, per 04_API_CONTRACTS.md.
    const claim = (paths[`${INTERNAL_PREFIX}/tasks/claim`] as Json)['post'] as Json;
    expect((claim['responses'] as Json)['204']).toBeDefined();
    expect(
      (
        (((claim['responses'] as Json)['200'] as Json)['content'] as Json)[
          'application/json'
        ] as Json
      )['schema'],
    ).toEqual({ $ref: '#/components/schemas/ClaimResponse' });
  });

  it('never exposes an internal path under the public prefix', () => {
    for (const path of Object.keys(paths)) {
      expect(path.startsWith(API_PREFIX) || path.startsWith(INTERNAL_PREFIX)).toBe(true);
      if (path.startsWith(API_PREFIX)) {
        for (const operation of Object.values(paths[path] as Json) as Json[]) {
          expect(operation['tags']).not.toEqual(['internal']);
        }
      }
    }
  });
});
