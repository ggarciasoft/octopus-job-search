-- 0009_observe_confirmation
--
-- The runner may now be asked to look at the employer's page after the person
-- has submitted, and report what it says. `07_APPLICATION_AUTOMATION.md`:
--
--     observe_confirmation() -> evidence or unknown.
--
--     After manual submission, an adapter may observe a confirmation
--     message/reference on the allowed page. [...] If adapter cannot verify,
--     ask the user to report outcome. Absence of evidence is not failure or
--     success. Disable a second attempt until resolved.
--
-- Everything this needs already exists except permission for the task row: the
-- `outcome_unknown` status, the `adapter_observed` evidence type and the
-- `awaiting_user_submit -> outcome_unknown` transition were all written in
-- 0005, against a capability nothing could yet produce. This migration adds
-- the one missing piece.
--
-- `tasks_type_check` is rewritten rather than extended because a CHECK
-- constraint has no ALTER that adds a value. The new list is the old list plus
-- `observe_confirmation`, and `tests/db/enum-drift.test.ts` compares it
-- against ALL_TASK_TYPES from @job-getter/contracts, so a future divergence
-- fails CI rather than production.
--
-- Additive in effect: the constraint is strictly widened, so no existing row
-- can be invalidated by it and there is nothing to back-fill.

ALTER TABLE tasks DROP CONSTRAINT tasks_type_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_type_check CHECK (type IN (
    'noop_echo',
    'parse_profile',
    'fetch_board',
    'fetch_job',
    'match_job',
    'render_cv',
    'build_packet',
    'fill_local',
    'observe_confirmation',
    'export_workspace',
    'delete_workspace',
    'discover_boards'
));
