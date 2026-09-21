# Job Getter worker

The Python processing service. It claims tasks from the Node API, does the work
and returns a validated result.

**It is an outbound polling client.** It exposes no HTTP surface, opens no port
and never writes to the database. Node owns persistence and workflow
(`docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` invariant 1, ADR03). If you
find yourself wanting a `POST` route here, the feature belongs in `apps/api`.

Implemented milestones: **M0** (task protocol and the `noop_echo` probe),
**M1** (profile parsing and the model-provider abstraction) and the worker side
of **M2** (job discovery: the arbitrary-URL fetcher, the Greenhouse and Lever
connectors, normalisation, `fetch_board` and `fetch_job`). Nothing beyond that
exists yet, and nothing here pretends otherwise.

---

## The one rule this code exists to enforce

> Never invent qualifications, employers, dates, degrees, authorization, salary
> history, certifications, or achievement numbers.
> — `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md`, invariant 2

A model _proposes_ facts. `profile/truthfulness.py` decides which of them
survive, and it decides by asking one question of every value: **is this in the
document the user uploaded?** An employer that is not in the text is dropped. A
bullet containing a number the document does not contain is dropped. A
`user_declared_proficiency` the CV never states is blanked. Work authorization
is `unknown` unless the document says otherwise, and `unknown` is never promoted
to `yes`.

Provenance is _recomputed_ from the document rather than taken from the model:
a locator the worker cannot reproduce is not provenance.

---

## Layout

| Path                   | What it does                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `settings.py`          | Environment contract, capability validation                                                                             |
| `logging.py`           | Structured JSON logs with mandatory redaction                                                                           |
| `errors.py`            | Failure codes derived from the generated `FailRequest`                                                                  |
| `cancellation.py`      | The cooperative cancellation token                                                                                      |
| `api.py`               | Client for `/internal/v1/tasks`                                                                                         |
| `worker.py`            | Claim → lease → heartbeat → complete/fail loop                                                                          |
| `handlers/`            | Task registry; `noop_echo` (M0), `parse_profile` (M1), `fetch_board`/`fetch_job` (M2), `match_job` and `render_cv` (M3) |
| `extraction/`          | PDF, DOCX and text extraction with bounds and locators                                                                  |
| `profile/`             | Injection sanitising, grounding, the fact allowlist                                                                     |
| `net/`                 | The only outbound HTTP to job sources: destination policy, pinned fetcher, robots, politeness                           |
| `connectors/`          | Discovery connector contract; Greenhouse and Lever                                                                      |
| `discovery/`           | HTML-to-text, JSON-LD `JobPosting`, the country table, normalisation and `content_hash`                                 |
| `prompts/`             | Versioned prompt constants                                                                                              |
| `providers/`           | `ModelProvider` and the fake / Ollama / OpenAI-compatible adapters                                                      |
| `cli.py`               | `job-getter-worker` - the container worker                                                                              |
| `runner/`              | The paired desktop runner (M4): field model, planner, site adapters, browser, device token                              |
| `runner_cli.py`        | `job-getter-runner` - pair, run, status                                                                                 |
| `contracts/generated/` | Generated from the TypeBox schemas. **Never edit.**                                                                     |

Every shared model, enum and constant is imported from
`job_getter_worker.contracts.generated`. There is no hand-written parallel
model, enum or constant anywhere in this package; if something is missing from
the generated contracts, it gets reported rather than duplicated.

---

## Running it

```bash
cd services/worker

uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run pytest -q

uv run job-getter-worker          # needs WORKER_* configuration
```

Configuration lives in `.env.example` under "Worker". The required variables are
`WORKER_API_BASE_URL`, `WORKER_AUTH_TOKEN`, `WORKER_ID` and
`WORKER_CAPABILITIES`.

### A container worker cannot declare `fill_local`

`WORKER_CAPABILITIES=...,fill_local` makes the process **refuse to start**, with
an error explaining why. A headless container has no access to the user's
desktop browser session, and a worker that claims work it cannot do just burns
attempts and stalls the queue (`docs/spec/02_ARCHITECTURE.md`, ADR05).

Local browser filling is the paired desktop runner's job — which brings us to:

### `job-getter-runner`: the paired desktop runner

Browser filling happens on the user's own machine, in a browser they can see.

```bash
uv run job-getter-runner pair --server http://localhost:3000   # type the code in
uv run job-getter-runner run                                   # poll and fill
uv run job-getter-runner status                                # what is paired
```

