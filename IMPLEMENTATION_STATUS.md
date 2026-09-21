# Implementation status

**Last updated: 2026-09-21** · **M0, M1, M2, M3 complete; M4 in progress** — the application backend, the paired local runner and the M4 screens are landed and tested, including a real Chromium filling a synthetic Greenhouse form and stopping before submit. Export, backup/restore and the deletion ledger are not built, and no adapter has met a live board. No browser has rendered the M2, M3 or M4 screens. Next: **export, backup and restore (PR14, AT25), then the pilot itself**.

This file is required by `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` and by
the progress-record template in `docs/spec/12_IMPLEMENTATION_PLAN.md`. It is the
single honest answer to "does this actually work yet?"

> **Nothing in this file may be marked complete on the strength of generated
> code alone.** `docs/spec/12_IMPLEMENTATION_PLAN.md`: _"Never mark complete
> based only on generated code."_ A row moves to **Implemented** when the code
> exists and has been run. It moves to **Tested** only when a test asserting the
> behaviour has been executed and its output recorded — either in the "Verified
> commands" section below or in a linked CI run. If you cannot point at output,
> the row is **Not started** or **In progress**.

<!--
  HOW TO UPDATE THIS FILE (for the agent or human working on the next slice)

  The tables are plain GitHub-Flavoured Markdown and are meant to be edited
  row-by-row. Change only the rows you own:

    * Implementing PR05? Edit the PR05 row and the M2 row. Leave the rest.
    * Getting AT01 to pass? Edit the AT01 row: set the status, and put the real
      path of the test in the "Where the test lives" column.
    * Ran a command successfully? Append it to "Verified commands" with a
      one-line summary of its actual output. Do not add a command you have not
      run.

  Use exactly these status words so the file stays greppable:

    Not started   nothing exists
    In progress   code exists but does not work end to end
    Implemented   works when run by hand; no automated test asserts it yet
    Tested        an executed test asserts it; output recorded or CI linked
    Blocked       cannot proceed; the Notes column must say what is blocking
    Deferred      deliberately postponed; the Notes column must say until when

  Keep the "Last updated" date at the top current.
-->

---

## Summary

