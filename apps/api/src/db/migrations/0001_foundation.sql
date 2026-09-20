-- 0001_foundation
--
-- Foundation schema for milestone M0 (docs/spec/03_DATA_MODEL.md).
--
-- Invariants encoded here, not only in application code:
--
--  * UUID primary keys via pgcrypto's gen_random_uuid(); every timestamp is
--    timestamptz; created_at/updated_at on everything except append-only rows.
--  * Every private table carries workspace_id, and every foreign key between
--    private tables is a COMPOSITE (workspace_id, id) reference. A row in
--    workspace A therefore cannot reference a row in workspace B even if the
--    application forgot a WHERE clause. Each private table exposes the
--    matching UNIQUE (workspace_id, id) target for those references.
--  * CHECK constraints carry the task type/state enumerations. They are
--    written literally here and compared against ALL_TASK_TYPES /
--    ALL_TASK_STATES from @job-getter/contracts by
--    tests/db/enum-drift.test.ts, so drift fails CI rather than production.
--
-- Rollback note: this migration is purely additive (it only CREATEs). To roll
-- back a failed install, drop the database; there is no destructive down
-- migration, because 10_DEPLOYMENT.md forbids blindly running down migrations
-- against live data. Later migrations must also prefer additive changes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Operator-global tables (no workspace scope by design)
-- ---------------------------------------------------------------------------

-- Single-row-per-key store for facts about the installation itself. Used to
-- make one-time setup *permanently* closed: deleting the owner user must not
-- reopen the bootstrap route (09_SECURITY_PRIVACY.md).
CREATE TABLE system_flags (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Lower-cased, trimmed address. Uniqueness is on this column so that
    -- "A@Example.com" and "a@example.com" cannot both be registered.
    normalized_email text NOT NULL,
    email            text NOT NULL,
    -- Argon2id encoded hash. Never a plaintext or reversible value.
    password_hash    text NOT NULL,
    verified_at      timestamptz,
    disabled_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_normalized_email_key UNIQUE (normalized_email)
);

CREATE TABLE workspaces (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    mode           text NOT NULL,
    locale         text NOT NULL DEFAULT 'en',
    deletion_state text NOT NULL DEFAULT 'active',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspaces_mode_check CHECK (mode IN ('local', 'hosted')),
    CONSTRAINT workspaces_locale_check CHECK (locale IN ('en', 'es')),
    CONSTRAINT workspaces_deletion_state_check
        CHECK (deletion_state IN ('active', 'deleting', 'deleted'))
);

CREATE INDEX workspaces_owner_user_id_idx ON workspaces (owner_user_id);

-- Operational registry of polling workers.
--
-- NOT PRIVATE DATA. This table records operator infrastructure, not anything a
-- user entered: a worker id, the capabilities it declared and when it last
-- polled. It exists so GET /me can report `worker_online` from observed
-- behaviour instead of guessing (invariant 10) — a worker polling an empty
-- queue still counts as online, which the tasks table alone cannot express.
--
-- Consequences, asserted by tests/db/schema.test.ts:
--   * It is absent from WORKSPACE_SCOPED_TABLES in src/db/types.ts, so the
--     workspace scope chokepoint will not query it.
--   * It is excluded from workspace export: it contains no user data, and an
--     export is defined as the user's own records (09_SECURITY_PRIVACY.md).
--   * It is excluded from workspace deletion. workspace_id is set only for a
--     paired local runner, and ON DELETE SET NULL rather than CASCADE is
--     deliberate: deleting a workspace must not delete the operator's record
--     of a running process. The association is dropped; the worker row stays.
CREATE TABLE worker_registrations (
    worker_id        text PRIMARY KEY,
    workspace_id     uuid REFERENCES workspaces (id) ON DELETE SET NULL,
    kind             text NOT NULL DEFAULT 'worker',
    capabilities     jsonb NOT NULL DEFAULT '[]'::jsonb,
    protocol_version integer NOT NULL,
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT worker_registrations_kind_check CHECK (kind IN ('worker', 'device'))
);

