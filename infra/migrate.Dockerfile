# syntax=docker/dockerfile:1.7
# =============================================================================
# Job Getter one-shot migration runner.
#
# This deliberately adds NO new base image and NO new dependency set: it is the
# API image with a different command. docs/spec/10_DEPLOYMENT.md requires
# migrations to run as a one-shot service before API readiness, and requires
# releases to ship immutable tags/digests. Running migrations from a *different*
# build than the API would let schema and code drift apart between the moment
# you migrate and the moment you start serving.
#
# docker-compose.yml does not build this file. Compose instead reuses the `api`
# build and overrides `command:`, which is the same idea with one less image.
# This Dockerfile exists for hosted/CI release pipelines that want a distinctly
# tagged, distinctly scanned artifact for the migration step, e.g.
#
#   docker build -f infra/api.Dockerfile     -t job-getter-api:$SHA     .
#   docker build -f infra/migrate.Dockerfile -t job-getter-migrate:$SHA \
#     --build-arg API_IMAGE=job-getter-api:$SHA .
#
# UNVERIFIED: this file has never been built. The migration entrypoint below is
# the `tsc` output for apps/api/src/db/migrate.ts (the file behind
# `pnpm --filter @job-getter/api migrate`), derived from apps/api/tsconfig.json,
# which sets rootDir "." with include ["src/**/*.ts", "tests/**/*.ts"] - so the
# emitted path is dist/src/db/migrate.js, not dist/db/migrate.js. If the API
# build layout changes, this ARG is the single place to update.
# =============================================================================

ARG API_IMAGE=job-getter-api:dev

FROM ${API_IMAGE}

# Migrations must be repeatable from an empty database and must be idempotent
# on a populated one (docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md).
ARG MIGRATE_ENTRYPOINT=apps/api/dist/src/db/migrate.js
ENV MIGRATE_ENTRYPOINT=${MIGRATE_ENTRYPOINT}

# Inherited from the API image, restated for readability.
USER node

# A one-shot job has nothing to probe between start and exit.
HEALTHCHECK NONE

# Exits non-zero if any migration fails, so an orchestrator can refuse to start
# the API against a half-migrated schema.
CMD ["sh", "-c", "exec node \"$MIGRATE_ENTRYPOINT\""]
