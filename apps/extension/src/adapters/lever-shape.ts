/**
 * What identifies a Lever page, on its own so that `greenhouse.ts` can refuse
 * one without importing the Lever reader. Mirrors `LEVER_HOSTS` and
 * `LEVER_MARKER_SELECTOR` in
 * `services/worker/src/job_getter_worker/runner/adapters/lever.py`.
 */

/** Hosts Lever serves application pages from. */
export const LEVER_HOSTS: readonly string[] = ['jobs.lever.co', 'jobs.eu.lever.co'];

/** What makes a form Lever's rather than merely an `#application-form`. */
export const LEVER_MARKER_SELECTOR =
  'form#application-form .application-question .application-label';
