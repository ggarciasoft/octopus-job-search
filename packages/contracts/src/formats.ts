import { FormatRegistry } from '@sinclair/typebox';

/**
 * TypeBox ships an empty format registry: `Value.Check` treats an unregistered
 * `format` as a failure, so without this every payload carrying a UUID or a
 * timestamp would be rejected — which is very nearly every request, response
 * and task result in this system.
 *
 * The API validates worker results against the closed schemas in
 * `TASK_IO_SCHEMAS` before committing them, so a missing format here would not
 * fail loudly at boot; it would quietly reject correct results. Registration
 * therefore happens as a side effect of importing this package (see index.ts)
 * as well as through this idempotent function, so no consumer can forget it.
 *
 * Fastify validates routes through Ajv rather than `Value.Check`, and Ajv
 * needs its own format support. That is the API's concern, not this module's,
 * but the two must agree: both accept the same strings.
 */

/** RFC 4122 UUID, any version, case-insensitive. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ISO-8601 date-time. The specification requires UTC, so an offset of `Z` or
 * `+00:00` is accepted and any other offset is not: storing a local-offset
 * timestamp is the kind of silent inconsistency that later produces wrong
 * "last seen" and freshness decisions.
 */
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]00:00)$/;

function isValidDateTime(value: string): boolean {
  if (!DATE_TIME_PATTERN.test(value)) return false;
  // Reject values that match the shape but are not real instants, such as
  // 2026-02-30T00:00:00Z.
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const [datePart] = value.split('T');
  if (datePart === undefined) return false;
  return new Date(parsed).toISOString().startsWith(datePart);
}

let registered = false;

/**
 * Registers the formats used by these contracts. Safe to call repeatedly and
 * safe to call from several entry points; the registry is a global singleton.
 */
export function registerContractFormats(): void {
  if (registered) return;
  FormatRegistry.Set('uuid', (value) => UUID_PATTERN.test(value));
  FormatRegistry.Set('date-time', isValidDateTime);
  registered = true;
}

/** The format names this package expects a validator to understand. */
export const CONTRACT_FORMATS = ['uuid', 'date-time'] as const;
