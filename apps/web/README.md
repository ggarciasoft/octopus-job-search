# `@job-getter/web`

React 19 + Vite 8 + Tailwind CSS 4 front end. **Milestones M0 to M2**: setup,
sign-in, the capability dashboard, the end-to-end diagnostics probe, the task
list, the profile (manual editing, draft-versus-confirmed facts), the import
review flow, the preferences and AI-provider settings, and — M2 — the Discover
screen (board registry, scans, manual import) plus the Jobs list and job
detail. CV studio, Applications and Tracker are still honest "not implemented"
screens.

## Commands

```
pnpm --filter @job-getter/web dev        # Vite dev server, proxies /api to the API
pnpm --filter @job-getter/web typecheck
pnpm --filter @job-getter/web lint
pnpm --filter @job-getter/web test
pnpm --filter @job-getter/web build      # tsc --noEmit, then vite build into dist/
```

`@job-getter/contracts` and `@job-getter/api-client` must be built first
(`pnpm --filter @job-getter/contracts build`, then the client), because both are
consumed through their `dist` type declarations.

Configuration lives in `.env.example`. Nothing prefixed `VITE_` may hold a
secret: those values are inlined into the bundle.

## Rules this app is written to

These are not style preferences; they come from `docs/spec/`.

1. **No control that does nothing.** Invariant 10 of
   `00_AI_IMPLEMENTATION_INSTRUCTIONS.md`: "Never replace missing backend
   behavior with a button that reports success." Unbuilt milestones render
   `NotImplemented`, which contains no form, no input and no action. When the
   API reports a capability as absent (`profile_import: false`), the control
   that would use it is disabled with the reason next to it.
2. **No fabricated data.** An empty list says it is empty and suggests a next
   step; it never shows example jobs, matches or applications as if they were
   live results (`08_UX_AND_CUSTOMIZATION.md`).
3. **Report only what the API reported.** Capabilities, task states, progress,
   worker ids, error codes, upload validation and provider probe results are
   rendered from the response. An unmeasured cost reads "not measured", never
   `0`; a `null` probe field reads "not determined", never a pass; a skipped
   malware scan reads "not scanned", never "clean".
4. **The translation boundary.** `t()` is for UI chrome. User content —
   profile facts, source excerpts, extraction warnings' own text, the echoed
   diagnostic message — is rendered verbatim and never machine-translated
   (`src/i18n/index.ts`). Labels for closed contract enums (employment type,
   declared level, yes/no/unknown) are chrome and are translated.
5. **Preserve work on failure.** No form clears itself when a request fails, and
   the error notice says so. A `409 STALE_REVISION` shows the stale-revision
   message and a reload action that refreshes the server copy while the open
   form keeps what was typed.
6. **Draft is never fact.** An unconfirmed fact carries the shared
   "Ready for review" status badge (`FactStateBadge`); a confirmed fact carries
   a different badge. Import drafts start unaccepted and reach the profile only
   through an explicit accept, replace or keep-both choice (invariant 2).
7. **Unknown stays unknown.** Work authorization and sponsorship are two
   independent yes / no / unknown choices that start at "unknown"; skill
   proficiency has an explicit "not declared" option; preferences expose the
   sponsorship and unknown-eligibility policies as explicit choices.

## Layout

```
src/api/          client port, CSRF lookup, idempotency keys, error mapping,
                  field-error lookup for server-side validation messages
src/auth/         session context (GET /me), route guard
src/components/   shell, layout, capability panel, status legend, error UI,
                  FactStateBadge, StringListField
src/discovery/    M2: enum → label maps typed over the contract, freshness /
                  salary / import-result helpers, and the Discover panels
                  (boards + add form, scan status, manual import)
src/hooks/        useTaskPolling — 2 s active, 15 s idle, stops on terminal
src/i18n/         en/es catalogues, provider, Intl formatting
src/profile/      fact value helpers (defaults, client-side checks mirroring the
                  API), FactForm (typed form per kind), FactSummary, import
                  review decisions → confirm request, profile query hooks
src/routes/       one file per screen; settings/ holds the settings tabs
src/navigation.ts single source of truth for which screens are real
tests/            behaviour tests with a fake client, not mock restatements
```

