# Implementation status

**Last updated: 2026-09-20** · Milestone in progress: **M0 (Foundation)**

This file is required by `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` and by
the progress-record template in `docs/spec/12_IMPLEMENTATION_PLAN.md`. It is the
single honest answer to "does this actually work yet?"

> **Nothing in this file may be marked complete on the strength of generated
> code alone.** `docs/spec/12_IMPLEMENTATION_PLAN.md`: _"Never mark complete
> based only on generated code."_ A row moves to **Implemented** when the code
> exists and has been run. It moves to **Tested** only when a test asserting the
> behaviour has been executed and its output recorded — either in the "Verified
> commands" section below or in a linked CI run. If you cannot point at output,
> the row is **Not started** or **In progress**.

<!--
  HOW TO UPDATE THIS FILE (for the agent or human working on the next slice)

  The tables are plain GitHub-Flavoured Markdown and are meant to be edited
  row-by-row. Change only the rows you own:

    * Implementing PR05? Edit the PR05 row and the M2 row. Leave the rest.
    * Getting AT01 to pass? Edit the AT01 row: set the status, and put the real
      path of the test in the "Where the test lives" column.
    * Ran a command successfully? Append it to "Verified commands" with a
      one-line summary of its actual output. Do not add a command you have not
      run.

  Use exactly these status words so the file stays greppable:

    Not started   nothing exists
    In progress   code exists but does not work end to end
    Implemented   works when run by hand; no automated test asserts it yet
    Tested        an executed test asserts it; output recorded or CI linked
    Blocked       cannot proceed; the Notes column must say what is blocking
    Deferred      deliberately postponed; the Notes column must say until when

  Keep the "Last updated" date at the top current.
-->

---

## Summary

|                                     |                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional requirements implemented | 0 of 14                                                                                                                                              |
| Acceptance scenarios passing        | 0 of 28                                                                                                                                              |
| Milestones complete                 | 0 of 8 (M0–M7)                                                                                                                                       |
| Verified working today              | Toolchain; `pnpm typecheck`, `pnpm lint`, `pnpm contracts:check`; the fixture corpus (46/46); Compose config parsing; every operator script's syntax |
| **Never executed**                  | **The stack itself. No container in this project has ever been built or run, and the end-to-end smoke test has never passed.**                       |

If you came here from the README looking for a product: there isn't one yet.
Source exists and it typechecks — that is not the same as working, and this file
does not treat it as the same.

---

## Functional requirements (PR01–PR14)

From `docs/spec/01_PRODUCT_REQUIREMENTS.md`.

| ID   | Requirement                                                      | Milestone | Status      | Notes                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR01 | Create and edit profile manually                                 | M1        | Not started | Schemas exist in `packages/contracts/src/schemas/profile.ts`. The API's implemented routes are `setup`, `auth`, `me`, `files`, `tasks`, `diagnostics` and `internal` — no profile route. The web app has `Setup`, `Login`, `Dashboard`, `Tasks` and `Diagnostics` pages — no profile page.                    |
| PR02 | Import PDF/DOCX or pasted text; review extracted fields          | M1        | Not started | `parse_profile` contract and fixtures exist (`fixtures/cvs/`); no parser.                                                                                                                                                                                                                                     |
| PR03 | Record titles, skills, locations, salary, languages, eligibility | M1        | Not started |                                                                                                                                                                                                                                                                                                               |
| PR04 | Import job URL or description; configure company boards          | M2        | Not started |                                                                                                                                                                                                                                                                                                               |
| PR05 | Fetch Greenhouse and Lever listings, deduplicate and refresh     | M2        | Not started | **No connector is implemented.** The README support matrix marks every source not implemented, and must stay that way until fixtures pass (invariant 10).                                                                                                                                                     |
| PR06 | Explain fit, missing requirements and unknown eligibility        | M3        | Not started |                                                                                                                                                                                                                                                                                                               |
| PR07 | Generate truthful tailored PDF/DOCX CV, or preserve original     | M3        | Not started | Chromium is installed in `infra/worker.Dockerfile` for this, but nothing renders yet.                                                                                                                                                                                                                         |
| PR08 | Reviewable application packet and answer bank                    | M4        | Not started |                                                                                                                                                                                                                                                                                                               |
| PR09 | Autofill tested forms locally; final submit manual               | M4        | Not started | No form adapter exists. The container worker deliberately excludes `fill_local`.                                                                                                                                                                                                                              |
| PR10 | Track outcome with evidence, history, duplicate prevention       | M4        | Not started |                                                                                                                                                                                                                                                                                                               |
| PR11 | Configure providers, prompts, weights, limits, connectors        | M3–M5     | Not started |                                                                                                                                                                                                                                                                                                               |
| PR12 | Hosted app plus extension, accounts, quotas, isolation           | M5–M6     | Not started | `apps/extension/` is an empty directory.                                                                                                                                                                                                                                                                      |
| PR13 | Discover company pages through an optional search API            | M6        | Not started |                                                                                                                                                                                                                                                                                                               |
| PR14 | Export/delete user data; backup/restore local installation       | M4        | In progress | `scripts/backup.sh`/`.ps1` and `scripts/restore.sh`/`.ps1` exist and are syntax-checked but have **never been run against a populated installation**. Export/delete are not started. **The deletion ledger does not exist**, so `restore.sh` explicitly refuses to claim a verified restore — see its header. |

