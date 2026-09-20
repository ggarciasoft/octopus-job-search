import { ApiError } from '@job-getter/api-client';
import type { ErrorCode } from '@job-getter/contracts';
import type { MessageKey } from '../i18n/messages';

/**
 * One place that turns a failure into something a person can act on.
 *
 * `CODE_MESSAGES` is typed `Record<ErrorCode, MessageKey>`, so when the
 * contract adds an error code this file stops compiling instead of silently
 * degrading to "an unexpected error occurred".
 */
const CODE_MESSAGES: Record<ErrorCode, MessageKey> = {
  VALIDATION_ERROR: 'error.VALIDATION_ERROR',
  MALFORMED_REQUEST: 'error.MALFORMED_REQUEST',
  UNAUTHENTICATED: 'error.UNAUTHENTICATED',
  FORBIDDEN: 'error.FORBIDDEN',
  NOT_FOUND: 'error.NOT_FOUND',
  CONFLICT: 'error.CONFLICT',
  STALE_REVISION: 'error.STALE_REVISION',
  IDEMPOTENCY_MISMATCH: 'error.IDEMPOTENCY_MISMATCH',
  PAYLOAD_TOO_LARGE: 'error.PAYLOAD_TOO_LARGE',
  UNPROCESSABLE: 'error.UNPROCESSABLE',
  QUOTA_EXCEEDED: 'error.QUOTA_EXCEEDED',
  SETUP_CLOSED: 'error.SETUP_CLOSED',
  BUDGET_EXHAUSTED: 'error.BUDGET_EXHAUSTED',
  PROVIDER_UNAVAILABLE: 'error.PROVIDER_UNAVAILABLE',
  INTERNAL_ERROR: 'error.INTERNAL_ERROR',
};

const STATUS_MESSAGES: Record<number, MessageKey> = {
  400: 'error.MALFORMED_REQUEST',
  401: 'error.UNAUTHENTICATED',
  403: 'error.FORBIDDEN',
  404: 'error.NOT_FOUND',
  409: 'error.CONFLICT',
  413: 'error.PAYLOAD_TOO_LARGE',
  422: 'error.UNPROCESSABLE',
  429: 'error.QUOTA_EXCEEDED',
};

export interface FailureDescription {
  readonly messageKey: MessageKey;
  /** The machine code, shown verbatim next to the message. Never invented. */
  readonly code: string | null;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly fields: Readonly<Record<string, string>>;
  readonly isUnauthenticated: boolean;
  /** 409: the user must reload and reapply, not simply retry. */
  readonly isStale: boolean;
  readonly isRateLimited: boolean;
  /**
   * Whether to reassure the user that their in-progress input is still there.
   * 08_UX_AND_CUSTOMIZATION.md: "Provider/network errors preserve work." The
   * screens never clear a form on failure; this flag only decides whether to
   * say so out loud.
   */
  readonly workPreserved: boolean;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function isNetworkFailure(error: unknown): boolean {
  // `fetch` rejects with a TypeError when the request never reached a server.
  return error instanceof TypeError;
}

export function describeFailure(error: unknown): FailureDescription {
  if (isApiError(error)) {
    const code = error.code;
    const messageKey =
      code in CODE_MESSAGES
        ? CODE_MESSAGES[code as ErrorCode]
        : (STATUS_MESSAGES[error.status] ?? 'error.unexpected');
    const isStale = code === 'STALE_REVISION' || code === 'CONFLICT' || error.status === 409;
    return {
      messageKey,
      code,
      status: error.status,
      requestId: error.requestId,
      fields: error.fields,
      isUnauthenticated: error.status === 401,
      isStale,
      isRateLimited: error.status === 429,
      // A 401 means the session is gone and the screen will be replaced, so
      // promising the input survived would be a lie.
      workPreserved: error.status !== 401,
    };
  }

  return {
    messageKey: isNetworkFailure(error) ? 'error.network' : 'error.unexpected',
    code: null,
    status: null,
    requestId: null,
    fields: {},
    isUnauthenticated: false,
    isStale: false,
    isRateLimited: false,
    workPreserved: true,
  };
}

/** The server's own message, when it sent one worth showing next to ours. */
export function serverMessage(error: unknown): string | null {
  return isApiError(error) && error.message.trim() !== '' ? error.message : null;
}
