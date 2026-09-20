/**
 * Environment contract from 10_DEPLOYMENT.md, validated once at boot.
 *
 * Everything is checked before the process does any work and *every* problem
 * is reported in one message, because a half-configured installation that
 * fails later looks like a bug rather than a missing variable.
 *
 * Enumerations that also exist in the product contract (`APP_MODE`,
 * `PROVIDER_DEFAULT`) reuse the contract schemas rather than re-declaring the
 * literal list here.
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  MAX_UPLOAD_BYTES as CONTRACT_MAX_UPLOAD_BYTES,
  ProviderId,
  WorkspaceMode,
} from '@job-getter/contracts';
import { compile, errorPathToField } from './validation.js';

const LogLevel = Type.Union([
  Type.Literal('fatal'),
  Type.Literal('error'),
  Type.Literal('warn'),
  Type.Literal('info'),
  Type.Literal('debug'),
  Type.Literal('trace'),
  Type.Literal('silent'),
]);
export type LogLevel = Static<typeof LogLevel>;

const StorageDriver = Type.Union([Type.Literal('local'), Type.Literal('s3')]);

const NullableString = Type.Union([Type.String({ minLength: 1, maxLength: 1000 }), Type.Null()]);

/**
 * Shape after coercion. String-typed env values are converted to numbers,
 * booleans and lists first; this schema then enforces ranges and enums.
 */
const EnvSchema = Type.Object(
  {
    APP_MODE: WorkspaceMode,
    APP_ORIGIN: Type.String({ minLength: 1, maxLength: 500 }),
    HOST: Type.String({ minLength: 1, maxLength: 200 }),
    PORT: Type.Integer({ minimum: 1, maximum: 65535 }),
    DATABASE_URL: Type.String({ minLength: 1, maxLength: 2000 }),
    SESSION_SECRET: Type.String({ minLength: 32, maxLength: 1024 }),
    SETUP_TOKEN: Type.Union([Type.String({ minLength: 16, maxLength: 200 }), Type.Null()]),
    ENCRYPTION_KEY: Type.String({ minLength: 1, maxLength: 1024 }),
    WORKER_AUTH_TOKEN: Type.String({ minLength: 32, maxLength: 1024 }),
    STORAGE_DRIVER: StorageDriver,
    FILES_ROOT: Type.String({ minLength: 1, maxLength: 1000 }),
    S3_ENDPOINT: NullableString,
    S3_BUCKET: NullableString,
    S3_REGION: NullableString,
    S3_ACCESS_KEY_ID: NullableString,
    S3_SECRET_ACCESS_KEY: NullableString,
    PROVIDER_DEFAULT: ProviderId,
    LOCAL_MODEL_BASE_URL: NullableString,
    MAX_UPLOAD_BYTES: Type.Integer({ minimum: 1024, maximum: 104_857_600 }),
    LOG_LEVEL: LogLevel,
    ALLOWED_FETCH_HOSTS: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
      maxItems: 200,
    }),
    BILLING_ENABLED: Type.Boolean(),
  },
  { additionalProperties: false },
);
type Env = Static<typeof EnvSchema>;

