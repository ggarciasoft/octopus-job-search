# `@job-getter/web`

React 19 + Vite 8 + Tailwind CSS 4 front end. **Milestones M0 and M1**: setup,
sign-in, the capability dashboard, the end-to-end diagnostics probe, the task
list, the profile (manual editing, draft-versus-confirmed facts), the import
review flow, and the preferences and AI-provider settings. Discover, Jobs, CV
studio, Applications and Tracker are still honest "not implemented" screens.

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
6. **No client-side JSON Schema validation.** `@sinclair/typebox` is not a
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
