# Implementation status

**Last updated: 2026-09-22** · **M0, M1, M2, M3 complete; M4 in progress** — the application backend, the paired local runner and the M4 screens are landed and tested, including a real Chromium filling a synthetic Greenhouse form and stopping before submit. One complete sandbox workflow has now run on the Compose stack — packet, approval, a real Chromium filling a synthetic form and pausing, an outcome and an export — and the five M4 screens have been rendered in a browser for the first time. No adapter has met a live board. Three gaps the acceptance scenarios exposed are now closed: the daily AI budget, specified since M0 and enforced by nothing; the submit observation, which did not exist at all; and the Spanish CV fixture, which spelled its Spanish without a single accent. AT12, AT16, AT18, AT21, AT22 and AT27 pass. AT28 now passes too, on a fresh installation with no AI provider, through both the API and a real browser. It found one real gap: a tracker entry for an application made outside the product could never be marked submitted, which is now fixed. AT25 passes as well. `scripts/backup.sh` and `scripts/restore.sh` ran for the first time. A populated installation was backed up encrypted and restored into a separate installation, which came back identical field for field, with every file byte-identical. A deletion made after the backup stayed deleted when that backup was restored over the source. Workspace deletion is now built, and AT26 passes: access ends in one transaction for every session and paired device, the files and rows are erased and the owner account with them, and a receipt that names nobody records the completion. It ran live on a throwaway Compose stack, and restoring a backup taken before the deletion deleted everything again, files included. Getting there closed a gap in the restore scripts, which had put back the bytes of deleted files. That makes 26 of 28 scenarios passing and **every pilot-gate scenario passing**. A second Compose project is now isolated by `-p` alone: the volume and network names follow the project name. The earlier headline figure of 24 was one too many; the rows added up to 23. Every screen in the product has now been rendered by a real browser, in both languages: the M1, M2 and M3 screens were walked through on 2026-09-22, which closes M2's "live UI walkthrough pending" and found two pieces of copy that had quietly become false — the Jobs screen still said matching "arrives in a later milestone" while showing scores, and Settings still listed export and deletion as unbuilt next to the tab that does both. Next: **the remaining eight pilot workflows, which are the owner's to run**. They are the only thing left between M4 and its exit. M5 has also started: scoped fill sessions (migration `0011`, four `/fill-sessions` routes, 27 cases) closed AT23 and took the count to 27 of 28, and **the extension now exists** — a Manifest V3 package that builds and is tested, sharing one planner with the desktop runner and pinned to it by golden vectors that make jsdom and Chromium agree on a form's fingerprint byte for byte. On 2026-09-22 it was loaded in a real Chrome and **filled a form**: Ada Lovelace's name and email typed into the synthetic Greenhouse page, the gender question correctly left alone, the required questions it could not answer reported rather than guessed, and submit never pressed. That run also closed AT24, the last open scenario — **28 of 28 now pass** — and found a real defect: the fill resolved "the active tab" at click time rather than when the popup opened.

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

|                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional requirements implemented | 11 of 14 (PR01–PR10, PR14); PR11 is partial (providers, weights, limits and connectors configurable; prompt bodies are not)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Acceptance scenarios passing        | **28 of 28.** AT24 was the last, closed on 2026-09-22 by loading the extension in a real Chrome and having the page it had just filled attack it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Milestones complete                 | 4 of 8 (M0, M1, M2, M3); M4 in progress, 2 of 10 pilot workflows run; M5 in progress. **All 28 acceptance scenarios pass** — see the milestone table for what "complete" covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Verified working today              | Toolchain; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm contracts:check`; every test suite (contracts 192, api 667, web 225, ui 7, worker 555, fill-planner 84, extension 39); two M4 workflows on the Compose stack — one full sandbox fill with a real Chromium, and one prepared to the approval gate against a live Greenhouse posting; the fixture corpus (46/46); all three images build; `docker compose up` from a `setup.sh`-generated `.env`; `scripts/smoke.sh` through the nginx proxy on `127.0.0.1:3000`; data persistence across `docker compose down`/`up`; `scripts/backup.sh` (gpg and `--no-encrypt`), `scripts/restore.sh` into a separate installation and over the source, and `scripts/migrate.sh` (AT25); workspace deletion on a throwaway stack, and a restore of a pre-deletion backup that re-deleted it (AT26); all eleven M1–M3 screens rendered by a real Chromium against the live stack, in English and Spanish |
| **Never executed**                  | `scripts/smoke.ps1`, `scripts/backup.ps1`, `scripts/dev.*` (syntax-checked only); `scripts/restore.ps1` end to end (its new file-pruning block ran on its own under Windows PowerShell 5.1; the whole script stops earlier on 5.1, see AT26); `backup.sh --age-recipient` (only the gpg and plaintext paths ran); the `local-ai` Ollama profile; any image build on a host WITHOUT TLS interception (the no-secret path is verified only by construction); macOS/Linux hosts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

If you came here from the README looking for a product: there isn't one yet.
Source exists and it typechecks — that is not the same as working, and this file
does not treat it as the same.

---

## Functional requirements (PR01–PR14)

From `docs/spec/01_PRODUCT_REQUIREMENTS.md`.

| ID   | Requirement                                                      | Milestone | Status          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------- | --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR01 | Create and edit profile manually                                 | M1        | **Tested**      | `GET /profile` and `PATCH /profile` are live (`apps/api/src/routes/profile.ts`), and the Profile screen edits facts through `FactForm`/`FactSummary`. Asserted by 18 API cases in `apps/api/tests/profile.test.ts` and the web cases in `apps/web/tests/profile.test.tsx`, executed 2026-09-21. A fact carries its own provenance, so a manual edit is distinguishable from an imported one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PR02 | Import PDF/DOCX or pasted text; review extracted fields          | M1        | **Tested**      | The import routes (`create`/`get`/`confirm`), the `parse_profile` worker handler and the Import review screen are all live. Asserted by 30 API cases in `apps/api/tests/profile-imports.test.ts` and `apps/web/tests/import.test.tsx`, executed 2026-09-21. Verified live too (see M1): a real PDF parsed to 19 draft facts with page locators, 18 confirmed and the withheld draft discarded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| PR03 | Record titles, skills, locations, salary, languages, eligibility | M1        | **Tested**      | Every field in the requirement exists in the preferences contract — `target_titles`, `required_skills`/`preferred_skills`, `countries`/`remote_modes`, `salary`, `languages`, `sponsorship_policy` and `unknown_eligibility_policy` — and is editable through `GET`/`PUT /preferences` and the Preferences screen. Asserted by 88 API cases in `apps/api/tests/settings.test.ts` and `apps/web/tests/preferences.test.tsx`, executed 2026-09-21. Work eligibility keeps `unknown` as a real value rather than defaulting it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PR04 | Import job URL or description; configure company boards          | M2        | **Tested**      | `POST /jobs/import` (URL or pasted text) and the source registry are live; verified on the Compose stack with a pasted-text import that resolved to a job carrying its salary excerpt. A title or employer an unstructured page got wrong is correctable afterwards through `PATCH /jobs/:id`, and a corrected field survives the next fetch (migration `0008_job_user_edits`). The web import panel (`apps/web/src/discovery/ImportPanel.tsx`, reached from Discover) is now built and covered by `apps/web/tests/jobImport.test.tsx` (8 tests): URL and pasted text are mutually exclusive by construction, a refused fetch states the refusal and offers the paste path without suggesting any circumvention, and a candidate list re-imports under a new idempotency key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PR05 | Fetch Greenhouse and Lever listings, deduplicate and refresh     | M2        | **Tested**      | Greenhouse and Lever connectors, dedup, refresh and closure rules are live. Verified 2026-09-20 against Greenhouse's own public board through the Compose stack: 21 postings, `complete_snapshot: true`, source health `ok`; a second scan took the conditional-request path (304 → nothing re-fetched, nothing closed, still 21 jobs). The Discover, Jobs and Job-detail screens are now built and covered by 41 executed web tests; the 304 re-scan renders as "unchanged", not as a failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PR06 | Explain fit, missing requirements and unknown eligibility        | M3        | **Tested**      | Fit algorithm v1, end to end: contracts, migration `0003_matches`, `POST /jobs/:id/match`, the deterministic `match_job` worker handler, and the Jobs and Job-detail screens. Hard filters run before any score and return a tri-state verdict per filter with the evidence behind it; components are renormalised over the evaluable weight only, so a component nothing could be read for is excluded and counted against coverage rather than scored zero; a requirement matched only through a _related_ skill stays `uncertain` and earns nothing. Scoring calls no provider, so it costs no AI budget and works with no model configured at all. Asserted by 34 worker tests, 17 API tests, 17 web tests and 11 migration tests. **Known gaps:** the industry component is never evaluable (no connector extracts an industry and the preferences schema has no field for one), so coverage tops out at 90% with the default weights; seniority is read from the job title only; the skill alias map is small and hand-checked by design.                                                                                                                                                                                                                                                                                                         |
| PR07 | Generate truthful tailored PDF/DOCX CV, or preserve original     | M3        | **Tested**      | Contracts, migration `0004_resumes`, `POST /resumes`, `GET /resumes/:id`, `POST /resumes/:id/approve`, the `render_cv` worker handler and the CV studio screen. A true document is assembled from confirmed facts deterministically first; a model is then asked to re-present _that_, never a blank page, and whatever returns is validated against the facts with failures dropped one bullet at a time. With no provider configured the deterministic document is the output, so CV generation works with no AI at all. Both formats render from the one validated document. The PDF template is autoescaped with no script, image, link or webfont and is loaded as content rather than from a URL; when Chromium is unavailable the DOCX still ships and the result says the PDF is missing. Original mode references the uploaded bytes and generates nothing. Approval is a user action: no task path can set `approved_at` and the database only accepts it on a `ready` row. Asserted by 25 worker tests, 28 API tests and 18 web tests. **Known gaps:** there is no list route in the contract, so the studio cannot show a CV generated in an earlier session; the page-overflow warning depends on a rendered PDF, so it is absent when Chromium is; and `page_target` is reported against, never enforced by shrinking type or truncating. |
| PR08 | Reviewable application packet and answer bank                    | M4        | **Tested**      | Contracts, migration `0005_applications`, the packet and approval routes, the answer bank, and the **Application review screen**. A packet snapshots the profile and job revisions, the CV bytes and the destination resolved from the job's own provenance; approval is bound to a SHA-256 of that content, quoted back by the screen that displayed it, and expires. 34 API cases, 28 schema cases and 16 web cases. No packet has been reviewed on a running stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PR09 | Autofill tested forms locally; final submit manual               | M4        | **Tested**      | Device pairing, `POST /applications/:id/fill`, the `fill_local` contract, a deterministic planner, the `greenhouse/v1` adapter, a persistent Chromium the runner owns, and the **Fill assistant panel**. 14 browser tests drive a real Chromium against a synthetic Greenhouse-shaped page. It has **never run against a live board** and no form has been filled for a real application. Final submit is manual by construction: no code path clicks one, and the panel says so in every state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PR10 | Track outcome with evidence, history, duplicate prevention       | M4        | **Tested**      | The outcome route, the event log, the **Tracker screen** and the review screen's timeline. "Submitted — verified" and "Submitted — reported by you" are different badges and a browser session cannot claim the first: `adapter_observed` is refused by the API and is not offered in the UI. The event log is append-only, enforced by a trigger. Duplicate prevention is two-layer: one application per job by constraint, plus a warning about other applications for possibly-duplicate jobs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PR11 | Configure providers, prompts, weights, limits, connectors        | M3–M5     | **In progress** | Four of the five are configurable and tested: providers through `GET`/`PUT /settings/providers` and the Provider screen (write-only, AES-256-GCM encrypted key), `match_weights` and `limits` through preferences (and `ai_requests_per_day` is now enforced rather than merely stored — see the AT21/AT22 section under "Verified commands"), and connector settings through `PATCH /sources/:id`. Prompts are **not**: the only user-reachable control is `prompt_style_suffix`, and the prompt bodies themselves are not editable. Covered by `apps/api/tests/settings.test.ts` (88 cases) and `apps/web/tests/provider.test.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PR12 | Hosted app plus extension, accounts, quotas, isolation           | M5–M6     | **In progress** | Two M5 slices are landed and tested. **Scoped fill sessions** (migration `0011`, the `/fill-sessions` contract, four routes, 27 API cases): a session binds one approved packet to one device, one tab origin, one packet hash and one nonce, for ten minutes, spent once. **The extension** (`apps/extension`, Manifest V3): a service worker that holds the device token, a content script that holds no credential and decides nothing, a Greenhouse reader ported from the runner's own DOM snippets, and a popup. It builds into a loadable unpacked extension and has 39 tests. The planner both clients share is `packages/fill-planner`, a port of the runner's `forms.py` and `plan.py` pinned to it by golden vectors asserted from both sides (84 TypeScript cases, 84 Python). **Never loaded in a browser, and no form filled.** The CV is not attached automatically, pairing and the application id are pasted by hand, and Lever does not exist. Accounts, quotas and hosted isolation are M6.                                                                                                                                                                                                                                                                                                                                          |
| PR13 | Discover company pages through an optional search API            | M6        | Not started     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PR14 | Export/delete user data; backup/restore local installation       | M4        | **Tested**      | `POST /workspace/export` writes a real ZIP — versioned JSON plus the files — with a manifest that names what was deliberately left out, and the Privacy settings tab downloads it with its checksum. `DELETE /workspace` (AT26) takes a literal confirmation and the password, revokes every session and paired device and cancels in-flight tasks in one transaction, then erases the stored objects, the rows and the owner account; a local installation left with no account reopens setup. Its receipt (`workspace_deletions`, migration 0010) is read without a session and holds no personal data. The deletion ledger (`0007_privacy`) records every deletion, and `scripts/restore.sh`/`.ps1` reapply it to the database and, since AT26, to the files volume too. Export and deletion are covered by `apps/api/tests/workspace-export.test.ts` and `workspace-deletion.test.ts`; backup/restore by AT25 and AT26 on populated installations.                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## Acceptance scenarios (AT01–AT28)

