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
};

export function enqueueableTaskTypes(): readonly TaskType[] {
  return IMPLEMENTED_TASK_TYPES.filter((type) => {
    const operation = CREATING_OPERATION[type];
    if (operation === undefined) return false;
    return !(operation in DEFERRED_OPERATIONS);
  });
}
