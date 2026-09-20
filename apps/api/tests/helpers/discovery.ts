/**
 * Helpers for the M2 discovery suites: synthetic board payloads and the
 * real round trip (route → queue → worker protocol → applied result).
 *
 * The payloads are built inline and validated against the contract schemas
 * before being sent, so a fixture that drifts from `NormalizedJob` or
 * `FetchBoardResult` fails here, loudly, rather than being rejected by the
 * completing transaction and read as a domain bug.
 */
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  FetchBoardResult,
  FetchJobResult,
  NormalizedJob,
  PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  type ClaimResponse,
  type ScanView,
  type SourceView,
  type TaskType,
} from '@job-getter/contracts';
import { asWorker, authed, idempotencyKey, type Harness, type Session } from './harness.js';

export const BOARD = 'acme';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface JobOverrides extends Partial<NormalizedJob> {
  readonly external_id: string;
  readonly board?: string;
  readonly connector?: 'greenhouse' | 'lever';
}

/** A minimal, contract-valid Greenhouse-shaped posting. */
export function normalizedJob(overrides: JobOverrides): NormalizedJob {
  const { board = BOARD, connector = 'greenhouse', external_id, ...rest } = overrides;
  const description = rest.description_text ?? `Role ${external_id} at Acme.`;
  const job: NormalizedJob = {
    external_id,
    source_key: `${connector}:${board}:${external_id}`,
    canonical_url: `https://boards.greenhouse.io/${board}/jobs/${external_id}`,
    apply_url: `https://boards.greenhouse.io/${board}/jobs/${external_id}#app`,
    company: 'Acme',
    title: `Engineer ${external_id}`,
    description_text: description,
    published_at: null,
    updated_at: null,
    locations: [{ country: 'ES', region: null, city: 'Madrid', source_excerpt: 'Madrid, Spain' }],
    remote_type: 'unknown',
    eligible_countries: null,
    employment_type: null,
    salary: null,
    language: null,
    requirements: [],
    inferred: [],
    content_hash: sha256(description),
    retrieved_at: new Date().toISOString(),
    ...rest,
  };
  expect(
    Value.Check(NormalizedJob, job),
    JSON.stringify([...Value.Errors(NormalizedJob, job)]),
  ).toBe(true);
  return job;
}