From `docs/spec/11_TESTING_ACCEPTANCE.md`. "Where the test lives" is filled in
when a test exists; `—` means there is no test.

| ID   | Scenario                                                                    | Status     | Where the test lives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AT01 | Clean Compose start: health passes, schema created, owner setup works       | **Passed** | Verified 2026-09-20 on the real Compose stack: `sh scripts/setup.sh` → `docker compose up` (db healthy → one-shot `migrate` exit 0 → api healthy → worker, web) → `scripts/smoke.sh` through the nginx proxy on `127.0.0.1:3000`: one-time owner setup, probe task completed by `container-worker-1`, idempotent replay. After bootstrap the genuine `SETUP_TOKEN` returns 409 `SETUP_CLOSED` through the proxy. `docker compose down` (no `-v`) then `up`: both named volumes kept, migrate reports "Schema is up to date", the pre-restart owner logs in. Also `apps/api/tests/db/schema.test.ts`, `tests/auth.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AT02 | Text PDF/DOCX import gives editable extraction with provenance              | **Passed** | Live: `fixtures/cvs/text-cv.pdf` uploaded and parsed to 19 draft facts with page locators and real source excerpts; nothing auto-confirmed. Also `services/worker/tests/test_parse_profile.py`, `apps/api/tests/profile-imports.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AT03 | Scanned/encrypted/malformed CV gives an explicit error, no invented profile | **Passed** | `services/worker/tests/test_extraction.py`: scanned -> OCR_REQUIRED, encrypted -> ENCRYPTED_DOCUMENT, malformed/mislabelled -> FILE_UNREADABLE, too-short -> EXTRACTION_SHORT, each asserting zero invented facts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AT04 | Conflicting profile import preserves verified facts until resolved          | **Passed** | `apps/api/tests/profile-imports.test.ts`: confirming a conflicting draft without `supersedes_fact_id` leaves the existing confirmed fact byte-identical; with it, the old row is superseded and retained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AT05 | Board fetch with duplicate jobs yields one canonical job with provenance    | **Passed** | `apps/api/tests/discovery.test.ts`: the same requisition seen twice → one job, two provenance rows; a second source links only on identical `apply_url`; similar title+location → a `possible_duplicates` warning, never a merge. Worker side: `services/worker/tests/test_connectors.py` (duplicate collapsed to one `source_key`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AT06 | Failed/partial board scan does not close missing jobs                       | **Passed** | `apps/api/tests/discovery.test.ts`: a partial snapshot closes and counts nothing; closure needs two complete snapshots ≥24 h apart; reappearance reopens. Worker: `test_fetch_board.py` marks every cap, failure or denial mid-scan as `complete_snapshot=false`. Observed live: a 304 re-scan closed nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AT07 | Remote job restricted to US: non-US eligibility not assumed                 | **Passed** | Live: from `text-cv.pdf`, UY authorization resolves `yes` while US stays `unknown` with `sponsorship_required: yes`. A regression here is what the nullable-field fix below was for. Also `services/worker/tests/test_truthfulness.py`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AT08 | Unknown currency/period: no invalid comparison or silent conversion         | **Passed** | Both halves. Display: `apps/web/tests/jobs.test.tsx` and `jobDetail.test.tsx` assert currency and period verbatim, "Salary unknown" for an absent salary, and an explicit no-conversion note. Comparison: `services/worker/tests/test_matching.py` asserts a EUR salary against a USD minimum yields `SALARY_NOT_COMPARABLE` with nothing converted and does **not** make the job ineligible, and that a comparable range is judged on its upper bound.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AT09 | Prompt-injected job description: no instruction execution                   | **Passed** | `services/worker/tests/test_parse_profile.py`: from `prompt-injection-cv.pdf` the result contains no "Stanford", "PhD", "15 years" or the exfiltration URL, the genuine facts are unchanged, and no credential appears in the result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AT10 | Generated CV adding a numeric claim is blocked or flagged                   | **Passed** | `services/worker/tests/test_resume.py::test_a_number_absent_from_the_facts_is_dropped_and_flagged`: a bullet reading "Cut ingestion latency by 40%" over a fact that never mentioned 40 loses the bullet, raises `NUMBER_NOT_IN_FACTS` with `removed: true` and the offending text quoted, and fails `passed_automatic_checks`. A figure the facts _do_ contain survives, asserted alongside it. The web side shows the removed text (`apps/web/tests/cvStudio.test.tsx`). **Qualification:** this is the deterministic layer only. A bullet can be faithful in every number and still oversell a contribution, which is why the field is `passed_automatic_checks` and user approval stays mandatory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AT11 | Original CV mode: downloaded bytes SHA-256 identical to upload              | **Passed** | Live: uploaded and downloaded `text-cv.pdf` SHA-256 both `c9dcbc53...3da7`, matching `fixtures/MANIFEST.sha256`. Served `Content-Disposition: attachment` with `nosniff`; unauthenticated download returns 401.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AT12 | PDF/DOCX render: text extractable, accents intact, nothing clipped          | **Passed** | Asserted on the files themselves, read back the way a recipient would: `services/worker/tests/test_render_output.py` prints a Spanish CV through a real Chromium, reads it with pypdf and the DOCX with python-docx, and compares the text against the document that was rendered. **Extractable** (not an image), **accents intact** (all nine characters Spanish needs, asserted individually so a failure names the one lost), and **nothing clipped** — a deliberately long CV must report more than one page and still contain its _last_ line, which is what catches a fixed height or an `overflow: hidden` creeping into the template. Both formats are also compared against each other, because a CV that differs between them is two CVs. Verified live: a Spanish CV generated on the Compose stack, downloaded and read back, all accents intact in both formats and nothing missing. **The fixture had to be fixed first — see below.**                                                                                                                                                                                                                             |
| AT13 | Editing a packet after approval rejects the old approval                    | **Passed** | `apps/api/tests/applications.test.ts`: after approving packet 1, changing an answer writes packet 2 with a different hash, the application returns to `ready_for_review` with no approval, and re-presenting packet 1's id and hash is refused with 409. `apps/api/tests/db/application-schema.test.ts` adds the database half: `approved_hash` may only ever equal this packet's own `content_hash`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AT14 | Unknown required form question pauses without guessing                      | **Passed** | Both halves. Packet: `apps/api/tests/applications.test.ts` — a required question with a null answer lands in `needs_input`, is reported unresolved, stays null and blocks approval. Filling: `services/worker/tests/test_runner_greenhouse.py` — against a real Chromium, the referral-code field the packet cannot answer is left empty, the run reports `needs_input`, and `apps/api/tests/fill.test.ts` shows the API writing that question into a new packet revision with the old approval withdrawn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AT15 | Two simultaneous fill requests: only one session, second conflicts          | **Passed** | `apps/api/tests/fill.test.ts`: a second `POST /applications/:id/fill` while a `fill_local` task is queued or leased is refused with 409. The check is on the task queue, not on a flag, so a runner that is mid-fill still blocks the second request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AT16 | Submit observation times out -> `outcome_unknown`, no retry                 | **Passed** | Built for this: `observe_confirmation` is a new runner-only, never-retried task (migration `0009`), because nothing in the product could observe a submission at all. Worker: `services/worker/tests/test_runner_observe.py` drives a real Chromium against a synthetic confirmation page and against a form that never confirms — the watch that runs out returns `outcome="unknown"`, `unknown_reason="timed_out"` as a **result**, not an exception, because a raise would surface to the user as "your application failed"; a footer "thank you" is rejected as a confirmation; the form is verified untouched. API: `apps/api/tests/fill.test.ts` — the timeout lands in `outcome_unknown` with no evidence and no submission time, the task succeeds so nothing is queued to retry, and both a second fill and a second observation are refused until the person resolves it. Verified live on the Compose stack against a real Greenhouse destination.                                                                                                                                                                                                                     |
| AT17 | Unsupported ATS: honest manual fallback, packet saved                       | **Passed** | Both halves. Runner: `services/worker/tests/test_runner_greenhouse.py` — a page with no tested adapter is reported `unsupported`, nothing is typed and the form is verified untouched. API: `apps/api/tests/fill.test.ts` — the application returns to `approved` with its packet and its approval intact, so the user can apply by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| AT18 | Worker crash/reclaim: exactly one committed result, stale lease rejected    | **Passed** | The queue mechanics were already covered on `noop_echo` in `apps/api/tests/queue.test.ts` (reclaim, new token, stale complete/heartbeat/fail all 409, one audit event, scheduler sweep) and on the worker in `services/worker/tests/test_worker_loop.py`. What was missing was the half that would hurt, since `noop_echo` has no domain effect by design. Now asserted: `apps/api/tests/profile-imports.test.ts` — a crashed `parse_profile` worker's drafts never reach the import, the reclaiming worker's do, replaying the winning token is refused, and a stale _failure_ cannot mark a finished import failed; `apps/api/tests/files.test.ts` — an artifact staged under a reclaimed lease stays `staging` and is swept while the winning lease's artifact is committed, so a crashed worker's half-made document never joins the user's files.                                                                                                                                                                                                                                                                                                                            |
| AT19 | Different workspace UUID requested: 404/403, no leak                        | **Passed** | `apps/api/tests/isolation.test.ts`: a foreign workspace UUID on every id-taking route returns a 404 byte-identical to a genuinely absent id; client-supplied `workspace_id` is ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AT20 | Private IP or redirect fetch blocked, including IPv6 and rebinding          | **Passed** | `services/worker/tests/test_fetch_policy.py`: http://, loopback, link-local, RFC1918, cloud-metadata (v4 and `fd00:ec2::254`), IPv4-mapped v6, NAT64/6to4, names resolving to private or mixed addresses, and a public→private redirect are all refused with zero requests to the private target; body cap enforced mid-stream; robots honoured; no cookie or credential ever sent. The connection is pinned to the validated address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AT21 | Cloud provider unavailable: no surprise switch, drafts preserved            | **Passed** | Both halves. Worker: `services/worker/tests/test_budget_and_availability.py` — a provider that will not answer fails the task `PROVIDER_UNAVAILABLE`, is asked exactly once, and nothing looks for a second provider (ADR07 forbids failover); the real `openai_compatible` adapter maps a refused connection to the same code rather than to an empty answer; the failure message carries the operational detail and no CV text. API: `apps/api/tests/profile-imports.test.ts` — a failed parse leaves every confirmed fact and every earlier import's drafts exactly as they were, and reports the failure rather than an empty extraction. Live: the worker's own client in the worker container, against the running stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AT22 | Budget exhausted: inference blocked, review/export still work               | **Passed** | The daily budget is now enforced against `usage_ledger` over a rolling 24 hours, reserved before each request through three new internal routes; it used to be a counter inside a worker process that started at zero every task. `apps/api/tests/usage.test.ts` (19 cases) covers accumulation across separate tasks, the 409 refusal, release, settlement, unknown-price handling and the honest `GET /me`; and asserts that with the budget spent, jobs, profile, preferences, applications, a part-reviewed import, manual editing and `POST /workspace/export` all still work. `services/worker/tests/test_budget_and_availability.py` asserts the refusal reaches the worker before the model is asked. Verified live on the Compose stack.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AT23 | Revoked extension token denied immediately                                  | **Passed** | Both halves, and the second one is new. Device: `apps/api/tests/devices.test.ts` revokes a paired token and the very next internal claim is 401, because `revoked_at` is read on every request rather than at expiry; revocation also destroys the digest, so a leaked copy is inert. Extension: `apps/api/tests/fill-sessions.test.ts` pairs a device of kind `extension`, opens a live fill session with it, revokes it, and asserts the next call is 401 **and** that the session it already held is ended with `device_revoked`. That second half is what "no new packet access" means here: a ten-minute session outliving its own credential would be exactly the access the scenario forbids. **Qualification:** this is proven at the API boundary. No browser extension exists to hold the token — `apps/extension/` is empty — so what is asserted is that the API denies a revoked extension token, not that a shipped extension handles the denial well.                                                                                                                                                                                                              |
| AT24 | Malicious page message cannot reach token/profile                           | **Passed** | Verified in a real Chrome on 2026-09-22 with the extension loaded unpacked, on the page it had just filled — see "M5 end to end" under "Verified commands". The page knows the extension id, because it is in the URL of every injected resource, and a message sent to it that way **does not arrive**: the extension declares no `externally_connectable`, so the page has no `chrome.runtime` to call. A forged `window.postMessage` carrying a well-formed fill command changed nothing, because there is no `window` message listener anywhere in `src/` for it to reach. The page could not see `chrome.storage` at all, so the device token was unreachable. Underneath that, in tests: the API refuses these routes to a session cookie, the grant carries no profile and no secret, and the destination comes from the approved packet, so supplying one is a 400 from the closed contract rather than a quietly ignored field (`apps/api/tests/fill-sessions.test.ts`). Sender verification is asserted on its own for the cases a live page cannot produce — a different tab, a subframe, a post-navigation origin (`apps/extension/tests/messages.test.ts`, 9 cases). |
| AT25 | Backup/restore: profile, files, hashes and history restored                 | **Passed** | Verified 2026-09-22 on two throwaway Compose projects. See "AT25" under "Verified commands". A populated installation (six profile facts, an uploaded CV, two scored jobs, a tailored CV in PDF and DOCX, an approved packet, two applications with seven history events, three stored answers and a workspace export) was backed up with `scripts/backup.sh`, gpg-encrypted. It was restored with `scripts/restore.sh` into a **separate** installation with its own `setup.sh` `.env`. The owner logged in with the source password. The two API snapshots are equal field for field, including the packet `content_hash` and `approved_hash`, and all four files download byte-identical. The uploaded CV matches the fixture it came from (AT11's half of this). An answer deleted after the backup stayed deleted when that backup was restored over the source. `.local/at25/at25.py` drives it; the comparison was checked to catch a tampered field.                                                                                                                                                                                                                      |
| AT26 | Delete workspace: access revoked, files erased, completion recorded         | **Passed** | `apps/api/tests/workspace-deletion.test.ts` (21 tests): the asking session, a second session, a paired device and a worker holding a lease are all refused afterwards, and the revocation holds while erasure is still failing; the bytes are gone from disk, including an object no row names, and every workspace-scoped table is empty; the receipt survives the workspace, is readable without a session and contains no email, file name or answer, and neither does the ledger row. A wrong password or a missing confirmation deletes nothing, another workspace is untouched, and `scripts/reapply-deletions.sql` removes the owner and reopens setup. Live on a throwaway Compose stack on 2026-09-22 — see "AT26" under "Verified commands".                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AT27 | English/Spanish flow: labels, Unicode, dates, documents correct             | **Passed** | Three layers, none of which covers the others. Catalogue: `apps/web/tests/i18n.test.tsx` — identical key sets, no empty string, no raw key on a rendered Spanish screen. Dates and numbers: `apps/web/tests/format.test.ts` (17 cases) — Spanish puts the day first and the month in words, groups with `.` and decimalises with `,`, does **not** group a four-digit number (CLDR `minimumGroupingDigits: 2`), and separates a currency from its symbol with a non-breaking space; an absent or unparseable date returns null rather than `Invalid Date`. Flow over real data: `apps/web/tests/spanishFlow.test.tsx` — accented employer, title and city rendered byte-for-byte across two screens, the date in Spanish order on a data-driven row, `lang="es"` on the document, and the same employer name **untranslated** in English. Documents: the AT12 work above, in Spanish throughout, verified live.                                                                                                                                                                                                                                                                   |
| AT28 | No AI configured: manual profile, job import and tracker usable             | **Passed** | Verified 2026-09-22 on a fresh, isolated Compose installation with no provider row and `PROVIDER_DEFAULT=none`: 27/27 API checks and 8/8 browser checks, see "AT28" under "Verified commands". It found the tracker gap: an application made outside the product could not be recorded as submitted (`draft → submitted` was refused with 409). That edge is now allowed, always as `user_report` (`apps/api/tests/applications.test.ts`, three new cases; `apps/web/tests/applications.test.tsx`, two).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Release gate status:** every scenario in the M4 pilot gate (AT01–AT18,
AT20–AT22, AT25, AT27–AT28) now passes. The gate itself is still **not met**,
because M4 also requires ten pilot workflows and two have run. The M6 hosted
gate (all scenarios) now passes **all 28**, AT24 included. The gate itself is
still **not met**: M6 also requires email verification and reset, TLS, cookie
and CSRF tests, quota concurrency, deletion retention checks and a connector
policy review, none of which exist.

---

## Milestones (M0–M7)

From `docs/spec/12_IMPLEMENTATION_PLAN.md`. Estimates there are planning ranges,
not commitments.

| ID  | Milestone                              | Status          | Exit criterion                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------- | --------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Foundation                             | **Complete**    | A runnable empty installation with an end-to-end fake task                      | Verified end to end on the Compose stack: browser origin → nginx `/api` proxy → API → PostgreSQL queue → container Python worker → stored result, with an Idempotency-Key replay returning the same task. Queue semantics exercised over real HTTP too: a schema-violating result fails the task and stores nothing; a stale lease token returns 409 with no domain effect. `/internal/v1` is not proxied (nginx answers; the SPA fallback serves GET); db, api and worker publish no host port; web is `127.0.0.1:3000` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M1  | Profile                                | **Complete**    | Confirmed profile from fixtures; unknown/conflicting data visible               | Profile, imports, preferences and provider settings exist in the API, the worker and the web UI. Verified live through the API: a real PDF parsed to 19 draft facts with page locators, 18 confirmed into the profile with the withheld draft discarded, US work authorization preserved as `unknown`. The web screens (Profile, Import review, Preferences, Provider) are behaviour-tested (97 web tests) and, since 2026-09-22, **rendered by a real browser against the live stack** in both languages — see "M1, M2 and M3 screens in a browser" under "Verified commands". Profile shows the installation's 14 confirmed facts; the walkthrough found no raw catalogue key, no console error and no overflow on any of them. Provider secrets are write-only and AES-256-GCM encrypted; the provider probe refuses private, loopback, link-local and cloud-metadata destinations including after redirects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| M2  | Job discovery                          | **Complete**    | Fixture/live-read jobs discovered; duplicates and provenance correct            | Contracts, migration `0002_discovery`, sources/scans/jobs routes, the scan scheduler, dedup/closure/health rules, the SSRF-hardened fetcher and the Greenhouse/Lever connectors are all landed, CI-green and verified live (see PR05). Two findings from the live run, both fixed: an unreachable `robots.txt` (here, a TLS failure on the worker's own side) had been reported as `ROBOTS_DISALLOWED` with health `blocked`, and `trust_env=false` on the fetcher had silenced `SSL_CERT_FILE`, so an operator behind TLS interception could not supply a trust root at all. Known nuances: a 304 re-scan is recorded as `partial` (true by the contract's definition of `complete_snapshot`, but the UI must say "unchanged", not imply failure); requirement extraction depends on explicit section headings and found none in a real Greenhouse description. The web screens (Discover, Jobs, Job detail, plus the import panel) are now built and carry both nuances above in their copy: a 304 re-scan reads "Unchanged since the last scan", and an empty requirement list reads "No requirements were extracted — read the description", never "this job has no requirements". A job that has not been checked renders "Not checked" rather than a low score. **The browser walkthrough is now done** (2026-09-22, see "Verified commands"): Discover, Jobs and Job detail render against the live API in English and Spanish, with 24 job rows, the registered Greenhouse board and its provenance row. It found the one thing 41 jsdom tests could not — the Jobs intro still told the user that "matching arrives in a later milestone", on a screen showing scores of 37, 73 and 62 out of 100. That copy is fixed in both catalogues and pinned by a test. |
| M3  | Fit and CV                             | **Complete**    | Reviewed CV in both formats; no unsupported facts; reproducible score           | PR06 and PR07 are both landed and tested (see their rows), and both halves were verified live. The score is reproducible by construction: `matches` is keyed on the full revision tuple and the matcher is a pure function with no clock, network or provider. The CV half was verified on 2026-09-21 — a tailored CV generated from seven confirmed facts, both formats downloaded and checked, and the PDF's text extracted with pypdf — so the exit criterion is met. The CV studio was rendered by a real browser on 2026-09-22, in both languages, as part of the M1/M2 walkthrough below. What that pass did **not** do is drive a generation from the screen: the live CV runs went through the API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M4  | Personal pilot                         | **In progress** | Ten user-reviewed real application workflows, or documented sandbox equivalents | The application backend and the paired local runner are both landed and tested: `0005_applications` and `0006_devices`, content-bound approval that expires and is withdrawn the moment the profile, job, CV, destination or form schema moves, the answer bank, the append-only tracker history, device pairing, and a `greenhouse/v1` fill adapter driven by a real Chromium against a synthetic form. The Application review, Fill assistant, Tracker, Devices and Privacy screens are built and covered by 19 web tests, and the workspace export and deletion ledger are landed. Pilot workflow 2 ran on 2026-09-21 against a live Greenhouse posting and stopped at the approval gate, where it belongs: a real posting discovered on the board, scored, a tailored CV rendered in both formats, a packet whose destination is the employer's own apply URL, and an approval refused (409) for a mismatched content hash. It found a real scoring bug — see the pilot section under "Verified commands". Workspace deletion is built and AT26 passes. Still to come: eight more workflows, and an approval and a fill against a live board.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M5  | Open-source distribution and extension | **In progress** | A fresh user installs without developer intervention and fills supported pages  | The repository documentation half (README, CONTRIBUTING, SECURITY, NOTICE, issue templates, license) landed early with M0. Two slices since 2026-09-22: **scoped fill sessions** and **the extension itself**, with the shared planner and its cross-client parity fixtures between them — see PR12 and the three "M5" sections under "Verified commands". AT23 and AT24 both pass, the latter performed in a real Chrome against the page the extension had just filled — which completes the acceptance suite at 28 of 28. Still to come: the session-scoped CV download (the file input is still empty and the person attaches it), pairing without pasting a token, a popup that lists approved applications instead of taking a pasted id, Lever, template/settings export, install documentation, and a live board.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| M6  | Hosted beta                            | Not started     | Hosted user needs no server and cannot reach another user's data                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| M7  | Optional unattended automation         | Deferred        | —                                                                               | Deliberately out of scope. `docs/spec/12_IMPLEMENTATION_PLAN.md`: "Do not treat M7 as needed for the personal project or beta." Needs a separate design, reliability and source-permission review before it is even scheduled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

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
- **The M4 screens have been rendered by a browser but not used by a person.**
  Chromium loaded all five and the assertions held; nobody has clicked through
  them, and the first pass found a defect (`null` in an empty answer box) that
  every jsdom test had missed.
- The browser extension (`apps/extension/`) is an empty directory.
- There is **no automatic submission** and there will not be one in the pilot or
  the hosted beta. That is a permanent design position (invariant 4), not a gap.

### Backup and restore are incomplete by design

- `scripts/restore.sh` **now reapplies the deletion ledger** (migration
  0007): it saves the target's ledger before the restore, merges it back after,
  and runs `scripts/reapply-deletions.sql`. Its own report still says "not a
  verified restore", which is accurate for the script by itself. The check
  through the application is AT25, which passed on 2026-09-22.
- AT25 ran the gpg and plaintext paths on Windows under Git Bash.
  `--age-recipient`, the PowerShell scripts, and macOS and Linux hosts have
  never run.
- Since AT26 the restore scripts also remove, from the unpacked files volume,
  every object the ledger names: a deleted workspace's whole directory and each
  deleted file. Before that, a restored backup put back the bytes of deleted
  files even though their rows stayed deleted.
- A workspace deletion's **receipt** (`workspace_deletions`) is not carried
  through a restore of an older backup, the way the ledger is. The deletion
  itself still holds; only the page at `/deleted/<id>` answers 404 afterwards.
- `restore.ps1` cannot finish on Windows PowerShell 5.1. It stops at its first
  `docker compose up -d --wait db 2>$null`, because 5.1 turns a native
  command's stderr into a terminating error under `$ErrorActionPreference =
'Stop'`. The code predates AT26, and the RUNBOOK invokes it with `pwsh`,
  which is not installed here. The block AT26 added ran on its own under 5.1.
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

**Still not verified** _(at the time of writing — superseded the same day by
the live run below, and for M1–M3 by the 2026-09-22 walkthrough)_**.** No
browser has rendered any of these screens. Every assertion above is jsdom
against a fake client; `pnpm --filter @job-getter/web build` and a real Compose
run are both outstanding, as they have been since M2.

### M4 export and the deletion ledger (verified 2026-09-21)

| Command                                                        | Observed output                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --filter @job-getter/api test`                           | **29 files, 567 tests passed**, including `tests/workspace-export.test.ts` (10). |
| `pnpm --filter @job-getter/web test`                           | **21 files, 191 tests passed** (three new Privacy-tab cases).                    |
| `sh -n scripts/restore.sh`                                     | **Exit 0.** Parses.                                                              |
| PowerShell `Parser::ParseFile scripts/restore.ps1`             | `restore.ps1 parses cleanly`.                                                    |
| `pnpm contracts:check` / `typecheck` / `lint` / `format:check` | **Exit 0** each; 140 generated artifacts up to date.                             |

What the export tests establish, beyond "it produced a file":

- The archive's first four bytes are `PK\x03\x04`, its SHA-256 matches what the
  task result claims, and **Python's `zipfile` reads it** — a second
  implementation, because Node's zlib wrote it and Node agreeing with itself
  proves nothing. Those two cases skip visibly where Python is absent.
- A stored CV comes back out of the archive **byte-identical**, which is what
  lets AT11's guarantee survive a round trip through an export.
- A stored provider API key, the string `provider_settings`,
  `secret_ciphertext` and `token_hash` are all absent from the archive bytes,
  and the manifest names `provider_secrets`, `sessions` and `device_tokens` as
  deliberate omissions.
- Deleting an answer writes a ledger row holding its id and nothing else — not
  the answer, not the question key.
- The ledger **survives the workspace it names being deleted**, where every
  other private table cascades. Without that, the row recording a workspace
  deletion would be destroyed by the deletion it records, and a restore would
  have nothing to replay.
- The ledger refuses free text in `reason`, which is where identifying detail
  would otherwise leak into an operator-global table.

**Not verified.** No export has been produced on a running Compose stack, and
no backup has been restored. AT25 — "profile, files, hashes and application
history restored" — is a claim about a populated installation surviving a real
round trip, and this build has not done one. `scripts/restore.sh` reapplies the
ledger now, but its own report still says the restore is not verified, and that
is still the honest description.

_Superseded 2026-09-22:_ an export has now been produced on a running stack and
a backup restored; see "AT25" below.

### M4 live, on the Compose stack (verified 2026-09-21)

The first time any screen in this product has been rendered by a browser, and
the first time the M4 path has run outside a test harness. Run against the
Compose stack on `http://127.0.0.1:3000`, with `0005`, `0006` and `0007`
applied to the **existing populated** database.

| Step                                  | Observed                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose logs migrate`         | `applying 0005_applications` / `0006_devices` / `0007_privacy` — `Applied 3 migration(s).`                                                                                |
| `GET /me` capabilities                | `[noop_echo, parse_profile, fetch_board, fetch_job, match_job, render_cv, fill_local]`                                                                                    |
| `POST /applications`                  | `draft`, revision 1.                                                                                                                                                      |
| `POST /applications/:id/packets`      | `ready_for_review`; destination resolved from the job's own provenance; content hash `66ba78d8…baf0`.                                                                     |
| Approve with a **wrong** hash         | **HTTP 409.**                                                                                                                                                             |
| Approve with the displayed hash       | `approved`, expiring 24 hours later.                                                                                                                                      |
| `POST /devices/pairing` + `/exchange` | A code minted in the session, exchanged once for a scoped token.                                                                                                          |
| `POST /applications/:id/fill`         | `filling`.                                                                                                                                                                |
| `job-getter-runner run --headless`    | Claimed the task over the internal protocol, downloaded the CV through the lease-scoped endpoint, **filled 8 of 14 fields** and reported `needs_input` with 6 unresolved. |
| Resulting application                 | `needs_input`, **packet revision 2**, approval withdrawn, `unresolved_question_keys: ['internal_referral_code']`.                                                         |
| History                               | `created(user)` → `packet_created(user)` → `packet_approved(user)` → `fill_requested(user)` → `fill_paused(runner)`.                                                      |
| `POST /applications/:id/outcome`      | `submitted`, `user_report`, reference `SANDBOX-1`.                                                                                                                        |
| `POST /workspace/export`              | `succeeded`, 324,337 bytes, 4 entries, manifest first; downloaded SHA-256 matched the task result exactly.                                                                |
| Export contents                       | `secret_ciphertext`, `token_hash`, `password_hash` all absent; `excluded` lists all six omissions.                                                                        |
| Five M4 screens in Chromium           | Applications, Application review, Tracker, Devices, Privacy all rendered full-page. The tracker shows "Submitted — reported by you" and **not** "Submitted — verified".   |
| The same build in Spanish             | Chromium with `locale=es-ES` renders `Iniciar sesión`; the English shots use `locale=en-GB`.                                                                              |

**One real defect, found here and fixed.** The answer editor rendered an
unanswered question's value with `String(answer)`, so a `null` answer appeared
in the text box as the four characters **`null`** — and pressing save would
have sent an employer the literal word "null" as the answer to "Internal
referral code" and "Gender". Every jsdom test passed, because none of them
looked at what the input displayed for a null. The fix renders an empty field,
turns a cleared field back into `null` rather than an empty string (so the
required check keeps failing, which is the point), and keeps a list answer a
list. Two web tests now pin it, and a browser re-check after the rebuild
reports `inputs showing the word null: 0`.

**One deployment gap, found here and closed.** The paired runner speaks the
internal task protocol, and nginx deliberately does not proxy `/internal/`
(10_DEPLOYMENT.md). The API published no port, so the runner had nowhere to
reach it and the whole local-filling path was unusable on a real installation.
The API is now published on `127.0.0.1:3001` by default
(`API_BIND_ADDRESS`/`API_PORT`), which is not the public internet and still
requires the operator credential or a paired device token.

**One guard moved, not weakened.** `WORKER_CAPABILITIES=fill_local` used to be
refused inside the settings model, which also refused the paired runner — the
one process that may legitimately claim it. The check now lives in the
container worker's entry point, where the rule ("a headless container has no
desktop browser") actually applies. Moving it into an environment flag would
have been the wrong fix: a guard an operator can switch off in `.env` is not a
guard.

**Sandbox, and what that word is doing.** The form was
`fixtures/ats-pages/greenhouse-application.html` served from `127.0.0.1:8099`
with the job's real title and employer substituted in, because the identity
check compares the two and a mismatch would have proved the guard rather than
the fill. The destination was written into `job_sources` with `psql`: the
importer refuses a non-public, non-https apply URL by design (AT20), and a
loopback form is exactly that. Everything downstream of the destination was
real. **No live board was touched and nothing was submitted anywhere.**

This is **one** sandbox workflow. The M4 exit criterion asks for ten
user-reviewed workflows with measured time saved and failures, and nine of them
have not happened; nor has a single real application been prepared by the
owner, which is the part only they can do.

### M4 pilot workflow 2: a live Greenhouse posting (verified 2026-09-21)

The first workflow ran against a synthetic form on loopback. This one ran
against a real posting on Greenhouse's own public board - **Software Engineer**,
`https://job-boards.greenhouse.io/greenhouse/jobs/8214721` - and stopped at the
approval gate, because approving what an employer receives is the owner's
action and nobody else's. Nothing was submitted, and no form on the live board
was opened or filled.

| Step                          | Observed output                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-scan the registered board  | `fetch_board` succeeded: `robots.txt` 200, board **304 Not Modified**, 0 jobs transferred, health `ok`. The conditional-request path works on a second real read. |
| Score the posting             | **62**, `eligible: unknown` - and wrong; see the finding below.                                                                                                   |
| Re-import after the fix       | 13 requirements extracted, `requirements` inferred from the heading `You should have`.                                                                            |
| Re-score                      | **37**, `eligible: unknown`. `skills` now evaluable at 0.16; 2 of 13 requirements matched, 11 missing.                                                            |
| Generate a tailored CV        | `render_cv` succeeded; both `pdf_file_id` and `docx_file_id` present, status `ready`.                                                                             |
| Build the packet              | Application `ready_for_review`, revision 2, destination `https://job-boards.greenhouse.io/...` resolved from the job's own provenance, 4 answers, 0 unresolved.   |
| Approve with a **wrong** hash | **HTTP 409**, and the application stayed `ready_for_review` with `approved_at: null`. The content binding holds against a real destination.                       |

**The finding, and the fix.** On the live posting the `skills` component - the
heaviest at weight 40 - came back unevaluable with `JOB_STATES_NOTHING`, and
zero requirements were extracted from a 5,840-character description. The cause
was the requirement-heading pattern in
`services/worker/src/job_getter_worker/discovery/normalize.py`: it recognised
`You have` and `You bring` but not the modal forms, and this posting headed its
requirements `You should have`. The whole section was skipped, so the score
rested on 35 of the 100 available weight and read **62** when the honest number
was **37** - a 25-point overstatement, in the flattering direction, on the
first real posting anyone asked it about. The synthetic fixture never caught it
because it uses `Requirements` as its heading. The pattern now also accepts
`you should/must/will have` and `...bring`; `What you'll do` still does not open
a requirement section, because it lists the work rather than what is required.
Asserted by `test_modal_you_have_headings_open_a_required_section` in
`services/worker/tests/test_normalize.py`.

| Command                                   | Observed output                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `uv run pytest` (worker)                  | **441 passed** in 36.48s, including the new heading test.                             |
| `uv run ruff check .` / `--check`         | `All checks passed!`; `95 files already formatted`.                                   |
| `uv run mypy` (worker)                    | `Success: no issues found in 94 source files` (strict).                               |
| `docker build -f infra/worker.Dockerfile` | Built with the build-CA secret; `worker.started` logged `capabilities 6, handlers 6`. |

**Two other things the run surfaced. Both are now fixed; see the section
below.**

1. Importing that board URL by hand produced the title
   `Job Application for Software Engineer at Greenhouse` and the company
   `(company not stated)`: the page carries no JSON-LD JobPosting, so the
   importer read the visible text and said so, with a `NO_STRUCTURED_DATA`
   warning telling the reader to review the title, company and description.
   That is the design working. What was missing was the correction afterwards.
2. The hand-imported job did not dedupe onto the same posting already
   discovered by the board connector, and `possible_duplicates` was empty -
   the connector path keys on `greenhouse:8214721` and the URL path on a hash
   of the URL, and the placeholder title and company gave the similarity check
   nothing to work with.

A note on the sandbox boundary: the profile behind this run is the synthetic
one, not the owner's real history, so the score of 37 is a real computation over
fake facts. The posting, the board read, the destination and the refusal are all
real.

### The two pilot findings, fixed (verified 2026-09-21)

**A pasted board link no longer becomes a second job.** `03_DATA_MODEL.md`
allows cross-source linking on "the final application URL or verified
requisition identity", and the rule was there - it just compared
`job_sources.apply_url` as a literal string, so it saw nothing when the import
carried no apply URL of its own and nothing at all when the link held a
campaign parameter. It now compares the _destination_: `apply_url ?? canonical_url`,
normalised, which is the same fallback `src/applications/service.ts` already
uses to decide where an application is actually sent. A host prefilter narrows
the candidates because the normaliser cannot run in SQL.

That linking exposed a second problem immediately: the unstructured page's
words then overwrote the board's. A job found by a cross-source rule is the
same posting seen from somewhere else, and that somewhere else may describe it
far worse, so the write path now defers content to whichever identity owns the
job's canonical key. The sighting still counts - provenance, freshness and
reopening are all recorded as before.

**A title and employer the source got wrong can be corrected.** `PATCH /jobs/:id`
accepts `company` and `title`, neither blankable (both travel into the packet an
employer receives). Migration `0008_job_user_edits` adds `title_edited_at` and
`company_edited_at`, because without recording _whose_ words these are the next
fetch puts the bad ones straight back - on a board scanned every 24 hours a
correction would not have lasted a day. `JobView.edited_fields` reports it, and
the job-detail screen offers the form and says outright when the words on
display are the user's rather than the source's.

| Check (live, on the Compose stack)                      | Observed output                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migrate` on `docker compose up`                        | `applying 0008_job_user_edits` / `Applied 1 migration(s).`                                                                                                                                             |
| Paste a board posting's link, with a tracking parameter | Landed on the existing job `2d168722`, `canonical_key` still `greenhouse:greenhouse:8163099`, provenance now `['greenhouse', 'url']`, job count unchanged at 24. Before this change it was a 25th row. |
| The board's own words after that paste                  | `Site Reliability Engineer` at `Greenhouse` - not the page's `Job Application for ...` and `(company not stated)`.                                                                                     |
| `PATCH /jobs/:id` with a corrected title and employer   | 200, revision 2 -> 3, `edited_fields: ['company', 'title']`.                                                                                                                                           |
| Re-import the same URL afterwards                       | The correction stood, and the 13 requirements the page states were still read from it: only the corrected fields defer.                                                                                |

| Command                               | Observed output                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm test` (whole workspace)         | **Exit 0**: contracts 191, api 571, web 194, ui 7. Run with the stack stopped. |
| `uv run pytest` (worker)              | **441 passed**, after `contracts:generate` rewrote the Pydantic models.        |
| `uv run ruff check .` / `uv run mypy` | `All checks passed!`; `Success: no issues found in 94 source files`.           |
| `pnpm typecheck` / `pnpm lint`        | **Exit 0** across all five projects.                                           |
| `pnpm contracts:check`                | **Exit 0.** `generated artifacts are up to date (140 files)`.                  |
| `npx prettier --check .`              | `All matched files use Prettier code style!`                                   |

What this does **not** do: the duplicate the pilot already created is still two
rows. The fix prevents new ones; it does not merge a pair that exists, and
nothing in the product offers to.

### AT12 and AT27: the fixture that spelled Spanish without accents (verified 2026-09-21)

**The finding came before the tests.** `fixtures/cvs/text-cv-es.pdf` is the
fixture both scenarios point at, and its generator said so in as many words:

> `"""AT12/AT27: accented Spanish text must survive extraction and rendering."""`

It contained no accented character at all. `canalizacion`, `espanol`,
`Dirigi la migracion`, `Universidad de la Republica`, `Espanol (nativo), Ingles
(profesional)` — Spanish-shaped ASCII, every accent stripped. The row in this
file had recorded it as "fixture ready" since M1. The test guarding it,
`test_spanish_pdf_keeps_its_text`, asserted `"Universidad de la Republica" in
document.text` and passed, proving that Spanish-looking words came back and
nothing whatsoever about accents. The scenario it existed for **could not have
failed against it**.

Nothing was wrong with the machinery. The page font already declares
`/WinAnsiEncoding` and the content stream is written as latin-1, and the two
agree on every codepoint Spanish needs; the accents had simply never been
typed. The fixture now carries all nine — `á é í ó ú ñ ü Ó ¿` — and
`fixtures/verify.py` asserts each one individually, so a failure names the
character that was lost rather than reporting that some string is missing.

| Check                                                    | Observed output                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Non-ASCII characters in the old fixture's extracted text | **none.** `[]`                                                                                                   |
| Non-ASCII characters in the new fixture's extracted text | `á é í ó ú ñ ü Ó ¿` — every one Spanish needs.                                                                   |
| `fixtures/verify.py`                                     | `55/55 checks passed`, including nine new per-character checks and the byte-identical determinism check.         |
| The manifest                                             | Caught the changed bytes before it was updated — `bytes differ: cvs/text-cv-es.pdf` — which is the gate working. |

**AT12 asserts the files, not the renderer's inputs.** Every other resume test
checks what goes into the renderer; `services/worker/tests/test_render_output.py`
(12 cases) checks what comes out. A real Chromium prints the PDF, pypdf reads it
back, python-docx reads the DOCX back, and the text is compared against the
document that was rendered. Each of the scenario's three clauses is a distinct
way a CV looks right on screen and is wrong in the file the employer opens:

- **Extractable.** A PDF of an image passes every visual check and is unreadable
  to the applicant tracking system that parses it first. Nobody finds out.
- **Accents intact.** `Muñoz` arriving as `Muoz` is a person's name, misspelled,
  on an application they sent under it.
- **Nothing clipped.** The long-CV test renders fourteen roles, requires the
  result to report more than one page, and then asks for the document's _last_
  line by name. That is what catches a fixed height, an `overflow: hidden`, or a
  single-page print option creeping into the template — each of which would end
  a CV mid-sentence without erroring.

The two formats are also compared against each other, because a CV that differs
between the PDF and the DOCX is two CVs: the employer receives one and the user
reviewed the other.

**AT27 needed three layers, and had one.** The catalogue half was already
covered. What was missing was whether a date or a number is _right_ in Spanish —
a screen of correct Spanish labels can still print `9/21/2026` and `1,234.5` to
someone who reads `21/9/2026` and `1.234,5` — and whether accented text survives
as _data_ rather than as a label.

`apps/web/tests/format.test.ts` (17 cases) covers the first. One assertion is
worth naming because the obvious expectation is wrong: **Spanish does not group
a four-digit number.** CLDR gives it `minimumGroupingDigits: 2`, so `1234,5` is
correct and `1.234,5` is not; writing the "consistent" expectation into the test
would have introduced an error in the name of tidiness. Currency likewise
separates the amount from `US$` with a non-breaking space (U+00A0), asserted as
an escape because the two spaces are indistinguishable in a diff.

`apps/web/tests/spanishFlow.test.tsx` covers the second, over real data: an
accented employer, title and city rendered byte-for-byte across two screens, a
date in Spanish order on a data-driven row, `lang="es"` on the document, and —
the one that says what the product believes — the same employer name
**untranslated** when the locale switches to English. The name is theirs, not a
string we own, and translating it would be inventing a company.

| Check (live, on the Compose stack)              | Observed output                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Confirm accented facts, generate `language: es` | `ready`; document language `es`; headings `['Habilidades', 'Experiencia', 'Idiomas']`.           |
| Download both formats                           | Both present, both with the right magic bytes.                                                   |
| The PDF, read back with pypdf                   | Text extractable; all eight accented characters present; nothing the document claims is missing. |
| The DOCX, read back with python-docx            | Same: all eight present, nothing missing.                                                        |

| Command                           | Observed output                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm test` (whole workspace)     | **Exit 0**: contracts 191, api 611, web **216**, ui 7. Run with the stack stopped. |
| `uv run pytest` (worker)          | **471 passed** in 81.60s, including 12 new tests driving a real Chromium.          |
| `uv run ruff check .` / `--check` | `All checks passed!`; `100 files already formatted`.                               |
| `uv run mypy` (worker)            | `Success: no issues found in 99 source files` (strict).                            |
| `pnpm typecheck` / `pnpm lint`    | **Exit 0** across all five projects.                                               |
| `fixtures/verify.py`              | `55/55 checks passed`.                                                             |
| `npx prettier --check .`          | `All matched files use Prettier code style!`                                       |

What this does **not** do. The accented characters stop at the Latin-1 overlap
that `/WinAnsiEncoding` can carry, so the PDF fixture cannot exercise a name in
Cyrillic, Greek or CJK; doing that needs an embedded font with a `/ToUnicode`
map, which is a much larger fixture and a different problem from the one AT12
names. Only the generated CV is covered end to end in Spanish — a user who
uploads an original-mode CV gets their own bytes back unchanged (AT11), which is
a different guarantee. And no human has read a Spanish screen: the flow is
asserted in jsdom, and the one live Spanish render recorded here is the login
screen from the M4 session.

### AT16 and AT18: the submit observation, and exactly-once where it matters (verified 2026-09-21)

**AT16 needed building.** The scenario is "submit observation times out →
`outcome_unknown`; no automated retry", and there was no observation. The
`outcome_unknown` status, the `adapter_observed` evidence type and the
`awaiting_user_submit → outcome_unknown` transition had all been written in
migration `0005`, against a capability nothing could produce: the runner filled
a form, stopped, and that was the end of the automated path. The only way into
`outcome_unknown` was the user selecting it by hand.

So `observe_confirmation` now exists: a runner-only, never-retried task
(`0009_observe_confirmation` widens the task-type CHECK), asked for by the
person through `POST /applications/:id/observe` **after** they have submitted
the form themselves. The runner opens the page the packet named, re-reads it on
a poll until the deadline, and reports one of two honest answers.

The design decision worth recording is that **a timeout is a result, not a
failure**. Returning `outcome="unknown"`, `unknown_reason="timed_out"` keeps the
task `succeeded`; raising would have failed the task, put it on the retry path
and — worse — shown the user "your application failed" when what actually
happened is that a page did not say anything an adapter recognises. The spec is
explicit: _"Absence of evidence is not failure or success."_ A crashed browser
lands in exactly the same place, for the same reason.

The second half of AT16, "no automated retry", is enforced in three places:
`observe_confirmation` is in `NO_RETRY_TASK_TYPES` and enqueued with
`max_attempts: 1`; `POST /applications/:id/fill` refuses from `outcome_unknown`
with its own message rather than the generic status error, because _"disable a
second attempt until resolved"_ is about not sending a second application; and a
second observation is refused too, since another look cannot settle what the
first one could not.

| Check (live, on the Compose stack)          | Observed output                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `migrate` on `docker compose up`            | `applying 0009_observe_confirmation` / `Applied 1 migration(s).`                                                 |
| Fill a packet for a real Greenhouse posting | Application reached `awaiting_user_submit`, the runner having stopped for the person.                            |
| `POST /applications/:id/observe`            | 202. The runner claimed an `observe_confirmation` task with a 90-second deadline.                                |
| The task's origins                          | `["https://job-boards.greenhouse.io"]` — the packet's own destination origin and nothing wider.                  |
| The task's `capture_evidence`               | `false`. A screenshot of a confirmation page carries the applicant's details back into storage, so it is opt-in. |
| Report `unknown` / `timed_out`              | **200.** Accepted as a result; the task is `succeeded`, not failed.                                              |
| The application afterwards                  | `outcome_unknown`, `submission_evidence: null`, `submitted_at: null`. Nothing was invented.                      |
| The event                                   | `outcome_recorded`, actor `runner`, reason `timed_out`, `watched_seconds: 90`.                                   |
| A second fill                               | **409:** "a second attempt could be a second application. Record what happened first."                           |
| A second observation                        | **409:** "Looking again will not settle it — record the outcome instead."                                        |
| Anything queued to retry                    | **204** on the next claim. Nothing.                                                                              |
| The person records the outcome              | 200, `submitted`, evidence labelled `user_report` — visibly theirs rather than observed.                         |

**AT18 was mostly already true, and untested where it counted.**
`apps/api/tests/queue.test.ts` had covered the queue mechanics thoroughly —
reclaim, a new token, stale complete/heartbeat/fail all 409, exactly one audit
event, the scheduler sweep — but every one of those runs on `noop_echo`, which
has no domain effect by design: its result lives only on the task row. "Exactly
one committed result" has to mean exactly one set of drafts in front of the
user, and that was not asserted anywhere.

| Check                                                     | Observed output                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A crashed `parse_profile` worker completing after reclaim | 409, and the import still carries **no** drafts — the stale result never reaches the domain row, not just the task row.                 |
| The reclaiming worker completing                          | 200, and the import shows its drafts and only its drafts.                                                                               |
| Replaying the winning token                               | 409. The lease was cleared on success, so neither worker gets a second commit.                                                          |
| A stale worker reporting a _failure_ late                 | 409, and the finished import stays `ready_for_review` with no error — a stale failure would otherwise discard drafts already on screen. |
| An artifact uploaded under a lease that is then reclaimed | Stays `staging` with its expiry intact while the winning lease's artifact is committed `ready`; exactly one committed artifact row.     |

| Command                           | Observed output                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm test` (whole workspace)     | **Exit 0**: contracts 191, api **611**, web 194, ui 7. Run with the stack stopped. |
| `uv run pytest` (worker)          | **459 passed** in 64.74s, including 9 new tests driving a real Chromium.           |
| `uv run ruff check .` / `--check` | `All checks passed!`; `99 files already formatted`.                                |
| `uv run mypy` (worker)            | `Success: no issues found in 98 source files` (strict).                            |
| `pnpm typecheck` / `pnpm lint`    | **Exit 0** across all five projects.                                               |
| `pnpm contracts:check`            | **Exit 0.** `generated artifacts are up to date (149 files)`.                      |
| `fixtures/verify.py`              | `46/46 checks passed`, including the byte-identical determinism check.             |
| `npx prettier --check .`          | `All matched files use Prettier code style!`                                       |

What this does **not** do. The Greenhouse confirmation adapter is tested against
`fixtures/ats-pages/greenhouse-confirmation.html` and has never read a real
Greenhouse confirmation page, because reaching one means submitting a real
application — so the support matrix still says a fixture, not a board. The
adapter is deliberately conservative and will report `no_confirmation_found` on
a phrasing it does not know; that is the safe direction, since inventing a
confirmation records a submission that may never have happened. There is no UI
for any of this yet: the observation is reachable through the API only, and the
Tracker screen does not offer the button. And the runner never captures a
screenshot, because `consented_evidence_capture` defaults to false and nothing
yet asks the user to turn it on.

### AT21 and AT22: the daily budget, which was never enforced (verified 2026-09-21)

Closing AT22 turned out not to be a test-writing job. The budget was specified
everywhere and enforced nowhere.

`usage_ledger` had existed since migration `0001_foundation`, with a
`UsageLedgerEntry` contract to match, and **nothing ever wrote a row to it**.
`GET /me` read the table to report the day's usage, so the dashboard reported
zero requests and zero tokens permanently, whatever the user had spent. The
worker's `BudgetLedger` was real and well tested, but `build_budget` was called
_inside the handler_, so it was born at zero for every task and discarded with
the process: it could refuse a single request larger than the whole day's
allowance, and nothing else. A day of ordinary requests could never exhaust a
daily budget. `ai_requests_per_day` was editable on the Preferences screen and
shown on the Dashboard as "N of 50", and no code path read it.

So the scenario AT22 describes — "budget exhausted" — was unreachable in the
product as built, and the screen that reported the budget was reporting a
constant.

**What now exists.** Three internal routes (`POST
/internal/v1/tasks/:id/usage/reserve`, `.../usage/:reservation_id/settle`,
`.../release`) backed by `apps/api/src/usage/service.ts`. A reservation is taken
against the database before the request is sent, under a workspace advisory
lock so two workers cannot both read the same totals and both decide there is
room; it holds the estimate, so an in-flight request occupies budget rather than
being invisible; settling replaces the estimate with what the provider reported,
and reporting nothing leaves the estimate standing, because an unreported
request is not a free one. An unknown _price_ stays null throughout. The worker
reserves through `services/worker/src/job_getter_worker/usage.py`, which keeps
the process's own environment caps in force as the stricter of the two bounds.

A refusal is **409, not 429**: the worker's API client treats 429 as a transient
rate limit and retries it with backoff, which would spend the task's attempts
against a wall that does not move until the day's requests age out.

| Check (live, on the Compose stack)                                                                 | Observed output                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /me` before any reservation                                                                   | `ai_requests_today: 0`, limit `50` — the shipped default, because nothing had ever recorded usage.                                         |
| Set `ai_requests_per_day` on the Preferences route                                                 | `GET /me` then reported the **workspace's** limit rather than the default. Before this change it reported 50 whatever the user had chosen. |
| Three separate leased tasks, each reserving 500 tokens                                             | 201, 201, then **409 `BUDGET_EXHAUSTED`**. The day accumulates across processes, which is the whole point.                                 |
| The refusal's status                                                                               | 409 with no `Retry-After`, so the worker's transient-retry path is never entered.                                                          |
| Settle with 380/90 against a 400/100 reservation                                                   | 200; `measured_cost: null`, `cost_is_unknown: true`. Unknown price, not zero.                                                              |
| `GET /me` afterwards                                                                               | `ai_requests_today: 2`, `input_tokens_today: 780`, `output_tokens_today: 190`, cost `null`. Real numbers for the first time.               |
| With the budget spent: jobs, profile, preferences, providers, applications, a part-reviewed import | All **200**.                                                                                                                               |
| With the budget spent: `PATCH /profile` by hand                                                    | **200.** Manual editing is not inference and is not gated by an AI budget.                                                                 |
| With the budget spent: `POST /workspace/export`                                                    | **202.** Taking your data out is never held hostage to a spending cap.                                                                     |
| Release a reservation                                                                              | 204; `ai_requests_today` dropped back by one and the next reservation succeeded.                                                           |
| A stale lease token                                                                                | **409**, and no ledger row written.                                                                                                        |

The worker half was run from inside the worker container, through the real
`TaskApiClient` against the running API — the wiring neither test suite can
prove alone, since the worker tests match URLs the client builds and the API
tests inject URLs the routes declare:

| Check (live, from the worker container) | Observed output                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `reserve_usage` with the budget spent   | Raised `BudgetExhaustedError`, `retryable=False`, carrying the API's message about review and export still working. |
| `reserve_usage` with room in the day    | `reserved_tokens: 300`; then `settle_usage` returned 240/44 with `cost_is_unknown: true`; then `release_usage` 204. |

| Command                           | Observed output                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm test` (whole workspace)     | **Exit 0**: contracts 191, api **594**, web 194, ui 7. Run with the stack stopped. |
| `uv run pytest` (worker)          | **450 passed** in 39.85s.                                                          |
| `uv run ruff check .` / `--check` | `All checks passed!`; formatting clean.                                            |
| `uv run mypy` (worker)            | `Success: no issues found in 96 source files` (strict).                            |
| `pnpm typecheck` / `pnpm lint`    | **Exit 0** across all five projects.                                               |
| `pnpm contracts:check`            | **Exit 0.** `generated artifacts are up to date (145 files)`.                      |
| `npx prettier --check .`          | `All matched files use Prettier code style!`                                       |

What this does **not** do. The ledger is a rolling 24-hour window, not a
calendar day, so "resets at midnight" is not what happens and the messages do
not claim it does. The cost cap is still only enforceable with a rate card
configured; without one the token and request caps carry it, and the cost is
reported as unknown. Nothing sweeps a reservation whose worker died before
settling or releasing it: it stands against the day until it ages out of the
window, which over-counts rather than handing out budget twice, but it does
over-count.

### AT28: no AI configured, and the tracker entry that could not be finished (verified 2026-09-22)

Run on a **fresh** installation rather than the owner's: a second Compose
project (`jg-at28`) with its own database and files volumes and its own
network, published on `127.0.0.1:3100`. It started from `setup`, with no
`provider_settings` row and `PROVIDER_DEFAULT=none`. Images were rebuilt from
this commit first. The two scripts that drive it live under `.local/at28/`.

The first attempt to start that project was **not isolated**, and it matters
for whoever does this next. `docker-compose.yml` names its network
`job-getter`, so a second project joins the owner's network rather than
getting its own: two containers answered to `db` and two to `api`. The
sandbox API resolved `db` to the owner's database, and a sandbox login reached
the owner's API, which refused it (403, wrong origin). The sandbox was stopped
within minutes. Both databases were then checked: the owner's showed nothing
written in that window except the shared worker heartbeat, and the sandbox's
held only its migrations. A second project needs its network renamed as well
as its volumes.

| Path                                   | Observed                                                                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No provider                            | `ai_provider_configured: false`; `GET /settings/providers` answers `none`; the Dashboard shows "AI provider configured — Unavailable".                                                                                                              |
| Profile by hand (API)                  | One `PATCH /profile` stored six confirmed facts: contact, summary, experience, two skills and work authorization.                                                                                                                                   |
| Profile by hand (browser)              | Add Skill → Skill name → Confirm → Save; the skill appears on the page.                                                                                                                                                                             |
| CV import without a provider           | `parse_profile` **succeeded** with no drafts and a `NO_PROVIDER_CONFIGURED` warning that says the text was read and facts can be entered by hand. It does not fail.                                                                                 |
| Job import (API and browser)           | Pasted text with and without an apply URL: `fetch_job` succeeded both times, and the browser's import panel reported "Job imported".                                                                                                                |
| Fit check                              | `match_job` succeeded and scored 83. `ai_requests_today` stayed at **0** for the whole run.                                                                                                                                                         |
| Tracker, the packet path               | An original-mode CV (no AI), a packet, an approval, then `submitted` and `interview` recorded as `user_report`. History: created → packet_created → packet_approved → submitted → outcome_recorded.                                                 |
| Tracker, an application made elsewhere | **409 before this change:** "An application cannot move from draft to submitted". **After:** 200, badge "Submitted — reported by you", from the API and from the Tracker screen, for a pasted job with no apply URL that could never have a packet. |

Result: 27/27 API checks and 8/8 browser checks on a clean sandbox after the
fix. Before the fix it was 26/27, and the one failure was the tracker row above.

**The gap, and the fix.** A tracker entry starts as `draft`, and `draft` could
only move to `preparing` or `cancelled`. Recording `submitted` needed a packet,
a packet needs an https apply URL, and a pasted job without one never gets
one. So someone who applied by email could track the job but never say they
had applied. The spec expects this case: 07_APPLICATION_AUTOMATION.md, "Manual
tracker entries use evidence_type user_report and remain visibly labeled". The
change is one edge in `APPLICATION_TRANSITIONS`, `draft → submitted`. It does
not get around approval: approval guards what the product sends, and on this
path the product sent nothing. The only route that records the edge already
refuses `adapter_observed` from a session and `none` for a submission, so it is
always `user_report`. The outcome→status map moved into the contract as
`APPLICATION_OUTCOME_STATUS`, so the Tracker now offers only outcomes that are
legal from each row's status. A draft shows "I submitted it" and "Cancel";
before, it offered all eight and seven of them answered 409. A finished
application shows no form.

Tests: `pnpm typecheck`, `pnpm lint`, `pnpm contracts:check` and Prettier all
clean. Contracts 191/191, web 218/218 and api 614/614, the full suites, with
the stacks running.

What this does **not** cover. The worker and the API still read "is a provider
configured" from two different places (`PROVIDER_DEFAULT` and the workspace's
`provider_settings` row), so they can disagree once someone configures one.
AT28 is the none/none case, where they agree. `capabilities.cv_generation` and
`capabilities.applications` are still hard-coded `false` in `GET /me`, although
both features exist; no screen reads them.

### AT25: backup, restore to a separate installation, and the ledger (verified 2026-09-22)

The first time `scripts/backup.sh`, `scripts/restore.sh` and `scripts/migrate.sh`
had run against anything. Nothing touched the owner's installation. The
scripts reach the right stack through `COMPOSE_PROJECT_NAME`, which plain
`docker compose` honours, so they needed no change to target a sandbox.

**Isolation first.** `docker-compose.yml` used to fix its volume names
(`job-getter-db-data`, `job-getter-files-data`) and its network name
(`job-getter`). A second project therefore shared the owner's data or network
unless an extra override renamed all three, which is how AT28's first attempt
reached the owner's database. The names are now `${COMPOSE_PROJECT_NAME}-db-data`
and so on. Compose fills that variable in from `-p` as well as from the
environment, which was checked with `docker compose config` before relying on
it. For the default project they resolve to exactly the old names, and
`docker compose up --dry-run` plans the same actions for the owner's stack
before and after the change. Both sandboxes below ran with no extra override
file. `getent hosts db` inside each API resolved to its own database, and each
network held only its own four containers.

**The run.**

| Step                                             | Observed                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Populate the source (`-p jg-at25`, port 3200)    | Fresh setup, then through the API: six confirmed profile facts with non-ASCII text, an uploaded CV, two imported and scored jobs, a tailored CV rendered to PDF and DOCX and approved, three stored answers, an application with a packet, an approval, `submitted` and `interview`, a manual tracker entry `submitted`, and a workspace export. |
| Snapshot                                         | The API's view of the profile, every job, every application with its packet and full event history, the answer bank and both resumes, plus the SHA-256 of what each of the four files downloads as.                                                                                                                                              |
| `backup.sh --gpg-recipient` (api/worker stopped) | 11 s. `stack_quiesced: true`, 4 files, gpg-encrypted to a throwaway key.                                                                                                                                                                                                                                                                         |
| Separate target installation                     | A git worktree with its own `setup.sh`-generated `.env`: a different `SESSION_SECRET` and `SETUP_TOKEN`, and the source's `ENCRYPTION_KEY` copied in as the documented procedure says. `-p jg-at25-target`, port 3300.                                                                                                                           |
| `restore.sh --drop-existing`, then `migrate.sh`  | 18 s. Checksums matched, "ENCRYPTION_KEY matches", 31 tables, 4 of 4 files. Migrate: "Schema is up to date (9 migration(s))".                                                                                                                                                                                                                    |
| Compare                                          | **6/6.** The owner logs in with the source password. No field differs between the two snapshots. The export and the uploaded CV download byte-identical to their recorded hashes, and the CV also to the fixture file on disk. The approved packet's `approved_hash` equals its `content_hash`.                                                  |
| The restored target keeps working                | A new job import and a re-score of a restored job both succeed.                                                                                                                                                                                                                                                                                  |
| Ledger: delete after the backup                  | An answer deleted on the source (one `answer_bank` ledger row). The same, older backup restored over the source: "saved 1 deletion-ledger row(s) from the target", "merged", "reapplied (1 entries)". The answer **stayed deleted**; the only difference from the pre-backup snapshot is that answer.                                            |

The comparison was tested as well. With one event timestamp and one profile
value altered in a copy of the snapshot, it failed as it should.

**Script fixes the run turned up.** `backup.sh`/`.ps1` wrote
`"deletion_ledger_included": false` with a note saying the ledger "does not
exist yet". It has existed since migration 0007, and every dump carries it.
The manifest now records whether the table was actually present (re-run:
`true`). `restore.sh`/`.ps1` said "pre-M4 schema" when the target database was
simply empty, and their help still said AT25 "needs M1–M4 features that are
not built". Both are corrected. `sh -n` and the PowerShell parser are clean on
all four scripts.

**What this does not cover.** `--age-recipient`, `backup.ps1` and `restore.ps1`
have never run, and neither has any host other than Windows with Git Bash. No
provider API key was stored, so decrypting one with a copied `ENCRYPTION_KEY`
is covered only by the fingerprint check. The timings are from a tiny
installation and do not validate the spec's recovery targets (at most 24 hours
of data loss, restore within 4 hours).

