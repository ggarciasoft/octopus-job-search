"""The Greenhouse adapter and the fill driver, against a real browser.

``docs/spec/11_TESTING_ACCEPTANCE.md`` asks for "browser tests against local
synthetic ATS forms with no external submissions", and that is exactly what
this is: Chromium, driven by the product's own :class:`RunnerBrowser`, against
``fixtures/ats-pages/*.html`` served from 127.0.0.1. Nothing here reaches the
internet and nothing is ever submitted - the driver has no code path that
clicks a submit control, and the assertions below check the page's state
afterwards rather than any response to one.

The suite skips itself, loudly, when Playwright's Chromium is not installed.
A skipped browser test must never read as a passing one.
"""

from __future__ import annotations

import http.server
import threading
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from uuid import uuid4

import pytest

from job_getter_worker.contracts.generated import (
    FillField,
    FillJobIdentity,
    FillLocalInput,
    PacketDestination,
)
from job_getter_worker.errors import TaskFailureError
from job_getter_worker.runner.adapters import GreenhouseAdapter
from job_getter_worker.runner.browser import (
    BrowserOptions,
    BrowserUnavailableError,
    NavigationBlockedError,
    RunnerBrowser,
)
from job_getter_worker.runner.fill import (
    FillContext,
    choose_adapter,
    inspect_page,
    run_fill,
)
from job_getter_worker.runner.forms import FieldKind

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "ats-pages"

COMPANY = "Northwind Robotics"
TITLE = "Senior Platform Engineer"


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
    page: str = "greenhouse-application.html",
    company: str = COMPANY,
    title: str = TITLE,
    fields: list[FillField] | None = None,
) -> FillLocalInput:
    return FillLocalInput(
        application_id=str(uuid4()),
        packet_id=str(uuid4()),
        content_hash="a" * 64,
        device_id=str(uuid4()),
        destination=PacketDestination(
            url=f"{server}/{page}",
            origin=server,
            connector="greenhouse",
            connector_version="greenhouse/v1",
        ),
        allowed_origins=[server],
        job=FillJobIdentity(job_id=str(uuid4()), company=company, title=title),
        resume_file_id=None,
        resume_sha256=None,
        resume_filename=None,
        fields=fields if fields is not None else [],
        known_form_fingerprint=None,
        adapter="greenhouse",
    )


def answers() -> list[FillField]:
    def one(key: str, value: object, sensitivity: str = "standard") -> FillField:
        return FillField(
            question_key=key,
            label=key,
            answer=value,  # type: ignore[arg-type]
            required=True,
            sensitivity=sensitivity,  # type: ignore[arg-type]
        )

    return [
        one("first_name", "Ada"),
        one("last_name", "Lovelace"),
        one("email", "ada@example.invalid"),
        one("phone", "+34 600 000 000", "sensitive"),
        one("why_do_you_want_this_role", "The platform work is the interesting part."),
        one("notice_period", "30 days", "sensitive"),
        one("are_you_legally_authorised_to_work_in_spain", "Yes", "sensitive"),
        one("which_of_these_have_you_worked_with", ["Python", "Rust"]),
        # Deliberately present, and deliberately not used: the form's Gender
        # question is classified never_reuse and must be left to the person.
        one("gender", "Decline to self-identify", "never_reuse"),
    ]


# ---------------------------------------------------------------------------
# Adapter selection and inspection
# ---------------------------------------------------------------------------


