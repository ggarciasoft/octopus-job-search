/**
 * The fill planner, shared by every client that fills a form.
 *
 * Two clients exist: the Python desktop runner (M4) and the browser extension
 * (M5). This package is the TypeScript half, and it is a deliberate port of
 * `services/worker/src/job_getter_worker/runner/{forms,plan}.py` rather than a
 * second design. The two are pinned together by the golden vectors in
 * `fixtures/fill-planner/`, which both test suites read.
 *
 * Nothing here touches a DOM, a network or a model. That is what lets the
 * interesting judgement — which question a control is, what may be typed into
 * it, what must be left for the person — be tested without a browser, and it
 * is why the extension's adapter can be thin enough to review.
 */
export * from './forms.js';
export * from './plan.js';
export * from './inspect.js';