### AT26: deleting a workspace, and restoring over the deletion (verified 2026-09-22)

The deletion had never existed: the Privacy tab said "not built" and offered no
button. The spec's shape for it (`DELETE /workspace` → "deletion task; session
invalidated") needed one change of substance. A `tasks` row is workspace data,
so the deletion would erase the task describing it, and the user could not read
it anyway because their session is revoked first. The route answers with a
receipt from `workspace_deletions` (migration 0010) instead. Like the ledger,
that table is operator-global and has no foreign key. It holds an id, a state,
timestamps and a file count, and `GET /workspace/deletions/:id` reads it
without a session. `apps/api/README.md` records the departure.

**One product decision, made by the owner:** a local installation whose only
account is deleted goes back to first-run, so setup reopens. Setup still needs
`SETUP_TOKEN` and a local or private-network address. Until now setup closed
permanently, and deleting the owner row by any other route still does not
reopen it.

**Tests.** `apps/api/tests/workspace-deletion.test.ts`: 21 tests; see the AT26
row for what they assert. `apps/api/tests/db/schema.test.ts` gained five for
the receipt table: it survives the workspace, allows one erasure in flight,
ties `completed_at` and `failure_code` to their states, refuses free text, and
is classified operator-global. `apps/web/tests/workspaceDeletion.test.tsx`: six
tests. The button stays disabled until the localised word and a password are
in, and it sends `{confirm: true, password}` and never `logout`. A wrong
password keeps the page and clears only the password. The receipt page works
signed out, polls while `erasing`, and says plainly when erasure `failed`.
Full suites: contracts 192, api 640, web 223, ui 7, worker 471, all passing;
`pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm contracts:check`
clean.