---

## Acceptance scenarios (AT01–AT28)

From `docs/spec/11_TESTING_ACCEPTANCE.md`. "Where the test lives" is filled in
when a test exists; `—` means there is no test.

| ID   | Scenario                                                                    | Status      | Where the test lives                                                                                            |
| ---- | --------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| AT01 | Clean Compose start: health passes, schema created, owner setup works       | Not started | — (`scripts/smoke.sh` is written to exercise this once M0 lands)                                                |
| AT02 | Text PDF/DOCX import gives editable extraction with provenance              | Not started | — (fixtures ready: `fixtures/cvs/text-cv.pdf`, `text-cv.docx`)                                                  |
| AT03 | Scanned/encrypted/malformed CV gives an explicit error, no invented profile | Not started | — (fixtures ready: `scanned-cv.pdf`, `encrypted-cv.pdf`, `malformed.pdf`, `malformed.docx`, `mislabelled.docx`) |
| AT04 | Conflicting profile import preserves verified facts until resolved          | Not started | — (fixture ready: `fixtures/model-responses/parse_profile.conflicting.json`)                                    |
| AT05 | Board fetch with duplicate jobs yields one canonical job with provenance    | Not started | —                                                                                                               |
| AT06 | Failed/partial board scan does not close missing jobs                       | Not started | —                                                                                                               |
| AT07 | Remote job restricted to US: non-US eligibility not assumed                 | Not started | —                                                                                                               |
| AT08 | Unknown currency/period: no invalid comparison or silent conversion         | Not started | —                                                                                                               |
| AT09 | Prompt-injected job description: no instruction execution                   | Not started | — (fixture ready: `fixtures/cvs/prompt-injection-cv.pdf`)                                                       |
| AT10 | Generated CV adding a numeric claim is blocked or flagged                   | Not started | —                                                                                                               |
| AT11 | Original CV mode: downloaded bytes SHA-256 identical to upload              | Not started | —                                                                                                               |
| AT12 | PDF/DOCX render: text extractable, accents intact, nothing clipped          | Not started | — (fixture ready: `fixtures/cvs/text-cv-es.pdf`)                                                                |
| AT13 | Editing a packet after approval rejects the old approval                    | Not started | —                                                                                                               |
| AT14 | Unknown required form question pauses without guessing                      | Not started | —                                                                                                               |
| AT15 | Two simultaneous fill requests: only one session, second conflicts          | Not started | —                                                                                                               |
| AT16 | Submit observation times out -> `outcome_unknown`, no retry                 | Not started | —                                                                                                               |
| AT17 | Unsupported ATS: honest manual fallback, packet saved                       | Not started | —                                                                                                               |
| AT18 | Worker crash/reclaim: exactly one committed result, stale lease rejected    | Not started | —                                                                                                               |
| AT19 | Different workspace UUID requested: 404/403, no leak                        | Not started | — (required by API design from the first migration, not just at M6)                                             |
| AT20 | Private IP or redirect fetch blocked, including IPv6 and rebinding          | Not started | —                                                                                                               |
| AT21 | Cloud provider unavailable: no surprise switch, drafts preserved            | Not started | —                                                                                                               |
| AT22 | Budget exhausted: inference blocked, review/export still work               | Not started | —                                                                                                               |
| AT23 | Revoked extension token denied immediately                                  | Not started | —                                                                                                               |
| AT24 | Malicious page message cannot reach token/profile                           | Not started | —                                                                                                               |
| AT25 | Backup/restore: profile, files, hashes and history restored                 | Not started | — (`scripts/restore.sh` explicitly declines to claim this; it needs M1–M4 data to be meaningful)                |
| AT26 | Delete workspace: access revoked, files erased, completion recorded         | Not started | —                                                                                                               |
| AT27 | English/Spanish flow: labels, Unicode, dates, documents correct             | Not started | — (fixture ready: `fixtures/cvs/text-cv-es.pdf`)                                                                |
| AT28 | No AI configured: manual profile, job import and tracker usable             | Not started | —                                                                                                               |

