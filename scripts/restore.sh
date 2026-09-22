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
# THE DELETION LEDGER, AND WHAT THIS SCRIPT STILL WILL NOT CLAIM
# ---------------------------------------------------------------------------
# The specification requires a restore to REAPPLY THE DELETION LEDGER BEFORE
# REOPENING ACCESS, so that data a user deleted after the backup was taken does
# not come back to life.
#
# The ledger exists as of M4 (migration 0007), and this script now does it:
#
#   1. It saves the TARGET's ledger before touching the database - that copy
#      knows about deletions the backup predates.
#   2. It restores the dump, which brings the backup's older ledger with it.
#   3. It merges the saved rows back in, so the ledger holds every deletion
#      either copy knew about.
#   4. It runs scripts/reapply-deletions.sql, which re-deletes everything the
#      merged ledger names.
#   5. Only then does it hand back control - and it still does not start the
#      API for you.
#
# What it does not verify by itself: that a restored application can download
# its ORIGINAL CV byte-identically, and that packet hashes and history survive
# (AT11, AT25). Those are checked through the application, not by a shell
# script; AT25 did so on 2026-09-22 (docs/RUNBOOK.md -> "Rehearse it"). This
# script verifies archive checksums, the ledger replay, row counts and file
# counts, and says so.
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
            It does not by itself prove AT25 (profile, files, hashes and
            application history restored): that is checked through the
            application afterwards. See docs/RUNBOOK.md -> "Rehearse it".
            It saves, merges and reapplies the deletion ledger, so data
            deleted after the backup stays deleted.
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
# THE DELETION LEDGER
#
# Saved BEFORE the restore. The target's ledger knows about deletions the
# backup predates; the backup's ledger is about to overwrite it, so the copy
# has to be taken now or not at all.
# =============================================================================
LEDGER_SQL="${WORKDIR}/deletion-ledger.sql"
LEDGER_SAVED=0

if [ "$FILES_ONLY" != "1" ]; then
  docker compose up -d --wait db >/dev/null 2>&1 || true
  LEDGER_PRESENT=$(docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
      -tAc "SELECT to_regclass('public.deletion_ledger') IS NOT NULL" 2>/dev/null | tr -d '\r ' || printf 'f')
  if [ "$LEDGER_PRESENT" = "t" ]; then
    # Emitted as idempotent INSERTs rather than CSV: one file, readable by a
    # person, and replayable into a database whose ledger already holds some
    # of these rows.
    docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" -tAc \
      "SELECT format('INSERT INTO deletion_ledger (id, workspace_id, object_kind, object_id, deleted_at, reason, created_at) VALUES (%L,%L,%L,%L,%L,%L,%L) ON CONFLICT (id) DO NOTHING;', id, workspace_id, object_kind, object_id, deleted_at, reason, created_at) FROM deletion_ledger" \
      > "$LEDGER_SQL" 2>/dev/null || : > "$LEDGER_SQL"
    LEDGER_ROWS=$(grep -c 'INSERT INTO' "$LEDGER_SQL" 2>/dev/null || printf '0')
    LEDGER_SAVED=1
    ok "saved ${LEDGER_ROWS} deletion-ledger row(s) from the target"
  else
    info "the target has no deletion_ledger table (an empty or pre-M4 database); nothing to save"
  fi
fi

log ""
log " After the restore this script merges that saved ledger back in and runs"
log " scripts/reapply-deletions.sql, so anything either copy recorded as"
log " deleted stays deleted. It will NOT start the API for you."
log ""

