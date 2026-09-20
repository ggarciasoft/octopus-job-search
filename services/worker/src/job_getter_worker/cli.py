"""``job-getter-worker`` - the container worker entrypoint.

Started by ``infra/worker.Dockerfile`` (``CMD ["job-getter-worker"]``). It polls
the API for work and exits cleanly on SIGTERM so a lease is released rather than
left to expire.
"""

from __future__ import annotations

import asyncio
import sys

from pydantic import ValidationError

from .api import TaskApiClient
from .handlers import build_default_registry
from .logging import configure_logging, get_logger
from .settings import CapabilityConfigurationError, WorkerSettings, load_settings
from .worker import Worker


def _load() -> WorkerSettings:
    """Load settings, failing fast with a message an operator can act on."""
    try:
        return load_settings()
    except CapabilityConfigurationError as error:
        print(f"job-getter-worker: {error}", file=sys.stderr)
        raise SystemExit(2) from error
    except ValidationError as error:
        missing = [
            ".".join(str(part) for part in item["loc"])
            for item in error.errors()
            if item["type"] == "missing"
        ]
        if missing:
            print(
                "job-getter-worker: missing required configuration: "
                f"{', '.join(sorted(missing))}. See .env.example -> 'Worker'.",
                file=sys.stderr,
            )
        else:
            print(f"job-getter-worker: invalid configuration:\n{error}", file=sys.stderr)
        raise SystemExit(2) from error


async def _run(settings: WorkerSettings) -> None:
    async with TaskApiClient(
        settings.api_base_url,
        settings.auth_token.get_secret_value(),
        timeout_seconds=settings.request_timeout_seconds,
        max_download_bytes=settings.max_download_bytes,
    ) as api:
        worker = Worker(settings, api, build_default_registry())
        worker.install_signal_handlers()
        await worker.run_forever()


def main() -> int:
    """Entry point for the ``job-getter-worker`` console script."""
    settings = _load()
    configure_logging(settings.log_level)
    log = get_logger("job_getter_worker.cli")

    try:
        asyncio.run(_run(settings))
    except RuntimeError as error:
        # Raised when declared capabilities and registered handlers disagree.
        log.error("worker.startup_failed", reason=str(error))
        print(f"job-getter-worker: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:  # pragma: no cover - interactive only
        return 130
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