**Release gate status:** the M4 pilot gate (AT01–AT18, AT20–AT22, AT25,
AT27–AT28) and the M6 hosted gate (all scenarios) are both **not met**. No
scenario passes.

---

## Milestones (M0–M7)

From `docs/spec/12_IMPLEMENTATION_PLAN.md`. Estimates there are planning ranges,
not commitments.

| ID  | Milestone                              | Status      | Exit criterion                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------- | ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0  | Foundation                             | In progress | A runnable empty installation with an end-to-end fake task                      | Monorepo, lockfiles, contracts package, fixture corpus, containers, Compose and operator scripts exist. The API and web source trees have landed and `pnpm typecheck` / `lint` / `contracts:check` all pass; the worker is still landing. **The stack has never been built or started, and `scripts/smoke.sh` — the M0 exit check — has never passed.** Code that typechecks is not a milestone. |
| M1  | Profile                                | Not started | Confirmed profile from fixtures; unknown/conflicting data visible               | Fixtures for this milestone already exist and verify.                                                                                                                                                                                                                                                                                                                                            |
| M2  | Job discovery                          | Not started | Fixture/live-read jobs discovered; duplicates and provenance correct            | **No connector exists.**                                                                                                                                                                                                                                                                                                                                                                         |
| M3  | Fit and CV                             | Not started | Reviewed CV in both formats; no unsupported facts; reproducible score           |                                                                                                                                                                                                                                                                                                                                                                                                  |
| M4  | Personal pilot                         | Not started | Ten user-reviewed real application workflows, or documented sandbox equivalents | Includes the deletion ledger that `scripts/restore.sh` currently has to work without.                                                                                                                                                                                                                                                                                                            |
| M5  | Open-source distribution and extension | Not started | A fresh user installs without developer intervention and fills supported pages  | The repository documentation half of this (README, CONTRIBUTING, SECURITY, NOTICE, issue templates, license) landed early with M0; the extension and packaging did not.                                                                                                                                                                                                                          |
| M6  | Hosted beta                            | Not started | Hosted user needs no server and cannot reach another user's data                |                                                                                                                                                                                                                                                                                                                                                                                                  |
| M7  | Optional unattended automation         | Deferred    | —                                                                               | Deliberately out of scope. `docs/spec/12_IMPLEMENTATION_PLAN.md`: "Do not treat M7 as needed for the personal project or beta." Needs a separate design, reliability and source-permission review before it is even scheduled.                                                                                                                                                                   |

---

## Known limitations and unsupported behaviour

Stated plainly, because a limitation that is not written down looks like a bug
to the next person.

### The application does not run yet

- **The stack has never been started.** `docker compose up --build` was
  deliberately not attempted while sources were landing in parallel, so the
  Dockerfiles in `infra/` have **never been built** and no container in this
  project has ever run.
- **`scripts/smoke.sh` — the M0 exit criterion — has never passed**, because
  there has never been a live stack to run it against. It and `smoke.ps1` are
  syntax-checked only.
- The Node side is further along than "no working installation" suggests:
  `pnpm typecheck`, `pnpm lint` and `pnpm contracts:check` all pass across the
  five workspace projects (verified 2026-09-20, output recorded below). What is
  missing is any evidence that the assembled system _runs_.
- CI is therefore **partly red**: `worker` fails (3 ruff errors, a formatting
  diff, and mypy finding no test files), `node-quality`'s `format:check` step
  fails on `docs/spec/**`, and `node-test`/`compose-build` are unverified. This
  is documented at the top of `.github/workflows/ci.yml` rather than hidden
  behind `continue-on-error`.

### No job source is supported

- Greenhouse, Lever, LinkedIn, Workday and generic company career pages are all
  **not implemented**. The support matrix in `README.md` says so, and no source
  may be shown as a working integration until it passes against fixtures
  (invariant 10).

### No AI, no CV generation, no automation

