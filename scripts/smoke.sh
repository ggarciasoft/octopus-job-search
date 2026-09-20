#!/usr/bin/env sh
# =============================================================================
# scripts/smoke.sh - end-to-end check against a RUNNING stack
#
# POSIX shell + curl. PowerShell equivalent: scripts/smoke.ps1
#
# This is the M0 exit criterion from docs/spec/12_IMPLEMENTATION_PLAN.md:
#   "Deliver web -> API -> queued task -> Python -> stored result -> UI."
#
# It therefore does NOT mock anything. It talks to the same origin a browser
# talks to (http://localhost:3000, i.e. through the web container's /api
# proxy), authenticates like a browser, enqueues a real task, and waits for a
# real Python worker to claim it, process it and report a result back through
# the API. If any link in that chain is missing, this script fails.
#
# What it exercises, in order:
#   1. GET  /health/ready               - API is ready (database + schema + storage)
#   2. GET  /api/v1/setup               - is bootstrap still open?
#   3. POST /api/v1/setup   (or /auth/login if bootstrap already closed)
#   4. POST /api/v1/diagnostics/echo    - with a required Idempotency-Key
#   5. GET  /api/v1/tasks/:id           - polled until succeeded/failed/timeout
#   6. Re-POST step 4 with the SAME Idempotency-Key - must return the same task
#
# Exit status is 0 only if the task reaches state "succeeded". Every failure
# path prints the actual HTTP status and the actual response body.
# =============================================================================
set -eu

. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

BASE_URL="${SMOKE_BASE_URL:-http://localhost:3000}"
EMAIL="${SMOKE_EMAIL:-smoke@localhost.invalid}"
PASSWORD="${SMOKE_PASSWORD:-}"
TIMEOUT_SECS="${SMOKE_TIMEOUT:-120}"
READY_TIMEOUT="${SMOKE_READY_TIMEOUT:-90}"
KEEP_JAR=0

usage() {
  cat <<'HELPTEXT'
scripts/smoke.sh - prove web -> API -> queue -> Python -> result works

USAGE
    sh scripts/smoke.sh [options]

OPTIONS
    --base-url URL    Origin to test. Default http://localhost:3000, which is
                      what docker-compose.yml publishes.
    --email ADDR      Owner email. Default smoke@localhost.invalid
    --password PW     Owner password (min 12 chars). PREFER the environment
                      variable SMOKE_PASSWORD: a password passed as an argument
                      is visible in `ps` output and in your shell history.
                      If neither is given and bootstrap is still open, a random
                      one is generated and printed once.
    --timeout SECS    How long to wait for the task to finish. Default 120.
    --keep-jar        Keep the temporary cookie jar (debugging only). It holds
                      a live session cookie; delete it when you are done.
    -h, --help        Show this help and exit.

ENVIRONMENT
    SMOKE_BASE_URL, SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_TIMEOUT,
    SMOKE_READY_TIMEOUT, SMOKE_SETUP_TOKEN
    JG_READY_PATH / JG_LIVE_PATH override the health endpoint paths.

PREREQUISITES
    The stack must already be running:
        docker compose up --build -d
    This script does not start, build or stop anything.

WHAT A FAILURE MEANS
    ready      API is up but not ready: usually migrations have not run, or
               FILES_ROOT is not writable. Check `docker compose logs api`.
    setup      Bootstrap is closed and no password was supplied, or the
               SETUP_TOKEN in .env does not match the API's.
    enqueue    The API accepted authentication but not the task. The body is
               printed; a VALIDATION_ERROR names the field.
    timeout    The task was queued but never completed. That almost always
               means NO WORKER IS CLAIMING IT - check `docker compose logs
               worker`, and check WORKER_CAPABILITIES includes noop_echo.

EXIT STATUS
    0 only when the probe task reached state "succeeded".
HELPTEXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) BASE_URL=${2:?--base-url needs a value}; shift ;;
    --email)    EMAIL=${2:?--email needs a value}; shift ;;
    --password) PASSWORD=${2:?--password needs a value}; shift ;;
    --timeout)  TIMEOUT_SECS=${2:?--timeout needs a value}; shift ;;
    --keep-jar) KEEP_JAR=1 ;;
    -h|--help)  usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

