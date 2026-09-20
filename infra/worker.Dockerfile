# syntax=docker/dockerfile:1.7
# =============================================================================
# Job Getter processing worker (Python 3.12, uv)
#
# Base image pins
# ---------------
#   python:3.12-slim-bookworm
#     sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
#     Verified 2026-09-20: pulled on the build host and read back from
#     `docker images --digests`. The runtime in that image reports Python
#     3.12.14, which is the same patch uv installed for local development, so
#     the container and the dev loop agree. Satisfies the >=3.12,<3.13
#     constraint in services/worker/pyproject.toml.
#     Caveat: resolved through the AWS ECR Public mirror (Docker Hub was
#     answering HTTP 429 on this network); not re-verified against docker.io.
#
#   ghcr.io/astral-sh/uv:0.12.17
#     sha256:10787c682e4184e4f290de1171fd4703dc63de99221f10fe1c99002ce7fa9acc
#     Verified 2026-09-20 directly against GitHub Container Registry (NOT a
#     mirror, and not rate limited) with:
#       docker buildx imagetools inspect ghcr.io/astral-sh/uv:0.12.17 \
#         --format '{{.Manifest.Digest}}'
#       docker image inspect ghcr.io/astral-sh/uv:0.12.17 \
#         --format '{{index .RepoDigests 0}}'
#       docker run --rm --entrypoint /uv ghcr.io/astral-sh/uv:0.12.17 --version
#         -> uv 0.12.17 (x86_64-unknown-linux-musl)
#     This matches the uv 0.12.17 used on the development host exactly, so the
#     container resolves uv.lock the same way the developer does.
#
# WHAT THIS CONTAINER DOES NOT DO
# -------------------------------
# It performs noninteractive processing and document rendering only. Chromium
# is installed for CV rendering (HTML -> PDF). It is NOT used for authenticated
# job-site browsing, and this worker MUST NOT claim the `fill_local`
# capability. Per docs/spec/02_ARCHITECTURE.md and ADR05, a headless container
# cannot interact with the user's desktop browser session and must not pretend
# to; local form filling belongs to the paired desktop runner
# (`uv run --project services/worker job-getter-runner pair ...`) or, from M5,
# the browser extension. The default WORKER_CAPABILITIES below enforces that.
# =============================================================================

ARG IMAGE_REGISTRY=docker.io/library
ARG PYTHON_IMAGE=python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.17@sha256:10787c682e4184e4f290de1171fd4703dc63de99221f10fe1c99002ce7fa9acc

FROM ${UV_IMAGE} AS uv-bin

# -----------------------------------------------------------------------------
# Stage 1: resolve and install the locked environment
# -----------------------------------------------------------------------------
FROM ${IMAGE_REGISTRY}/${PYTHON_IMAGE} AS build

COPY --from=uv-bin /uv /uvx /usr/local/bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    # The base image already provides the interpreter. Never let uv reach out
    # and download another one - that would be an unpinned network fetch.
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /repo/services/worker

# Lock + manifest first, so a source edit does not re-resolve dependencies.
COPY services/worker/pyproject.toml services/worker/uv.lock ./
COPY services/worker/README.md ./README.md

# --frozen: fail if uv.lock does not already satisfy pyproject.toml. The image
#           build must never quietly resolve a different dependency set.
# --no-dev: pytest/ruff/mypy stay out of the runtime image.
# --extra browser: Playwright, needed for CV rendering (see header).
# --no-install-project: only third-party dependencies at this point; the
#           project itself is installed after its source is copied.
# build_ca: an OPTIONAL BuildKit secret (a PEM root) for networks whose TLS is
# intercepted by a proxy or an antivirus web shield. uv (reqwest) reads
# SSL_CERT_FILE, and that variable REPLACES the trust store rather than adding
# to it, so the root is appended to the system bundle in a temp file instead
# of being used alone. Mounted per RUN, never written to a layer. Without the
# secret the guard is a no-op. Verification is never disabled instead.
RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/build_ca > /tmp/build-ca-bundle.pem \
      && export SSL_CERT_FILE=/tmp/build-ca-bundle.pem; \
    fi \
 && uv sync --frozen --no-dev --extra browser --no-install-project \
 && rm -f /tmp/build-ca-bundle.pem

