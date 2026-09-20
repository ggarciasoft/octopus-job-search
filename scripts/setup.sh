#!/usr/bin/env sh
# =============================================================================
# scripts/setup.sh - generate .env with fresh, cryptographically random secrets
#
# POSIX shell. Run on Linux, macOS, or Windows via Git Bash / WSL.
# Windows users who prefer PowerShell: use scripts/setup.ps1 instead. The two
# are feature-equivalent.
# =============================================================================
set -eu

. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

FORCE=0
KEEP_EXISTING=0

usage() {
  cat <<'HELPTEXT'
scripts/setup.sh - create .env and generate local secrets

USAGE
    sh scripts/setup.sh [options]

WHAT IT DOES
    1. Copies .env.example to .env (only if .env does not already exist).
    2. Generates cryptographically random values for:
         SESSION_SECRET      32 random bytes, base64  (session cookie signing)
         ENCRYPTION_KEY      32 random bytes, base64  (encrypts stored provider
                                                       API keys; must be
                                                       exactly 32 bytes)
         WORKER_AUTH_TOKEN   32 random bytes, URL-safe (worker -> /internal/v1)
         SETUP_TOKEN         32 random bytes, URL-safe (one-time bootstrap)
    3. Prints SETUP_TOKEN to this terminal ONCE.

OPTIONS
    --force            Overwrite an existing .env. This REGENERATES EVERY
                       SECRET. See "What --force costs you" below.
    --keep-existing    Fill in only the secrets that are currently empty and
                       leave non-empty ones alone. Safe to re-run; use this to
                       repair a partially configured .env.
    --yes              Do not prompt for confirmation (for automation).
    -h, --help         Show this help and exit.

ABOUT SETUP_TOKEN
    It is single-use. You enter it once at http://localhost:3000 to create the
    owner account. POST /api/v1/setup then closes PERMANENTLY - the route stops
    accepting any token at all, forever, for this installation. A leaked token
    after bootstrap is therefore inert.

    This script prints it to your terminal and writes it to .env so the API can
    compare against it. It is written NOWHERE else: not to a log, not to a
    separate token file, not to your shell history.

    Lost it before completing setup? Read it back with:
        grep '^SETUP_TOKEN=' .env
    Bootstrap already closed and you cannot log in? A new token will not help.
    See docs/RUNBOOK.md -> "Lost owner access".

WHAT --force COSTS YOU
    New SESSION_SECRET      every logged-in session is invalidated.
    New ENCRYPTION_KEY      provider API keys already stored in the database
                            can NO LONGER BE DECRYPTED. You must re-enter them
                            in Settings. Nothing else is lost.
    New WORKER_AUTH_TOKEN   restart the worker so it picks up the new value.
    New SETUP_TOKEN         inert if bootstrap already completed.
    Your database and files are NOT touched by this script.

EXIT STATUS
    0 success; non-zero on any failure.
HELPTEXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --force)         FORCE=1 ;;
    --keep-existing) KEEP_EXISTING=1 ;;
    --yes|-y)        JG_ASSUME_YES=1; export JG_ASSUME_YES ;;
    -h|--help)       usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

[ "$FORCE" = "1" ] && [ "$KEEP_EXISTING" = "1" ] && \
  die "--force and --keep-existing are contradictory: one regenerates every secret, the other preserves every existing one."

EXAMPLE_FILE="${JG_REPO_ROOT}/.env.example"
require_file "$EXAMPLE_FILE" "run this script from a checkout of the repository"

# --- Decide what to do with an existing .env ---------------------------------

if [ -f "$JG_ENV_FILE" ]; then
  if [ "$KEEP_EXISTING" = "1" ]; then
    info "Existing .env kept; filling in empty secrets only."
  elif [ "$FORCE" = "1" ]; then
    warn "--force: overwriting ${JG_ENV_FILE} and regenerating ALL secrets."
    warn "Provider API keys already stored in the database will become undecryptable."
    confirm "Overwrite .env and regenerate every secret?"
    # Timestamped backup rather than deletion: the old ENCRYPTION_KEY is the
    # only thing that can decrypt already-stored provider secrets, and a
    # mistaken --force should be recoverable.
    BACKUP="${JG_ENV_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    ( umask 077; cp "$JG_ENV_FILE" "$BACKUP" )
    warn "Previous .env saved to: ${BACKUP}"
    warn "It contains the OLD secrets. Keep it out of git and delete it once you are sure."
    ( umask 077; cp "$EXAMPLE_FILE" "$JG_ENV_FILE" )
  else
    die ".env already exists at ${JG_ENV_FILE}.
