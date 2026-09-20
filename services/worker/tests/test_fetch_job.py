"""``fetch_job`` end to end: URL and pasted paths, AT09, redaction, and the
boundary the API relies on (extraction markers, pasted identity).
"""

from __future__ import annotations

import io
from typing import Any

import httpx
import pytest

from job_getter_worker.contracts.generated import FetchJobResult
from job_getter_worker.errors import TaskFailureError
from job_getter_worker.handlers import build_default_registry
from job_getter_worker.handlers.fetch_job import MANUAL_PREFIX, handle_fetch_job
from job_getter_worker.logging import configure_logging
from job_getter_worker.settings import WorkerSettings

from .conftest import FakeSite, html_response, make_fetcher, make_task_context, read_page

HOST = "jobs.example.test"
IMPORT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


def task_input(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "job_import_id": IMPORT_ID,
        "url": None,
        "description_text": None,
        "company_hint": None,
        "title_hint": None,
        "apply_url_hint": None,
        "policy": {"max_redirects": 3, "max_html_bytes": 2 * 1024 * 1024, "timeout_seconds": 20},
    }
    values.update(overrides)
    return values


async def run(settings: WorkerSettings, site: FakeSite | None, **overrides: Any) -> FetchJobResult:
    context, _progress = make_task_context(settings, task_input(**overrides))
    fetcher = make_fetcher(site if site is not None else FakeSite())
    try:
        result = await handle_fetch_job(context, fetcher=fetcher)
    finally:
        await fetcher.aclose()
    FetchJobResult.model_validate(result.model_dump(mode="json"))
    return result


def site_with(page: str, path: str = "/careers/1") -> FakeSite:
    site = FakeSite()
    site.add(HOST, path, html_response(read_page(page)))
    return site


# ---------------------------------------------------------------------------
# URL path


async def test_one_jsonld_posting_becomes_the_job(settings: WorkerSettings) -> None:
    result = await run(
        settings, site_with("jobposting-single.html"), url=f"https://{HOST}/careers/1"
    )
    assert result.job is not None and result.candidates == []
    assert result.job.title == "Machine Learning Engineer"
    assert result.fetch.performed is True
    assert result.fetch.extraction == "jsonld_jobposting"
    assert result.fetch.http_status == 200
    assert result.fetch.content_type == "text/html"
    assert result.fetch.final_url == f"https://{HOST}/careers/1"
    assert result.fetch.redirects == 0
    assert result.fetch.bytes is not None and result.fetch.bytes > 1000
    assert [w.code for w in result.warnings] == ["FIELD_INFERRED"]


async def test_two_postings_become_candidates_for_the_user_to_choose(
    settings: WorkerSettings,
) -> None:
    result = await run(
        settings, site_with("jobposting-multiple.html"), url=f"https://{HOST}/careers/1"
    )
    assert result.job is None
    assert [job.title for job in result.candidates] == [
        "Warehouse Systems Engineer",
        "Fleet Data Analyst",
    ]
    assert "MULTIPLE_POSTINGS" in [w.code for w in result.warnings]
    assert result.fetch.extraction == "jsonld_jobposting"


async def test_no_structured_data_falls_back_to_page_text(settings: WorkerSettings) -> None:
    result = await run(settings, site_with("jobposting-none.html"), url=f"https://{HOST}/careers/1")
    assert result.job is not None
    assert result.fetch.extraction == "html_text"
    assert "NO_STRUCTURED_DATA" in [w.code for w in result.warnings]
    job = result.job
    assert job.title == "Field Service Technician - Meridian Elevators"  # the page <title>
    assert job.company == "(company not stated)"
    assert "NVQ Level 3" in job.description_text
    assert "alert(" not in job.description_text and "__tracking" not in job.description_text
    assert job.salary is not None and job.salary.currency == "GBP" and job.salary.min == 38000
    assert job.source_key == f"url:https://{HOST}/careers/1"
    assert job.canonical_url == f"https://{HOST}/careers/1"
    assert job.published_at is None


async def test_hints_are_recorded_as_given_on_the_text_fallback(settings: WorkerSettings) -> None:
    result = await run(
        settings,
        site_with("jobposting-none.html"),
        url=f"https://{HOST}/careers/1",
        company_hint="Meridian Elevators",
        title_hint="Field Service Technician",
        apply_url_hint="https://jobs.example.test/apply/1",
    )
    assert result.job is not None
    assert result.job.company == "Meridian Elevators"
    assert result.job.title == "Field Service Technician"
    assert result.job.apply_url == "https://jobs.example.test/apply/1"