**Live, on a throwaway Compose project** (`jg-at26`, ports 3200/3201). It ran
on API and web images built from this working tree and tagged `:at26` through
a scratch override file, so the owner's `:dev` images and stack were never
touched. `docker compose config` showed only `jg-at26` names first. The
migration applied `0010_workspace_deletion`. `.local/at25/at25.py populate`
filled it: six profile facts, an uploaded CV, two scored jobs, a tailored CV in
PDF and DOCX, three answers, two applications with seven history events, and an
export. That made one account and four stored objects. `.local/at26/at26.py`
then:

| Step                                          | Observed                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pair a runner; sign in a second browser       | The device's claim answers 204; the second session's `GET /me` is 200.                                                                                                                                                                                                                                                |
| Wrong password; no confirmation               | 403 and 400. Still signed in afterwards.                                                                                                                                                                                                                                                                              |
| `DELETE /workspace`                           | 202 `{"state":"completed","files_erased":4,"failure_code":null,"setup_reopened":true}`, 19 ms from request to completion; the session cookie cleared.                                                                                                                                                                 |
| Every way back in                             | Both sessions' `GET /me` 401; the device's claim 401; logging in again 401.                                                                                                                                                                                                                                           |
| The receipt, signed out                       | `GET /workspace/deletions/:id` returns the same object. It contains none of the email, "José", "Núñez", "Acme" or ".pdf". `GET /setup` says `setup_required: true`; `/deleted/<id>` serves the SPA.                                                                                                                   |
| Inside the containers                         | 0 files under `FILES_ROOT`, and the workspace directory itself is gone. 0 rows in `users`, `workspaces`, `files`, `sessions`, `paired_devices`, `application_events`, `answer_bank`, `profile_facts`, `audit_events`; no setup flag. What remains is one receipt row and one ledger row, identifiers and counts only. |
| API log                                       | Two lines about the deletion, carrying the receipt id and counts. No line mentions the email, the name or the employer.                                                                                                                                                                                               |
| Restore the backup taken just before deleting | `restore.sh --drop-existing --yes`: "saved 1 deletion-ledger row(s)", "reapplied (1 entries)", 4 files unpacked, then "deleted workspaces and files removed". Afterwards 0 users, 0 workspaces, 0 files on disk, setup open.                                                                                          |
| A surviving object is left alone              | An object planted under another workspace id survived both a second `restore.sh` run ("1 files remain") and the PowerShell block below.                                                                                                                                                                               |

