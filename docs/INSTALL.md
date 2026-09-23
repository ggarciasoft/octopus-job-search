# Installing Job Getter

This takes you from nothing to a form filled on your own machine. It is written
for someone who has not worked on this code. If you get stuck on a step marked
✅, that is a bug in this guide. Please report it.

Every step says how well it has been checked:

- ✅ **verified**: run exactly as written, and it worked.
- ⚠️ **partly verified**: run in a weaker form. The note says how.
- ❌ **not verified yet**: written down so the path is clear, but nobody has
  run it yet.

Operator detail and troubleshooting live in [`RUNBOOK.md`](RUNBOOK.md). This
guide links to it rather than repeating it.

---

## What you need

| For                          | You need                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| The server (always)          | Docker with Compose v2, `git`, and about 8 GB of RAM without a local model            |
| The browser extension        | Google Chrome, plus Node.js 24 and pnpm 11 to build it (`corepack enable` gives pnpm) |
| The desktop runner (instead) | Python 3.12 and [`uv`](https://docs.astral.sh/uv/)                                    |

You only need **one** of the extension or the desktop runner. Both fill the
same approved applications, and both stop before the final submit.

- **The extension** fills the page you are already looking at, in your own
  Chrome. Pick this one if you're unsure.
- **The desktop runner** opens a browser window of its own and fills forms
  there. It needs no build step. Nothing is filled unless the runner is running.

Tested so far on Windows 11 with Docker Desktop. macOS and Linux are expected
to work but are **not verified**.

---

## 1. Install the server ✅

```bash
git clone <repository> job-getter && cd job-getter
cp .env.example .env
sh scripts/setup.sh              # Linux, macOS, Git Bash
# pwsh -File scripts/setup.ps1   # Windows PowerShell (⚠️ verified against a throwaway file only)
docker compose up --build -d
```

`setup.sh` fills `.env` with fresh secrets and prints a **setup token, once**.
Copy it now. You need it in step 2.

The first `up` builds three images and takes a few minutes. It's ready when
`docker compose ps` shows `api` as `healthy`.

> **Behind a corporate proxy or antivirus that inspects HTTPS?** The image
> builds fail with certificate errors. See [RUNBOOK §6](RUNBOOK.md) (Symptom
> B). The verification above was run that way. A build on a network
> **without** interception has not been observed yet.

To confirm the whole chain works, run `sh scripts/smoke.sh` (✅ passes).

## 2. Create your account ✅

Open **http://localhost:3000**. Enter the setup token, an email and a password
of at least 12 characters. The setup page then closes permanently.

> **Use exactly the address in `APP_ORIGIN`** in `.env`, which is
> `http://localhost:3000` by default. The API refuses changes from any other
> origin, so `http://127.0.0.1:3000` will load pages and then fail to save
> anything. If you want a different address, change `APP_ORIGIN` and run
> `docker compose up -d` again.

## 3. Choose an AI provider (optional) ✅

Job Getter works without AI: you write and approve answers yourself. That path
is verified from a fresh install (AT28). To add a model, use **Settings → AI
provider** in the web app, or the local-model profile in the
[README](../README.md#quickstart). You choose and download the model yourself,
under its own licence.

## 4a. The browser extension

### Build it ✅

```bash
corepack enable        # once, if pnpm is not installed
pnpm install
pnpm extension:build
```

This writes a loadable extension to `apps/extension/dist/`. It is not in the
Chrome Web Store, so for now you build it yourself.

### Load it into Chrome ⚠️

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked**, and choose the `apps/extension/dist` folder.
4. Pin **Job Getter** from the puzzle-piece menu so its button is visible.

It starts with access to no website. It can reach a page only when you press
its button on that page.

> ⚠️ Automated runs load this same `dist` folder with Chrome's
> `--load-extension` flag, which is equivalent to **Load unpacked** but is not
> the same clicks.

### Pair it ⚠️

1. In the web app: **Settings → Devices**. Leave **Browser extension** selected
   and press **Create a pairing code**. The code is shown once and expires in
   five minutes.
2. Open the extension's popup. Enter the address the Devices page tells you
   (your `APP_ORIGIN`), paste the code, and press **Pair this browser**.
3. Chrome asks whether Job Getter may access that address. **Allow** it. This
   is the only site access the extension asks for up front. It needs it to
   read your own installation's replies.

The popup then shows your approved applications. The device appears as
**Paired** under Settings → Devices.

> ⚠️ **Step 3 has not been done by a person yet.** Automated runs load a copy
> of the extension with that access already granted, so Chrome's prompt has
> never appeared. Everything after it is verified in a real Chrome. If pairing
> does not complete after you allow access, create a new code and try once
> more, and please report what you saw.

### Fill a form ✅

1. Approve an application in the web app, as usual.
2. In the extension's popup, find it under **Other approved applications** and
   press **Open the application page**. Or open the employer's form yourself.
3. With the form's tab in front, open the popup and press **Fill this page**.
4. Check the page. Anything the packet does not answer is left for you, and the
   popup says so.
5. **You** press the employer's submit button. Job Getter never does.
6. On the page that appears next, open the popup and press **I submitted it:
   check this page**. If that page shows a confirmation, the application is
   recorded as submitted, with the confirmation's words as evidence. If it
   doesn't, Job Getter asks you what happened.

Only Greenhouse forms are supported, and only a synthetic Greenhouse form has
been filled so far. See the [source support matrix](../README.md#source-support-matrix).

## 4b. The desktop runner, instead ⚠️

```bash
uv sync --project services/worker --extra browser
uv run --project services/worker playwright install chromium
uv run --project services/worker job-getter-runner pair --server http://localhost:3000
```

For the pairing code, go to **Settings → Devices**, choose **Local runner**, and
press **Create a pairing code**. The runner asks for the code. Type it there,
and never on the command line, so it stays out of your shell history.

Then keep this running while you want forms filled:

```bash
uv run --project services/worker job-getter-runner run
```

It opens a visible Chromium window. Log in to job sites there when asked. The
runner stops at any login, CAPTCHA or identity check and hands control back to
you. `job-getter-runner status` shows what it is paired with.

> ⚠️ The three install commands were run from a fresh clone. The interactive
> `pair` prompt was run in a real Windows console: the code was not echoed or
> stored, and the device appeared as a paired local runner. The runner has
> filled a form with `run --headless`. A fill in a visible window has not been
> observed end to end yet.

---

## Everyday operation

| To                           | Do                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Stop                         | `docker compose down`. Your data is kept.                                                               |
| Start again                  | `docker compose up -d`                                                                                  |
| Back up                      | `sh scripts/backup.sh`. See [RUNBOOK §3](RUNBOOK.md)                                                    |
| Upgrade                      | Back up first, then [RUNBOOK §5](RUNBOOK.md)                                                            |
| Copy your settings elsewhere | Settings → Preferences → **Export settings**, then **Import a settings file** on the other installation |
| Update the extension         | `git pull`, `pnpm install`, `pnpm extension:build`, then **Reload** in `chrome://extensions`            |
| Stop a device acting for you | **Revoke** it in Settings → Devices. **Forget this pairing** in the popup is local only                 |
| Delete everything            | Settings → Privacy → **Delete my workspace**. See [RUNBOOK §8](RUNBOOK.md)                              |

> **`docker compose down -v` deletes all your data**: every profile, CV and
> application. Back up first.
