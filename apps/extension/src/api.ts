/**
 * The extension's API client: a thin fetcher, deliberately not the generated
 * one.
 *
 * `@job-getter/api-client` is session-and-cookie shaped, which is exactly what
 * this caller must not be. The extension authenticates with `x-device-token`
 * and a per-session nonce, sends no credentials, and reaches only the four
 * `/fill-sessions` routes — the entire API surface a device token can touch.
 *
 * `credentials: 'omit'` is not a default worth inheriting silently. If the user
 * is signed in to their own installation in another tab, an extension request
 * that carried cookies would authenticate as *them* rather than as the paired
 * device, and the API's separation between the two credentials would quietly
 * stop being a separation at all.
 */
import {
  DEVICE_TOKEN_HEADER,
  FILL_SESSION_NONCE_HEADER,
  type CreateFillSessionRequest,
  type FillSessionGrant,
  type FillSessionView,
  type ReportFillSessionRequest,
} from '@job-getter/contracts';

export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export class FillSessionApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'FillSessionApiError';
    this.status = error.status;
    this.code = error.code;
  }
}

export interface ApiOptions {
  /** The user's own installation, e.g. `http://127.0.0.1:3000`. */
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

async function request<T>(
  options: ApiOptions,
  path: string,
  init: { method: string; body?: unknown; nonce?: string },
): Promise<T> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { [DEVICE_TOKEN_HEADER]: options.token };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.nonce !== undefined) headers[FILL_SESSION_NONCE_HEADER] = init.nonce;

  const response = await doFetch(`${options.baseUrl}/api/v1${path}`, {
    method: init.method,
    headers,
    // Never the user's cookies. See the module comment.
    credentials: 'omit',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);

  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string } }).error ?? {};
    throw new FillSessionApiError({
      status: response.status,
      code: error.code ?? 'UNKNOWN',
      message: error.message ?? `The request failed with ${response.status}.`,
    });
  }
  return parsed as T;
}

export function createFillSession(
  options: ApiOptions,
  body: CreateFillSessionRequest,
): Promise<FillSessionGrant> {
  return request(options, '/fill-sessions', { method: 'POST', body });
}

export function getFillSession(
  options: ApiOptions,
  id: string,
  nonce: string,
): Promise<FillSessionView> {
  return request(options, `/fill-sessions/${id}`, { method: 'GET', nonce });
}

export function reportFillSession(
  options: ApiOptions,
  id: string,
  nonce: string,
  body: ReportFillSessionRequest,
): Promise<FillSessionView> {
  return request(options, `/fill-sessions/${id}/report`, { method: 'POST', body, nonce });
}

export function endFillSession(options: ApiOptions, id: string, nonce: string): Promise<void> {
  return request(options, `/fill-sessions/${id}`, { method: 'DELETE', nonce });
}

export interface ResumeBytes {
  readonly name: string;
  readonly bytes: number[];
}

/**
 * The CV this session's packet was approved with.
 *
 * The filename comes from `content-disposition`, which the API has already
 * sanitised — the extension does not get to invent one, and it does not read
 * the employer's page for it either.
 */
export async function downloadFillSessionResume(
  options: ApiOptions,
  id: string,
  nonce: string,
  fallbackName: string,
): Promise<ResumeBytes> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(`${options.baseUrl}/api/v1/fill-sessions/${id}/resume`, {
    method: 'GET',
    headers: { [DEVICE_TOKEN_HEADER]: options.token, [FILL_SESSION_NONCE_HEADER]: nonce },
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new FillSessionApiError({
      status: response.status,
      code: 'RESUME_UNAVAILABLE',
      message: `The CV could not be downloaded (${response.status}).`,
    });
  }
  const buffer = await response.arrayBuffer();
  return {
    name: filenameFrom(response.headers.get('content-disposition')) ?? fallbackName,
    bytes: Array.from(new Uint8Array(buffer)),
  };
}

function filenameFrom(header: string | null): string | null {
  if (header === null) return null;
  const quoted = /filename="([^"]+)"/.exec(header);
  return quoted?.[1] ?? null;
}
