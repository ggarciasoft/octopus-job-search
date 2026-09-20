# Operations

The observability contract from `docs/spec/10_DEPLOYMENT.md`.

> ## ⚠️ This describes the target, not a running system
>
> **As of 2026-09-20 most of this page is not implemented, and nothing on it has
> been executed.** Every item below carries an explicit status. The honest
> summary:
>
> |                    |                                                                                                                                    |
> | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
> | Health endpoints   | **Code exists, never run** — `apps/api/src/health.ts` registers `/health/live` and `/health/ready`                                 |
> | Structured logging | **Code exists, never run** — `pino` is wired up in `apps/api/src/logging.ts`; the field and redaction contract below is unverified |
> | Metrics            | **Not implemented** — there is no metrics endpoint at all                                                                          |
> | Alerts             | **Not implemented** — there is no alerting pipeline at all                                                                         |
>
> Do not read this document as a description of what you can monitor today.
> Read it as the specification the implementation owes you, and as the checklist
> for the agent implementing each piece. See
> [`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md).

Status words: **Implemented** (exists and has been run) · **Code exists, never
run** (written, but no execution has confirmed it behaves as described) ·
**Partial** (some of it exists) · **Not implemented** (no code).

---

## Health endpoints

`docs/spec/10_DEPLOYMENT.md`: _"Health endpoints: liveness process only;
readiness database/schema/storage configuration."_

Two endpoints that answer two different questions. Conflating them is the
classic outage amplifier: a liveness probe that touches the database will kill
every healthy API process the moment the database hiccups, turning a brief blip
into a restart storm.

| Endpoint            | Question                                             | Must check                                                                                                                    | Must **not** check                                                                                  | Status                                                |
| ------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GET /health/live`  | Is this process alive and its event loop responsive? | Process is up and responding                                                                                                  | **Nothing external.** Not the database, not storage, not the model provider                         | **Code exists, never run** (`apps/api/src/health.ts`) |
| `GET /health/ready` | Can this process actually serve requests?            | Database reachable; schema at the expected migration version; storage (`FILES_ROOT` writable, or S3 reachable and configured) | Third-party AI providers — an unconfigured or unavailable provider is a normal state, not an outage | **Code exists, never run** (`apps/api/src/health.ts`) |

**Both sit outside `/api/v1`** and are therefore not in
`packages/contracts/src/routes.ts`. They are an operational interface, not a
product API — see ADR15 in [`DECISIONS.md`](DECISIONS.md).

**Verified shapes** (read from `apps/api/src/health.ts` on 2026-09-20; the code
exists but has not been executed):

- `/health/live` → `200 {"status":"ok","uptime_seconds":N}`. It touches nothing
  external, exactly as required.
- `/health/ready` → `200 {"status":"ready",...}` or **`503`
  `{"status":"not_ready","mode":...,"checks":[...]}`**, where `checks` names
  `database`, `schema` and `storage` individually. A 503 therefore tells you
  _which_ dependency is unavailable rather than just that something is.

**Path caveat:** because these are a convention rather than a versioned
contract, they can be got wrong independently by the API, the Dockerfile and the
smoke script. `infra/api.Dockerfile`'s `HEALTHCHECK` uses `/health/live`.
`scripts/smoke.sh` probes `/health/ready` first and then alternative spellings,
so a future rename reports clearly rather than timing out. Override with
`JG_READY_PATH`.

**Who checks what:**

- **Docker** checks _liveness_ (`infra/api.Dockerfile` `HEALTHCHECK`), and
  `docker-compose.yml` gates dependent services on it.
- **Readiness is deliberately not a Docker healthcheck.** A container that is
  alive but not ready should stay up and report _why_ — not be killed and
  restarted into the same failure.
- `db` has its own `pg_isready` check; `migrate` has none (a one-shot job has
  nothing to probe between start and exit); `worker` has none (it polls outward
  and serves nothing — its liveness is observable as queue age).

**Never return a bare `200` that hides a failing dependency.** The implemented
`/health/ready` satisfies this: it returns `503` with the per-dependency
`checks` array when any of `database`, `schema` or `storage` is unhealthy. That
behaviour has been read in the source but not observed at runtime.

---

## Structured logging

`docs/spec/10_DEPLOYMENT.md`: _"Structured redacted logs with request/task ID,
duration and error code."_

**Status: Code exists, never run.** `apps/api/src/logging.ts` configures `pino`.
Whether it actually emits the fields below, and whether redaction actually
holds, has **not been verified** — verifying redaction needs a running stack and
a deliberate attempt to get sensitive values into a log line.

### Required fields

Every log line is JSON — one object per line, no multi-line messages.

| Field          | Every line? | Notes                                                            |
| -------------- | ----------- | ---------------------------------------------------------------- |
| `time`         | yes         | ISO-8601 UTC                                                     |
| `level`        | yes         | From `LOG_LEVEL` (`trace`…`fatal`), default `info`               |
| `msg`          | yes         | Short, stable, not a sentence built from user data               |
| `request_id`   | HTTP        | UUID, also returned in the error envelope so a user can quote it |
| `task_id`      | task work   | Correlates API and worker sides of the same task                 |
| `workspace_id` | scoped ops  | The identifier, never the user's email                           |
| `duration_ms`  | completions | Requests and tasks                                               |
| `error_code`   | errors      | From the `ErrorCode` union in `packages/contracts`               |

A request id and a task id must let you follow one piece of work from the
browser, through the API, into the worker and back — across both languages.

### Redaction — what must NEVER be logged

`docs/spec/09_SECURITY_PRIVACY.md`: _"Do not log CV text, answers, tokens or raw
prompts."_ At any level, including `trace`, including in a stack trace.

- ❌ CV text, extracted profile facts, job description bodies
- ❌ Answer-bank answers
- ❌ Session cookies, device tokens, `SETUP_TOKEN`, `WORKER_AUTH_TOKEN`,
  provider API keys, `DATABASE_URL` with its password
- ❌ Raw prompts and raw model responses
- ❌ Email addresses, phone numbers, street addresses
- ❌ Browser cookies or anything from a local browser session

Log **identifiers, counts, durations and error codes** instead. `file_id` and
`bytes: 48213`, never the filename or the contents.

A redaction failure is a **security issue** — report it privately per
[`SECURITY.md`](../SECURITY.md), not in a public issue.

### Retention

Redacted operational logs: **30 days**, per the retention defaults in
`docs/spec/09_SECURITY_PRIVACY.md`. `docker-compose.yml` caps container logs at
3 × 10 MB per service, which bounds disk but is not a retention policy —
implement real rotation before hosted operation.

---

## Metrics

`docs/spec/10_DEPLOYMENT.md` names these exactly. **There is no metrics endpoint.
Every row below is Not implemented.**

| Metric                       | Why it is on the list                                                                                                                       | Suggested shape                                                         | Status          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------- |
| **Queue depth**              | The primary saturation signal                                                                                                               | Gauge, by task type and state                                           | Not implemented |
| **Queue age**                | Depth alone lies — a deep queue moving fast is fine; one stale item is not                                                                  | Histogram or gauge of oldest `queued` age                               | Not implemented |
| **Connector success rate**   | A silently failing connector looks identical to "no new jobs"                                                                               | Counter by connector and outcome                                        | Not implemented |
| **Provider latency**         | User-visible slowness and cost driver                                                                                                       | Histogram by provider                                                   | Not implemented |
| **Provider token usage**     | The cost input. `docs/spec/13_BUSINESS_AND_OPEN_SOURCE.md` insists allowances be set from _measured_ usage                                  | Counter of input/output tokens by provider and task                     | Not implemented |
| **Invalid AI outputs**       | Schema-validation failures. A rise means a provider or prompt regression — and it is the signal that the fact-allowlist guard is doing work | Counter by provider and reason                                          | Not implemented |
| **Blocked duplicates**       | Duplicate-application prevention is a core promise; this proves it fires                                                                    | Counter                                                                 | Not implemented |
| **Uncertain outcomes**       | `outcome_unknown` is a legitimate state (invariant 5/6). A rising rate means evidence capture is failing                                    | Counter                                                                 | Not implemented |
| **File processing failures** | Distinguish a malformed upload from a broken parser                                                                                         | Counter by stage and reason                                             | Not implemented |
| **Per-user cost**            | Required before any pricing conversation                                                                                                    | Gauge by workspace, from measured tokens × a **configurable rate card** | Not implemented |

**No token prices may be hard-coded.**
`docs/spec/13_BUSINESS_AND_OPEN_SOURCE.md`: _"No model token-price assumptions
are embedded in the code; use configurable rate cards and current provider
pricing."_ When no rate card is configured, measured cost is **null**, not zero
— `UsageSummary` in `packages/contracts` already models it that way.

**Metrics must carry no personal data.** Label with `workspace_id`, never with
an email address or a job title.

---

## Alerts

`docs/spec/10_DEPLOYMENT.md` names these four. **There is no alerting pipeline.
Every row is Not implemented.**

| Alert                          | Fires when                                                          | Means                                                                                                                                           | Status          |
| ------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Stalled queue**              | Oldest `queued` task exceeds a threshold well above the 120 s lease | Almost always: no worker is claiming. Wrong `WORKER_CAPABILITIES`, worker crash-looping, or worker cannot reach the API                         | Not implemented |
| **Repeated connector 403/429** | A source rejects repeatedly                                         | Rate limit, or an access-policy change. **Stop and show source health — do not retry harder.** `docs/spec/05_DISCOVERY_CONNECTORS.md`           | Not implemented |
| **Elevated failure rate**      | Task or request failures above baseline                             | Anything. Segment by `error_code` before drawing conclusions                                                                                    | Not implemented |
| **Budget overspend**           | Measured cost approaches the configured budget                      | Inference must be blocked (AT22) while **reads, review and export keep working**. Billing never gates correctness of in-flight outcome tracking | Not implemented |

**Alert on user-visible symptoms, not on internals.** Queue age matters because
the user is waiting. CPU usage on its own does not.

Until this exists, the substitutes are:
`docker compose ps` · `docker compose logs api --tail 100` ·
`docker compose logs worker --tail 100` · `sh scripts/smoke.sh`. See
[`RUNBOOK.md`](RUNBOOK.md).

---

## Operational parameters

Useful numbers, all from `docs/spec/02_ARCHITECTURE.md` and
`docs/spec/05_DISCOVERY_CONNECTORS.md`.

| Parameter             | Value                                   | Implication                                                              |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| Task lease            | 120 s                                   | A worker that dies has its task reclaimed within 120 s                   |
| Heartbeat             | 30 s                                    | Missing heartbeats are the early warning before reclamation              |
| UI poll (active)      | 2 s                                     | `scripts/smoke.sh` mirrors this                                          |
| UI poll (idle)        | 15 s                                    |                                                                          |
| Retries               | ≤ 3, exponential backoff with jitter    | **Browser filling is never blindly retried** — the page may have changed |
| `Retry-After`         | Always honoured                         | On 429                                                                   |
| Connector concurrency | 1 per host                              |                                                                          |
| Connector delay       | ≥ 1 s between requests                  |                                                                          |
| Scan interval         | 24 h with jitter                        | Jitter avoids a thundering herd on a board                               |
| Fetch timeout         | 20 s                                    |                                                                          |
| Per scan              | ≤ 1000 jobs, ≤ 100 pages                |                                                                          |
| Staged artifacts      | Expire after 24 h if unreferenced       |                                                                          |
| Upload cap            | 10 MiB for a CV (`MAX_UPLOAD_BYTES`)    |                                                                          |
| PDF limits            | 100 pages, 200 000 extracted characters |                                                                          |
| DOCX limit            | 50 MiB archive expansion                | Zip-bomb guard                                                           |

**Performance goals** (`docs/spec/11_TESTING_ACCEPTANCE.md`), measured on
declared hardware and **not yet measured at all**: 1000 stored jobs list p95
< 500 ms excluding network; normal API mutations p95 < 1 s; queue recovery
within lease expiry plus polling delay. AI and browser durations are variable —
show progress and timeouts rather than claiming a fixed latency.

---

## Graceful shutdown

Task leases are the reason this matters. A process killed mid-task leaves its
task `leased` until the 120 s lease expires; a process that shuts down cleanly
releases it immediately.

`docker-compose.yml` sets `stop_grace_period` accordingly:

| Service  | Grace | Why                                                                                      |
| -------- | ----- | ---------------------------------------------------------------------------------------- |
| `api`    | 45 s  | Drain in-flight requests, release held leases                                            |
| `worker` | 60 s  | Longer than the 30 s heartbeat, so the current step can finish and the lease be released |
| `db`     | 30 s  | A shutdown checkpoint is much cheaper than crash recovery on start                       |
| `web`    | 15 s  | Static content; nothing to drain                                                         |
| `ollama` | 60 s  | Model unload and in-flight generation                                                    |

Both the API and the worker are started in exec form so they receive `SIGTERM`
directly, with no shell in between to swallow it.

---

## Security-relevant operational rules

Restating the ones that get broken by accident:

- **The database is not published to the host.** Neither is the worker. Only
  `web`, and only on `127.0.0.1`. Changing this is a deliberate act with a
  documented trade-off — see `docker-compose.override.yml.example`.
- **`/internal/v1/*` is not proxied.** `infra/proxy/nginx.conf` has no location
  block for it, so the worker task protocol is unreachable through the public
  origin.
- **Containers run non-root** with `no-new-privileges`. The worker's `/tmp` is
  `noexec,nosuid` because untrusted uploaded content lands there.
- **`ENCRYPTION_KEY` lives outside the database and outside backups.** Keep it
  separately — see ADR17.
- **`LOCAL_MODEL_BASE_URL` is an operator allowlist**, and must never be used to
  widen the job-page fetcher's network policy. Hosted users cannot point model
  calls at arbitrary internal hosts.