export interface S3Config {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface Config {
  readonly appMode: Static<typeof WorkspaceMode>;
  readonly appOrigin: string;
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  /** Absent when setup is not offered (hosted mode, or already completed). */
  readonly setupToken: string | null;
  /** Exactly 32 raw bytes, decoded from the base64 environment value. */
  readonly encryptionKey: Buffer;
  readonly workerAuthToken: string;
  readonly storageDriver: Static<typeof StorageDriver>;
  readonly filesRoot: string;
  readonly s3: S3Config | null;
  readonly providerDefault: Static<typeof ProviderId>;
  readonly localModelBaseUrl: string | null;
  readonly maxUploadBytes: number;
  readonly logLevel: LogLevel;
  readonly allowedFetchHosts: readonly string[];
  readonly billingEnabled: boolean;
  /** Derived: hosted deployments get Secure cookies and stricter secrets. */
  readonly isHosted: boolean;
  readonly cookieSecure: boolean;
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        `Invalid configuration (${problems.length} problem${problems.length === 1 ? '' : 's'}):`,
        ...problems.map((problem) => `  - ${problem}`),
        '',
        'See docs/spec/10_DEPLOYMENT.md for the environment contract.',
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

export type RawEnv = Record<string, string | undefined>;

function str(raw: RawEnv, key: string, fallback?: string): string | null {
  const value = raw[key];
  if (value === undefined || value.trim() === '') return fallback ?? null;
  return value.trim();
}

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /change[\s_-]?me/i,
  /placeholder/i,
  /^example/i,
  /example\.com/i,
  /replace[\s_-]?me/i,
  /^dev(elopment)?$/i,
  /insecure/i,
  /^secret$/i,
  /^password$/i,
  /^token$/i,
  /^test(ing)?[-_]?/i,
  /^local[-_]?dev/i,
  /(.)\1{7,}/, // aaaaaaaa, 00000000, ...
];

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/** Booleans accept the forms an operator is likely to write in a .env file. */
function coerceBoolean(value: string | null, fallback: boolean, key: string, problems: string[]) {
  if (value === null) return fallback;
  const normalised = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;
  problems.push(`${key} must be a boolean (true/false); received "${value}".`);
  return fallback;
}

function coerceInteger(value: string | null, fallback: number, key: string, problems: string[]) {
  if (value === null) return fallback;
  if (!/^-?\d+$/.test(value)) {
    problems.push(`${key} must be an integer; received "${value}".`);
    return fallback;
  }
  return Number.parseInt(value, 10);
}

function coerceList(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Decodes `ENCRYPTION_KEY`; it must be base64 for exactly 32 raw bytes. */
function decodeEncryptionKey(value: string | null, problems: string[]): Buffer {
  if (value === null) {
    problems.push('ENCRYPTION_KEY is required (base64-encoded 32 bytes).');
    return Buffer.alloc(0);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    problems.push('ENCRYPTION_KEY must be valid base64.');
    return Buffer.alloc(0);
  }
  // Buffer.from silently ignores invalid characters, so re-encode and compare.
  if (decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    problems.push('ENCRYPTION_KEY must be valid base64 with no extra characters.');
    return decoded;
  }
  if (decoded.byteLength !== 32) {
    problems.push(
      `ENCRYPTION_KEY must decode to exactly 32 bytes; got ${decoded.byteLength}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return decoded;
}

function normaliseOrigin(value: string, problems: string[]): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`APP_ORIGIN must be an absolute URL such as http://localhost:3000; got "${value}".`);
    return value;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    problems.push(`APP_ORIGIN must use http or https; got "${url.protocol}".`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    problems.push(`APP_ORIGIN must be an origin without a path; got "${url.pathname}".`);
  }
  return url.origin;
}

/**
 * Parses and validates the environment. Never throws for a reason the operator
 * cannot act on: the `ConfigError` message lists every problem at once.
 */
export function loadConfig(raw: RawEnv = process.env): Config {
  const problems: string[] = [];

  const appMode = str(raw, 'APP_MODE', 'local');
  const isHosted = appMode === 'hosted';

  const env: Record<string, unknown> = {
    APP_MODE: appMode,
    APP_ORIGIN: str(raw, 'APP_ORIGIN', 'http://localhost:3000'),
    HOST: str(raw, 'HOST', '0.0.0.0'),
    PORT: coerceInteger(str(raw, 'PORT'), 3001, 'PORT', problems),
    DATABASE_URL: str(raw, 'DATABASE_URL'),
    SESSION_SECRET: str(raw, 'SESSION_SECRET'),
    SETUP_TOKEN: str(raw, 'SETUP_TOKEN'),
    ENCRYPTION_KEY: str(raw, 'ENCRYPTION_KEY'),
    WORKER_AUTH_TOKEN: str(raw, 'WORKER_AUTH_TOKEN'),
    STORAGE_DRIVER: str(raw, 'STORAGE_DRIVER', 'local'),
    FILES_ROOT: str(raw, 'FILES_ROOT', './data/files'),
    S3_ENDPOINT: str(raw, 'S3_ENDPOINT'),
    S3_BUCKET: str(raw, 'S3_BUCKET'),
    S3_REGION: str(raw, 'S3_REGION'),
    S3_ACCESS_KEY_ID: str(raw, 'S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: str(raw, 'S3_SECRET_ACCESS_KEY'),
    PROVIDER_DEFAULT: str(raw, 'PROVIDER_DEFAULT', 'none'),
    LOCAL_MODEL_BASE_URL: str(raw, 'LOCAL_MODEL_BASE_URL'),
    MAX_UPLOAD_BYTES: coerceInteger(
      str(raw, 'MAX_UPLOAD_BYTES'),
      CONTRACT_MAX_UPLOAD_BYTES,
      'MAX_UPLOAD_BYTES',
      problems,
    ),
    LOG_LEVEL: str(raw, 'LOG_LEVEL', 'info'),
    ALLOWED_FETCH_HOSTS: coerceList(str(raw, 'ALLOWED_FETCH_HOSTS')),
    BILLING_ENABLED: coerceBoolean(str(raw, 'BILLING_ENABLED'), false, 'BILLING_ENABLED', problems),
  };

  const checker = compile(EnvSchema);
  if (!checker.Check(env)) {
    for (const error of checker.Errors(env)) {
      const field = errorPathToField(error.path);
      const variable = field === '_root' ? 'environment' : field.split('.')[0];
      problems.push(`${variable}: ${error.message}`);
    }
  }
  const parsed = env as Env;

  const encryptionKey = decodeEncryptionKey(
    typeof parsed.ENCRYPTION_KEY === 'string' ? parsed.ENCRYPTION_KEY : null,
    problems,
  );

  const appOrigin =
    typeof parsed.APP_ORIGIN === 'string'
      ? normaliseOrigin(parsed.APP_ORIGIN, problems)
      : 'http://localhost:3000';

  // Local mode has no email-based signup, so without a setup token there is no
  // way to create the owner. Say so instead of booting into a dead end.
  if (!isHosted && parsed.SETUP_TOKEN === null) {
    problems.push(
      'SETUP_TOKEN is required in local mode: it is the single-use secret for one-time owner setup.',
    );
  }

  let s3: S3Config | null = null;
  if (parsed.STORAGE_DRIVER === 's3') {
    // Refusing to boot is the honest behaviour: an S3 driver that silently
    // wrote nowhere would look like a working hosted install (invariant 10).
    problems.push(
      'STORAGE_DRIVER=s3 is not implemented yet (hosted storage is milestone M6). ' +
        'Use STORAGE_DRIVER=local.',
    );
    const endpoint = parsed.S3_ENDPOINT;
    const bucket = parsed.S3_BUCKET;
    const region = parsed.S3_REGION;
    const accessKeyId = parsed.S3_ACCESS_KEY_ID;
    const secretAccessKey = parsed.S3_SECRET_ACCESS_KEY;
    if (endpoint && bucket && region && accessKeyId && secretAccessKey) {
      s3 = { endpoint, bucket, region, accessKeyId, secretAccessKey };
    }
  }

  if (isHosted) {
    if (!appOrigin.startsWith('https://')) {
      problems.push('APP_ORIGIN must use https in hosted mode (cookies are Secure).');
    }
    const secrets: ReadonlyArray<[string, string | null]> = [
      ['SESSION_SECRET', parsed.SESSION_SECRET ?? null],
      ['WORKER_AUTH_TOKEN', parsed.WORKER_AUTH_TOKEN ?? null],
      ['ENCRYPTION_KEY', parsed.ENCRYPTION_KEY ?? null],
      ['SETUP_TOKEN', parsed.SETUP_TOKEN],
    ];
    for (const [name, value] of secrets) {
      if (value !== null && looksLikePlaceholder(value)) {
        problems.push(
          `${name} looks like a placeholder or development value and must not be used in hosted mode.`,
        );
      }
    }
    if (parsed.SESSION_SECRET === parsed.WORKER_AUTH_TOKEN) {
      problems.push(
        'SESSION_SECRET and WORKER_AUTH_TOKEN must differ: the worker credential is a separate principal.',
      );
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return Object.freeze({
    appMode: parsed.APP_MODE,
    appOrigin,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    sessionSecret: parsed.SESSION_SECRET,
    setupToken: parsed.SETUP_TOKEN,
    encryptionKey,
    workerAuthToken: parsed.WORKER_AUTH_TOKEN,
    storageDriver: parsed.STORAGE_DRIVER,
    filesRoot: parsed.FILES_ROOT,
    s3,
    providerDefault: parsed.PROVIDER_DEFAULT,
    localModelBaseUrl: parsed.LOCAL_MODEL_BASE_URL,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    logLevel: parsed.LOG_LEVEL,
    allowedFetchHosts: Object.freeze([...parsed.ALLOWED_FETCH_HOSTS]),
    billingEnabled: parsed.BILLING_ENABLED,
    isHosted,
    cookieSecure: isHosted,
  });
}