require_curl
BASE_URL=$(printf '%s' "$BASE_URL" | sed 's#/*$##')   # strip trailing slashes

# --- Scratch state ------------------------------------------------------------
# The cookie jar holds a live session cookie. It is created with restrictive
# permissions in a private temp directory and removed on every exit path,
# including Ctrl-C.
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/jg-smoke.XXXXXX") || die "cannot create a temp directory"
JAR="${WORKDIR}/cookies.txt"
BODY="${WORKDIR}/body.json"
chmod 700 "$WORKDIR" 2>/dev/null || true

cleanup() {
  _status=$?
  if [ "$KEEP_JAR" = "1" ]; then
    warn "Cookie jar kept at ${JAR} - it contains a live session cookie. Delete it."
  else
    rm -rf "$WORKDIR" 2>/dev/null || true
  fi
  exit $_status
}
trap cleanup EXIT INT TERM

# --- HTTP helper --------------------------------------------------------------
# Writes the response body to $BODY and echoes the numeric status. Keeps the
# cookie jar across calls so the session cookie behaves exactly as in a browser.
#
# Origin is always sent: docs/spec/09_SECURITY_PRIVACY.md requires origin
# verification on state-changing routes, so omitting it would make every
# mutation look cross-origin and fail for the wrong reason.
api() {
  _method=$1; _path=$2; shift 2
  curl --silent --show-error \
       --request "$_method" \
       --cookie "$JAR" --cookie-jar "$JAR" \
       --header "Accept: application/json" \
       --header "Origin: ${BASE_URL}" \
       --header "Referer: ${BASE_URL}/" \
       --max-time 30 \
       --output "$BODY" \
       --write-out '%{http_code}' \
       "$@" \
       "${BASE_URL}${_path}" 2>>"${WORKDIR}/curl.err" || {
         printf '000'
         return 0
       }
}

show_body() {
  printf '    response body:\n' >&2
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool < "$BODY" 2>/dev/null | sed 's/^/    /' >&2 || sed 's/^/    /' "$BODY" >&2
  else
    sed 's/^/    /' "$BODY" >&2
  fi
  printf '\n' >&2
}

fail_with_body() {
  printf '\n' >&2
  log "--- $1 ---"
  log "    HTTP status: ${2:-n/a}"
  show_body
  [ -s "${WORKDIR}/curl.err" ] && { log "    curl stderr:"; sed 's/^/    /' "${WORKDIR}/curl.err" >&2; }
  die "$1"
}

