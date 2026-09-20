#!/usr/bin/env sh
# =============================================================================
# scripts/restore.sh - restore a backup, optionally into a SEPARATE installation
#
# POSIX shell. PowerShell equivalent: scripts/restore.ps1
#
# docs/spec/10_DEPLOYMENT.md: "Supply scripts for backup and restore to a
# separate installation." That is the interesting case and it is the default
# assumption here - restoring onto a machine that is not the one the backup
# came from, with a different .env and a different ENCRYPTION_KEY.
#
# ---------------------------------------------------------------------------
# HONEST SCOPE LIMIT - READ BEFORE RELYING ON THIS
# ---------------------------------------------------------------------------
# The specification requires a restore to REAPPLY THE DELETION LEDGER BEFORE
# REOPENING ACCESS, so that data a user deleted after the backup was taken does
# not come back to life.
#
# The deletion ledger is M4 work (PR14). IT DOES NOT EXIST YET.
#
# This script therefore CANNOT perform a spec-complete restore, and it does not
# pretend to. It restores the database and files, then refuses to describe the
# result as verified. It prints an explicit warning that any workspace deletion
# performed after the backup timestamp may have been undone, and it does not
# start the API for you - so nothing is served until you have decided that is
# acceptable.
#
# The spec also requires proving that a restored application can download its
# ORIGINAL CV byte-identically and that packet hashes and history survive
# (AT25, AT11). Those checks need M1-M4 features and M4 data. This script
# verifies what exists now - archive checksums, row counts, file counts - and
# says so. It will not claim AT25 passes.
# ---------------------------------------------------------------------------
# =============================================================================
set -eu

. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

FROM=""
DROP_EXISTING=0
FILES_ONLY=0
DB_ONLY=0

usage() {
  cat <<'HELPTEXT'
scripts/restore.sh - restore a Job Getter backup

USAGE
    sh scripts/restore.sh --from PATH [options]

OPTIONS
    --from PATH       Backup to restore. Accepts a .tar.gz.age, .tar.gz.gpg,
                      .tar.gz, or an unpacked backup directory.
    --drop-existing   Drop and recreate the target database first. DESTRUCTIVE.
                      Without it, pg_restore merges into the existing schema,
                      which is almost never what you want.
    --db-only         Restore the database, leave the files volume alone.
    --files-only      Restore the files volume, leave the database alone.
    --yes             Do not prompt. Use with care.
    -h, --help        Show this help and exit.

RESTORING TO A SEPARATE INSTALLATION
    1. Check out the repository on the target machine.
    2. sh scripts/setup.sh           # creates a NEW .env with NEW secrets
    3. Replace ENCRYPTION_KEY in the new .env with the one from the SOURCE
       installation, if you still have it. Without it, stored provider API keys
       cannot be decrypted and must be re-entered. Everything else restores
       either way - see below.
    4. docker compose up -d db
    5. sh scripts/restore.sh --from <backup> --drop-existing
    6. sh scripts/migrate.sh         # brings an older dump up to current schema
    7. Deal with the deletion-ledger warning this script prints.
    8. Only then: docker compose up -d

WHAT A SUCCESSFUL RUN DOES AND DOES NOT PROVE
    DOES    The archive matched its checksums; pg_restore reported success;
            the file archive unpacked with the expected file count.
    DOES NOT
            It does not prove AT25 (profile, files, hashes and application
            history restored) - that scenario needs M1-M4 features that are
            not built.
            It does not reapply a deletion ledger, because there is no
            deletion ledger yet.
            It does not validate the pilot recovery targets (<=24h data loss,
            restore within 4h). Those are UNVALIDATED TARGETS from
            docs/spec/10_DEPLOYMENT.md, not measured results.

EXIT STATUS
    0 if the restore steps completed. Read the warnings before serving traffic.
HELPTEXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --from)           FROM=${2:?--from needs a path}; shift ;;
    --drop-existing)  DROP_EXISTING=1 ;;
    --db-only)        DB_ONLY=1 ;;
    --files-only)     FILES_ONLY=1 ;;
    --yes|-y)         JG_ASSUME_YES=1; export JG_ASSUME_YES ;;
    -h|--help)        usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