**What the live run found.** `restore.sh` and `restore.ps1` put back the
stored files of anything deleted after the backup. `reapply-deletions.sql`
removed the rows, and its header said "the restore procedure's file step"
removed the objects, but no such step existed. Both scripts now remove every
object the ledger names once the volume is unpacked, and report the count that
remains rather than the count unpacked. `reapply-deletions.sql` now also removes
the owner account of a re-deleted workspace and reopens setup when no account
is left, because until then a restored installation kept the email address and
password hash of a deleted owner. Under Windows PowerShell 5.1 the PowerShell
version first did nothing at all: 5.1 prefixes text piped to a native program
with a UTF-8 byte-order mark, so the first path failed the UUID check. It now
strips those bytes, and the block, run by itself under 5.1, removed the deleted
workspace's object and kept the other. The rest of `restore.ps1` stops earlier
on 5.1 (see "Backup and restore are incomplete by design").

**What this does not cover.** No browser has rendered the Privacy form or the
receipt page; both are covered by component tests only. The retry of a failed
erasure ran in tests, not live. So did the hosted rule that setup stays closed.
A deletion's receipt does not survive a restore of an older backup.

### M5 end to end: the extension fills a form in a real Chrome (verified 2026-09-22)

The first time this product has filled a form from a browser extension.
`.local/e2e-m5.py` seeds an approved application through the API, pairs a
device of kind `extension`, launches Chromium with `apps/extension/dist`
loaded unpacked, and drives the whole flow. **16 of 16 checks passed.**

