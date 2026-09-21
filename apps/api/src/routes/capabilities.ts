/**
 * Which task types this build can genuinely enqueue.
 *
 * A worker handler existing is not the same as the capability existing. The
 * Python worker implements `parse_profile`, but until the route that creates
 * a profile import is registered there is no way for a user to reach it, and
 * advertising it in `GET /me` would offer a capability with no path to it —
 * the "button that reports success" failure invariant 10 forbids.
 *
 * The answer is therefore computed from the deferred-route list rather than
 * maintained by hand, so a task type becomes visible at exactly the moment
 * its route stops being deferred, and nobody has to remember to update a
 * second list in the milestone that lands it.
 */
import { IMPLEMENTED_TASK_TYPES, type TaskType } from '@job-getter/contracts';
import { DEFERRED_OPERATIONS } from './index.js';

/**
 * The route operation a user calls to create each task type. A task type with
 * no entry here cannot be created by any client — it is internal-only, or it
 * belongs to a milestone whose routes do not exist yet.
 */
const CREATING_OPERATION: Partial<Record<TaskType, string>> = {
  noop_echo: 'createDiagnosticTask',
  parse_profile: 'createProfileImport',
  // M2: advertised automatically once these routes leave DEFERRED_OPERATIONS.
  fetch_board: 'scanSource',
  fetch_job: 'importJob',
  // M3.
  match_job: 'matchJob',
  render_cv: 'createResume',
  // M4. Enqueued by the API, claimed only by a paired local runner.
  fill_local: 'fillApplication',
};

/**
 * Task types with a handler but deliberately no user-facing creating route.
 *
 * Being `Partial`, CREATING_OPERATION cannot fail to compile when a task type
 * is implemented and nobody adds it here, which is exactly how `match_job`
 * shipped invisible to `GET /me` for one commit: the route worked, the
 * worker claimed the task, and the capability said the build could not do it.
 * `tests/capabilities.test.ts` now requires every implemented task type to
 * appear in one of these two lists, so the next omission is a failed test
 * rather than a quietly under-reported capability.
 */
export const INTERNAL_ONLY_TASK_TYPES: readonly TaskType[] = [];

export function enqueueableTaskTypes(): readonly TaskType[] {
  return IMPLEMENTED_TASK_TYPES.filter((type) => {
    const operation = CREATING_OPERATION[type];
    if (operation === undefined) return false;
    return !(operation in DEFERRED_OPERATIONS);
  });
}

/**
 * Implemented task types that are neither reachable through a route nor
 * declared internal-only. Always empty; the test asserts that.
 */
export function unclassifiedTaskTypes(): readonly TaskType[] {
  return IMPLEMENTED_TASK_TYPES.filter(
    (type) => CREATING_OPERATION[type] === undefined && !INTERNAL_ONLY_TASK_TYPES.includes(type),
  );
}
