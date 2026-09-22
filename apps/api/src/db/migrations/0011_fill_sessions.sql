-- 0011_fill_sessions
--
-- Milestone M5 -- the scoped credential the browser extension fills with
-- (docs/spec/07_APPLICATION_AUTOMATION.md "Extension M5": "Extension requests
-- a fill session from API. The session binds device_id, tab origin,
-- application_id, packet_hash, nonce and ten-minute expiry. API allows only
-- current approved packets"; docs/spec/12_IMPLEMENTATION_PLAN.md M5, "scoped
-- fill sessions").
--
-- The same invariants as 0001-0010 apply: UUID keys, timestamptz everywhere,
-- workspace_id on every private table, UNIQUE (workspace_id, id) targets and
-- COMPOSITE (workspace_id, id) references between private tables.
--
-- A paired local runner gets its work through the task queue, where the lease
-- token bounds what it may do and for how long. The extension cannot use that
-- path -- `/internal/v1` is deliberately not proxied to a browser -- so this
-- table is the equivalent bound credential, and it is narrower than a lease
-- on purpose. Four of its rules are here in the schema rather than in a
-- handler, because each is a rule a handler could be rewritten to forget.
--
-- **The page is named before the session exists.** `origin` is NOT NULL and
-- must be an http(s) origin. There is no session that is valid "anywhere",
-- and no later request can widen one: the column is written once, at creation,
-- from the device's own declared origins.
--
-- **Nothing stored here can be replayed.** The nonce is held as a SHA-256
-- digest, like every other secret in this schema (`token_hash`,
-- `lease_token_hash`, `pairing_code_hash`). A database dump yields no
-- credential; an extension that loses its nonce asks for a new session, which
-- re-checks the approval from scratch.
--
-- **One live session per application.** A partial unique index, not a query in
-- a handler, so two extensions racing on the same application cannot both win
-- (AT15, "only one active fill session; second returns conflict"). Expired
-- sessions are ended before a new one is inserted, so expiry frees the slot
-- without freeing it to a concurrent caller.
--
-- **A session that ended says why.** `ended_at` and `ended_reason` are both
-- present or both absent. A finished session with no reason is a session
-- nobody can explain to the person whose application it touched.
--
-- Purely additive: one CREATE TABLE. 0001-0010 are frozen.

CREATE TABLE fill_sessions (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    -- Which paired extension holds it. Composite FK: a device from another
    -- workspace cannot be referenced even if its UUID is guessed.
    device_id              uuid NOT NULL,
    application_id         uuid NOT NULL,
    -- The packet as it was when the session was granted. Both are frozen here
    -- so a packet that moves afterwards is detectable without re-deriving it.
    packet_id              uuid NOT NULL,
    content_hash           text NOT NULL,
    -- The tab origin this session may act on, and nothing else.
    origin                 text NOT NULL,
    -- The digest of the nonce returned once to the service worker.
    nonce_hash             text NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    expires_at             timestamptz NOT NULL,
    ended_at               timestamptz,
    ended_reason           text,
    last_seen_at           timestamptz,
    CONSTRAINT fill_sessions_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT fill_sessions_device_fkey
        FOREIGN KEY (workspace_id, device_id)
        REFERENCES paired_devices (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fill_sessions_application_fkey
        FOREIGN KEY (workspace_id, application_id)
        REFERENCES applications (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fill_sessions_packet_fkey
        FOREIGN KEY (workspace_id, packet_id)
        REFERENCES application_packets (workspace_id, id) ON DELETE CASCADE,
    -- Digests, never the values themselves.
    CONSTRAINT fill_sessions_nonce_hash_check CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT fill_sessions_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    -- An origin, not a URL: scheme and host, no path. The handler normalises
    -- through `new URL().origin`; this refuses anything that got past it.
    CONSTRAINT fill_sessions_origin_check
        CHECK (origin ~ '^https?://[^/]+$' AND length(origin) BETWEEN 1 AND 500),
    -- A session with no deadline is a permanent credential.
    CONSTRAINT fill_sessions_expires_after_creation CHECK (expires_at > created_at),
    -- Compared against FillSessionEndReason.
    CONSTRAINT fill_sessions_end_reason_check CHECK (
        ended_reason IS NULL
        OR ended_reason IN ('reported', 'cancelled', 'superseded', 'device_revoked')
    ),
    CONSTRAINT fill_sessions_ended_needs_reason
        CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);

-- AT15, in the schema: a second session for the same application is refused
-- while one is still live.
CREATE UNIQUE INDEX fill_sessions_one_live_per_application
    ON fill_sessions (workspace_id, application_id) WHERE ended_at IS NULL;

CREATE INDEX fill_sessions_workspace_idx ON fill_sessions (workspace_id, created_at DESC);
-- Live sessions are swept on expiry; the partial index keeps that cheap.
CREATE INDEX fill_sessions_expiry_idx ON fill_sessions (expires_at) WHERE ended_at IS NULL;
-- Revoking a device ends its sessions in the same statement.
CREATE INDEX fill_sessions_device_idx ON fill_sessions (workspace_id, device_id) WHERE ended_at IS NULL;
