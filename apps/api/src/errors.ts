/**
 * The error envelope from 04_API_CONTRACTS.md:
 *
 *   {"error":{"code","message","fields","request_id"}}
 *
 * Status mapping (same document): 400 malformed, 401 unauthenticated,
 * 403 forbidden, 404 absent *or inaccessible*, 409 conflict/stale revision,
 * 413 oversized, 422 invalid domain input, 429 quota.
 *
 * Two rules are load-bearing for security:
 *
 *  1. A cross-workspace access attempt must be indistinguishable from a
 *     genuine 404 (09_SECURITY_PRIVACY.md). `notFound()` is therefore the only
 *     way to reject an object the principal may not see — never 403.
 *  2. Internal messages and stack traces never reach the client. Anything that
 *     is not an `ApiError` is reported as INTERNAL_ERROR with a fixed message
 *     and logged server-side instead.
 */
import type { ErrorCode } from '@job-getter/contracts';

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503;

export interface ErrorEnvelopeBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    request_id: string;
  };
}

export class ApiError extends Error {
  readonly status: ErrorStatus;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  /** Detail kept for the log only; never serialised into the response. */
  readonly logDetail?: Record<string, unknown>;
  /** Extra response headers, e.g. `Retry-After` on 429. */
  readonly headers?: Record<string, string>;

  constructor(
    status: ErrorStatus,
    code: ErrorCode,
    message: string,
    options: {
      fields?: Record<string, string>;
      logDetail?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (options.fields) this.fields = options.fields;
    if (options.logDetail) this.logDetail = options.logDetail;
    if (options.headers) this.headers = options.headers;
  }

  toEnvelope(requestId: string): ErrorEnvelopeBody {
    const error: ErrorEnvelopeBody['error'] = {
      code: this.code,
      message: this.message,
      request_id: requestId,
    };
    if (this.fields && Object.keys(this.fields).length > 0) error.fields = this.fields;
    return { error };
  }
}

export function malformed(message = 'The request could not be parsed.'): ApiError {
  return new ApiError(400, 'MALFORMED_REQUEST', message);
}

export function validationError(
  fields: Record<string, string>,
  message = 'Review highlighted fields',
): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', message, { fields });
}

export function unauthenticated(message = 'Authentication is required.'): ApiError {
  return new ApiError(401, 'UNAUTHENTICATED', message);
}

export function forbidden(message = 'This action is not permitted.'): ApiError {
  return new ApiError(403, 'FORBIDDEN', message);
}

/**
 * The single rejection used for "does not exist" and "exists but belongs to
 * another workspace". Callers must not branch on which case it was.
 */
export function notFound(message = 'Not found.'): ApiError {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function conflict(message = 'The request conflicts with the current state.'): ApiError {
  return new ApiError(409, 'CONFLICT', message);
}

export function staleRevision(message = 'The resource changed since it was read.'): ApiError {
  return new ApiError(409, 'STALE_REVISION', message);
}

export function idempotencyMismatch(
  message = 'This Idempotency-Key was already used with a different request body.',
): ApiError {
  return new ApiError(409, 'IDEMPOTENCY_MISMATCH', message);
}

export function payloadTooLarge(message = 'The upload exceeds the permitted size.'): ApiError {
  return new ApiError(413, 'PAYLOAD_TOO_LARGE', message);
}

export function unprocessable(message: string, fields?: Record<string, string>): ApiError {
  return new ApiError(422, 'UNPROCESSABLE', message, fields ? { fields } : {});
}

export function quotaExceeded(retryAfterSeconds?: number): ApiError {
  return new ApiError(429, 'QUOTA_EXCEEDED', 'Too many requests. Try again shortly.', {
    headers: retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : undefined,
  });
}

export function setupClosed(): ApiError {
  return new ApiError(
    409,
    'SETUP_CLOSED',
    'One-time setup has already been completed and cannot be repeated.',
  );
}

export function internalError(logDetail?: Record<string, unknown>): ApiError {
  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.', {
    logDetail: logDetail ?? {},
  });
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

interface PgErrorLike {
  code?: string;
  constraint?: string;
  table?: string;
}

function asPgError(error: unknown): PgErrorLike | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as PgErrorLike;
  return typeof candidate.code === 'string' ? candidate : null;
}

/**
 * Maps PostgreSQL integrity failures onto the contract envelope. Constraint
 * names are kept out of the client-visible message; they go to the log only.
 */
export function mapDatabaseError(error: unknown): ApiError | null {
  const pgError = asPgError(error);
  if (!pgError) return null;
  switch (pgError.code) {
    case UNIQUE_VIOLATION:
      return new ApiError(409, 'CONFLICT', 'This resource already exists.', {
        logDetail: { constraint: pgError.constraint, table: pgError.table },
      });
    case FOREIGN_KEY_VIOLATION:
      // A composite (workspace_id, id) reference failure means the referenced
      // row is absent or in another workspace: report it as absent.
      return new ApiError(404, 'NOT_FOUND', 'Not found.', {
        logDetail: { constraint: pgError.constraint, table: pgError.table },
      });
    case CHECK_VIOLATION:
      return new ApiError(422, 'UNPROCESSABLE', 'The request violates a domain constraint.', {
        logDetail: { constraint: pgError.constraint, table: pgError.table },
      });
    default:
      return null;
  }
}

const FASTIFY_STATUS_CODES: Record<string, ErrorStatus> = {
  FST_ERR_CTP_BODY_TOO_LARGE: 413,
  FST_REQ_FILE_TOO_LARGE: 413,
  FST_PARTS_LIMIT: 413,
  FST_FILES_LIMIT: 413,
  FST_FIELDS_LIMIT: 413,
  FST_ERR_CTP_EMPTY_JSON_BODY: 400,
  FST_ERR_CTP_INVALID_JSON_BODY: 400,
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 400,
  FST_ERR_VALIDATION: 400,
  FST_INVALID_MULTIPART_CONTENT_TYPE: 400,
};

interface FastifyErrorLike {
  code?: string;
  statusCode?: number;
  message?: string;
}

/**
 * Normalises anything thrown inside a handler into an `ApiError`. Unknown
 * failures collapse to a generic 500 so no internal text escapes.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const mapped = mapDatabaseError(error);
  if (mapped) return mapped;

  const fastifyError = (
    typeof error === 'object' && error !== null ? error : {}
  ) as FastifyErrorLike;
  const code = fastifyError.code;
  if (code && FASTIFY_STATUS_CODES[code] !== undefined) {
    const status = FASTIFY_STATUS_CODES[code];
    if (status === 413) return payloadTooLarge();
    return malformed();
  }
  if (fastifyError.statusCode === 429) {
    return quotaExceeded();
  }
  if (fastifyError.statusCode === 404) {
    return notFound();
  }
  if (fastifyError.statusCode === 400) {
    return malformed();
  }

  return internalError({
    thrown: error instanceof Error ? `${error.name}: ${error.message}` : typeof error,
  });
}
