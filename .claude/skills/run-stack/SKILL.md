---
name: run-stack
description: Bring up the Job Getter Compose stack (db, migrate, api, worker, web) and exercise a change end to end against it. Use when asked to run, start, restart or rebuild the app, to verify a slice live, or to reproduce something that only appears on the real stack. Covers the build-CA and TLS-interception path this machine needs, the capability and origin settings that silently break a run, and the ready-made end-to-end scripts.
---

# Running the stack

`docs/RUNBOOK.md` is the human document and stays authoritative for first-run
setup, backup/restore and incident procedures. This file is the operational
short path: the commands that actually work here, and the four things that have
each cost a session when missed.

## Before you touch anything

**Check whether it is already up.** It usually is, and rebuilding from scratch
costs several minutes for nothing.

```bash
docker compose ps --format "table {{.Service}}\t{{.Status}}"
```

`db`, `api`, `web` report healthy; `worker` has no healthcheck and only reports
`Up`. `migrate` is a one-shot and is absent from a healthy stack — it having
exited is correct, not a failure.

## Starting it

If the images are current, never rebuild:

```bash
docker compose up -d --no-build
```

`migrate` runs automatically as a one-shot and the API waits on
`service_completed_successfully`, so a fresh migration is applied before the API
serves anything. Confirm it with `docker compose logs migrate`.

Then the app is at **http://127.0.0.1:3000**, which proxies `/api` to the API
container. The API is not published directly.

## Rebuilding after a code change

Rebuild only what changed: `api` for anything in `apps/api` or
`packages/contracts`, `worker` for `services/worker`, `web` for `apps/web`.

**On this machine you cannot use `docker compose build`.** The host sits behind
TLS interception (Norton re-signs every HTTPS connection), so package downloads
inside a build fail with `invalid peer certificate: UnknownIssuer` unless the
intercepting root is supplied as a BuildKit secret — and the installed Compose
(v5.5.1) does not accept `--secret` on `compose build`. Build each image
directly instead:

```bash
docker build --secret id=build_ca,src=.local/build-ca.pem \
  --build-arg IMAGE_REGISTRY=public.ecr.aws/docker/library \
  -f infra/api.Dockerfile -t job-getter/api:dev .
```

Substitute `worker` or `web` for `api` in both the `-f` and `-t` arguments. Then
`docker compose up -d --no-build` to restart onto the new images.

Both arguments matter. Without the secret the build fails on certificate
verification; without `IMAGE_REGISTRY` it pulls base images from Docker Hub and
hits the anonymous pull limit. `.local/build-ca.pem` is gitignored and already
present; `.local/export-build-ca.ps1` regenerates it from the Windows
certificate store.

Runtime TLS is separate and already handled: `docker-compose.override.yml`
mounts a merged CA bundle into the api and worker containers. Do not delete it.

## The four settings that silently break a run

Each of these produces a stack that looks healthy and does the wrong thing.

1. **`WORKER_CAPABILITIES` in `.env` must list every task type you want run.**
   An existing `.env` does not pick up new defaults from `.env.example`, so a
   task type added by a recent milestone is simply never claimed: the task sits
   `queued` forever and the worker logs nothing, because it is not asking for
   that type. This has bitten twice. Check it first whenever a task does not
   start:

   ```bash
   grep WORKER_CAPABILITIES .env
   ```

   As of M3 it should read
   `noop_echo,parse_profile,fetch_board,fetch_job,match_job,render_cv`.

   **The setting and the image must agree.** Adding a capability the running
   image has no handler for makes the worker refuse to start and crash-loop,
   logging `worker.startup_failed` with both lists. That is the guard doing its
   job — a worker that claimed work it could not do would fail every attempt and
   stall the queue — and the fix is to rebuild the worker image, never to revert
   the setting. A healthy start logs `worker.started` with `capabilities` and
   `handlers` equal.

2. **`APP_ORIGIN` must match the origin you call from.** Requests from any other
   origin are refused at the CSRF check and login answers **403** with no
   further explanation. For local work it must be `http://127.0.0.1:3000`. If a
   previous session pointed it at a Cloudflare tunnel, that tunnel is dead and
   every request will fail until it is changed back. Restart the API after
   editing it (`docker compose up -d --no-build api`).

3. **Migrations run automatically, but only on `up`.** Rebuilding the API image
   without restarting the stack leaves the old schema in place.

4. **The `local-ai` Ollama profile is opt-in** (`--profile local-ai`) and has
   never been exercised here. Without it there is no provider configured, which
   is a supported state: matching is deterministic and CV generation falls back
   to assembling the document directly from confirmed facts.

