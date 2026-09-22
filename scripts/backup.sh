#!/usr/bin/env sh
# =============================================================================
# scripts/backup.sh - back up the database and the files volume
#
# POSIX shell. PowerShell equivalent: scripts/backup.ps1
#
# Produces a single directory under backups/ containing:
#   database.dump      pg_dump custom format (-Fc), restorable with pg_restore
#   files.tar.gz       the FILES_ROOT volume
#   manifest.json      what was captured, when, from which versions
#   SHA256SUMS         checksums of the three files above
# and, unless you pass --no-encrypt, encrypts the whole thing to
#   <name>.tar.gz.age   or   <name>.tar.gz.gpg
#
# docs/spec/10_DEPLOYMENT.md requires backups to be ENCRYPTED. This script will
# not silently produce a plaintext backup: you either give it a recipient/
# passphrase, or you pass --no-encrypt and acknowledge what you are doing.
#
# CONSISTENCY - read this before trusting a backup
# -----------------------------------------------
# The database dump and the file archive are taken at slightly different
# moments. For a single-owner local installation that is almost always fine.
# To make it exact, stop the API and worker first so nothing is writing:
#       docker compose stop api worker
#       sh scripts/backup.sh
#       docker compose start api worker
# The manifest records whether the stack was quiesced, so a restore can tell
# you what it is working with instead of guessing.
# =============================================================================
set -eu

. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

OUT_DIR="${JG_BACKUP_DIR:-${JG_REPO_ROOT}/backups}"
LABEL=""
ENCRYPT=auto
AGE_RECIPIENT="${JG_AGE_RECIPIENT:-}"
GPG_RECIPIENT="${JG_GPG_RECIPIENT:-}"
NO_ENCRYPT_ACK=0

usage() {
  cat <<'HELPTEXT'
scripts/backup.sh - back up the Job Getter database and files

USAGE
    sh scripts/backup.sh [options]

OPTIONS
    --out DIR             Where to write the backup. Default ./backups
    --label NAME          Extra label in the backup name (e.g. pre-migration).
    --age-recipient KEY   Encrypt with `age` to this public key (recommended).
                          Or set JG_AGE_RECIPIENT.
    --gpg-recipient ID    Encrypt with `gpg` to this recipient. Or set
                          JG_GPG_RECIPIENT.
    --no-encrypt          Produce a PLAINTEXT backup. You are then responsible
                          for storing it somewhere encrypted. The backup will
                          contain every CV, every job record and the whole
                          application history in the clear.
    --yes                 Do not prompt.
    -h, --help            Show this help and exit.

WHAT IS AND IS NOT IN THE BACKUP
    IN      PostgreSQL database (profile, jobs, applications, tasks, events)
            FILES_ROOT volume (uploaded CVs, generated documents, exports)
    NOT IN  .env - and therefore not SESSION_SECRET, ENCRYPTION_KEY,
            WORKER_AUTH_TOKEN or SETUP_TOKEN.

            This is deliberate. docs/spec/09_SECURITY_PRIVACY.md requires the
            operator encryption key to live OUTSIDE the database, so that a
            stolen database backup cannot decrypt stored provider API keys.
            Bundling .env into the backup would undo exactly that.

            CONSEQUENCE: keep ENCRYPTION_KEY somewhere safe and separate. A
            restore without it recovers everything except stored provider API
            keys, which must be re-entered. The manifest records the first 8
            characters of a hash of ENCRYPTION_KEY so a restore can TELL you
            whether your key matches - without storing the key itself.

RECOVERY TARGETS (UNVALIDATED)
    docs/spec/10_DEPLOYMENT.md states pilot targets of at most 24 hours data
    loss and restore within 4 hours, and explicitly says to validate them
    before claiming them. They have NOT been validated for this installation.
    They are targets, not measured results, and nothing here should be read as
    evidence that they are met.

EXIT STATUS
    0 only if every step completed and the checksums were written.
HELPTEXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out)            OUT_DIR=${2:?--out needs a value}; shift ;;
    --label)          LABEL=${2:?--label needs a value}; shift ;;
    --age-recipient)  AGE_RECIPIENT=${2:?--age-recipient needs a value}; ENCRYPT=age; shift ;;
    --gpg-recipient)  GPG_RECIPIENT=${2:?--gpg-recipient needs a value}; ENCRYPT=gpg; shift ;;
    --no-encrypt)     ENCRYPT=none; NO_ENCRYPT_ACK=1 ;;
    --yes|-y)         JG_ASSUME_YES=1; export JG_ASSUME_YES ;;
    -h|--help)        usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

cd "$JG_REPO_ROOT"
require_compose
require_file "$JG_ENV_FILE" "run 'sh scripts/setup.sh' first"

# --- Decide on encryption BEFORE doing any work -------------------------------
if [ "$ENCRYPT" = "auto" ]; then
  if [ -n "$AGE_RECIPIENT" ] && command -v age >/dev/null 2>&1; then
    ENCRYPT=age
  elif [ -n "$GPG_RECIPIENT" ] && command -v gpg >/dev/null 2>&1; then
    ENCRYPT=gpg
  else
    die "No encryption configured, and docs/spec/10_DEPLOYMENT.md requires backups to be encrypted.

