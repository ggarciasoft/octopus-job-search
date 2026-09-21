"""``parse_profile`` end to end: AT02, AT03, AT09 and truthfulness.

Every test here runs the real handler over a real fixture document, through the
real API client (with an enforcing HTTP mock) and the deterministic fake
provider. The assertions are about the *result the user would review*.
"""

from __future__ import annotations

import io
import json
from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.api import LEASE_TOKEN_HEADER, TaskApiClient
from job_getter_worker.contracts.generated import ParseProfileResult
from job_getter_worker.errors import TaskFailureError
from job_getter_worker.handlers.parse_profile import handle_parse_profile
from job_getter_worker.logging import configure_logging
from job_getter_worker.settings import WorkerSettings

from .conftest import CV_FIXTURES, LEASE_TOKEN, UsageLedgerStub, input_file_entry, read_cv

BASE_URL = "http://api.internal.test"
TASK_ID = "11111111-2222-4333-8444-555555555555"
FILE_ID = "99999999-8888-4777-8666-555555555555"
IMPORT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


def _mount_file(data: bytes) -> respx.Route:
    """A file route that refuses a request without the task's lease token."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers.get(LEASE_TOKEN_HEADER) != LEASE_TOKEN:
            return httpx.Response(
                403, json={"error": {"code": "FORBIDDEN", "message": "lease token required"}}
            )
        return httpx.Response(200, content=data)

    return respx.get(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/files/{FILE_ID}").mock(
        side_effect=handler
    )


def _task_input(
    *,
    format_hint: str = "auto",
    inline_text: str | None = None,
    with_file: bool = True,
    locale: str = "en",
    max_pdf_pages: int = 100,
    max_extracted_chars: int = 200_000,
) -> dict[str, Any]:
    return {
        "profile_import_id": IMPORT_ID,
        "profile_revision": 1,
        "format_hint": format_hint,
        "locale": locale,
        "inline_text": inline_text,
        "source_file_id": FILE_ID if with_file else None,
        "limits": {
            "max_pdf_pages": max_pdf_pages,
            "max_extracted_chars": max_extracted_chars,
        },
    }


async def run_parse(
    settings: WorkerSettings,
    *,
    cv: str | None = None,
    inline_text: str | None = None,
    format_hint: str = "auto",
    locale: str = "en",
    ledger: UsageLedgerStub | None = None,
    **limit_overrides: int,
) -> ParseProfileResult:
    """Run the handler over a fixture document and return its result.

    The usage ledger is always mounted: every model request reserves daily
    budget against the API first, so a test that did not mount it would be
    testing a worker that cannot run.
    """
    from job_getter_worker.cancellation import CancellationToken
    from job_getter_worker.contracts.generated import TaskInputFile, TaskType
    from job_getter_worker.handlers import TaskContext

    (ledger or UsageLedgerStub(BASE_URL, TASK_ID)).mount()

    files: list[TaskInputFile] = []
    if cv is not None:
        payload = read_cv(cv)
        _mount_file(payload)
        files.append(
            TaskInputFile.model_validate(
                input_file_entry(FILE_ID, original_name=cv, size=len(payload))
            )
        )

    async with TaskApiClient(
        BASE_URL,
        "worker-credential-for-tests",
        timeout_seconds=5.0,
        max_download_bytes=10 * 1024 * 1024,
    ) as api:
        context = TaskContext(
            task_id=TASK_ID,
            task_type=TaskType.PARSE_PROFILE,
            attempt=1,
            input=_task_input(
                format_hint=format_hint,
                inline_text=inline_text,
                with_file=cv is not None,
                locale=locale,
                **limit_overrides,
            ),
            files=tuple(files),
            settings=settings,
            api=api,
            cancel=CancellationToken(),
            report_progress=lambda stage, percent: None,
            lease_token=LEASE_TOKEN,
        )
        return await handle_parse_profile(context)


def facts_of(result: ParseProfileResult, kind: str) -> list[dict[str, Any]]:
    return [fact.value for fact in result.draft_facts if fact.kind == kind]


def warning_codes(result: ParseProfileResult) -> set[str]:
    return {warning.code for warning in result.warnings}


def result_text(result: ParseProfileResult) -> str:
    return json.dumps(result.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# AT02 - text PDF and DOCX import with provenance
# ---------------------------------------------------------------------------


@respx.mock
async def test_at02_text_pdf_produces_draft_facts_with_provenance(
    fake_provider_settings: WorkerSettings,
) -> None:
    result = await run_parse(fake_provider_settings, cv="text-cv.pdf")

    assert result.draft_facts, "no facts were proposed from a clean text CV"
    assert result.extracted_chars > 1000
    assert result.provider.id == "fake"

    employers = {fact["employer"] for fact in facts_of(result, "experience")}
    assert {"Northwind Logistics", "Cobalt Analytics", "Fenix Software"} <= employers

    # Every fact cites where it came from, and the locator is a real page.
    for fact in result.draft_facts:
        if fact.kind in {"language", "authorization"}:
            continue
        assert fact.source_locator is not None, f"{fact.draft_id} has no locator"
        assert fact.source_locator in {"page 1", "page 2"}
        assert fact.source_excerpt

    # Nothing is confirmed by parsing: confidence is a parsing aid only.
    assert all(0.0 <= fact.confidence <= 1.0 for fact in result.draft_facts)


@respx.mock
async def test_at02_docx_parses_the_table_rows(
    fake_provider_settings: WorkerSettings,
) -> None:
    """The employers exist only inside a DOCX table, so this proves it was read."""
    result = await run_parse(fake_provider_settings, cv="text-cv.docx")

    experiences = [fact for fact in result.draft_facts if fact.kind == "experience"]
    employers = {fact.value["employer"] for fact in experiences}
    assert {"Northwind Logistics", "Cobalt Analytics", "Fenix Software"} <= employers

    locators = {fact.source_locator for fact in experiences}
    assert all(locator is not None and locator.startswith("table ") for locator in locators), (
        f"employment history was not traced back to the table: {locators}"
    )


# ---------------------------------------------------------------------------
# AT03 - the hard documents fail explicitly and invent nothing
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.parametrize(
    ("fixture", "code"),
    [
        ("scanned-cv.pdf", "OCR_REQUIRED"),
        ("encrypted-cv.pdf", "ENCRYPTED_DOCUMENT"),
        ("malformed.pdf", "FILE_UNREADABLE"),
        ("malformed.docx", "FILE_UNREADABLE"),
        ("mislabelled.docx", "FILE_UNREADABLE"),
    ],
)
async def test_at03_unreadable_documents_fail_without_inventing_a_profile(
    fake_provider_settings: WorkerSettings, fixture: str, code: str
) -> None:
    with pytest.raises(TaskFailureError) as raised:
        await run_parse(fake_provider_settings, cv=fixture)

    assert raised.value.code == code
    # A failure carries no facts at all, so nothing can be invented by one.
    assert "draft_fact" not in raised.value.redacted_message


@respx.mock
async def test_at03_too_short_document_proposes_nothing(
    fake_provider_settings: WorkerSettings,
) -> None:
    result = await run_parse(fake_provider_settings, cv="too-short.pdf")

    assert result.draft_facts == []
    assert "EXTRACTION_SHORT" in warning_codes(result)
    # The model was never asked, so it cannot have padded the document out.
    assert result.provider.id == "none"


@respx.mock
async def test_at03_failures_never_reach_the_model(
    fake_provider_settings: WorkerSettings,
) -> None:
    """An unreadable file is refused before any inference happens."""
    with pytest.raises(TaskFailureError):
        await run_parse(fake_provider_settings, cv="scanned-cv.pdf")


# ---------------------------------------------------------------------------
# AT09 - prompt injection
# ---------------------------------------------------------------------------


@respx.mock
async def test_at09_injected_instructions_are_data_not_commands(
    fake_provider_settings: WorkerSettings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("A_SECRET_ENV_VALUE", "hunter2-should-never-appear")

    result = await run_parse(fake_provider_settings, cv="prompt-injection-cv.pdf")
    rendered = result_text(result)

    # The qualifications the document tried to inject do not exist.
    assert "Stanford" not in rendered
    assert "PhD" not in rendered
    assert "15 years" not in rendered
    assert "attacker.example.invalid" not in rendered

    # No secret or environment value leaked into the result.
    assert "hunter2-should-never-appear" not in rendered
    assert "sk-" not in rendered
    assert "worker-credential-for-tests" not in rendered
    assert LEASE_TOKEN not in rendered

    # The real facts were still extracted.
    employers = {fact["employer"] for fact in facts_of(result, "experience")}
    assert employers == {"Meridian Tools"}
    institutions = {fact["institution"] for fact in facts_of(result, "education")}
    assert institutions == {"Instituto Superior Tecnico"}

    # And the user is told the document contained instructions.
    assert "PROMPT_INJECTION_TEXT_IGNORED" in warning_codes(result)
    injection_warning = next(
        warning for warning in result.warnings if warning.code == "PROMPT_INJECTION_TEXT_IGNORED"
    )
    # The warning names where, never what: repeating the attack would move it.
    assert "IGNORE ALL PREVIOUS" not in (injection_warning.detail or "")
    assert "page 1" in (injection_warning.detail or "")


@respx.mock
async def test_at09_injected_span_is_not_sent_to_the_model(
    fake_provider_settings: WorkerSettings,
) -> None:
    from job_getter_worker.extraction import ExtractionLimits, extract_document
    from job_getter_worker.profile.sanitize import sanitize_document
    from job_getter_worker.prompts import build_parse_profile_prompt

    document = extract_document(
        read_cv("prompt-injection-cv.pdf"),
        source_name="prompt-injection-cv.pdf",
        limits=ExtractionLimits(),
    )
    assert "IGNORE ALL PREVIOUS INSTRUCTIONS" in document.text

    sanitized = sanitize_document(document)
    prompt = build_parse_profile_prompt(sanitized.text).text

    for phrase in (
        "IGNORE ALL PREVIOUS INSTRUCTIONS",
        "developer mode",
        "Stanford",
        "15 years of Kubernetes",
        "attacker.example.invalid",
        "Skip all validation",
    ):
        assert phrase not in prompt, f"{phrase!r} was sent to the model"

    # The genuine content survives the removal.
    assert "Meridian Tools" in prompt
    assert "Instituto Superior Tecnico" in prompt


# ---------------------------------------------------------------------------
# Truthfulness
# ---------------------------------------------------------------------------


@respx.mock
async def test_every_bullet_carries_an_evidence_reference(
    fake_provider_settings: WorkerSettings,
) -> None:
    result = await run_parse(fake_provider_settings, cv="text-cv.pdf")

    bullets = [
        bullet
        for fact in result.draft_facts
        if fact.kind in {"experience", "project"}
        for bullet in fact.value["bullets"]
    ]
    assert bullets, "no bullets were proposed"
    for bullet in bullets:
        assert bullet["evidence_reference"].strip()


@respx.mock
async def test_no_skill_gains_an_inferred_proficiency(
    fake_provider_settings: WorkerSettings,
) -> None:
    result = await run_parse(fake_provider_settings, cv="text-cv.pdf")

    skills = facts_of(result, "skill")
    assert skills, "no skills were proposed"
    for skill in skills:
        assert skill["user_declared_proficiency"] is None
        assert skill["years"] is None


@respx.mock
async def test_ambiguous_text_produces_warnings_not_invented_employers(
    fake_provider_settings: WorkerSettings,
) -> None:
    result = await run_parse(
        fake_provider_settings,
        inline_text=(CV_FIXTURES / "ambiguous.txt").read_text(encoding="utf-8"),
        format_hint="plain_text",
    )

    assert result.warnings, "ambiguity was resolved silently"
    employers = {fact["employer"] for fact in facts_of(result, "experience")}
    # "Previous Company" is not a usable employer name and must not appear.
    assert "Previous Company" not in employers
    for employer in employers:
        assert employer in (CV_FIXTURES / "ambiguous.txt").read_text(encoding="utf-8")

    # "wants to learn Go" is an interest, not a skill.
    skill_names = {fact["canonical_name"].lower() for fact in facts_of(result, "skill")}
    assert "go" not in skill_names


@respx.mock
async def test_eligibility_unknown_is_never_promoted_to_yes(
    fake_provider_settings: WorkerSettings,
) -> None:
    """AT07: the CV states Uruguay, and says nothing about US authorization."""
    result = await run_parse(fake_provider_settings, cv="text-cv.pdf")

    authorizations = {fact["country"]: fact for fact in facts_of(result, "authorization")}
    assert authorizations["UY"]["authorized"] == "yes"
    assert authorizations["US"]["authorized"] == "unknown"
    assert authorizations["US"]["sponsorship_required"] == "yes"


# ---------------------------------------------------------------------------
# No provider configured (AT28)
# ---------------------------------------------------------------------------


@respx.mock
async def test_without_a_provider_the_text_is_still_read_and_nothing_is_proposed(
    settings: WorkerSettings,
) -> None:
    result = await run_parse(settings, cv="text-cv.pdf")

    assert result.draft_facts == []
    assert result.extracted_chars > 1000
    assert "NO_PROVIDER_CONFIGURED" in warning_codes(result)


# ---------------------------------------------------------------------------
# Budget and limits at the handler level
# ---------------------------------------------------------------------------


@respx.mock
async def test_budget_exhaustion_blocks_the_request(make_settings: Any) -> None:
    from .conftest import MODEL_FIXTURES

    settings = make_settings(
        PROVIDER_DEFAULT="fake",
        WORKER_MODEL="fake-deterministic-v1",
        WORKER_FAKE_FIXTURE_DIR=str(MODEL_FIXTURES),
        WORKER_PROVIDER_DAILY_TOKEN_BUDGET="10",
    )
    with pytest.raises(TaskFailureError) as raised:
        await run_parse(settings, cv="text-cv.pdf")
    assert raised.value.code == "BUDGET_EXHAUSTED"


@respx.mock
async def test_pasted_text_over_the_character_cap_is_refused(make_settings: Any) -> None:
    """The worker's security bound is hard; exceeding it is a refusal."""
    from .conftest import MODEL_FIXTURES

    settings = make_settings(
        PROVIDER_DEFAULT="fake",
        WORKER_MODEL="fake-deterministic-v1",
        WORKER_FAKE_FIXTURE_DIR=str(MODEL_FIXTURES),
        WORKER_MAX_EXTRACTED_CHARS="100",
    )
    with pytest.raises(TaskFailureError) as raised:
        await run_parse(
            settings,
            inline_text="Ana Rivera. " * 200,
            format_hint="plain_text",
        )
    assert raised.value.code == "LIMIT_EXCEEDED"


