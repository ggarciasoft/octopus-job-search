# Job Getter

A self-hosted job-search assistant that keeps the human in charge: import your
own profile, track jobs from boards you choose, get an explained fit assessment,
generate a CV that contains nothing you did not actually do — and then submit the
application yourself.

> ### ⚠️ This does not work yet
>
> The repository is mid-**M0 (Foundation)**. The monorepo, dependency locks,
> API contracts, fixture corpus, containers and operator scripts exist. **The
> application does not.** `docker compose up --build` is not expected to succeed
> at this commit.
>
> **Read [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) before anything
> else.** It lists every requirement, every acceptance scenario and every
> milestone with its real status, plus the exact commands that have been
> observed to work and the ones that have not.
>
> Nothing here is marked done on the strength of code that has never been run.

"Job Getter" is an internal working name. **It is not a cleared brand** — no
trademark search has been done and the name may change before any public
release.

---

## What it is

One job seeker, one workspace, one machine you control.

- **Your data stays where you put it.** Self-hosted by default. No telemetry, no
  account required, no phone-home. Local inference or your own AI keys.
- **Truthful output.** The CV generator is constrained to facts you confirmed. It
  cannot invent an employer, a date, a degree, a certification, a work
  authorization or an achievement number.
- **Explained fit, not a magic number.** A match score is a heuristic fit
  measure, qualified by how much it actually knows. It is _not_ a probability of
  being hired, and it is never presented as one.
- **Unknown stays unknown.** Missing salary, sponsorship or location eligibility
  is shown as unknown. It never quietly becomes a positive match.
- **You press submit.** Always.

## What it is not

These are permanent design positions, not unfinished features:

- ❌ **No exhaustive internet scan.** It reads the boards you configure and the
  URLs you give it. It does not and will not claim to see every job.
- ❌ **No guaranteed interviews, and no guaranteed anything.** There is no
  credible way to promise an outcome and this project will not pretend
  otherwise.
- ❌ **No ATS bypass.** Read access to a public job board is not permission to
  submit through it.
- ❌ **No automatic submission.** You approve a specific application snapshot and
  perform the final submit in your own browser. Not in the pilot, not in the
  hosted beta.
- ❌ **No LinkedIn scraping and no Easy Apply automation.** You can paste text or
  a link you have yourself; that is the whole of the LinkedIn story.
- ❌ **No CAPTCHA solving**, no proxy rotation, no fingerprint spoofing, no
  restriction bypass of any kind. When a page asks for a login, a CAPTCHA or an
  identity check, the tool stops and hands control back to you.
- ❌ **No selling your CV data.** Ever. No user data for model training or
  analytics by default.

---

## Quickstart

**The full walkthrough, including the browser extension and how well each step
has been verified, is [`docs/INSTALL.md`](docs/INSTALL.md).** The short version,
from `docs/spec/10_DEPLOYMENT.md`, verified on Windows 11 with Docker Desktop:

**Requirements:** Docker with Compose v2, and about 8 GB of RAM _without_ a local
model. Local model requirements depend entirely on which model you choose and
must be measured, not assumed.

```bash
# 1. Configuration
cp .env.example .env

# 2. Generate local secrets. Prints a one-time setup token, once.
sh scripts/setup.sh          # Linux, macOS, Git Bash
# pwsh -File scripts/setup.ps1   # Windows PowerShell

# 3. Start the stack
docker compose up --build -d

# 4. Open http://localhost:3000 and complete one-time setup
#    using the token step 2 printed.
```

Optional local model profile — **you must choose and download a model yourself,
under its own licence**:

```bash
docker compose --profile local-ai up -d
docker compose --profile local-ai exec ollama ollama pull <the-model-you-chose>
# then set PROVIDER_DEFAULT=ollama and LOCAL_MODEL_BASE_URL=http://ollama:11434
```

Already running a model server? Skip the profile and point
`LOCAL_MODEL_BASE_URL` at it instead.

To check the whole chain really works — web → API → queue → Python worker →
stored result:

```bash
sh scripts/smoke.sh          # pwsh -File scripts/smoke.ps1 on Windows
```

That script is the M0 exit criterion. It exits non-zero and prints the actual
response body on any failure. It passes through the nginx proxy on
`127.0.0.1:3000`.

### Your data

`docker compose down` stops the stack and **keeps your data** — the database and
your files live in named volumes.

**`docker compose down -v` deletes them.** Every profile, every job, every CV,
every application. Take a backup first: `sh scripts/backup.sh`.

---

## Architecture in a few lines

```
Browser ──► web (nginx, static React bundle, /api proxied)
              │
              ▼
           api (Node 24, Fastify) ──► PostgreSQL 17
              │      owns ALL persistence, validation,       (also the task queue —
              │      authorization, task leases, scheduling   no Redis, no broker)
              │
              ▼  outbound polling, never inbound
           worker (Python 3.12) — parse, normalize, match, render
```

- **Node owns persistence and workflow. Python owns processing.** The worker
  never writes to the database and never exposes a public API; it polls the API
  for work, does the job, and returns a validated result under a lease.
- **PostgreSQL is the queue.** One `SELECT FOR UPDATE SKIP LOCKED` lease, a
  120-second lease with a 30-second heartbeat. No Redis, no Celery, no BullMQ,
  no Kafka, no Kubernetes, no vector database.
- **Schemas are generated, not hand-written twice.** TypeBox definitions in
  `packages/contracts` are the single source of truth; OpenAPI, the TypeScript
  client and the worker's Pydantic models are all derived from them, and CI
  fails on drift.
