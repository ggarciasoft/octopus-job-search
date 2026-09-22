-- 0010_workspace_deletion
--
-- Milestone M4 -- deleting a workspace (PR14; 11_TESTING_ACCEPTANCE.md, AT26:
-- "Access revoked, files erased, completion recorded without PII").
--
-- The deletion itself needs no new table: the cascade from `workspaces`
-- already reaches every private row, and `deletion_ledger` (0007) already
-- records the deletion so that a restore cannot bring it back. What is missing
-- is somewhere to record that the deletion *finished*.
--
-- That record cannot live anywhere the deletion reaches. A `tasks` row is
-- workspace-scoped and would cascade away with the workspace it describes;
-- an `audit_events` row likewise. Hence a receipt table with the same
-- deliberate shape as the ledger:
--
-- **`workspace_id` is an identifier, not a reference.** No foreign key, so
-- the receipt outlives the workspace it names.
--
-- **It holds no personal data.** An id, a state, timestamps, a count and a
-- short machine code. 09_SECURITY_PRIVACY.md: "Audit deletion keeps only
-- non-identifying operational counts."
--
-- **It is operator-global.** Excluded from the export and from the cascade,
-- alongside `deletion_ledger`, `system_flags` and `worker_registrations`.
--
-- Purely additive. It only CREATEs its own table; 0001-0009 are frozen.

CREATE TABLE workspace_deletions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- An identifier, not a reference. See the note above.
    workspace_id    uuid NOT NULL,
    state           text NOT NULL DEFAULT 'erasing',
    requested_at    timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    -- Erasure passes attempted. A pass that fails leaves the receipt in
    -- `erasing` for the scheduler to retry; enough of them mark it `failed`.
    attempts        integer NOT NULL DEFAULT 0,
    files_erased    integer NOT NULL DEFAULT 0,
    failure_code    text,
    setup_reopened  boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- Compared against ALL_WORKSPACE_DELETION_STATES.
    CONSTRAINT workspace_deletions_state_check
        CHECK (state IN ('erasing', 'completed', 'failed')),
    CONSTRAINT workspace_deletions_completed_shape
        CHECK ((state = 'completed') = (completed_at IS NOT NULL)),
    CONSTRAINT workspace_deletions_failure_shape
        CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
    -- A machine code, never free text, which would be where detail leaks in.
    CONSTRAINT workspace_deletions_failure_code_check
        CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,60}$'),
    CONSTRAINT workspace_deletions_counts_check
        CHECK (attempts >= 0 AND files_erased >= 0)
);

-- One live erasure per workspace: a second request for a workspace that is
-- already being erased must find the first receipt, not start another.
CREATE UNIQUE INDEX workspace_deletions_one_erasing_idx
    ON workspace_deletions (workspace_id)
    WHERE state = 'erasing';

-- The scheduler resumes unfinished erasures.
CREATE INDEX workspace_deletions_erasing_idx
    ON workspace_deletions (requested_at)
    WHERE state = 'erasing';

COMMENT ON TABLE workspace_deletions IS
    'operator-global: excluded from workspace export and deletion. The receipt '
    'for a workspace deletion (AT26); holds identifiers and counts only.';
