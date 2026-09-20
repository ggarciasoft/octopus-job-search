# Local and hosted deployment

## Local target

Support Windows via Docker Desktop/WSL2, macOS and Linux for server services. Desktop runner compatibility must be tested separately on each supported OS. Pilot can certify one OS first and clearly label the others unverified. Target 8 GB RAM without local model; local model requirements depend on model/hardware and must be measured, not guaranteed.

The implementing repository must provide these commands:

```bash
cp .env.example .env
# Generate local secrets using the supplied setup script before starting.
docker compose up --build -d
# Open http://localhost:3000 and complete one-time setup.
docker compose --profile local-ai up -d
# Optional model profile; explicit model download/license selection required.
```

Expose web on 127.0.0.1:3000. Proxy /api to API internally. PostgreSQL/worker are not published to host by default. Database migrations run as a one-shot service before API readiness. Use named volumes for DB/files; docker compose down must preserve data. Document the destructive nature of down -v. Provide graceful shutdown and task lease recovery.

Desktop runner command to implement: uv run --project services/worker job-getter-runner pair --server http://localhost:3000. Pairing code is entered interactively, never placed in shell history. Runner uses only fill_local capability and visible browser. Container worker handles noninteractive processing and CV rendering with separately installed Chromium.

## Environment contract

APP_MODE=local|hosted; APP_ORIGIN; DATABASE_URL; SESSION_SECRET; SETUP_TOKEN; ENCRYPTION_KEY; WORKER_AUTH_TOKEN; STORAGE_DRIVER=local|s3; FILES_ROOT; S3_ENDPOINT/BUCKET/REGION; S3 credentials; PROVIDER_DEFAULT=none|ollama|openai_compatible; LOCAL_MODEL_BASE_URL; MAX_UPLOAD_BYTES; LOG_LEVEL; ALLOWED_FETCH_HOSTS; SMTP settings for hosted auth; BILLING_ENABLED=false.

Secrets are generated at setup, never committed. User AI keys use encrypted settings rather than global environment unless single-user operator mode is explicitly configured. Local model endpoints are operator-allowlisted; hosted users cannot point model calls at arbitrary internal hosts.

## Hosted beta

One small API service, one processing worker, managed PostgreSQL, private S3-compatible storage, reverse proxy/TLS, email service and scheduled backups. Size after measuring pilot usage; do not buy a cluster upfront. No cloud browser farm in beta. UI can be statically hosted behind the same origin. Internal worker routes must not be generally accessible from the public internet.

Store uploads through API initially (10 MiB cap); later direct signed upload requires new security review. Scale worker replicas from queue latency; cap per-workspace concurrent tasks and fair-share claims to prevent noisy neighbors. PostgreSQL leases coordinate replicas. Billing never controls correctness of in-flight outcome tracking; expired quota blocks new billable work, not reads, exports or manual outcomes.

## Observability and operation

Structured redacted logs with request/task ID, duration and error code. Metrics: queue depth/age, connector success, provider latency/token usage, invalid AI outputs, blocked duplicates, uncertain outcomes, file processing failures and per-user cost. Alerts for stalled queue, repeated connector 403/429, elevated failures and budget overspend. Health endpoints: liveness process only; readiness database/schema/storage configuration.

## Backup, restore and release

Backup database daily and files with consistent metadata; encrypt backups. Supply scripts for backup and restore to a separate installation. Test that a restored application can download its original CV and preserve packet hashes/history. Reapply deletion ledger before reopening access. Pilot recovery targets: at most 24 hours data loss, restore within 4 hours; validate before claiming them.

Release immutable container tags/digests with lockfiles and migrations. Back up before migration. Prefer additive schema changes with documented rollbacks; never blindly run down migrations on live data. A rollback must preserve application outcome evidence. Document upgrading local installations and extension/server protocol compatibility (support current and previous protocol minor version).
