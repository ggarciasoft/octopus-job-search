"""The paired local desktop runner (M4, ADR05).

A second process, on the user's own machine, that claims **only** ``fill_local``
work for **only** its own workspace and drives a visible browser it owns. It is
a separate package from the container worker's handlers for a reason that is
architectural rather than tidy: a headless container has no access to a
person's desktop browser, and an operator worker credential must never be able
to claim this work (``RUNNER_ONLY_CAPABILITIES``, enforced on the API side by
``assertCapabilitiesAllowed``).

What lives here:

* :mod:`~job_getter_worker.runner.forms` - the vendor-neutral field model and
  the form fingerprint.
* :mod:`~job_getter_worker.runner.plan` - the pure planner, which decides what
  may be typed and what must be asked.
* :mod:`~job_getter_worker.runner.adapters` - the tested site adapters. One so
  far: Greenhouse.
* :mod:`~job_getter_worker.runner.browser` - the persistent Chromium profile
  and the origin fence around it.
* :mod:`~job_getter_worker.runner.fill` - the driver.
* :mod:`~job_getter_worker.runner.store` / ``pairing`` - the device token.

Everything except :mod:`browser` imports without Playwright installed, so the
planner and the adapters stay testable on a machine with no browser.
"""

from __future__ import annotations

from typing import Any

from ..contracts.generated import TaskType
from ..handlers import HandlerRegistry


def build_runner_registry(browser: Any, device_id: str, **options: Any) -> HandlerRegistry:
    """A registry holding `fill_local` and nothing else.

    The container worker's registry and this one are disjoint on purpose: a
    single registry with a flag would be one boolean away from a headless
    container claiming a browser task.
    """
    from .fill import build_fill_handler

    registry = HandlerRegistry()
    registry.register(TaskType.FILL_LOCAL, build_fill_handler(browser, device_id, **options))
    return registry


__all__ = ["build_runner_registry"]
