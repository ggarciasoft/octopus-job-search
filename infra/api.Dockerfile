# syntax=docker/dockerfile:1.7
# =============================================================================
# Job Getter API (Fastify + TypeScript, Node 24)
#
# Base image pin
# --------------
#   node:24-alpine
#   digest sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
#
# How this was verified (2026-09-20): the image was pulled on the build host
# and the digest read back with
#   docker image inspect node:24-alpine --format '{{index .RepoDigests 0}}'
# and cross-checked against `docker images --digests`. The runtime in that
# image reports v24.21.0, which satisfies the repository's engines field
# (>=24.0.0 <25) and docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md's Node 24
# LTS baseline.
#
# HONEST CAVEAT: this digest was resolved through the AWS ECR Public mirror
# (public.ecr.aws/docker/library/node), because Docker Hub was returning HTTP
# 429 on the build network at the time. ECR Public mirrors Docker Hub
# content-addressed, so the digest is expected to be byte-identical on
# docker.io, but that was NOT re-verified against Docker Hub. If Docker Hub
# ever serves a different digest for this tag the pull fails loudly rather
# than silently substituting an image - which is the behaviour we want.
#
# Set IMAGE_REGISTRY=public.ecr.aws/docker/library to build through the mirror.
# =============================================================================

ARG IMAGE_REGISTRY=docker.io/library
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

# -----------------------------------------------------------------------------
# Stage 1: dependencies
#
# `argon2` is a native addon. Alpine is musl, and a glibc prebuild will not
# load there, so the build toolchain is installed in this stage only and never
# reaches the runtime image.
# -----------------------------------------------------------------------------
FROM ${IMAGE_REGISTRY}/${NODE_IMAGE} AS deps

RUN apk add --no-cache python3 make g++ libc6-compat

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack ships with the image; the exact pnpm version comes from the
# packageManager field in package.json, so it is pinned by the repository and
# not by this Dockerfile.
RUN corepack enable && corepack prepare --activate

WORKDIR /repo

# Copy only the manifests first so a source-only change does not re-resolve the
# dependency graph.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/contracts/package.json    packages/contracts/package.json
COPY packages/api-client/package.json   packages/api-client/package.json
COPY packages/ui/package.json           packages/ui/package.json
COPY apps/api/package.json              apps/api/package.json
COPY apps/web/package.json              apps/web/package.json

# --frozen-lockfile: the build fails if the lockfile does not already satisfy
# the manifests. CI and images must never silently resolve a new version.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @job-getter/api... \
      --filter @job-getter/contracts...

# -----------------------------------------------------------------------------
# Stage 2: build
# packages/contracts must be built before apps/api, because the API imports its
# generated schemas and route table.
# -----------------------------------------------------------------------------
FROM deps AS build

WORKDIR /repo

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api          apps/api

RUN pnpm --filter @job-getter/contracts build \
 && pnpm --filter @job-getter/api      build

# Re-resolve the dependency tree with dev dependencies removed, so only what
# the runtime needs is carried into the final stage.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod \
      --filter @job-getter/api... \
      --filter @job-getter/contracts...

# -----------------------------------------------------------------------------
# Stage 3: runtime
# No compilers, no pnpm store, no dev dependencies, no source .ts files.
# -----------------------------------------------------------------------------
FROM ${IMAGE_REGISTRY}/${NODE_IMAGE} AS runtime

# wget is used by HEALTHCHECK. It is already present in busybox on alpine;
# this line documents the dependency rather than installing anything.
LABEL org.opencontainers.image.title="job-getter-api" \
      org.opencontainers.image.description="Job Getter API: authentication, persistence, task leases, scheduling." \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/ggarciasoft/job-getter"

ENV NODE_ENV=production \
    PORT=8080 \
    FILES_ROOT=/var/lib/job-getter/files

WORKDIR /app

# The `node` user (uid/gid 1000) already exists in the official image.
# docs/spec/09_SECURITY_PRIVACY.md requires processing to run non-root.
COPY --from=build --chown=node:node /repo/node_modules                  ./node_modules
COPY --from=build --chown=node:node /repo/packages/contracts/dist       ./packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/contracts/generated  ./packages/contracts/generated
COPY --from=build --chown=node:node /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist                 ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json         ./apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/node_modules         ./apps/api/node_modules

# Local file storage lives on a named volume; create the mount point with the
# right owner so the non-root process can write to it.
RUN mkdir -p "${FILES_ROOT}" && chown -R node:node "${FILES_ROOT}"

USER node

EXPOSE 8080

# Liveness only: process is up and the event loop is responsive. It MUST NOT
# touch the database - readiness (/health/ready) does that
# (docs/spec/10_DEPLOYMENT.md, docs/OPERATIONS.md). Compose gates `api`
# dependants on this check.
#
# Path verified against apps/api/src/health.ts, which registers exactly
# `/health/live` and `/health/ready`.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/health/live" || exit 1

# Entry point resolution
# ----------------------
# apps/api/tsconfig.json sets `rootDir: "."` with `include: ["src/**/*.ts",
# "tests/**/*.ts"]`, so tsc emits `dist/src/server.js` - NOT `dist/server.js`.
# (Note: apps/api/package.json's `start` script says `dist/server.js`, which
# does not match that tsconfig. Flagged upstream.)
#
# Rather than hard-coding one and breaking if the layout is corrected, both are
# tried. `exec` replaces the shell, so node still receives SIGTERM directly and
# can drain in-flight requests and release held task leases before exit -
# Compose gives it stop_grace_period to do so.
CMD ["sh", "-c", "if [ -f apps/api/dist/src/server.js ]; then exec node apps/api/dist/src/server.js; else exec node apps/api/dist/server.js; fi"]
