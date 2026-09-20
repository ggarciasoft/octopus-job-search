#!/usr/bin/env sh
# =============================================================================
# scripts/migrate.sh - run database migrations, locally or through Compose
#
# POSIX shell. PowerShell equivalent: scripts/migrate.ps1
#
# This is a thin wrapper. The migration runner itself lives in the API
# (`pnpm --filter @job-getter/api migrate`), because invariant 1 says Node owns
# persistence: there is exactly one piece of code that changes the schema.
# =============================================================================
set -eu

. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

MODE=auto

usage() {
  cat <<'HELPTEXT'
scripts/migrate.sh - apply database migrations

USAGE
    sh scripts/migrate.sh [--compose | --local] [--help]

MODES
    --compose   Run migrations inside the Compose stack, as the one-shot
                `migrate` service. Uses the API image, so the migration code
                and the serving code come from the same build.
    --local     Run migrations on the host with pnpm, against the DATABASE_URL
                in your environment or .env. For the `scripts/dev.sh` loop.
    (default)   Auto: uses --compose if the `db` Compose service is running,
                otherwise --local.

BEFORE YOU RUN THIS ON DATA YOU CARE ABOUT
    Take a backup. docs/spec/10_DEPLOYMENT.md: "Back up before migration."

        sh scripts/backup.sh

    Migrations are additive by preference and must be repeatable from an empty
    database. This script never runs DOWN migrations: docs/spec/10_DEPLOYMENT.md
    forbids blindly reversing migrations on live data. If you need to roll back,
    restore the backup you took and read docs/RUNBOOK.md -> "Migration".

EXIT STATUS
    0 if every migration applied (or there was nothing to do).
    Non-zero otherwise. A non-zero exit means DO NOT START THE API against this
    database.
HELPTEXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --compose) MODE=compose ;;
    --local)   MODE=local ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

cd "$JG_REPO_ROOT"

if [ "$MODE" = "auto" ]; then
  if docker compose version >/dev/null 2>&1 && \
     [ -n "$(docker compose ps --quiet db 2>/dev/null || true)" ]; then
    MODE=compose
    info "Compose 'db' service is running; using --compose."
  else
    MODE=local
    info "No running Compose database detected; using --local."
  fi
fi

case "$MODE" in

  compose)
    require_compose
    require_file "$JG_ENV_FILE" "run 'sh scripts/setup.sh' first"

    info "Ensuring the database is healthy before migrating..."
    docker compose up -d --wait db \
      || die "the 'db' service did not become healthy. Check: docker compose logs db"

    info "Running the one-shot migrate service..."
    # `run --rm` rather than `up migrate`: we want this shell's exit status to
    # be the migration's exit status, and we want the container removed either
    # way. `up` would return the status of the up command, not the job.
    if docker compose run --rm --no-deps migrate; then
      ok "Migrations applied (Compose)."
    else
      die "Migration failed. The API must not be started against this database.
Inspect the output above, then see docs/RUNBOOK.md -> 'Migration'."
    fi
    ;;

  local)
    require_cmd pnpm "Install pnpm: corepack enable && corepack prepare --activate"

    # DATABASE_URL from the environment wins; otherwise take it from .env.
    # Note it is exported into the child pnpm process only.
    if [ -z "${DATABASE_URL:-}" ]; then
      if [ -f "$JG_ENV_FILE" ]; then
        DATABASE_URL=$(env_get DATABASE_URL || printf '')
        # .env defaults to the Compose hostname `db`, which does not resolve on
        # the host. Rewrite it rather than failing with a DNS error the user has
        # to decode.
        case "$DATABASE_URL" in
          *"@db:"*)
            DATABASE_URL=$(printf '%s' "$DATABASE_URL" | sed 's/@db:/@127.0.0.1:/')
            info "Rewrote the Compose hostname 'db' to 127.0.0.1 for host-side use."
            ;;
        esac
      fi
    fi
    [ -n "${DATABASE_URL:-}" ] || die \
      "DATABASE_URL is not set and could not be read from .env. Run 'sh scripts/setup.sh' or export DATABASE_URL."
    export DATABASE_URL

    # The URL contains a password, so it is never echoed.
    info "Migrating $(printf '%s' "$DATABASE_URL" | sed 's#://[^@]*@#://***:***@#')"

    if pnpm --filter @job-getter/api migrate; then
      ok "Migrations applied (local)."
    else
      die "Migration failed. The API must not be started against this database."
    fi
    ;;

esac