`pair` reads a single-use code from the terminal rather than from an argument,
so it never reaches a shell history or a process listing, and exchanges it for a
scoped device token. The token and the Chromium profile live under a restricted
per-user state directory (`JOB_GETTER_RUNNER_HOME` overrides it) — outside the
repository, outside the workspace export and outside anything a backup script
touches, because both are credentials in everything but name.

What the runner will not do, enforced in code rather than promised here:

- **It never clicks submit.** There is no code path that does; its best outcome
  is `awaiting_user_submit`, a filled form with a person looking at it.
- **It never guesses an answer.** A choice field is filled only on an exact
  option match, and demographic, identity and assessment questions are left for
  the person however confidently a stored answer would have matched.
- **It never fills a page nobody has tested.** With no adapter for the page it
  reports `unsupported`, types nothing, and the user applies by hand.
- **It never leaves the origins the fill was authorised for.** A top-level
  navigation elsewhere is aborted.
- **It never reads the user's own browser profile.** Chromium runs from a
  profile this process owns; sessions in it are ones the user signed into there.

One adapter exists: `greenhouse/v1`, tested with a real Chromium against
`fixtures/ats-pages/greenhouse-application.html`. It has **never run against a
live Greenhouse board**, and the support matrix in the root README says so.

Playwright is an optional extra, so the planner and the adapters' parsing import
and test on a machine with no browser:

```bash
uv sync --extra browser
uv run playwright install chromium
```

Without it, `tests/test_runner_greenhouse.py` skips with a message naming the
cause, and `job-getter-runner run` exits non-zero with the same message. A
skipped browser test is never reported as a passing one.

---

## Protocol notes

- **204 from claim means "no work"**, not an error. The loop sleeps and backs
  off from the poll interval up to the idle maximum.
- **Heartbeat every `HEARTBEAT_SECONDS`** (30) while a handler runs, carrying
  `{stage, percent}`.
- **Cancellation is cooperative.** A heartbeat returning `cancel_requested` sets
  a token; the handler notices at its next safe checkpoint and the task is
  failed with `CANCELLED`. Nothing is left half applied.
- **A lost lease means abandon.** If the lease expires or a heartbeat returns
  409, the worker stops and does _not_ complete: the API has already handed the
  task to another attempt.
- **409 on complete is terminal.** It is never retried, because a second attempt
  could double-apply the same work.
- **Retries** cover connect errors and 5xx only, with exponential backoff plus
  jitter, honouring `Retry-After` on 429. A 4xx is never retried.

### The file-download endpoint takes a header

`GET /internal/v1/tasks/:id/files/:file_id` is the only request in the protocol
with no body, so its lease token travels in the `x-lease-token` header (see
`LEASE_TOKEN_HEADER` in `apps/api/src/routes/internal.ts`). The operator bearer
credential is not sufficient: it identifies the _worker_, not the _lease_. The
artifact upload keeps the token in the multipart body, which is what the API
reads first there.

---

## Processing limits

From `docs/spec/09_SECURITY_PRIVACY.md`. Two tiers, and the difference matters:

**Security bounds are hard.** 10 MiB upload, 100 PDF pages, 200 000 extracted
characters, 50 MiB DOCX expansion, a wall-clock budget. Crossing one is
`LIMIT_EXCEEDED` — a document that large is not something to process partially.
The DOCX expansion check reads the archive's declared uncompressed size _before_
extracting anything, so a zip bomb is refused rather than expanded.

**Task bounds may only be stricter.** `ParseProfileInput.limits` arriving below
a security bound truncates and raises `PAGES_TRUNCATED` / `CHARS_TRUNCATED`,
because the caller asked for less, not because the input is dangerous.

Other refusals: an encrypted PDF is `ENCRYPTED_DOCUMENT` (no password is tried,
not even the empty one); a PDF with pages but no text is `OCR_REQUIRED`, because
OCR is deferred and a deferred feature must not be replaced by a guess; a
macro-enabled DOCX, an XML entity declaration and a signature/extension mismatch
are all rejected outright. Nothing in a document is ever executed.

---

## Prompt injection

An uploaded document is data. `profile/sanitize.py` finds text addressed to an
AI system, removes that span, and — importantly — removes it from the evidence
corpus too. So an injected "PhD in Computer Science, Stanford, 2015" is not just
unrequested: it has nothing to stand on, and the grounding check drops it even
if a model repeats it. The user gets a `PROMPT_INJECTION_TEXT_IGNORED` warning
naming _where_ it was, never _what_ it said.

A user's `prompt_style_suffix` may change tone but cannot change facts. The
factual rules bracket it on both sides, its length is capped and block
delimiters and role markers are stripped, so nothing a user can type removes the
constraints or reaches the end of the prompt.

---

## Model providers

