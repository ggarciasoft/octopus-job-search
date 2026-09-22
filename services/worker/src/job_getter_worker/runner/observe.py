"""Watching the employer's page for a confirmation, and giving up honestly.

``docs/spec/07_APPLICATION_AUTOMATION.md``:

    observe_confirmation() -> evidence or unknown.

    After manual submission, an adapter may observe a confirmation
    message/reference on the allowed page. Store normalized confirmation text,
    URL and time [...] If adapter cannot verify, ask the user to report
    outcome. **Absence of evidence is not failure or success.**

The deadline is the whole feature. A watch that runs out has not gone wrong; it
has established that the page did not say anything this adapter recognises
within the time we agreed to wait, which is a fact worth reporting and is not
the same as "the application failed" or "nothing was submitted". So the timeout
path returns a *result* with ``outcome="unknown"`` and
``unknown_reason="timed_out"`` rather than raising -- AT16 exactly:

    AT16 | Submit observation times out | outcome_unknown; no automated retry

Nothing here submits anything. There is no click in this module at all: it
opens the page the packet named, reads it on a poll, and stops.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from playwright.async_api import Page

from ..clock import to_timestamp_string, utc_now
from ..contracts.generated import (
    ObserveConfirmationInput,
    ObserveConfirmationResult,
    ObservedConfirmation,
)
from ..logging import get_logger, log_shape
from .adapters.base import Adapter
from .browser import NavigationBlockedError, RunnerBrowser, origin_of
from .fill import choose_adapter

_log = get_logger(__name__)

#: The generated result model types `unknown_reason` as a Literal, so these are
#: written as the contract's own strings rather than as an enum -- the same
#: choice `runner/fill.py` makes for `outcome`, and for the same reason.
UnknownReason = Literal[
    "timed_out",
    "no_confirmation_found",
    "left_allowed_origin",
    "unsupported",
    "runner_error",
]

#: How often the page is re-read while waiting. Short enough that a
#: confirmation appearing is noticed promptly, long enough not to spin.
POLL_INTERVAL_SECONDS = 2.0


def _unknown(
    payload: ObserveConfirmationInput,
    reason: UnknownReason,
    *,
    watched_seconds: float,
    page_url: str | None = None,
    adapter: Adapter | None = None,
) -> ObserveConfirmationResult:
    """The honest non-answer, in the shape the API expects."""
    return ObserveConfirmationResult(
        application_id=payload.application_id,
        packet_id=payload.packet_id,
        outcome="unknown",
        confirmation=None,
        unknown_reason=reason,
        watched_seconds=int(watched_seconds),
        page_url=page_url,
        adapter=adapter.name if adapter else None,
        adapter_version=adapter.version if adapter else None,
        screenshot_file_id=None,
    )


def _parse_confirmation(raw: Any) -> ObservedConfirmation | None:
    """Turn what the page script returned into a confirmation, or nothing.

    A malformed or empty reading is ``None``. Anything short of real
    confirmation text is not a confirmation: the reference alone could be any
    number on the page.
    """
    if not isinstance(raw, dict):
        return None
    text = raw.get("confirmation_text")
    if not isinstance(text, str) or not text.strip():
        return None
    reference = raw.get("reference")
    url = raw.get("url")
    return ObservedConfirmation(
        confirmation_text=text.strip()[:2000],
        reference=reference[:200] if isinstance(reference, str) and reference.strip() else None,
        url=url[:2000] if isinstance(url, str) else None,
        observed_at=to_timestamp_string(utc_now()),
    )


async def watch_for_confirmation(
    page: Page,
    payload: ObserveConfirmationInput,
    *,
    adapter: Adapter,
    sleep: Any = asyncio.sleep,
    monotonic: Any = asyncio.get_event_loop,
    report: Any = None,
) -> ObserveConfirmationResult:
    """Re-read the page until it confirms, the origin changes, or time runs out."""
    loop = asyncio.get_running_loop()
    started = loop.time()
    deadline = started + payload.timeout_seconds

    while True:
        elapsed = loop.time() - started

        # The page may navigate while we watch -- a confirmation often lives on
        # a different URL. It may not leave the origins this packet named.
        current = page.url
        if origin_of(current) not in payload.allowed_origins:
            return _unknown(
                payload,
                "left_allowed_origin",
                watched_seconds=elapsed,
                page_url=current,
                adapter=adapter,
            )

        raw = await page.evaluate(adapter.confirmation_script)
        confirmation = _parse_confirmation(raw)
        if confirmation is not None:
            return ObserveConfirmationResult(
                application_id=payload.application_id,
                packet_id=payload.packet_id,
                outcome="observed",
                confirmation=confirmation,
                unknown_reason=None,
                watched_seconds=int(elapsed),
                page_url=current,
                adapter=adapter.name,
                adapter_version=adapter.version,
                # Capturing one is a separate, consented step; the runner does
                # not take a picture of someone's confirmation page by default.
                screenshot_file_id=None,
            )

        if loop.time() >= deadline:
            # AT16. Not an error: a fact about the page.
            return _unknown(
                payload,
                "timed_out",
                watched_seconds=loop.time() - started,
                page_url=current,
                adapter=adapter,
            )

        if report is not None:
            percent = min(95, int(10 + 85 * (elapsed / max(payload.timeout_seconds, 1))))
            report("watching for a confirmation", percent)

        await sleep(min(POLL_INTERVAL_SECONDS, max(0.0, deadline - loop.time())))


def build_observe_handler(
    browser: RunnerBrowser,
    device_id: str,
    *,
    keep_page_open: bool = True,
) -> Any:
    """Bind the watcher to a browser and return a task handler."""

    async def handler(ctx: Any) -> ObserveConfirmationResult:
        payload = ObserveConfirmationInput.model_validate(ctx.input)
        if payload.device_id != device_id:
            # The same rule the fill path applies: a runner works only on the
            # tasks addressed to the device it was paired as.
            return _unknown(payload, "runner_error", watched_seconds=0)

        ctx.report_progress("opening the page", 10)
        try:
            page = await browser.open(payload.destination.url, tuple(payload.allowed_origins))
        except NavigationBlockedError:
            # Refusing to navigate is correct and is still not a statement
            # about the application, so it is reported as unknown rather than
            # raised: a task failure here would read as "the application
            # failed" on the tracker.
            return _unknown(payload, "left_allowed_origin", watched_seconds=0)

        try:
            ctx.cancel.raise_if_cancelled()
            adapter = await choose_adapter(page, page.url, payload.adapter)
            if adapter is None:
                return _unknown(
                    payload,
                    "unsupported",
                    watched_seconds=0,
                    page_url=page.url,
                )

            result = await watch_for_confirmation(
                page, payload, adapter=adapter, report=ctx.report_progress
            )
            log_shape(
                "observe_confirmation.finished",
                outcome=result.outcome,
                reason=result.unknown_reason,
                watched_seconds=result.watched_seconds,
                adapter=result.adapter_version,
            )
            ctx.report_progress("done", 100)
            return result
        finally:
            if not keep_page_open:
                await page.close()

    return handler
