# Application preparation and browser assistance

## State machine

Application states: draft, preparing, needs_input, ready_for_review, approved, filling, awaiting_user_submit, submitted, outcome_unknown, failed, cancelled, interview, rejected, offer, withdrawn.

Allowed primary path: draft → preparing → needs_input OR ready_for_review → approved → filling → awaiting_user_submit → submitted. Submitted may transition to interview/rejected/offer/withdrawn; interview may transition to rejected/offer/withdrawn. Failure before submission permits preparing again after correction. Cancellation is allowed before submission; cancellation after submission is recorded as withdrawn only when the user confirms withdrawal.

Any uncertain post-submit observation becomes outcome_unknown. From outcome_unknown the user may confirm submitted with evidence or mark not submitted and return to preparing. Never retry filling/submission automatically in that state. Keep append-only transition events with actor/time/reason. Manual tracker entries use evidence_type user_report and remain visibly labeled.

## Packet and approval

Packet contains immutable profile/job revisions, original/generated CV reference and hash, answers with provenance, exact destination, connector version, and form fingerprint when known. Approval binds content_hash and expires after 24 hours. Any changed CV, answers, job/profile revision, destination or known form schema invalidates approval.

If the actual form contains new questions, pause, store the schema, collect answers, create a new packet revision and reapprove. Do not let a previously approved packet authorize guessed answers. Present required consent boxes separately; user checks them on the actual website.

## Local browser runner M4

Python Playwright runs as an explicitly paired local desktop process, opens its own persistent Chromium profile and navigates to the intended job page. It does not extract cookies from the user's default browser. Store its isolated profile in a restricted local directory, outside the app export and outside git. User logs in and resolves challenges in that visible browser.

Runner claims only its owner's fill_local work and rechecks origin, packet approval, job identity and duplicate state. Match labels and stable accessible attributes through a versioned site adapter. Fill deterministic fields and pause for review. Never click final submit in v1. Never navigate through unexpected external origins without user interaction.

## Extension M5

Chrome Manifest V3, packaged TypeScript code, no remotely downloaded executable code. Use activeTab and scripting permissions for user-triggered filling; request additional host permissions only when necessary with a clear explanation. Service worker holds paired-device token; page scripts cannot access it. Content script receives only minimal packet fields for the selected application, never the full profile or provider secrets.

Extension requests a fill session from API. The session binds device_id, tab origin, application_id, packet_hash, nonce and ten-minute expiry. API allows only current approved packets. Content script compares visible job identity and reports form schema. Service worker verifies message sender/tab/origin; do not trust page-origin window messages as privileged commands.

For file upload, obtain only the authorized CV bytes and attempt supported browser file input handling. Where browser/site restrictions prevent it, show a download-and-attach step. Do not claim every iframe, shadow DOM or custom widget is supported. Cross-origin frames need explicit permitted origin and tested adapter; otherwise manual fallback.

## Adapter interface

identify(page) → job identity, origin, supported version.
inspect(page) → fields [{key,label,type,required,options,sensitivity}], fingerprint.
plan(packet,fields) → proposed values, unmatched fields, warnings.
fill(plan) → per-field outcomes and screenshot only with consent.
observe_confirmation() → evidence or unknown.

Checkbox/select answers require exact confirmed mappings; do not fuzzy-match legal authorization. Never answer assessments, personality tests, identity verification, or medical/demographic questions using inferred values. User-entered answers may be reused only under their approved scope. Questions such as salary expectation or years of experience need explicit facts/preferences, not free-form guesses.

## Outcome evidence

After manual submission, an adapter may observe a confirmation message/reference on the allowed page. Store normalized confirmation text, URL and time; screenshot is optional, consented and redacted where possible. If adapter cannot verify, ask the user to report outcome. Absence of evidence is not failure or success. Disable a second attempt until resolved.

## Later unattended mode

M7 is disabled by default and not part of beta acceptance. Before implementation it needs separately tested site permission/capability, explicit user opt-in with destination limits, maximum daily applications, minimum eligibility, no unanswered questions, immutable approval policy, kill switch, duplicate protection and uncertain-outcome handling. Do not implement it simply by adding an LLM browser agent with unrestricted tools.
