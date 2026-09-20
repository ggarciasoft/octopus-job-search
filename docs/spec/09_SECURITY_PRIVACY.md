# Security and privacy design

## Threat model

Protect employment history, contact details, CVs, provider keys, browser sessions and application records. Threats include cross-user access, malicious job URLs/documents, model prompt injection, compromised adapters, malicious extension messages and accidental duplicate actions.

## Authentication and authorization

Local bootstrap requires a single-use setup secret shown only in local logs/terminal, binding setup to loopback. Generate an owner password with Argon2id hashing. Hosted beta adds email verification, password reset, invitation-based signup initially, rate limits and secure sessions. Cookies: HttpOnly, Secure hosted, SameSite=Lax; anti-CSRF token plus origin verification on state-changing routes. Never expose a wildcard CORS policy with credentials.

API derives workspace scope from session/device identity and includes it in all queries. Add cross-workspace tests for ID guessing, files, task results and devices. Worker routes use distinct credentials and network restrictions; paired runners get no operator credential. Device tokens are stored hashed server-side and revocable; use OS-protected local storage when available.

## File processing and storage

Validate file signature and extension, bound file size, PDF pages (100), extracted characters (200000), DOCX archive expansion (50 MiB), CPU time and memory. Reject macros, external references and malformed containers. Process in isolated non-root worker with no host filesystem mounts beyond task input/output. Never execute document contents. Hosted uploads must pass malware scanning or be quarantined before parsing/download; local scanning can be optional with explicit status.

Private storage keys are generated IDs, not user filenames. Sanitize download names and Content-Disposition. Serve untrusted artifacts as attachments; do not inline arbitrary uploaded HTML. Protect storage and backups with access control and encryption; cloud keys remain operator-side. Encrypt user provider secrets using authenticated encryption and an operator key stored outside the database; support rotation.

## Prompt injection and browser isolation

Job descriptions can contain hostile instructions. Models have no browser, shell, database or secret access. Output must validate against closed schema and the fact allowlist. Treat model-created URLs as untrusted and verify allowed destination independently. Form actions use deterministic adapters; arbitrary generated JavaScript is prohibited.

Local browser sessions remain local and are excluded from export, logs and uploads. Hosted extension never exports cookies. Do not store job-site passwords. Pause at login, CAPTCHA and identity checks.

## Retention defaults

Original CVs and approved application records persist until user deletion. Raw extraction intermediates expire after 7 days; failed/staging files after 24 hours; redacted operational logs after 30 days; optional browser screenshots after 7 days. User can shorten retention. Successful generated CVs remain with application records. Hosted backups expire after 30 days by default; communicate this in the privacy notice.

Export includes profile, preferences, job records, submitted CVs, answer bank and application history in versioned JSON plus files. Exclude secrets/session/browser data. Deletion revokes access immediately and queues erasure; show completion or failure. Do not log CV text, answers, tokens or raw prompts.

## Commercial release requirements

Before public hosted launch, provide an accurate privacy notice, data processing/vendor list, deletion/export mechanism, terms and support contact; verify jurisdiction-specific obligations with qualified advice. This specification does not establish legal compliance. No user data for model training or analytics by default. Telemetry must be opt-in locally and minimized in hosted mode. Site access policies must be reviewed for each connector.
