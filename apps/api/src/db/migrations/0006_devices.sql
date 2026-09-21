-- 0006_devices
--
-- Milestone M4 -- paired devices and the form schema a runner actually saw
-- (docs/spec/03_DATA_MODEL.md row `paired_devices`;
-- docs/spec/04_API_CONTRACTS.md "Device pairing requires approval in an
-- authenticated web session"; docs/spec/07_APPLICATION_AUTOMATION.md
-- "Local browser runner M4").
--
-- The same invariants as 0001-0005 apply: UUID keys, timestamptz everywhere,
-- workspace_id on every private table, UNIQUE (workspace_id, id) targets and
-- COMPOSITE (workspace_id, id) references between private tables.
--
-- A device token is the most dangerous credential this system issues: it lets
-- a process outside the browser act on the owner's data. Three rules are
-- therefore in the schema rather than in a handler.
--
-- **Nothing is stored that could be replayed.** The pairing code and the token
-- are held as SHA-256 digests. A database dump yields neither; a device that
-- loses its token pairs again.
--
-- **A row is either waiting to pair or paired, never neither.** A row with no
-- code and no token is a device that can never be used and can never be
-- cleaned up by anything that looks at expiry, so the CHECK refuses it. A
-- token always carries its own expiry, because the spec fixes one at 30 days.
--
-- **Revocation is a column, not a deletion.** The user needs to see that a
-- device was revoked and when; authentication reads the column on every
-- request, so denial takes effect immediately rather than at the next expiry.
--
-- Also here: two columns on `applications` recording the form schema a runner
-- observed. A packet snapshots the schema it was approved against; once a
-- runner has seen the real page, a later packet snapshots that, and an
-- approval whose schema no longer matches is withdrawn the same way a changed
-- CV or profile withdraws one. 03_DATA_MODEL.md names "known form schema" as
-- an approval invalidator, and this is what makes that comparison possible.
--
-- Purely additive: one CREATE TABLE and two ADD COLUMNs. 0001-0005 are frozen.

CREATE TABLE paired_devices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    kind                text NOT NULL,
    label               text NOT NULL,
    -- Single-use, five minutes, minted only inside an authenticated session.
    pairing_code_hash   text,
    pairing_expires_at  timestamptz,
    pairing_consumed_at timestamptz,
    -- The scoped token. NULL until the code is exchanged.
    token_hash          text UNIQUE,
    -- How the device names itself, recorded at exchange so the user can tell
    -- which machine this is before revoking it.
    device_public_id    text,
    expires_at          timestamptz,
    revoked_at          timestamptz,
    last_seen_at        timestamptz,
    -- Scheme-and-host origins this device may act on. Empty means none.
    allowed_origins     jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT paired_devices_id_workspace_key UNIQUE (workspace_id, id),
    -- Compared against DeviceKind.
    CONSTRAINT paired_devices_kind_check CHECK (kind IN ('local_runner', 'extension')),
    CONSTRAINT paired_devices_label_check CHECK (length(label) BETWEEN 1 AND 120),
    -- A code without a deadline never expires, which is the one thing a
    -- single-use pairing code must not be.
    CONSTRAINT paired_devices_pairing_needs_expiry
        CHECK ((pairing_code_hash IS NULL) = (pairing_expires_at IS NULL)),
    -- A token without a deadline is a permanent credential.
    CONSTRAINT paired_devices_token_needs_expiry
        CHECK ((token_hash IS NULL) = (expires_at IS NULL)),
    -- Neither pending nor paired is a row nothing can ever use -- unless it
    -- was revoked, which is precisely a row that must no longer be usable.
    -- Revocation clears both secrets, so a leaked copy is inert rather than
    -- merely refused by a check somebody could forget to write.
    CONSTRAINT paired_devices_pending_or_paired CHECK (
        revoked_at IS NOT NULL
        OR pairing_code_hash IS NOT NULL
        OR token_hash IS NOT NULL
    ),
    -- Digests, never the values themselves.
    CONSTRAINT paired_devices_code_hash_check
        CHECK (pairing_code_hash IS NULL OR pairing_code_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT paired_devices_token_hash_check
        CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX paired_devices_workspace_idx ON paired_devices (workspace_id, created_at DESC);
-- Expired pending pairings are swept; the partial index keeps that cheap.
CREATE INDEX paired_devices_pairing_expiry_idx
    ON paired_devices (pairing_expires_at) WHERE token_hash IS NULL;

-- ---------------------------------------------------------------------------
-- The observed form schema
-- ---------------------------------------------------------------------------

ALTER TABLE applications
    ADD COLUMN observed_form_fingerprint text,
    ADD COLUMN form_observed_at timestamptz;

-- Both together or neither: a fingerprint with no time attached cannot be
-- judged against the packet that came before or after it.
ALTER TABLE applications
    ADD CONSTRAINT applications_form_observation_complete
    CHECK ((observed_form_fingerprint IS NULL) = (form_observed_at IS NULL));