CREATE INDEX worker_registrations_last_seen_idx ON worker_registrations (last_seen_at DESC);

COMMENT ON TABLE worker_registrations IS
    'operator-global: not private workspace data; excluded from workspace export and deletion';

-- ---------------------------------------------------------------------------
-- Membership and sessions
-- ---------------------------------------------------------------------------

CREATE TABLE memberships (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT memberships_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT memberships_workspace_user_key UNIQUE (workspace_id, user_id),
    CONSTRAINT memberships_role_check CHECK (role IN ('owner'))
);

-- "one owner in v1" (03_DATA_MODEL.md) enforced by the database, not by hope.
CREATE UNIQUE INDEX memberships_single_owner_idx
    ON memberships (workspace_id)
    WHERE role = 'owner';

CREATE INDEX memberships_user_id_idx ON memberships (user_id);

CREATE TABLE sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The opaque session token is never stored; only its SHA-256 digest.
    token_hash   text NOT NULL,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Sessions carry the workspace they are scoped to so that authorization
    -- never has to trust a client-supplied workspace_id.
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
    CONSTRAINT sessions_id_workspace_key UNIQUE (workspace_id, id)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

CREATE TABLE files (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    -- A generated identifier, never the user's filename
    -- (09_SECURITY_PRIVACY.md). Globally unique across workspaces.
    storage_key   text NOT NULL,
    original_name text NOT NULL,
    mime          text NOT NULL,
    bytes         bigint NOT NULL,
    sha256        text NOT NULL,
    state         text NOT NULL DEFAULT 'staging',
    purpose       text NOT NULL,
    -- Set for staging rows; the scheduler sweeps them after 24 hours.
    expires_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT files_storage_key_key UNIQUE (storage_key),
    CONSTRAINT files_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT files_state_check CHECK (state IN ('staging', 'ready', 'deleting')),
    CONSTRAINT files_purpose_check
        CHECK (purpose IN ('cv_original', 'profile_text', 'generated_cv', 'export', 'evidence')),
    CONSTRAINT files_bytes_check CHECK (bytes >= 0),
    CONSTRAINT files_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX files_workspace_state_idx ON files (workspace_id, state);
CREATE INDEX files_staging_expiry_idx ON files (expires_at) WHERE state = 'staging';

-- ---------------------------------------------------------------------------
-- Tasks: the PostgreSQL-backed queue
-- ---------------------------------------------------------------------------

CREATE TABLE tasks (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    type             text NOT NULL,
    state            text NOT NULL DEFAULT 'queued',
    payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
    result           jsonb,
    -- NULL means "no client idempotency key"; the unique constraint below
    -- therefore does not collapse unrelated tasks of the same type.
    idempotency_key  text,
    attempt          integer NOT NULL DEFAULT 0,
    max_attempts     integer NOT NULL DEFAULT 3,
    run_after        timestamptz NOT NULL DEFAULT now(),
    -- Only the digest of the lease token is stored, exactly like a session.
    lease_token_hash text,
    lease_expires_at timestamptz,
    leased_by        text,
    last_heartbeat_at timestamptz,
    -- The capability a worker must declare to claim this row. Defaults to the
    -- task type; kept separate so a future type can map to a narrower
    -- capability without changing the type enumeration.
    capability       text NOT NULL,
    progress         jsonb,
    cancel_requested boolean NOT NULL DEFAULT false,
    error_code       text,
    error_message    text,
    error_retryable  boolean,
    -- Files the worker is allowed to download through the task-scoped
    -- endpoint. Declared at enqueue time; nothing else is servable.
    input_file_ids   uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tasks_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT tasks_idempotency_key UNIQUE (workspace_id, type, idempotency_key),
    -- Compared against ALL_TASK_TYPES in tests/db/enum-drift.test.ts.
    CONSTRAINT tasks_type_check CHECK (type IN (
        'noop_echo',
        'parse_profile',
        'fetch_board',
        'fetch_job',
        'match_job',
        'render_cv',
        'build_packet',
        'fill_local',
        'export_workspace',
        'delete_workspace',
        'discover_boards'
    )),
    -- Compared against ALL_TASK_STATES in tests/db/enum-drift.test.ts.
    CONSTRAINT tasks_state_check CHECK (state IN (
        'queued',
        'leased',
        'succeeded',
        'failed',
        'cancelled'
    )),
    CONSTRAINT tasks_attempt_check CHECK (attempt >= 0 AND attempt <= max_attempts),
    CONSTRAINT tasks_max_attempts_check CHECK (max_attempts >= 1),
    -- A leased row must have both lease columns; a non-leased row neither.
    CONSTRAINT tasks_lease_consistency_check CHECK (
        (state = 'leased' AND lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state <> 'leased' AND lease_token_hash IS NULL AND lease_expires_at IS NULL)
    )
);

-- Required by 03_DATA_MODEL.md: the claim query's access path.
CREATE INDEX tasks_state_run_after_idx ON tasks (state, run_after);
-- Partial index for leased rows only, used by lease reclamation.
CREATE INDEX tasks_lease_expires_at_idx ON tasks (lease_expires_at) WHERE state = 'leased';
CREATE INDEX tasks_workspace_created_idx ON tasks (workspace_id, created_at DESC);

CREATE TABLE task_artifacts (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    task_id          uuid NOT NULL,
    file_id          uuid NOT NULL,
    -- Ties the artifact to the lease that uploaded it: a reclaimed task's old
    -- worker cannot commit artifacts against the new lease.
    lease_token_hash text NOT NULL,
    committed        boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT task_artifacts_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT task_artifacts_file_key UNIQUE (workspace_id, task_id, file_id),
    CONSTRAINT task_artifacts_task_fk
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT task_artifacts_file_fk
        FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX task_artifacts_task_idx ON task_artifacts (task_id);
CREATE INDEX task_artifacts_uncommitted_idx ON task_artifacts (created_at) WHERE committed = false;

-- ---------------------------------------------------------------------------
-- Idempotency replay store (04_API_CONTRACTS.md)
--
-- "Store response for 24 hours; domain uniqueness remains after expiration."
-- The stored response is what makes a retry safe; the *domain* uniqueness
-- (tasks_idempotency_key above) is what makes it correct after the stored
-- response expires.
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_records (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    route_key       text NOT NULL,
    idempotency_key text NOT NULL,
    -- SHA-256 of the canonicalised request body: same key + different body
    -- must be rejected with 409 rather than replayed.
    request_hash    text NOT NULL,
    response_status integer NOT NULL,
    response_body   jsonb NOT NULL,
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT idempotency_records_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT idempotency_records_key_unique UNIQUE (workspace_id, route_key, idempotency_key)
);

CREATE INDEX idempotency_records_expires_idx ON idempotency_records (expires_at);

-- ---------------------------------------------------------------------------
-- Audit (append-only: no updated_at)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    actor_id     uuid REFERENCES users (id) ON DELETE SET NULL,
    action       text NOT NULL,
    object_id    uuid,
    object_type  text,
    -- Redacted metadata only: counts and identifiers, never CV text, answers,
    -- tokens or prompts (09_SECURITY_PRIVACY.md).
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_events_id_workspace_key UNIQUE (workspace_id, id)
);

CREATE INDEX audit_events_workspace_occurred_idx ON audit_events (workspace_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Milestone M1 tables
--
-- Created now because 00_AI_IMPLEMENTATION_INSTRUCTIONS.md wants migrations up
-- front, but no M0 code reads or writes them beyond creating the empty profile
-- and preferences rows during owner setup. Their behaviour belongs to M1.
-- ---------------------------------------------------------------------------

CREATE TABLE profiles (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    revision           integer NOT NULL DEFAULT 1,
    confirmed_revision integer,
    contact            jsonb,
    locale             text NOT NULL DEFAULT 'en',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_workspace_key UNIQUE (workspace_id),
    CONSTRAINT profiles_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT profiles_locale_check CHECK (locale IN ('en', 'es')),
    CONSTRAINT profiles_revision_check CHECK (revision >= 1),
    CONSTRAINT profiles_confirmed_revision_check
        CHECK (confirmed_revision IS NULL OR confirmed_revision <= revision)
);

CREATE TABLE profile_facts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    profile_id     uuid NOT NULL,
    kind           text NOT NULL,
    value          jsonb NOT NULL,
    source_file_id uuid,
    source_excerpt text,
    -- Nothing extracted by a model is usable until the user confirms it.
    confirmed      boolean NOT NULL DEFAULT false,
    revision       integer NOT NULL,
    supersedes_id  uuid,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profile_facts_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT profile_facts_profile_fk
        FOREIGN KEY (workspace_id, profile_id) REFERENCES profiles (workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT profile_facts_source_file_fk
        FOREIGN KEY (workspace_id, source_file_id) REFERENCES files (workspace_id, id)
        ON DELETE SET NULL,
    CONSTRAINT profile_facts_supersedes_fk
        FOREIGN KEY (workspace_id, supersedes_id) REFERENCES profile_facts (workspace_id, id)
        ON DELETE SET NULL,
    CONSTRAINT profile_facts_kind_check CHECK (kind IN (
        'contact',
        'summary',
        'experience',
        'education',
        'skill',
        'language',
        'authorization',
        'project',
        'certification'
    ))
);

CREATE INDEX profile_facts_profile_idx ON profile_facts (workspace_id, profile_id, kind);

CREATE TABLE preferences (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    revision     integer NOT NULL DEFAULT 1,
    config       jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT preferences_workspace_key UNIQUE (workspace_id),
    CONSTRAINT preferences_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT preferences_revision_check CHECK (revision >= 1)
);

CREATE TABLE profile_imports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    file_id         uuid,
    text_file_id    uuid,
    task_id         uuid,
    status          text NOT NULL DEFAULT 'queued',
    format_hint     text NOT NULL DEFAULT 'auto',
    extracted_draft jsonb,
    warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
    error_code      text,
    error_message   text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profile_imports_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT profile_imports_file_fk
        FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL,
    CONSTRAINT profile_imports_text_file_fk
        FOREIGN KEY (workspace_id, text_file_id) REFERENCES files (workspace_id, id)
        ON DELETE SET NULL,
    CONSTRAINT profile_imports_task_fk
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE SET NULL,
    CONSTRAINT profile_imports_status_check CHECK (status IN (
        'queued',
        'parsing',
        'ready_for_review',
        'confirmed',
        'failed'
    ))
);

CREATE INDEX profile_imports_workspace_created_idx
    ON profile_imports (workspace_id, created_at DESC);

CREATE TABLE provider_settings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    provider          text NOT NULL DEFAULT 'none',
    base_url          text,
    model             text NOT NULL DEFAULT '',
    -- Authenticated encryption with an operator key held outside the database
    -- (09_SECURITY_PRIVACY.md). Never returned by the API.
    secret_ciphertext bytea,
    daily_budget      numeric(12, 4),
    validated_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT provider_settings_workspace_key UNIQUE (workspace_id),
    CONSTRAINT provider_settings_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT provider_settings_provider_check
        CHECK (provider IN ('none', 'fake', 'ollama', 'openai_compatible'))
);

CREATE TABLE usage_ledger (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    task_id       uuid,
    provider      text NOT NULL,
    input_tokens  integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    -- NULL cost means "unknown", never zero: without a rate card no cost can
    -- be claimed (04_API_CONTRACTS.md / 06_AI_PROFILE_AND_CV.md).
    measured_cost numeric(12, 6),
    reserved_cost numeric(12, 6),
    currency      text,
    status        text NOT NULL DEFAULT 'reserved',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT usage_ledger_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT usage_ledger_task_fk
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE SET NULL,
    CONSTRAINT usage_ledger_provider_check
        CHECK (provider IN ('none', 'fake', 'ollama', 'openai_compatible')),
    CONSTRAINT usage_ledger_status_check CHECK (status IN ('reserved', 'settled', 'released')),
    CONSTRAINT usage_ledger_currency_check CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

CREATE INDEX usage_ledger_workspace_created_idx ON usage_ledger (workspace_id, created_at DESC);