Pick one:
  --age-recipient age1...    (install: https://github.com/FiloSottile/age)
  --gpg-recipient you@...
  --no-encrypt               produce a PLAINTEXT backup and take responsibility
                             for storing it encrypted yourself"
  fi
fi

if [ "$ENCRYPT" = "age" ]; then
  require_cmd age "Install age, or use --gpg-recipient, or --no-encrypt."
  [ -n "$AGE_RECIPIENT" ] || die "--age-recipient requires a public key."
elif [ "$ENCRYPT" = "gpg" ]; then
  require_cmd gpg "Install gnupg, or use --age-recipient, or --no-encrypt."
  [ -n "$GPG_RECIPIENT" ] || die "--gpg-recipient requires a recipient id."
elif [ "$ENCRYPT" = "none" ] && [ "$NO_ENCRYPT_ACK" = "1" ]; then
  warn "PLAINTEXT BACKUP: it will contain CVs, contact details and the full"
  warn "application history with no encryption at rest."
  confirm "Write an unencrypted backup?"
fi

# --- Gather context -----------------------------------------------------------
POSTGRES_USER_V=$(env_get POSTGRES_USER || printf 'jobgetter')
POSTGRES_DB_V=$(env_get POSTGRES_DB || printf 'jobgetter')
FILES_ROOT_V=$(env_get FILES_ROOT || printf '/var/lib/job-getter/files')

TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="job-getter-${TS}${LABEL:+-${LABEL}}"
STAGE="${OUT_DIR}/${NAME}"

mkdir -p "$OUT_DIR"
( umask 077; mkdir -p "$STAGE" )

# Anything that fails after this point leaves no half-finished backup lying
# around to be mistaken for a good one.
_backup_failed() {
  _st=$?
  if [ "$_st" != "0" ]; then
    warn "backup failed; removing the incomplete directory ${STAGE}"
    rm -rf "$STAGE" 2>/dev/null || true
  fi
  exit $_st
}
trap _backup_failed EXIT INT TERM

info "Backup: ${STAGE}"

# Is the stack quiesced? Recorded in the manifest so a restore knows whether
# the two halves are guaranteed consistent with each other.
API_RUNNING=$(docker compose ps --status running --quiet api 2>/dev/null || true)
WORKER_RUNNING=$(docker compose ps --status running --quiet worker 2>/dev/null || true)
if [ -n "$API_RUNNING" ] || [ -n "$WORKER_RUNNING" ]; then
  QUIESCED=false
  warn "api/worker are running: the dump and the file archive are taken moments apart."
  warn "For a strictly consistent backup: docker compose stop api worker"
else
  QUIESCED=true
fi

# --- Database -----------------------------------------------------------------
info "Dumping the database..."
docker compose up -d --wait db >/dev/null 2>&1 \
  || die "the 'db' service is not healthy; cannot dump. Check: docker compose logs db"

# -Fc  custom format: compressed, and pg_restore can filter/reorder it.
# --no-owner / --no-privileges: the restore target may use a different role
#   name, and refusing to restore over a role mismatch helps nobody.
# --serializable-deferrable: a genuinely consistent snapshot, not a
#   read-committed smear across the dump's duration.
docker compose exec -T db pg_dump \
    --username="$POSTGRES_USER_V" \
    --dbname="$POSTGRES_DB_V" \
    --format=custom \
    --no-owner --no-privileges \
    --serializable-deferrable \
  > "${STAGE}/database.dump" \
  || die "pg_dump failed. Nothing was written."

[ -s "${STAGE}/database.dump" ] || die "pg_dump produced an empty file. Refusing to call this a backup."
ok "database.dump ($(wc -c < "${STAGE}/database.dump" | tr -d ' ') bytes)"

PG_SERVER_VERSION=$(docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
                      -tAc 'SHOW server_version' 2>/dev/null | tr -d '\r' || printf 'unknown')

# The ledger is an ordinary table (migration 0007), so the dump carries it
# whenever the schema has it. Recorded rather than assumed: a dump of a
# pre-0007 database has none.
LEDGER_IN_DUMP=$(docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
                   -tAc "SELECT to_regclass('public.deletion_ledger') IS NOT NULL" 2>/dev/null | tr -d '\r ' || printf 'f')
if [ "$LEDGER_IN_DUMP" = "t" ]; then LEDGER_IN_DUMP=true; else LEDGER_IN_DUMP=false; fi

# --- Files --------------------------------------------------------------------
info "Archiving the files volume (${FILES_ROOT_V})..."

# Runs inside the api container so the volume is read exactly as the
# application sees it, including permissions. --no-deps so this does not start
# the whole stack just to read a directory.
docker compose run --rm --no-deps --entrypoint sh api \
    -c "tar -C '${FILES_ROOT_V}' -czf - . 2>/dev/null || tar -C '${FILES_ROOT_V}' -czf - ." \
  > "${STAGE}/files.tar.gz" \
  || die "archiving ${FILES_ROOT_V} failed."

FILE_COUNT=$(tar -tzf "${STAGE}/files.tar.gz" 2>/dev/null | grep -cv '/$' || printf '0')
ok "files.tar.gz (${FILE_COUNT} files, $(wc -c < "${STAGE}/files.tar.gz" | tr -d ' ') bytes)"

# --- Manifest -----------------------------------------------------------------
# A fingerprint of ENCRYPTION_KEY, NOT the key. Lets restore.sh tell you
# "your ENCRYPTION_KEY does not match this backup; stored provider keys will
# not decrypt" instead of leaving you to discover it later.
ENC_KEY=$(env_get ENCRYPTION_KEY || printf '')
if [ -n "$ENC_KEY" ] && command -v sha256sum >/dev/null 2>&1; then
  ENC_FP=$(printf '%s' "$ENC_KEY" | sha256sum | cut -c1-8)
elif [ -n "$ENC_KEY" ] && command -v shasum >/dev/null 2>&1; then
  ENC_FP=$(printf '%s' "$ENC_KEY" | shasum -a 256 | cut -c1-8)
else
  ENC_FP="unknown"
fi

cat > "${STAGE}/manifest.json" <<MANIFEST
{
  "format_version": 1,
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source_app_mode": "$(env_get APP_MODE || printf 'local')",
  "postgres_server_version": "${PG_SERVER_VERSION}",
  "database": "${POSTGRES_DB_V}",
  "files_root": "${FILES_ROOT_V}",
  "file_count": ${FILE_COUNT},
  "stack_quiesced": ${QUIESCED},
  "encryption_key_fingerprint": "${ENC_FP}",
  "contains_env_file": false,
  "deletion_ledger_included": ${LEDGER_IN_DUMP},
  "notes": [
    "The .env file and therefore ENCRYPTION_KEY are NOT in this backup, by design.",
    "encryption_key_fingerprint is sha256(ENCRYPTION_KEY) truncated to 8 hex chars; it is a match indicator, not the key.",
    "stack_quiesced=false means api/worker were running during the dump; database and files may be seconds apart.",
    "deletion_ledger_included says whether the dump carries the deletion ledger; scripts/restore.sh merges it with the target's and reapplies it."
  ]
}
MANIFEST
ok "manifest.json"

# --- Checksums ----------------------------------------------------------------
( cd "$STAGE" && {
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum database.dump files.tar.gz manifest.json > SHA256SUMS
    else
      shasum -a 256 database.dump files.tar.gz manifest.json > SHA256SUMS
    fi
  } )
ok "SHA256SUMS"

# --- Encrypt ------------------------------------------------------------------
case "$ENCRYPT" in
  age)
    info "Encrypting with age -> ${NAME}.tar.gz.age"
    tar -C "$OUT_DIR" -czf - "$NAME" | age --recipient "$AGE_RECIPIENT" --output "${OUT_DIR}/${NAME}.tar.gz.age" \
      || die "age encryption failed; the plaintext staging directory is still at ${STAGE}. Encrypt or delete it."
    rm -rf "$STAGE"
    chmod 600 "${OUT_DIR}/${NAME}.tar.gz.age" 2>/dev/null || true
    ARTIFACT="${OUT_DIR}/${NAME}.tar.gz.age"
    ;;
  gpg)
    info "Encrypting with gpg -> ${NAME}.tar.gz.gpg"
    tar -C "$OUT_DIR" -czf - "$NAME" | gpg --encrypt --recipient "$GPG_RECIPIENT" --output "${OUT_DIR}/${NAME}.tar.gz.gpg" \
      || die "gpg encryption failed; the plaintext staging directory is still at ${STAGE}. Encrypt or delete it."
    rm -rf "$STAGE"
    chmod 600 "${OUT_DIR}/${NAME}.tar.gz.gpg" 2>/dev/null || true
    ARTIFACT="${OUT_DIR}/${NAME}.tar.gz.gpg"
    ;;
  none)
    tar -C "$OUT_DIR" -czf "${OUT_DIR}/${NAME}.tar.gz" "$NAME"
    rm -rf "$STAGE"
    chmod 600 "${OUT_DIR}/${NAME}.tar.gz" 2>/dev/null || true
    ARTIFACT="${OUT_DIR}/${NAME}.tar.gz"
    ;;
esac

trap - EXIT INT TERM

log ""
ok "Backup written: ${ARTIFACT}"
log ""
log "  Restore it with:  sh scripts/restore.sh --from '${ARTIFACT}'"
log ""
if [ "$ENCRYPT" = "none" ]; then
  warn "This backup is NOT encrypted. Store it somewhere encrypted at rest."
fi
if [ "$QUIESCED" = "false" ]; then
  warn "Taken with api/worker running: database and files are not guaranteed to"
  warn "be from the same instant. Recorded in manifest.json."
fi
log "A backup you have never restored is a hypothesis, not a backup."
log "docs/RUNBOOK.md -> 'Backup and restore' has a rehearsal procedure."