One interface (`ModelProvider.generate_structured`), three adapters, and **no
fallback between them**. ADR07 rejects automatic failover outright: someone who
chose a local model for privacy must never have their CV silently uploaded
because Ollama was down. `build_provider()` returns exactly one provider, and
there is no code path that selects a second.

Structured output is _detected_, not assumed — Ollama by server version,
OpenAI-compatible endpoints by downgrading on the first `response_format`
rejection. Where it is unavailable, output is parsed and validated with **at
most one correction attempt**, then `PROVIDER_INVALID_OUTPUT`.

Budget is reserved before a request and settled after. An unreported price stays
`None`; it never becomes `0`. A cost cap needs a configured rate card — without
one, the cap is reported as unenforceable and only token/request caps apply.

CI uses the deterministic fake provider, replaying `fixtures/model-responses/`.
No test needs a key, a network or a model.

---

## Logging

JSON, with `worker_id` / `task_id` / `request_id` bound into context. CV text,
extracted document text, draft fact values, answers, prompts, provider keys and
the lease token are never logged. `log_shape()` is the intended call site: it
accepts counts and codes and _refuses_ anything that looks like content, so the
easy way to describe work done ("extracted 4821 chars, proposed 23 facts")
carries nothing sensitive. A test feeds a real CV through a parse and asserts
none of its text reaches captured log output.

---

## Job discovery (M2)

### The fetcher is the network

`net/` is the only code that opens a connection to a job source, and it
applies `docs/spec/05_DISCOVERY_CONNECTORS.md` -> "For arbitrary URLs" before
anything else can happen (AT20):

1. **HTTPS only**, default port only, no credentials in the URL, no local
   names.
2. **`robots.txt`** is fetched once per host per process and honoured for the
   path under the `JobGetter` product token, including `Crawl-delay`. A
   disallow is `ROBOTS_DISALLOWED`; a 5xx or unreachable robots file counts
   as disallow (RFC 9309). There is no bypass.
3. **Every address a name resolves to must be public.** Private, loopback,
   link-local, multicast, unspecified, reserved, shared (100.64/10) and the
   cloud-metadata endpoints are refused for IPv4 and IPv6, including
   IPv4-mapped, 6to4, Teredo and NAT64 forms. One private record rejects the
   whole name (mixed records are the rebinding setup). This runs before the
   first connection **and again after every redirect**.
