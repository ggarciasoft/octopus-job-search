import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';
import { PacketDestination } from '../schemas/applications.js';

/**
 * `observe_confirmation`: the paired runner looking at the employer's page
 * after the person has submitted, to see whether it says so.
 *
 * `docs/spec/07_APPLICATION_AUTOMATION.md`:
 *
 *     observe_confirmation() → evidence or unknown.
 *
 *     After manual submission, an adapter may observe a confirmation
 *     message/reference on the allowed page. [...] If adapter cannot verify,
 *     ask the user to report outcome. **Absence of evidence is not failure or
 *     success.** Disable a second attempt until resolved.
 *
 * That last emphasis is the whole design. This task has exactly two honest
 * answers — "here is the confirmation the page showed" and "I could not tell" —
 * and the second one is not a failure. A run that watches for two minutes and
 * sees nothing has not malfunctioned; it has found out that the page did not
 * say anything it recognises, which is a fact about the page and not about the
 * application. It becomes `outcome_unknown` and waits for the person, who is
 * the only one who actually knows.
 *
 * Like `fill_local` this is runner-only and never retried. A retry would be a
 * second browser opening someone's real application page, and — worse — a
 * second chance to guess at an outcome the first attempt correctly declined to
 * guess at.
 */

export const ObserveConfirmationInput = Type.Object(
  {
    application_id: Uuid,
    packet_id: Uuid,
    device_id: Uuid,
    /** The page the packet was sent to. The runner watches this and nothing else. */
    destination: PacketDestination,
    /** Scheme-and-host origins the browser may visit. Nothing else. */
    allowed_origins: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
    /**
     * How long to watch before reporting `unknown`.
     *
     * The deadline is part of the contract rather than a runner default,
     * because "how long we waited" is a thing the user is entitled to see
     * next to "we could not tell".
     */
    timeout_seconds: Type.Integer({ minimum: 5, maximum: 600 }),
    /** Which versioned site adapter to try; null means none is known. */
    adapter: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    /**
     * Screenshots are opt-in per `09_SECURITY_PRIVACY.md`. False means the
     * runner must not capture one even if the observation succeeds.
     */
    capture_evidence: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ObserveConfirmationInput = Static<typeof ObserveConfirmationInput>;

/**
 * Two outcomes, and neither of them is "not submitted".
 *
 * The runner cannot establish that something did *not* happen by failing to
 * see it happen, so there is no literal here for that. Only the person can say
 * it, and they say it through `POST /applications/:id/outcome`.
 */
export const ObservationOutcome = Type.Union([Type.Literal('observed'), Type.Literal('unknown')]);
export type ObservationOutcome = Static<typeof ObservationOutcome>;

export const ALL_OBSERVATION_OUTCOMES = [
  'observed',
  'unknown',
] as const satisfies readonly ObservationOutcome[];

/**
 * Why the runner could not tell. Each of these is shown to the user, because
 * "we waited 120 seconds and the page never said anything" and "this page has
 * no adapter, so nobody looked" are different situations and lead to different
 * next steps.
 */
export const ObservationUnknownReason = Type.Union([
  /** The watch ran out. This is AT16. */
  Type.Literal('timed_out'),
  /** The page settled, and nothing on it was a confirmation this adapter knows. */
  Type.Literal('no_confirmation_found'),
  /** The browser ended up somewhere this packet never named. */
  Type.Literal('left_allowed_origin'),
  /** No tested adapter matched the page, so nothing was read from it. */
  Type.Literal('unsupported'),
  /** The browser itself failed. Still not a statement about the application. */
  Type.Literal('runner_error'),
]);
export type ObservationUnknownReason = Static<typeof ObservationUnknownReason>;

export const ALL_OBSERVATION_UNKNOWN_REASONS = [
  'timed_out',
  'no_confirmation_found',
  'left_allowed_origin',
  'unsupported',
  'runner_error',
] as const satisfies readonly ObservationUnknownReason[];

/**
 * What the page actually said. "Store normalized confirmation text, URL and
 * time"; the reference is the application number when the page shows one.
 */
export const ObservedConfirmation = Type.Object(
  {
    confirmation_text: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    reference: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    observed_at: Timestamp,
  },
  { additionalProperties: false },
);
export type ObservedConfirmation = Static<typeof ObservedConfirmation>;

export const ObserveConfirmationResult = Type.Object(
  {
    application_id: Uuid,
    packet_id: Uuid,
    outcome: ObservationOutcome,
    /** Present exactly when `outcome` is `observed`. */
    confirmation: Type.Union([ObservedConfirmation, Type.Null()]),
    /** Present exactly when `outcome` is `unknown`. */
    unknown_reason: Type.Union([ObservationUnknownReason, Type.Null()]),
    /** How long the runner actually watched, so the wait is reportable. */
    watched_seconds: Type.Integer({ minimum: 0, maximum: 3600 }),
    page_url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    adapter: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    adapter_version: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    /** Only when the user consented to evidence capture. Usually null. */
    screenshot_file_id: Type.Union([Uuid, Type.Null()]),
  },
  { additionalProperties: false },
);
export type ObserveConfirmationResult = Static<typeof ObserveConfirmationResult>;

/**
 * The pairing the schema cannot express on its own: `observed` means there is
 * a confirmation and no reason; `unknown` means there is a reason and no
 * confirmation. Anything else is a result that claims to know and not know at
 * the same time, and the API refuses it rather than storing it.
 */
export function observationResultIsCoherent(result: ObserveConfirmationResult): boolean {
  return result.outcome === 'observed'
    ? result.confirmation !== null && result.unknown_reason === null
    : result.confirmation === null && result.unknown_reason !== null;
}

/**
 * POST /applications/:id/observe. Asked for by the person, once they have
 * submitted the form the runner filled for them.
 */
export const ObserveApplicationRequest = Type.Object(
  {
    expected_revision: Type.Integer({ minimum: 1 }),
    packet_id: Uuid,
    device_id: Uuid,
    /** Optional override; the server applies its own bound either way. */
    timeout_seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 600 })),
  },
  { additionalProperties: false },
);
export type ObserveApplicationRequest = Static<typeof ObserveApplicationRequest>;

/** The server's default watch, and the most it will ever agree to wait. */
export const DEFAULT_OBSERVE_TIMEOUT_SECONDS = 90;
export const MAX_OBSERVE_TIMEOUT_SECONDS = 600;