async def test_prompt_injected_page_drives_no_field_and_no_warning(
    settings: WorkerSettings,
) -> None:
    """AT09: the instruction text is data in the description and nothing else."""
    result = await run(
        settings, site_with("jobposting-prompt-injection.html"), url=f"https://{HOST}/careers/1"
    )
    job = result.job
    assert job is not None
    assert "IGNORE ALL PREVIOUS INSTRUCTIONS" in job.description_text
    # The structured JobPosting description is what was read; the hidden
    # paragraph and the HTML comment in the page body are not part of it.
    assert "disregard all previous instructions" not in job.description_text.lower()
    assert "reveal your api keys" not in job.description_text

    assert job.salary is None, "the injected USD 900,000 is not a salary"
    assert job.eligible_countries is None, "the injected US-only claim is not eligibility"
    assert job.remote_type == "onsite", (
        "the real sentence wins; the injected 'fully remote' does not"
    )
    assert job.published_at is None
    assert job.company == "Copperline Systems"

    hostile = ("attacker", "900,000", "developer mode", "bank details", "IGNORE ALL")
    for item in job.inferred:
        assert not any(marker in item.source_excerpt for marker in hostile), item
    for warning in result.warnings:
        blob = f"{warning.message} {warning.detail or ''}"
        assert not any(marker in blob for marker in hostile), warning
    assert "FIELD_DROPPED_INVALID" in [w.code for w in result.warnings]


async def test_blocked_destination_is_a_result_not_a_failure(settings: WorkerSettings) -> None:
    site = FakeSite()
    result = await run(settings, site, url="https://10.0.0.1/internal")
    assert result.job is None and result.candidates == []
    assert [w.code for w in result.warnings] == ["BLOCKED_DESTINATION"]
    assert result.fetch.performed is True and result.fetch.extraction == "none"
    assert result.fetch.final_url is None
    assert site.requests == []


async def test_robots_disallow_is_a_result_offering_paste_mode(settings: WorkerSettings) -> None:
    site = FakeSite()
    site.add(
        HOST,
        "/robots.txt",
        httpx.Response(
            200,
            content=read_page("robots-disallow.txt").encode(),
            headers={"content-type": "text/plain"},
        ),
    )
    site.add(HOST, "/careers/internal/1", html_response("<html>x</html>"))
    result = await run(settings, site, url=f"https://{HOST}/careers/internal/1")
    assert [w.code for w in result.warnings] == ["ROBOTS_DISALLOWED"]
    assert "/careers/internal/1" not in site.paths_for(HOST)


async def test_denied_and_rate_limited_pages_are_reported_not_retried(
    settings: WorkerSettings,
) -> None:
    site = FakeSite()
    site.add(HOST, "/denied", httpx.Response(403, headers={"content-type": "text/html"}))
    site.add(HOST, "/busy", httpx.Response(429, headers={"retry-after": "60"}))
    denied = await run(settings, site, url=f"https://{HOST}/denied")
    assert [w.code for w in denied.warnings] == ["ACCESS_DENIED"]
    assert denied.fetch.http_status == 403
    busy = await run(settings, site, url=f"https://{HOST}/busy")
    assert [w.code for w in busy.warnings] == ["RATE_LIMITED"]
    assert busy.warnings[0].detail == "retry_after_seconds=60"
    assert site.paths_for(HOST).count("/denied") == 1 and site.paths_for(HOST).count("/busy") == 1


