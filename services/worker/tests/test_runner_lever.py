"""The Lever adapter and the fill driver, against a real browser.

The same arrangement as ``test_runner_greenhouse.py``: Chromium, driven by the
product's own :class:`RunnerBrowser`, against ``fixtures/ats-pages/lever-*.html``
served from 127.0.0.1. Nothing here reaches the internet and nothing is ever
submitted.

The Lever page is where a naive reader says something false, so most of these
tests are about what must *not* happen: a disability-form signature labelled
"Name" filled with the person's name, an autocomplete typed into as if a string
were a chosen place, the upload button's caption becoming part of a question.

The suite skips itself, loudly, when Playwright's Chromium is not installed.
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
from job_getter_worker.runner.adapters import ADAPTERS, GreenhouseAdapter, LeverAdapter
from job_getter_worker.runner.adapters.lever import VOLUNTARY_PREFIX
from job_getter_worker.runner.browser import BrowserOptions, BrowserUnavailableError, RunnerBrowser
from job_getter_worker.runner.fill import FillContext, choose_adapter, inspect_page, run_fill
from job_getter_worker.runner.forms import FieldKind

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "ats-pages"

COMPANY = "Orbital Foods"
TITLE = "Platform Engineer"

CARD = "cards\\[5e7c0a1b-0000-4000-8000-00000000c0de\\]"


@pytest.fixture(scope="module")
def server() -> Iterator[str]:
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
    page: str = "lever-application.html",
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
            connector="lever",
            connector_version="lever/v1",
        ),
        allowed_origins=[server],
        job=FillJobIdentity(job_id=str(uuid4()), company=company, title=title),
        resume_file_id=None,
        resume_sha256=None,
        resume_filename=None,
        fields=fields if fields is not None else [],
        known_form_fingerprint=None,
        adapter="lever",
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
        one("full_name", "Ada Lovelace"),
        one("email", "ada@example.invalid"),
        one("phone", "+34 600 000 000", "sensitive"),
        one("linkedin_url", "https://www.linkedin.example/in/ada"),
        one("why_do_you_want_to_work_at_orbital_foods", "The logistics problems are real ones."),
        one("are_you_legally_authorized_to_work_in_spain", "Yes", "sensitive"),
        one("which_of_these_have_you_worked_with", ["Python", "Rust"]),
        one("notice_period", "30 days", "sensitive"),
        one("current_location", "Madrid, Spain"),
        # Deliberately present, and deliberately not used. Each has a key the
        # page really produces; each is on a question the person answers.
        one("pronouns", ["She/her"], "never_reuse"),
        one("voluntary_self_identification_gender", "Female", "never_reuse"),
        one("voluntary_self_identification_name", "Ada Lovelace", "never_reuse"),
        one("voluntary_self_identification_what_is_your_age_range", "30 or older", "never_reuse"),
    ]


def cv(tmp_path: Path) -> Path:
    path = tmp_path / "ada-cv.pdf"
    path.write_bytes(b"%PDF-1.4\n%%EOF\n")
    return path


# ---------------------------------------------------------------------------
# Adapter selection
# ---------------------------------------------------------------------------


class TestAdapterSelection:
    async def test_it_claims_a_lever_shaped_page(self, browser: RunnerBrowser, server: str) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        adapter = await choose_adapter(page, page.url, "lever")
        assert adapter is not None
        assert adapter.version == "lever/v1"

    async def test_a_greenhouse_hint_does_not_make_greenhouse_claim_it(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        # Lever's form is `#application-form`, which Greenhouse's container
        # selector also matches. A stale or wrong hint must not route a Lever
        # page through the Greenhouse reader.
        page = await browser.open(f"{server}/lever-application.html", (server,))
        adapter = await choose_adapter(page, page.url, "greenhouse")
        assert adapter is not None
        assert adapter.name == "lever"

    @pytest.mark.parametrize(
        ("name", "owner"),
        [
            ("greenhouse-application.html", "greenhouse"),
            ("greenhouse-application-changed.html", "greenhouse"),
            ("greenhouse-confirmation.html", "greenhouse"),
            ("lever-application.html", "lever"),
            ("lever-application-changed.html", "lever"),
            ("unsupported-application.html", None),
        ],
    )
    async def test_every_fixture_is_claimed_by_at_most_one_adapter(
        self, browser: RunnerBrowser, server: str, name: str, owner: str | None
    ) -> None:
        page = await browser.open(f"{server}/{name}", (server,))
        claimed = [
            adapter.name
            for adapter in ADAPTERS
            if adapter.handles(page.url, bool(await page.evaluate(adapter.marker_script)))
        ]
        assert claimed == ([owner] if owner else [])

    def test_lever_hosts_are_lever_s_even_before_the_page_is_read(self) -> None:
        url = "https://jobs.lever.co/orbital-foods/6f2c1a3e-1111-4a2b-9c3d-000000000001/apply"
        assert LeverAdapter().handles(url, False)
        assert LeverAdapter().handles(url.replace("jobs.", "jobs.eu."), False)
        # Even if a Lever page matched Greenhouse's container selector.
        assert not GreenhouseAdapter().handles(url, True)


# ---------------------------------------------------------------------------
# Inspection
# ---------------------------------------------------------------------------


class TestInspection:
    async def test_it_reads_the_form_as_the_planner_needs_it(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        schema = await inspect_page(page, LeverAdapter())
        by_key = {item.key: item for item in schema.fields}

        assert by_key["full_name"].kind is FieldKind.TEXT
        assert by_key["full_name"].required is True
        assert by_key["email"].kind is FieldKind.EMAIL
        assert by_key["current_company"].required is False
        assert by_key["linkedin_url"].kind is FieldKind.TEXT

        auth = by_key["are_you_legally_authorized_to_work_in_spain"]
        assert auth.kind is FieldKind.RADIO
        assert auth.required is True
        assert auth.options == ("Yes", "No", "Yes, with sponsorship")

        stack = by_key["which_of_these_have_you_worked_with"]
        assert stack.kind is FieldKind.CHECKBOX
        # The survey's "Select all that apply" is a description, not the question.
        assert stack.label == "Which of these have you worked with?"
        assert stack.options == ("Python", "Go", "Rust")

        notice = by_key["notice_period"]
        assert notice.kind is FieldKind.SELECT
        assert notice.options == ("Immediately", "2 weeks", "30 days", "90 days")

    async def test_a_question_marked_only_by_the_asterisk_is_required(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        # No `required` attribute on either: the U+2731 span is all there is.
        page = await browser.open(f"{server}/lever-application.html", (server,))
        schema = await inspect_page(page, LeverAdapter())
        by_key = {item.key: item for item in schema.fields}
        assert by_key["why_do_you_want_to_work_at_orbital_foods"].required is True
        assert by_key["resume_cv"].required is True
        assert by_key["resume_cv"].kind is FieldKind.FILE

    async def test_the_upload_captions_are_not_part_of_the_question(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        schema = await inspect_page(page, LeverAdapter())
        resume = next(item for item in schema.fields if item.kind is FieldKind.FILE)
        assert resume.label == "Resume/CV"

    async def test_pronouns_are_one_question_not_three(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        # The nameless "Custom" checkbox is never submitted, and the hidden text
        # box shares the group's name. Neither is a question of its own.
        page = await browser.open(f"{server}/lever-application.html", (server,))
        schema = await inspect_page(page, LeverAdapter())
        pronouns = [item for item in schema.fields if "pronoun" in item.key]
        assert [(item.key, item.kind) for item in pronouns] == [("pronouns", FieldKind.CHECKBOX)]
        assert pronouns[0].options == ("He/him", "She/her", "They/them")
        assert all(item.key for item in schema.fields), "no field went unnamed"

    async def test_the_location_autocomplete_is_named_and_marked_undriveable(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        schema = await inspect_page(page, LeverAdapter())
        location = next(item for item in schema.fields if item.key == "current_location")
        assert location.kind is FieldKind.UNSUPPORTED

    async def test_every_voluntary_question_is_labelled_as_one(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        schema = await inspect_page(page, LeverAdapter())
        voluntary = [item for item in schema.fields if item.label.startswith(VOLUNTARY_PREFIX)]
        # Exactly the EEO section and the survey: the six after "Additional information".
        assert [item.key for item in schema.fields[-6:]] == [item.key for item in voluntary]
        assert [item.label for item in voluntary] == [
            "Voluntary self-identification: Gender",
            "Voluntary self-identification: Race",
            "Voluntary self-identification: Disability status",
            "Voluntary self-identification: Name",
            "Voluntary self-identification: Date",
            "Voluntary self-identification: What is your age range?",
        ]
        race = next(item for item in voluntary if item.label.endswith("Race"))
        # The option descriptions inside each label are not the option's name.
        assert race.options == ("Group A", "Group B", "Decline to self-identify")

    async def test_nothing_hidden_and_no_button_is_a_field(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        schema = await inspect_page(page, LeverAdapter())
        keys = {item.key for item in schema.fields}
        assert not keys & {"accountid", "origin", "h_captcha_response", "selectedlocation"}
        assert all("submit" not in key for key in keys)
        assert len(schema.fields) == 21

    async def test_a_changed_form_has_a_different_fingerprint(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        adapter = LeverAdapter()
        first = await browser.open(f"{server}/lever-application.html", (server,))
        second = await browser.open(f"{server}/lever-application-changed.html", (server,))
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
        page = await browser.open(f"{server}/lever-application.html", (server,))
        context = FillContext(
            payload=payload(server, fields=answers()), attachment=cv(tmp_path), device_id=""
        )

        result = await run_fill(page, context)

        assert await page.input_value('input[name="name"]') == "Ada Lovelace"
        assert await page.input_value('input[name="email"]') == "ada@example.invalid"
        assert await page.input_value('input[name="urls\\[LinkedIn\\]"]') == (
            "https://www.linkedin.example/in/ada"
        )
        assert await page.input_value(f'textarea[name="{CARD}\\[field0\\]"]') == (
            "The logistics problems are real ones."
        )
        assert await page.is_checked(f'input[name="{CARD}\\[field1\\]"][value="Yes"]')
        assert await page.is_checked(f'input[name="{CARD}\\[field2\\]"][value="Python"]')
        assert await page.is_checked(f'input[name="{CARD}\\[field2\\]"][value="Rust"]')
        assert not await page.is_checked(f'input[name="{CARD}\\[field2\\]"][value="Go"]')
        assert await page.input_value(f'select[name="{CARD}\\[field3\\]"]') == "30 days"
        names = await page.evaluate(
            "() => Array.from(document.querySelector('#resume-upload-input').files)"
            ".map((f) => f.name)"
        )
        assert names == ["ada-cv.pdf"]
        assert result.adapter == "lever"
        assert result.adapter_version == "lever/v1"
        # The page never navigated: nothing was submitted.
        assert page.url.endswith("lever-application.html")

    async def test_it_leaves_every_voluntary_question_to_the_person(
        self, browser: RunnerBrowser, server: str, tmp_path: Path
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        context = FillContext(
            payload=payload(server, fields=answers()), attachment=cv(tmp_path), device_id=""
        )

        result = await run_fill(page, context)

        # The packet carried an answer for each of these, under the exact key
        # the page produces, and none was used.
        assert await page.input_value('input[name="eeo\\[disabilitySignature\\]"]') == ""
        assert await page.input_value('select[name="eeo\\[gender\\]"]') == ""
        assert not await page.is_checked('input[name="pronouns"][value="She/her"]')
        reasons = {item.question_key: item.reason for item in result.unresolved_fields}
        for key in (
            "pronouns",
            "voluntary_self_identification_gender",
            "voluntary_self_identification_race",
            "voluntary_self_identification_disability_status",
            "voluntary_self_identification_name",
            "voluntary_self_identification_date",
            "voluntary_self_identification_what_is_your_age_range",
        ):
            assert reasons[key] == "never_inferable", key

    async def test_the_location_is_left_for_the_person(
        self, browser: RunnerBrowser, server: str, tmp_path: Path
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        context = FillContext(
            payload=payload(server, fields=answers()), attachment=cv(tmp_path), device_id=""
        )

        result = await run_fill(page, context)

        assert await page.input_value("#location-input") == ""
        reasons = {item.question_key: item.reason for item in result.unresolved_fields}
        assert reasons["current_location"] == "unsupported_widget"

    async def test_an_unanswered_required_question_pauses_the_run(
        self, browser: RunnerBrowser, server: str, tmp_path: Path
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        context = FillContext(
            payload=payload(server, fields=answers()), attachment=cv(tmp_path), device_id=""
        )

        result = await run_fill(page, context)

        assert result.outcome == "needs_input"
        assert await page.input_value(f'input[name="{CARD}\\[field4\\]"]') == ""
        keys = {item.question_key for item in result.unresolved_fields}
        assert "internal_referral_code" in keys

    async def test_it_refuses_a_page_that_is_not_the_job(
        self, browser: RunnerBrowser, server: str
    ) -> None:
        page = await browser.open(f"{server}/lever-application.html", (server,))
        context = FillContext(
            payload=payload(server, company="Somebody Else Ltd", title="Chef", fields=answers()),
            attachment=None,
            device_id="",
        )
        with pytest.raises(TaskFailureError) as raised:
            await run_fill(page, context)
        assert raised.value.code == "INPUT_INVALID"
        assert await page.input_value('input[name="name"]') == ""