- No provider adapter, no local inference path, no scoring, no CV rendering, no
  application packets, no form filling, no tracker.
- The browser extension (`apps/extension/`) is an empty directory.
- There is **no automatic submission** and there will not be one in the pilot or
  the hosted beta. That is a permanent design position (invariant 4), not a gap.

### Backup and restore are incomplete by design

- `scripts/restore.sh` **cannot reapply a deletion ledger**, because the
  deletion ledger is M4 work and does not exist. The script prints a loud,
  explicit warning and declines to describe its result as a verified restore.
- The pilot recovery targets from `docs/spec/10_DEPLOYMENT.md` — at most 24
  hours data loss, restore within 4 hours — are **unvalidated targets**, not
  measured results. Nothing here is evidence that they are met.
- Backups exclude `.env`, and therefore `ENCRYPTION_KEY`. That is deliberate
  (`docs/spec/09_SECURITY_PRIVACY.md`), and it means a restore without that key
  recovers everything except stored provider API keys.

### Operational gaps

- **No metrics endpoint and no alerting exist.** `docs/OPERATIONS.md` lists the
  metrics and alerts the specification requires and marks each one
  not-implemented. Do not read that document as a description of a running
  system.
- The health endpoint **paths** (`/health/live`, `/health/ready`) are a
  cross-component convention, not part of the versioned `/api/v1` contract in
  `packages/contracts`. They were read from `apps/api/src/health.ts` rather than
  assumed, and the Dockerfile healthcheck and smoke scripts were corrected to
  match. `scripts/smoke.sh` still probes alternative spellings so a future
  rename reports clearly instead of timing out mysteriously.
- The anti-CSRF scheme is likewise not in the published contract. Read from
  `apps/api/src/auth/sessions.ts`: a readable `jg_csrf` cookie, echoed in the
  `x-csrf-token` header. The smoke scripts use that and fall back to other
  spellings.
- **The API build output path is inconsistent with its own start script.**
  `apps/api/tsconfig.json` (`rootDir: "."`, `include: ["src/**/*.ts",
"tests/**/*.ts"]`) emits `dist/src/server.js`, but `apps/api/package.json`'s
  `start` script says `node dist/server.js`. The container entrypoints try both
  paths so this cannot silently break the stack, but one of the two should be
  corrected. Flagged for the API owner.
- **`pnpm format:check` cannot pass** until `.prettierignore` excludes
  `docs/spec/`, which is the immutable input specification and must not be
  reformatted. One-line fix; the file was outside this change's scope. Noted in
  the header of `.github/workflows/ci.yml`.
- **`fixtures/verify.py` treats `fixtures/README.md` as a fixture**, so editing
  the documentation fails the determinism check until `MANIFEST.sha256` is
  regenerated. A one-line fix (excluding `.md` alongside `.py`) belongs to the
  fixtures owner. The manifest is currently regenerated and passing 46/46.

### Platform and environment

- Only **Windows 11 + Docker Desktop** has been used during this work. macOS and
  Linux are **unverified**. `docs/spec/10_DEPLOYMENT.md` explicitly allows
  certifying one OS first provided the others are labelled unverified — they
  are.
- The development network runs a **TLS-intercepting proxy**, and Docker Hub was
  returning **HTTP 429** during this work. See `docs/RUNBOOK.md` → "Registry
  rate limits and TLS interception" and ADR12/ADR13 in `docs/DECISIONS.md`.
- The `ollama/ollama` image in the optional `local-ai` profile is pinned **by
  tag only**; its digest could not be resolved before the rate limit hit. It is
  marked `TODO(digest)` in `docker-compose.yml`.
- The `postgres` service container in CI is pinned **by tag only**, for the same
  reason: the digest on hand was resolved through the AWS ECR Public mirror, and
  GitHub runners pull from Docker Hub.

### Not in scope at all

LinkedIn scraping, LinkedIn Easy Apply automation, LinkedIn URL-only profile
import, Workday support, mobile browser extensions, recruiter outreach,
interview impersonation, automated assessments, CAPTCHA solving, proxy
rotation, fingerprint spoofing and any form of restriction bypass. These are not
"not yet".

---

## Verified commands

Only commands that were **actually executed on this machine** and observed to
work. Each line records what was run and what it actually printed. Do not add a
command here that you have not run.

### Toolchain (verified 2026-09-20, Windows 11, Git Bash + PowerShell)

