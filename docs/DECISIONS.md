# Architecture decision log

Why things are the way they are, so the next person does not have to re-derive
it — or quietly undo it.

**ADR01–ADR09** are seeded verbatim in substance from
`docs/spec/14_SOURCES_AND_DECISIONS.md` and are part of the input specification.
Treat them as given.

**ADR10 onwards** are implementation decisions made during the M0 build, in
places the specification deliberately left open. Each records what was decided,
why, what it costs, and what would make us revisit it.

**Format:** `Status` is one of `Accepted`, `Proposed`, `Superseded by ADRnn`.
Append new ADRs at the end; do not renumber.

---

## From the specification

### ADR01 — Node.js/TypeScript API plus Python worker

**Status:** Accepted (specification)

A two-language split satisfies the owner's learning goal while giving each
language a distinct responsibility: Node owns persistence and workflow, Python
owns processing and automation.

**Cost:** two toolchains, two lockfiles, two CI paths, and a contract that has to
be generated for both rather than shared by import.

---

### ADR02 — One PostgreSQL-backed queue

**Status:** Accepted (specification)

The task queue lives in PostgreSQL. This avoids coupling two languages through a
queue library and avoids running extra infrastructure.

**Consequence:** no Redis, no Celery, no BullMQ, no Kafka, no separate broker.
`docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` and
`docs/spec/02_ARCHITECTURE.md` both prohibit adding one "merely to bridge
languages". If throughput ever genuinely demands a broker, that is a new ADR
with measurements attached — not a convenience.

---

### ADR03 — Node alone writes domain data

**Status:** Accepted (specification)

Workers return validated results under a lease; the API applies them inside a
transaction after ownership, revision and lease checks. Python performs no
database writes.

**Why it matters:** there is exactly one place where domain invariants are
enforced. A worker that could write directly would be a second, unreviewed
business API.

---

### ADR04 — Browser extension for hosted filling

**Status:** Accepted (specification)

Hosted form filling happens in a browser extension, inside the user's existing
sessions, rather than by centralising job-site credentials on a server.

**Why:** a hosted service holding users' job-site logins is a liability nobody
wants, and it is exactly the design that forces CAPTCHA and bot-detection
fights.

---

### ADR05 — Local desktop Python runner

**Status:** Accepted (specification)

Local browser automation is a Python process the user installs and pairs, with
`fill_local` as its only capability and a visible browser.

**Why:** a headless container cannot interact with a user's desktop browser
session, and pretending otherwise produces a feature that demos and then fails.
This is why `infra/worker.Dockerfile` excludes `fill_local` from the container
worker's capabilities (see ADR16).

---

### ADR06 — Approval plus manual final submit

**Status:** Accepted (specification)

The user approves a specific application snapshot; the final submit is theirs.
Unattended submission is separately gated at M7.

**Why:** it makes the initial scope testable, it keeps the failure mode "you did
not apply" rather than "we applied wrongly on your behalf", and it is the reason
the project does not need to fight anti-bot systems.

---

### ADR07 — Local and configurable cloud models, no silent fallback

**Status:** Accepted (specification)

Local (Ollama) and OpenAI-compatible cloud adapters sit behind one provider
interface. If the configured provider is unavailable, the system says so.

**Explicitly rejected:** automatic failover to a different provider. A user who
configured a local model for privacy reasons must never have their CV silently
sent to a cloud API.

---

### ADR08 — Configured public boards first

**Status:** Accepted (specification)

Discovery starts from boards the user configures and URLs they supply. Broad
search-based discovery is a later, bounded integration (M6).

**Why:** "we scan the whole internet" is not true, cannot be made true, and
would be a promise the product breaks on day one.

---

### ADR09 — Apache-2.0 is a proposal only

**Status:** Proposed — **pending owner approval before public release**

Apache-2.0 is proposed for adoption and permissive reuse. It is **not final**.
AGPL remains an alternative if the owner prioritises reciprocity for modified
network services. Appropriate advice should be taken first.

**Consequence of Apache-2.0:** competitors may reuse this code, including
commercially and in closed products. That is the deliberate trade for permissive
adoption.

