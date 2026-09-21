"""The visible browser the runner drives, and the fences around it.

``docs/spec/07_APPLICATION_AUTOMATION.md`` -> "Local browser runner M4" sets
every constraint implemented here, and each one is a refusal:

* **Its own profile, not the user's.** Chromium runs from a persistent profile
  directory this process owns. The runner never reads cookies out of the
  user's default browser, so a session it has is a session the user
  deliberately signed into inside this window.
* **Restricted storage, outside export and outside git.** The profile holds
  live employer sessions. It lives under the runner's state directory, which
  is created 0700 and is excluded from the workspace export by never being part
  of the workspace at all.
* **Visible by default.** Headless is available for tests and is not the
  product: the user has to be able to watch, log in, solve a challenge and take
  over.
* **One origin.** A top-level navigation to anything outside the allowed set is
  aborted, not followed. "Never navigate through unexpected external origins
  without user interaction."
* **No submit.** There is no method here that clicks a submit control, and the
  inspection snippet filters submit buttons out before Python ever sees them.
  The runner's best outcome is a filled form waiting for a person.

Playwright is imported lazily so that the pure parts of the runner - the field
model, the planner, the adapters' parsing - remain importable and testable on a
machine with no browser installed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from ..logging import get_logger

if TYPE_CHECKING:  # pragma: no cover - typing only
    from playwright.async_api import BrowserContext, Page

_log = get_logger(__name__)


class BrowserUnavailableError(RuntimeError):
    """Playwright or its browser is not installed on this machine."""


class NavigationBlockedError(RuntimeError):
    """A navigation left the origins this fill was authorised for."""


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme == "" or parts.hostname is None:
        return ""
    port = f":{parts.port}" if parts.port is not None else ""
    return f"{parts.scheme}://{parts.hostname}{port}"


@dataclass(frozen=True)
class BrowserOptions:
    profile_dir: Path
    headless: bool = False
    navigation_timeout_ms: int = 45_000


class RunnerBrowser:
    """A persistent Chromium profile owned by the runner process."""

    def __init__(self, options: BrowserOptions) -> None:
        self._options = options
        self._playwright: Any | None = None
        self._context: BrowserContext | None = None

    async def start(self) -> None:
        try:
            from playwright.async_api import async_playwright
        except ImportError as error:  # pragma: no cover - depends on install
            raise BrowserUnavailableError(
                "The local runner needs Playwright. Install it with "
                "`uv sync --extra browser` and `uv run playwright install chromium`."
            ) from error

        profile = self._options.profile_dir
        profile.mkdir(parents=True, exist_ok=True)
        # The profile holds live employer sessions; on POSIX this is the
        # difference between "the user's own data" and "readable by anything
        # else on the box". Windows has no chmod equivalent here and inherits
        # the user's ACL, which is the same intent.
        if os.name == "posix":
            profile.chmod(0o700)

        self._playwright = await async_playwright().start()
        try:
            self._context = await self._playwright.chromium.launch_persistent_context(
                str(profile),
                headless=self._options.headless,
                args=["--disable-background-networking"],
            )
        except Exception as error:  # pragma: no cover - depends on install
            await self.aclose()
            raise BrowserUnavailableError(
                f"Chromium could not be launched: {error}. "
                "Run `uv run playwright install chromium`."
            ) from error
        self._context.set_default_navigation_timeout(self._options.navigation_timeout_ms)

    async def aclose(self) -> None:
        if self._context is not None:
            await self._context.close()
            self._context = None
        if self._playwright is not None:
            await self._playwright.stop()
            self._playwright = None

    @property
    def context(self) -> BrowserContext:
        if self._context is None:
            raise BrowserUnavailableError("The browser has not been started.")
        return self._context

    async def open(self, url: str, allowed_origins: tuple[str, ...]) -> Page:
        """Open a page bound to a set of origins.

        The guard is on *navigations*, not on every subresource: blocking the
        fonts and scripts an application form needs would break the page the
        user has to look at, while a top-level jump to another origin is
        exactly the thing that must not happen unattended.
        """
        page = await self.context.new_page()
        allowed = set(allowed_origins)

        async def _guard(route: Any, request: Any) -> None:
            if not request.is_navigation_request() or request.frame != page.main_frame:
                await route.continue_()
                return
            target = origin_of(request.url)
            if target in allowed:
                await route.continue_()
                return
            _log.warning("runner.navigation_blocked", origin_count=len(allowed))
            await route.abort()

        await page.route("**/*", _guard)

        if origin_of(url) not in allowed:
            raise NavigationBlockedError(
                "The destination is outside the origins this fill was authorised for."
            )
        await page.goto(url, wait_until="domcontentloaded")

        # Re-check after the fact: a server-side redirect chain that ended
        # somewhere else is still somewhere else.
        if origin_of(page.url) not in allowed:
            raise NavigationBlockedError(
                "The page redirected outside the origins this fill was authorised for."
            )
        return page