# Minimal JSON string extraction. Deliberately not a full parser: this script
# must run with nothing but sh and curl available. python3 is used when present
# because it is correct; the sed fallback is good enough for the flat, known
# shapes this script reads.
json_str() {
  _key=$1
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "
import json,sys
try:
    d=json.load(open(sys.argv[1], encoding='utf-8'))
except Exception:
    sys.exit(0)
v=d
for part in sys.argv[2].split('.'):
    if isinstance(v, dict) and part in v:
        v=v[part]
    else:
        sys.exit(0)
if v is not None and not isinstance(v,(dict,list)):
    sys.stdout.write(str(v).lower() if isinstance(v,bool) else str(v))
" "$BODY" "$_key" 2>/dev/null
  else
    _leaf=${_key##*.}
    sed -n "s/.*\"${_leaf}\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$BODY" | head -n 1
  fi
}

log ""
log "Job Getter smoke test"
log "  target: ${BASE_URL}"
log ""

# =============================================================================
# Step 1 - readiness
#
# Liveness (process is up) and readiness (database, schema and storage are
# usable) are different questions; only readiness tells us the stack can
# actually serve. docs/spec/10_DEPLOYMENT.md defines both.
#
# NOTE: the health endpoint PATHS are a cross-component convention, not part of
# the versioned /api/v1 contract in packages/contracts. /health/ready is the
# path apps/api/src/health.ts actually registers (verified 2026-09-20), and it
# is probed first; the alternatives are kept so a future rename produces a clear
# message instead of a mystery timeout. Override with JG_READY_PATH.
# =============================================================================
info "1/6 waiting for readiness (up to ${READY_TIMEOUT}s)"

READY_CANDIDATES="${JG_READY_PATH:-/health/ready /readyz /api/v1/health/ready}"
READY_PATH=""
_deadline=$(( $(date +%s) + READY_TIMEOUT ))
while :; do
  for _p in $READY_CANDIDATES; do
    _code=$(api GET "$_p")
    if [ "$_code" = "200" ]; then
      READY_PATH="$_p"
      break
    fi
  done
  [ -n "$READY_PATH" ] && break
  if [ "$(date +%s)" -ge "$_deadline" ]; then
    log ""
    log "None of these readiness paths returned 200 within ${READY_TIMEOUT}s:"
    for _p in $READY_CANDIDATES; do log "    ${BASE_URL}${_p}"; done
    log ""
    log "Last response (${_code:-000}):"
    show_body
    log "Check:  docker compose ps"
    log "        docker compose logs api --tail 50"
    log "If the API is alive but not READY, migrations probably have not run:"
    log "        sh scripts/migrate.sh"
    die "readiness check failed"
  fi
  printf '.' >&2
  sleep 2
done
printf '\n' >&2
ok "ready at ${READY_PATH}"

# =============================================================================
# Step 2 - is one-time setup still open?
# =============================================================================
info "2/6 checking bootstrap state"

CODE=$(api GET /api/v1/setup)
[ "$CODE" = "200" ] || fail_with_body "GET /api/v1/setup did not answer 200" "$CODE"

SETUP_REQUIRED=$(json_str setup_required)
APP_MODE_REPORTED=$(json_str mode)
ok "mode=${APP_MODE_REPORTED:-unknown} setup_required=${SETUP_REQUIRED:-unknown}"

# =============================================================================
# Step 3 - authenticate
#
# Either complete the single-use bootstrap, or - if it is already closed - log
# in normally. "Already closed" is a normal state, not a failure: this script
# is expected to be re-runnable against an installation that has been set up.
# =============================================================================
if [ "$SETUP_REQUIRED" = "True" ] || [ "$SETUP_REQUIRED" = "true" ]; then
  info "3/6 completing one-time setup"

  SETUP_TOKEN_VALUE="${SMOKE_SETUP_TOKEN:-}"
  if [ -z "$SETUP_TOKEN_VALUE" ] && [ -f "$JG_ENV_FILE" ]; then
    SETUP_TOKEN_VALUE=$(env_get SETUP_TOKEN || printf '')
  fi
  [ -n "$SETUP_TOKEN_VALUE" ] || die \
    "bootstrap is open but no SETUP_TOKEN was found in .env or SMOKE_SETUP_TOKEN. Run 'sh scripts/setup.sh' first."

  GENERATED_PASSWORD=0
  if [ -z "$PASSWORD" ]; then
    # Must satisfy the 12-character minimum in the SetupRequest schema.
    PASSWORD=$(random_token 24)
    GENERATED_PASSWORD=1
  fi

  # The request body is written to a file and passed with --data-binary @file,
  # NOT inline with --data: an inline body puts the setup token and the
  # password into the process argument list, where any local user can read them
  # with `ps`.
  REQ="${WORKDIR}/setup-req.json"
  ( umask 077
    printf '{"setup_token":"%s","email":"%s","password":"%s","locale":"en"}\n' \
      "$SETUP_TOKEN_VALUE" "$EMAIL" "$PASSWORD" > "$REQ" )

  CODE=$(api POST /api/v1/setup \
           --header "Content-Type: application/json" \
           --data-binary "@${REQ}")
  rm -f "$REQ"

  if [ "$CODE" != "201" ] && [ "$CODE" != "200" ]; then
    fail_with_body "one-time setup failed" "$CODE"
  fi
  ok "owner created, session established"

  if [ "$GENERATED_PASSWORD" = "1" ]; then
    log ""
    log "  A password was generated for the smoke-test owner account:"
    printf '      %s\n' "$PASSWORD" >&2
    log "  Printed once. Save it if you want to reuse this installation, or"
    log "  export SMOKE_PASSWORD next time so a fixed one is used."
    log ""
  fi
else
  info "3/6 bootstrap already closed; logging in as ${EMAIL}"

  [ -n "$PASSWORD" ] || die \
    "bootstrap is closed, so a password is required. Set SMOKE_PASSWORD (preferred) or pass --password."

  REQ="${WORKDIR}/login-req.json"
  ( umask 077
    printf '{"email":"%s","password":"%s"}\n' "$EMAIL" "$PASSWORD" > "$REQ" )

  CODE=$(api POST /api/v1/auth/login \
           --header "Content-Type: application/json" \
           --data-binary "@${REQ}")
  rm -f "$REQ"

  [ "$CODE" = "200" ] || fail_with_body "login failed" "$CODE"
  ok "logged in"
fi

# Anti-CSRF: docs/spec/09_SECURITY_PRIVACY.md requires an anti-CSRF token plus
# origin verification on state-changing routes. apps/api/src/auth/sessions.ts
# sets a readable `jg_csrf` cookie alongside the HttpOnly session cookie, and
# expects it echoed back in the `x-csrf-token` header (verified 2026-09-20).
# The other names are kept as a fallback. Origin and Referer are already sent on
# every request by api().
CSRF_TOKEN=""
if [ -f "$JAR" ]; then
  for _name in jg_csrf _csrf csrf-token csrfToken XSRF-TOKEN; do
    _v=$(awk -v n="$_name" '$0 !~ /^#/ && $6 == n { print $7 }' "$JAR" | tail -n 1)
    if [ -n "$_v" ]; then CSRF_TOKEN="$_v"; break; fi
  done
fi
if [ -n "$CSRF_TOKEN" ]; then
  info "anti-CSRF token picked up from the cookie jar"
else
  info "no anti-CSRF cookie found; continuing. A 403 on the next step means this script needs the API's actual CSRF scheme wired in."
fi

# =============================================================================
# Step 4 - enqueue the probe task
#
# POST /api/v1/diagnostics/echo is declared with requiresIdempotencyKey in
# packages/contracts/src/routes.ts, so the header is mandatory, not optional.
# =============================================================================
info "4/6 enqueuing the noop_echo probe task"

IDEMPOTENCY_KEY="smoke-$(random_token 12)"
PROBE_MESSAGE="smoke test $(date -u +%Y-%m-%dT%H:%M:%SZ)"

REQ="${WORKDIR}/echo-req.json"
printf '{"message":"%s","delay_ms":250}\n' "$PROBE_MESSAGE" > "$REQ"

post_echo() {
  if [ -n "$CSRF_TOKEN" ]; then
    api POST /api/v1/diagnostics/echo \
      --header "Content-Type: application/json" \
      --header "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
      --header "x-csrf-token: ${CSRF_TOKEN}" \
      --data-binary "@${REQ}"
  else
    api POST /api/v1/diagnostics/echo \
      --header "Content-Type: application/json" \
      --header "Idempotency-Key: ${IDEMPOTENCY_KEY}" \
      --data-binary "@${REQ}"
  fi
}

CODE=$(post_echo)
[ "$CODE" = "202" ] || fail_with_body "enqueuing the probe task failed (expected 202 Accepted)" "$CODE"

TASK_ID=$(json_str task_id)
[ -n "$TASK_ID" ] || fail_with_body "the 202 response contained no task_id" "$CODE"
ok "queued task ${TASK_ID}"

# =============================================================================
# Step 5 - poll until the worker finishes it
#
# The UI polls every two seconds while a task is active
# (docs/spec/02_ARCHITECTURE.md); this mirrors that.
# =============================================================================
info "5/6 polling GET /api/v1/tasks/${TASK_ID} (up to ${TIMEOUT_SECS}s)"

_deadline=$(( $(date +%s) + TIMEOUT_SECS ))
LAST_STATE=""
while :; do
  CODE=$(api GET "/api/v1/tasks/${TASK_ID}")
  [ "$CODE" = "200" ] || fail_with_body "polling the task failed" "$CODE"

  STATE=$(json_str state)
  if [ "$STATE" != "$LAST_STATE" ]; then
    printf '\n      state: %s' "$STATE" >&2
    LAST_STATE="$STATE"
  else
    printf '.' >&2
  fi

  case "$STATE" in
    succeeded)
      printf '\n' >&2
      break
      ;;
    failed|cancelled)
      printf '\n' >&2
      fail_with_body "the probe task ended in state '${STATE}'" "$CODE"
      ;;
  esac

  if [ "$(date +%s)" -ge "$_deadline" ]; then
    printf '\n' >&2
    log "Task ${TASK_ID} was still '${STATE}' after ${TIMEOUT_SECS}s."
    show_body
    log "A task stuck in 'queued' means nothing is claiming it. Check:"
    log "    docker compose ps worker"
    log "    docker compose logs worker --tail 50"
    log "    grep WORKER_CAPABILITIES .env      # must include noop_echo"
    log "A task stuck in 'leased' means a worker took it and stopped"
    log "heartbeating; it should be reclaimed after the 120s lease expires."
    die "timed out waiting for the probe task"
  fi
  sleep 2