| Step                               | Observed                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The extension loads                | Service worker started; extension id assigned.                                                                        |
| The token is stored                | In `chrome.storage.local`, which the page cannot see at all — asserted from the page's own context.                   |
| The fill                           | `{ ok: true, message: "Filled what the packet answers. Some questions still need you." }`                             |
| On the page                        | `first_name: Ada`, `last_name: Lovelace`, `email: ada@example.invalid` — typed into a real form by a real browser.    |
| **Gender**                         | Left at "Please select". The `never_reuse` rule, working on a real page rather than in a unit test.                   |
| Phone, cover letter, referral code | Left empty: the packet has no answer for them, so they are unresolved questions rather than guesses.                  |
| The API afterwards                 | `needs_input`; history `… packet_approved → fill_requested → fill_paused`, the same events the desktop runner writes. |
| Submit                             | Never pressed. The page did not navigate, and the button is still sitting there in the screenshot.                    |

The screenshot is `.local/screenshots/m5-extension-filled.png`.

**AT24, performed rather than asserted.** With the extension loaded and the
page filled, the page was made to attack it. It knows the extension id — that
is in the URL of every injected resource — and `chrome.runtime.sendMessage`
to it **did not arrive**: the extension declares no `externally_connectable`,
so a web page has no `chrome.runtime` to call in the first place. A forged
`window.postMessage` carrying a well-formed `page/fill` command naming
`#first_name` and the value `ATTACKER` changed nothing, because there is no
`window` message listener for it to reach. The field still read `Ada`.