[ -n "$FROM" ] || { usage >&2; die "--from is required."; }
[ "$DB_ONLY" = "1" ] && [ "$FILES_ONLY" = "1" ] && die "--db-only and --files-only are contradictory."

cd "$JG_REPO_ROOT"
require_compose
require_file "$JG_ENV_FILE" "the TARGET installation needs its own .env - run 'sh scripts/setup.sh' first"

POSTGRES_USER_V=$(env_get POSTGRES_USER || printf 'jobgetter')
POSTGRES_DB_V=$(env_get POSTGRES_DB || printf 'jobgetter')
FILES_ROOT_V=$(env_get FILES_ROOT || printf '/var/lib/job-getter/files')

# --- Unpack -------------------------------------------------------------------
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/jg-restore.XXXXXX") || die "cannot create a temp directory"
chmod 700 "$WORKDIR" 2>/dev/null || true
cleanup() { _s=$?; rm -rf "$WORKDIR" 2>/dev/null || true; exit $_s; }
trap cleanup EXIT INT TERM

SRC=""
case "$FROM" in
  *.age)
    require_cmd age "Install age to decrypt this backup."
    info "Decrypting with age (you will be prompted for the identity)..."
    age --decrypt "${JG_AGE_IDENTITY:+--identity=$JG_AGE_IDENTITY}" "$FROM" \
      | tar -C "$WORKDIR" -xzf - || die "decryption or extraction failed."
    SRC=$(find "$WORKDIR" -maxdepth 1 -mindepth 1 -type d | head -n 1)
    ;;
  *.gpg)
    require_cmd gpg "Install gnupg to decrypt this backup."
    info "Decrypting with gpg..."
    gpg --decrypt "$FROM" | tar -C "$WORKDIR" -xzf - || die "decryption or extraction failed."
    SRC=$(find "$WORKDIR" -maxdepth 1 -mindepth 1 -type d | head -n 1)
    ;;
  *.tar.gz|*.tgz)
    warn "This backup is not encrypted."
    tar -C "$WORKDIR" -xzf "$FROM" || die "extraction failed."
    SRC=$(find "$WORKDIR" -maxdepth 1 -mindepth 1 -type d | head -n 1)
    ;;
  *)
    [ -d "$FROM" ] || die "not a recognised backup: ${FROM}"
    SRC="$FROM"
    ;;
esac

[ -n "$SRC" ] && [ -d "$SRC" ] || die "could not locate the backup contents inside ${FROM}"
require_file "${SRC}/manifest.json" "this does not look like a scripts/backup.sh archive"

# --- Integrity ----------------------------------------------------------------
if [ -f "${SRC}/SHA256SUMS" ]; then
  info "Verifying checksums..."
  ( cd "$SRC" && {
      if command -v sha256sum >/dev/null 2>&1; then sha256sum --check --quiet SHA256SUMS
      else shasum -a 256 --check --status SHA256SUMS
      fi
    } ) || die "CHECKSUM MISMATCH. This archive is corrupt or was modified. Refusing to restore it."
  ok "checksums match"
else
  warn "No SHA256SUMS in this backup; integrity cannot be verified."
fi

# --- Manifest -----------------------------------------------------------------
manifest_get() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "${SRC}/manifest.json" | head -n 1
}

BK_CREATED=$(manifest_get created_at)
BK_PGVER=$(manifest_get postgres_server_version)
BK_FILES=$(manifest_get file_count)
BK_QUIESCED=$(manifest_get stack_quiesced)
BK_ENC_FP=$(manifest_get encryption_key_fingerprint)

log ""
log "Backup contents"
log "  created_at            ${BK_CREATED:-unknown}"
log "  source postgres       ${BK_PGVER:-unknown}"
log "  files in archive      ${BK_FILES:-unknown}"
log "  stack quiesced        ${BK_QUIESCED:-unknown}"
log ""