**Reflected in:** `LICENSE`, `NOTICE`, `README.md`, `CONTRIBUTING.md` — all of
which say "proposed" rather than "licensed under", and must be updated together
when the owner decides.

---

## Implementation decisions (M0)

### ADR10 — Dependency and image versions are pinned to versions verified against the registry, never guessed

**Status:** Accepted · 2026-09-20

`docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` is explicit: _"pin compatible
patch versions and container digests at implementation. Check security support
then, do not invent latest versions."_

So nothing here is pinned from memory. Every version was resolved against the
registry that serves it, at implementation time, and the command used is
recorded next to the pin.

**Toolchain**, verified on the development host:

| Tool                | Version    | How                                               |
| ------------------- | ---------- | ------------------------------------------------- |
| Node                | `v24.13.0` | `node --version`                                  |
| pnpm                | `11.3.0`   | `pnpm --version`; also the `packageManager` field |
| Docker              | `29.8.0`   | `docker --version`                                |
| Docker Compose      | `v5.5.1`   | `docker compose version`                          |
| uv                  | `0.12.17`  | `uv --version`                                    |
| Python (uv-managed) | `3.12.14`  | inside the worker environment                     |

**Container images**, resolved with
`docker buildx imagetools inspect <ref> --format '{{.Manifest.Digest}}'` and
confirmed after pulling with
`docker image inspect <ref> --format '{{index .RepoDigests 0}}'`:

| Image                          | Digest                      | Runtime reported                         |
| ------------------------------ | --------------------------- | ---------------------------------------- |
| `postgres:17-alpine`           | `sha256:f02121de…d867995`   | PostgreSQL 17.11                         |
| `node:24-alpine`               | `sha256:ebfe2f90…905ec1c1`  | v24.21.0                                 |
| `python:3.12-slim-bookworm`    | `sha256:392307d2…eb23564e`  | Python 3.12.14                           |
| `nginx:1.29-alpine`            | `sha256:56168782…d9b830de`  | —                                        |
| `ghcr.io/astral-sh/uv:0.12.17` | `sha256:10787c68…ce7fa9acc` | `uv 0.12.17 (x86_64-unknown-linux-musl)` |

**GitHub Actions** are pinned by **full commit SHA**, not by tag, because a tag
can be moved and a commit SHA cannot. SHAs were resolved through the GitHub REST
API (`/releases/latest`, then `/git/ref/tags/<tag>`, dereferencing annotated tags
through `/git/tags/<sha>` — `pnpm/action-setup@v6.1.0` is annotated and needed
that extra step).

**Former gaps**, recorded in `IMPLEMENTATION_STATUS.md`:

- Both gaps closed on 2026-09-24, when Docker Hub answered. `ollama/ollama:0.34.0`
  is now pinned by digest (`sha256:684d8674…58e0ba`, resolved against Docker
  Hub), in `docker-compose.yml` and in `.env.example`. The `postgres` service
  container in CI now pins the same digest as Compose, because that digest
  resolved on Docker Hub itself, the registry CI pulls from, which is what ADR12
  asked for.

**Revisit when:** a CVE affects a pinned image, or before any release. The pins
are a snapshot of 2026-09-20, not a permanent truth.

---

### ADR11 — TypeBox is the single authoritative schema source

**Status:** Accepted · 2026-09-20

TypeBox definitions in `packages/contracts/src/` are the one source of truth for
the HTTP surface. OpenAPI, the typed TypeScript client, the worker's Pydantic
models and the API's route registration are all **generated** from them.
`pnpm contracts:check` gates drift in CI and runs before every other job.

**Alternatives rejected:**

- _Hand-written OpenAPI as the source, generating types from it._ OpenAPI is a
  description format, not a validator. Fastify would still need a runtime schema,
  so there would be two artifacts to keep in step.
- _Zod._ Excellent ergonomics, but it does not emit JSON Schema natively, so
  generating Pydantic models for the Python side means another conversion layer.
  TypeBox **is** JSON Schema, which is exactly what Fastify validates with and
  what Pydantic can consume.
- _Three hand-written copies._ Explicitly forbidden:
  `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` — _"No handwritten parallel
  enum sets."_