## Verifying a change end to end

`scripts/smoke.sh` is the M0 path — web → API → queued task → worker → stored
result — and is the fastest proof the stack is wired correctly. It talks to the
same origin a browser does and mocks nothing.

For milestone work there are ready-made scripts under `.local/` (gitignored,
local-only). Read one before running it; each performs real work against the
running stack:

- `.local/e2e-m2.sh` — registers a public Greenhouse board, scans it, and
  imports a pasted job. Performs **one** read of a real public board.
- `.local/e2e-m3.sh` — scores an already-discovered job and exercises the
  `min_score` / `eligible` filters. No network beyond the stack.
- `.local/e2e-m3-scored.sh` — the fuller one: confirms profile facts, imports a
  job whose description has explicit requirement headings, scores it, and prints
  the eligibility checks, component values and requirement outcomes. Use this
  when a fit change needs proving on real data.
- `.local/e2e-m3-cv.sh` — generates a tailored CV, downloads both formats,
  checks their magic bytes, extracts the PDF text with pypdf and approves the
  result. This is the one that exercises Chromium.

They all log in as `owner@example.invalid`. If that account does not exist,
complete setup at http://127.0.0.1:3000 with the token from
`grep '^SETUP_TOKEN=' .env`.

To inspect stored data directly:

```bash
docker compose exec -T db psql -U jobgetter -d jobgetter -c "select ..."
```

The database name and user are both `jobgetter` — not `job_getter`, which is
what the _test_ containers use and is an easy way to get a confusing
authentication failure.

## When something is wrong

Read the worker log first; it is where queued work goes to die quietly.

```bash
docker compose logs worker --tail 50
docker compose logs api --tail 50
```

A worker that started correctly logs `worker.started` with `capabilities` and
`handlers` counts that **agree**. If it claims nothing, re-read setting 1 above.

## A second, throwaway stack

Some checks need a fresh installation (AT25 and AT28 did), and the owner's
stack holds real data. Use a second Compose project. Since 2026-09-22 every
volume and network name in `docker-compose.yml` is
`${COMPOSE_PROJECT_NAME}-...`, so `-p <name>` or `COMPOSE_PROJECT_NAME` alone
isolates it, and no extra override file is needed. Before that change, a second
project mounted the owner's volumes or joined the owner's network. AT28's
sandbox API read the owner's database that way until it was stopped.

Check anyway, every time:

```bash
export COMPOSE_PROJECT_NAME=jg-scratch APP_ORIGIN=http://127.0.0.1:3200 WEB_PORT=3200 API_PORT=3201
docker compose config | grep -E "^    name:"      # all must start with jg-scratch
docker compose up -d --no-build --wait
docker exec jg-scratch-api-1 getent hosts db     # the sandbox db's IP
docker network inspect jg-scratch --format '{{range .Containers}}{{.Name}} {{end}}'
```

Export the variable instead of passing `-p`: `scripts/backup.sh`,
`restore.sh` and `migrate.sh` call plain `docker compose`, and they then act on
the sandbox too. `docker compose down -v` in the same shell removes only the
sandbox's volumes. Re-run the `config` check first if you have any doubt about
which shell you are in.

The sandbox reuses the owner's `.env`, `SETUP_TOKEN` included, which is harmless
because the setup route closes per database. For a truly _separate_
installation with its own secrets (AT25's restore target), use a git worktree
under `.local/`. Copy in the working `docker-compose.yml`,
`docker-compose.override.yml` and `.local/runtime-ca-bundle.pem`, then run
`sh scripts/setup.sh --yes` there and set its ports and `APP_ORIGIN` in that
`.env`. `.local/at25/at25.py` fills a fresh installation through the API,
snapshots it, and compares two snapshots.

## What this stack cannot do here

Be honest about these rather than working around them:

- **No browser automation.** Playwright is not installed on this host and
  pulling it plus its browsers is not something to do unprompted. Screens can be
  verified through the API and by their tests, but "no browser has rendered
  this" stays true until someone renders it.
- **PDF rendering works but is fragile.** Verified 2026-09-21: `render_cv`
  produced a one-page PDF of 23,689 bytes through Chromium in the worker image,
  with the text extractable by pypdf. It depends on Chromium being present in
  that image, so a worker built without the `browser` extra will report
  `PDF_UNAVAILABLE` as a finding and still ship the DOCX, rather than failing.
- **Every API test file starts its own PostgreSQL container.** Running the test
  suite while this stack is up has produced one unreproduced failure. Prefer
  stopping the stack (`docker compose stop`) before a full `pnpm test`, or treat
  an isolated failure as suspect and re-run it before believing it.
