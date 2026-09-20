# `@job-getter/web`

React 19 + Vite 8 + Tailwind CSS 4 front end. **Milestone M0 only**: setup,
sign-in, the capability dashboard, the end-to-end diagnostics probe and the task
list. Everything else in the navigation is an honest "not implemented" screen.

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
   `NotImplemented`, which contains no form, no input and no action.
2. **No fabricated data.** An empty list says it is empty and suggests a next
   step; it never shows example jobs, matches or applications as if they were
   live results (`08_UX_AND_CUSTOMIZATION.md`).
3. **Report only what the API reported.** Capabilities, task states, progress,
   worker ids and error codes are rendered from the response. An unmeasured cost
   reads "not measured", never `0`.
4. **The translation boundary.** `t()` is for UI chrome. User content — the
   echoed diagnostic message today, profile facts and job text later — is
   rendered verbatim and never machine-translated (`src/i18n/index.ts`).
5. **Preserve work on failure.** No form clears itself when a request fails, and
   the error notice says so.

## Layout

```
src/api/          client port, CSRF lookup, idempotency keys, error mapping
src/auth/         session context (GET /me), route guard
src/components/   shell, layout, capability panel, status legend, error UI
src/hooks/        useTaskPolling — 2 s active, 15 s idle, stops on terminal
src/i18n/         en/es catalogues, provider, Intl formatting
src/routes/       one file per screen
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

## Known limitations (M0)

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

## Task polling

`src/hooks/useTaskPolling.ts` implements step 8 of the data flow in
`02_ARCHITECTURE.md`: poll every 2 s while a task is active, back off to 15 s
while idle. It stops on a terminal state, on unmount and while the tab is hidden
(Page Visibility API), and it aborts the in-flight request on unmount. The tasks
list reuses the same `pollIntervalFor()` so the two cadences exist once.

## Adding a screen when its milestone lands

1. Flip `available` in `src/navigation.ts` and remove its `missingKey`.
2. Register the real route in `src/App.tsx`.
3. Add the keys to **both** `src/i18n/en.ts` and `src/i18n/es.ts` — the Spanish
   catalogue is typed `Record<MessageKey, string>`, so a missing key will not
   compile.
4. Extend `JobGetterApi` in `src/api/client.ts` with the routes you now call.