export function boardResult(
  jobs: readonly NormalizedJob[],
  overrides: Partial<FetchBoardResult> = {},
): FetchBoardResult {
  const result: FetchBoardResult = {
    jobs: [...jobs],
    complete_snapshot: true,
    next_cursor: null,
    pages_fetched: 1,
    etag: null,
    last_modified: null,
    observed_health: { state: 'ok', http_status: 200, retry_after_seconds: null },
    warnings: [],
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
  expect(
    Value.Check(FetchBoardResult, result),
    JSON.stringify([...Value.Errors(FetchBoardResult, result)]),
  ).toBe(true);
  return result;
}

export function jobResult(
  job: NormalizedJob | null,
  overrides: Partial<FetchJobResult> = {},
): FetchJobResult {
  const result: FetchJobResult = {
    job,
    candidates: [],
    fetch: {
      performed: true,
      final_url: job?.canonical_url ?? null,
      http_status: 200,
      content_type: 'text/html',
      bytes: 2048,
      redirects: 0,
      extraction: 'jsonld_jobposting',
    },
    warnings: [],
    ...overrides,
  };
  expect(Value.Check(FetchJobResult, result)).toBe(true);
  return result;
}

/** A denial result: nothing fetched, the board answered 403 or 429. */
export function deniedResult(
  code: 'ACCESS_DENIED' | 'RATE_LIMITED',
  options: { retryAfterSeconds?: number | null; fetchedAt?: string } = {},
): FetchBoardResult {
  const status = code === 'RATE_LIMITED' ? 429 : 403;
  return boardResult([], {
    complete_snapshot: false,
    pages_fetched: 0,
    observed_health: {
      state: 'degraded',
      http_status: status,
      retry_after_seconds: options.retryAfterSeconds ?? null,
    },
    warnings: [{ code, message: `The board answered HTTP ${status}.` }],
    ...(options.fetchedAt ? { fetched_at: options.fetchedAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// Driving the real routes
// ---------------------------------------------------------------------------

export async function createSource(
  harness: Harness,
  session: Session,
  body: Record<string, unknown> = { connector: 'greenhouse', board_key: BOARD },
): Promise<SourceView> {
  const response = await harness.app.inject(
    authed(session, { method: 'POST', url: '/api/v1/sources', payload: body }),
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as SourceView;
}

export function queueScan(
  harness: Harness,
  session: Session,
  sourceId: string,
  key = idempotencyKey(),
) {
  return harness.app.inject(
    authed(session, {
      method: 'POST',
      url: `/api/v1/sources/${sourceId}/scan`,
      headers: { 'idempotency-key': key },
      payload: {},
    }),
  );
}

export async function claimTask(
  harness: Harness,
  type: TaskType,
  workerId = 'worker-1',
): Promise<ClaimResponse | null> {
  const response = await harness.app.inject(
    asWorker({
      method: 'POST',
      url: '/internal/v1/tasks/claim',
      payload: { worker_id: workerId, capabilities: [type], protocol_version: PROTOCOL_VERSION },
    }),
  );
  if (response.statusCode === 204) return null;
  expect(response.statusCode).toBe(200);
  return response.json() as ClaimResponse;
}

export function completeTask(
  harness: Harness,
  taskId: string,
  leaseToken: string,
  result: unknown,
) {
  return harness.app.inject(
    asWorker({
      method: 'POST',
      url: `/internal/v1/tasks/${taskId}/complete`,
      payload: { lease_token: leaseToken, result_schema_version: RESULT_SCHEMA_VERSION, result },
    }),
  );
}

export function failTask(
  harness: Harness,
  taskId: string,
  leaseToken: string,
  body: { code: string; retryable: boolean; redacted_message: string },
  headers: Record<string, string> = {},
) {
  return harness.app.inject(
    asWorker({
      method: 'POST',
      url: `/internal/v1/tasks/${taskId}/fail`,
      headers,
      payload: { lease_token: leaseToken, ...body },
    }),
  );
}

export async function readScan(harness: Harness, session: Session, id: string): Promise<ScanView> {
  const response = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/scans/${id}` }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ScanView;
}

/** Queues, claims and completes one scan; returns the applied scan view. */
export async function runScan(
  harness: Harness,
  session: Session,
  sourceId: string,
  result: FetchBoardResult,
): Promise<{ taskId: string; scan: ScanView }> {
  const queued = await queueScan(harness, session, sourceId);
  expect(queued.statusCode, queued.body).toBe(202);
  const taskId = queued.json().task_id as string;

  const claimed = await claimTask(harness, 'fetch_board');
  expect(claimed?.task_id).toBe(taskId);
  const completed = await completeTask(harness, taskId, claimed!.lease_token, result);
  expect(completed.statusCode, completed.body).toBe(200);
  expect(completed.json().state).toBe('succeeded');

  return { taskId, scan: await readScan(harness, session, taskId) };
}

export async function listJobs(
  harness: Harness,
  session: Session,
  query = '',
): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
  const response = await harness.app.inject(
    authed(session, { method: 'GET', url: `/api/v1/jobs${query ? `?${query}` : ''}` }),
  );
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

export function readJob(harness: Harness, session: Session, id: string) {
  return harness.app.inject(authed(session, { method: 'GET', url: `/api/v1/jobs/${id}` }));
}

export function hoursAgo(hours: number, from = new Date()): string {
  return new Date(from.getTime() - hours * 60 * 60 * 1000).toISOString();
}
