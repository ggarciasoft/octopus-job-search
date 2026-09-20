-- 0002_discovery
--
-- Milestone M2 — job discovery (docs/spec/03_DATA_MODEL.md rows `sources`,
-- `scans`, `jobs`, `job_sources`; docs/spec/05_DISCOVERY_CONNECTORS.md).
--
-- The same invariants as 0001 apply: UUID keys, timestamptz everywhere,
-- workspace_id on every private table, UNIQUE (workspace_id, id) targets and
-- COMPOSITE (workspace_id, id) references between private tables. Every CHECK
-- below is compared against the enumeration in @job-getter/contracts by
-- tests/db/discovery-schema.test.ts.
--
-- One PostgreSQL subtlety a composite reference introduces: a bare
-- ON DELETE SET NULL nulls *every* referencing column, workspace_id included,
-- which the NOT NULL constraint then rejects. Every nullable composite
-- reference below therefore names the column to null (SET NULL (col),
-- PostgreSQL 15+), so deleting a source or a task leaves the row in its
-- workspace with only the pointer cleared.
--
-- Purely additive. It only CREATEs and ALTERs its own tables; 0001 is frozen.

-- ---------------------------------------------------------------------------
-- Sources: the board registry
-- ---------------------------------------------------------------------------

CREATE TABLE sources (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    connector            text NOT NULL,
    connector_version    text NOT NULL,
    -- Greenhouse board token or Lever site slug.
    board_key            text NOT NULL,
    -- Only for connectors with a documented regional endpoint (Lever EU).
    base_url             text,
    enabled              boolean NOT NULL DEFAULT true,
    last_success_at      timestamptz,
    -- The most recently queued scan; the FK is added after `scans` exists.
    last_scan_id         uuid,
    -- NULL means "due now"; the scheduler sets it when it queues a scan.
    next_scan_after      timestamptz,
    -- Health as the API decides it from worker observations. `blocked` stops
    -- scheduling until the user re-enables the source (05: "stop on repeated
    -- 403/429 and show source health").
    health_state         text NOT NULL DEFAULT 'unknown',
    consecutive_failures integer NOT NULL DEFAULT 0,
    -- Only 403/429 count towards blocking; a timeout is not a refusal.
    consecutive_denials  integer NOT NULL DEFAULT 0,
    last_error_code      text,
    last_error_at        timestamptz,
    health_detail        text,
    -- Conditional-request hints from the last successful scan.
    etag                 text,
    last_modified        text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sources_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT sources_board_key UNIQUE (workspace_id, connector, board_key),
    -- Compared against BOARD_CONNECTOR_IDS: only a scannable board is a source.
    CONSTRAINT sources_connector_check CHECK (connector IN ('greenhouse', 'lever')),
    -- Compared against SourceHealthState.
    CONSTRAINT sources_health_state_check CHECK (health_state IN (
        'unknown',
        'ok',
        'degraded',
        'blocked',
        'disabled'
    )),
    CONSTRAINT sources_failures_check
        CHECK (consecutive_failures >= 0 AND consecutive_denials >= 0)
);

CREATE INDEX sources_due_idx ON sources (next_scan_after) WHERE enabled = true;

-- ---------------------------------------------------------------------------
-- Scans: one row per queued board fetch
-- ---------------------------------------------------------------------------

CREATE TABLE scans (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    source_id         uuid NOT NULL,
    task_id           uuid,
    status            text NOT NULL DEFAULT 'queued',
    -- Only a complete snapshot may be used to decide that a job disappeared.
    complete_snapshot boolean NOT NULL DEFAULT false,
    counts            jsonb NOT NULL DEFAULT
        '{"fetched":0,"created":0,"updated":0,"unchanged":0,"closed":0,"pages":0}'::jsonb,
    error_code        text,
    error_message     text,
    started_at        timestamptz,
    completed_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT scans_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT scans_source_fk
        FOREIGN KEY (workspace_id, source_id) REFERENCES sources (workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT scans_task_fk
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id)
        ON DELETE SET NULL (task_id),
    -- Compared against ScanStatus.
    CONSTRAINT scans_status_check CHECK (status IN (
        'queued',
        'running',
        'succeeded',
        'partial',
        'failed',
        'cancelled'
    ))
);

CREATE INDEX scans_source_created_idx ON scans (workspace_id, source_id, created_at DESC);
CREATE INDEX scans_task_idx ON scans (task_id);
-- "Never more than one in-flight scan per source", enforced by the database
-- so two API replicas cannot both queue one in the same instant.
CREATE UNIQUE INDEX scans_one_in_flight_idx
    ON scans (source_id)
    WHERE status IN ('queued', 'running');

ALTER TABLE sources
    ADD CONSTRAINT sources_last_scan_fk
    FOREIGN KEY (workspace_id, last_scan_id) REFERENCES scans (workspace_id, id)
    ON DELETE SET NULL (last_scan_id);

-- ---------------------------------------------------------------------------
-- Jobs: the deduplicated, normalised posting
-- ---------------------------------------------------------------------------

CREATE TABLE jobs (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    -- connector + board + external id when available, else the normalised
    -- employer URL (03_DATA_MODEL.md "Deduplication").
    canonical_key      text NOT NULL,
    company            text NOT NULL,
    title              text NOT NULL,
    description_text   text NOT NULL,
    locations          jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Stored exactly as stated; NULL when the posting states no salary.
    salary             jsonb,
    requirements       jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Fields the connector inferred rather than read, with their excerpts.
    inferred           jsonb NOT NULL DEFAULT '[]'::jsonb,
    remote_type        text NOT NULL DEFAULT 'unknown',
    -- NULL means the posting does not say. Never "anywhere".
    eligible_countries jsonb,
    employment_type    text,
    language           text,
    status             text NOT NULL DEFAULT 'active',
    content_hash       text NOT NULL,
    revision           integer NOT NULL DEFAULT 1,
    -- Never invented: NULL when the source states no date.
    published_at       timestamptz,
    source_updated_at  timestamptz,
    first_seen_at      timestamptz NOT NULL,
    last_seen_at       timestamptz NOT NULL,
    -- Last successful fetch of this job's content; drives the >24h recheck.
    last_fetched_at    timestamptz,
    saved              boolean NOT NULL DEFAULT false,
    -- Set by a hard filter (M3); employer exclusion is computed on read.
    excluded_reason    text,
    closed_at          timestamptz,
    -- Why it closed: a user action, disappearance from complete snapshots,
    -- or the source saying so. Only a snapshot closure reopens on reappearance.
    closed_reason      text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT jobs_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT jobs_canonical_key UNIQUE (workspace_id, canonical_key),
    -- Compared against ALL_JOB_STATUSES.
    CONSTRAINT jobs_status_check CHECK (status IN ('active', 'closed', 'unknown')),
    -- Compared against RemoteType.
    CONSTRAINT jobs_remote_type_check
        CHECK (remote_type IN ('remote', 'hybrid', 'onsite', 'unknown')),
    -- Compared against JobEmploymentType.
    CONSTRAINT jobs_employment_type_check CHECK (employment_type IS NULL OR employment_type IN (
        'full_time',
        'part_time',
        'contract',
        'internship',
        'temporary',
        'freelance'
    )),
    CONSTRAINT jobs_closed_reason_check
        CHECK (closed_reason IS NULL OR closed_reason IN ('user', 'snapshot', 'source')),
    CONSTRAINT jobs_revision_check CHECK (revision >= 1),
    CONSTRAINT jobs_content_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$')
);

-- Required by 03_DATA_MODEL.md: the list query's access path.
CREATE INDEX jobs_workspace_status_last_seen_idx ON jobs (workspace_id, status, last_seen_at DESC);
-- Possible-duplicate detection joins on normalised employer and title:
-- case-folded, trimmed, inner whitespace collapsed. The expressions must match
-- NORMALIZED_COMPANY_SQL / normalizedColumn in src/discovery/jobs.ts.
CREATE INDEX jobs_company_title_idx ON jobs (
    workspace_id,
    lower(regexp_replace(btrim(company), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))
);

-- ---------------------------------------------------------------------------
-- Job provenance: every source a job was seen through
-- ---------------------------------------------------------------------------

CREATE TABLE job_sources (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    job_id            uuid NOT NULL,
    -- NULL for a manual/URL import, and after the source was deleted:
    -- "keep historical jobs" means provenance outlives the source row.
    source_id         uuid,
    connector         text NOT NULL,
    external_id       text NOT NULL,
    -- The connector's identity for this posting; one row per identity.
    source_key        text NOT NULL,
    canonical_url     text NOT NULL,
    apply_url         text,
    retrieved_at      timestamptz NOT NULL,
    -- Closure bookkeeping, per source (05 "Freshness and closure"). Counts
    -- only *complete* snapshots this identity was absent from.
    missing_snapshots integer NOT NULL DEFAULT 0,
    missing_since     timestamptz,
    last_missing_at   timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_sources_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT job_sources_source_key UNIQUE (workspace_id, source_key),
    CONSTRAINT job_sources_job_fk
        FOREIGN KEY (workspace_id, job_id) REFERENCES jobs (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT job_sources_source_fk
        FOREIGN KEY (workspace_id, source_id) REFERENCES sources (workspace_id, id)
        ON DELETE SET NULL (source_id),
    -- Compared against ALL_CONNECTOR_IDS.
    CONSTRAINT job_sources_connector_check
        CHECK (connector IN ('greenhouse', 'lever', 'manual', 'url')),
    CONSTRAINT job_sources_missing_check CHECK (missing_snapshots >= 0)
);

CREATE INDEX job_sources_job_idx ON job_sources (workspace_id, job_id);
CREATE INDEX job_sources_source_idx ON job_sources (workspace_id, source_id);
CREATE INDEX job_sources_apply_url_idx
    ON job_sources (workspace_id, apply_url)
    WHERE apply_url IS NOT NULL;
CREATE INDEX job_sources_requisition_idx ON job_sources (workspace_id, connector, external_id);

-- ---------------------------------------------------------------------------
-- Job imports: POST /jobs/import
-- ---------------------------------------------------------------------------

CREATE TABLE job_imports (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    task_id       uuid,
    status        text NOT NULL DEFAULT 'queued',
    -- The request minus the pasted description, which already travels in the
    -- task payload: the same bytes are not stored twice.
    input         jsonb NOT NULL DEFAULT '{}'::jsonb,
    job_id        uuid,
    -- When the page held several postings the user must choose from these.
    candidates    jsonb NOT NULL DEFAULT '[]'::jsonb,
    warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,
    error_code    text,
    error_message text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_imports_id_workspace_key UNIQUE (workspace_id, id),
    CONSTRAINT job_imports_task_fk
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id)
        ON DELETE SET NULL (task_id),
    CONSTRAINT job_imports_job_fk
        FOREIGN KEY (workspace_id, job_id) REFERENCES jobs (workspace_id, id)
        ON DELETE SET NULL (job_id),
    -- Compared against JOB_IMPORT_STATUSES in src/discovery/imports.ts.
    CONSTRAINT job_imports_status_check CHECK (status IN (
        'queued',
        'resolved',
        'needs_choice',
        'failed'
    ))
);

CREATE INDEX job_imports_task_idx ON job_imports (task_id);
CREATE INDEX job_imports_workspace_created_idx ON job_imports (workspace_id, created_at DESC);
