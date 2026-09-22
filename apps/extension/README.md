# Job Getter browser extension (M5)

Fills an application packet **you already approved**, into a form **you are
already looking at**, and stops. It has no code path that presses submit.

> **Status: not usable as a product yet.** It builds, it is tested against a
> synthetic page, and it has never filled a live employer's form. The CV is not
> attached automatically (see "What is missing"), and pairing is a token you
> paste by hand. Nothing here should be read as "Greenhouse supported".

## Building it

```bash
pnpm --filter @job-getter/extension build
```

Two Vite passes, and the second one is not optional:

| Output          | Format | Why                                                                                                                                                        |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background.js` | ES     | The manifest declares `"type": "module"` for the service worker.                                                                                           |
| `popup.js`      | ES     | An extension page, loaded with a `<script type="module">`.                                                                                                 |
| `content.js`    | IIFE   | Injected with `chrome.scripting.executeScript`, which evaluates a **classic** script. An `import` statement here fails at runtime, on the employer's page. |

Then load `apps/extension/dist/` through `chrome://extensions` →
**Developer mode** → **Load unpacked**.

## Pairing

1. In the web app, **Settings → Devices**, pair a device of kind `extension`.
   The pairing code is shown once.
2. Exchange it for a token (the extension does not yet do this itself — see
   below) and paste the token, with your installation's address, into the
   popup.

The token lives in `chrome.storage.local`, which no page and no content script
can read. It expires in thirty days and revoking the device in the web app
kills it, and any open fill session with it, on the next request.

## How a fill goes

1. You press **Fill this page** in the popup. Nothing is automatic: `activeTab`
   only grants access to a page when you invoke the extension on it.
2. The service worker asks the API for a **fill session**, naming the
   application, the tab's origin and the packet hash it believes is approved.
   The API refuses anything else — see `apps/api/src/routes/fill-sessions.ts`.
3. The content script reads the page and reports what it saw. It is given no
   credential and makes no decisions.
4. The service worker plans the fill with `@job-getter/fill-planner`, the same
   planner the Python desktop runner uses, and sends back a list of values.
5. The content script types them and reports what landed. The API records the
   same states and the same `fill_paused` event the desktop runner produces.
6. **You** press the employer's submit button.

## The security shape

- **The content script holds nothing.** It shares a DOM with the employer's
  page; anything it held, the page could eventually reach. The device token and
  the session nonce stay in the service worker.
- **The content script decides nothing.** Matching an answer to a control
  happens in the shared planner, so there is no second implementation of the
  exact-match rule for a page to confuse.
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

- **The CV is not attached.** The grant names the file and its digest, but
  fetching the bytes needs a session-scoped download route that does not exist
  yet. Until it does, the file input is reported as unresolved and you attach
  the CV yourself — which is the documented fallback, not a silent failure.
- **Pairing is manual.** The extension cannot call `/devices/exchange` itself,
  so the token is pasted.
- **The application id and packet hash are pasted too.** There is no list of
  approved applications in the popup yet.
- **Only Greenhouse, and only a fixture.** Lever is M5's second adapter and is
  not written. No adapter has met a live board in either client.
- **No confirmation observation.** The desktop runner can watch for a
  confirmation after you submit; the extension cannot.
- **`background.js` is ~104 kB.** Importing two header constants from
  `@job-getter/contracts` pulls in the whole barrel, whose top-level
  `registerContractFormats()` defeats tree-shaking of TypeBox. Copying the
  constants by hand would be the "parallel enum" the repository forbids, so the
  weight stays until the contracts package grows a side-effect-free subpath.