done

# The whole point of the probe: the result came back from the PYTHON worker, so
# every hop actually exists.
ECHOED=$(json_str result.echoed)
WORKER_ID_SEEN=$(json_str result.worker_id)
WORKER_RUNTIME=$(json_str result.worker_runtime)

ok "task succeeded"
log "      echoed         : ${ECHOED:-<unreadable>}"
log "      worker_id      : ${WORKER_ID_SEEN:-<unreadable>}"
log "      worker_runtime : ${WORKER_RUNTIME:-<unreadable>}"

if [ -n "$ECHOED" ] && [ "$ECHOED" != "$PROBE_MESSAGE" ]; then
  fail_with_body "the worker echoed '${ECHOED}' but the message sent was '${PROBE_MESSAGE}'" "$CODE"
fi

# =============================================================================
# Step 6 - idempotency
#
# docs/spec/04_API_CONTRACTS.md: the same Idempotency-Key with the same body
# must return the stored response rather than queueing a second task. Getting
# this wrong is how duplicate work happens, so it is checked here rather than
# assumed.
# =============================================================================
info "6/6 replaying the same Idempotency-Key"

CODE=$(post_echo)
if [ "$CODE" != "202" ] && [ "$CODE" != "200" ]; then
  fail_with_body "replaying the idempotency key returned ${CODE}; expected the stored 202 response" "$CODE"
fi
REPLAY_TASK_ID=$(json_str task_id)
if [ "$REPLAY_TASK_ID" != "$TASK_ID" ]; then
  fail_with_body "replaying Idempotency-Key '${IDEMPOTENCY_KEY}' created a SECOND task (${REPLAY_TASK_ID}) instead of returning ${TASK_ID}" "$CODE"
fi
ok "idempotent replay returned the same task"

log ""
ok "SMOKE TEST PASSED"
log ""
log "  Verified for real, with no mocks:"
log "    browser origin -> /api proxy -> API      (${BASE_URL})"
log "    API -> PostgreSQL                        (readiness at ${READY_PATH})"
log "    API -> task queue row"
log "    Python worker claimed and completed it   (worker_id ${WORKER_ID_SEEN:-?})"
log "    result stored and readable through GET /api/v1/tasks/:id"
log "    Idempotency-Key replay did not duplicate work"
log ""
exit 0