| Command                  | Observed output                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `node --version`         | `v24.13.0` — satisfies the `>=24.0.0 <25` engine range                                           |
| `pnpm --version`         | `11.3.0` — matches the `packageManager` field                                                    |
| `docker --version`       | `Docker version 29.8.0, build 88096ef`                                                           |
| `docker compose version` | `Docker Compose version v5.5.1`                                                                  |
| `uv --version`           | `uv 0.12.17 (635500036 2026-09-18 x86_64-pc-windows-msvc)`                                       |
| Python via uv            | `3.12.14` — inside the worker's managed environment; the system Python is 3.14.2 and is not used |

### Build and dependencies

| Command                            | Result                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                   | **Exit 0.** All five workspace projects clean: `packages/contracts`, `packages/ui`, `packages/api-client`, `apps/api`, `apps/web`.                                                                              |
| `pnpm lint`                        | **Exit 0.** `apps/api` (src + tests) and `apps/web` both clean under ESLint.                                                                                                                                    |
| `pnpm contracts:check`             | **Exit 0.** `contracts: generated artifacts are up to date (62 files)`. The drift gate passes.                                                                                                                  |
| `pnpm format:check`                | **FAILS.** 81 files differ, including 8 under `docs/spec/`, which is the immutable input specification. Needs a one-line `docs/spec/` entry in `.prettierignore`. All files owned by this change are formatted. |
| `uv run ruff check .` (worker)     | **FAILS.** 3 errors. Worker source still landing.                                                                                                                                                               |
| `uv run ruff format --check .`     | **FAILS.** 1 file would be reformatted, 16 already formatted.                                                                                                                                                   |
| `uv run mypy` (worker)             | **FAILS.** `There are no .py[i] files in directory 'tests'`.                                                                                                                                                    |
| `uv run python fixtures/verify.py` | **Exit 0. 46/46 checks passed**, including the byte-for-byte reproducibility check.                                                                                                                             |
| `argon2` native build              | Succeeds on this host. Relevant because `infra/api.Dockerfile` targets Alpine/musl, where a glibc prebuild would not load; the Dockerfile installs `python3 make g++` in the build stage for that reason.       |

### Infrastructure and scripts (verified 2026-09-20)