4. **The connection is pinned.** The request goes to the validated address;
   the `Host` header and the TLS server name (httpcore's `sni_hostname`
   extension, which Python's `ssl` verifies the certificate against) carry
   the real hostname. A DNS answer that changes between check and connect
   changes nothing.
5. **Bounds**: 20 s overall, at most 3 redirects, an accepted media type
   only, a body cap enforced _while streaming_. These are read off the
   generated `FetchJobInputPolicy` constraints, so a task policy can only
   tighten them.
6. **Nothing identifying**: no cookies (the jar is emptied after every
   response and the header stripped before every send), no `Authorization`,
   no proxy or `.netrc` from the environment, a fixed User-Agent naming the
   project.
7. **Politeness**: one in-flight request per host, at least one second
   between requests to the same host.

Connectors go through the same fetcher and may only contact their declared
`allowed_hosts`; a redirect anywhere else is `BLOCKED_DESTINATION`.

### Connectors

`connectors/base.py` is the spec contract (`id`, `version`, `allowed_hosts`,
`capabilities`, `config_schema`, `rate_policy`, `policy_review_url/date`;
`discover`, `get_job`, `healthcheck`). Greenhouse reads
`boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`; Lever reads
`api.lever.co/v0/postings/{site}?mode=json`, or `api.eu.lever.co` when
`base_url` names it - any other `base_url` is `INPUT_INVALID` before a request
is made. Both send `If-None-Match` / `If-Modified-Since` from the input and
return `ETag` / `Last-Modified`; both stop on 403 (`ACCESS_DENIED`) and 429
(`RATE_LIMITED`, with `Retry-After` in seconds from either header form)
without retrying. The response schemas they rely on are pinned by
`fixtures/jobs/*.json`; a required field that is missing or of the wrong type
is `SCHEMA_DRIFT` for the whole page, never a guess.

`source_key` for a board job is exactly `<connector>:<board_key>:<external_id>`
(`connectors.base.source_key_for`). A snapshot listing one identity twice is
collapsed to the first occurrence; the API collapses across scans.

### `complete_snapshot`

Only a scan in which every page was fetched within limits and no request
failed reports `complete_snapshot=True`. A cap, a denial, a rate limit, a
drift, a failed later page and a 304 all report `False` (AT06). A 304 in
particular returns `jobs: []`, a `NOT_MODIFIED` warning, `observed_health`
`ok`/304 and the echoed `etag`/`last_modified`: zero jobs with
`complete_snapshot=True` would close every job on the board. A transport
failure or timeout on the _first_ page fails the task (`FETCH_BLOCKED` /
`TIMEOUT`) so the API can decide about a retry; on a later page the jobs
already seen are returned as a partial result with `observed_health`
`degraded`.

### Normalisation: nothing is invented

`discovery/normalize.py` distinguishes structured values from inferences:

- **Structured** (an API field, a JSON-LD property) is used after validation.
  Mapping `"United States"` to `"US"` through the versioned table in
  `discovery/countries.py` is normalisation, not inference; the table holds
  unambiguous names only, so `"CA"` in free text stays `None`.
- **Inferred** (from the description by a heuristic) is used only with its
  excerpt in `inferred[]` and a `FIELD_INFERRED` warning that names the field
  without quoting the text. This covers `remote_type` from a location name or
  an explicit sentence, `eligible_countries` from an explicit statement
  ("must be located in", "only open to candidates located in", "authorized
  to work in", "US-only"), `salary` from text that has a currency marker
  **and** a period (a bare `$` keeps `currency=None`; no period, no salary;
  nothing is converted), `requirements` split out of
  Requirements/Qualifications/Nice-to-have sections, and `language` from
  stopword counts.
- **Unstated is null/unknown.** `published_at` comes only from a stated date;
  `eligible_countries` is `None` unless stated (never `[]`, never "anywhere"
  because a job is remote); `remote_type` is `unknown` unless the source says.

Text addressed to an AI system (the `profile/sanitize.py` patterns) is
excluded from every heuristic but kept in `description_text` as data (AT09):
the description is what the page said, and no field is derived from it.

**`content_hash`** is SHA-256 of the canonical JSON
`{"v":1,"title","company","description_text","locations","salary","apply_url"}`
(`sort_keys=True`, `separators=(",",":")`, UTF-8), where the three strings have
whitespace runs collapsed and are stripped, `locations` is the sorted list of
`[country, region, city]` (`""` for null), `salary` is
`[min, max, currency, period]` or `null`. Time fields, provenance excerpts,
requirements, inferred fields and the canonical URL are excluded on purpose
(`discovery.normalize.compute_content_hash`).

### `fetch_job`

A URL is fetched under the task's policy and read structured-data first: one
JSON-LD `JobPosting` is the `job`; several are `candidates` with
`MULTIPLE_POSTINGS`; none falls back to sanitised page text with
`NO_STRUCTURED_DATA` (title from `<title>`, company from the hint or a visible
placeholder). A blocked, disallowed, denied or rate-limited fetch is a
_result_ carrying the warning and `job: null`, so the UI can offer paste mode.
Pasted text is normalised with `extraction: pasted_text`, `fetch.performed:
false`, the user's `company_hint`/`title_hint` recorded verbatim, and identity
`manual:<content_hash>` for `external_id`, `source_key` and `canonical_url`
(no invented URL).

Every URL identity is `url:<normalised URL>` (lower-cased scheme and host, no
fragment, tracking parameters dropped, sorted query) with `external_id` its
SHA-256.

---

## Known gaps

Things this worker needs that the contract does not carry yet. Each is coded
against `docs/spec/04_API_CONTRACTS.md` and the generated models; none is worked
around by inventing a parallel type.

1. **`ParseProfileInput` has no provider block.** Per-workspace provider
   settings and secrets live in encrypted API settings
   (`docs/spec/06_AI_PROFILE_AND_CV.md`), but nothing carries them to the
   worker. The worker currently reads `PROVIDER_DEFAULT`,
   `LOCAL_MODEL_BASE_URL`, `WORKER_MODEL` and `WORKER_PROVIDER_*` from its own
   environment, which is correct for single-operator local mode and will not be
   correct for hosted multi-workspace mode.
2. **`prompt_style_suffix` does not reach the worker.** It lives in
   `Preferences`, not in `ParseProfileInput`. `build_parse_profile_prompt()`
   accepts and hardens it, and it is tested with hostile input, but the handler
   passes `None` until the task input carries it.
3. **No `TaskFailureCode` enum.** The failure-code set exists only as a
   `Literal` inside `FailRequest.code`. `errors.py` derives the tuple from that
   model at runtime rather than restating it; an exported enum would be nicer.
4. **No usage/cost fields on `ParseProfileResult`.** Settled usage is logged and
   the token counts are reported, but measured cost and the "price unknown" flag
   have nowhere to go in the result, so the API cannot record them per task.
