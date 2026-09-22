# Runbook

Operational procedures for a Job Getter installation.

Every procedure is labelled:

- ✅ **Verified** — executed on a real installation and observed to work.
- ⚠️ **Unverified** — written from the specification and the code, but **never
  run end to end**, because the application does not exist yet.

> **As of 2026-09-20, §1 (first run), §2 (migration) and §6 (registry and TLS)
> are ✅ Verified on the real Compose stack**; the rest is ⚠️ Unverified. See
> [`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) for exactly what
> each verification rests on.
>
> Unverified does not mean wrong — it means nobody has run it. Treat the first
> execution of any such procedure as a rehearsal, and update this file with
> what actually happened.

---

## Contents

1. [First run](#1-first-run) ✅
2. [Migration](#2-migration) ✅
3. [Backup and restore](#3-backup-and-restore) ⚠️
4. [Stalled queue](#4-stalled-queue) ⚠️
5. [Upgrade](#5-upgrade) ⚠️
6. [Registry rate limits and TLS interception](#6-registry-rate-limits-and-tls-interception) ✅
7. [Lost owner access](#7-lost-owner-access) ⚠️
8. [Workspace deletion](#8-workspace-deletion) ✅

---

## 1. First run

**Status: ✅ Verified 2026-09-20** on Windows 11 with Docker Desktop, from a
fresh `.env`, through to a passing smoke test on the Compose stack. Steps
verified only in a weaker form are marked inline.

### Procedure

```bash
git clone <repository> && cd job-getter

cp .env.example .env                 # ✅ verified

sh scripts/setup.sh                  # ✅ verified (produced the .env used below; zero carriage returns)
# pwsh -File scripts/setup.ps1       # ✅ verified against a throwaway env file only

docker compose up --build -d         # ✅ verified (with IMAGE_REGISTRY and the build_ca secret, see §6)
# open http://localhost:3000 and enter the setup token that was printed
sh scripts/smoke.sh                  # ✅ passed through the nginx proxy on 127.0.0.1:3000
```

> On a network with TLS interception (see §6, Symptom B) `docker compose up
--build` fails inside the image builds. Build the images first with the
> `build_ca` secret, then `docker compose up -d --no-build`. That is how the
> verification above was performed; a build on a host **without**
> interception has not been observed and is verified only by construction.

### What to expect at each step

**`scripts/setup.sh`** generates `SESSION_SECRET`, `ENCRYPTION_KEY`,
`WORKER_AUTH_TOKEN` and `SETUP_TOKEN` from a CSPRNG and prints the setup token
**once**. It refuses to overwrite an existing `.env` without `--force`.

> **Save the setup token now.** It is also in `.env`
> (`grep '^SETUP_TOKEN=' .env`), but it is the only thing standing between you
> and a reinstall until the owner account exists.

**`docker compose up --build -d`** starts, in this order: `db` → healthy →
`migrate` → exits 0 → `api` → healthy → `worker` and `web`. That ordering is
enforced by `depends_on` conditions, not hoped for.

Watch it: `docker compose ps` and `docker compose logs -f`.

**One-time setup at `http://localhost:3000`.** Enter the token, an email and a
password of at least 12 characters. The route then **closes permanently** — no
token is accepted again on this installation, ever. That is by design
(`docs/spec/09_SECURITY_PRIVACY.md`).

**`scripts/smoke.sh`** is the real proof. It exercises browser origin → `/api`
proxy → API → PostgreSQL → task queue → Python worker → stored result, and
checks that an idempotency-key replay does not duplicate work. It exits non-zero
and prints the actual response body on failure.

### If something goes wrong

| Symptom                               | Cause                                     | Fix                                                                                  |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `env file ... .env not found`         | Compose needs `.env` before it will parse | `cp .env.example .env && sh scripts/setup.sh`                                        |
| `migrate` exits non-zero              | Migration failure                         | `docker compose logs migrate`. **Do not start the API.** See §2                      |
| `api` never healthy                   | Missing secret, or database unreachable   | `docker compose logs api`. Check `SESSION_SECRET` and `ENCRYPTION_KEY` are non-empty |
| Ready but smoke times out on the task | Nothing is claiming it                    | `docker compose logs worker`; check `WORKER_CAPABILITIES` includes `noop_echo`       |
| Port 3000 in use                      | Something else has it                     | Set `WEB_PORT` in `.env`                                                             |
| Image pull fails with 429             | Docker Hub rate limit                     | See §6                                                                               |

---

## 2. Migration

**Status: ✅ Verified 2026-09-20** for the Compose path: the one-shot `migrate`
service applied `0001_foundation` to an empty database and exited 0 before
the API started, and on a later `docker compose down`/`up` it reported
"Schema is up to date (1 migration(s))" and exited 0 again. The
`--local` path and the pre-migration backup step are ⚠️ Unverified.

> ### Back up first
>
> `docs/spec/10_DEPLOYMENT.md`: _"Back up before migration."_ Not a suggestion.
>
> ```bash
> sh scripts/backup.sh --label pre-migration --age-recipient age1...
> ```

### Procedure

```bash
sh scripts/migrate.sh                # auto-detects Compose vs local
sh scripts/migrate.sh --compose      # explicitly via the one-shot service
sh scripts/migrate.sh --local        # explicitly on the host, via pnpm
```

The Compose path runs `docker compose run --rm --no-deps migrate`, which uses
**the API image** — so migration code and serving code always come from the same
build.

**A non-zero exit means: do not start the API against this database.**

### Rules

- Migrations must be **repeatable from an empty database** and **idempotent** on
  a populated one. CI asserts both by running them twice against a fresh
  PostgreSQL 17 service container.
- **Prefer additive changes.** Add a nullable column, backfill, then tighten in a
  later migration — rather than a destructive single step.
- **Never blindly run down migrations on live data.**
  `docs/spec/10_DEPLOYMENT.md` is explicit, and `scripts/migrate.sh` has no
  down-migration mode at all. To roll back: restore the backup you took.
- **A rollback must preserve application outcome evidence.** Losing the record
  that you applied somewhere is worse than losing the ability to apply.

### If a migration fails halfway

1. **Stop.** Do not start the API, do not re-run hopefully.
2. `docker compose logs migrate` — read the actual SQL error.
3. If the migration runner is transactional, the failed migration rolled back
   and the database is at the previous version. Fix the migration and re-run.
4. If it is not, or you are unsure: **restore the pre-migration backup** (§3)
   and treat the migration as unreleased.

---

## 3. Backup and restore

**Status: ✅ Verified (POSIX scripts), 2026-09-22.** `backup.sh` (gpg and
`--no-encrypt`), `restore.sh` (to a separate installation, and over the
source) and `migrate.sh` ran against a populated installation for AT25. See
`IMPLEMENTATION_STATUS.md`, "AT25". `backup.ps1`, `restore.ps1` and
`--age-recipient` remain ⚠️ Unverified.

### Backup

```bash
sh scripts/backup.sh --age-recipient age1...     # encrypted (recommended)
sh scripts/backup.sh --gpg-recipient you@...     # encrypted
sh scripts/backup.sh --no-encrypt                # plaintext, prompts first
```

Produces `database.dump` (pg_dump custom format), `files.tar.gz`,
`manifest.json` and `SHA256SUMS`, then packs and encrypts them.

**For a strictly consistent backup, quiesce first:**

```bash
docker compose stop api worker
sh scripts/backup.sh --age-recipient age1...
docker compose start api worker
```

Without that, the dump and the file archive are taken moments apart. The
manifest records `stack_quiesced` so the restore can tell you which you have.

> ### `.env` is NOT in the backup
>
> Deliberately. `docs/spec/09_SECURITY_PRIVACY.md` requires the operator
> encryption key to live outside the database, so a stolen database backup
> cannot decrypt stored provider API keys.
>
> **Keep `ENCRYPTION_KEY` somewhere safe and separate.** Without it a restore
> recovers everything except stored provider API keys, which must be re-entered.
> The manifest stores an 8-character hash prefix of the key so the restore can
> tell you whether yours matches — see ADR17.

**Schedule it.** Daily is the target from `docs/spec/10_DEPLOYMENT.md`. There is
no built-in scheduler; use `cron` or Task Scheduler.

### Restore

```bash
sh scripts/restore.sh --from backups/job-getter-<ts>.tar.gz.age --drop-existing
```

To a **separate installation** — the case the specification actually cares about:

1. Clone the repository on the target machine.
2. `sh scripts/setup.sh` — creates a **new** `.env` with **new** secrets.
3. Replace `ENCRYPTION_KEY` in the new `.env` with the source installation's, if
   you still have it.
4. `docker compose up -d db`
5. `sh scripts/restore.sh --from <backup> --drop-existing`
6. `sh scripts/migrate.sh` — brings an older dump to the current schema.
7. Read what the script reports about the deletion ledger (below).
8. Only then `docker compose up -d`, and `sh scripts/smoke.sh`.

> ### The deletion ledger is reapplied before you start the API
>
> `docs/spec/10_DEPLOYMENT.md` requires a restore to reapply the deletion ledger
> **before reopening access**, so data a user deleted after the backup was taken
> is not resurrected. `scripts/restore.sh` saves the target's ledger before it
> touches the database, merges it back in after the restore, runs
> `scripts/reapply-deletions.sql`, and does **not** start the API. If the dump
> predates migration 0007 it prints the exact commands to finish the job instead.
> AT25 checked this: an answer deleted after the backup stayed deleted.
>
> The files volume gets the same treatment. After unpacking it, the script
> removes every object the ledger names: a deleted workspace's whole directory
> and each deleted file. Before AT26 it did not, so a restored backup brought
> back the bytes of deleted files even though their rows stayed deleted.

**What a successful restore proves, and what it does not:**

| The script proves                 | Checked separately, through the application                     |
| --------------------------------- | --------------------------------------------------------------- |
| Checksums matched                 | AT25 (profile, files, hashes, history restored): passed         |
| `pg_restore` completed            | AT11 (original CV downloads byte-identical): passed within AT25 |
| File count matches the manifest   |                                                                 |
| The deletion ledger was reapplied |                                                                 |

**Recovery targets** from `docs/spec/10_DEPLOYMENT.md` — at most 24 hours data
loss, restore within 4 hours — are **unvalidated targets**, not measured results.
The spec says to validate before claiming them; that has not happened.

### Rehearse it

A backup you have never restored is a hypothesis. Restore into a scratch
installation, time it, and record the result here. That is also what turns the
recovery targets from claims into measurements.

A scratch installation on the same machine is a second Compose project. Every
volume and network name follows the project name, so `-p` (or
`COMPOSE_PROJECT_NAME`) is enough to keep it off your real data. Check before
starting it:

```bash
export COMPOSE_PROJECT_NAME=jg-rehearsal WEB_PORT=3200 API_PORT=3201 APP_ORIGIN=http://127.0.0.1:3200
docker compose config | grep -E "^    name:"   # every name must start with jg-rehearsal
```

The scripts honour the same variable, so `sh scripts/backup.sh` and
`sh scripts/restore.sh` run in that shell act on the scratch project.
`docker compose down -v` in that shell removes only its volumes.

**Rehearsed 2026-09-22 (AT25):** a small installation took 11 s to back up and
18 s to restore. It came back identical through the API, with every file
byte-identical. `.local/at25/at25.py` (local only) is the driver. Those timings
say nothing about a large installation, so the recovery targets above are still
unvalidated.

---

## 4. Stalled queue

**Status: ⚠️ Unverified.** Written from the queue semantics in
`docs/spec/02_ARCHITECTURE.md`.

**Symptom:** tasks sit in `queued`, or the UI shows work that never finishes.

### Diagnose

```bash
docker compose ps                                   # is the worker even up?
docker compose logs worker --tail 100
grep WORKER_CAPABILITIES .env                       # must include the task's type
docker compose logs api --tail 100 | grep -i claim
```

### By task state

**Stuck in `queued`** — nothing is claiming it. In order of likelihood:

1. **Worker is down or crash-looping.** `docker compose ps worker`, then the
   logs. `docker compose restart worker`.
2. **Capability mismatch.** The API only leases a task to a worker that declares
   its type. A `parse_profile` task and a worker declaring only `noop_echo` will
   wait forever. Fix `WORKER_CAPABILITIES` in `.env` and restart the worker.
3. **`fill_local` with no desktop runner.** Correct behaviour, not a bug — the
   container worker cannot do it (ADR16). Pair the desktop runner:
   `uv run --project services/worker job-getter-runner pair --server http://localhost:3000`
   (the pairing code is entered interactively and never goes into shell history).
4. **Worker cannot reach the API.** Check `WORKER_API_BASE_URL` — `http://api:8080`
   inside Compose, `http://127.0.0.1:8080` for the dev loop.
5. **Wrong `WORKER_AUTH_TOKEN`.** Look for 401s from `/internal/v1/tasks/claim`.
   Usually means the worker started before a `setup.sh --force`.
6. **`run_after` is in the future.** A backed-off retry. Wait.

**Stuck in `leased`** — a worker took it and stopped heartbeating. The lease is
120 s with a 30 s heartbeat, so it should be reclaimed automatically within
about two minutes. If it is not, the reclaim sweep is not running: check the API
logs and restart the API.

**Failing repeatedly** — check `attempt` against `max_attempts`. Ordinary tasks
retry at most three times with exponential backoff and jitter.

> **Browser filling is never blindly retried.** The page may have changed under
> the user. If a `fill_local` task failed, a human looks at it.

### Do not

- ❌ **Do not delete rows from the task table** to "clear" a queue. Tasks carry
  domain meaning and events reference them.
- ❌ **Do not re-enqueue a submission-related task** whose outcome is uncertain.
  Invariant 6. An uncertain outcome is recorded as `outcome_unknown` and left for
  the user.
- ❌ **Do not raise `max_attempts` to force something through.** Three failures
  means it will fail a fourth time.

### Connector 403/429

Repeated rejections from a source are **not** a retry problem. Back off, honour
`Retry-After`, and show source health. `docs/spec/05_DISCOVERY_CONNECTORS.md`:
_"stop on repeated 403/429"_. Retrying harder is how an integration becomes
abuse.

---

## 5. Upgrade

**Status: ⚠️ Unverified.**

```bash
sh scripts/backup.sh --label pre-upgrade --age-recipient age1...   # 1. ALWAYS
git pull                                                           # 2.
docker compose build                                               # 3.
docker compose up -d                                               # 4. runs migrate first
sh scripts/smoke.sh                                                # 5. verify
```

Step 4 re-runs the one-shot `migrate` service before the API starts, so schema
changes are applied in the right order without a separate command.

### Before upgrading

- Read the changelog for migration notes and breaking changes.
- **Back up.** The backup is the rollback plan; there is no down migration.
- For a hosted installation, tell users first — sessions may be invalidated.

### Rolling back

1. `git checkout <previous-tag> && docker compose build && docker compose up -d`
2. If the upgrade applied a migration the old code cannot read, the code
   rollback is **not enough** — restore the pre-upgrade backup (§3).
3. A rollback must preserve application outcome evidence. If restoring would
   lose the record that you applied somewhere, stop and work out a forward fix
   instead.

### Extension and protocol compatibility

The server supports the **current and previous** protocol minor version
(`docs/spec/10_DEPLOYMENT.md`). A browser extension one minor version behind
keeps working; two behind must be updated. Check `protocol_version` in the
device pairing response after an upgrade.

### Release hygiene

Releases ship **immutable container tags and digests** alongside the lockfiles
and migrations. Never `docker compose pull` a moving tag into a production
installation and hope.

---

## 6. Registry rate limits and TLS interception

**Status: ✅ Verified** — both hazards were encountered and worked around during
this build.

### Symptom A — Docker Hub 429

```
ERROR: unexpected status from HEAD request to
https://registry-1.docker.io/v2/library/postgres/manifests/17-alpine:
429 Too Many Requests
```

Docker Hub rate-limits anonymous pulls by IP. On a shared or corporate network
you can hit it without pulling anything yourself.

**Workaround — the AWS ECR Public mirror**, which serves the same
content-addressed images and is not rate-limited:

```bash
# in .env
IMAGE_REGISTRY=public.ecr.aws/docker/library
```

It threads through `docker-compose.yml` and every Dockerfile as a build arg.
The default stays `docker.io/library` because that is canonical — the mirror is
a documented fallback, not a replacement (ADR12).

Alternatives: `docker login` (authenticated pulls get a higher limit), or wait.

> **Digest caveat.** The digests pinned in the Dockerfiles and
> `docker-compose.yml` were resolved **through the ECR mirror**, because Docker
> Hub was unreachable at pin time. ECR mirrors Docker Hub content-addressed, so
> they should be identical — but that was not re-verified against Docker Hub. If
> a pull ever fails on a digest mismatch, that is the pin doing its job: it
> failed loudly instead of substituting an image. Re-resolve and update the pin.

### Symptom B — TLS interception

```
certificate verify failed: unable to get local issuer certificate
```

Something is terminating and re-signing TLS with its own root. It is not
always a corporate proxy: on the machine this project was first built on it
was **Norton Web Shield's SSL/TLS scanning**, which re-signs every HTTPS
connection with a root named `Norton Web/Mail Shield Root`. The host trusts
that root (the antivirus installed it), so `pnpm`, `uv` and `docker pull`
work from the host — but nothing _inside_ a container build trusts it, so
every `apk add`, `corepack prepare`, `pnpm install`, `uv sync` and Playwright
download fails inside `docker build`.

Identify the root that is doing the re-signing:

```sh
echo | openssl s_client -connect registry.npmjs.org:443 -servername registry.npmjs.org 2>/dev/null \
  | grep -E '^ *i:'
```

**Workarounds — none of which disable verification:**

- **On the host**
  - **uv**: already handled. `services/worker/pyproject.toml` sets
    `[tool.uv] system-certs = true`, so uv uses the OS trust store.
  - **Node/npm/pnpm**: `export NODE_EXTRA_CA_CERTS=/path/to/root.pem`
  - **Python/httpx**: `export SSL_CERT_FILE=/path/to/root.pem`
- **Inside image builds — supply the root as a BuildKit secret.** Export the
  root as PEM (on Windows, from the certificate store; `.local/` is gitignored
  and is the intended place for it) and pass it to every build:

  ```sh
  docker build --secret id=build_ca,src=.local/build-ca.pem -f infra/api.Dockerfile .
  IMAGE_REGISTRY=public.ecr.aws/docker/library \
    docker compose build --secret id=build_ca,src=.local/build-ca.pem   # if your Compose supports it
  ```

  Every network-touching `RUN` in `infra/api.Dockerfile`,
  `infra/web.Dockerfile` and `infra/worker.Dockerfile` mounts
  `--mount=type=secret,id=build_ca` and, **only if the file is present**,
  exports `NODE_EXTRA_CA_CERTS` (Node tooling) or a merged
  `SSL_CERT_FILE` bundle (uv, which _replaces_ rather than extends the trust
  store) and, for the `apt` calls made by `playwright install --with-deps`, a
  transient `/etc/apt/apt.conf.d/99-build-ca` that is deleted in the same
  `RUN`. Without the secret each guard is a no-op and the build is unchanged.

  Do **not** `COPY` the root into `/usr/local/share/ca-certificates` and run
  `update-ca-certificates`: that persists a third party's root in the runtime
  image for every future user of it. The secret mount is never written to a
  layer. Verified 2026-09-20: after a build with the secret, `grep -rl Norton
/etc/ssl /usr/local/share/ca-certificates` inside both the API and worker
  images finds nothing, and the transient apt config and bundle are absent.

- **At runtime the containers need the root too.** The build secret covers
  image builds only. A running worker fetching a job board, or the API
  probing a model provider, verifies TLS against the image's own bundle and
  fails on an intercepted network with `CERTIFICATE_VERIFY_FAILED`. The
  worker honours `SSL_CERT_FILE` (and deliberately ignores every other
  request-altering environment variable, such as proxies and `.netrc`); Node
  honours `NODE_EXTRA_CA_CERTS`. Build a merged bundle from the image's store
  plus the intercepting root and mount it through the gitignored
  `docker-compose.override.yml` — the example file has the exact block. Do
  not put the root in the base compose file or in an image.

  Verified 2026-09-20: without the override a board scan reported a robots
  refusal (a misreport, since fixed — an unreachable `robots.txt` is now a
  transport failure, not a robots decision); with the override the same scan
  fetched 21 postings.

> ❌ **Never** `NODE_TLS_REJECT_UNAUTHORIZED=0`, `--insecure`, `verify=False` or
> `--trusted-host`. Disabling verification to get past an interception proxy
> means you can no longer tell a proxy from an attacker.

---

## 7. Lost owner access

**Status: ⚠️ Unverified.**

**If bootstrap has not completed yet:** the token is still in `.env`.

```bash
grep '^SETUP_TOKEN=' .env
```

**If bootstrap has completed**, the setup route is **permanently closed**. A new
`SETUP_TOKEN` will not reopen it — that is the security property, not a bug
(`docs/spec/09_SECURITY_PRIVACY.md`).

Options, in order of preference:

1. **Password reset** — hosted mode only, and only if SMTP is configured. Local
   installations send no email.
2. **Reset the owner password directly in the database.** Requires generating an
   Argon2id hash with the same parameters the API uses. Take a backup first, and
   keep the API stopped while you do it.
3. **Start fresh, keeping your data.** Back up, recreate the workspace, restore
   the files — accepting the caveats in §3.

Do **not** re-run `scripts/setup.sh --force` expecting it to help: it rotates
`SESSION_SECRET` (logging everyone out) and `ENCRYPTION_KEY` (making stored
provider keys undecryptable) without reopening the closed setup route.

The one thing that does reopen setup is the owner deleting their workspace
(§8), which erases everything first. It is not a way to recover lost access.

---

## 8. Workspace deletion

**Status: ✅ Verified 2026-09-22** on a throwaway Compose project: the deletion
itself, and `restore.sh` of a pre-deletion backup re-deleting it, files
included. **Retrying a failed erasure** (below) is ⚠️ covered by the test suite
only.

The owner deletes their workspace from **Settings → Privacy**, typing the
confirmation word and their password (`DELETE /api/v1/workspace`). Nothing here
needs an operator unless the erasure fails.

### What happens, in order

1. **Access ends, in one transaction.** The workspace is marked `deleting`;
   every session and every paired device is revoked and the device tokens are
   destroyed; queued and running tasks are cancelled, so a worker holding a
   lease gets 409 on anything it sends; the deletion is written to
   `deletion_ledger`; and a receipt row is written to `workspace_deletions`.
2. **Erasure, in the same request.** Stored objects are removed (the whole
   `<FILES_ROOT>/<workspace-id>/` directory, so orphaned objects go too), then
   the workspace row, which cascades to every private table, then the owner
   account.
3. **On a local installation with no account left, setup reopens.** It still
   needs `SETUP_TOKEN` from `.env` and a local or private-network address. The
   token is the same one as before. To change it, edit `SETUP_TOKEN` in `.env`
   and restart `api`; do not run `setup.sh --force`, which rotates the other
   secrets too.
4. The browser lands on `/deleted/<id>`, which reads the receipt without a
   session. The receipt holds an id, a state, timestamps and a file count, and
   nothing that says whose workspace it was.

### If the erasure fails

A storage fault leaves the receipt in `erasing`. Access is already revoked; the
scheduler retries once a minute, and after five failed passes marks the receipt
`failed` with `failure_code = 'erasure_failed'`. The API log names the receipt
id and the underlying error (`workspace erasure pass failed`).

```sql
-- What is unfinished
SELECT id, state, attempts, requested_at, failure_code
  FROM workspace_deletions WHERE state <> 'completed';

-- After fixing the cause, hand it back to the scheduler
UPDATE workspace_deletions
   SET state = 'erasing', failure_code = NULL, attempts = 0, updated_at = now() - interval '1 minute'
 WHERE id = '<receipt id>';
```

Do **not** delete the workspace row by hand: the scheduler removes the stored
objects first, because afterwards nothing records which objects were the
workspace's.

### Backups

Deleting live data cannot edit a backup taken before it
(`docs/spec/03_DATA_MODEL.md`). Restoring such a backup re-deletes the
workspace: `restore.sh` replays the ledger against the database, removes the
owner account, reopens setup if no account is left, and removes the workspace's
directory from the restored files volume. The backup file itself still holds the
data until it is deleted or expires.

---

## Quick reference

```bash
docker compose ps                        # what is running and healthy
docker compose logs -f api               # follow API logs
docker compose logs worker --tail 100    # worker, recent
docker compose exec db psql -U jobgetter -d jobgetter

docker compose down                      # stop; DATA PRESERVED
docker compose down -v                   # stop; DATA DESTROYED. Back up first.

sh scripts/smoke.sh                      # end-to-end check
sh scripts/backup.sh --help              # every script has --help
```

**When you run one of these procedures for real, update its status in this
file.** ⚠️ → ✅ with a date is the whole point.
