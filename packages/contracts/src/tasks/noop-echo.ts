import { Type, type Static } from '@sinclair/typebox';

/**
 * M0 end-to-end probe task. It exists so the web -> API -> queue -> Python ->
 * result -> UI path is exercised by real code with no AI provider configured.
 */
export const NoopEchoInput = Type.Object(
  {
    message: Type.String({ minLength: 1, maxLength: 500 }),
    /** Optional artificial work so progress/heartbeat/cancel are observable. */
    delay_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000, default: 0 })),
    /** Deterministic failure switch used by tests; never set by the UI. */
    fail_with: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);
export type NoopEchoInput = Static<typeof NoopEchoInput>;

export const NoopEchoResult = Type.Object(
  {
    echoed: Type.String(),
    worker_id: Type.String(),
    worker_runtime: Type.String(),
    processed_at: Type.String({ format: 'date-time' }),
  },
  { additionalProperties: false },
);
export type NoopEchoResult = Static<typeof NoopEchoResult>;