**Cost:** contributors must remember to run `pnpm contracts:generate`. Mitigated
by the CI gate failing loudly with instructions.

---

### ADR12 — Registry is configurable; digests are ECR-mirror-resolved and said to be so

**Status:** Accepted · 2026-09-20

The development network is behind a **TLS-intercepting proxy**, and Docker Hub
was returning **HTTP 429 (anonymous pull rate limit)** during this work.
`docker pull postgres:17-alpine` failed outright. The AWS ECR Public mirror
(`public.ecr.aws/docker/library/*`) served the same images without rate limiting.

**Decision:**

1. `IMAGE_REGISTRY` is a variable, defaulting to `docker.io/library` — the
   canonical source. `public.ecr.aws/docker/library` is _documented_ as the
   fallback, not hardcoded as if it were canonical. It threads through
   `docker-compose.yml` and every Dockerfile as a build arg.

2. Images are pinned by **tag and digest**, where the digests were resolved
   through the ECR mirror. ECR Public mirrors Docker Hub content-addressed, so
   the digests are expected to be identical on `docker.io` — but that was **not
   re-verified against Docker Hub**, and every Dockerfile says so in a comment
   rather than implying a verification that did not happen.

   If Docker Hub ever serves a different digest for one of these tags, the pull
   **fails loudly**. That is the desired behaviour: a noisy failure beats a
   silent substitution.

3. The **CI `postgres` service container is pinned by tag only.** GitHub runners
   pull from Docker Hub; asserting an ECR-resolved digest in a job that never
   touches ECR would be claiming a verification against the wrong registry.

**Also:** nothing works around the TLS proxy by disabling certificate
verification. `services/worker/pyproject.toml` sets `[tool.uv] system-certs = true`
so uv uses the OS trust store, which already contains the proxy's CA.
`infra/worker.Dockerfile` documents how to add a corporate CA for the Playwright
download step, and does not offer an insecure shortcut.

**Revisit when:** the network changes, or before release when digests should be
re-resolved against Docker Hub directly.

---

### ADR13 — A hand-written Kysely database interface, not codegen

**Status:** Accepted · 2026-09-20

The `Database` interface Kysely is typed with is written and maintained by hand
rather than generated from a live schema by `kysely-codegen` or similar.

**Why:**

- **Codegen needs a live database.** A fresh clone, a CI job before migrations,
  or an offline build would all need a booted PostgreSQL just to typecheck. That
  is a circular dependency for a repository whose migrations are themselves part
  of the build.
- **Migrations are the source of truth, and they are already reviewed.** SQL
  migrations are small, ordered and read in review. A generated type file adds a
  second artifact that must be regenerated and re-reviewed for the same change.
- **The schema is small and stable.** A dozen or so tables for a
  single-workspace product. The cost of hand-maintenance is low; the cost of a
  build-time database dependency is not.
- **Domain types are narrower than column types.** Hand-writing lets the
  interface say `TaskState` where the column says `text`, which is the more
  useful type.

**Cost:** the interface can drift from the migrations. Mitigated by the Node
tests running against a **real** PostgreSQL created from the migrations — a
mismatch surfaces as a failing test, not as a runtime error in production.

**Revisit if:** the schema grows past roughly 30 tables, or drift bugs start
appearing in review.

---

### ADR14 — `setInterval` scheduling with PostgreSQL leases, not a broker or a cron container

**Status:** Accepted · 2026-09-20

Scheduled work — board scans, lease reclamation, expiry of staged artifacts and
retention sweeps — runs on plain intervals inside the API process. Coordination
between replicas is a PostgreSQL lease, the same mechanism the task queue uses.

**Why not a broker or a scheduler service:** ADR02 already rules out extra
infrastructure, and a scheduler is not a different problem from the queue. A
`SELECT FOR UPDATE SKIP LOCKED` lease already gives "exactly one worker picks
this up", which is the whole requirement.

**Why not a separate cron container:** it would need its own image, its own
database credentials and its own deployment, to do something the API process can
do in a few lines.

**Why not `pg_cron`:** it is an extension, so it would constrain which managed
PostgreSQL offerings the hosted beta could use, and it would put business logic
in the database where it is hard to test.

