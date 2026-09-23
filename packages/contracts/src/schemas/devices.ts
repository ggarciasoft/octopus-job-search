import { Type, type Static } from '@sinclair/typebox';
import { Timestamp, Uuid } from '../common.js';

/**
 * Paired devices: the local desktop runner (M4) and, later, the browser
 * extension (M5). See docs/spec/03_DATA_MODEL.md row `paired_devices` and
 * docs/spec/04_API_CONTRACTS.md, "Device pairing requires approval in an
 * authenticated web session, including device label and origin."
 *
 * A device token is the most dangerous credential this system issues: it lets
 * a process outside the browser act on the owner's data. Four limits are
 * therefore built into the shapes rather than left to the handlers.
 *
 *  1. **Pairing starts in an authenticated web session.** The code is minted
 *     by someone already signed in, lives for five minutes, and is single-use.
 *     There is no unauthenticated endpoint that hands out device access.
 *  2. **The token is scoped, never global.** It belongs to one workspace and
 *     may claim only runner capabilities — "Never issue global worker
 *     credentials to a user device."
 *  3. **It expires and can be revoked.** Thirty days, and revocation takes
 *     effect on the next request rather than at the next expiry (AT23).
 *  4. **Its origins are declared up front.** A runner fills pages on the
 *     origins the user paired it for and refuses anywhere else.
 */

export const DeviceKind = Type.Union([Type.Literal('local_runner'), Type.Literal('extension')]);
export type DeviceKind = Static<typeof DeviceKind>;

export const ALL_DEVICE_KINDS = [
  'local_runner',
  'extension',
] as const satisfies readonly DeviceKind[];

/** 04_API_CONTRACTS.md: `expires_in: 300`. */
export const DEVICE_PAIRING_TTL_SECONDS = 300;
/** 04_API_CONTRACTS.md: "Tokens expire after 30 days and can be revoked." */
export const DEVICE_TOKEN_TTL_DAYS = 30;

// The header names and the extension protocol are in `../headers.ts`, which
// imports nothing, so the browser extension can use them without pulling
// TypeBox and every schema into its bundle.
export {
  DEVICE_TOKEN_HEADER,
  EXTENSION_PROTOCOL_HEADER,
  EXTENSION_PROTOCOL_VERSION,
  extensionProtocolVerdict,
  type ProtocolVerdict,
} from '../headers.js';

/**
 * Derived, never stored. A row is `pending` until its code is exchanged, and
 * `revoked` or `expired` afterwards; computing it on read means a token cannot
 * be revoked in one column and still usable according to another.
 */
export const DeviceStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('paired'),
  Type.Literal('revoked'),
  Type.Literal('expired'),
]);
export type DeviceStatus = Static<typeof DeviceStatus>;

export const ALL_DEVICE_STATUSES = [
  'pending',
  'paired',
  'revoked',
  'expired',
] as const satisfies readonly DeviceStatus[];

export const DeviceView = Type.Object(
  {
    id: Uuid,
    kind: DeviceKind,
    label: Type.String({ maxLength: 120 }),
    status: DeviceStatus,
    /** The device's own identifier, supplied when it exchanged the code. */
    device_public_id: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    allowed_origins: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
    expires_at: Type.Union([Timestamp, Type.Null()]),
    revoked_at: Type.Union([Timestamp, Type.Null()]),
    last_seen_at: Type.Union([Timestamp, Type.Null()]),
    created_at: Timestamp,
  },
  { additionalProperties: false },
);
export type DeviceView = Static<typeof DeviceView>;

export const CreatePairingRequest = Type.Object(
  {
    device_kind: DeviceKind,
    /** Shown in settings so the user can tell two devices apart before revoking one. */
    label: Type.String({ minLength: 1, maxLength: 120 }),
    /** Scheme-and-host origins this device may act on. */
    allowed_origins: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
    ),
  },
  { additionalProperties: false },
);
export type CreatePairingRequest = Static<typeof CreatePairingRequest>;

/**
 * The code is returned once, to the authenticated browser that asked for it,
 * and never again. Only its digest is stored.
 */
export const PairingCodeResponse = Type.Object(
  {
    device_id: Uuid,
    pairing_code: Type.String({ minLength: 8, maxLength: 120 }),
    expires_in: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type PairingCodeResponse = Static<typeof PairingCodeResponse>;

export const DeviceExchangeRequest = Type.Object(
  {
    pairing_code: Type.String({ minLength: 8, maxLength: 120 }),
    /** How the device names itself; recorded so the user can recognise it. */
    device_public_id: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type DeviceExchangeRequest = Static<typeof DeviceExchangeRequest>;

/**
 * The only time the token is transmitted. It is stored as a digest, so a
 * device that loses it must be paired again — which is the right trade: a
 * token this endpoint could re-read would be a token a database dump hands
 * over.
 */
export const DeviceExchangeResponse = Type.Object(
  {
    device_id: Uuid,
    token: Type.String({ minLength: 32, maxLength: 200 }),
    expires_at: Timestamp,
    allowed_origins: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
    /** The extension protocol this server speaks; it also serves the previous minor. */
    protocol_version: Type.String({ maxLength: 16 }),
  },
  { additionalProperties: false },
);
export type DeviceExchangeResponse = Static<typeof DeviceExchangeResponse>;
