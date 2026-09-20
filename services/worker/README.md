# Job Getter worker

The Python processing service. It claims tasks from the Node API, does the work
and returns a validated result.

**It is an outbound polling client.** It exposes no HTTP surface, opens no port
and never writes to the database. Node owns persistence and workflow
(`docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md` invariant 1, ADR03). If you
find yourself wanting a `POST` route here, the feature belongs in `apps/api`.

Implemented milestones: **M0** (task protocol and the `noop_echo` probe) and
**M1** (profile parsing and the model-provider abstraction). Nothing beyond
that exists yet, and nothing here pretends otherwise.

---

## The one rule this code exists to enforce

> Never invent qualifications, employers, dates, degrees, authorization, salary
> history, certifications, or achievement numbers.
> — `docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md`, invariant 2

A model *proposes* facts. `profile/truthfulness.py` decides which of them
survive, and it decides by asking one question of every value: **is this in the
document the user uploaded?** An employer that is not in the text is dropped. A
bullet containing a number the document does not contain is dropped. A
`user_declared_proficiency` the CV never states is blanked. Work authorization
is `unknown` unless the document says otherwise, and `unknown` is never promoted
to `yes`.

Provenance is *recomputed* from the document rather than taken from the model:
a locator the worker cannot reproduce is not provenance.

---

## Layout

| Path | What it does |
|---|---|
| `settings.py` | Environment contract, capability validation |
| `logging.py` | Structured JSON logs with mandatory redaction |
| `errors.py` | Failure codes derived from the generated `FailRequest` |
| `cancellation.py` | The cooperative cancellation token |
| `api.py` | Client for `/internal/v1/tasks` |
| `worker.py` | Claim → lease → heartbeat → complete/fail loop |
| `handlers/` | Task registry; `noop_echo` (M0), `parse_profile` (M1) |
| `extraction/` | PDF, DOCX and text extraction with bounds and locators |
| `profile/` | Injection sanitising, grounding, the fact allowlist |
| `prompts/` | Versioned prompt constants |
| `providers/` | `ModelProvider` and the fake / Ollama / OpenAI-compatible adapters |
| `cli.py` | `job-getter-worker` - the container worker |
| `runner_cli.py` | `job-getter-runner` - **not implemented until M4** |
| `contracts/generated/` | Generated from the TypeBox schemas. **Never edit.** |

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

### `job-getter-runner` does not work yet

The command exists because `docs/spec/10_DEPLOYMENT.md` names it. Running it
prints what it *will* do at M4 and exits non-zero. It does not print a pairing
code, open a browser or create a device token, because a stub that looks like it
worked is worse than no stub (invariant 10).

---

## Protocol notes

* **204 from claim means "no work"**, not an error. The loop sleeps and backs
  off from the poll interval up to the idle maximum.
* **Heartbeat every `HEARTBEAT_SECONDS`** (30) while a handler runs, carrying
  `{stage, percent}`.
* **Cancellation is cooperative.** A heartbeat returning `cancel_requested` sets
  a token; the handler notices at its next safe checkpoint and the task is
  failed with `CANCELLED`. Nothing is left half applied.
* **A lost lease means abandon.** If the lease expires or a heartbeat returns
  409, the worker stops and does *not* complete: the API has already handed the
  task to another attempt.
* **409 on complete is terminal.** It is never retried, because a second attempt
  could double-apply the same work.
* **Retries** cover connect errors and 5xx only, with exponential backoff plus
  jitter, honouring `Retry-After` on 429. A 4xx is never retried.

### The file-download endpoint takes a header

`GET /internal/v1/tasks/:id/files/:file_id` is the only request in the protocol
with no body, so its lease token travels in the `x-lease-token` header (see
`LEASE_TOKEN_HEADER` in `apps/api/src/routes/internal.ts`). The operator bearer
credential is not sufficient: it identifies the *worker*, not the *lease*. The
artifact upload keeps the token in the multipart body, which is what the API
reads first there.

---

## Processing limits

From `docs/spec/09_SECURITY_PRIVACY.md`. Two tiers, and the difference matters:

**Security bounds are hard.** 10 MiB upload, 100 PDF pages, 200 000 extracted
characters, 50 MiB DOCX expansion, a wall-clock budget. Crossing one is
`LIMIT_EXCEEDED` — a document that large is not something to process partially.
The DOCX expansion check reads the archive's declared uncompressed size *before*
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
naming *where* it was, never *what* it said.

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

Structured output is *detected*, not assumed — Ollama by server version,
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
accepts counts and codes and *refuses* anything that looks like content, so the
easy way to describe work done ("extracted 4821 chars, proposed 23 facts")
carries nothing sensitive. A test feeds a real CV through a parse and asserts
none of its text reaches captured log output.

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