|                                     |                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional requirements implemented | 10 of 14 (PR01–PR10)                                                                                                                                                                                                                                                                                                                                                                        |
| Acceptance scenarios passing        | 18 of 28 (AT01–AT11 except AT10 is partial, plus AT13–AT15, AT17, AT19, AT20; AT23 is partial — see the rows)                                                                                                                                                                                                                                                                               |
| Milestones complete                 | 4 of 8 (M0, M1, M2, M3); M4 in progress — see the milestone table for what "complete" covers                                                                                                                                                                                                                                                                                                |
| Verified working today              | Toolchain; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm contracts:check`; every test suite (contracts 191, api 553, web 188, ui 7, worker 439); the fixture corpus (46/46); all three images build; `docker compose up` from a `setup.sh`-generated `.env`; `scripts/smoke.sh` through the nginx proxy on `127.0.0.1:3000`; data persistence across `docker compose down`/`up` |
| **Never executed**                  | `scripts/smoke.ps1`, `scripts/backup.*`, `scripts/restore.*`, `scripts/dev.*` (syntax-checked only); the `local-ai` Ollama profile; any image build on a host WITHOUT TLS interception (the no-secret path is verified only by construction); macOS/Linux hosts                                                                                                                             |

If you came here from the README looking for a product: there isn't one yet.
Source exists and it typechecks — that is not the same as working, and this file
does not treat it as the same.

---

## Functional requirements (PR01–PR14)

From `docs/spec/01_PRODUCT_REQUIREMENTS.md`.

| ID   | Requirement                                                      | Milestone        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR01 | Create and edit profile manually                                 | M1               | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Schemas exist in `packages/contracts/src/schemas/profile.ts`. The API's implemented routes are `setup`, `auth`, `me`, `files`, `tasks`, `diagnostics` and `internal` — no profile route. The web app has `Setup`, `Login`, `Dashboard`, `Tasks` and `Diagnostics` pages — no profile page.                    |
| PR02 | Import PDF/DOCX or pasted text; review extracted fields          | M1               | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `parse_profile` contract and fixtures exist (`fixtures/cvs/`); no parser.                                                                                                                                                                                                                                     |
| PR03 | Record titles, skills, locations, salary, languages, eligibility | M1               | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                               |
| PR04 | Import job URL or description; configure company boards          | **API + worker** | `POST /jobs/import` (URL or pasted text) and the source registry are live; verified on the Compose stack with a pasted-text import that resolved to a job carrying its salary excerpt. The web import panel (`apps/web/src/discovery/ImportPanel.tsx`, reached from Discover) is now built and covered by `apps/web/tests/jobImport.test.tsx` (8 tests): URL and pasted text are mutually exclusive by construction, a refused fetch states the refusal and offers the paste path without suggesting any circumvention, and a candidate list re-imports under a new idempotency key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                                                                                               |
| PR05 | Fetch Greenhouse and Lever listings, deduplicate and refresh     | **API + worker** | Greenhouse and Lever connectors, dedup, refresh and closure rules are live. Verified 2026-09-20 against Greenhouse's own public board through the Compose stack: 21 postings, `complete_snapshot: true`, source health `ok`; a second scan took the conditional-request path (304 → nothing re-fetched, nothing closed, still 21 jobs). The Discover, Jobs and Job-detail screens are now built and covered by 41 executed web tests; the 304 re-scan renders as "unchanged", not as a failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **No connector is implemented.** The README support matrix marks every source not implemented, and must stay that way until fixtures pass (invariant 10).                                                                                                                                                     |
| PR06 | Explain fit, missing requirements and unknown eligibility        | **Tested**       | Fit algorithm v1, end to end: contracts, migration `0003_matches`, `POST /jobs/:id/match`, the deterministic `match_job` worker handler, and the Jobs and Job-detail screens. Hard filters run before any score and return a tri-state verdict per filter with the evidence behind it; components are renormalised over the evaluable weight only, so a component nothing could be read for is excluded and counted against coverage rather than scored zero; a requirement matched only through a _related_ skill stays `uncertain` and earns nothing. Scoring calls no provider, so it costs no AI budget and works with no model configured at all. Asserted by 34 worker tests, 17 API tests, 17 web tests and 11 migration tests. **Known gaps:** the industry component is never evaluable (no connector extracts an industry and the preferences schema has no field for one), so coverage tops out at 90% with the default weights; seniority is read from the job title only; the skill alias map is small and hand-checked by design.                                                                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                                                                                                               |
| PR07 | Generate truthful tailored PDF/DOCX CV, or preserve original     | **Tested**       | Contracts, migration `0004_resumes`, `POST /resumes`, `GET /resumes/:id`, `POST /resumes/:id/approve`, the `render_cv` worker handler and the CV studio screen. A true document is assembled from confirmed facts deterministically first; a model is then asked to re-present _that_, never a blank page, and whatever returns is validated against the facts with failures dropped one bullet at a time. With no provider configured the deterministic document is the output, so CV generation works with no AI at all. Both formats render from the one validated document. The PDF template is autoescaped with no script, image, link or webfont and is loaded as content rather than from a URL; when Chromium is unavailable the DOCX still ships and the result says the PDF is missing. Original mode references the uploaded bytes and generates nothing. Approval is a user action: no task path can set `approved_at` and the database only accepts it on a `ready` row. Asserted by 25 worker tests, 28 API tests and 18 web tests. **Known gaps:** there is no list route in the contract, so the studio cannot show a CV generated in an earlier session; the page-overflow warning depends on a rendered PDF, so it is absent when Chromium is; and `page_target` is reported against, never enforced by shrinking type or truncating. |                                                                                                                                                                                                                                                                                                               |
| PR08 | Reviewable application packet and answer bank                    | **Tested**       | Contracts, migration `0005_applications`, the packet and approval routes, the answer bank, and the **Application review screen**. A packet snapshots the profile and job revisions, the CV bytes and the destination resolved from the job's own provenance; approval is bound to a SHA-256 of that content, quoted back by the screen that displayed it, and expires. 34 API cases, 28 schema cases and 16 web cases. No packet has been reviewed on a running stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PR09 | Autofill tested forms locally; final submit manual               | **Tested**       | Device pairing, `POST /applications/:id/fill`, the `fill_local` contract, a deterministic planner, the `greenhouse/v1` adapter, a persistent Chromium the runner owns, and the **Fill assistant panel**. 14 browser tests drive a real Chromium against a synthetic Greenhouse-shaped page. It has **never run against a live board** and no form has been filled for a real application. Final submit is manual by construction: no code path clicks one, and the panel says so in every state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PR10 | Track outcome with evidence, history, duplicate prevention       | **Tested**       | The outcome route, the event log, the **Tracker screen** and the review screen's timeline. "Submitted — verified" and "Submitted — reported by you" are different badges and a browser session cannot claim the first: `adapter_observed` is refused by the API and is not offered in the UI. The event log is append-only, enforced by a trigger. Duplicate prevention is two-layer: one application per job by constraint, plus a warning about other applications for possibly-duplicate jobs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PR11 | Configure providers, prompts, weights, limits, connectors        | M3–M5            | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                               |
| PR12 | Hosted app plus extension, accounts, quotas, isolation           | M5–M6            | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `apps/extension/` is an empty directory.                                                                                                                                                                                                                                                                      |
| PR13 | Discover company pages through an optional search API            | M6               | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                               |
| PR14 | Export/delete user data; backup/restore local installation       | M4               | In progress                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `scripts/backup.sh`/`.ps1` and `scripts/restore.sh`/`.ps1` exist and are syntax-checked but have **never been run against a populated installation**. Export/delete are not started. **The deletion ledger does not exist**, so `restore.sh` explicitly refuses to claim a verified restore — see its header. |

---

## Acceptance scenarios (AT01–AT28)

From `docs/spec/11_TESTING_ACCEPTANCE.md`. "Where the test lives" is filled in
when a test exists; `—` means there is no test.

| ID   | Scenario                                                                    | Status      | Where the test lives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AT01 | Clean Compose start: health passes, schema created, owner setup works       | **Passed**  | Verified 2026-09-20 on the real Compose stack: `sh scripts/setup.sh` → `docker compose up` (db healthy → one-shot `migrate` exit 0 → api healthy → worker, web) → `scripts/smoke.sh` through the nginx proxy on `127.0.0.1:3000`: one-time owner setup, probe task completed by `container-worker-1`, idempotent replay. After bootstrap the genuine `SETUP_TOKEN` returns 409 `SETUP_CLOSED` through the proxy. `docker compose down` (no `-v`) then `up`: both named volumes kept, migrate reports "Schema is up to date", the pre-restart owner logs in. Also `apps/api/tests/db/schema.test.ts`, `tests/auth.test.ts`.                                                                             |
| AT02 | Text PDF/DOCX import gives editable extraction with provenance              | **Passed**  | Live: `fixtures/cvs/text-cv.pdf` uploaded and parsed to 19 draft facts with page locators and real source excerpts; nothing auto-confirmed. Also `services/worker/tests/test_parse_profile.py`, `apps/api/tests/profile-imports.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AT03 | Scanned/encrypted/malformed CV gives an explicit error, no invented profile | **Passed**  | `services/worker/tests/test_extraction.py`: scanned -> OCR_REQUIRED, encrypted -> ENCRYPTED_DOCUMENT, malformed/mislabelled -> FILE_UNREADABLE, too-short -> EXTRACTION_SHORT, each asserting zero invented facts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AT04 | Conflicting profile import preserves verified facts until resolved          | **Passed**  | `apps/api/tests/profile-imports.test.ts`: confirming a conflicting draft without `supersedes_fact_id` leaves the existing confirmed fact byte-identical; with it, the old row is superseded and retained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AT05 | Board fetch with duplicate jobs yields one canonical job with provenance    | **Passed**  | `apps/api/tests/discovery.test.ts`: the same requisition seen twice → one job, two provenance rows; a second source links only on identical `apply_url`; similar title+location → a `possible_duplicates` warning, never a merge. Worker side: `services/worker/tests/test_connectors.py` (duplicate collapsed to one `source_key`).                                                                                                                                                                                                                                                                                                                                                                   |
| AT06 | Failed/partial board scan does not close missing jobs                       | **Passed**  | `apps/api/tests/discovery.test.ts`: a partial snapshot closes and counts nothing; closure needs two complete snapshots ≥24 h apart; reappearance reopens. Worker: `test_fetch_board.py` marks every cap, failure or denial mid-scan as `complete_snapshot=false`. Observed live: a 304 re-scan closed nothing.                                                                                                                                                                                                                                                                                                                                                                                         |
| AT07 | Remote job restricted to US: non-US eligibility not assumed                 | **Passed**  | Live: from `text-cv.pdf`, UY authorization resolves `yes` while US stays `unknown` with `sponsorship_required: yes`. A regression here is what the nullable-field fix below was for. Also `services/worker/tests/test_truthfulness.py`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AT08 | Unknown currency/period: no invalid comparison or silent conversion         | **Passed**  | Both halves. Display: `apps/web/tests/jobs.test.tsx` and `jobDetail.test.tsx` assert currency and period verbatim, "Salary unknown" for an absent salary, and an explicit no-conversion note. Comparison: `services/worker/tests/test_matching.py` asserts a EUR salary against a USD minimum yields `SALARY_NOT_COMPARABLE` with nothing converted and does **not** make the job ineligible, and that a comparable range is judged on its upper bound.                                                                                                                                                                                                                                                |
| AT09 | Prompt-injected job description: no instruction execution                   | **Passed**  | `services/worker/tests/test_parse_profile.py`: from `prompt-injection-cv.pdf` the result contains no "Stanford", "PhD", "15 years" or the exfiltration URL, the genuine facts are unchanged, and no credential appears in the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AT10 | Generated CV adding a numeric claim is blocked or flagged                   | **Passed**  | `services/worker/tests/test_resume.py::test_a_number_absent_from_the_facts_is_dropped_and_flagged`: a bullet reading "Cut ingestion latency by 40%" over a fact that never mentioned 40 loses the bullet, raises `NUMBER_NOT_IN_FACTS` with `removed: true` and the offending text quoted, and fails `passed_automatic_checks`. A figure the facts _do_ contain survives, asserted alongside it. The web side shows the removed text (`apps/web/tests/cvStudio.test.tsx`). **Qualification:** this is the deterministic layer only. A bullet can be faithful in every number and still oversell a contribution, which is why the field is `passed_automatic_checks` and user approval stays mandatory. |
| AT11 | Original CV mode: downloaded bytes SHA-256 identical to upload              | **Passed**  | Live: uploaded and downloaded `text-cv.pdf` SHA-256 both `c9dcbc53...3da7`, matching `fixtures/MANIFEST.sha256`. Served `Content-Disposition: attachment` with `nosniff`; unauthenticated download returns 401.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AT12 | PDF/DOCX render: text extractable, accents intact, nothing clipped          | Not started | — (fixture ready: `fixtures/cvs/text-cv-es.pdf`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AT13 | Editing a packet after approval rejects the old approval                    | **Passed**  | `apps/api/tests/applications.test.ts`: after approving packet 1, changing an answer writes packet 2 with a different hash, the application returns to `ready_for_review` with no approval, and re-presenting packet 1's id and hash is refused with 409. `apps/api/tests/db/application-schema.test.ts` adds the database half: `approved_hash` may only ever equal this packet's own `content_hash`.                                                                                                                                                                                                                                                                                                  |
| AT14 | Unknown required form question pauses without guessing                      | **Passed**  | Both halves. Packet: `apps/api/tests/applications.test.ts` — a required question with a null answer lands in `needs_input`, is reported unresolved, stays null and blocks approval. Filling: `services/worker/tests/test_runner_greenhouse.py` — against a real Chromium, the referral-code field the packet cannot answer is left empty, the run reports `needs_input`, and `apps/api/tests/fill.test.ts` shows the API writing that question into a new packet revision with the old approval withdrawn.                                                                                                                                                                                             |
| AT15 | Two simultaneous fill requests: only one session, second conflicts          | **Passed**  | `apps/api/tests/fill.test.ts`: a second `POST /applications/:id/fill` while a `fill_local` task is queued or leased is refused with 409. The check is on the task queue, not on a flag, so a runner that is mid-fill still blocks the second request.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AT16 | Submit observation times out -> `outcome_unknown`, no retry                 | Not started | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AT17 | Unsupported ATS: honest manual fallback, packet saved                       | **Passed**  | Both halves. Runner: `services/worker/tests/test_runner_greenhouse.py` — a page with no tested adapter is reported `unsupported`, nothing is typed and the form is verified untouched. API: `apps/api/tests/fill.test.ts` — the application returns to `approved` with its packet and its approval intact, so the user can apply by hand.                                                                                                                                                                                                                                                                                                                                                              |
| AT18 | Worker crash/reclaim: exactly one committed result, stale lease rejected    | Not started | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AT19 | Different workspace UUID requested: 404/403, no leak                        | **Passed**  | `apps/api/tests/isolation.test.ts`: a foreign workspace UUID on every id-taking route returns a 404 byte-identical to a genuinely absent id; client-supplied `workspace_id` is ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AT20 | Private IP or redirect fetch blocked, including IPv6 and rebinding          | **Passed**  | `services/worker/tests/test_fetch_policy.py`: http://, loopback, link-local, RFC1918, cloud-metadata (v4 and `fd00:ec2::254`), IPv4-mapped v6, NAT64/6to4, names resolving to private or mixed addresses, and a public→private redirect are all refused with zero requests to the private target; body cap enforced mid-stream; robots honoured; no cookie or credential ever sent. The connection is pinned to the validated address.                                                                                                                                                                                                                                                                 |
| AT21 | Cloud provider unavailable: no surprise switch, drafts preserved            | Not started | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AT22 | Budget exhausted: inference blocked, review/export still work               | Not started | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AT23 | Revoked extension token denied immediately                                  | **Partial** | The device half passes: `apps/api/tests/devices.test.ts` revokes a paired runner's token and the very next internal claim is 401, because `revoked_at` is read on every request rather than at expiry. Revocation also destroys the digest, so a leaked copy is inert. The _extension_ is M5 and does not exist.                                                                                                                                                                                                                                                                                                                                                                                       |
| AT24 | Malicious page message cannot reach token/profile                           | Not started | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AT25 | Backup/restore: profile, files, hashes and history restored                 | Not started | — (`scripts/restore.sh` explicitly declines to claim this; it needs M1–M4 data to be meaningful)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AT26 | Delete workspace: access revoked, files erased, completion recorded         | Not started | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AT27 | English/Spanish flow: labels, Unicode, dates, documents correct             | Not started | — (fixture ready: `fixtures/cvs/text-cv-es.pdf`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AT28 | No AI configured: manual profile, job import and tracker usable             | Not started | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Release gate status:** the M4 pilot gate (AT01–AT18, AT20–AT22, AT25,
AT27–AT28) and the M6 hosted gate (all scenarios) are both **not met**. 18 of
the 28 scenarios pass; the pilot gate still needs AT12, AT16, AT18, AT21–AT22,
AT25 and AT27–AT28.

---

## Milestones (M0–M7)

From `docs/spec/12_IMPLEMENTATION_PLAN.md`. Estimates there are planning ranges,
not commitments.

| ID  | Milestone                              | Status                                     | Exit criterion                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Foundation                             | **Complete**                               | A runnable empty installation with an end-to-end fake task                      | Verified end to end on the Compose stack: browser origin → nginx `/api` proxy → API → PostgreSQL queue → container Python worker → stored result, with an Idempotency-Key replay returning the same task. Queue semantics exercised over real HTTP too: a schema-violating result fails the task and stores nothing; a stale lease token returns 409 with no domain effect. `/internal/v1` is not proxied (nginx answers; the SPA fallback serves GET); db, api and worker publish no host port; web is `127.0.0.1:3000` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M1  | Profile                                | **Complete**                               | Confirmed profile from fixtures; unknown/conflicting data visible               | Profile, imports, preferences and provider settings exist in the API, the worker and the web UI. Verified live through the API: a real PDF parsed to 19 draft facts with page locators, 18 confirmed into the profile with the withheld draft discarded, US work authorization preserved as `unknown`. The web screens (Profile, Import review, Preferences, Provider) are behaviour-tested (97 web tests) but the browser flow has **not** been exercised by a human against the live stack — that is the pilot, M4. Provider secrets are write-only and AES-256-GCM encrypted; the provider probe refuses private, loopback, link-local and cloud-metadata destinations including after redirects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M2  | Job discovery                          | **Complete (live UI walkthrough pending)** | Fixture/live-read jobs discovered; duplicates and provenance correct            | Contracts, migration `0002_discovery`, sources/scans/jobs routes, the scan scheduler, dedup/closure/health rules, the SSRF-hardened fetcher and the Greenhouse/Lever connectors are all landed, CI-green and verified live (see PR05). Two findings from the live run, both fixed: an unreachable `robots.txt` (here, a TLS failure on the worker's own side) had been reported as `ROBOTS_DISALLOWED` with health `blocked`, and `trust_env=false` on the fetcher had silenced `SSL_CERT_FILE`, so an operator behind TLS interception could not supply a trust root at all. Known nuances: a 304 re-scan is recorded as `partial` (true by the contract's definition of `complete_snapshot`, but the UI must say "unchanged", not imply failure); requirement extraction depends on explicit section headings and found none in a real Greenhouse description. The web screens (Discover, Jobs, Job detail, plus the import panel) are now built and carry both nuances above in their copy: a 304 re-scan reads "Unchanged since the last scan", and an empty requirement list reads "No requirements were extracted — read the description", never "this job has no requirements". Match scores render as "Not checked" everywhere until M3. **Partly verified since:** the M3 live run below exercised this stack end to end through the API (a real import, a real score, the filters) on the existing populated database. A _browser_ walkthrough of the screens themselves is still outstanding. The screens are asserted by 41 executed tests (`discover`, `jobImport`, `jobs`, `jobDetail`) and the production Vite build, but no human has clicked through them against a running API. |
| M3  | Fit and CV                             | **Complete**                               | Reviewed CV in both formats; no unsupported facts; reproducible score           | PR06 and PR07 are both landed and tested (see their rows), and both halves were verified live. The score is reproducible by construction: `matches` is keyed on the full revision tuple and the matcher is a pure function with no clock, network or provider. The CV half was verified on 2026-09-21 — a tailored CV generated from seven confirmed facts, both formats downloaded and checked, and the PDF's text extracted with pypdf — so the exit criterion is met. **Still unverified: the browser.** No human or headless browser has rendered the CV studio or any other M3 screen; Playwright is not installed on this host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M4  | Personal pilot                         | **In progress**                            | Ten user-reviewed real application workflows, or documented sandbox equivalents | The application backend and the paired local runner are both landed and tested: `0005_applications` and `0006_devices`, content-bound approval that expires and is withdrawn the moment the profile, job, CV, destination or form schema moves, the answer bank, the append-only tracker history, device pairing, and a `greenhouse/v1` fill adapter driven by a real Chromium against a synthetic form. The Application review, Fill assistant, Tracker and Devices screens are built and covered by 16 web tests. Still to come: export/backup/restore and the deletion ledger that `scripts/restore.sh` currently has to work without. No real application has been prepared end to end, and no adapter has met a live board.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| M5  | Open-source distribution and extension | Not started                                | A fresh user installs without developer intervention and fills supported pages  | The repository documentation half of this (README, CONTRIBUTING, SECURITY, NOTICE, issue templates, license) landed early with M0; the extension and packaging did not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| M6  | Hosted beta                            | Not started                                | Hosted user needs no server and cannot reach another user's data                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M7  | Optional unattended automation         | Deferred                                   | —                                                                               | Deliberately out of scope. `docs/spec/12_IMPLEMENTATION_PLAN.md`: "Do not treat M7 as needed for the personal project or beta." Needs a separate design, reliability and source-permission review before it is even scheduled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## Known limitations and unsupported behaviour

Stated plainly, because a limitation that is not written down looks like a bug
to the next person.

### The application runs — what that claim rests on

- **`docker compose up` works from a clean `setup.sh`-generated `.env`** and
  `scripts/smoke.sh` passes through the nginx proxy on `127.0.0.1:3000`
  (verified 2026-09-20; summarised in the AT01 row). The stack survives
  `docker compose down` without `-v`.
- **Building the images for the first time found four defects no unit test
  could see**, each of which meant the documented `docker compose up --build`
  could never have worked: `corepack prepare --activate` ran before
  `package.json` was copied (api and web Dockerfiles); `pnpm install --prod`
  after a dev install triggers a `node_modules` purge that pnpm 11 refuses
  without a TTY; the worker image could not import its own package, because
  `uv sync` installs the project as an editable pointer to a build-stage path
  (`--no-editable` fixes it); and `infra/migrate.Dockerfile` was an
  unreferenced duplicate with a wrong image name and a stale entrypoint path
  (removed — Compose reuses the API image). The `python3 make g++` toolchain
  in the API build stage was also unnecessary: argon2 ships a musl prebuild.
- **The TLS "proxy" on the development host is Norton Web Shield's SSL
  scanning**, which re-signs every HTTPS connection. The host trusts that
  root; container builds do not, so every download inside `docker build`
  failed. The Dockerfiles now accept the intercepting root as an optional
  BuildKit secret (`--secret id=build_ca,src=...`) that is mounted per `RUN`,
  is a no-op when absent, and is never written to a layer — verified by
  grepping both built images' trust stores. See `docs/RUNBOOK.md` §6 and
  ADR21. **A build on a host without interception has not been performed**,
  so the no-secret path is verified only by construction (each guard is an
  `if [ -f ... ]`).
- **`scripts/lib.sh` had a cross-platform defect found by the smoke test**:
  `random_b64` deleted only the newline from `openssl rand -base64` output,
  so on Windows every generated value kept a trailing carriage return —
  invisible in a terminal, present in every generated secret including the
  `SETUP_TOKEN` a user is told to copy, and enough to make the probe request
  malformed at the HTTP protocol level. Fixed; the `.env` used for the
  Compose run was verified to contain zero carriage returns.
- **Container logs were audited after the smoke run**: 377 lines across api,
  worker and web; none of the five generated secrets, the owner password, or
  any bearer/session literal appears.
- **From the first real deployment onward `0001_foundation.sql` is frozen.**
  The migration runner enforces checksum immutability, so every later change
  must be an additive `000N_*.sql`. It was edited in place during this build
  only because nothing had been deployed.
- **CI is green on a real runner** (`9d98557`, 2026-09-20): all seven jobs pass on
  `ubuntu-latest`, including the container build **without** the `build_ca`
  secret — so the no-interception build path is now observed, not merely
  verified by construction. Getting there took three pushes and found five
  "fresh clone" defects that could not show on a machine where the files
  already existed: the API's storage layer swallowed by an unanchored
  `files/` ignore rule; shell scripts committed without the executable bit;
  fixture JSON reformatted by prettier away from its manifest; the web
  package resolving `@job-getter/api-client` from a never-built `dist/` in
  both `typecheck` and `test` (the root scripts now build the libraries
  first); and the migration bundle embedding CRLF as JSON escapes (line
  endings are now normalised where `.sql` is read). Each is recorded in the
  commit history and ADR21.

### No job source is supported

- Greenhouse, Lever, LinkedIn, Workday and generic company career pages are all
  **not implemented**. The support matrix in `README.md` says so, and no source
  may be shown as a working integration until it passes against fixtures
  (invariant 10).

### No form is filled, and nothing is ever submitted automatically

This heading used to read "no AI, no CV generation, no automation". Scoring, CV
generation and the application backend have since landed, so the honest
statement is narrower and worth stating precisely.

- Provider adapters (`fake`, `ollama`, `openai_compatible`), the offline
  deterministic path, fit scoring, CV rendering, application packets, the
  answer bank and the tracker API all exist and are tested.
- **No form is filled.** The paired local desktop runner and its site adapters
  are not built, so `fill_local` has no handler and there is no fill route. An
  application is prepared and approved here; the owner opens the page and
  submits it themselves.
- **No M4 screen has been rendered in a browser.** Application review, Fill
  assistant, Tracker and Devices exist and are covered by jsdom tests; no
  person has opened any of them.
- The browser extension (`apps/extension/`) is an empty directory.
- There is **no automatic submission** and there will not be one in the pilot or
  the hosted beta. That is a permanent design position (invariant 4), not a gap.

### Backup and restore are incomplete by design

- `scripts/restore.sh` **cannot reapply a deletion ledger**, because the
  deletion ledger is M4 work and does not exist. The script prints a loud,
  explicit warning and declines to describe its result as a verified restore.
- The pilot recovery targets from `docs/spec/10_DEPLOYMENT.md` — at most 24
  hours data loss, restore within 4 hours — are **unvalidated targets**, not
  measured results. Nothing here is evidence that they are met.
- Backups exclude `.env`, and therefore `ENCRYPTION_KEY`. That is deliberate
  (`docs/spec/09_SECURITY_PRIVACY.md`), and it means a restore without that key
  recovers everything except stored provider API keys.

### Operational gaps

- **No metrics endpoint and no alerting exist.** `docs/OPERATIONS.md` lists the
  metrics and alerts the specification requires and marks each one
  not-implemented. Do not read that document as a description of a running
  system.
- The health endpoint **paths** (`/health/live`, `/health/ready`) are a
  cross-component convention, not part of the versioned `/api/v1` contract in
  `packages/contracts`. They were read from `apps/api/src/health.ts` rather than
  assumed, and the Dockerfile healthcheck and smoke scripts were corrected to
  match. `scripts/smoke.sh` still probes alternative spellings so a future
  rename reports clearly instead of timing out mysteriously.
- The anti-CSRF scheme is likewise not in the published contract. Read from
  `apps/api/src/auth/sessions.ts`: a readable `jg_csrf` cookie, echoed in the
  `x-csrf-token` header. The smoke scripts use that and fall back to other
  spellings.
- **The API build output path is inconsistent with its own start script.**
  `apps/api/tsconfig.json` (`rootDir: "."`, `include: ["src/**/*.ts",
"tests/**/*.ts"]`) emits `dist/src/server.js`, but `apps/api/package.json`'s
  `start` script says `node dist/server.js`. The container entrypoints try both
  paths so this cannot silently break the stack, but one of the two should be
  corrected. Flagged for the API owner.
- **`pnpm format:check` cannot pass** until `.prettierignore` excludes
  `docs/spec/`, which is the immutable input specification and must not be
  reformatted. One-line fix; the file was outside this change's scope. Noted in
  the header of `.github/workflows/ci.yml`.
- **`fixtures/verify.py` treats `fixtures/README.md` as a fixture**, so editing
  the documentation fails the determinism check until `MANIFEST.sha256` is
  regenerated. A one-line fix (excluding `.md` alongside `.py`) belongs to the
  fixtures owner. The manifest is currently regenerated and passing 46/46.

### Platform and environment

- Only **Windows 11 + Docker Desktop** has been used during this work. macOS and
  Linux are **unverified**. `docs/spec/10_DEPLOYMENT.md` explicitly allows
  certifying one OS first provided the others are labelled unverified — they
  are.
- The development network runs a **TLS-intercepting proxy**, and Docker Hub was
  returning **HTTP 429** during this work. See `docs/RUNBOOK.md` → "Registry
  rate limits and TLS interception" and ADR12/ADR13 in `docs/DECISIONS.md`.
- The `ollama/ollama` image in the optional `local-ai` profile is pinned **by
  tag only**; its digest could not be resolved before the rate limit hit. It is
  marked `TODO(digest)` in `docker-compose.yml`.
- The `postgres` service container in CI is pinned **by tag only**, for the same
  reason: the digest on hand was resolved through the AWS ECR Public mirror, and
  GitHub runners pull from Docker Hub.

### Not in scope at all

LinkedIn scraping, LinkedIn Easy Apply automation, LinkedIn URL-only profile
import, Workday support, mobile browser extensions, recruiter outreach,
interview impersonation, automated assessments, CAPTCHA solving, proxy
rotation, fingerprint spoofing and any form of restriction bypass. These are not
"not yet".

---

## Verified commands

Only commands that were **actually executed on this machine** and observed to
work. Each line records what was run and what it actually printed. Do not add a
command here that you have not run.

### Toolchain (verified 2026-09-20, Windows 11, Git Bash + PowerShell)

| Command                  | Observed output                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `node --version`         | `v24.13.0` — satisfies the `>=24.0.0 <25` engine range                                           |
| `pnpm --version`         | `11.3.0` — matches the `packageManager` field                                                    |
| `docker --version`       | `Docker version 29.8.0, build 88096ef`                                                           |
| `docker compose version` | `Docker Compose version v5.5.1`                                                                  |
| `uv --version`           | `uv 0.12.17 (635500036 2026-09-18 x86_64-pc-windows-msvc)`                                       |
| Python via uv            | `3.12.14` — inside the worker's managed environment; the system Python is 3.14.2 and is not used |

### Build and dependencies

| Command                            | Result                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                   | **Exit 0.** All five workspace projects clean: `packages/contracts`, `packages/ui`, `packages/api-client`, `apps/api`, `apps/web`.                                                                                                                                       |
| `pnpm lint`                        | **Exit 0.** `apps/api` (src + tests) and `apps/web` both clean under ESLint.                                                                                                                                                                                             |
| `pnpm contracts:check`             | **Exit 0.** `contracts: generated artifacts are up to date (62 files)`. The drift gate passes.                                                                                                                                                                           |
| `pnpm format:check`                | **Exit 0** (re-run 2026-09-20 after the M2 web screens landed): `All matched files use Prettier code style!`. The earlier 81-file failure, including the 8 files under `docs/spec/`, is resolved.                                                                        |
| `uv run ruff check .` (worker)     | **FAILS.** 3 errors. Worker source still landing.                                                                                                                                                                                                                        |
| `uv run ruff format --check .`     | Passes: "46 files already formatted". The generated contracts directory is excluded from `ruff format` because it is compared byte-for-byte against its generator.                                                                                                       |
| `uv run mypy` (worker)             | Passes: "Success: no issues found in 45 source files" (strict).                                                                                                                                                                                                          |
| `uv run python fixtures/verify.py` | **Exit 0. 46/46 checks passed**, including the byte-for-byte reproducibility check.                                                                                                                                                                                      |
| `argon2` native build              | Not needed: argon2 ships `prebuilds/linux-x64/argon2.musl.node`, which node-gyp-build selects on Alpine. `infra/api.Dockerfile` no longer installs a compiler toolchain; the built API image loads argon2 and completes owner setup (verified by the Compose smoke run). |

### M2 web screens (verified 2026-09-20)

Run in this order from a clean working tree, after the Discover, Jobs and
Job-detail screens landed. Every line below was executed and its output
observed.

| Command                                    | Observed output                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @job-getter/ui typecheck`   | **Exit 0.** `tsc -p tsconfig.json --noEmit`, no diagnostics.                                           |
| `pnpm --filter @job-getter/web typecheck`  | **Exit 0.** `tsc -p tsconfig.json --noEmit`, no diagnostics.                                           |
| `pnpm --filter @job-getter/web lint`       | **Exit 0.** `eslint src`, no output.                                                                   |
| `pnpm --filter @job-getter/web test`       | **18 test files, 138 tests passed** (97 before this slice; the 41 new ones cover the four M2 screens). |
| `pnpm --filter @job-getter/ui test`        | **1 test file, 7 tests passed.**                                                                       |
| `pnpm --filter @job-getter/contracts test` | **6 test files, 191 tests passed.**                                                                    |
| `pnpm test` (whole workspace)              | **Exit 0**, including `apps/api`: 19 test files, 394 tests passed.                                     |
| `pnpm format:check`                        | **Exit 0.** `All matched files use Prettier code style!`                                               |

What this does **not** cover: no browser has rendered these screens against a
running API. The Vite production build succeeds (`✓ built in 411ms`, with the
pre-existing ">500 kB chunk" advisory), and every assertion above is a jsdom
test against a fake API client. A live walkthrough on the Compose stack —
adding a real board, scanning it, and opening a discovered job — is the
outstanding M2 verification.

### M3 fit (verified 2026-09-20)

Run from a clean working tree after the fit slice landed. Every line was
executed and its output observed.

| Command                                         | Observed output                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm contracts:generate`                       | `contracts: wrote 96 generated files.` (62 before M2, 96 with the match schemas and Pydantic models)                                |
| `pnpm contracts:check`                          | **Exit 0.** `generated artifacts are up to date (96 files)`. The drift gate passes.                                                 |
| `uv run pytest` (worker)                        | **369 passed**, including the 34 new `tests/test_matching.py` cases.                                                                |
| `uv run ruff check .` / `ruff format --check .` | **Exit 0.** `All checks passed!`; `75 files already formatted`.                                                                     |
| `uv run mypy` (worker)                          | `Success: no issues found in 74 source files` (strict).                                                                             |
| `pnpm --filter @job-getter/api test`            | **21 test files, 422 tests passed** (394 before), including `tests/matching.test.ts` (17) and `tests/db/match-schema.test.ts` (11). |
| `pnpm --filter @job-getter/web test`            | **19 test files, 157 tests passed** (140 before), including `tests/fit.test.tsx` (17).                                              |
| `pnpm typecheck`                                | **Exit 0.** All five workspace projects clean.                                                                                      |
| `pnpm lint`                                     | **Exit 0.** `apps/api` and `apps/web` clean under ESLint.                                                                           |
| `pnpm format:check`                             | **Exit 0.** `All matched files use Prettier code style!`                                                                            |
| `pnpm test` (whole workspace)                   | **Exit 0**: contracts 191, api 422, web 157, ui 7.                                                                                  |

#### Live run (verified 2026-09-21, Compose stack, local origin)

All three images rebuilt with the build-CA secret and brought up against the
**existing populated** database from the M2 verification.

| Step                                                                                    | Observed                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0003_matches` on a populated database                                                  | `applying 0003_matches` -> `Applied 1 migration(s).` The upgrade path, not just a create-from-empty.                                                                                                         |
| Worker start                                                                            | `worker.started` with `capabilities: 5, handlers: 5`; claims `match_job`.                                                                                                                                    |
| Score with an empty profile                                                             | `score: null`, `coverage_percent: 0`, all five components unevaluable, `eligible: unknown` with `AUTHORIZATION_ABSENT`. Null, not zero, on real data.                                                        |
| Score with six confirmed facts, against a pasted job with explicit requirement headings | **score 73 at 75% coverage.** skills 0.5 (matched weight 4 of 8), role_title 1.0, seniority 1.0; work_arrangement and industry unevaluable. `(40x0.5 + 20 + 15) / 75 = 73` -- the arithmetic checks by hand. |
| The uncertain rule, on real data                                                        | "Experience with TypeScript" resolved `uncertain` through the confirmed JavaScript skill and earned nothing. Kubernetes and Rust resolved `missing`.                                                         |
| Staleness                                                                               | Confirming one more skill flipped the stored match to `stale: true` with the score unchanged at 73. Nothing recomputed on its own.                                                                           |
| Revision tuple                                                                          | Scoring identical inputs twice left **one** row; two jobs, two rows.                                                                                                                                         |
| Filters                                                                                 | `min_score=0` returned 0 jobs while only the null-score match existed (a null score passes no threshold); `min_score=1` returned the scored job; `eligible=yes` returned none, the verdict being `unknown`.  |

**One real defect, found here and fixed.** `GET /me` advertised only the four
M2 task types: `CREATING_OPERATION` in `src/routes/capabilities.ts` is a
`Partial<Record<TaskType, string>>`, so implementing `match_job` without adding
an entry compiled cleanly and silently dropped the capability, while the route
worked and the worker scored jobs. A build that could do the thing reported
that it could not. Fixed, and `tests/capabilities.test.ts` now requires every
implemented task type to be either route-reachable or explicitly internal-only;
removing the entry again fails two tests.

**One pre-existing limitation, confirmed rather than fixed.** The pasted job
said "open to candidates in the United States only" and `eligible_countries`
stayed null, so `work_authorization` reported `COUNTRY_NOT_STATED`. That is
M2 extraction, and the direction is the safe one: unknown stays unknown rather
than inferring an eligibility from prose.

Two things this still does **not** cover.

No browser has rendered the fit panel. Playwright is not installed on this
machine and pulling it plus its browsers was out of scope for a verification
run, so the UI assertions remain jsdom-only -- though every API field those
components read is now verified live. The `apps/web` container serves its root
with HTTP 200.

The tailoring and rendering half of M3 (PR07) does not exist, so nothing here
speaks to it.

### M3 CV generation (verified 2026-09-21)

| Command                                              | Observed output                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm contracts:generate`                            | `contracts: wrote 108 generated files.`                                                                           |
| `pnpm contracts:check`                               | **Exit 0.** Up to date; the drift gate passes.                                                                    |
| `uv run pytest` (worker)                             | **394 passed**, including the 25 new `tests/test_resume.py` cases.                                                |
| `uv run ruff check .` / `format --check .`           | **Exit 0.** `All checks passed!`; `83 files already formatted`.                                                   |
| `uv run mypy` (worker)                               | `Success: no issues found in 82 source files` (strict).                                                           |
| `pnpm --filter @job-getter/api test`                 | **24 files, 454 tests passed**, including `tests/resumes.test.ts` (15) and `tests/db/resume-schema.test.ts` (13). |
| `pnpm --filter @job-getter/web test`                 | **20 files, 174 tests passed**, including `tests/cvStudio.test.tsx` (18).                                         |
| `pnpm --filter @job-getter/web build`                | `✓ built in 432ms` (pre-existing chunk-size advisory only).                                                       |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | **Exit 0** each.                                                                                                  |
| `pnpm test` (whole workspace)                        | **Exit 0**: contracts 191, api 454, web 174, ui 7.                                                                |

**An intermittent failure worth recording.** One full-workspace run failed five
`tests/discovery.test.ts` cases (AT05 deduplication). It did not reproduce: the
file passed four times in isolation and the whole workspace passed three times
afterwards. The likely cause is Docker contention rather than the code — the
Compose stack from the M3 fit walkthrough was running throughout, and every API
test file starts its own PostgreSQL container (`fileParallelism: false` already
serialises them within the package). This is recorded rather than dismissed:
the cause is unproven, and if it recurs on an idle machine it is a real defect.

What this does **not** cover, and it is the larger half:

No CV has been generated on a running stack. The DOCX path is exercised
in-process by a test that reopens the file and reads its text back, but the PDF
path needs Chromium inside the worker image and has only been tested through the
HTML the template produces — `render_pdf` itself has never run here. No browser
has rendered the CV studio. The M3 exit criterion is _a reviewed CV in both
formats_, and that has been asserted by tests, never seen.

### M3 CV generation, live (verified 2026-09-21)

Run against the Compose stack on the local origin, after rebuilding all three
images with the build-CA secret. `0004_resumes` applied to the **existing
populated** database.

| Step                                                       | Observed                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker capabilities                                        | `worker.started` with `capabilities: 6, handlers: 6`.                                                                                                                                                       |
| `POST /resumes` with no confirmed contact fact             | **422** with `profile: "Confirm your contact details on the profile screen first."` and **no task queued**.                                                                                                 |
| `POST /resumes`, tailored, after confirming a contact fact | `ready` after ~10s.                                                                                                                                                                                         |
| Document                                                   | Sections `skills`, `experience`, `languages`; contact `Ada Lovelace`.                                                                                                                                       |
| Validation                                                 | `passed_automatic_checks: true`, one `NO_PROVIDER_CONFIGURED` warning, `deterministic: true` — the no-AI path.                                                                                              |
| DOCX                                                       | HTTP 200, 36,847 bytes, `PK` magic bytes.                                                                                                                                                                   |
| **PDF**                                                    | HTTP 200, **23,689 bytes**, `%PDF` magic, **1 page**, text extracted with pypdf: first line `Ada Lovelace`, contains `Experience` and `Skills`. Chromium in the worker image, exercised for the first time. |
| Approval                                                   | `approved_at` null after generation; set only by the explicit approve call.                                                                                                                                 |

**One real defect, found here and fixed.** With no confirmed `contact` fact,
`_contact()` built `ResumeContact(full_name="")`, which the contract forbids
(`minLength: 1`). Pydantic raised inside the handler, so the task died as a
**retryable** `INTERNAL_ERROR` and burned three attempts on input that could
never succeed. Every unit-test fixture happened to include a contact fact, so
nothing caught it. Now: the worker raises `MissingContactError` and fails the
task `INPUT_INVALID`, non-retryable, with a message naming what to fix; and the
API refuses the request up front with a 422, so the user gets the answer
immediately instead of a queued task that dies. Covered by two worker tests and
one API test.

Still unverified: no browser has rendered the CV studio or any other M3 screen.

### M4 application backend (verified 2026-09-21)

| Command                                              | Observed output                                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm contracts:generate`                            | `contracts: wrote 123 generated files.`                                                                                     |
| `pnpm contracts:check`                               | **Exit 0.** Up to date; the drift gate passes.                                                                              |
| `pnpm --filter @job-getter/contracts test`           | **6 files, 191 tests passed.**                                                                                              |
| `pnpm --filter @job-getter/api test`                 | **26 files, 517 tests passed**, including `tests/applications.test.ts` (34) and `tests/db/application-schema.test.ts` (28). |
| `pnpm --filter @job-getter/web test`                 | **20 files, 174 tests passed** (unchanged; no M4 screen exists).                                                            |
| `uv run pytest` (worker)                             | **396 passed** (unchanged; M4 added no worker handler).                                                                     |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | **Exit 0** each.                                                                                                            |

What the 62 new cases actually assert, rather than what they are named:

- Creating an application twice for one job leaves **one row**, and the second
  call returns the first — the unique constraint, not a check in the handler.
- A packet's destination is read from the job's own provenance
  (`https://boards.greenhouse.io`, connector `greenhouse`); the request has no
  field that could change it.
- A required question with a null answer lands in `needs_input`, reports the
  key as unresolved, **stores the answer still null**, and makes approval a 409.
- Approving quotes a hash: a wrong hash is 409, and after a new packet revision
  the old packet id is 409 with the message that it was superseded (AT13).
- Editing the profile withdraws a live approval on the next read, with a
  `system`-actor `approval_invalidated` event naming
  `profile_revision_changed`; an expiry **alone** returns the same packet to
  `ready_for_review`, where the identical content can be approved again.
- A browser session asking to record `adapter_observed` gets 422. Recording
  `submitted` with `evidence_type: none` gets 422. Cancelling after submission
  gets 409.
- The history is dense from sequence 1, and `UPDATE application_events` raises
  SQLSTATE 23001 — the trigger, not the application layer.
- The serialised event log does not contain the answer text that went into the
  packet.

**Not verified, and it is most of the milestone.** No M4 route has been called
on a running Compose stack; every observation above comes from `app.inject`
against an ephemeral PostgreSQL. No packet has been reviewed by a person, no
form has been filled, and no application has been submitted. The M4 exit
criterion is _ten user-reviewed real application workflows_, and zero have
happened.

### M4 local runner and device pairing (verified 2026-09-21)

| Command                                              | Observed output                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `uv run playwright install chromium`                 | `Chrome Headless Shell 153.0.8010.12 ... downloaded`. Headless and headed launches both verified.     |
| `pnpm contracts:generate` / `contracts:check`        | `contracts: wrote 135 generated files.`; the drift gate passes.                                       |
| `uv run pytest` (worker)                             | **439 passed**, including 28 planner cases and **14 browser cases** against a real Chromium.          |
| `uv run ruff check .` / `format --check .` / `mypy`  | **Exit 0** each; mypy strict, 94 source files.                                                        |
| `pnpm --filter @job-getter/api test`                 | **28 files, 550 tests passed**, including `tests/devices.test.ts` (20) and `tests/fill.test.ts` (13). |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | **Exit 0** each.                                                                                      |

The browser tests are the ones worth describing, because "a browser test ran" is
not the same as "the thing is safe". Chromium, started through the product's own
`RunnerBrowser` with a persistent profile, against
`fixtures/ats-pages/greenhouse-application.html` served from 127.0.0.1:

- The **submit button is not in the field list**, so no plan can ever include it.
- A **demographic question is left empty** even though the packet carries an
  exactly matching confirmed answer for it.
- The **required referral-code field is left empty** and the run reports
  `needs_input`; the other nine fields are filled and the CV is attached, so the
  user finds the form ready except for the question only they can answer.
- A **custom combobox** is named and reported undriveable rather than typed into.
- **Two controls whose labels normalise to one key** produce two entries, the
  second unnameable, rather than one silently overwriting the other.
- The **unsupported page is left untouched** and reports `unsupported`.
- A page whose **employer and role are not the packet's** fails before anything
  is typed.
- A navigation **outside the authorised origins is blocked**.

And on the API side: a revoked device token is refused on its next request; a
device may claim `fill_local` and nothing else while the operator worker may
claim everything else and not that; a second fill request is a 409; and the
runner reporting a new required question produces a new packet revision with the
old approval withdrawn.

**What none of this establishes.** No adapter has run against a live Greenhouse
board. No form has been filled for a real application. Nothing has been
submitted, by the runner or through it. The pairing flow has not been driven by
a person from a browser, and no M4 screen exists for them to drive it from. The
fixture is a copy of Greenhouse's _shape_, written here; if the real board
differs, these tests will not say so.

### M4 screens (verified 2026-09-21)

| Command                                              | Observed output                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm contracts:generate` / `contracts:check`        | `contracts: wrote 136 generated files.`; the drift gate passes.               |
| `pnpm --filter @job-getter/web test`                 | **21 files, 188 tests passed**, including `tests/applications.test.tsx` (16). |
| `pnpm --filter @job-getter/api test`                 | **28 files, 553 tests passed** (three new `GET /resumes` cases).              |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | **Exit 0** each.                                                              |

Four screens landed: Application review (`/applications/:id`), the Fill
assistant panel inside it, Tracker (`/tracker`) and Settings → Devices. The web
tests assert the things a screen can quietly get wrong:

- Approving sends the content hash **the screen displayed**, so an approval
  cannot attach to content that moved while the page was open.
- A stale packet names what changed ("Your profile changed…") and the approve
  button is disabled rather than absent, so the reason is visible.
- An unanswered required question renders as unanswered and blocks approval.
- The fill panel says nothing has been sent in every state it can be in, and
  offers no fill button at all when no runner is paired.
- The tracker renders "Submitted — verified" and "Submitted — reported by you"
  as different badges, and the outcome dropdown does not contain "Seen on the
  confirmation page" — a person cannot claim verification the system did not
  perform.
- The pairing code is shown once with a sentence saying it cannot be shown
  again, and a revoked device stays listed as revoked rather than disappearing.

**One contract addition, and why.** `GET /resumes` did not exist: the spec's
route table has `POST /resumes` and `GET /resumes/:id` only. A CV chooser
cannot offer documents it has no way to enumerate, and the alternative was
asking a person to paste a UUID to decide what an employer receives. The route
is listed here rather than left as a quiet deviation.

**Still not verified.** No browser has rendered any of these screens. Every
assertion above is jsdom against a fake client; `pnpm --filter
@job-getter/web build` and a real Compose run are both outstanding, as they
have been since M2.

### Infrastructure and scripts (verified 2026-09-20)

| Command                                                                      | Observed output                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose config`                                                      | Exit 0. 268 lines of resolved configuration.                                                                                                                                                      |
| `docker compose config --services` (with `--profile local-ai`)               | `db migrate api ollama web worker`. Without the profile, `ollama` is correctly absent.                                                                                                            |
| `docker compose config --volumes`                                            | `db-data files-data` — named volumes, so `docker compose down` preserves data.                                                                                                                    |
| `docker compose config` port resolution                                      | `web` resolves to `host_ip: 127.0.0.1, published: "3000", target: 8080`. No service binds `0.0.0.0`; `db` and `worker` publish nothing.                                                           |
| `docker compose config` dependency conditions                                | `api` depends on `db: service_healthy` **and** `migrate: service_completed_successfully`. Ordering is enforced, not hoped for.                                                                    |
| `sh -n scripts/*.sh`                                                         | All 7 POSIX scripts parse: `lib.sh setup.sh migrate.sh smoke.sh backup.sh restore.sh dev.sh`.                                                                                                     |
| `[Parser]::ParseFile` on `scripts/*.ps1`                                     | All 7 PowerShell scripts parse with zero errors: `lib.ps1 setup.ps1 migrate.ps1 smoke.ps1 backup.ps1 restore.ps1 dev.ps1`.                                                                        |
| `bash scripts/setup.sh --help`                                               | Prints full usage. Exit 0.                                                                                                                                                                        |
| `bash scripts/setup.sh` (against a throwaway `JG_ENV_FILE` in `/tmp`)        | Generated `SESSION_SECRET`, `ENCRYPTION_KEY`, `WORKER_AUTH_TOKEN`, `SETUP_TOKEN` via `openssl rand`; printed the setup token exactly once; wrote it nowhere else. The throwaway file was deleted. |
| `bash scripts/setup.sh` (second run, existing file)                          | Refused to overwrite. Exit 1, with the `--keep-existing` / `--force` guidance.                                                                                                                    |
| `bash scripts/setup.sh --keep-existing`                                      | Left existing secrets untouched and did not reprint the setup token. Exit 0.                                                                                                                      |
| `powershell -File scripts/setup.ps1` (throwaway `$env:JG_ENV_FILE`)          | Same behaviour as the POSIX version: four secrets generated via `RandomNumberGenerator`, token printed once, refuses to overwrite on the second run (exit 1).                                     |
| `bash scripts/{migrate,smoke,backup,restore,dev}.sh --help`                  | All print usage and exit 0.                                                                                                                                                                       |
| `Get-Help scripts/*.ps1`                                                     | Comment-based help resolves for all five operator scripts.                                                                                                                                        |
| `bash scripts/backup.sh --nonsense`                                          | Exit 1 with `error unknown option: --nonsense`.                                                                                                                                                   |
| `python -c "import yaml; yaml.safe_load(...)"` on `.github/workflows/ci.yml` | Parses. Jobs: `contracts node-quality node-test worker fixtures compose-build hygiene`.                                                                                                           |

### Container image digests (verified 2026-09-20)

Resolved with `docker buildx imagetools inspect <ref> --format '{{.Manifest.Digest}}'`
and/or `docker image inspect <ref> --format '{{index .RepoDigests 0}}'` after
pulling. See `docs/DECISIONS.md` → ADR12 for the registry caveat.

| Image                          | Digest                      | Notes                                                                                                                                                                                        |
| ------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres:17-alpine`           | `sha256:f02121de…d867995`   | Container reports `postgres (PostgreSQL) 17.11`. Digest resolved via the ECR Public mirror.                                                                                                  |
| `node:24-alpine`               | `sha256:ebfe2f90…905ec1c1`  | Runtime reports `v24.21.0`. Digest resolved via the ECR Public mirror.                                                                                                                       |
| `python:3.12-slim-bookworm`    | `sha256:392307d2…eb23564e`  | Runtime reports `Python 3.12.14`, matching local uv-managed dev. Digest resolved via the ECR Public mirror.                                                                                  |
| `nginx:1.29-alpine`            | `sha256:56168782…d9b830de`  | Digest resolved via the ECR Public mirror. The mirrored image was ~5 months old at pin time — re-resolve before release.                                                                     |
| `ghcr.io/astral-sh/uv:0.12.17` | `sha256:10787c68…ce7fa9acc` | Verified directly against GHCR (not a mirror, not rate limited). `docker run --entrypoint /uv … --version` printed `uv 0.12.17 (x86_64-unknown-linux-musl)`, matching the host's uv exactly. |
| `ollama/ollama:0.34.0`         | **not pinned**              | Tag confirmed to exist via `docker manifest inspect`; digest resolution hit Docker Hub's 429 limit. Marked `TODO(digest)` in `docker-compose.yml`.                                           |

### GitHub Actions versions (verified 2026-09-20)

Resolved against the GitHub REST API (`/releases/latest`, then
`/git/ref/tags/<tag>`, dereferencing annotated tags through `/git/tags/<sha>`).
All are pinned in `ci.yml` by full commit SHA with the tag in a comment.

| Action                    | Tag     | Commit                                                                   |
| ------------------------- | ------- | ------------------------------------------------------------------------ |
| `actions/checkout`        | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1`                               |
| `actions/setup-node`      | v7.0.0  | `820762786026740c76f36085b0efc47a31fe5020`                               |
| `pnpm/action-setup`       | v6.1.0  | `ea17c68df8912ef543352723c149a84f56e3d413` (annotated tag, dereferenced) |
| `astral-sh/setup-uv`      | v10.1.0 | `bec219d24cd3e171d82865faccec33120bb574f4`                               |
| `actions/upload-artifact` | v7.0.1  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`                               |

### Explicitly NOT verified

| Command                                       | Why not                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose up --build`                   | Not attempted. The API and worker source trees were still being written in parallel; a failure would have said nothing about the infrastructure. |
| `scripts/smoke.sh` against a live stack       | There is no live stack to run it against. This is the M0 exit criterion and it is **unmet**.                                                     |
| `scripts/backup.sh` / `restore.sh` end to end | Need a populated installation. Syntax-verified only.                                                                                             |
| `scripts/dev.sh` / `dev.ps1`                  | Needs the API and web source trees. Syntax-verified only.                                                                                        |
| `scripts/migrate.sh`                          | Needs the API's migration runner. Syntax-verified only.                                                                                          |
| Any image build from `infra/*.Dockerfile`     | Not attempted, for the same reason as `docker compose up`. **The Dockerfiles have never been built.**                                            |
| macOS and Linux behaviour                     | Never run. Unverified.                                                                                                                           |