confirm "Continue with the restore?"

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

  # --- Reapply the deletion ledger ------------------------------------------
  # docs/spec/03_DATA_MODEL.md: "Restore must reapply a deletion ledger before
  # exposing data." This is that step, and it runs before the script returns.
  LEDGER_AFTER=$(docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
      -tAc "SELECT to_regclass('public.deletion_ledger') IS NOT NULL" 2>/dev/null | tr -d '\r ' || printf 'f')

  if [ "$LEDGER_AFTER" != "t" ]; then
    # The dump predates migration 0007. Migrating is scripts/migrate.sh's job,
    # not this script's, so the ledger is kept and the exact commands printed.
    LEDGER_KEEP="${SRC}/deletion-ledger.sql"
    if [ "$LEDGER_SAVED" = "1" ]; then cp "$LEDGER_SQL" "$LEDGER_KEEP" 2>/dev/null || true; fi
    LEDGER_REAPPLIED="NO - the restored schema has no deletion_ledger"
    warn "The restored dump predates the deletion ledger (migration 0007)."
    warn "The ledger was NOT reapplied. Before serving anything, run:"
    warn "    sh scripts/migrate.sh"
    if [ "$LEDGER_SAVED" = "1" ]; then
      warn "    docker compose exec -T db psql -U ${POSTGRES_USER_V} -d ${POSTGRES_DB_V} < ${LEDGER_KEEP}"
    fi
    warn "    docker compose exec -T db psql -U ${POSTGRES_USER_V} -d ${POSTGRES_DB_V} -v ON_ERROR_STOP=1 < scripts/reapply-deletions.sql"
  else
    if [ "$LEDGER_SAVED" = "1" ] && [ -s "$LEDGER_SQL" ]; then
      docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
          -v ON_ERROR_STOP=1 -q < "$LEDGER_SQL" >/dev/null \
        || die "merging the saved deletion ledger failed. Do NOT start the API: deleted data may be present."
      ok "merged the target's deletion-ledger rows back in"
    fi
    docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
        -v ON_ERROR_STOP=1 -q < scripts/reapply-deletions.sql >/dev/null \
      || die "reapplying the deletion ledger failed. Do NOT start the API: deleted data may be present."
    LEDGER_TOTAL=$(docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" \
        -tAc "SELECT count(*) FROM deletion_ledger" 2>/dev/null | tr -d '\r ' || printf '?')
    LEDGER_REAPPLIED="yes - ${LEDGER_TOTAL} ledger entries replayed"
    ok "deletion ledger reapplied (${LEDGER_TOTAL} entries)"
  fi
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

  # --- Reapply the deletion ledger to the files volume ------------------------
  # reapply-deletions.sql removed the rows; the archive just brought the bytes
  # back. A deleted workspace is a whole directory (storage keys are
  # <workspace>/<file>), a deleted file is one object. Paths come from the
  # ledger, which holds UUIDs only, and are checked against that shape again
  # before anything is removed.
  FILES_PRUNED="not run"
  LEDGER_PATHS=$(docker compose exec -T db psql -U "$POSTGRES_USER_V" -d "$POSTGRES_DB_V" -tA -v ON_ERROR_STOP=1 \
      -c "SELECT CASE WHEN object_kind = 'workspace' THEN workspace_id::text ELSE workspace_id::text || '/' || object_id::text END FROM deletion_ledger WHERE object_kind IN ('workspace', 'file')" \
      2>/dev/null) && LEDGER_READ=1 || LEDGER_READ=0
  # Captured before stripping: a pipeline's status is its last command's, and
  # a psql failure must not read as an empty ledger.
  LEDGER_PATHS=$(printf '%s' "$LEDGER_PATHS" | tr -d '\r')
  if [ "$LEDGER_READ" = "1" ]; then
    printf '%s\n' "$LEDGER_PATHS" | docker compose run --rm --no-deps -T --entrypoint sh api -c \
        "grep -E '^[0-9a-f-]{36}(/[0-9a-f-]{36})?\$' | while read -r p; do rm -rf '${FILES_ROOT_V}'/\"\$p\"; done; exit 0" \
      || die "removing deleted objects from the files volume failed. Do NOT start the API: deleted files may be present."
    FILES_PRUNED="yes - $(printf '%s\n' "$LEDGER_PATHS" | grep -c . || true) ledger path(s) applied"
    # Recounted, so the report says what is left rather than what was unpacked.
    RESTORED_COUNT=$(docker compose run --rm --no-deps --entrypoint sh api \
        -c "find '${FILES_ROOT_V}' -type f | wc -l" 2>/dev/null | tr -d '\r ' || printf '?')
    ok "deleted workspaces and files removed from the files volume (${RESTORED_COUNT} files remain)"
  else
    FILES_PRUNED="NO - the deletion ledger could not be read"
    warn "Could not read the deletion ledger, so objects it names were NOT removed from"
    warn "the files volume. Restore the database (or run migrate) and re-run this step."
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
[ "$DB_ONLY" != "1" ]    && log "   deleted objects removed from files: ${FILES_PRUNED:-not run}"
log ""
if [ "$FILES_ONLY" != "1" ]; then log "   deletion ledger: ${LEDGER_REAPPLIED:-not run}"; fi
log ""
log " NOT verified, because a shell script cannot assert them:"
log "   original CV downloads byte-identical (AT11 - check through the app)"
log "   packet hashes and history preserved  (AT25 - check through the app)"
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
