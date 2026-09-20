# @job-getter/api

Node 24 + Fastify + TypeBox + Kysely/pg. This service owns **persistence and
workflow**; the Python worker owns processing and automation and never writes to
the database (invariant 1).

This package currently implements **milestone M0 — Foundation**,
**milestone M1 — Profile, imports, preferences and provider settings** and
the API side of **milestone M2 — Job discovery** (source registry, scans and
the scan scheduler, job import, jobs list/detail with dedup, provenance,
freshness and closure).

## What is implemented

| Area                                                         | Status                   |
| ------------------------------------------------------------ | ------------------------ |
| Configuration contract (`10_DEPLOYMENT.md`)                  | complete, fail-fast      |
| Structured redacted logging                                  | complete                 |
| Migration runner (advisory lock, checksums, `status`)        | complete                 |
| Foundation schema, including the M1 tables                   | complete                 |
| Error envelope (`04_API_CONTRACTS.md`)                       | complete                 |
| Local one-time setup, sessions, CSRF/origin                  | complete                 |
| PostgreSQL task queue (lease/heartbeat/complete/fail/cancel) | complete                 |
| Internal worker protocol `/internal/v1/*`                    | complete                 |
| File upload/download, local storage driver                   | complete                 |
| Scheduler (lease reclaim, artifact sweep, pruning)           | complete                 |
| `POST /api/v1/diagnostics/echo` end-to-end probe             | complete                 |
| Profile read/patch with optimistic revisions                 | complete                 |
| Profile import (`parse_profile`), review and confirmation    | complete                 |
| Preferences (closed schema, weights sum to 100)              | complete                 |
| Provider settings, encrypted write-only secret, probe        | complete                 |
| Source registry (`/sources`), health, ETag/Last-Modified     | complete                 |
| Scans (`POST /sources/:id/scan`, `GET /scans/:id`)           | complete                 |
| Bounded scan scheduler (interval + jitter, Retry-After)      | complete                 |
| `fetch_board` result: dedup, provenance, closure, counts     | complete                 |
| Manual job import (`POST /jobs/import`, `fetch_job`)         | complete                 |
| Jobs list/detail/patch (`/jobs`), possible duplicates        | complete                 |
| Match scoring, `min_score`/`eligible` filters                | **not implemented — M3** |
| Hosted signup, email verification, password reset            | **not implemented — M6** |
| S3 storage driver                                            | **not implemented — M6** |

Unimplemented routes are **absent**, not stubbed. `src/routes/index.ts` holds
`DEFERRED_OPERATIONS`, a documented list asserted by
`tests/routes/manifest.test.ts`; an agent implementing a milestone must delete
the corresponding entries for the suite to pass. M1 and M2 have done so, and
only the three routes that need an email service remain deferred. Nothing
returns a success it did not achieve (invariant 10).

## Commands

```bash
pnpm --filter @job-getter/contracts build   # required first: the API imports dist/
pnpm --filter @job-getter/api typecheck
pnpm --filter @job-getter/api lint
pnpm --filter @job-getter/api test          # needs Docker: real PostgreSQL 17
pnpm --filter @job-getter/api migrate       # apply migrations (default command)
pnpm --filter @job-getter/api migrate status
pnpm --filter @job-getter/api dev
```

`TEST_POSTGRES_IMAGE` overrides the test container image (default
`postgres:17-alpine`) so CI can point at a mirror.

### Migrations and the compiled artifact

`tsc` compiles `.ts` and copies nothing else, so a container image built from
`dist/` would contain no `.sql` files — and a directory-reading migration runner
would find zero migrations, apply nothing and exit 0. The API would then start
against an empty database.

The `.sql` files remain authoritative (they are what a reviewer reads and what
`psql -f` runs), but the runtime reads `src/db/migrations/bundled.ts`, a
generated mirror that `tsc` necessarily compiles. There is no copy step to
forget. After editing or adding a `.sql` migration:

```bash
pnpm --filter @job-getter/api exec tsx src/db/bundle-migrations.ts
```

`tests/db/packaging.test.ts` compiles the package for real — with
**`tsconfig.build.json`, the config that actually ships**, not the typecheck
one — then imports the built `migrate.js` and asserts that:

- the migration set is non-empty, byte-identical to the `.sql` sources, and
  still applies to a real empty database;
- no `.sql` file appears anywhere in the built tree;
- the server lands at the exact path `package.json`'s `start` script invokes,
  and the test suite is not compiled into the shipped artifact;
- the bundle is exactly what the generator would produce from the `.sql` files
  today.

