"""AT16: the submit observation, and what happens when it runs out of time.

    AT16 | Submit observation times out | outcome_unknown; no automated retry

Every test here drives a **real Chromium** against a synthetic page served from
loopback, exactly as `test_runner_greenhouse.py` does. Nothing is submitted:
the observation path has no click in it at all, and the confirmation fixture is
a page the person is imagined to have already reached themselves.

The assertion that matters most is the negative one. A watch that sees nothing
must report `unknown`, not raise, not fail the task, and above all not guess.
"""

from __future__ import annotations

import http.server
import threading
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import uuid4

import pytest

from job_getter_worker.contracts.generated import (
    ObserveConfirmationInput,
    PacketDestination,
)
from job_getter_worker.runner.adapters.greenhouse import GreenhouseAdapter
from job_getter_worker.runner.browser import (
    BrowserOptions,
    BrowserUnavailableError,
    RunnerBrowser,
)
from job_getter_worker.runner.observe import build_observe_handler, watch_for_confirmation

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "ats-pages"

DEVICE_ID = "11111111-2222-4333-8444-555555555555"


@pytest.fixture(scope="module")
def server() -> Iterator[str]:
    """Serve the fixture pages from a real loopback origin."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=str(FIXTURES), **kwargs)  # type: ignore[arg-type]

        def log_message(self, *args: object) -> None:
            return

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.fixture
async def browser(tmp_path: Path) -> AsyncIterator[RunnerBrowser]:
    runner = RunnerBrowser(BrowserOptions(profile_dir=tmp_path / "profile", headless=True))
    try:
        await runner.start()
    except BrowserUnavailableError as error:
        pytest.skip(f"Playwright Chromium is not installed here: {error}")
    try:
        yield runner
    finally:
        await runner.aclose()


def payload(
    server: str,
    *,
    page: str = "greenhouse-confirmation.html",
    timeout_seconds: int = 5,
    allowed_origins: list[str] | None = None,
    device_id: str = DEVICE_ID,
) -> ObserveConfirmationInput:
    return ObserveConfirmationInput(
        application_id=str(uuid4()),
        packet_id=str(uuid4()),
        device_id=device_id,
        destination=PacketDestination(
            url=f"{server}/{page}",
            origin=server,
            connector="greenhouse",
            connector_version="greenhouse/v1",
        ),
        allowed_origins=allowed_origins if allowed_origins is not None else [server],
        timeout_seconds=timeout_seconds,
        adapter="greenhouse",
        capture_evidence=False,
    )


class RecordingContext:
    """The narrow slice of TaskContext the observe handler touches."""

    def __init__(self, task_input: ObserveConfirmationInput) -> None:
        self.input = task_input.model_dump(mode="json")
        self.progress: list[tuple[str, int]] = []
        self.cancel = _NeverCancelled()

    def report_progress(self, stage: str, percent: int) -> None:
        self.progress.append((stage, percent))


class _NeverCancelled:
    def raise_if_cancelled(self) -> None:
        return None


# ---------------------------------------------------------------------------
# The confirmation it can read
# ---------------------------------------------------------------------------


class TestObservingAConfirmation:
    async def test_it_reads_the_confirmation_and_its_reference(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        context = RecordingContext(payload(server))
        handler = build_observe_handler(browser, DEVICE_ID, keep_page_open=False)
        result = await handler(context)

        assert result.outcome == "observed"
        assert result.unknown_reason is None
        assert result.confirmation is not None
        assert "has been submitted" in result.confirmation.confirmation_text
        # The reference is the thing the user would quote in a follow-up email.
        assert result.confirmation.reference == "NW-2026-4471"
        assert result.confirmation.url is not None
        assert result.adapter_version == "greenhouse/v1"

    async def test_it_takes_no_screenshot_without_consent(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        context = RecordingContext(payload(server))
        handler = build_observe_handler(browser, DEVICE_ID, keep_page_open=False)
        result = await handler(context)

        # `capture_evidence` is false, and a confirmation page carries the
        # applicant's own details back into storage.
        assert result.screenshot_file_id is None

    async def test_a_footer_thank_you_is_not_a_confirmation(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        """The decoy in the fixture must not be read as evidence.

        The confirmation page carries "Thank you for visiting our careers site"
        in its footer. It is matched by nothing, because the adapter only
        accepts an explicit statement and only from a heading or status region.
        """
        page = await browser.open(f"{server}/greenhouse-confirmation.html", (server,))
        adapter = GreenhouseAdapter()
        raw = await page.evaluate(adapter.confirmation_script)

        assert raw is not None
        assert "visiting our careers site" not in raw["confirmation_text"]
        await page.close()


# ---------------------------------------------------------------------------
# AT16: the watch that runs out
# ---------------------------------------------------------------------------


class TestTheObservationTimingOut:
    async def test_at16_a_page_that_never_confirms_reports_unknown(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        """The application form is still the application form: no confirmation.

        This is AT16. The run does not raise, does not fail the task, and does
        not conclude anything about the application; it reports that it looked
        and could not tell.
        """
        context = RecordingContext(
            payload(server, page="greenhouse-application.html", timeout_seconds=5)
        )
        handler = build_observe_handler(browser, DEVICE_ID, keep_page_open=False)
        result = await handler(context)

        assert result.outcome == "unknown"
        assert result.unknown_reason == "timed_out"
        assert result.confirmation is None
        # How long we waited is part of the answer the user gets.
        assert result.watched_seconds >= 4

    async def test_the_timeout_is_a_result_and_not_an_exception(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        """A raise would become a task failure, and a task failure reads to the
        user as "your application failed" — which is not what happened."""
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        result = await watch_for_confirmation(
            page,
            payload(server, page="greenhouse-application.html", timeout_seconds=5),
            adapter=GreenhouseAdapter(),
        )

        assert result.outcome == "unknown"
        assert result.unknown_reason == "timed_out"
        await page.close()

    async def test_a_page_with_no_tested_adapter_is_unsupported_not_unknown_prose(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        context = RecordingContext(
            payload(server, page="unsupported-application.html", timeout_seconds=5)
        )
        handler = build_observe_handler(browser, DEVICE_ID, keep_page_open=False)
        result = await handler(context)

        assert result.outcome == "unknown"
        # "Nobody looked" and "we looked and saw nothing" lead to different
        # advice, so they are different reasons.
        assert result.unknown_reason == "unsupported"
        assert result.confirmation is None

    async def test_a_task_for_another_device_is_declined_without_opening_anything(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        context = RecordingContext(payload(server, device_id=str(uuid4())))
        handler = build_observe_handler(browser, DEVICE_ID, keep_page_open=False)
        result = await handler(context)

        assert result.outcome == "unknown"
        assert result.unknown_reason == "runner_error"
        assert context.progress == []


# ---------------------------------------------------------------------------
# What it will not do
# ---------------------------------------------------------------------------


class TestWhatObservationNeverDoes:
    async def test_it_refuses_a_destination_outside_the_allowed_origins(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        context = RecordingContext(payload(server, allowed_origins=["https://elsewhere.invalid"]))
        handler = build_observe_handler(browser, DEVICE_ID, keep_page_open=False)
        result = await handler(context)

        assert result.outcome == "unknown"
        assert result.unknown_reason == "left_allowed_origin"
        assert result.confirmation is None

    async def test_it_leaves_the_form_untouched(self, browser: RunnerBrowser, server: str) -> None:
        """Observation reads. It does not type, and it does not click."""
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        before = await page.evaluate(
            "() => Array.from(document.querySelectorAll('input, textarea, select'))"
            ".map((node) => node.value).join('|')"
        )

        await watch_for_confirmation(
            page,
            payload(server, page="greenhouse-application.html", timeout_seconds=5),
            adapter=GreenhouseAdapter(),
        )

        after = await page.evaluate(
            "() => Array.from(document.querySelectorAll('input, textarea, select'))"
            ".map((node) => node.value).join('|')"
        )
        assert after == before
        await page.close()
