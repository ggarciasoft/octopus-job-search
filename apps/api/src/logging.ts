/**
 * Structured JSON logging with mandatory redaction (09_SECURITY_PRIVACY.md:
 * "Do not log CV text, answers, tokens or raw prompts").
 *
 * The defence is layered because a single redaction list is easy to outgrow:
 *
 *  1. Request/response serialisers emit an explicit allowlist of fields. A new
 *     header or body property cannot leak by simply existing.
 *  2. `redact.paths` censors the known-sensitive keys anywhere they appear in
 *     a manually logged object.
 *  3. `SENSITIVE_KEY_PATTERN` + `redactObject()` is available for anything
 *     that must log a caller-provided structure at all.
 *
 * Every request carries a UUID `request_id`; task-scoped logs also carry
 * `task_id`, the duration and the error code.
 */
import { randomUUID } from 'node:crypto';
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { Config, LogLevel } from './config.js';

export type { Logger, DestinationStream };

/**
 * Field names that must never appear in a log line. Matching is on the key,
 * case-insensitively, so `password_hash`, `newPassword` and `lease_token` are
 * all covered.
 */
const SENSITIVE_KEY_PATTERN =
  /(pass(word|phrase)?|secret|token|cookie|authorization|api[_-]?key|credential|session|csrf|cv[_-]?text|resume[_-]?text|extracted[_-]?text|inline[_-]?text|pasted[_-]?text|source[_-]?excerpt|prompt|answer|draft_facts|ciphertext|sha256|email)/i;

/** Values that are structurally sensitive regardless of key name. */
const REDACTED = '[redacted]';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-lease-token"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  '*.password',
  '*.new_password',
  '*.setup_token',
  '*.lease_token',
  '*.api_key',
  '*.token',
  '*.secret',
  '*.payload',
  '*.result',
  '*.input',
  '*.inline_text',
  '*.pasted_text',
  '*.answer',
  '*.contact',
  '*.draft_facts',
  'payload',
  'result',
  'input',
  'body',
  'contact',
  'draft_facts',
];

/**
 * Recursively replaces sensitive values in an object that is about to be
 * logged. Depth and breadth are bounded so a hostile document cannot turn a
 * log line into a denial of service.
 */
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 200 ? '[truncated]' : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => redactObject(entry, depth + 1));
  }
  const output: Record<string, unknown> = {};
  let count = 0;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (count++ >= 40) {
      output['…'] = '[truncated]';
      break;
    }
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactObject(entry, depth + 1);
  }
  return output;
}

/** Query strings can carry user data; only the path is ever logged. */
function pathOnly(url: string | undefined): string {
  if (!url) return '';
  const index = url.indexOf('?');
  return index === -1 ? url : `${url.slice(0, index)}?[redacted]`;
}

interface RequestLike {
  id?: unknown;
  method?: string;
  url?: string;
  ip?: string;
  headers?: Record<string, unknown>;
  routeOptions?: { url?: string };
}

interface ReplyLike {
  statusCode?: number;
}

export const serializers = {
  req(request: RequestLike) {
    return {
      request_id: typeof request.id === 'string' ? request.id : undefined,
      method: request.method,
      // The route pattern, not the concrete path: `/api/v1/tasks/:id` rather
      // than a URL containing a real task UUID.
      route: request.routeOptions?.url ?? pathOnly(request.url),
      remote: request.ip,
      content_type: request.headers?.['content-type'],
    };
  },
  res(reply: ReplyLike) {
    return { status: reply.statusCode };
  },
  err(error: Error & { code?: string; status?: number }) {
    return {
      type: error.name,
      // The message of an internal error can contain a SQL fragment or a file
      // path; keep it, but only in the log, never in the response body.
      message: error.message,
      error_code: error.code,
      status: error.status,
      stack: error.stack,
    };
  },
};

export interface CreateLoggerOptions {
  readonly level: LogLevel;
  /** Human-readable output for interactive local development only. */
  readonly pretty?: boolean;
  /** Test hook: write to an in-memory destination instead of stdout. */
  readonly destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    base: { service: 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    redact: { paths: REDACT_PATHS, censor: REDACTED, remove: false },
    serializers,
  };

  if (options.destination) return pino(loggerOptions, options.destination);
  if (options.pretty) {
    return pino({
      ...loggerOptions,
      transport: { target: 'pino-pretty', options: { colorize: true, singleLine: false } },
    });
  }
  return pino(loggerOptions);
}

export function loggerFromConfig(config: Config, destination?: DestinationStream): Logger {
  return createLogger({
    level: config.logLevel,
    pretty: !config.isHosted && process.stdout.isTTY === true && destination === undefined,
    destination,
  });
}

/** Per-request correlation id. Fastify uses this for `request.id`. */
export function generateRequestId(): string {
  return randomUUID();
}