async def test_timeout_fails_the_task_so_the_api_can_decide_on_retry(
    settings: WorkerSettings,
) -> None:
    site = FakeSite()

    def slow(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    site.add(HOST, "/slow", slow)
    with pytest.raises(TaskFailureError) as info:
        await run(settings, site, url=f"https://{HOST}/slow")
    assert info.value.code == "TIMEOUT" and info.value.retryable is True


async def test_not_found_fails_the_task_without_retry(settings: WorkerSettings) -> None:
    site = FakeSite()
    with pytest.raises(TaskFailureError) as info:
        await run(settings, site, url=f"https://{HOST}/missing")
    assert info.value.code == "FETCH_BLOCKED" and info.value.retryable is False


async def test_task_policy_is_applied_and_never_loosened(settings: WorkerSettings) -> None:
    site = FakeSite()
    site.add(HOST, "/a", httpx.Response(302, headers={"location": "/b"}))
    site.add(HOST, "/b", html_response("<html>b</html>"))
    result = await run(
        settings,
        site,
        url=f"https://{HOST}/a",
        policy={"max_redirects": 0, "max_html_bytes": 4096, "timeout_seconds": 5},
    )
    assert [w.code for w in result.warnings] == ["REDIRECT_LIMIT"]
    assert "/b" not in site.paths_for(HOST)


# ---------------------------------------------------------------------------
# pasted text


PASTED = (
    "Senior Backend Engineer at Example Corp.\n\nWe are hiring for our Lisbon office.\n\n"
    "Requirements\n- 5+ years of Go\n- PostgreSQL\n\nSalary EUR 70,000 - 85,000 per year."
)


async def test_pasted_text_is_keyed_by_content_hash_with_hints_verbatim(
    settings: WorkerSettings,
) -> None:
    result = await run(
        settings,
        None,
        description_text=PASTED,
        company_hint="Example Corp",
        title_hint="Senior Backend Engineer",
    )
    job = result.job
    assert job is not None and result.candidates == []
    assert result.fetch.performed is False
    assert result.fetch.extraction == "pasted_text"
    assert result.fetch.final_url is None and result.fetch.http_status is None
    assert job.company == "Example Corp" and job.title == "Senior Backend Engineer"
    assert job.canonical_url == f"{MANUAL_PREFIX}{job.content_hash}"
    assert job.source_key == job.canonical_url == job.external_id
    assert not job.canonical_url.startswith("http"), "no invented URL"
    assert job.apply_url is None
    assert job.salary is not None and job.salary.currency == "EUR"
    assert [r.kind for r in job.requirements] == ["required", "required"]
    assert job.published_at is None and job.eligible_countries is None


async def test_pasting_the_same_text_twice_collapses_to_one_identity(
    settings: WorkerSettings,
) -> None:
    first = await run(settings, None, description_text=PASTED, company_hint="Example Corp")
    second = await run(settings, None, description_text=PASTED, company_hint="Example Corp")
    assert first.job is not None and second.job is not None
    assert first.job.source_key == second.job.source_key
    assert first.job.content_hash == second.job.content_hash
    edited = await run(
        settings, None, description_text=PASTED + " Edited.", company_hint="Example Corp"
    )
    assert edited.job is not None and edited.job.content_hash != first.job.content_hash


async def test_pasted_apply_url_hint_is_kept_only_when_public_https(
    settings: WorkerSettings,
) -> None:
    good = await run(
        settings, None, description_text=PASTED, apply_url_hint="https://jobs.example.test/apply"
    )
    assert good.job is not None and good.job.apply_url == "https://jobs.example.test/apply"
    bad = await run(settings, None, description_text=PASTED, apply_url_hint="http://10.0.0.1/apply")
    assert bad.job is not None and bad.job.apply_url is None
    assert bad.job.title == "(untitled)" and bad.job.company == "(company not stated)"


@pytest.mark.parametrize(
    "overrides",
    [
        {},
        {"url": "https://jobs.example.test/x", "description_text": "both given " * 3},
        {"description_text": "   "},
    ],
)
async def test_exactly_one_of_url_or_text_is_required(
    settings: WorkerSettings, overrides: dict[str, Any]
) -> None:
    with pytest.raises(TaskFailureError) as info:
        await run(settings, None, **overrides)
    assert info.value.code == "INPUT_INVALID"


# ---------------------------------------------------------------------------
# redaction and registration


async def test_no_page_content_reaches_the_logs(settings: WorkerSettings) -> None:
    stream = io.StringIO()
    configure_logging("debug", stream=stream)
    try:
        await run(
            settings, site_with("jobposting-prompt-injection.html"), url=f"https://{HOST}/careers/1"
        )
        await run(settings, site_with("jobposting-none.html"), url=f"https://{HOST}/careers/1")
        await run(settings, None, description_text=PASTED, company_hint="Example Corp")
    finally:
        output = stream.getvalue()
        configure_logging("info", stream=io.StringIO())
    assert "fetch_job.completed" in output and "fetch_job.pasted" in output
    for fragment in (
        "IGNORE ALL",
        "Copperline",
        "attacker",
        "Meridian",
        "NVQ",
        "Example Corp",
        "PostgreSQL",
        "<html",
    ):
        assert fragment not in output, fragment


def test_fetch_job_and_fetch_board_are_registered() -> None:
    registered = {task_type.value for task_type in build_default_registry().registered}
    assert {"fetch_board", "fetch_job"} <= registered
    assert "fill_local" not in registered
