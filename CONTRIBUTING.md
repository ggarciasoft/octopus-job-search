# Contributing to Job Getter

Thanks for looking. Before you invest time in a change, two things:

1. **Read [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).** Most of this
   product is not built. The application does not run yet. Knowing that saves
   you from "fixing" something that was never written.
2. **Read the [Not negotiable](#not-negotiable) section below.** A few
   categories of contribution will be declined regardless of code quality. They
   are listed up front so nobody wastes a weekend on one.

The specification in [`docs/spec/`](docs/spec/) is the authoritative input for
this build and is **immutable**. If you think it is wrong, say so in an issue or
a PR description — do not edit it.

---

## Not negotiable

These will not be merged. Not as an option, not behind a flag, not "for testing".

- **Bypass tooling.** CAPTCHA solving or evasion, proxy rotation, fingerprint
  spoofing, rate-limit evasion, or anything else designed to get around a site's
  access controls.
- **Hidden data collection.** Telemetry that is not opt-in, analytics that are
  not disclosed, any phone-home, or anything that sends user content anywhere
  the user did not choose.
- **Scraping a site whose terms prohibit it.** Including LinkedIn. Manual and
  paste-based workflows exist precisely so bypass is never necessary.
- **Automatic submission.** The user approves a snapshot and submits it
  themselves. This is invariant 4, and it is why the project is defensible.
- **A model that can invent facts.** Anything that could put an employer, a
  date, a degree, a certification, a work authorization or an achievement number
  into a CV without the user having confirmed it.
- **A button that lies.** No UI element may report success for a backend that
  does not exist. If a capability is missing, the interface says so. This is
  invariant 10 and it is enforced in review.
- **Making self-hosting depend on a hosted service**, a licence server, a
  credit card, or any account we control.

Everything else is fair game, and connector contributions are genuinely wanted.

---

## Development setup

**Toolchain**, versions verified on 2026-09-20:

| Tool   | Version                     | Notes                                                                                    |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------- |
| Node   | 24.x (`v24.13.0` verified)  | `package.json` pins `>=24.0.0 <25`                                                       |
| pnpm   | 11.3.0                      | Pinned by the `packageManager` field                                                     |
| Python | 3.12.x (`3.12.14` verified) | Managed by uv; `pyproject.toml` pins `>=3.12,<3.13`                                      |
| uv     | 0.12.17                     |                                                                                          |
| Docker | with Compose **v2**         | v1 `docker-compose` is not supported — it cannot express the migrate-before-api ordering |

```bash
corepack enable && corepack prepare --activate   # gets you the pinned pnpm
pnpm install --frozen-lockfile

cp .env.example .env
sh scripts/setup.sh              # pwsh -File scripts/setup.ps1 on Windows
```

Two ways to run it:

```bash
# Full stack, closest to what ships
docker compose up --build -d

# Dev loop: database in Docker, API/web/worker on the host with hot reload
sh scripts/dev.sh                # pwsh -File scripts/dev.ps1
```

`scripts/dev.sh` serves the UI on **5173** (Vite), not 3000. Point the smoke
test at the API directly in that mode:
`sh scripts/smoke.sh --base-url http://127.0.0.1:8080`.

### Lockfiles

**Never** commit a manifest change without the matching lockfile update in the
same commit. CI installs with `--frozen-lockfile` (pnpm) and `--frozen` (uv), so
a mismatch fails the build rather than silently resolving something new.

```bash
pnpm add -w --filter @job-getter/api some-package    # updates pnpm-lock.yaml
cd services/worker && uv add some-package            # updates uv.lock
```

Be ready to say in the PR why a new dependency is needed. The project keeps its
surface small on purpose.

---

## Contracts are generated. Do not hand-write them twice.

This is the rule most likely to trip you up, so it gets its own section.

**`packages/contracts/src/**` is the single source of truth** for the HTTP
surface. TypeBox schemas there generate:

- the OpenAPI document,
- the typed TypeScript client in `packages/api-client`,
- the Pydantic models the Python worker validates against,
- and the route table the API registers.

So:

```bash
# After changing anything under packages/contracts/src/
pnpm contracts:generate

# What CI runs. Fails if the committed artifacts do not match the schemas.
pnpm contracts:check
```

- ✅ Edit `packages/contracts/src/`, run `contracts:generate`, commit both.
- ❌ Never hand-edit `packages/contracts/generated/`.
- ❌ Never write a second copy of an enum, a type or a schema that already
  exists in contracts. `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md`: _"No
  handwritten parallel enum sets."_

The **drift gate** (`contracts` job in CI) runs before everything else. If it
fails, nothing downstream is trustworthy — the API, the web client and the
worker would be compiled against three different versions of the same contract.

New route or task type? Expand its input and output into a **closed** JSON
Schema (`additionalProperties: false`), supply valid _and invalid_ fixtures, and
regenerate.

---

## Test layers

From `docs/spec/11_TESTING_ACCEPTANCE.md`. Different layers exist because they
catch different things.

| Layer            | Where                             | Runs against                    | Catches                                                                      |
| ---------------- | --------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| Node domain/API  | `apps/api/tests/` (Vitest)        | A **real ephemeral PostgreSQL** | Workspace scope, constraints, revisions, task leases                         |
| Python unit      | `services/worker/tests/` (pytest) | Fixtures                        | Extraction, normalization, scoring, fact validation, provider output parsing |
| Contract         | `packages/contracts/tests/`       | Generated artifacts             | Schema/type drift between the three languages                                |
| Browser          | (M4+)                             | Local **synthetic** ATS forms   | Form filling. No external submissions, ever                                  |
| Manual usability | —                                 | A real profile, with consent    | Whether it is actually useful                                                |

```bash
pnpm test                                     # all Node tests
pnpm --filter @job-getter/api test            # just the API
cd services/worker && uv run pytest           # Python
cd services/worker && uv run ruff check . && uv run mypy
```

**A real database, not a mock.** The task queue is
`SELECT FOR UPDATE SKIP LOCKED`; a mocked client cannot exercise it, and the
lease mechanism is the part most likely to be subtly wrong. CI uses a PostgreSQL
17 service container. Locally, `@testcontainers/postgresql` is available.

**Write meaningful tests.** `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md`:
_"Implement meaningful behavior tests, not tests that only repeat mocks or
setters."_ A test that asserts a mock was called with what you just told it to
be called with has verified nothing.

**Deterministic CI.** Fake AI providers and local ATS fixtures only. No live
third-party calls in CI. Live tests are opt-in and never submit to a real
employer.

**Record real output.** If something still fails, say so in the PR. A documented
failure is fine; an undocumented one is not.

---

## Connector contributions

Wanted — with conditions. A connector is a maintenance commitment: sites change
their markup and their policies, and every supported source has to keep working
or be honestly marked as broken.

**Use the connector request issue template.** It enforces the two mandatory
items:

### 1. Fixtures

Saved sample responses the connector is tested against **offline**. CI must
never depend on a live third party.

- Synthetic, or captured from a genuinely public page.
- **No personal data.** No real names, emails, phone numbers or anyone's real
  employment history. See [`fixtures/README.md`](fixtures/README.md).
- Enough variety to mean something: a happy path alone is not enough. Include
  the empty board, the missing salary, the closed posting.
- For a **form adapter**, the fixture list in
  `docs/spec/11_TESTING_ACCEPTANCE.md` applies: text/select/radio/checkbox
  fields, repeated labels, a required unknown question, a file attachment, a
  multi-step form, a validation error, an iframe needing manual assistance, a
  changed fingerprint, a confirmation page and a timeout.

### 2. Policy documentation

Every connector declares `policy_review_url` and `policy_review_date`, and the
PR must quote the relevant clause.

- If the policy **prohibits** automated access, the answer is a paste/manual
  mode, not a connector. That is a perfectly good outcome and the project is
  designed for it.
- A review with no date is not a review. Policies change.
- Read access does **not** imply permission to submit. Greenhouse's public job
  board API is readable; its submission endpoint needs employer credentials, and
  we do not assume any.

### Connector contract

Declare `id`, `version`, `allowed_hosts`, `capabilities`, `config_schema`,
`rate_policy`, `policy_review_url` and `policy_review_date`. Implement
`discover(config, cursor)`, `get_job(external_id)` and `healthcheck()`. HTML
form adapters are separate from discovery connectors.

Be polite by default: per-host concurrency 1, at least one second between
requests, a 24-hour scan interval with jitter, a 20-second timeout, at most 1000
jobs per scan and 100 pages. Honour `Retry-After`; stop on repeated 403/429 and
surface source health. These defaults are good manners — they do not themselves
constitute permission to crawl.

**Never invent a field.** No source? The value stays null. An inferred value
carries `inferred: true` and a source excerpt. A published date is never guessed.

### Support badges reflect reality

A source appears as supported only after it passes against fixtures. Until then
the matrix in `README.md` says **not implemented**, and the UI says the same.

---

## Pull requests

The [PR template](.github/pull_request_template.md) has the full checklist. The
two that get checked hardest in review:

- **No secrets or personal CVs in this diff.** No `.env`, no keys, no tokens, no
  real CV, no real name or employment history. CI has a hygiene job, but it
  cannot catch a real CV that has been renamed.
- **Contracts regenerated if schemas changed.**

Also:

- One logical change per PR.
- Paste **actual** test output, not a description of it.
- Update `IMPLEMENTATION_STATUS.md` if you changed what works. It is written to
  be edited row-by-row; the HTML comment at the top explains the status words.
- Update documentation in the same PR as the change it describes.

### Style

Formatting is automated. Do not argue with it.

```bash
pnpm format         # Prettier over TS/TSX/JSON/MD/YAML
pnpm lint           # ESLint
cd services/worker && uv run ruff format . && uv run ruff check --fix .
```

TypeScript is `strict`. Python is `mypy --strict`. `.editorconfig` enforces LF
endings everywhere — a shell script with CRLF endings will not run inside a
Linux container.

---

## A note on the environment

Development for this build happened on a network with a **TLS-intercepting
proxy**, which is why `services/worker/pyproject.toml` sets
`[tool.uv] system-certs = true`. Docker Hub also returns HTTP 429 from some
networks. Neither is worked around by disabling certificate verification.
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) → "Registry rate limits and TLS
interception" has the details if you hit it.

## Licence of contributions

Contributions are accepted under [Apache-2.0](LICENSE), the project's proposed
licence. Note that ADR09 records this as a **proposal pending the owner's
decision before public release**; AGPL remains an alternative. If that matters
to you, ask before investing significant effort.