## Session, CSRF and the API

The session is an **HttpOnly cookie** (`SESSION_COOKIE`) and is never read by
JavaScript. The only token this app reads is the deliberately non-HttpOnly
anti-CSRF double-submit token, in `src/api/csrf.ts`.

Both names come from `packages/contracts/src/http.ts` (`SESSION_COOKIE`,
`CSRF_COOKIE`, `CSRF_HEADER`), which `apps/api` imports too, so the two sides
cannot drift without a compile error. `setCsrfTokenFromSession()` remains for
the case where the API delivers the token in a response body instead; that value
takes priority over the cookie.

`JobGetterApi` (`src/api/client.ts`) is a `Pick` of the generated client, so a
contract change breaks the screens and the test fakes at compile time.

## Profile and import review (M1)

- **Profile** (`/profile`): contact block first, then every fact kind grouped.
  Every write is `PATCH /profile` with `expected_revision`; the response
  replaces the cached profile. Facts typed by hand default to confirmed (the
  user is the author, and the checkbox is visible); editing a stored draft keeps
  it a draft unless the box is ticked or "Confirm as accurate" is used.
  Client-side checks in `src/profile/factValues.ts` mirror the API's
  (`YYYY-MM` months, `current` excludes an end month, end never precedes
  start); the API's own field errors are attached to the same controls.
- **Import review** (`/profile/import`): file (checked in the browser for type
  and size before upload) or pasted text → `POST /files` with its validation
  block shown as reported → `POST /profile/imports` with one idempotency key per
  intent, reused on retry → `useTaskPolling` on the task → `GET
/profile/imports/:task_id` (the API resolves a task id) → per-draft review.
  `?task=<id>` in the URL resumes an in-flight or finished import. Conflicts show
  the confirmed fact and the draft side by side and require an explicit keep /
  replace / keep-both choice; "replace" sends `supersedes_fact_id`. Confirming
  with nothing accepted asks first, because it discards every draft.
- Enum option lists in forms are read from the contract schemas at runtime
  (`literalOptions`), so no select carries a hand-written copy of an enum.

## Settings (M1)

- **Preferences** (`/settings/preferences`): every field of the contract's
  `Preferences`. The weights editor shows the live sum and disables saving unless
  it is exactly 100; pilot defaults are printed under each operational limit;
  salary is explicit about currency and period and says no conversion happens;
  the prompt suffix is labelled style-only. Unknown keys rejected by the API are
  listed verbatim in the error notice; known keys attach to their control.
- **Provider** (`/settings/provider`): provider, model, base URL, a write-only
  API key field that is never prefilled (the API only reports `api_key_set` and
  a mask), limits, and an optional rate card with the copy that without one cost
  is unknown — not zero — and a cost budget is unenforceable. When the saved
  provider reports `sends_data_externally`, a prominent notice says task input
  leaves the machine. "Test connection" calls the probe and renders `null`
  fields as "not determined".
- Scan schedules, devices, export and deletion are listed as missing on the
  settings layout rather than shown as controls.

## Discover and Jobs (M2)

