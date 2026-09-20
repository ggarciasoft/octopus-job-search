# Testing and acceptance

## Required test layers

- Node domain/API tests against real ephemeral PostgreSQL for scope, constraints, revisions and leases.
- Python unit tests for extraction, normalization, scoring, factual validation and provider output parsing.
- Contract tests validating shared JSON schemas and generated TypeScript/Pydantic types.
- Browser tests against local synthetic ATS forms with no external submissions.
- Manual usability check using an owner's genuine profile only with consent; no personal data in CI fixtures.

## Essential acceptance scenarios

| ID | Scenario | Required result |
|---|---|---|
| AT01 | Clean Compose start | Health passes, schema created, one-time owner setup works |
| AT02 | Text PDF/DOCX import | Editable extraction with provenance; no automatic confirmation |
| AT03 | Scanned/encrypted/malformed CV | Explicit supported error; no invented profile |
| AT04 | Conflicting profile import | Existing verified facts preserved until user resolves |
| AT05 | Board fetch with duplicate jobs | Single canonical job with provenance, no lost histories |
| AT06 | Failed/partial board scan | Missing jobs are not closed |
| AT07 | Remote job restricted to US | Non-US eligibility not assumed; unknown shown when appropriate |
| AT08 | Unknown currency/period | No invalid salary comparison or silent conversion |
| AT09 | Prompt-injected job description | No instruction execution or secret exposure |
| AT10 | Generated CV adds a numeric claim | Validator blocks or flags before mandatory user review |
| AT11 | Original CV mode | Downloaded bytes SHA-256 identical to uploaded file |
| AT12 | PDF/DOCX render | Text extractable, accents intact, no clipped sections on representative fixtures |
| AT13 | Edit packet after approval | Old approval rejected; user must reapprove |
| AT14 | Unknown required form question | Filling pauses without guessing |
| AT15 | Two simultaneous fill requests | Only one active fill session; second returns conflict |
| AT16 | Submit observation times out | outcome_unknown; no automated retry |
| AT17 | Unsupported ATS | Honest manual fallback and saved packet |
| AT18 | Task worker crashes/reclaims | Exactly one committed result; stale lease rejected |
| AT19 | Different workspace UUID requested | 404/403; no data/file leak |
| AT20 | Private IP or redirect fetch | Blocked before access, including IPv6/rebinding cases |
| AT21 | Cloud provider unavailable | No surprise provider switch; local/draft work preserved |
| AT22 | Budget exhausted | New inference blocked; review/export still work |
| AT23 | Revoke extension token | Immediate API denial and no new packet access |
| AT24 | Malicious page extension message | Cannot access token/profile or change destination |
| AT25 | Backup/restore | Profile, files, hashes and application history restored |
| AT26 | Delete workspace | Access revoked, files erased, completion recorded without PII |
| AT27 | English/Spanish flow | Labels, Unicode, dates and documents correct |
| AT28 | No AI configured | Manual profile, job import and tracker remain usable |

## Browser fixtures

Include text/select/radio/checkbox fields, repeated labels, required unknown question, file attachment, multi-step form, validation error, iframe needing manual assistance, changed fingerprint, confirmation page and timeout. Final submit action is performed only by test harness on a synthetic server, never by the production runner.

## Release gates

Pilot M4: AT01–AT18, AT20–AT22, AT25, AT27–AT28 pass where milestone functionality applies. Workspace-isolation basics AT19 already required by API design. Hosted beta M6 requires all scenarios plus email verification/reset, TLS/cookie/CSRF tests, quota concurrency, deletion retention checks and connector policy review. Extension store publication is separate from local unpacked-extension validation.

Performance goals, measured on declared hardware: 1000 stored jobs list p95 under 500 ms excluding network; normal API mutations p95 under 1 second; queue recovery within lease expiration plus polling delay. AI/browser duration is variable; show progress and timeouts rather than claiming fixed latency. Do not broaden into costly scale testing before concrete load evidence.