| Command                                                                      | Observed output                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose config`                                                      | Exit 0. 268 lines of resolved configuration.                                                                                                                                                      |
| `docker compose config --services` (with `--profile local-ai`)               | `db migrate api ollama web worker`. Without the profile, `ollama` is correctly absent.                                                                                                            |
| `docker compose config --volumes`                                            | `db-data files-data` — named volumes, so `docker compose down` preserves data.                                                                                                                    |
| `docker compose config` port resolution                                      | `web` resolves to `host_ip: 127.0.0.1, published: "3000", target: 8080`. No service binds `0.0.0.0`; `db` and `worker` publish nothing.                                                           |
| `docker compose config` dependency conditions                                | `api` depends on `db: service_healthy` **and** `migrate: service_completed_successfully`. Ordering is enforced, not hoped for.                                                                    |
| `sh -n scripts/*.sh`                                                         | All 7 POSIX scripts parse: `lib.sh setup.sh migrate.sh smoke.sh backup.sh restore.sh dev.sh`.                                                                                                     |
| `[Parser]::ParseFile` on `scripts/*.ps1`                                     | All 7 PowerShell scripts parse with zero errors: `lib.ps1 setup.ps1 migrate.ps1 smoke.ps1 backup.ps1 restore.ps1 dev.ps1`.                                                                        |
| `bash scripts/setup.sh --help`                                               | Prints full usage. Exit 0.                                                                                                                                                                        |
| `bash scripts/setup.sh` (against a throwaway `JG_ENV_FILE` in `/tmp`)        | Generated `SESSION_SECRET`, `ENCRYPTION_KEY`, `WORKER_AUTH_TOKEN`, `SETUP_TOKEN` via `openssl rand`; printed the setup token exactly once; wrote it nowhere else. The throwaway file was deleted. |
| `bash scripts/setup.sh` (second run, existing file)                          | Refused to overwrite. Exit 1, with the `--keep-existing` / `--force` guidance.                                                                                                                    |
| `bash scripts/setup.sh --keep-existing`                                      | Left existing secrets untouched and did not reprint the setup token. Exit 0.                                                                                                                      |
| `powershell -File scripts/setup.ps1` (throwaway `$env:JG_ENV_FILE`)          | Same behaviour as the POSIX version: four secrets generated via `RandomNumberGenerator`, token printed once, refuses to overwrite on the second run (exit 1).                                     |
| `bash scripts/{migrate,smoke,backup,restore,dev}.sh --help`                  | All print usage and exit 0.                                                                                                                                                                       |
| `Get-Help scripts/*.ps1`                                                     | Comment-based help resolves for all five operator scripts.                                                                                                                                        |
| `bash scripts/backup.sh --nonsense`                                          | Exit 1 with `error unknown option: --nonsense`.                                                                                                                                                   |
| `python -c "import yaml; yaml.safe_load(...)"` on `.github/workflows/ci.yml` | Parses. Jobs: `contracts node-quality node-test worker fixtures compose-build hygiene`.                                                                                                           |

### Container image digests (verified 2026-09-20)

Resolved with `docker buildx imagetools inspect <ref> --format '{{.Manifest.Digest}}'`
and/or `docker image inspect <ref> --format '{{index .RepoDigests 0}}'` after
pulling. See `docs/DECISIONS.md` → ADR12 for the registry caveat.

| Image                          | Digest                      | Notes                                                                                                                                                                                        |
| ------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres:17-alpine`           | `sha256:f02121de…d867995`   | Container reports `postgres (PostgreSQL) 17.11`. Digest resolved via the ECR Public mirror.                                                                                                  |
| `node:24-alpine`               | `sha256:ebfe2f90…905ec1c1`  | Runtime reports `v24.21.0`. Digest resolved via the ECR Public mirror.                                                                                                                       |
| `python:3.12-slim-bookworm`    | `sha256:392307d2…eb23564e`  | Runtime reports `Python 3.12.14`, matching local uv-managed dev. Digest resolved via the ECR Public mirror.                                                                                  |
| `nginx:1.29-alpine`            | `sha256:56168782…d9b830de`  | Digest resolved via the ECR Public mirror. The mirrored image was ~5 months old at pin time — re-resolve before release.                                                                     |
| `ghcr.io/astral-sh/uv:0.12.17` | `sha256:10787c68…ce7fa9acc` | Verified directly against GHCR (not a mirror, not rate limited). `docker run --entrypoint /uv … --version` printed `uv 0.12.17 (x86_64-unknown-linux-musl)`, matching the host's uv exactly. |
| `ollama/ollama:0.34.0`         | **not pinned**              | Tag confirmed to exist via `docker manifest inspect`; digest resolution hit Docker Hub's 429 limit. Marked `TODO(digest)` in `docker-compose.yml`.                                           |

### GitHub Actions versions (verified 2026-09-20)

Resolved against the GitHub REST API (`/releases/latest`, then
`/git/ref/tags/<tag>`, dereferencing annotated tags through `/git/tags/<sha>`).
All are pinned in `ci.yml` by full commit SHA with the tag in a comment.

| Action                    | Tag     | Commit                                                                   |
| ------------------------- | ------- | ------------------------------------------------------------------------ |
| `actions/checkout`        | v7.0.1  | `3d3c42e5aac5ba805825da76410c181273ba90b1`                               |
| `actions/setup-node`      | v7.0.0  | `820762786026740c76f36085b0efc47a31fe5020`                               |
| `pnpm/action-setup`       | v6.1.0  | `ea17c68df8912ef543352723c149a84f56e3d413` (annotated tag, dereferenced) |
| `astral-sh/setup-uv`      | v10.1.0 | `bec219d24cd3e171d82865faccec33120bb574f4`                               |
| `actions/upload-artifact` | v7.0.1  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`                               |

### Explicitly NOT verified

| Command                                       | Why not                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose up --build`                   | Not attempted. The API and worker source trees were still being written in parallel; a failure would have said nothing about the infrastructure. |
| `scripts/smoke.sh` against a live stack       | There is no live stack to run it against. This is the M0 exit criterion and it is **unmet**.                                                     |
| `scripts/backup.sh` / `restore.sh` end to end | Need a populated installation. Syntax-verified only.                                                                                             |
| `scripts/dev.sh` / `dev.ps1`                  | Needs the API and web source trees. Syntax-verified only.                                                                                        |
| `scripts/migrate.sh`                          | Needs the API's migration runner. Syntax-verified only.                                                                                          |
| Any image build from `infra/*.Dockerfile`     | Not attempted, for the same reason as `docker compose up`. **The Dockerfiles have never been built.**                                            |
| macOS and Linux behaviour                     | Never run. Unverified.                                                                                                                           |