COPY services/worker/src ./src

RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/build_ca > /tmp/build-ca-bundle.pem \
      && export SSL_CERT_FILE=/tmp/build-ca-bundle.pem; \
    fi \
 && uv sync --frozen --no-dev --extra browser --no-editable \
 && rm -f /tmp/build-ca-bundle.pem
# --no-editable: without it uv installs the project as an editable pointer
# (_editable_impl_job_getter_worker.pth -> /repo/services/worker/src). That
# path exists only in this build stage; the runtime stage copies /opt/venv
# alone, so the package would be unimportable there and the container would
# crash on start. --no-editable copies the package into site-packages.

# -----------------------------------------------------------------------------
# Stage 2: runtime
# -----------------------------------------------------------------------------
FROM ${IMAGE_REGISTRY}/${PYTHON_IMAGE} AS runtime

LABEL org.opencontainers.image.title="job-getter-worker" \
      org.opencontainers.image.description="Job Getter Python worker: parsing, normalization, matching and document rendering. No authenticated job-site browsing." \
      org.opencontainers.image.licenses="Apache-2.0"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/opt/venv/bin:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

COPY --from=uv-bin /uv /uvx /usr/local/bin/
COPY --from=build /opt/venv /opt/venv

# Unprivileged account. docs/spec/09_SECURITY_PRIVACY.md: documents are parsed
# "in an isolated non-root worker with no host filesystem mounts beyond task
# input/output".
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin worker

# Chromium is installed as a SEPARATE, explicit step rather than being bundled
# by the Python dependency resolver, because it is a large out-of-band download
# with its own licence and its own OS package dependencies. `--with-deps` pulls
# the Debian libraries Chromium needs; it requires root, so it runs before the
# USER switch. The browser binary is then handed to the worker account.
#
# Network note: this step downloads from Playwright's CDN and, via
# --with-deps, from the Debian archives through apt. On a network whose TLS is
# intercepted, supply the intercepting root as the `build_ca` BuildKit secret
# (see the uv sync steps above). It is NOT copied into
# /usr/local/share/ca-certificates: that would persist a third party's root
# in the runtime image for every future user of it. Instead a merged bundle
# and a transient apt configuration are created and deleted within this one
# RUN, so nothing survives into the layer. Verification is never disabled.
RUN --mount=type=cache,id=apt-lists,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/build_ca > /tmp/build-ca-bundle.pem \
      && export SSL_CERT_FILE=/tmp/build-ca-bundle.pem \
      && export NODE_EXTRA_CA_CERTS=/tmp/build-ca-bundle.pem \
      && printf 'Acquire::https::CAInfo "/tmp/build-ca-bundle.pem";\n' > /etc/apt/apt.conf.d/99-build-ca; \
    fi \
 && playwright install --with-deps chromium \
 && chown -R worker:worker "${PLAYWRIGHT_BROWSERS_PATH}" \
 && rm -rf /var/cache/apt/archives/*.deb \
 && rm -f /etc/apt/apt.conf.d/99-build-ca /tmp/build-ca-bundle.pem

WORKDIR /app

USER worker

# Defaults; docker-compose.yml supplies the real values from .env.
# fill_local is absent on purpose - see the header. Listing only task types the
# worker actually implements keeps the API from leasing it work it will fail
# (invariant 10).
ENV WORKER_ID=container-worker-1 \
    WORKER_CAPABILITIES=noop_echo,parse_profile,fetch_board,fetch_job

# The worker polls outward; it exposes no port and serves no HTTP surface
# (docs/spec/02_ARCHITECTURE.md: "an outbound polling worker, not another
# public API"). There is therefore no HEALTHCHECK here - there is nothing to
# probe. Liveness is observable from the API side: a worker that stops claiming
# tasks shows up as queue age, which docs/OPERATIONS.md lists as the stalled
# queue alert.

# Exec form so the process gets SIGTERM directly and can finish its current
# lease heartbeat, release the lease and exit cleanly within
# stop_grace_period.
CMD ["job-getter-worker"]