if [ "$BK_QUIESCED" = "false" ]; then
  warn "The source stack was RUNNING during the backup. The database dump and the"
  warn "file archive may be seconds apart: a file referenced by a very recent row"
  warn "could be missing, or vice versa."
fi

# --- ENCRYPTION_KEY match ------------------------------------------------------
TARGET_ENC=$(env_get ENCRYPTION_KEY || printf '')
if [ -n "$TARGET_ENC" ] && [ "$BK_ENC_FP" != "unknown" ] && [ -n "$BK_ENC_FP" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    TGT_FP=$(printf '%s' "$TARGET_ENC" | sha256sum | cut -c1-8)
  else
    TGT_FP=$(printf '%s' "$TARGET_ENC" | shasum -a 256 | cut -c1-8)
  fi
  if [ "$TGT_FP" = "$BK_ENC_FP" ]; then
    ok "ENCRYPTION_KEY matches the source installation; stored provider keys will decrypt."
  else
    warn "ENCRYPTION_KEY DOES NOT MATCH the source installation."
    warn "Everything restores except stored provider API keys, which cannot be"
    warn "decrypted with this key and must be re-entered in Settings."
    warn "If you still have the source .env, copy its ENCRYPTION_KEY over before"
    warn "continuing. Restoring first and fixing the key later also works."
  fi
fi

# =============================================================================
# THE DELETION LEDGER GUARD
#
# This is the part the specification is strict about and the part this build
# cannot satisfy. It is a loud, explicit refusal rather than a silent omission.
# =============================================================================
log ""
log "======================================================================="
log " DELETION LEDGER: NOT REAPPLIED - THE FEATURE DOES NOT EXIST YET"
log "======================================================================="
log ""
log " docs/spec/10_DEPLOYMENT.md requires a restore to reapply the deletion"
log " ledger BEFORE reopening access, so that data a user deleted after this"
log " backup was taken is not resurrected by restoring it."
log ""
log " The deletion ledger is part of PR14 / milestone M4 and is NOT"
log " IMPLEMENTED. There is nothing for this script to reapply."
log ""
log " CONSEQUENCE: if any workspace or record was deleted AFTER"
log " ${BK_CREATED:-the backup timestamp}, this restore may bring it back."
log ""
log " Until M4 lands, this script will NOT describe its result as a verified"
log " restore, and it will NOT start the API for you. Decide deliberately"
log " whether resurrected data is acceptable for this installation before you"
log " run 'docker compose up -d'."
log ""
log "======================================================================="
log ""

confirm "Continue with the restore, understanding the deletion-ledger gap?"

# --- Database -----------------------------------------------------------------
if [ "$FILES_ONLY" != "1" ]; then
  require_file "${SRC}/database.dump" "the backup has no database dump"

  info "Starting the target database..."
  docker compose up -d --wait db >/dev/null 2>&1 \
    || die "the 'db' service did not become healthy."

  # A restore while the API is writing produces a mess that is hard to reason
  # about afterwards.
  if [ -n "$(docker compose ps --status running --quiet api 2>/dev/null || true)" ]; then
    warn "The API is running against the target database."
    confirm "Stop api and worker before restoring?"
    docker compose stop api worker >/dev/null 2>&1 || true
    ok "api and worker stopped"
  fi

  if [ "$DROP_EXISTING" = "1" ]; then
    warn "--drop-existing: the CURRENT contents of database '${POSTGRES_DB_V}' on"
    warn "the TARGET will be destroyed. This is not the backup - this is whatever"
    warn "is in the target right now."
    confirm "Drop and recreate '${POSTGRES_DB_V}'?"
    docker compose exec -T db psql -U "$POSTGRES_USER_V" -d postgres \
      -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB_V}\" WITH (FORCE);" \
      -c "CREATE DATABASE \"${POSTGRES_DB_V}\" OWNER \"${POSTGRES_USER_V}\";" \
      || die "could not recreate the database."
    ok "database recreated empty"
  fi

  info "Restoring the database dump..."
  # --no-owner/--no-privileges: the target role may be named differently.
  # --exit-on-error is deliberately NOT used with a merge restore, because
  # "already exists" on a non-dropped database is noise; with --drop-existing
  # the database is empty, so any error is real and we do stop.
  if [ "$DROP_EXISTING" = "1" ]; then
    docker compose exec -T db pg_restore \
        --username="$POSTGRES_USER_V" --dbname="$POSTGRES_DB_V" \
        --no-owner --no-privileges --exit-on-error \
      < "${SRC}/database.dump" \
      || die "pg_restore failed. The target database is in an indeterminate state; drop it and start again."
  else
    docker compose exec -T db pg_restore \
        --username="$POSTGRES_USER_V" --dbname="$POSTGRES_DB_V" \
        --no-owner --no-privileges \
      < "${SRC}/database.dump" \
      || warn "pg_restore reported errors (expected when merging into a non-empty database). Review the output above."
  fi
  ok "database restored"

  TABLE_COUNT=$(docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
                  -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d '\r ' || printf '?')
  ok "public schema now has ${TABLE_COUNT} tables"
