-- =============================================================================
-- scripts/reapply-deletions.sql - make a restore respect what was deleted
--
-- docs/spec/03_DATA_MODEL.md, "Privacy lifecycle": *"Restore must reapply a
-- deletion ledger before exposing data."*
--
-- Restoring a backup taken before a deletion brings the deleted rows back.
-- That is the one failure mode a privacy deletion cannot have: a user who
-- deleted something is entitled to have it stay deleted, and "we restored an
-- old backup" is not an exception they agreed to.
--
-- The ledger (`deletion_ledger`, migration 0007) records what was deleted. It
-- is operator-global and has no foreign key to `workspaces`, precisely so it
-- survives the deletions it records.
--
-- HOW restore.sh USES THIS
--
--   1. Before dropping the target database, dump `deletion_ledger` out of it.
--   2. Restore the backup, which brings the *backup's* (older) ledger with it.
--   3. Load the saved ledger back in, merging on id. Now the ledger holds
--      every deletion either copy knew about.
--   4. Run this file, which re-deletes everything the merged ledger names.
--   5. Only then start the API.
--
-- Running it twice is safe: deleting a row that is already gone is a no-op,
-- which is why this file states the rule as "everything the ledger names stays
-- deleted" rather than trying to compare timestamps against a backup. A
-- timestamp comparison would be the version with an off-by-one that silently
-- resurrects one row.
--
-- WHAT IT DOES NOT DO
--
-- It deletes database rows. Stored objects for deleted files and workspaces
-- are removed by restore.sh / restore.ps1 after the files volume is unpacked;
-- this file has no access to the storage volume and does not pretend otherwise.
-- =============================================================================

BEGIN;

-- A workspace deletion names no single row: it deleted all of them. The
-- cascade from `workspaces` does the rest. The owners are noted first, because
-- the account (an email address and a password hash) went with the workspace
-- and the cascade does not reach `users`.
CREATE TEMP TABLE reapplied_owners ON COMMIT DROP AS
  SELECT w.owner_user_id AS user_id
    FROM workspaces w
    JOIN deletion_ledger d ON d.object_kind = 'workspace' AND d.workspace_id = w.id;

DELETE FROM workspaces w
  USING deletion_ledger d
  WHERE d.object_kind = 'workspace'
    AND d.workspace_id = w.id;

-- An owner who still belongs to another workspace keeps their account.
DELETE FROM users u
  USING reapplied_owners o
  WHERE u.id = o.user_id
    AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id);

-- A local installation left with no account goes back to first-run, exactly
-- as the deletion itself left it (apps/api/src/privacy/workspace-deletion.ts).
-- Hosted installations never bootstrap through setup, so the flag is inert
-- there either way.
DELETE FROM system_flags
  WHERE key = 'setup_completed'
    AND NOT EXISTS (SELECT 1 FROM users);

DELETE FROM files f
  USING deletion_ledger d
  WHERE d.object_kind = 'file'
    AND d.object_id = f.id;

DELETE FROM answer_bank a
  USING deletion_ledger d
  WHERE d.object_kind = 'answer_bank'
    AND d.object_id = a.id;

DELETE FROM sources s
  USING deletion_ledger d
  WHERE d.object_kind = 'source'
    AND d.object_id = s.id;

DELETE FROM applications app
  USING deletion_ledger d
  WHERE d.object_kind = 'application'
    AND d.object_id = app.id;

DELETE FROM resumes r
  USING deletion_ledger d
  WHERE d.object_kind = 'resume'
    AND d.object_id = r.id;

DELETE FROM profile_facts pf
  USING deletion_ledger d
  WHERE d.object_kind = 'profile_fact'
    AND d.object_id = pf.id;

-- What was replayed, for the operator's log. Counts only: the ledger holds
-- identifiers and this reports how many, never which.
SELECT object_kind, count(*) AS entries
  FROM deletion_ledger
 GROUP BY object_kind
 ORDER BY object_kind;

COMMIT;
