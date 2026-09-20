# Architecture

## Components and ownership

| Component | Technology | Responsibility |
|---|---|---|
| Web | React, Vite, TypeScript, Tailwind, TanStack Query | Profile, discovery, review, settings, tracking |
| API | Node.js 24, Fastify, TypeBox JSON Schema, Kysely + pg | Authentication, validation, authorization, SQL, task leases, scheduling |
| Worker | Python 3.12, Pydantic, httpx, pypdf, python-docx, Jinja2, Playwright | Parse, discover, match, generate files, supported local browser filling |
| Database | PostgreSQL 17 baseline | Durable state and task queue |
| Files | Local mounted directory; S3-compatible adapter hosted | Private uploads, generated files, exports |
| Extension | TypeScript, Chrome Manifest V3 | User-triggered filling inside existing browser sessions |
| Model providers | Local Ollama adapter; OpenAI-compatible cloud adapter | Structured inference behind one provider interface |

Dependency choices are defaults; verify compatibility and pin exact packages during M0. The Python service is an outbound polling worker, not another public API. Do not introduce Redis/Celery/BullMQ merely to bridge languages.

## Data flow

1. Browser calls Node API with authenticated session.
2. API commits domain mutation and task row in the same PostgreSQL transaction.
3. Python claims a capability-compatible task through a private authenticated API.
4. API atomically leases one task using SELECT FOR UPDATE SKIP LOCKED.
5. Worker fetches minimal input and files via task-scoped endpoints.
6. Worker processes input, heartbeats, uploads task artifacts, and returns a validated result.
7. API transaction applies result, marks task complete, and emits an event row.
8. UI polls tasks every two seconds while active, backs off to 15 seconds while idle.

## Queue semantics

Task types: parse_profile, fetch_board, fetch_job, match_job, render_cv, build_packet, fill_local, export_workspace, delete_workspace, discover_boards.

States: queued, leased, succeeded, failed, cancelled. Store run_after, attempt, max_attempts, lease_token, lease_expires_at, capability, workspace_id, idempotency_key. Lease 120 seconds; heartbeat every 30 seconds. Completing with a stale token returns 409 and has no domain effect. Reclaimed tasks receive a new token.

Ordinary read/compute tasks retry at most three times with exponential backoff and jitter. Respect Retry-After on 429. Browser filling is not blindly retried because the user may have changed the page. There is no submission task in v1. An artifact upload before task completion is staging only; unreferenced artifacts expire after 24 hours.

## Execution modes

Local Compose starts web, API, worker, PostgreSQL and file volume. Optional Ollama is a separate Compose profile or configurable existing local endpoint. A local desktop browser runner is a Python process installed through uv and paired as a worker with only fill_local capability. This avoids pretending a headed browser inside a headless Docker container can interact with the user's desktop. Alternatively use the extension after M5.

Hosted deployment runs API/worker/database/files; hosted worker does no authenticated job-site browsing. Browser filling happens in the extension. The same domain code and schemas serve both modes; billing is only an optional hosted module.

## AI and integration boundaries

Models return structured suggestions, never database commands or browser scripts. Deterministic adapters interpret validated results. Content extraction cannot grant a model tool permissions. Provider and connector registries use versioned interfaces; hosted mode only loads operator-installed reviewed code, not arbitrary user plugins.
