import { Type, type Static, type TSchema } from '@sinclair/typebox';

/** Reusable primitive formats. All timestamps are ISO-8601 UTC strings. */
export const Uuid = Type.String({ format: 'uuid', $id: undefined });
export const Timestamp = Type.String({ format: 'date-time' });
/**
 * Calendar month, YYYY-MM. Written with an explicit [0-9] class rather than
 * \d: in a JavaScript string literal an unrecognised escape collapses, so
 * '\d' silently becomes 'd' and the pattern matches nothing.
 */
export const IsoMonth = Type.String({ pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' });

export const Locale = Type.Union([Type.Literal('en'), Type.Literal('es')]);
export type Locale = Static<typeof Locale>;

export const WorkspaceMode = Type.Union([Type.Literal('local'), Type.Literal('hosted')]);
export type WorkspaceMode = Static<typeof WorkspaceMode>;

/**
 * Tri-state used wherever the specification forbids treating absent evidence
 * as a positive answer (eligibility, authorization, sponsorship).
 */
export const TriState = Type.Union([
  Type.Literal('yes'),
  Type.Literal('no'),
  Type.Literal('unknown'),
]);
export type TriState = Static<typeof TriState>;

export const ErrorCode = Type.Union([
  Type.Literal('VALIDATION_ERROR'),
  Type.Literal('MALFORMED_REQUEST'),
  Type.Literal('UNAUTHENTICATED'),
  Type.Literal('FORBIDDEN'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('CONFLICT'),
  Type.Literal('STALE_REVISION'),
  Type.Literal('IDEMPOTENCY_MISMATCH'),
  Type.Literal('PAYLOAD_TOO_LARGE'),
  Type.Literal('UNPROCESSABLE'),
  Type.Literal('QUOTA_EXCEEDED'),
  Type.Literal('SETUP_CLOSED'),
  Type.Literal('BUDGET_EXHAUSTED'),
  Type.Literal('PROVIDER_UNAVAILABLE'),
  Type.Literal('INTERNAL_ERROR'),
]);
export type ErrorCode = Static<typeof ErrorCode>;

export const ErrorEnvelope = Type.Object(
  {
    error: Type.Object({
      code: ErrorCode,
      message: Type.String(),
      fields: Type.Optional(Type.Record(Type.String(), Type.String())),
      request_id: Uuid,
    }),
  },
  { additionalProperties: false },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelope>;

/**
 * A field that may be absent or explicitly null, both meaning "not stated".
 *
 * `Type.Optional(Type.String())` permits an absent key but *rejects* an
 * explicit null, which is a trap for any producer that serialises "nothing"
 * as null rather than by omitting the key. That is not hypothetical: it
 * silently discarded a work-authorization fact end to end, because the
 * worker emitted `note: null` and validation then rejected the whole fact.
 *
 * Use this for anything a source document may simply not mention. Use a bare
 * `Type.Optional` only where an absent key and a null are genuinely different
 * things.
 */
export const OptionalNullable = <T extends TSchema>(schema: T) =>
  Type.Optional(Type.Union([schema, Type.Null()]));

/** Cursor pagination wrapper: { items: [...], next_cursor: string | null }. */
export const Page = <T extends TSchema>(item: T) =>
  Type.Object(
    {
      items: Type.Array(item),
      next_cursor: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  );

export const PaginationQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
});

export const AcceptedResponse = Type.Object(
  {
    task_id: Uuid,
    status: Type.Literal('queued'),
  },
  { additionalProperties: false },
);
export type AcceptedResponse = Static<typeof AcceptedResponse>;