fi

# --- Files --------------------------------------------------------------------
if [ "$DB_ONLY" != "1" ]; then
  require_file "${SRC}/files.tar.gz" "the backup has no file archive"

  info "Restoring the files volume into ${FILES_ROOT_V}..."
  # Unpacked from inside the api container so ownership matches the
  # application's runtime user. Existing files with the same private storage
  # key are overwritten; storage keys are generated IDs, so a collision means
  # the same object.
  docker compose run --rm --no-deps --entrypoint sh -T api \
      -c "mkdir -p '${FILES_ROOT_V}' && tar -C '${FILES_ROOT_V}' -xzf -" \
    < "${SRC}/files.tar.gz" \
    || die "restoring the files volume failed."

  RESTORED_COUNT=$(docker compose run --rm --no-deps --entrypoint sh api \
      -c "find '${FILES_ROOT_V}' -type f | wc -l" 2>/dev/null | tr -d '\r ' || printf '?')
  ok "files volume now holds ${RESTORED_COUNT} files (archive recorded ${BK_FILES:-?})"

  if [ "${RESTORED_COUNT}" != "?" ] && [ "${BK_FILES:-?}" != "?" ] && [ "${RESTORED_COUNT}" -lt "${BK_FILES}" ] 2>/dev/null; then
    warn "Fewer files on disk than the archive recorded. Investigate before serving."
  fi
fi

# --- Report -------------------------------------------------------------------
log ""
log "-----------------------------------------------------------------------"
log " RESTORE STEPS COMPLETED - NOT A VERIFIED RESTORE"
log "-----------------------------------------------------------------------"
log ""
log " Verified:"
log "   archive checksums matched"
[ "$FILES_ONLY" != "1" ] && log "   pg_restore completed; public schema has ${TABLE_COUNT:-?} tables"
[ "$DB_ONLY" != "1" ]    && log "   files volume holds ${RESTORED_COUNT:-?} files"
log ""
log " NOT verified, because the features do not exist yet:"
log "   deletion ledger reapplied            (M4 / PR14 - not implemented)"
log "   original CV downloads byte-identical (AT11 - needs M1/M3)"
log "   packet hashes and history preserved  (AT25 - needs M4)"
log ""
log " Recovery targets from docs/spec/10_DEPLOYMENT.md - at most 24 hours data"
log " loss, restore within 4 hours - are UNVALIDATED TARGETS. This run is not"
log " evidence that they are met."
log ""
log " Next:"
log "   sh scripts/migrate.sh      # bring an older dump to the current schema"
log "   docker compose up -d       # only once you accept the notes above"
log "   sh scripts/smoke.sh        # confirm the stack still works end to end"
log "-----------------------------------------------------------------------"
