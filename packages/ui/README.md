# `@job-getter/ui`

Shared, accessible React primitives for the Job Getter web app (`apps/web`) and,
from M5, the extension options page (`apps/extension`). Source-only package: it
is consumed as TypeScript through the workspace link, so there is no build step.

## What belongs here

- Small presentational components with **no business logic**, no data fetching
  and no knowledge of the API.
- The one deliberate exception is `status.ts`, the product status vocabulary.
  It lives here because both consumers must render the same seven states and
  the union must be closed — see below.

## What does not belong here

- Anything that calls the API, reads a cookie, or knows what a "task" is.
- Anything that renders example or placeholder _content_. `EmptyState` renders
  a title, an explanation and suggestions; it never renders sample rows.
  `08_UX_AND_CUSTOMIZATION.md`: empty job lists "suggest adding boards or
  relaxing filters, never fabricate examples as live results".

## Accessibility contract

Every component in this package is expected to hold to these, and the tests in
`apps/web/tests/ui.*.test.tsx` check the load-bearing ones:

- Every interactive element is keyboard reachable and renders a **visible focus
  ring** (`FOCUS_RING` in `cn.ts` — use it, do not hand-roll one).
- Every form control has a programmatically associated label. `FormField` is the
  only supported way to wire one: it returns `id`, `aria-describedby`,
  `aria-invalid` and `aria-required` and the control must spread them.
- Errors render in an element with `role="alert"` that is referenced from the
  control's `aria-describedby`.
- `Dialog` moves focus into the dialog on open, traps Tab inside it, closes on
  Escape and restores focus to the previously focused element on close.
- `Spinner`, `SkeletonRow` and `ProgressBar` all take a required text label;
  a silent busy indicator tells a screen-reader user nothing.

## Styling

Tailwind CSS 4 utility classes, applied by the consuming app. `apps/web`
includes this package's sources in its Tailwind scan with
`@source "../../../packages/ui/src";` in `src/index.css` — a new consumer must
do the same or the classes will not be generated.

## The status vocabulary (`status.ts`)

`08_UX_AND_CUSTOMIZATION.md` requires seven states to read _distinctly_:

| Key                         | Label                       | Evidence        |
| --------------------------- | --------------------------- | --------------- |
| `not_checked`               | Not checked                 | `none`          |
| `unknown`                   | Unknown                     | `insufficient`  |
| `needs_your_answer`         | Needs your answer           | `user_input`    |
| `ready_for_review`          | Ready for review            | `system`        |
| `waiting_for_submission`    | Waiting for submission      | `system`        |
| `submitted_verified`        | Submitted — verified        | `verified`      |
| `submitted_reported_by_you` | Submitted — reported by you | `user_reported` |

`isVerifiedSubmission()` returns true for exactly one key. Invariant 5 of
`00_AI_IMPLEMENTATION_INSTRUCTIONS.md` — never call an application submitted
without evidence or an explicit, labeled user report — is enforced by that
function and by `status.test.ts`, not by reviewer vigilance.

`StatusBadge` renders a descriptor and accepts `label` / `description`
overrides so a localised app passes translated strings from its own catalogue
(`labelKey` / `descriptionKey` give the catalogue key names). The English
defaults are the fallback, never a translation.

## Commands

```
pnpm --filter @job-getter/ui typecheck
pnpm --filter @job-getter/ui test
```

DOM-rendering tests for these primitives live in `apps/web/tests`, because
`@testing-library/react` and `jsdom` are dependencies of the web app rather
than of this package.