**Cost and mitigation:**

- Intervals drift and do not fire during downtime. Acceptable here: the scan
  interval is 24 hours _with jitter_, so drift is a feature, not a bug.
- Multiple API replicas would each hold a timer. The lease means only one
  actually does the work.
- **A long scheduled job must not block the event loop.** The scheduler enqueues
  tasks; the Python worker does the work.

**Revisit when:** a schedule needs to fire at a precise wall-clock time (for
example a hosted billing cycle), or when horizontal scaling makes the drift
visible to users.

---

### ADR15 — Health endpoint paths are a convention, not part of the versioned contract

**Status:** Accepted · 2026-09-20

`/health/live` (liveness, process only) and `/health/ready` (readiness —
database, schema and storage configuration) sit **outside** `/api/v1` and are
therefore not in `packages/contracts/src/routes.ts`.

**These are the paths the API actually registers**, read from
`apps/api/src/health.ts` on 2026-09-20 rather than assumed. An earlier draft of
this ADR proposed `/healthz` and `/readyz`; the infrastructure was corrected to
match the implementation, not the other way round.

**Why outside the versioned contract:** they are an operational interface for
Docker, a load balancer and an operator, not a product API. Versioning them
alongside business routes would imply a compatibility promise to API clients
that is not intended.

**Cost, and it is a real one:** the paths are a cross-component agreement, so
they can be got wrong independently by the API, the Dockerfile healthcheck and
the smoke script. This was not hypothetical — it happened during this build,
which is why the mitigations exist:

- `infra/api.Dockerfile`'s `HEALTHCHECK` uses `/health/live`.
- `scripts/smoke.sh` and `scripts/smoke.ps1` probe `/health/ready` first and
  then alternative spellings, so a future rename produces _"none of these paths
  answered"_ rather than an unexplained timeout. Overridable with
  `JG_READY_PATH`.
- Recorded as a known limitation in `IMPLEMENTATION_STATUS.md`.

**Semantics** (from `docs/spec/10_DEPLOYMENT.md`, detailed in
`docs/OPERATIONS.md`): liveness must **not** touch the database — a database
blip should not cause an orchestrator to kill a perfectly healthy process.

---

### ADR16 — The container worker excludes `fill_local`

**Status:** Accepted · 2026-09-20

`infra/worker.Dockerfile` defaults `WORKER_CAPABILITIES` to
`noop_echo,parse_profile` and documents that `fill_local` must never be added
there.

**Why:** the container is headless and has no access to the user's desktop
browser session. If it claimed `fill_local`, the API would lease it fill tasks
it cannot possibly perform, and the user would see failures instead of a clear
"use the desktop runner". This is ADR05 made concrete in configuration.

**Chromium is still installed** in that image — for **CV rendering** (HTML to
PDF), which is deterministic, offline and touches no third-party site. The
Dockerfile comment states the distinction so nobody later concludes "Chromium is
here, so browsing must be fine".

Hosted deployments follow the same rule: `docs/spec/02_ARCHITECTURE.md` —
_"hosted worker does no authenticated job-site browsing."_

---

### ADR17 — Backups exclude `.env`, and the restore script refuses to claim a verified restore

**Status:** Accepted · 2026-09-20

**Backups exclude `.env`.** `docs/spec/09_SECURITY_PRIVACY.md` requires the
operator encryption key to live _outside_ the database so that a stolen database
backup cannot decrypt stored provider API keys. Putting `.env` into the backup
would defeat exactly that.

To keep this from being a silent trap, `manifest.json` records
`sha256(ENCRYPTION_KEY)` truncated to 8 hex characters — a **match indicator,
not the key**. `restore.sh` compares it against the target's key and tells the
operator up front whether stored provider keys will decrypt, instead of leaving
them to discover it weeks later.

**The restore script will not claim success it cannot justify.**
`docs/spec/10_DEPLOYMENT.md` requires a restore to _"reapply deletion ledger
before reopening access"_. The deletion ledger is M4 work and **does not exist**.

Three options were considered:

1. Silently skip it — rejected, it is the exact failure mode invariant 10
   exists to prevent.