- **Discover** (`/discover`): the board registry, "Scan now", one followed
  scan and manual import, under a coverage note that says scans read only the
  boards registered here and the URLs you import — nothing searches the whole
  internet (`01_PRODUCT_REQUIREMENTS.md`, "Explicit boundaries"). When `GET /me`
  reports `job_discovery: false`, every control is disabled with the reason.
  - _Boards_: connector, key, health badge (`SourceHealthState`, its own tone
    per state — `unknown` never reads as healthy), the health detail and last
    error code verbatim, last success, next scheduled scan, job count.
    "Scan now" is disabled with the reason next to it (`aria-describedby`) when
    the board is disabled or `blocked`; a blocked board offers "Re-enable",
    which is the API's own way of clearing a block. Scanning uses one
    `IdempotentIntent` per board, so a retry reuses the key. Delete asks first
    and says jobs and provenance are kept.
  - _Add a board_: connector select from `BOARD_CONNECTOR_IDS`, the board key
    checked against the contract's own pattern, per-connector help saying where
    the Greenhouse token / Lever slug is found and that only public boards
    work, and a Lever-EU toggle that sends `base_url: https://api.eu.lever.co`
    (the API's allow-listed regional endpoint) — no free-form URL.
  - _Scan status_: `GET /scans/:id` with the task id `scanSource` returned (or a
    board's `last_scan_id`), polled at the active cadence while queued/running.
    A `partial` scan says in words that **nothing was closed because of it**.
    One exception, from a live run: a re-scan the board answered with HTTP 304
    is stored as `partial` with `complete_snapshot: false` and zero counts;
    the panel reads the scan's task (`getTask(task_id)`) and, when its result
    carries a `NOT_MODIFIED` warning, renders "Unchanged since the last scan"
    with the board's job count instead of the partial alarm
    (`presentScan()` in `src/discovery/presentation.ts`). Until the task has
    been read, neither message is shown.
  - _Manual import_: URL **or** pasted description (the body is built from the
    selected mode, so both can never be sent), optional company / title /
    apply URL hints, one idempotency key per intent, then `useTaskPolling`.
    The task result is read defensively (`readImportOutcome`): a created job
    links to its detail; several candidates render a chooser whose choice is a
    second `importJob` by that posting's `canonical_url` under a new key; a
    refusal (`BLOCKED_DESTINATION`, `ROBOTS_DISALLOWED`, `ACCESS_DENIED`,
    `RATE_LIMITED`) is stated plainly and offers paste mode — never a way around
    the refusal; a failed task shows its real code and message; a queued task
    with `worker_online: false` says it will not run.
- **Jobs** (`/jobs`): filters (query, status, saved, show excluded — the
  contract's `min_score` and `eligible` are deliberately not offered, because
  no match exists before M3 and a filter that can only return nothing is not a
  control), then company / title, locations and work arrangement, employment
  type, salary, status, freshness, match, provenance count and save. Salary is
  the posting's own numbers, currency code and period, or the **"Salary
  unknown"** badge; nothing is converted. Freshness flags a job whose
  `last_fetched_at` is older than `CLOSURE_RULES.recheckBeforePacketHours`
  (or absent) with "may be stale — recheck before applying". The match column
  reads **"Not checked"** from the shared status vocabulary for every job:
  `match` is `null` until M3 and is never shown as a score or a zero. The
  empty state suggests adding a board, running a scan and relaxing the filters,
  and contains no rows.
- **Job detail** (`/jobs/:id`): status, save / mark closed (both with
  `expected_revision`; a 409 shows the stale-revision message and a reload that
  refreshes the server copy while the open dialog and the page stay as they
  were), provenance with `rel="noopener noreferrer"` links, locations with
  their excerpts, eligibility (`null` → "Not stated — do not assume
  eligibility"), salary as stated, requirements grouped required / preferred /
  unknown each with its evidence excerpt in a native `<details>` disclosure,
  **inferred fields listed explicitly with the excerpt each was inferred from**
  (in practice `remote_type` and `eligible_countries` are inferred from prose,
  so this is how a user checks the system did not invent eligibility), the
  description as plain text (an HTML string is displayed, never rendered),
  possible duplicates with links, and freshness. "Prepare application" is
  stated as absent (M4); no button exists that could look like it prepares one.
  An empty `requirements` list is a normal outcome — extraction relies on
  explicit section headings — and reads "No requirements were extracted — read
  the description", never as "no requirements".
- Every closed enum of the discovery contract (`SourceHealthState`,
  `ScanStatus`, `JobStatus`, `RemoteType`, `FetchWarningCode`,
  `InferredField.field`, requirement kinds, duplicate reasons, connectors) has
  human copy in both catalogues through total `Record<Enum, MessageKey>` maps
  in `src/discovery/labels.ts`, so a new contract member is a compile error
  here until it is explained.

## Known limitations

These are real gaps, not oversights. Each one is handled honestly in the UI
today; remove the entry when the underlying cause is fixed.

1. **`Retry-After` is not surfaced on a 429.** `ApiError` carries `code`,
   `message`, `fields`, `requestId` and `status`, but no response headers, so
   the app cannot quote the server's retry delay. The sign-in screen therefore
   says "wait about a minute … further attempts may extend the wait" instead of
   a specific time. When the generated client exposes headers, replace that copy
   (`login.rateLimited` in both catalogues) with the real value.
2. **No `eslint-plugin-react-hooks`.** It is not in the workspace dependency
   set, so `eslint.config.js` has no rules-of-hooks or exhaustive-deps checking.
   Dependency arrays here are maintained by hand and by review. Add the plugin
   and `reactHooks.configs['recommended-latest']` when the lock file gains it.
   `@testing-library/jest-dom` is absent for the same reason, which is why the
   tests assert with `toBeTruthy()` and `getAttribute()` rather than
   `toBeInTheDocument()`.
3. **The interface language is stored per browser, not per account.** The route
   manifest has no way to update the workspace locale, so `LocaleSwitcher`
   persists to `localStorage` and says so in its own description. The locale
   reported by `GET /me` is adopted only when the user has not chosen one here.
   Nothing reports the preference as saved to the server, because it is not.
4. **The external-data notice follows the saved provider.** `sends_data_externally`
   is computed by the API and returned on GET/PUT, so the prominent notice
   reflects the stored provider, not an unsaved selection. The option label and
   description for `openai_compatible` say it sends task input externally, so
   the user is told before saving as well.
5. **Provider "Test connection" probes the saved settings.** The route takes no
   body, so unsaved edits cannot be tested; the screen says so whenever the form
   is dirty.
6. **The scan panel follows one scan at a time, and only ones it can name.**
   The contract declares no scan list, so the panel can follow the task id
   `scanSource` just returned or a board's `last_scan_id`; a scan queued by
   the scheduler is reachable only once it becomes the board's last scan.
7. **Scan warnings come from the task, not the scan.** `ScanView` carries only
   `error_code`/`error_message`; the fetch warnings (including the
   `NOT_MODIFIED` that distinguishes "unchanged" from "partial") are read from
   `getTask(task_id)`. If that read fails, the generic partial copy is shown.
8. **No client-side JSON Schema validation.** `@sinclair/typebox` is not a
   dependency of this app, so fact and preference values are checked with the
   small hand-written rules in `src/profile/factValues.ts` (mirroring the API's
   `facts.ts`) plus the server's own field errors. The API remains the authority.

## Task polling

`src/hooks/useTaskPolling.ts` implements step 8 of the data flow in
`02_ARCHITECTURE.md`: poll every 2 s while a task is active, back off to 15 s
while idle. It stops on a terminal state, on unmount and while the tab is hidden
(Page Visibility API), and it aborts the in-flight request on unmount. The tasks
list and the import review reuse the same hook and `pollIntervalFor()`, so the
two cadences exist once.

## Adding a screen when its milestone lands

1. Flip `available` in `src/navigation.ts` and remove its `missingKey`.
2. Register the real route in `src/App.tsx`.
3. Add the keys to **both** `src/i18n/en.ts` and `src/i18n/es.ts` — the Spanish
   catalogue is typed `Record<MessageKey, string>`, so a missing key will not
   compile.
4. Extend `JobGetterApi` in `src/api/client.ts` with the routes you now call,
   and `createFakeApi` in `tests/helpers.tsx` with a default for each.
