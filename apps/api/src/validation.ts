/**
 * TypeBox is the single validation runtime for the API: the same schemas that
 * `@job-getter/contracts` publishes are compiled here for request validation,
 * environment parsing and worker-result checking. Nothing is re-declared.
 *
 * ## Why Fastify's Ajv is not used
 *
 * `buildApp` installs a `setValidatorCompiler` backed by TypeBox's
 * `TypeCompiler` (see `src/app.ts`), so route validation and worker-result
 * validation run through *the same* compiler against *the same*
 * `FormatRegistry`. That removes a whole class of bug by construction: a
 * request cannot be accepted at the route boundary by Ajv and then rejected by
 * `Value.Check` inside the completing transaction, because there is only one
 * validator.
 *
 * ## Formats
 *
 * TypeBox's format registry is global and starts empty; an unregistered
 * `format` makes `Value.Check` *fail*, silently rejecting valid payloads. The
 * contract package owns those definitions (`registerContractFormats`), and it
 * is called here explicitly rather than relied upon as an import side effect,
 * so a future refactor that turns the contracts import into a types-only
 * import cannot silently disarm validation.
 *
 * Note the contract's deliberate strictness: `date-time` accepts only `Z` or
 * `+00:00`. The data model stores `timestamptz` in UTC, and a local-offset
 * timestamp would make freshness and last-seen comparisons quietly wrong.
 */
import type { TSchema } from '@sinclair/typebox';
import { TypeCompiler, type TypeCheck } from '@sinclair/typebox/compiler';
import { Value, type ValueError } from '@sinclair/typebox/value';
import { registerContractFormats } from '@job-getter/contracts';

/**
 * Registers the contract's formats. Idempotent, and deliberately does not
 * define `uuid` or `date-time` itself: a second definition here would shadow
 * the contract's and the two runtimes would drift.
 */
export function registerFormats(): void {
  registerContractFormats();
}

registerFormats();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Compiled checkers are cached by schema identity. Fastify calls the validator
 * compiler once per route at registration time, but ad-hoc validation (worker
 * results, seeded payloads) happens on every request and must not recompile.
 */
const compiledCache = new WeakMap<TSchema, TypeCheck<TSchema>>();

export function compile(schema: TSchema): TypeCheck<TSchema> {
  const cached = compiledCache.get(schema);
  if (cached) return cached;
  const compiled = TypeCompiler.Compile(schema);
  compiledCache.set(schema, compiled);
  return compiled;
}

/** `/limits/max_pdf_pages` -> `limits.max_pdf_pages`; root -> `_root`. */
export function errorPathToField(path: string): string {
  if (path === '' || path === '/') return '_root';
  return path.replace(/^\//, '').replace(/\//g, '.');
}

/**
 * Collapses TypeBox errors into the `fields` map of the contract error
 * envelope. Only the first message per field is kept so the response stays
 * bounded, and messages describe the schema violation rather than echoing the
 * submitted value (which may be personal data).
 */
export function toFieldErrors(errors: Iterable<ValueError>, limit = 25): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const error of errors) {
    const field = errorPathToField(error.path);
    if (fields[field] !== undefined) continue;
    fields[field] = error.message;
    if (Object.keys(fields).length >= limit) break;
  }
  return fields;
}

export interface SchemaCheckResult {
  readonly ok: boolean;
  readonly fields: Record<string, string>;
}

/** Validates an arbitrary value against a contract schema without mutating it. */
export function checkSchema(schema: TSchema, value: unknown): SchemaCheckResult {
  const compiled = compile(schema);
  if (compiled.Check(value)) return { ok: true, fields: {} };
  return { ok: false, fields: toFieldErrors(compiled.Errors(value)) };
}

export { Value };
