import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';
import { ApplicationStatus, PacketDestination } from './applications.js';
import { ObservationOutcome } from '../tasks/observe-confirmation.js';
import {
  FillField,
  FillJobIdentity,
  FillOutcome,
  FilledField,
  UnresolvedField,
} from '../tasks/fill-local.js';

/**
 * Fill sessions: how the browser extension is allowed to touch one approved
 * packet, once, on one page (milestone M5, PR12).
 *
 * docs/spec/07_APPLICATION_AUTOMATION.md: "Extension requests a fill session
 * from API. The session binds device_id, tab origin, application_id,
 * packet_hash, nonce and ten-minute expiry. API allows only current approved
 * packets."
 *
 * A paired local runner (M4) gets its work through the task queue, where a
 * lease token bounds what it may do and for how long. An extension cannot use
 * that path: `/internal/v1` is deliberately not proxied to the browser
 * (10_DEPLOYMENT.md), and a queued task is the wrong shape anyway — the
 * extension is already standing in the tab, with the person watching. The fill
 * session is the equivalent bound credential for that path, and it is
 * deliberately narrower than a lease in three ways.
 *
 *  1. **It names the page before it is issued.** A session is bound to one tab
 *     origin, and the API refuses an origin the device was not paired for. The
 *     destination inside the grant is the approved packet's own, never
 *     anything the caller asked for: a page that asks the extension to fill
 *     somewhere else is asking for something no message can express (AT24).
 *  2. **It carries a nonce, held only by the service worker.** The device
 *     token pairs the browser; the nonce authorises this one fill. Page
 *     scripts have neither, and the content script is handed only the fields
 *     it must type — never the profile, never the token, never the nonce.
 *  3. **It expires in ten minutes and is spent once.** A session that is
 *     reported on is finished. There is no renewal: a second attempt at
 *     someone's real application is a decision for the person, not a retry.
 *
 * Revocation reaches it immediately. The device's `revoked_at` is read on
 * every request, and a session held by a revoked device is dead on its next
 * call rather than at its expiry (AT23).
 */

/** 07_APPLICATION_AUTOMATION.md fixes this at ten minutes. */
export const FILL_SESSION_TTL_SECONDS = 600;

export { FILL_SESSION_NONCE_HEADER } from '../headers.js';

/**
 * Derived from the timestamps on every read, never stored as a column, for
 * the same reason `DeviceStatus` is: a session cannot be expired by one field
 * and live according to another.
 */
export const FillSessionState = Type.Union([
  Type.Literal('active'),
  Type.Literal('expired'),
  Type.Literal('ended'),
]);
export type FillSessionState = Static<typeof FillSessionState>;

export const ALL_FILL_SESSION_STATES = [
  'active',
  'expired',
  'ended',
] as const satisfies readonly FillSessionState[];

/**
 * Why a session stopped. `reported` is the ordinary end: the extension said
 * what it filled. The others are all someone deciding to stop, or the device
 * losing the right to continue.
 */
export const FillSessionEndReason = Type.Union([
  Type.Literal('reported'),
  Type.Literal('cancelled'),
  Type.Literal('superseded'),
  Type.Literal('device_revoked'),
]);
export type FillSessionEndReason = Static<typeof FillSessionEndReason>;

export const ALL_FILL_SESSION_END_REASONS = [
  'reported',
  'cancelled',
  'superseded',
  'device_revoked',
] as const satisfies readonly FillSessionEndReason[];

/**
 * What the extension asks for.
 *
 * `content_hash` is the packet hash the extension believes it is about to
 * fill, and the API refuses the session if it is not the current approved
 * one — the same 409 the approve route gives for a stale hash. It is not
 * decoration: it is what stops a session being issued against content that
 * moved while the tab sat open.
 */