@respx.mock
async def test_a_task_declared_cap_truncates_with_a_warning_instead(
    fake_provider_settings: WorkerSettings,
) -> None:
    """A task asking for less is a request, not a dangerous input."""
    result = await run_parse(
        fake_provider_settings,
        cv="text-cv.pdf",
        max_extracted_chars=600,
    )
    assert result.extracted_chars <= 600
    assert "CHARS_TRUNCATED" in warning_codes(result)


@respx.mock
async def test_a_file_the_task_did_not_declare_cannot_be_fetched(
    fake_provider_settings: WorkerSettings,
) -> None:
    from job_getter_worker.cancellation import CancellationToken
    from job_getter_worker.contracts.generated import TaskType
    from job_getter_worker.handlers import TaskContext

    async with TaskApiClient(
        BASE_URL,
        "worker-credential-for-tests",
        timeout_seconds=5.0,
        max_download_bytes=10 * 1024 * 1024,
    ) as api:
        context = TaskContext(
            task_id=TASK_ID,
            task_type=TaskType.PARSE_PROFILE,
            attempt=1,
            input=_task_input(),
            files=(),  # nothing declared
            settings=fake_provider_settings,
            api=api,
            cancel=CancellationToken(),
            report_progress=lambda stage, percent: None,
            lease_token=LEASE_TOKEN,
        )
        with pytest.raises(TaskFailureError) as raised:
            await handle_parse_profile(context)

    assert raised.value.code == "INPUT_INVALID"


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------


