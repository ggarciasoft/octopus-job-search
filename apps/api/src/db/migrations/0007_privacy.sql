-- 0007_privacy
--
-- Milestone M4 -- the deletion ledger (docs/spec/03_DATA_MODEL.md, "Privacy
-- lifecycle": *"Restore must reapply a deletion ledger before exposing
-- data."*; PR14).
--
-- Restoring a backup taken before a deletion brings the deleted data back.
-- That is the one failure mode a privacy deletion cannot have, and it is not
-- something a restore script can reason about on its own: it needs a list of
-- what was deleted since, and that list has to survive the restore.
--
-- Hence a table that breaks the usual rules of this schema, deliberately:
--
-- **It carries `workspace_id` but has no foreign key to `workspaces`.** Every
-- other private table cascades when a workspace is deleted. This one must not:
-- the row recording "workspace X was deleted" is worthless if deleting
-- workspace X deletes it. The column is an identifier, not a reference.
--
-- **It is operator-global, not workspace-scoped.** It is excluded from the
-- workspace export and from the deletion cascade, alongside `system_flags`
-- and `worker_registrations`. Exporting it would hand the user a list of ids
-- rather than any data of theirs; cascading it would destroy the record that
-- makes a restore safe.
--
-- **It holds identifiers and nothing else.** No name, no answer, no file
-- contents, no employer. 09_SECURITY_PRIVACY.md: "Audit deletion keeps only
-- non-identifying operational counts." A UUID and a kind are what a restore
-- needs to re-delete a row, and they are all it gets.
--
-- Purely additive. It only CREATEs its own table; 0001-0006 are frozen.

CREATE TABLE deletion_ledger (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- An identifier, not a reference. See the note above.
    workspace_id uuid NOT NULL,
    object_kind  text NOT NULL,
    -- NULL for a whole-workspace deletion: there is no single row to name.
    object_id    uuid,
    deleted_at   timestamptz NOT NULL DEFAULT now(),
    -- A short machine-readable reason, e.g. 'user_request'. Never free text
    -- about the object, which would be the identifying detail this table
    -- exists to avoid holding.
    reason       text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- Compared against DeletedObjectKind.
    CONSTRAINT deletion_ledger_kind_check CHECK (object_kind IN (
        'workspace', 'file', 'answer_bank', 'source', 'application',
        'resume', 'profile_fact'
    )),
    -- Every kind but `workspace` names the row it deleted; a workspace
    -- deletion names none, because it deleted all of them.
    CONSTRAINT deletion_ledger_object_id_shape
        CHECK ((object_kind = 'workspace') = (object_id IS NULL)),
    CONSTRAINT deletion_ledger_reason_check
        CHECK (reason IS NULL OR reason ~ '^[a-z0-9_]{1,60}$')
);

-- The restore replay reads the whole ledger for one workspace in order.
CREATE INDEX deletion_ledger_workspace_idx ON deletion_ledger (workspace_id, deleted_at);
-- And the merge step during a restore looks a row up by what it names.
CREATE INDEX deletion_ledger_object_idx ON deletion_ledger (object_kind, object_id);

COMMENT ON TABLE deletion_ledger IS
    'operator-global: excluded from workspace export and deletion. Records '
    'what was deleted so a restore of an older backup cannot resurrect it '
    '(03_DATA_MODEL.md, "Privacy lifecycle"). Holds identifiers only.';