export const CreateFillSessionRequest = Type.Object(
  {
    application_id: Uuid,
    /** The tab's own origin, as the service worker read it. Scheme and host. */
    origin: Type.String({ minLength: 1, maxLength: 500 }),
    content_hash: Type.String({ minLength: 64, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type CreateFillSessionRequest = Static<typeof CreateFillSessionRequest>;

/**
 * One approved application the calling extension could fill right now.
 *
 * This is what lets the popup offer a list instead of asking for an
 * application id and a packet hash to be pasted. It is a pointer, not a
 * packet: the job's name so the person can recognise it, where it is to be
 * filled, and the hash the extension will name when it asks for a session.
 * No answers, no CV, no profile — those arrive only in a grant, which is bound
 * to a tab.
 *
 * A target is listed only if `POST /fill-sessions` would accept it for this
 * device: the application is `approved`, its current packet is approved,
 * fresh and has every required question answered, and the device was paired
 * for the destination's origin. The two are decided by the same function, so
 * the list cannot offer something the session route would then refuse.
 */
export const FillTarget = Type.Object(
  {
    application_id: Uuid,
    content_hash: Type.String({ minLength: 64, maxLength: 64 }),
    job: FillJobIdentity,
    /** The packet's own destination. Never a caller-supplied URL. */
    destination: PacketDestination,
    /** When the approval lapses and the packet must be approved again. */
    approval_expires_at: Type.Union([Timestamp, Type.Null()]),
  },
  { additionalProperties: false },
);
export type FillTarget = Static<typeof FillTarget>;

/**
 * A form this extension filled, which is now waiting for the person to press
 * the employer's submit button.
 *
 * Listed so that, once they have, the popup can offer to read the
 * confirmation page. Only fills this device itself reported appear here: the
 * fill session is the proof that this browser was the one on that page.
 */
export const AwaitingSubmission = Type.Object(
  {
    fill_session_id: Uuid,
    application_id: Uuid,
    job: FillJobIdentity,
    destination: PacketDestination,
    /** When the fill was reported. */
    filled_at: Timestamp,
  },
  { additionalProperties: false },
);
export type AwaitingSubmission = Static<typeof AwaitingSubmission>;

export const FillTargetList = Type.Object(
  {
    items: Type.Array(FillTarget, { maxItems: 50 }),
    awaiting_submission: Type.Array(AwaitingSubmission, { maxItems: 50 }),
  },
  { additionalProperties: false },
);
export type FillTargetList = Static<typeof FillTargetList>;

/** The list is short by nature; anything beyond this is not a list to pick from. */
export const FILL_TARGET_LIMIT = 50;

/**
 * The grant, returned once.
 *
 * Everything the extension is allowed to know, and nothing else. This is
 * deliberately the same shape as `FillLocalInput` minus the device and origin
 * bookkeeping: the two clients fill the same form from the same packet, and
 * two different payloads would be two different sets of things to get wrong.
 *
 * The four omissions of `FillLocalInput` hold here too and matter more,
 * because this payload lives in a browser: no profile, no provider secret, no
 * free-choice URL, no submit instruction.
 */
export const FillSessionGrant = Type.Object(
  {
    session_id: Uuid,
    /** Returned once and never again. Only its digest is stored. */
    nonce: Type.String({ minLength: 32, maxLength: 200 }),
    expires_at: Timestamp,
    application_id: Uuid,
    packet_id: Uuid,
    content_hash: Type.String({ minLength: 64, maxLength: 64 }),
    /** The origin this session is bound to. The extension refuses any other. */
    origin: Type.String({ maxLength: 500 }),
    /** The packet's own destination. Never a caller-supplied URL. */
    destination: PacketDestination,
    job: FillJobIdentity,
    resume_file_id: Type.Union([Uuid, Type.Null()]),
    resume_sha256: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
    resume_filename: Type.Union([Type.String({ maxLength: 260 }), Type.Null()]),
    fields: Type.Array(FillField, { maxItems: 200 }),
    known_form_fingerprint: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    adapter: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type FillSessionGrant = Static<typeof FillSessionGrant>;

/**
 * The session without its secret or its payload: what a later read returns,
 * and what the web UI could show. A grant is issued once; this can be read
 * repeatedly, so it must not contain the nonce or the answers.
 */
export const FillSessionView = Type.Object(
  {
    id: Uuid,
    application_id: Uuid,
    packet_id: Uuid,
    device_id: Uuid,
    content_hash: Type.String({ minLength: 64, maxLength: 64 }),
    origin: Type.String({ maxLength: 500 }),
    state: FillSessionState,
    created_at: Timestamp,
    expires_at: Timestamp,
    ended_at: Type.Union([Timestamp, Type.Null()]),
    ended_reason: Type.Union([FillSessionEndReason, Type.Null()]),
  },
  { additionalProperties: false },
);
export type FillSessionView = Static<typeof FillSessionView>;

/**
 * What the extension reports when it stops.
 *
 * The same vocabulary the local runner reports in `FillLocalResult`, because
 * the application's state machine must not be able to tell which client
 * filled the form. `outcome` cannot be `submitted` here either: the extension
 * does not click final submit, and there is no field in which it could claim
 * to have done so.
 */
export const ReportFillSessionRequest = Type.Object(
  {
    filled_fields: Type.Array(FilledField, { maxItems: 200 }),
    unresolved_fields: Type.Array(UnresolvedField, { maxItems: 200 }),
    /** Where the tab actually was. Compared against the bound origin. */
    page_url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    form_fingerprint: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    outcome: FillOutcome,
    adapter: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    adapter_version: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ReportFillSessionRequest = Static<typeof ReportFillSessionRequest>;

/**
 * What the confirmation page said, read by the extension on the person's own
 * click after they submitted (`POST /fill-sessions/:id/observation`).
 *
 * The runner watches a page it opened itself, for up to ninety seconds. The
 * extension cannot: it may read an employer's page only while the person
 * invokes it there, so its observation is one look at the page in front of
 * them. The two honest answers are the runner's two: "here is what the page
 * said" and "I could not tell". Neither is "not submitted", and nothing here
 * can say so; only the person can, through the outcome route.
 *
 * There is no `observed_at`. The API stamps its own time rather than taking
 * the browser's word for when something was seen.
 */
export const ExtensionConfirmation = Type.Object(
  {
    confirmation_text: Type.String({ minLength: 1, maxLength: 2000 }),
    reference: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    url: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ExtensionConfirmation = Static<typeof ExtensionConfirmation>;

export const ExtensionObservationUnknownReason = Type.Union([
  /** The page was read, and nothing on it was a confirmation this adapter knows. */
  Type.Literal('no_confirmation_found'),
  /** No tested adapter matched the page, so nothing was read from it. */
  Type.Literal('unsupported'),
]);
export type ExtensionObservationUnknownReason = Static<typeof ExtensionObservationUnknownReason>;

export const ReportObservationRequest = Type.Object(
  {
    outcome: ObservationOutcome,
    /** Present exactly when `outcome` is `observed`. */
    confirmation: Type.Union([ExtensionConfirmation, Type.Null()]),
    /** Present exactly when `outcome` is `unknown`. */
    unknown_reason: Type.Union([ExtensionObservationUnknownReason, Type.Null()]),
    /** Where the tab was. It must be on an origin this packet was allowed to fill. */
    page_url: Type.String({ minLength: 1, maxLength: 2000 }),
    adapter: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
    adapter_version: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ReportObservationRequest = Static<typeof ReportObservationRequest>;

export const ObservationRecorded = Type.Object(
  {
    application_id: Uuid,
    /** `submitted` when the page confirmed it, `outcome_unknown` when it could not tell. */
    status: ApplicationStatus,
  },
  { additionalProperties: false },
);
export type ObservationRecorded = Static<typeof ObservationRecorded>;
