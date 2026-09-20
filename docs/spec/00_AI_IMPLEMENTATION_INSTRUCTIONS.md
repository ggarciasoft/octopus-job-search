# Instructions for the implementing AI

## Objective and precedence

Implement the product described in this folder. Priority: latest owner instruction, this file's non-negotiable invariants, numbered technical specifications, examples. If two technical files conflict, document the conflict and choose the option preserving privacy, truthful output, and no duplicate submission. Ask only for product decisions that materially block progress; make routine implementation choices and record them.

## Non-negotiable invariants

1. Node.js owns persistence and workflow; Python owns processing and automation. No Python database writes or duplicate business API.
2. Never invent qualifications, employers, dates, degrees, authorization, salary history, certifications, or achievement numbers.
3. A match score measures heuristic fit, not probability of getting hired.
4. No automatic submissions in the pilot or hosted beta. User approves a specific application snapshot and performs the final submit in their browser.
5. Never call an application submitted without evidence or an explicit, labeled user report.
6. Never retry a submission when its outcome is uncertain.
7. Credentials/cookies for job websites remain in the user's browser. No CAPTCHA solving or evasion, proxy rotation, fingerprint spoofing, or restriction bypass.
8. Hosted data must be scoped to the authenticated workspace on every operation. Local mode does not mean unauthenticated access.
9. Treat job pages, imported documents, and AI output as untrusted data.
10. No unsupported website may be presented as a working integration.

## Delivery discipline

- Begin with repository structure, dependency locks, Docker Compose, migrations, health checks, seed fixtures, and contract generation.
- Use Node 24 LTS and Python 3.12 as baseline runtime choices; pin compatible patch versions and container digests at implementation. Check security support then, do not invent latest versions.
- Use pnpm workspace with lockfile and uv with uv.lock. Use TypeScript strict mode, Ruff, mypy, Vitest, pytest, and browser integration tests.
- Generate OpenAPI and JSON Schema artifacts, TypeScript client, and Pydantic worker models from the authoritative schemas. Check drift in CI. No handwritten parallel enum sets.
- Implement meaningful behavior tests, not tests that only repeat mocks or setters.
- Provide .env.example without secrets; migrations must be repeatable from an empty database.
- Use fake AI/search providers and local ATS fixtures for deterministic CI; live tests are opt-in and never submit to a real employer automatically.
- Keep the system small: no Kubernetes, Kafka, vector database, or microservice fleet in v1.
- Do not add hidden telemetry, credit-card requirements, or hosted dependencies to self-hosting.

## Repository layout

```text
apps/web/                 React + Vite + TypeScript
apps/api/                 Fastify + TypeScript, SQL persistence, scheduler
apps/extension/           Chrome Manifest V3, milestone M5
services/worker/          Python processing and optional local browser runner
packages/contracts/      JSON Schema and generated OpenAPI/types
packages/api-client/     generated typed client
packages/ui/             shared UI primitives
infra/                    Dockerfiles, Compose, reverse proxy configuration
fixtures/                 synthetic CVs, jobs, ATS pages, model responses
scripts/                  setup, migration, smoke, backup and restore commands
docs/                     this specification and implementation status
```

## Definition of done per milestone

Runnable code, migrations, relevant tests, documented commands, sample data, error and empty states, and status notes. Clearly label any unsupported behavior. Never replace missing backend behavior with a button that reports success. Record real test output and remaining failures. Keep secrets and personal CVs out of git.