**One real defect found, in the product rather than the harness.** The fill
resolved its target as "the active tab, now". Those are two different moments:
a person can open the popup over an employer's form, switch tabs, and come
back to click — and the fill would then act on whatever is in front of them.
The popup now resolves the tab once, as it renders, and says which tab it
meant. The bug was invisible to every test and to casual use, and showed up
only because a browser harness has to name the tab explicitly.

**Two things the run also established, neither of them pleasant.** The API
registers no CORS plugin anywhere, deliberately — "never expose a wildcard
CORS policy with credentials" — so a browser refuses to hand any other origin
the response, and an extension is no exception. The extension therefore needs
**one host permission for the user's own installation**, which it now requests
at pairing time through `optional_host_permissions` rather than declaring
up-front: it ships with host access to nothing. And the API container was
running an image built before M5, so the first run answered `Not found.` to
every `/fill-sessions` call. Rebuilding it applied `0011_fill_sessions` on the
real stack.

**Two sandbox shortcuts, both named so nobody mistakes them for the product.**

1. The job's `apply_url` is written straight into `job_sources` with `psql`,
   because the importer refuses a loopback, non-https apply URL by design
   (AT20) and a local fixture page is exactly such a URL. This is the same
   shortcut `.local/e2e-m4.sh` takes, for the same reason. Everything
   downstream of that row is the real product.
2. The run loads a copy of `dist` whose manifest declares the two host
   permissions outright. `chrome.permissions.request` refuses to run outside a
   user gesture and raises a native Chrome bubble no automation can click, so
   what is skipped is the **prompt**, not the fetch. **The permission flow
   itself remains unexercised.**

**What this still does not show.** No live employer's board: this is the
synthetic fixture, served from 127.0.0.1. The CV is not attached — the file
input is visibly empty in the screenshot, reported as an unresolved question,
and the person attaches it themselves. Pairing, the application id and the
packet hash are all pasted by hand. Only Greenhouse, and only one page shape.

### M5: the extension, and one fingerprint across two DOM engines (verified 2026-09-22)

The extension now exists. `apps/extension/` was an empty directory this
morning; it is now a Manifest V3 package that builds into something
`chrome://extensions` can load. It has still never been loaded.

The hazard worth naming first, because it shaped everything else. Both clients
fill the same packets: the Python desktop runner reads an employer's form
through Chromium, and the extension reads it through its own content script. A
packet records the **form fingerprint** it was approved against, and an
approval is withdrawn when the live schema no longer matches. So if the two
implementations digest one page differently — one extra field, one different
required flag, one option read with a stray space — every packet approved
through one client reads as stale to the other. Silently, on a real employer's
page, at the moment someone is trying to apply.

That is closed by pinning, in two layers.

| Layer        | What is pinned                                                                                                                                      | Asserted by                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The planners | Key normalisation, sensitivity classification, the fingerprint material and digest, field parsing, identity checking, and every branch of the plan. | `fixtures/fill-planner/vectors.json` — **84 TypeScript cases** and **84 Python**, both reading the one file.                          |
| The readers  | What a browser actually sees on the synthetic Greenhouse page: the rows, the keys, the fingerprint.                                                 | `fixtures/fill-planner/greenhouse-page.json`, recorded from **Chromium**; jsdom must reproduce it and Chromium must still produce it. |

**jsdom and Chromium agree, byte for byte**, on `v1:1d8d820a24ed1f1f5516e6301e6a5fd4`
for `greenhouse-application.html` and a different digest for the "changed"
fixture. That agreement is now a test on both sides rather than a hope.