- **Local browser filling is a local process.** A headless container cannot
  drive your desktop browser, so it does not pretend to: form filling is a
  desktop runner you pair, or (from M5) a browser extension. Your job-site
  cookies never leave your machine.
- **Models get no tools.** No browser, no shell, no database, no secrets. Model
  output is validated against a closed schema and checked against a fact
  allowlist before anything is done with it.

More detail: [`docs/spec/02_ARCHITECTURE.md`](docs/spec/02_ARCHITECTURE.md).

---

## Source support matrix

From `docs/spec/05_DISCOVERY_CONNECTORS.md`. A source appears as supported only
once it has a connector tested against fixtures — an untested integration is
never shown as a working one, and the two columns are scored separately because
reading a board and filling its application form are different claims.

| Source                       | Discovery                                         | Application handling                                | Status today                                                                                                                                  |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Greenhouse public job boards | Known board token, public listing/detail reads    | Browser form adapter, no employer API key           | Discovery **works**, verified against Greenhouse's own public board. Fill adapter `greenhouse/v1` **tested against a synthetic fixture only** |
| Lever public postings        | Known site slug, public postings feed             | Browser form adapter                                | Discovery **works**, fixture-tested. Fill adapter **not implemented**                                                                         |
| User-pasted description      | Supported with your own provenance                | Opens the application URL; manual fallback          | Discovery **works**. Filling is manual                                                                                                        |
| Company job URL              | Public page fetch, JSON-LD `JobPosting` first     | Generic assistance only unless an adapter is tested | Discovery **works**. No adapter, so filling is manual                                                                                         |
| Additional company discovery | Optional search API adapter                       | Depends on the resolved ATS adapter                 | **Not implemented** (planned M6)                                                                                                              |
| LinkedIn                     | Job text or a link **you** provide — nothing else | Use the website yourself                            | **Not implemented**, and scraping/Easy Apply never will be                                                                                    |
| Workday and other ATS        | Save the URL or the text                          | Manual                                              | **Not implemented**                                                                                                                           |

"Tested against a synthetic fixture only" is the honest description of the
Greenhouse fill adapter and it is doing real work in that sentence. The adapter
is driven by a real Chromium against a page built to Greenhouse's shape, in
`fixtures/ats-pages/greenhouse-application.html`. It has never run against a
live Greenhouse board, and no application has been submitted through it. When a
page has no tested adapter the runner says so and leaves the form alone rather
than filling it approximately.

Nothing in this product ever presses submit. That is a permanent design
position, not a milestone.

Public listing APIs are not a directory of employers. Boards are seeded by hand.

---

## Repository layout

```
apps/web/            React + Vite + TypeScript
apps/api/            Fastify + TypeScript, SQL persistence, scheduler
apps/extension/      Chrome Manifest V3 (M5 — empty today)
services/worker/     Python processing and the optional local browser runner
packages/contracts/  TypeBox schemas; generated OpenAPI and types
packages/api-client/ generated typed client
packages/ui/         shared UI primitives
infra/               Dockerfiles and reverse-proxy configuration
fixtures/            synthetic CVs, jobs, ATS pages, model responses
scripts/             setup, migrate, smoke, backup, restore, dev
docs/                specification, decisions, operations, runbook
```

## Scripts

Every script has `--help`. POSIX `sh` versions run on Linux, macOS and Git Bash;
`.ps1` versions are the equivalents for Windows PowerShell.

| Script                       | What it does                                                                |
| ---------------------------- | --------------------------------------------------------------------------- |
| `setup.sh` / `setup.ps1`     | Create `.env`, generate random secrets, print the one-time setup token once |
| `migrate.sh` / `migrate.ps1` | Run database migrations, via Compose or locally                             |
| `smoke.sh` / `smoke.ps1`     | End-to-end check against a running stack (the M0 exit criterion)            |
| `backup.sh` / `backup.ps1`   | Encrypted `pg_dump` + files archive with a manifest and checksums           |
| `restore.sh` / `restore.ps1` | Restore, including into a separate installation                             |
| `dev.sh` / `dev.ps1`         | Dev loop: database in Docker, API/web/worker on the host                    |

## Documentation

| Document                                               | What is in it                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) | **Start here.** What works, what does not, what has actually been run            |
| [`docs/INSTALL.md`](docs/INSTALL.md)                   | Install, first run, the extension or desktop runner, a first fill                |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                   | Dev setup, the contracts-are-generated rule, test layers, connector requirements |
| [`SECURITY.md`](SECURITY.md)                           | How to report a vulnerability, and the threat model                              |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)               | ADR log — why things are the way they are                                        |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md)             | Logging, metrics, alerts, health endpoints — and which exist                     |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md)                   | First run, migration, backup/restore, stalled queue, upgrade                     |
| [`fixtures/README.md`](fixtures/README.md)             | Fixture policy: synthetic only, never a real CV                                  |
| [`docs/spec/`](docs/spec/)                             | The immutable input specification this is built from                             |

---

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

**This is a proposal, not a final decision.** `docs/spec/14_SOURCES_AND_DECISIONS.md`
(ADR09) records Apache-2.0 as the proposed licence _pending the owner's approval
before public release_. AGPL remains an alternative if reciprocity for modified
network services turns out to matter more than permissive reuse. A permissive
licence means competitors may reuse this code commercially — that is the
trade-off being made deliberately.

## Status of the honest bits

This project deliberately says "not implemented" rather than shipping a button
that reports success. If you find somewhere it claims a capability it does not
have, that is a bug worth reporting — it violates the rule the whole thing is
built on.