2. Refuse to restore at all — rejected, it makes backups useless for the entire
   pilot.
3. **Restore, then refuse to call the result verified** — chosen. The script
   prints a loud, specific warning that data deleted after the backup timestamp
   may be resurrected, does **not** start the API, and lists explicitly what it
   did and did not verify. AT25 and AT11 are named as _not_ checked.

The pilot recovery targets — at most 24 hours data loss, restore within 4 hours
— are stated everywhere as **unvalidated targets**, because
`docs/spec/10_DEPLOYMENT.md` says to _"validate before claiming them"_ and that
validation has not happened.

**Revisit when:** M4 lands the deletion ledger. Then implement reapplication and
delete the guard — do not just delete the guard.

---

### ADR18 — Operator scripts ship in both POSIX `sh` and PowerShell

**Status:** Accepted · 2026-09-20

Every operator script exists twice: `scripts/*.sh` (POSIX, for Linux, macOS and
Git Bash) and `scripts/*.ps1` (Windows PowerShell). They are feature-equivalent.

**Why not one cross-platform script:** a Node or Python script would need its
toolchain installed _before_ `setup` runs, which is backwards for the script
whose job is to bootstrap the installation. A `sh`-only repository fails the
primary development platform for this project, which is Windows.

**Why not `make`:** not present on a default Windows install, and it is a task
runner rather than a place for the error handling and confirmation prompts these
scripts need.

**Shared rules enforced in both:**

- `set -eu` + `pipefail`, and `Set-StrictMode -Version Latest` with
  `$ErrorActionPreference = 'Stop'` — the PowerShell equivalent, without which a
  failing cmdlet merely writes to the error stream and the script carries on.
- Secrets come from a CSPRNG: `openssl rand` / `/dev/urandom`, and
  `System.Security.Cryptography.RandomNumberGenerator`. **Never** `$RANDOM` or
  `Get-Random`.
- Secrets never appear in a process argument list — request bodies go through a
  file or `ConvertTo-Json`, so `ps` cannot read them.
- `.env` is read key-by-key and **never sourced**: sourcing it would execute the
  file and load every secret into the process environment.
- Both target Windows PowerShell **5.1** as well as 7+, so no ternary, no `??`,
  no `-AsHashtable`.

`.editorconfig` enforces LF line endings. A `#!/bin/sh` script saved with CRLF
fails inside a Linux container with a famously unhelpful error.

---

### ADR19 — Web is served by nginx as a non-root user on port 8080

**Status:** Accepted · 2026-09-20

`infra/web.Dockerfile` builds on the stock `nginx:1.29-alpine` but runs as the
`nginx` user, listening on **8080**, with `pid` and all `*_temp_path` directives
relocated to `/tmp`, and ships a **complete** `nginx.conf` rather than a
`conf.d` fragment.

**Why 8080:** ports below 1024 need `CAP_NET_BIND_SERVICE`. Compose publishes
`127.0.0.1:3000 -> 8080`, so the user-facing URL is unchanged.

**Why a full `nginx.conf`:** `pid` and the temp-path directives only exist at the
top level, and both must move for a non-root worker to start.

**Why `ENTRYPOINT ["nginx", ...]` instead of the image's entrypoint:** the stock
`/docker-entrypoint.sh` helpers assume a writable `/etc/nginx/conf.d` and a root
user. Bypassing them is more predictable than fighting them.

**Why not `nginxinc/nginx-unprivileged`:** it solves the same problem, and it was
evaluated — but the digest verified and cached on the build host during this work
was for `nginx:1.29-alpine`. Pinning an image whose digest had been confirmed
mattered more than saving a few lines of configuration.

`/api/` is proxied to the API service. `/internal/` deliberately has **no
location block**, so the worker task protocol is unreachable through the public
origin.

---

### ADR20 — CI is honestly red rather than dishonestly green

**Status:** Accepted · 2026-09-20

At the time the CI workflow was written, `apps/api` and `apps/web` had manifests
but no source trees. The `node-quality`, `node-test`, `worker` and
`compose-build` jobs therefore **fail**.

They are **not** marked `continue-on-error`. A job that always passes tells you
nothing, and dressing an unfinished build as a green tick is the CI equivalent
of a button that reports success without a backend — which invariant 10 forbids.