Refusing to overwrite it, because that would destroy the ENCRYPTION_KEY that
decrypts any provider secrets already stored in your database.

  --keep-existing   fill in only the secrets that are still empty (safe)
  --force           overwrite and regenerate everything (backs up the old file)"
  fi
else
  info "Creating ${JG_ENV_FILE} from .env.example"
  ( umask 077; cp "$EXAMPLE_FILE" "$JG_ENV_FILE" )
fi

chmod 600 "$JG_ENV_FILE" 2>/dev/null || \
  warn "could not chmod 600 .env (expected on some Windows filesystems). Make sure it is not shared."

# --- Generate -----------------------------------------------------------------

# $1=key  $2=generator-output. Skips a key that already has a value unless the
# run is a full regeneration.
set_secret() {
  _key=$1
  _new=$2
  _current=$(env_get "$_key" || printf '')
  if [ -n "$_current" ] && [ "$FORCE" != "1" ]; then
    info "${_key} already set, leaving it alone ($(redact "$_current"))"
    return 0
  fi
  env_set "$_key" "$_new"
  ok "${_key} generated"
}

info "Generating secrets with $(command -v openssl >/dev/null 2>&1 && echo 'openssl rand' || echo '/dev/urandom')"

# 32 raw bytes each. ENCRYPTION_KEY must be exactly 32 bytes decoded, because
# it keys an AEAD cipher - do not change that number.
set_secret SESSION_SECRET    "$(random_b64 32)"
set_secret ENCRYPTION_KEY    "$(random_b64 32)"
set_secret WORKER_AUTH_TOKEN "$(random_token 32)"

SETUP_TOKEN_VALUE=$(env_get SETUP_TOKEN || printf '')
SETUP_TOKEN_IS_NEW=0
if [ -z "$SETUP_TOKEN_VALUE" ] || [ "$FORCE" = "1" ]; then
  SETUP_TOKEN_VALUE=$(random_token 32)
  env_set SETUP_TOKEN "$SETUP_TOKEN_VALUE"
  SETUP_TOKEN_IS_NEW=1
  ok "SETUP_TOKEN generated"
fi

# --- Sanity checks ------------------------------------------------------------

for _required in SESSION_SECRET ENCRYPTION_KEY WORKER_AUTH_TOKEN SETUP_TOKEN; do
  _v=$(env_get "$_required" || printf '')
  [ -n "$_v" ] || die "${_required} is still empty after generation. Refusing to report success."
done

# Decoded length check: a truncated ENCRYPTION_KEY would fail later, deep
# inside the API, with a much worse error message than this one.
if command -v base64 >/dev/null 2>&1; then
  _enc=$(env_get ENCRYPTION_KEY)
  _len=$(printf '%s' "$_enc" | base64 -d 2>/dev/null | wc -c | tr -d ' ')
  if [ -n "$_len" ] && [ "$_len" != "32" ]; then
    die "ENCRYPTION_KEY decodes to ${_len} bytes, expected 32. Re-run with --force."
  fi
fi

# --- Report -------------------------------------------------------------------

log ""
ok "Wrote ${JG_ENV_FILE}"
log ""

if [ "$SETUP_TOKEN_IS_NEW" = "1" ]; then
  log "-----------------------------------------------------------------------"
  log " ONE-TIME SETUP TOKEN"
  log "-----------------------------------------------------------------------"
  log ""
  # The one and only place this value is printed.
  printf '   %s\n' "$SETUP_TOKEN_VALUE" >&2
  log ""
  log " Enter it at http://localhost:3000 to create the owner account."
  log ""
  log " * It is SINGLE-USE. After you complete setup, POST /api/v1/setup closes"
  log "   permanently for this installation and no token is accepted again."
  log " * It is stored only in .env. This script wrote it nowhere else, and it"
  log "   is not in your shell history."
  log " * Treat it like a password until you have used it."
  log "-----------------------------------------------------------------------"
else
  info "SETUP_TOKEN already present; not reprinting it."
  info "Read it with: grep '^SETUP_TOKEN=' .env"
fi

log ""
log "Next:"
log "  1. Review .env  (APP_ORIGIN, PROVIDER_DEFAULT, POSTGRES_PASSWORD)"
log "  2. docker compose up --build -d"
log "  3. Open http://localhost:3000"
log ""
log "Never commit .env. It is already excluded by .gitignore."