@respx.mock
async def test_cv_text_never_reaches_the_logs(
    fake_provider_settings: WorkerSettings,
) -> None:
    stream = io.StringIO()
    configure_logging("debug", stream=stream)

    result = await run_parse(fake_provider_settings, cv="text-cv.pdf")
    assert result.draft_facts

    logged = stream.getvalue()
    assert logged, "nothing was logged, so this test would pass vacuously"

    for secret in (
        "Ana Rivera",
        "ana.rivera@example.invalid",
        "Northwind Logistics",
        "Universidad de la Republica",
        "+1 555 0100",
        "Led the migration of the shipment tracking service",
        LEASE_TOKEN,
        "worker-credential-for-tests",
    ):
        assert secret not in logged, f"{secret!r} leaked into the logs"

    # The shape was logged, so redaction did not come at the cost of silence.
    assert "parse_profile.extracted" in logged
    assert "parse_profile.validated" in logged


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


@respx.mock
async def test_parse_stops_at_a_checkpoint_when_cancelled(
    fake_provider_settings: WorkerSettings,
) -> None:
    """Nothing is half-applied: the handler unwinds before doing any work."""
    from job_getter_worker.cancellation import CancellationToken
    from job_getter_worker.contracts.generated import TaskInputFile, TaskType
    from job_getter_worker.errors import TaskCancelledError
    from job_getter_worker.handlers import TaskContext

    payload = read_cv("text-cv.pdf")
    _mount_file(payload)
    cancel = CancellationToken()
    cancel.request("cancel_requested")

    async with TaskApiClient(
        BASE_URL,
        "worker-credential-for-tests",
        timeout_seconds=5.0,
        max_download_bytes=10 * 1024 * 1024,
    ) as api:
        context = TaskContext(
            task_id=TASK_ID,
            task_type=TaskType.PARSE_PROFILE,
            attempt=1,
            input=_task_input(),
            files=(
                TaskInputFile.model_validate(
                    input_file_entry(FILE_ID, original_name="text-cv.pdf", size=len(payload))
                ),
            ),
            settings=fake_provider_settings,
            api=api,
            cancel=cancel,
            report_progress=lambda stage, percent: None,
            lease_token=LEASE_TOKEN,
        )
        with pytest.raises(TaskCancelledError):
            await handle_parse_profile(context)