The compiled runner is located by searching the output rather than by assuming
a layout, so a `rootDir` change fails loudly instead of testing nothing.
`loadMigrations()` throws `EmptyMigrationSetError` rather than reporting success
on an empty set.

`src/db/migrations/bundled.ts` is generated and is listed in `.prettierignore`:
reformatting it makes the drift check fail for a reason unrelated to the
migrations. Any future generated file needs the same treatment.

### Currently unused dependencies

`@fastify/csrf-protection` and `@fastify/static` are in `package.json` but are
**not used** by this code, and nothing here depends on them:

- CSRF is implemented in `src/auth/csrf.ts` as a session-bound HMAC
  double-submit cookie plus Origin/Referer verification. Binding the token to
  the session makes revocation automatic and needs no second secret cookie.
- Files are streamed as authenticated, workspace-scoped attachments; there is
  no static mount, because "no public permanent URL" forbids one.

They are retained for now (M1's download work may want the static plugin); do
not assume they are load-bearing.

## Environment

Defined and validated in `src/config.ts`; every problem is reported in one
message at boot. Beyond the variables named in `10_DEPLOYMENT.md`, the service
reads one operational extra:

- `HOST` (default `0.0.0.0`) — the listener bind address. In Compose the API is
  not published to the host; the web edge binds `127.0.0.1:3000`.

Deliberate refusals:

- `STORAGE_DRIVER=s3` — refuses to boot. Hosted storage is M6; a driver that
  silently wrote nowhere would present an unsupported deployment as working.
- `APP_MODE=hosted` with a placeholder secret, a shared
  `SESSION_SECRET`/`WORKER_AUTH_TOKEN`, or a non-https `APP_ORIGIN`.
- Local mode without `SETUP_TOKEN` — there would be no way to create the owner.

`ENCRYPTION_KEY` must be base64 for exactly 32 bytes (`openssl rand -base64 32`).

## Architecture notes

### Workspace scoping

`src/auth/scope.ts` is the single chokepoint. `WorkspaceScope` only accepts the
table names in `WORKSPACE_SCOPED_TABLES` and injects the `workspace_id`
predicate itself; `insertInto` takes `Omit<…, 'workspace_id'>` so a caller
cannot pass one. The raw handle is reachable only through the conspicuously
named `unscoped()`, used solely for operator-global tables. The database
enforces the same rule independently: every private table has
`UNIQUE (workspace_id, id)` and references between private tables are composite
`(workspace_id, id)` foreign keys, so a cross-workspace reference fails even if
the application forgets a `WHERE`.

A cross-workspace access is always reported as a plain `404`, byte-identical to
a genuinely absent id.

### Validation

Fastify's Ajv is replaced by a TypeBox `TypeCompiler` validator
(`src/app.ts`). Route validation and worker-result validation therefore share
one compiler and one `FormatRegistry` — a request cannot be accepted at the
route boundary and then rejected inside the completing transaction. Formats come
from `registerContractFormats()` in `@job-getter/contracts` and are never
redefined here.

Path and query parts are passed through `Value.Convert` first, because those
values always arrive as strings. JSON bodies are **not** coerced: there, `"2"`
and `2` are genuinely different.

Response schemas are asserted in the tests with `Value.Check` rather than handed
to Fastify's serializer, which silently drops properties a schema omits.

### M1: profile, imports, preferences, providers

**Fact values.** A `profile_facts.value` is validated against the schema its
own `kind` selects (`FACT_VALUE_SCHEMAS` from the contracts package), plus the
internal-consistency rules JSON Schema cannot express: `current: true` requires
a null `end_month`, and an end month may not precede its start month
(03_DATA_MODEL.md). Both checks run on user input _and_ on model output, and
again on a user's `edited_value` at confirmation — an edit is not more trusted
than what it edits.

**Imports are proposals.** `POST /profile/imports` writes the
`profile_imports` row and enqueues `parse_profile` in one transaction, and
declares the uploaded document as the task's only reachable input. The worker
result is applied to the import row inside the _completing_ transaction
(`applyDomainResult` in `src/tasks/queue.ts`), so the task state and the import
state can never disagree. Nothing is confirmed automatically: drafts sit on the
import until `POST /profile/imports/:id/confirm` names them.

**AT04.** `GET /profile/imports/:id` computes conflicts on read by comparing
each draft with the current _confirmed_ facts — an experience at the same
employer with overlapping dates, a differing contact block, an authorization
for the same country, a skill with the same canonical name. A conflict is
reported, never merged. Confirming an accepted draft adds a fact _alongside_
the existing confirmed one unless the user set `supersedes_fact_id`; when they
do, the superseded row is kept and merely un-confirmed, and the new row points
back at it through `supersedes_id`.

**Provider secrets.** AES-256-GCM (`src/crypto/secrets.ts`) under
`ENCRYPTION_KEY`, envelope `version | nonce | tag | ciphertext`. `GET` returns
`api_key_set` and a four-character mask and nothing else. The version byte
makes rotation a configuration change rather than a migration; the module
comment spells out the procedure.

**Outbound destinations.** `src/settings/network.ts` is the single destination
policy: https-only for a cloud provider, every resolved address checked in both
families, cloud metadata addresses refused unconditionally, redirects followed
manually and re-validated at every hop (max 3). A local model endpoint is
reachable only when the _operator_ allowlisted it through `ALLOWED_FETCH_HOSTS`
or `LOCAL_MODEL_BASE_URL`; a hosted tenant cannot grant it to themselves.
`POST /settings/providers/test` takes no URL — it probes the stored provider
and only that one, because ADR07 forbids falling back to a cloud provider when
a local one fails.

Write-time validation uses `dns: 'best_effort'`: an endpoint that is briefly
unresolvable must not make the settings page unsaveable, and nothing is
connected to at save time. The connection path always uses `dns: 'required'`.

### M2: discovery

**Sources.** `POST /sources` registers a Greenhouse board token or a Lever site
slug; `connector_version` comes from `CONNECTOR_VERSIONS` in the contracts. A
`base_url` is accepted only for a connector with a documented regional endpoint
(`src/discovery/connectors.ts`: Lever `api.lever.co` / `api.eu.lever.co`,
https only, origin only), so a source cannot point the worker anywhere else.
Deleting a source keeps every job and every provenance row; only
`job_sources.source_id` is nulled (foreign key `ON DELETE SET NULL`), and
re-registering the same board reattaches the surviving provenance.

**Scans.** `POST /sources/:id/scan` and the scheduler share one path,
`startScan` (`src/discovery/scans.ts`): the `scans` row, the `fetch_board`
task (input built from `DISCOVERY_LIMITS`, the user's `scan_max_jobs`, and the
source's stored `etag`/`last_modified`) and the source's `next_scan_after`
are written in one transaction. A disabled or blocked source answers `422`; a
source with a scan already in flight answers `409`, and the partial unique
index `scans_one_in_flight_idx` enforces that across replicas.

**Scheduler.** `scheduleDueScans` (`src/discovery/scan-scheduler.ts`) runs
every minute from the housekeeping scheduler. A source is due when it is
enabled, not blocked, has no scan in flight and its `next_scan_after` is null
or past. Each due source is taken under `FOR UPDATE SKIP LOCKED` in its own
transaction, so replicas divide the work and one failure rolls back one
source. `next_scan_after` becomes `now + scan_interval_hours + jitter`, with
jitter drawn from `[0, scanIntervalJitterMinutes)` — added, never subtracted,
so the configured interval is a floor.

**Applying a `fetch_board` result** (`src/discovery/apply-board.ts`, inside
the completing transaction):

- _Dedup._ `upsertNormalizedJob` is the single write path for a
  `NormalizedJob`. Canonical key = `connector:board:external_id` for a board,
  else the normalised employer URL (`url:` prefix), else `manual:<hash>` for a
  pasted description with no URL. Lookup order: same `source_key` → same
  canonical key → identical `apply_url` → same requisition (same board
  connector + same `external_id`, e.g. a parent and a child board) → new job.
  Similar title + location is **never** merged; it is reported as
  `possible_duplicates` (`similar_title_and_location`), computed on read for
  the whole page in one query, and only for the same employer.
- _Content._ A changed `content_hash` updates the fields and bumps
  `revision`; an unchanged one only touches `last_seen_at`/`last_fetched_at`.
  Nothing is defaulted: a null `published_at`, `salary.currency` or
  `eligible_countries` is stored as null (AT07/AT08).
- _Closure._ Bookkeeping lives on the provenance row, per source. A
  **complete** snapshot that does not list an identity increments its
  `missing_snapshots` and records the first and last absence; a job closes
  (`closed_reason = 'snapshot'`) only when every provenance row through an
  _enabled_ source has `missing_snapshots >= 2` with the first and last absence
  at least 24 h apart (`CLOSURE_RULES`). A partial result, a refusal or a
  failed task touches none of these counters. Reappearance resets them and
  reopens a snapshot closure; a user's explicit closure (`PATCH
/jobs/:id {status: 'closed'}`) is never reopened by a board.
- _Health._ Success → `ok`, counters reset, ETag/Last-Modified stored (a fetch
  that returned none keeps the previous value). A 403/429 — read from the
  warnings, the observed HTTP status or an observed `blocked` state —
  increments `consecutive_denials`, and at `blockAfterConsecutiveDenials`
  the source becomes `blocked` and is not scheduled again until
  `PATCH /sources/:id {enabled: true}`, which clears the block. A
  `Retry-After` pushes `next_scan_after` out by at least that long. Jobs a
  partially refused fetch _did_ return are still applied; the scan is
  `partial` and can close nothing.

**Manual import.** `POST /jobs/import` takes `url` xor `description_text`
(422 otherwise), `https` only, and enqueues `fetch_job` with the hard
`URL_FETCH_POLICY` bounds. A resolved job is upserted with connector `url` or
`manual` and null `source_id`; the user's `apply_url` hint fills a gap the page
left and never overrides the page. When the page held several postings the
candidates are stored on the import (`needs_choice`) and no job is created.

**Jobs list.** `query` is a case-insensitive substring match on title and
company (LIKE metacharacters escaped); full-text search comes with the index
the data model reserves for it. `min_score` and `eligible` are accepted and
yield an empty page: no match exists before M3, and a null match satisfies
neither. Excluded employers (`preferences.excluded_companies`) are hidden
unless `include_excluded=true` and carry `excluded_reason`; the check runs
against the current preferences on every read, so nothing is rewritten on the
job rows when the list changes. `match` is always `null` in M2.

### Queue

Coordination is PostgreSQL only — no Redis, BullMQ, Kafka or Celery, per the
explicit prohibition in `02_ARCHITECTURE.md`.

- Claim: `SELECT … FOR UPDATE SKIP LOCKED`, one row, filtered by declared
  capability. Rows whose lease expired are included, so a crashed worker's task
  is picked up on the next poll; one with no retry budget left is failed in the
  same transaction rather than handed out again.
- Lease: 120 s, token stored only as a SHA-256 digest. A reclaim issues a new
  token; the old one returns `409` with **no domain effect**.
- Complete: lease check, closed-schema validation of `result`, artifact commit
  and state transition in one transaction. An invalid result **fails the task**
  instead of storing it.
- Fail: the _server_ decides retryability. A worker's `retryable: true` can only
  narrow the server's allowlist, never widen it. `NO_RETRY_TASK_TYPES`
  (`fill_local`) is never retried. `Retry-After` is honoured on `RATE_LIMITED`.
- Cancel: a queued task is cancelled immediately; a leased one is flagged and
  stops at its next heartbeat checkpoint.

`enqueueTask(trx, …)` requires a `DbTransaction`, so enqueueing outside the
transaction that caused it is a compile error.

### Known decisions and deviations

- **Setup source binding.** `09_SECURITY_PRIVACY.md` says to bind setup to
  loopback, but `10_DEPLOYMENT.md` puts a reverse proxy in front of an
  unpublished API, so requests never arrive from `127.0.0.1`. The implemented
  rule is: the connection must originate from loopback or a private/link-local
  address; a public source address is refused, and the loopback binding is
  enforced at the edge. `trustProxy` is off so `request.ip` is the real peer.
- **Validation status code.** The spec distinguishes 400 (malformed) from 422
  (invalid domain input). Schema-level failures map to `400 VALIDATION_ERROR`
  with a per-field map; domain-rule failures map to `422 UNPROCESSABLE`.
- **`worker_online`.** Derived from an observed poll within 90 seconds, recorded
  in `worker_registrations` (an operational, non-private table added beyond the
  spec's table list). A worker that polls an empty queue still counts as online,
  which task rows alone could not express. The table is classified
  operator-global in three agreeing places, asserted by `tests/db/schema.test.ts`:
  a `COMMENT ON TABLE`, `OPERATOR_GLOBAL_TABLES` in `src/db/types.ts`, and its
  absence from `WORKSPACE_SCOPED_TABLES`. It is therefore excluded from
  workspace export and from workspace deletion, and its `workspace_id` (set only
  for a paired local runner) is `ON DELETE SET NULL` rather than `CASCADE`:
  deleting a workspace drops the association but must not destroy the operator's
  record of a running process.
- **Completing a cancelled task.** If a worker completes work whose cancel flag
  was set, the validated result is accepted as `succeeded`; the flag is
  advisory and the work was genuinely done.
- **`GET /profile/imports/:id` also accepts the task id.** `POST
/profile/imports` is declared as returning `AcceptedResponse`
  (`{task_id, status}`), and the contract declares no route that lists imports,
  so a client following it literally would hold a task id and no way to reach
  the import. Rather than adding an undeclared response field or an undeclared
  list route, the handler resolves the path parameter as an import id or as the
  id of the task that produced one. Both lookups go through the workspace
  scope, so nothing becomes reachable that was not already.
- **`GET /scans/:id` and `GET /jobs/:id` also accept a task id.** Same
  reasoning as the profile import: `POST /sources/:id/scan` and
  `POST /jobs/import` answer with `{task_id}` and the contract declares no
  list to find the scan or the import from. `GET /jobs/:id` with a `fetch_job`
  task id answers 404 until the import has produced a job.
- **No `GET /jobs/imports/:id`; the `fetch_job` task result is extended.**
  The contract declares no route that reads an import, and an undeclared
  route is an endpoint nobody reviews. Instead `applyFetchJobResult` stores
  the worker's contract-valid result unchanged and appends one block,
  `job_import: {id, status, job_id}`, readable through `GET /tasks/:id` next
  to the contract's own `job`, `candidates` and `warnings`. `status` is one
  of `queued | resolved | needs_choice | failed` (`JOB_IMPORT_STATUSES`,
  asserted against the SQL CHECK). Choosing among candidates is a second
  `POST /jobs/import` with the chosen candidate's `canonical_url`.
- **Cross-source linking on requisition identity is board-connector only.**
  A Greenhouse or Lever `external_id` is the ATS's own requisition id, so the
  same id on the same connector through another board is the same posting.
  `url` and `manual` imports carry no such identity and link only on an
  identical `apply_url`.
- **`possible_duplicates` requires the same employer.** "Similar
  title/location" across different companies would flag every "Software
  Engineer, Madrid" against every other; the warning is scoped to one
  employer so it stays actionable.
- **A job seen through several sources closes only when all of them agree.**
  The closure counters are per provenance row, and only rows through an
  enabled source vote. A disabled board cannot testify that a posting is
  gone; a deleted one has no opinion.
- **`PATCH /jobs/:id` bumps `revision` on every change**, including a save.
  `revision` is the row's optimistic-concurrency counter; M3 should detect
  content staleness through `content_hash`, which only changes with content.
- **`scans.started_at` is the worker's `fetched_at`.** There is no claim-time
  hook on the domain row; the observation time is what the scan reports.
- **`sources.consecutive_denials` beyond the spec's columns.** Only 403/429
  count towards blocking; a timeout is degraded health, not a refusal, so the
  two counters are kept apart.
- **Pasted import text is not stored as a file.** `profile_imports.text_file_id`
  stays null; the text travels in the task payload as the contract's
  `inline_text`. Writing the same bytes twice would create two retention
  lifecycles for one piece of user data.
- **A confirmed `contact` fact is mirrored into `profiles.contact`.**
  03_DATA_MODEL.md stores contact on the profile and references its revision in
  packet snapshots, while the fact row keeps the provenance. The two are kept
  in step rather than allowed to drift.
- **An import draft whose value does not match its kind is dropped at result
  time**, with the contract's `FIELD_DROPPED_INVALID` warning, rather than
  being offered as something the user could accept. Confirmation re-validates
  anyway.
- **`tasks.input_file_ids`.** Added beyond the spec's column list. It is the
  declaration of which files a task may download; anything else is unreachable
  to the worker, even within the same workspace.
- **No CORS plugin.** Not registered at all, so there is no
  `Access-Control-Allow-Origin` header to get wrong. The web client is
  same-origin behind the proxy.
- **Graceful shutdown and "lease recovery".** The API holds no leases — workers
  do — so there is nothing to hand back on `SIGTERM`. Recovery is the 120-second
  expiry plus the claim path and the scheduler. Shutdown stops accepting,
  drains in flight, lets a running sweep finish, and closes the pool.

## Layout

```
src/
  config.ts          environment contract, fail-fast
  logging.ts         pino, redaction, request_id
  errors.ts          contract error envelope and status mapping
  validation.ts      TypeBox compiler cache and formats
  health.ts          liveness (process) and readiness (db/schema/storage)
  app.ts             buildApp: no side effects
  server.ts          listener, scheduler, graceful shutdown
  db/                pool, Kysely types, migrations (+ generated bundle), seed
  auth/              argon2id, sessions, CSRF/origin, worker credential, scope
  crypto/            authenticated encryption for provider secrets
  tasks/             enqueue, queue, idempotency, scheduler
  files/             storage drivers, upload validation, download headers
  profile/           fact validation, conflicts, import drafts, patch
  settings/          preferences, provider config, outbound destination policy
  discovery/         connectors policy, sources, scans, scheduler, dedup, closure, imports
  routes/            manifest-driven registration + handlers
tests/               vitest against real PostgreSQL via testcontainers
```
