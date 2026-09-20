"""Robots.txt outcomes are reported as what they are.

Found on a real stack: a TLS verification failure while fetching robots.txt
was reported as ``ROBOTS_DISALLOWED`` ("the site's robots.txt disallows this
path") with ``health: blocked``. Nothing had been read from the site; the
failure was on the worker's own side. Three of those would have blocked a
healthy board permanently.

The rule now: only a rule that was actually read is a statement about the
site. An unreachable robots.txt is a transport failure (retryable task
failure, nothing crawled). A 5xx or redirect loop is "assumed disallowed for
this attempt", reported in those words, with health ``degraded``.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.contracts.generated import FetchBoardResult
from job_getter_worker.errors import TaskFailureError
from job_getter_worker.handlers.fetch_board import handle_fetch_board
from job_getter_worker.net import (
    HTML_CONTENT_TYPES,
    FetchPolicy,
    FetchUnavailableError,
    RobotsDisallowedError,
)
from job_getter_worker.net.fetch import _operator_trust_store
from job_getter_worker.settings import WorkerSettings

from .conftest import GREENHOUSE_IP, FakeSite, html_response, make_fetcher, make_task_context

HOST = "jobs.example.test"
POLICY = FetchPolicy()
TLS_FAILURE = (
    "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: "
    "unable to get local issuer certificate (_ssl.c:1010)"
)


async def fetch_job_page(site: FakeSite) -> None:
    fetcher = make_fetcher(site)
    try:
        await fetcher.fetch(
            f"https://{HOST}/careers/1",
            policy=POLICY,
            accepted_content_types=HTML_CONTENT_TYPES,
        )
    finally:
        await fetcher.aclose()


def site_with_job_page() -> FakeSite:
    site = FakeSite()
    site.add(HOST, "/careers/1", html_response("<html>open</html>"))
    return site


# ---------------------------------------------------------------------------
# fetcher level


async def test_unreachable_robots_is_a_transport_failure_not_a_robots_decision() -> None:
    site = site_with_job_page()

    def refused(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    site.add(HOST, "/robots.txt", refused)

    with pytest.raises(FetchUnavailableError) as info:
        await fetch_job_page(site)

    assert info.value.kind == "transport"
    assert "robots.txt" in info.value.message
    assert "disallow" not in info.value.message.lower()
    # Nothing was crawled on the strength of a robots file that was never read.
    assert "/careers/1" not in site.paths_for(HOST)


async def test_tls_failure_on_robots_names_certificate_verification() -> None:
    site = site_with_job_page()

    def tls_failure(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(TLS_FAILURE)

    site.add(HOST, "/robots.txt", tls_failure)

    with pytest.raises(FetchUnavailableError) as info:
        await fetch_job_page(site)

    message = info.value.message
    assert "Certificate verification failed" in message
    assert "RUNBOOK.md section 6" in message
    assert "/careers/1" not in site.paths_for(HOST)


async def test_robots_5xx_is_assumed_disallowed_and_says_so() -> None:
    site = site_with_job_page()
    site.add(HOST, "/robots.txt", httpx.Response(503, content=b""))

    with pytest.raises(RobotsDisallowedError) as info:
        await fetch_job_page(site)

    assert info.value.assumed is True
    assert "could not be read" in info.value.message
    assert "503" in info.value.message
    assert "disallows this path" not in info.value.message
    assert "/careers/1" not in site.paths_for(HOST)


async def test_real_robots_rule_is_reported_as_a_rule() -> None:
    site = site_with_job_page()
    site.add(
        HOST,
        "/robots.txt",
        httpx.Response(
            200,
            content=b"User-agent: *\nDisallow: /careers/\n",
            headers={"content-type": "text/plain"},
        ),
    )

    with pytest.raises(RobotsDisallowedError) as info:
        await fetch_job_page(site)

    assert info.value.assumed is False
    assert "disallows this path" in info.value.message
    assert "/careers/1" not in site.paths_for(HOST)


def test_operator_trust_store_honours_ssl_cert_file_and_never_disables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    assert _operator_trust_store() is True

    monkeypatch.setenv("SSL_CERT_FILE", "/etc/job-getter/ca-bundle.pem")
    assert _operator_trust_store() == "/etc/job-getter/ca-bundle.pem"

    # An empty value is "unset", not "verify nothing".
    monkeypatch.setenv("SSL_CERT_FILE", "")
    assert _operator_trust_store() is True


# ---------------------------------------------------------------------------
# handler level, through the real Greenhouse connector

GH_ROBOTS = f"https://{GREENHOUSE_IP}/robots.txt"
GH_JOBS = f"https://{GREENHOUSE_IP}/v1/boards/acme-robotics/jobs"


def board_input() -> dict[str, Any]:
    return {
        "scan_id": "12121212-3434-4565-8787-989898989898",
        "source_id": "abababab-cdcd-4efe-8f0f-101010101010",
        "connector": "greenhouse",
        "connector_version": "1",
        "board_key": "acme-robotics",
        "base_url": None,
        "etag": None,
        "last_modified": None,
        "limits": {
            "max_jobs": 1000,
            "max_pages": 100,
            "timeout_seconds": 20,
            "min_request_interval_ms": 1000,
        },
    }


async def run_board(settings: WorkerSettings) -> FetchBoardResult:
    context, _progress = make_task_context(settings, board_input(), task_type="fetch_board")
    fetcher = make_fetcher()
    try:
        result = await handle_fetch_board(context, fetcher=fetcher)
    finally:
        await fetcher.aclose()
    FetchBoardResult.model_validate(result.model_dump(mode="json"))
    return result


@respx.mock
async def test_board_scan_with_unreachable_robots_fails_retryably_and_fetches_nothing(
    settings: WorkerSettings,
) -> None:
    respx.get(GH_ROBOTS).mock(side_effect=httpx.ConnectError(TLS_FAILURE))
    jobs = respx.get(GH_JOBS).mock(return_value=httpx.Response(200, json={"jobs": []}))

    with pytest.raises(TaskFailureError) as info:
        await run_board(settings)

    assert info.value.code == "FETCH_BLOCKED"
    assert info.value.retryable is True
    assert jobs.call_count == 0


@respx.mock
async def test_board_scan_with_robots_5xx_is_degraded_not_blocked(
    settings: WorkerSettings,
) -> None:
    respx.get(GH_ROBOTS).mock(return_value=httpx.Response(503))
    jobs = respx.get(GH_JOBS).mock(return_value=httpx.Response(200, json={"jobs": []}))

    result = await run_board(settings)

    assert result.complete_snapshot is False
    assert [w.code for w in result.warnings] == ["ROBOTS_DISALLOWED"]
    assert "could not be read" in result.warnings[0].message
    assert result.observed_health.state == "degraded"
    assert jobs.call_count == 0


@respx.mock
async def test_board_scan_with_a_real_robots_rule_is_blocked(
    settings: WorkerSettings,
) -> None:
    respx.get(GH_ROBOTS).mock(
        return_value=httpx.Response(
            200,
            content=b"User-agent: *\nDisallow: /v1/\n",
            headers={"content-type": "text/plain"},
        )
    )
    jobs = respx.get(GH_JOBS).mock(return_value=httpx.Response(200, json={"jobs": []}))

    result = await run_board(settings)

    assert [w.code for w in result.warnings] == ["ROBOTS_DISALLOWED"]
    assert "disallows this path" in result.warnings[0].message
    assert result.observed_health.state == "blocked"
    assert jobs.call_count == 0
