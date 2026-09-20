# syntax=docker/dockerfile:1.7
# =============================================================================
# Job Getter web UI (React + Vite), served as a static bundle behind nginx.
#
# Base image pins
# ---------------
#   node:24-alpine (build stage)
#     sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
#   nginx:1.29-alpine (runtime stage)
#     sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de
#
# How these were verified (2026-09-20): both images were pulled on the build
# host and the digests read back from `docker images --digests`. Same honest
# caveat as infra/api.Dockerfile - the pulls went through the AWS ECR Public
# mirror because Docker Hub was answering HTTP 429 on this network, so the
# digests are ECR-resolved and were not re-verified against docker.io. They are
# expected to match (ECR Public mirrors Docker Hub content-addressed); if they
# do not, the pull fails loudly.
#
# NOTE: the nginx:1.29-alpine image available on the mirror at pin time was
# ~5 months old. Re-resolve the digest before any public release rather than
# trusting this pin indefinitely - see docs/RUNBOOK.md -> "Upgrade".
# =============================================================================

ARG IMAGE_REGISTRY=docker.io/library
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ARG NGINX_IMAGE=nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de

# -----------------------------------------------------------------------------
# Stage 1: build the Vite bundle
# -----------------------------------------------------------------------------
FROM ${IMAGE_REGISTRY}/${NODE_IMAGE} AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare --activate

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/contracts/package.json  packages/contracts/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/ui/package.json         packages/ui/package.json
COPY apps/api/package.json            apps/api/package.json
COPY apps/web/package.json            apps/web/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @job-getter/web...

COPY tsconfig.base.json ./
COPY packages/contracts  packages/contracts
COPY packages/api-client packages/api-client
COPY packages/ui         packages/ui
COPY apps/web            apps/web

# Dependency order: contracts -> api-client -> ui -> web.
RUN pnpm --filter @job-getter/contracts  build \
 && pnpm --filter @job-getter/api-client build \
 && pnpm --filter @job-getter/ui         build \
 && pnpm --filter @job-getter/web        build

# -----------------------------------------------------------------------------
# Stage 2: static runtime
#
# The bundle is served by nginx as an UNPRIVILEGED user. The stock nginx image
# runs its master process as root by default; everything that requires root
# (binding :80, writing /var/run/nginx.pid, writing /var/cache/nginx) is moved
# or re-owned below so USER nginx works.
# -----------------------------------------------------------------------------
FROM ${IMAGE_REGISTRY}/${NGINX_IMAGE} AS runtime

LABEL org.opencontainers.image.title="job-getter-web" \
      org.opencontainers.image.description="Job Getter web UI served as a static bundle with /api proxied to the API service." \
      org.opencontainers.image.licenses="Apache-2.0"

# The stock configuration listens on :80 and would need root. Remove it so the
# official entrypoint's ipv6/template helpers have nothing to rewrite, and ship
# a complete nginx.conf instead of a conf.d fragment - we need control over the
# `pid` and `*_temp_path` directives, which only exist at the top level.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY infra/proxy/nginx.conf /etc/nginx/nginx.conf

COPY --from=build --chown=nginx:nginx /repo/apps/web/dist /usr/share/nginx/html

# Writable locations for the unprivileged worker. /tmp holds the pid file and
# the request/proxy temp directories declared in nginx.conf.
RUN chown -R nginx:nginx /var/cache/nginx /usr/share/nginx/html \
 && chmod 1777 /tmp

USER nginx

# 8080, not 80: ports below 1024 need CAP_NET_BIND_SERVICE, which a non-root
# container should not hold. Compose publishes this on 127.0.0.1:3000 only.
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/nginx-health || exit 1

# Bypass /docker-entrypoint.sh: its helper scripts assume a writable
# /etc/nginx/conf.d and a root user, neither of which applies here.
ENTRYPOINT ["nginx", "-g", "daemon off;"]
