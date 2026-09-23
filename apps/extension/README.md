# Job Getter browser extension (M5)

Fills an application packet **you already approved**, into a form **you are
already looking at**, and stops. It has no code path that presses submit.

> **Status: not usable as a product yet.** It builds, it is tested against a
> synthetic page, and on 2026-09-22 it paired itself from a code and filled
> that page from its own list, in a real Chrome, CV attached — but it has
> never met a live employer's form. Nothing here should be read as
> "Greenhouse supported".

## Building it

```bash
pnpm install
pnpm extension:build
```

That builds the workspace packages it imports first. On a fresh clone,
`pnpm --filter @job-getter/extension build` on its own fails, because
`@job-getter/contracts` is consumed from its `dist/`, which does not exist yet.
For the whole install, pairing included, see
[`docs/INSTALL.md`](../../docs/INSTALL.md).

Two Vite passes, and the second one is not optional:

| Output          | Format | Why                                                                                                                                                        |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background.js` | ES     | The manifest declares `"type": "module"` for the service worker.                                                                                           |
| `popup.js`      | ES     | An extension page, loaded with a `<script type="module">`.                                                                                                 |
| `content.js`    | IIFE   | Injected with `chrome.scripting.executeScript`, which evaluates a **classic** script. An `import` statement here fails at runtime, on the employer's page. |

Then load `apps/extension/dist/` through `chrome://extensions` →
**Developer mode** → **Load unpacked**.

## Pairing

1. In the web app, **Settings → Devices**, leave the kind at **Browser
   extension** and create a pairing code. It is shown once, works once and
   expires in five minutes.
2. Open the extension's popup, enter your installation's address (the one the
   web app is served from, e.g. `http://127.0.0.1:3000`) and paste the code.
   Chrome asks once for permission to reach that address.

The extension redeems the code itself (`POST /devices/exchange`) and keeps the
token it gets back in `chrome.storage.local`, which no page and no content
script can read. You never see the token, and the code is not stored. The
token expires in thirty days; revoking the device in the web app kills it, and
any open fill session with it, on the next request — and the popup, finding
its token refused, forgets it and asks to be paired again. **Forget this
pairing** in the popup is local only: revoke in the web app too.

## How a fill goes

1. The popup lists your approved applications (`GET /fill-targets`) — only
   those a fill session would actually be granted for. Ones approved for the
   tab you opened it over appear under **For this page**; the rest offer to
   open their application page in a new tab. The list holds titles and
   destinations, never answers or the CV.
2. You press **Fill this page**. Nothing is automatic: `activeTab` only grants
   access to a page when you invoke the extension on it.
3. The service worker asks the API for a **fill session**, naming the
   application, the tab's origin and the packet hash it believes is approved.
   The API refuses anything else — see `apps/api/src/routes/fill-sessions.ts`.
4. The content script reads the page and reports what it saw. It is given no
   credential and makes no decisions.
5. The service worker plans the fill with `@job-getter/fill-planner`, the same
   planner the Python desktop runner uses, and sends back a list of values —
   plus the CV's bytes, fetched through the session. The content script never
   learns where the file came from or how to ask for it again. If the page
   refuses the file, that becomes an unresolved question rather than a silent
   omission, so you are never left believing a CV was sent.
6. The content script types them and reports what landed. The API records the
   same states and the same `fill_paused` event the desktop runner produces.
7. **You** press the employer's submit button.
8. On the page the employer shows next, open the popup and press **I
   submitted it: check this page**. The extension reads that page once, with
   the same conservative rules the desktop runner uses (pinned to it by
   `fixtures/fill-planner/greenhouse-confirmation.json`), and reports what it
   saw to `POST /fill-sessions/:id/observation`. A confirmation is recorded as
   submitted with the page's own words as evidence. Anything less is recorded
   as "could not tell", and Job Getter asks you what happened. Nothing can be
   recorded as "not submitted". Only the browser that reported the fill can
   do this, only on the packet's own origin, and only once.

## The security shape

- **The content script holds nothing.** It shares a DOM with the employer's
  page; anything it held, the page could eventually reach. The device token and
  the session nonce stay in the service worker.
- **The content script decides nothing.** Matching an answer to a control
  happens in the shared planner, so there is no second implementation of the
  exact-match rule for a page to confuse.
- **The popup renders employer text as text.** Job titles and company names
  started on an employer's page; `popup.ts` sets them with `textContent` and
  never parses them as HTML, and only opens a destination URL that is http(s)
  on the packet's own origin.
- **It never listens to the page.** There is deliberately no
  `window.addEventListener('message', …)` anywhere in `src/`.
- **Every inbound message is verified** against the tab, frame and origin the
  session was opened for (`src/messages.ts`, and `tests/messages.test.ts`).
  The extension id is not a secret, so `chrome.runtime.sendMessage` is
  reachable by any page that learns it.

## Parity with the desktop runner

Both clients fill the same packets, so they must read a form the same way. A
disagreement would produce two form fingerprints for one page, and every
approval made through one client would read as stale to the other.

- `packages/fill-planner` is a port of the runner's `forms.py` and `plan.py`,
  pinned to it by `fixtures/fill-planner/vectors.json` — asserted from both
  sides, in TypeScript and in Python.
- `fixtures/fill-planner/greenhouse-page.json` records what **Chromium** read
  from the synthetic page. `tests/parity.test.ts` demands jsdom reproduce it
  exactly, and `services/worker/tests/test_planner_parity.py` demands Chromium
  still does.

Regenerate both after any deliberate change to the Python planner:

```bash
cd services/worker
uv run python ../../fixtures/fill-planner/generate.py
uv run python ../../fixtures/fill-planner/generate-page.py   # needs Chromium
```

## What is missing

- **Only Greenhouse, and only a fixture.** Lever is M5's second adapter and is
  not written. No adapter has met a live board in either client.
- **The confirmation check is one look, not a watch.** The desktop runner
  opens the page itself and watches it for up to ninety seconds. The extension
  may read an employer's page only while you invoke it there, so you open the
  popup on the confirmation page yourself. Only a fill that ended waiting for
  submission (every question answered) can be checked. After a fill that
  needed input, record the outcome in the web app, as with the runner.
- **`background.js` is ~104 kB.** Importing two header constants from
  `@job-getter/contracts` pulls in the whole barrel, whose top-level
  `registerContractFormats()` defeats tree-shaking of TypeBox. Copying the
  constants by hand would be the "parallel enum" the repository forbids, so the
  weight stays until the contracts package grows a side-effect-free subpath.