| Command                                              | Observed output                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @job-getter/fill-planner test`        | **84 passed** — the TypeScript half of the parity vectors.                                      |
| `pnpm --filter @job-getter/extension test`           | **39 passed** across 4 files (messages, session, greenhouse, parity).                           |
| `services/worker`: `uv run pytest`                   | **555 passed** (was 471; `test_planner_parity.py` adds 84, two of which drive a real Chromium). |
| `pnpm --filter @job-getter/api test`                 | **667 passed**, unchanged.                                                                      |
| `pnpm --filter @job-getter/web test`                 | **225 passed**, unchanged.                                                                      |
| `pnpm --filter @job-getter/extension build`          | `dist/` with `manifest.json`, `background.js`, `content.js`, `popup.html` — loadable unpacked.  |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | **Exit 0** each.                                                                                |
| `fixtures/verify.py`                                 | **55/55**, including the determinism check over the new fixture files.                          |

**Where the credentials live.** The device token and the session nonce are in
the service worker, in `chrome.storage.local`, which no page and no content
script can read. The content script holds nothing, because it shares a DOM
with the employer's page and with everything that page loaded — anything it
held, the page could eventually reach. It also _decides_ nothing: matching an
answer to a control happens in the shared planner, so there is no second
implementation of the exact-match rule for a page to confuse.

**Two build defects found and fixed before they could ship.** The first build
emitted `content.js` starting with `import{…}from"./greenhouse.js"`. A content
script injected with `chrome.scripting.executeScript` is evaluated as a
_classic_ script with no module loader, so that file would have failed at
runtime — on the employer's page, which is the least visible place a failure
can happen and the only place it would have occurred. The content script is now
built by a second Vite pass as a self-contained IIFE, asserted by reading the
built file. The second was smaller: `manifest.json` was not in `dist/` at all,
so nothing was loadable.

**One honest weight, not fixed.** `background.js` is ~104 kB because importing
two header constants from `@job-getter/contracts` pulls the whole barrel, whose
top-level `registerContractFormats()` defeats tree-shaking of TypeBox. Copying
those two strings by hand would be exactly the parallel-definition this
repository forbids, so the weight stays until the contracts package grows a
side-effect-free subpath.

**What this does not do.** It has never been loaded in a browser and has never
filled a form. The CV is not attached: the grant names the file and its digest,
but fetching the bytes needs a session-scoped download route that does not
exist, so the file input is reported unresolved and the person attaches it —
the documented fallback, not a silent failure. Pairing is a token pasted by
hand, because the extension cannot call `/devices/exchange` itself; the
application id and packet hash are pasted too. Only Greenhouse, and only
against a fixture: **no adapter has met a live board in either client.**

### M5: scoped fill sessions (verified 2026-09-22)

The first slice of M5, and deliberately the least visible one: the credential
the browser extension will fill with, built and tested before anything can
hold it. 07_APPLICATION_AUTOMATION.md fixes its shape exactly — "the session
binds device_id, tab origin, application_id, packet_hash, nonce and ten-minute
expiry" — so the table and the four handlers are that sentence, enforced.

| Command                                                                     | Observed output                                                                                                                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @job-getter/api test`                                        | **32 files, 667 tests passed** (was 640; `tests/fill-sessions.test.ts` adds 27).                                                                                       |
| `pnpm --filter @job-getter/api exec vitest run tests/fill-sessions.test.ts` | **27 passed.**                                                                                                                                                         |
| `pnpm contracts:generate` / `contracts:check`                               | `wrote 151 generated files`; the drift gate passes. The OpenAPI document, the generated TypeScript client and the Python enums and constants all carry the new routes. |
| `pnpm --filter @job-getter/contracts test`                                  | **192 passed.**                                                                                                                                                        |
| `services/worker`: `uv run pytest`                                          | **471 passed.** The regenerated Python contract module still matches.                                                                                                  |
| `pnpm --filter @job-getter/web test`                                        | **225 passed.**                                                                                                                                                        |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check`                        | **Exit 0** each.                                                                                                                                                       |

**What a session is.** One approved packet, one paired device of kind
`extension`, one tab origin, one packet content hash, one nonce, ten minutes,
spent once. Four of those rules are in `0011_fill_sessions.sql` rather than in
a handler, because each is a rule a rewritten handler could forget: the origin
is `NOT NULL` and must be an `http(s)` origin with no path; the nonce is stored
only as a SHA-256 digest; a partial unique index allows one live session per
application; and `ended_at`/`ended_reason` are both present or both absent, so
a finished session can always be explained to the person whose application it
touched.

**The first `auth: 'device'` route in the product.** `AuthMode` has had
`'device'` in the contract since M0 and no route had ever used it, so
`buildPreHandler` authenticated nobody for it. It now has the branch: a device
route consults `x-device-token` and never the cookie, and a session route
never consults the header. A route that accepted either would be a route where
the weaker credential silently sufficed. These routes live on `/api/v1` rather
than `/internal/v1` for a concrete reason: nginx deliberately does not proxy
`/internal/` to a browser (10_DEPLOYMENT.md), so the path the local runner uses
is unreachable from an extension by design.

**Shared with the runner, not parallel to it.** The preconditions for filling
— approved status, current packet, freshness recomputed now, no unanswered
required question, never after an `outcome_unknown` — moved into
`apps/api/src/applications/fillable.ts` and both clients call it. The moment
those two lists differ, one client is filling something the person did not
approve. The reported outcome maps to the same states, the same `fill_paused`
event and the same reasons the local runner produces, so the application's
history does not record which client typed into the form as though it were a
different kind of event.

**AT23, both halves.** Revoking the device denies its next request, which the
M4 tests already covered. What is new is the second half of the scenario, "no
new packet access": revocation now ends the device's live fill sessions in the
same transaction, with `ended_reason = 'device_revoked'`. Without that, a
session would outlive the credential that obtained it by up to ten minutes,
which is precisely the access the scenario forbids.

**AT24, the API half.** Three refusals, asserted separately because they fail
differently. A page riding the victim's session cookie gets 401, because these
routes take a device token and the token lives in a service worker page
scripts cannot reach. The grant carries no profile and no secret — asserted on
the serialised body. And the destination comes from the approved packet: an
attempt to supply one is a 400 from the closed contract, not a quietly ignored
field, because ignoring it would look identical to honouring it.

**What this does not do.** It does not fill anything. `apps/extension/` is
still an empty directory: no manifest, no service worker, no content script, no
packaged adapter. Nothing has held one of these tokens outside a test, no
session has been created by a browser, and the CV-download and
form-schema-report paths a real extension needs are specified by these routes
but unexercised by any client. The extension's own half of AT24 — a service
worker verifying message sender, tab and origin — does not exist.

### M1, M2 and M3 screens in a browser (verified 2026-09-22)

The M4 screens were rendered by a browser on 2026-09-21. The earlier ones never
had been: M1's row said the browser flow had not been exercised, M2's status
literally read "live UI walkthrough pending", and M3's said no browser had
rendered the CV studio. Every claim about those eleven screens rested on jsdom
against a fake client. `.local/screenshot-m1-m2.py` drives them with a real
Chromium against the running stack, signed in as the owner, on the owner's
populated database.

It asserts the four things jsdom structurally cannot, on each screen, in each
language:

| Check                             | Why jsdom cannot do it                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No raw catalogue key on the page  | The jsdom suite uses the real `t`, but its assertions are written against the same catalogue, so a key both sides agree is absent still matches. The walkthrough greps all 1,300+ keys against the rendered text. |
| No input displaying a non-value   | This is the M4 defect generalised: an answer box that showed the four characters `null`, which every jsdom test passed over. Every `input` and `textarea` value is read from the live DOM.                        |
| No console or uncaught page error | There is no console in jsdom worth the name, and a fake client cannot produce a real 4xx.                                                                                                                         |
| No horizontal overflow at 1280px  | jsdom has no layout at all.                                                                                                                                                                                       |

**The run.** 22 of 22 passed — eleven screens (Dashboard, Profile, Import
review, Discover, Jobs, Job detail, CV studio, Preferences, Provider, Tasks,
Diagnostics) in English and the same eleven in Spanish. Against real data:
**14 fact rows** on Profile, **24 job rows** on Jobs, and a provenance row on
Job detail under its real heading, "Where this job was seen". Full-page
screenshots are in `.local/screenshots/`.

**Spanish needed the switcher, not the browser locale — and finding that out
was worth the run.** The first pass launched Chromium with `locale=es-ES` and
produced Spanish output byte-identical to the English, which looked like a
passing i18n test and was in fact the locale never changing. `RequireAuth`
adopts the **workspace's** locale from the API after sign-in, and this
workspace is `en`. The documented order holds — an explicit choice in this
browser beats the workspace, which beats `navigator.language` — so the script
now selects Spanish in the Preferences switcher, the way a person would, and
asserts `<html lang>` flips and that each Spanish render differs from its
English one. Both are checked, because either alone would have passed while
the language silently did not change.

**Two false claims found, both now fixed.** Both were true when written and
became false when a later milestone landed. Neither could fail a jsdom test:
a test that asserts the copy passes whether or not the copy is true.

| Screen   | What it said                                                                                                             | Why it was false                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Jobs     | "Nothing has been matched against your profile yet — matching arrives in a later milestone."                             | M3 landed matching. The same screen was showing scores of 37, 73 and 62 out of 100.                                 |
| Settings | "…data export and deletion arrive with later milestones. They are absent rather than shown as controls that do nothing." | M4 landed both. The note renders on every settings screen, the Privacy tab included — which is export and deletion. |

Both strings were corrected in `en.ts` and `es.ts`, and
`apps/web/tests/i18n.test.tsx` now pins them so a revert fails. The web image
was rebuilt and the walkthrough re-run: the claims are gone from the rendered
pages, and 22 of 22 still pass. `pnpm --filter @job-getter/web test` is
**24 files, 225 tests passed**; `pnpm typecheck` and `pnpm lint` exit 0.

**What this does not cover.** These are renders and reads, not journeys: the
walkthrough does not import a CV, run a scan, generate a document or save a
preference from the screen. The Import review screen was visited without a
parse task, so its draft-review step — the part of M1 that matters most — has
still not been seen in a browser. One viewport (1280×900) and one browser
engine. And it says nothing about whether a screen is _usable_, only that it
renders what it claims to.

### M1 and M2 re-verification for the status correction (verified 2026-09-21)

The PR01–PR03 rows had said "Not started", with notes claiming there was no
profile route and no profile page. Both have existed since M1. These runs are
the evidence behind moving those three rows to **Tested**, and behind giving
PR04 and PR05 a real status word instead of the "API + worker" annotation that
had drifted into their Milestone column.

| Command                                                                                                          | Observed output                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `vitest run tests/profile.test.tsx tests/import.test.tsx tests/preferences.test.tsx` (web)                       | **3 test files, 28 tests passed** in 7.13s.                                                |
| `vitest run tests/profile.test.ts tests/profile-imports.test.ts tests/settings.test.ts` (api)                    | **3 test files, 136 tests passed** in 34.46s: profile 18, profile-imports 30, settings 88. |
| `vitest run tests/jobs.test.ts tests/sources.test.ts tests/discovery.test.ts tests/scan-scheduler.test.ts` (api) | **4 test files, 66 tests passed** in 33.20s.                                               |

These ran with the Compose stack up; the API test files start their own
PostgreSQL containers, and none of the known interference appeared.

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

### Explicitly NOT verified (as of 2026-09-22)

This table lists what has **still** never been run. It is the counterpart of the
"Never executed" row in the Summary, and the two must agree. Six entries that
stood here until 2026-09-22 have since been run and were removed rather than
left to rot: `docker compose up --build`, the three image builds from
`infra/*.Dockerfile`, `scripts/smoke.sh` against a live stack (AT01),
`scripts/backup.sh` and `scripts/restore.sh` end to end (AT25 and AT26), and
`scripts/migrate.sh` (AT25). Their evidence is under "Verified commands".

| Command or behaviour                                   | Why not                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/dev.sh` / `scripts/dev.ps1`                   | Never run. Syntax-checked only. Every live run so far has gone through `docker compose`, so the hot-reload development path is unexercised.                                                                   |
| `scripts/smoke.ps1`                                    | Never run. Only the POSIX `smoke.sh` has been used against a live stack; the PowerShell port is unverified.                                                                                                   |
| `scripts/backup.ps1`                                   | Never run. AT25 used `backup.sh`.                                                                                                                                                                             |
| `scripts/restore.ps1` end to end                       | Never run as a whole. Its file-pruning block ran on its own under Windows PowerShell 5.1; the full script stops earlier on 5.1 — see AT26.                                                                    |
| `scripts/backup.sh --age-recipient`                    | Never run. Only the gpg and `--no-encrypt` paths were exercised by AT25.                                                                                                                                      |
| The `local-ai` Ollama profile                          | Never started. Its image is pinned by tag only (`TODO(digest)` in `docker-compose.yml`) because the digest could not be resolved before Docker Hub rate-limited this work.                                    |
| Any image build on a host **without** TLS interception | The Dockerfiles have been built, but only on this machine, which runs an intercepting proxy and so supplies the build-CA secret. The no-secret path is verified by construction only — the `if` is unentered. |
| macOS and Linux behaviour                              | Never run. Only Windows 11 + Docker Desktop has been used. `docs/spec/10_DEPLOYMENT.md` allows certifying one OS first provided the others are labelled unverified — they are.                                |
