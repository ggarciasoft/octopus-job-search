#!/usr/bin/env sh
# =============================================================================
# Shared helpers for the POSIX scripts in this directory.
#
# Sourced, not executed:  . "$(dirname "$0")/lib.sh"
#
# Written for POSIX sh (dash, ash, bash, Git Bash) - no arrays, no [[ ]], no
# `local -n`. `local` itself is not POSIX but is supported by every shell we
# target; it is used deliberately to avoid leaking variables between helpers.
# =============================================================================

# `set -e` alone is not enough: an unset variable or a failing pipeline stage
# must also stop the script rather than continue with an empty value.
set -eu
# shellcheck disable=SC3040
(set -o pipefail 2>/dev/null) && set -o pipefail

# Repository root, independent of the caller's working directory.
JG_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
JG_REPO_ROOT="$(CDPATH='' cd -- "${JG_SCRIPT_DIR}/.." && pwd)"
export JG_SCRIPT_DIR JG_REPO_ROOT

# --- Output ------------------------------------------------------------------
# Colour only when stderr is a terminal, so log files and CI stay readable.
if [ -t 2 ] && [ "${NO_COLOR:-}" = "" ]; then
  JG_C_RED=$(printf '\033[31m'); JG_C_YEL=$(printf '\033[33m')
  JG_C_GRN=$(printf '\033[32m'); JG_C_DIM=$(printf '\033[2m')
  JG_C_OFF=$(printf '\033[0m')
else
  JG_C_RED=''; JG_C_YEL=''; JG_C_GRN=''; JG_C_DIM=''; JG_C_OFF=''
fi

log()  { printf '%s\n' "$*" >&2; }
info() { printf '%s==>%s %s\n' "$JG_C_DIM" "$JG_C_OFF" "$*" >&2; }
ok()   { printf '%s OK %s %s\n' "$JG_C_GRN" "$JG_C_OFF" "$*" >&2; }
warn() { printf '%swarn%s %s\n' "$JG_C_YEL" "$JG_C_OFF" "$*" >&2; }

# Always exits non-zero. Every failure path in these scripts ends here, so a
# caller (CI, a Makefile, another script) can rely on the exit status.
die() {
  printf '%serror%s %s\n' "$JG_C_RED" "$JG_C_OFF" "$*" >&2
  exit 1
}

# --- Preconditions -----------------------------------------------------------

require_cmd() {
  _cmd=$1
  _hint=${2:-}
  command -v "$_cmd" >/dev/null 2>&1 || {
    if [ -n "$_hint" ]; then
      die "required command '$_cmd' not found. $_hint"
    fi
    die "required command '$_cmd' not found on PATH."
  }
}

require_file() {
  [ -f "$1" ] || die "expected file not found: $1${2:+ ($2)}"
}

# `docker compose` (v2 plugin) only. The legacy `docker-compose` v1 Python
# script does not support the `service_completed_successfully` dependency
# condition that docker-compose.yml relies on for migration ordering, so
# falling back to it would silently break start-up ordering.
require_compose() {
  require_cmd docker "Install Docker Desktop or the Docker Engine."
  docker compose version >/dev/null 2>&1 || die \
    "'docker compose' (v2) is not available. The legacy 'docker-compose' v1 command is not supported: it cannot express the migrate-before-api ordering this stack needs."
}

# --- .env handling -----------------------------------------------------------

JG_ENV_FILE="${JG_ENV_FILE:-${JG_REPO_ROOT}/.env}"

# Read one key from an env file WITHOUT sourcing it. Sourcing would execute
# whatever is in the file and would also dump every secret into this process's
# environment, where a child process or a crash dump could pick it up.
env_get() {
  _key=$1
  _file=${2:-$JG_ENV_FILE}
  [ -f "$_file" ] || return 1
  # Last assignment wins, matching dotenv loaders. Strips optional surrounding
  # quotes; does not attempt shell expansion.
  sed -n "s/^[[:space:]]*${_key}=//p" "$_file" \
    | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Replace `KEY=...` in place, or append it if absent. Uses a temp file with
# restrictive permissions and an atomic rename so a crash mid-write cannot
# leave a half-written .env, and so the secret is never world-readable even
# transiently.
env_set() {
  _key=$1
  _value=$2
  _file=${3:-$JG_ENV_FILE}
  require_file "$_file"

  _tmp="${_file}.tmp.$$"
  ( umask 077; : > "$_tmp" ) || die "cannot write next to $_file"

  if grep -q "^[[:space:]]*${_key}=" "$_file"; then
    # awk, not sed: the value may contain /, &, \ and other characters that sed
    # would interpret in the replacement text.
    awk -v key="$_key" -v val="$_value" '
      $0 ~ "^[[:space:]]*" key "=" { print key "=" val; next }
      { print }
    ' "$_file" > "$_tmp"
  else
    cat "$_file" > "$_tmp"
    printf '%s=%s\n' "$_key" "$_value" >> "$_tmp"
  fi

  chmod 600 "$_tmp" 2>/dev/null || true
  mv "$_tmp" "$_file"
}

# --- Secret generation -------------------------------------------------------

# Cryptographically secure random bytes, base64 encoded.
#   $1 = number of RAW BYTES (not output characters).
#
# Order of preference: OpenSSL, then /dev/urandom, then Python. All three are
# CSPRNGs. $RANDOM, date, $$ and similar are NOT used anywhere: they are
# trivially predictable and would make SESSION_SECRET and ENCRYPTION_KEY
# guessable.
random_b64() {
  _bytes=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$_bytes" | tr -d '\n'
    return 0
  fi
  if [ -r /dev/urandom ] && command -v base64 >/dev/null 2>&1; then
    dd if=/dev/urandom bs="$_bytes" count=1 2>/dev/null | base64 | tr -d '\n'
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import base64,os,sys; sys.stdout.write(base64.b64encode(os.urandom($_bytes)).decode())"
    return 0
  fi
  die "no source of cryptographic randomness found (tried openssl, /dev/urandom, python3). Refusing to generate a weak secret."
}

# URL-safe token with no padding: it travels in an HTTP body and gets copied
# and pasted by a human, so +, / and = are avoidable friction.
random_token() {
  random_b64 "${1:-32}" | tr '+/' '-_' | tr -d '='
}

# --- HTTP --------------------------------------------------------------------

require_curl() {
  require_cmd curl "Install curl, or run the PowerShell equivalent of this script on Windows."
}

# Exits 0 when the URL answers 2xx within the timeout.
http_ok() {
  curl --silent --show-error --fail --max-time "${2:-5}" --output /dev/null "$1" 2>/dev/null
}

# --- Misc --------------------------------------------------------------------

# Redact a secret for display. Never print a full secret to stdout/stderr
# except where a script explicitly documents doing so once (setup's SETUP_TOKEN).
redact() {
  _v=$1
  if [ -z "$_v" ]; then printf '(empty)'; else printf '%.4s********' "$_v"; fi
}

confirm() {
  _prompt=$1
  if [ "${JG_ASSUME_YES:-0}" = "1" ]; then
    return 0
  fi
  [ -t 0 ] || die "$_prompt -- refusing in a non-interactive shell. Re-run with --yes if you are sure."
  printf '%s [y/N] ' "$_prompt" >&2
  read -r _answer
  case "$_answer" in
    y|Y|yes|YES) return 0 ;;
    *) die "aborted by user." ;;
  esac
}
