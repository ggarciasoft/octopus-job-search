# @job-getter/api

Node 24 + Fastify + TypeBox + Kysely/pg. This service owns **persistence and
workflow**; the Python worker owns processing and automation and never writes to
the database (invariant 1).

This package currently implements **milestone M0 — Foundation**.

## What is implemented

| Area | Status |
|---|---|
| Configuration contract (`10_DEPLOYMENT.md`) | complete, fail-fast |
| Structured redacted logging | complete |
| Migration runner (advisory lock, checksums, `status`) | complete |
| Foundation schema, including the M1 tables | complete |
| Error envelope (`04_API_CONTRACTS.md`) | complete |
| Local one-time setup, sessions, CSRF/origin | complete |
| PostgreSQL task queue (lease/heartbeat/complete/fail/cancel) | complete |
| Internal worker protocol `/internal/v1/*` | complete |
| File upload/download, local storage driver | complete |
| Scheduler (lease reclaim, artifact sweep, pruning) | complete |
| `POST /api/v1/diagnostics/echo` end-to-end probe | complete |
| Profile / preferences / provider settings / imports | **not implemented — M1** |
| Hosted signup, email verification, password reset | **not implemented — M6** |
| S3 storage driver | **not implemented — M6** |

Unimplemented routes are **absent**, not stubbed. `src/routes/index.ts` holds
`DEFERRED_OPERATIONS`, a documented list asserted by
`tests/routes/manifest.test.ts`; an agent implementing M1 must delete the
corresponding entry for the suite to pass. Nothing returns a success it did not
achieve (invariant 10).

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

## Environment

Defined and validated in `src/config.ts`; every problem is reported in one
message at boot. Beyond the variables named in `10_DEPLOYMENT.md`, the service
reads one operational extra:

* `HOST` (default `0.0.0.0`) — the listener bind address. In Compose the API is
  not published to the host; the web edge binds `127.0.0.1:3000`.

Deliberate refusals:

* `STORAGE_DRIVER=s3` — refuses to boot. Hosted storage is M6; a driver that
  silently wrote nowhere would present an unsupported deployment as working.
* `APP_MODE=hosted` with a placeholder secret, a shared
  `SESSION_SECRET`/`WORKER_AUTH_TOKEN`, or a non-https `APP_ORIGIN`.
* Local mode without `SETUP_TOKEN` — there would be no way to create the owner.

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

### Queue

Coordination is PostgreSQL only — no Redis, BullMQ, Kafka or Celery, per the
explicit prohibition in `02_ARCHITECTURE.md`.

* Claim: `SELECT … FOR UPDATE SKIP LOCKED`, one row, filtered by declared
  capability. Rows whose lease expired are included, so a crashed worker's task
  is picked up on the next poll; one with no retry budget left is failed in the
  same transaction rather than handed out again.
* Lease: 120 s, token stored only as a SHA-256 digest. A reclaim issues a new
  token; the old one returns `409` with **no domain effect**.
* Complete: lease check, closed-schema validation of `result`, artifact commit
  and state transition in one transaction. An invalid result **fails the task**
  instead of storing it.
* Fail: the *server* decides retryability. A worker's `retryable: true` can only
  narrow the server's allowlist, never widen it. `NO_RETRY_TASK_TYPES`
  (`fill_local`) is never retried. `Retry-After` is honoured on `RATE_LIMITED`.
* Cancel: a queued task is cancelled immediately; a leased one is flagged and
  stops at its next heartbeat checkpoint.

`enqueueTask(trx, …)` requires a `DbTransaction`, so enqueueing outside the
transaction that caused it is a compile error.

### Known decisions and deviations

* **Setup source binding.** `09_SECURITY_PRIVACY.md` says to bind setup to
  loopback, but `10_DEPLOYMENT.md` puts a reverse proxy in front of an
  unpublished API, so requests never arrive from `127.0.0.1`. The implemented
  rule is: the connection must originate from loopback or a private/link-local
  address; a public source address is refused, and the loopback binding is
  enforced at the edge. `trustProxy` is off so `request.ip` is the real peer.
* **Validation status code.** The spec distinguishes 400 (malformed) from 422
  (invalid domain input). Schema-level failures map to `400 VALIDATION_ERROR`
  with a per-field map; domain-rule failures map to `422 UNPROCESSABLE`.
* **`worker_online`.** Derived from an observed poll within 90 seconds, recorded
  in `worker_registrations` (an operational, non-private table added beyond the
  spec's table list). A worker that polls an empty queue still counts as online,
  which task rows alone could not express.
* **Completing a cancelled task.** If a worker completes work whose cancel flag
  was set, the validated result is accepted as `succeeded`; the flag is
  advisory and the work was genuinely done.
* **`tasks.input_file_ids`.** Added beyond the spec's column list. It is the
  declaration of which files a task may download; anything else is unreachable
  to the worker, even within the same workspace.
* **No CORS plugin.** Not registered at all, so there is no
  `Access-Control-Allow-Origin` header to get wrong. The web client is
  same-origin behind the proxy.
* **Graceful shutdown and "lease recovery".** The API holds no leases — workers
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
  db/                pool, hand-written Kysely types, migrations, seed
  auth/              argon2id, sessions, CSRF/origin, worker credential, scope
  tasks/             enqueue, queue, idempotency, scheduler
  files/             storage drivers, upload validation, download headers
  routes/            manifest-driven registration + handlers
tests/               vitest against real PostgreSQL via testcontainers
```