Instead, the header of `.github/workflows/ci.yml` names exactly which jobs are
expected to fail and why, with an instruction to delete each line as the
corresponding milestone lands. `IMPLEMENTATION_STATUS.md` carries the same
information.

The `contracts`, `fixtures` and `hygiene` jobs should pass today, so the signal
is not worthless while the rest is red.

**Revisit:** delete this ADR's premise as each milestone lands. If the list at
the top of `ci.yml` is empty and jobs still fail, they are real failures.

_Update 2026-09-20:_ the premise is gone. Every job passes locally; the header
now says so and lists nothing as expected to fail.

### ADR21 — An intercepting TLS root enters image builds as a BuildKit secret, never as a layer

**Status:** Accepted · 2026-09-20

The development host re-signs every HTTPS connection: not a corporate proxy
but Norton Web Shield's SSL scanning, whose root the host trusts and no
container does. Every `apk add`, `corepack prepare`, `pnpm install`, `uv sync`
and Playwright download therefore failed inside `docker build`, and the
Dockerfiles could not be verified at all until this was addressed.

Three options were considered:

1. **Disable verification** (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `--insecure`,
   `verify=False`). Rejected without discussion: it removes the ability to
   tell an interception proxy from an attacker. The RUNBOOK already forbade
   it.
2. **Copy the root into the image** (`COPY root.crt
/usr/local/share/ca-certificates/ && update-ca-certificates`). This is what
   the RUNBOOK and `worker.Dockerfile` originally recommended. Rejected: it
   persists a third party's root in the runtime image for every future user
   of that image, which is a supply-chain liability unrelated to the
   application.
3. **A BuildKit secret** (`--mount=type=secret,id=build_ca`) mounted only for
   the duration of each network-touching `RUN`, with a guard (`if [ -f
/run/secrets/build_ca ]`) that makes it a no-op when absent. Chosen.

Per tool: Node tooling reads `NODE_EXTRA_CA_CERTS` (additive). uv reads
`SSL_CERT_FILE`, which _replaces_ the trust store, so the root is appended to
the system bundle in a temp file rather than used alone. `apt`, invoked by
`playwright install --with-deps`, reads a transient
`/etc/apt/apt.conf.d/99-build-ca` that is created and deleted inside the same
`RUN`. After building with the secret, `grep -rl Norton /etc/ssl
/usr/local/share/ca-certificates` inside the API and worker images finds
nothing, and neither the apt file nor the bundle survives.

**What building for the first time exposed.** None of these were visible to
any unit test, and each meant the documented `docker compose up --build`
could never have worked:

- `corepack prepare --activate` ran before `package.json` was copied, in both
  the api and web Dockerfiles; it reads the pnpm version from that file.
- `pnpm install --prod` after a dev install triggers a `node_modules` purge
  that pnpm ≥ 9 refuses without a TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`).
  Fixed with `--config.confirmModulesPurge=false`.
- The worker image could not import its own package: `uv sync` installs the
  project as an editable `.pth` pointer to `/repo/services/worker/src`, a path
  that exists only in the build stage. `--no-editable` copies it into
  site-packages.
- `infra/migrate.Dockerfile` was unreferenced, named the image wrongly and
  hard-coded a stale entrypoint path. Removed; Compose's `migrate` service
  reuses the API image.
- The `python3 make g++` toolchain in the API build stage was unnecessary:
  argon2 ships `argon2.musl.node`, which node-gyp-build selects on Alpine.
  Removing it is a smaller image and one fewer network step, not a
  workaround.

**Consequences.** On an intercepted host, build with
`--secret id=build_ca,src=.local/build-ca.pem` (the `.local/` directory is
gitignored) and then `docker compose up -d --no-build`. On a host without
interception nothing changes — but that path is verified only by
construction, because no such host was available. `docs/RUNBOOK.md` §6
documents the procedure and how to identify the intercepting root.

**Revisit:** if Docker Compose gains first-class secret support for `build`
in the versions this project targets, fold the secret into
`docker-compose.yml` so `docker compose up --build` works in one step on
intercepted hosts too.