class TestAdapterSelection:
    async def test_it_claims_a_greenhouse_shaped_page(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        adapter = await choose_adapter(page, page.url, "greenhouse")
        assert adapter is not None
        assert adapter.version == "greenhouse/v1"

    async def test_it_does_not_claim_a_page_it_has_never_been_tested_against(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/unsupported-application.html", (server,))
        assert await choose_adapter(page, page.url, "greenhouse") is None


class TestInspection:
    async def test_it_reads_the_form_as_the_planner_needs_it(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        schema = await inspect_page(page, GreenhouseAdapter())
        by_key = {item.key: item for item in schema.fields}

        assert by_key["first_name"].kind is FieldKind.TEXT
        assert by_key["first_name"].required is True
        assert by_key["email"].kind is FieldKind.EMAIL
        assert by_key["phone"].required is False
        assert by_key["resume_cv"].kind is FieldKind.FILE
        assert by_key["why_do_you_want_this_role"].kind is FieldKind.TEXTAREA

        notice = by_key["notice_period"]
        assert notice.kind is FieldKind.SELECT
        # The blank "Please select" is not an option anyone chose.
        assert notice.options == ("Immediately", "2 weeks", "30 days", "90 days")
        assert notice.option_values == ("immediate", "2w", "30d", "90d")

        auth = by_key["are_you_legally_authorised_to_work_in_spain"]
        assert auth.kind is FieldKind.RADIO
        assert auth.required is True
        assert auth.options == ("Yes", "No", "Yes, with sponsorship")

        stack = by_key["which_of_these_have_you_worked_with"]
        assert stack.kind is FieldKind.CHECKBOX
        assert stack.options == ("Python", "Go", "Rust")

    async def test_the_submit_button_is_not_a_field(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        schema = await inspect_page(page, GreenhouseAdapter())
        assert all("submit" not in item.key for item in schema.fields)

    async def test_a_custom_widget_is_named_and_marked_undriveable(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        schema = await inspect_page(page, GreenhouseAdapter())
        location = next(item for item in schema.fields if item.key == "current_location")
        assert location.kind is FieldKind.UNSUPPORTED

    async def test_two_controls_with_one_key_do_not_silently_merge(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        schema = await inspect_page(page, GreenhouseAdapter())
        # "Portfolio URL" and "Portfolio url" normalise alike; the second is
        # reported as unnameable rather than overwriting the first.
        portfolios = [item for item in schema.fields if item.label.lower() == "portfolio url"]
        assert len(portfolios) == 2
        assert portfolios[0].key == "portfolio_url"
        assert portfolios[1].key == ""

    async def test_a_changed_form_has_a_different_fingerprint(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        adapter = GreenhouseAdapter()
        first = await browser.open(f"{server}/greenhouse-application.html", (server,))
        second = await browser.open(f"{server}/greenhouse-application-changed.html", (server,))
        before = (await inspect_page(first, adapter)).fingerprint
        after = (await inspect_page(second, adapter)).fingerprint
        assert before != after


# ---------------------------------------------------------------------------
# Filling
# ---------------------------------------------------------------------------


class TestFilling:
    async def test_it_types_the_answers_and_stops_before_submitting(
        self, browser: RunnerBrowser, server: str, tmp_path: Path
    ) -> None:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4\n%%EOF\n")
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        context = FillContext(
            payload=payload(server, fields=answers()), attachment=cv, device_id=""
        )

        result = await run_fill(page, context)

        assert await page.input_value("#first_name") == "Ada"
        assert await page.input_value("#email") == "ada@example.invalid"
        assert await page.input_value("#notice_period") == "30d"
        assert await page.is_checked("#work_auth_yes")
        assert await page.is_checked("#stack_python")
        assert await page.is_checked("#stack_rust")
        assert not await page.is_checked("#stack_go")
        assert result.adapter_version == "greenhouse/v1"
        # The page never navigated: nothing was submitted.
        assert page.url.endswith("greenhouse-application.html")

    async def test_it_leaves_the_demographic_question_to_the_person(
        self, browser: RunnerBrowser, server: str, tmp_path: Path
    ) -> None:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4\n%%EOF\n")
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        context = FillContext(
            payload=payload(server, fields=answers()), attachment=cv, device_id=""
        )

        result = await run_fill(page, context)

        assert await page.input_value("#gender") == ""
        reasons = {item.question_key: item.reason for item in result.unresolved_fields}
        assert reasons["gender"] == "never_inferable"

    async def test_an_unanswered_required_question_pauses_the_run(
        self, browser: RunnerBrowser, server: str, tmp_path: Path
    ) -> None:
        cv = tmp_path / "cv.pdf"
        cv.write_bytes(b"%PDF-1.4\n%%EOF\n")
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        context = FillContext(
            payload=payload(server, fields=answers()), attachment=cv, device_id=""
        )

        result = await run_fill(page, context)

        # AT14. The referral code is required, nothing in the packet answers it,
        # and the field is still empty.
        assert result.outcome == "needs_input"
        assert await page.input_value("#reference_code") == ""
        keys = {item.question_key for item in result.unresolved_fields}
        assert "internal_referral_code" in keys

    async def test_it_attaches_the_cv(
        self, browser: RunnerBrowser, server: str, tmp_path: Path
    ) -> None:
        cv = tmp_path / "ada-cv.pdf"
        cv.write_bytes(b"%PDF-1.4\n%%EOF\n")
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        await run_fill(
            page,
            FillContext(payload=payload(server, fields=answers()), attachment=cv, device_id=""),
        )
        names = await page.evaluate(
            "() => Array.from(document.querySelector('#resume').files).map((f) => f.name)"
        )
        assert names == ["ada-cv.pdf"]

    async def test_an_unsupported_page_is_reported_and_left_alone(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/unsupported-application.html", (server,))
        result = await run_fill(
            page,
            FillContext(
                payload=payload(
                    server,
                    page="unsupported-application.html",
                    company="Ridgeline Analytics",
                    title="Data Engineer",
                    fields=answers(),
                ),
                attachment=None,
                device_id="",
            ),
        )

        # AT17: honest fallback. Nothing typed, packet kept, no adapter claimed.
        assert result.outcome == "unsupported"
        assert result.filled_fields == []
        assert result.adapter is None
        assert await page.input_value("#name") == ""

    async def test_it_refuses_a_page_that_is_not_the_job(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/greenhouse-application.html", (server,))
        context = FillContext(
            payload=payload(server, company="Somebody Else Ltd", title="Chef", fields=answers()),
            attachment=None,
            device_id="",
        )
        with pytest.raises(TaskFailureError) as raised:
            await run_fill(page, context)
        assert raised.value.code == "INPUT_INVALID"
        # Nothing was typed before the check.
        assert await page.input_value("#first_name") == ""


class TestOriginFence:
    async def test_it_will_not_open_a_page_outside_the_allowed_origins(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        with pytest.raises(NavigationBlockedError):
            await browser.open(
                f"{server}/greenhouse-application.html", ("https://example.invalid",)
            )
