"""``fetch_board``: AT06 (a failed or partial scan never claims completeness)
and the result shape the API reads (denial detection, 304 handling,
source_key identity, observed health).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.cancellation import CancellationToken
from job_getter_worker.connectors import (
    Connector,
    ConnectorConfig,
    ConnectorDescriptor,
    DiscoveryPage,
    RatePolicy,
)
from job_getter_worker.contracts.generated import (
    ConnectorId,
    FetchBoardResult,
    FetchLimits,
    NormalizedJob,
)
from job_getter_worker.discovery import RawJob, normalize_job
from job_getter_worker.errors import TaskCancelledError, TaskFailureError
from job_getter_worker.handlers.fetch_board import handle_fetch_board, run_discovery
from job_getter_worker.net import (
    FetchUnavailableError,
    RateLimitedError,
    SchemaDriftError,
)
from job_getter_worker.settings import WorkerSettings

from .conftest import GREENHOUSE_IP, make_fetcher, make_task_context, read_job_fixture

GH_JOBS = f"https://{GREENHOUSE_IP}/v1/boards/acme-robotics/jobs"
SCAN_ID = "12121212-3434-4565-8787-989898989898"
SOURCE_ID = "abababab-cdcd-4efe-8f0f-101010101010"


def board_input(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "scan_id": SCAN_ID,
        "source_id": SOURCE_ID,
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
    values.update(overrides)
    return values


async def run_board(settings: WorkerSettings, **overrides: Any) -> FetchBoardResult:
    context, _progress = make_task_context(
        settings, board_input(**overrides), task_type="fetch_board"
    )
    fetcher = make_fetcher()
    try:
        result = await handle_fetch_board(context, fetcher=fetcher)
    finally:
        await fetcher.aclose()
    FetchBoardResult.model_validate(result.model_dump(mode="json"))
    return result


def no_robots() -> None:
    respx.get(f"https://{GREENHOUSE_IP}/robots.txt").mock(return_value=httpx.Response(404))


# ---------------------------------------------------------------------------
# through the real Greenhouse connector


@respx.mock
async def test_clean_full_scan_is_a_complete_snapshot(settings: WorkerSettings) -> None:
    no_robots()
    respx.get(GH_JOBS).mock(
        return_value=httpx.Response(
            200,
            json=read_job_fixture("greenhouse.acme-robotics.jobs.json"),
            headers={"etag": '"snap-1"', "last-modified": "Sat, 12 Sep 2026 14:15:00 GMT"},
        )
    )
    result = await run_board(settings)
    assert result.complete_snapshot is True
    assert result.pages_fetched == 1 and result.next_cursor is None
    assert [job.source_key for job in result.jobs] == [
        "greenhouse:acme-robotics:4001",
        "greenhouse:acme-robotics:4002",
        "greenhouse:acme-robotics:4003",
    ]
    assert result.observed_health.state == "ok"
    assert result.observed_health.http_status == 200
    assert result.observed_health.retry_after_seconds is None
    assert result.etag == '"snap-1"'
    assert result.last_modified == "Sat, 12 Sep 2026 14:15:00 GMT"
    codes = {w.code for w in result.warnings}
    assert codes == {"FIELD_INFERRED"}
    assert len(result.warnings) < 10, "identical warnings are collapsed"


@respx.mock
async def test_403_is_denied_incomplete_and_blocked(settings: WorkerSettings) -> None:
    no_robots()
    route = respx.get(GH_JOBS).mock(return_value=httpx.Response(403))
    result = await run_board(settings)
    assert result.jobs == [] and result.complete_snapshot is False
    assert [w.code for w in result.warnings] == ["ACCESS_DENIED"]
    assert result.observed_health.state == "blocked"
    assert result.observed_health.http_status == 403
    assert route.call_count == 1


@respx.mock
async def test_429_is_denied_incomplete_with_retry_after(settings: WorkerSettings) -> None:
    no_robots()
    route = respx.get(GH_JOBS).mock(return_value=httpx.Response(429, headers={"retry-after": "30"}))
    result = await run_board(settings)
    assert result.complete_snapshot is False and result.jobs == []
    assert [w.code for w in result.warnings] == ["RATE_LIMITED"]
    assert result.warnings[0].detail == "retry_after_seconds=30"
    assert result.observed_health.state == "degraded"
    assert result.observed_health.http_status == 429
    assert result.observed_health.retry_after_seconds == 30
    assert route.call_count == 1


@respx.mock
async def test_429_with_http_date_retry_after(settings: WorkerSettings) -> None:
    no_robots()
    respx.get(GH_JOBS).mock(
        return_value=httpx.Response(
            429,
            headers={
                "date": "Sun, 20 Sep 2026 10:00:00 GMT",
                "retry-after": "Sun, 20 Sep 2026 10:02:00 GMT",
            },
        )
    )
    result = await run_board(settings)
    assert result.observed_health.retry_after_seconds == 120


@respx.mock
async def test_schema_drift_is_incomplete_with_no_jobs(settings: WorkerSettings) -> None:
    no_robots()
    respx.get(GH_JOBS).mock(return_value=httpx.Response(200, json={"jobs": "changed"}))
    result = await run_board(settings)
    assert result.jobs == [] and result.complete_snapshot is False
    assert [w.code for w in result.warnings] == ["SCHEMA_DRIFT"]
    assert result.observed_health.state == "degraded"


@respx.mock
async def test_job_cap_marks_the_snapshot_incomplete(settings: WorkerSettings) -> None:
    no_robots()
    respx.get(GH_JOBS).mock(
        return_value=httpx.Response(
            200, json=read_job_fixture("greenhouse.acme-robotics.jobs.json")
        )
    )
    result = await run_board(
        settings,
        limits={
            "max_jobs": 2,
            "max_pages": 100,
            "timeout_seconds": 20,
            "min_request_interval_ms": 1000,
        },
    )
    assert len(result.jobs) == 2
    assert result.complete_snapshot is False
    assert "JOB_LIMIT_REACHED" in [w.code for w in result.warnings]


@respx.mock
async def test_304_keeps_the_previous_snapshot(settings: WorkerSettings) -> None:
    no_robots()
    route = respx.get(GH_JOBS).mock(return_value=httpx.Response(304, headers={"etag": '"snap-1"'}))
    result = await run_board(
        settings, etag='"snap-1"', last_modified="Sat, 12 Sep 2026 14:15:00 GMT"
    )
    assert route.calls.last.request.headers["if-none-match"] == '"snap-1"'
    assert result.jobs == []
    assert result.complete_snapshot is False, "zero jobs must never look like an empty board"
    assert [w.code for w in result.warnings] == ["NOT_MODIFIED"]
    assert result.observed_health.state == "ok"
    assert result.observed_health.http_status == 304
    assert result.etag == '"snap-1"'
    assert result.last_modified == "Sat, 12 Sep 2026 14:15:00 GMT"


@respx.mock
async def test_transport_failure_on_the_first_page_fails_the_task(
    settings: WorkerSettings,
) -> None:
    no_robots()
    respx.get(GH_JOBS).mock(side_effect=httpx.ConnectError("down"))
    with pytest.raises(TaskFailureError) as info:
        await run_board(settings)
    assert info.value.code == "FETCH_BLOCKED" and info.value.retryable is True


async def test_unknown_connector_or_bad_base_url_is_input_invalid(
    settings: WorkerSettings,
) -> None:
    with pytest.raises(TaskFailureError) as info:
        await run_board(
            settings, connector="lever", board_key="x", base_url="https://evil.example.test"
        )
    assert info.value.code == "INPUT_INVALID"
    assert respx.calls.call_count == 0


# ---------------------------------------------------------------------------
# AT06 with a paginating connector


def make_job(index: int) -> NormalizedJob:
    return normalize_job(
        RawJob(
            external_id=str(index),
            source_key=f"fake:board:{index}",
            canonical_url=f"https://jobs.example.test/{index}",
            apply_url=None,
            company="Fake Co",
            title=f"Job {index}",
            description_text=f"Description {index}.",
            retrieved_at=datetime.now(tz=__import__("datetime").UTC),
        )
    ).job


class PagedConnector(Connector):
    """A connector with several pages, any of which may fail on demand."""

    descriptor = ConnectorDescriptor(
        id=ConnectorId.GREENHOUSE,
        version="test",
        allowed_hosts=frozenset({"jobs.example.test"}),
        capabilities=("discover",),
        config_schema={"type": "object"},
        rate_policy=RatePolicy(),
        policy_review_url="https://example.test/policy",
        policy_review_date="2026-09-20",
    )

    def __init__(self, pages: list[list[NormalizedJob] | Exception]) -> None:
        super().__init__(make_fetcher())
        self.pages = pages
        self.calls: list[str | None] = []

    async def discover(
        self,
        config: ConnectorConfig,
        cursor: str | None,
        *,
        retrieved_at: datetime,
        cancel: CancellationToken | None = None,
    ) -> DiscoveryPage:
        self.calls.append(cursor)
        index = int(cursor) if cursor else 0
        page = self.pages[index]
        if isinstance(page, Exception):
            raise page
        next_cursor = str(index + 1) if index + 1 < len(self.pages) else None
        return DiscoveryPage(jobs=list(page), next_cursor=next_cursor, http_status=200)

    async def get_job(
        self,
        config: ConnectorConfig,
        external_id: str,
        *,
        retrieved_at: datetime,
        cancel: CancellationToken | None = None,
    ) -> NormalizedJob:  # pragma: no cover - not exercised
        raise NotImplementedError


def limits(**overrides: int) -> FetchLimits:
    values = {
        "max_jobs": 1000,
        "max_pages": 100,
        "timeout_seconds": 20,
        "min_request_interval_ms": 1000,
    }
    values.update(overrides)
    return FetchLimits(**values)


async def run_paged(
    settings: WorkerSettings, pages: list[list[NormalizedJob] | Exception], **limit_overrides: int
) -> tuple[FetchBoardResult, PagedConnector]:
    connector = PagedConnector(pages)
    context, _progress = make_task_context(settings, board_input(), task_type="fetch_board")
    config = ConnectorConfig(board_key="board", base_url=None, limits=limits(**limit_overrides))
    result = await run_discovery(context, connector, config)
    FetchBoardResult.model_validate(result.model_dump(mode="json"))
    return result, connector


async def test_all_pages_ok_is_complete(settings: WorkerSettings) -> None:
    result, connector = await run_paged(settings, [[make_job(1), make_job(2)], [make_job(3)]])
    assert result.complete_snapshot is True
    assert result.pages_fetched == 2 and connector.calls == [None, "1"]
    assert [job.external_id for job in result.jobs] == ["1", "2", "3"]
    assert result.next_cursor is None


async def test_a_page_failing_mid_scan_keeps_what_was_seen_but_is_partial(
    settings: WorkerSettings,
) -> None:
    result, _ = await run_paged(
        settings,
        [[make_job(1)], FetchUnavailableError("gone", kind="http", http_status=502), [make_job(3)]],
    )
    assert result.complete_snapshot is False
    assert [job.external_id for job in result.jobs] == ["1"]
    assert result.pages_fetched == 1
    assert result.observed_health.state == "degraded"
    assert result.observed_health.http_status == 502


async def test_a_rate_limit_mid_scan_is_partial_with_retry_after(settings: WorkerSettings) -> None:
    result, _ = await run_paged(
        settings, [[make_job(1)], RateLimitedError("slow down", retry_after_seconds=45)]
    )
    assert result.complete_snapshot is False
    assert [w.code for w in result.warnings] == ["RATE_LIMITED"]
    assert result.observed_health.retry_after_seconds == 45
    assert result.observed_health.http_status == 429
    assert len(result.jobs) == 1


async def test_a_drift_mid_scan_is_partial(settings: WorkerSettings) -> None:
    result, _ = await run_paged(settings, [[make_job(1)], SchemaDriftError("changed")])
    assert result.complete_snapshot is False
    assert [w.code for w in result.warnings] == ["SCHEMA_DRIFT"]


async def test_page_cap_is_partial_and_keeps_the_cursor(settings: WorkerSettings) -> None:
    result, connector = await run_paged(
        settings, [[make_job(1)], [make_job(2)], [make_job(3)]], max_pages=2
    )
    assert result.complete_snapshot is False
    assert result.pages_fetched == 2 and connector.calls == [None, "1"]
    assert result.next_cursor == "2"
    assert "PAGE_LIMIT_REACHED" in [w.code for w in result.warnings]


async def test_job_cap_across_pages_is_partial(settings: WorkerSettings) -> None:
    result, _ = await run_paged(
        settings, [[make_job(1), make_job(2)], [make_job(3), make_job(4)]], max_jobs=3
    )
    assert result.complete_snapshot is False
    assert [job.external_id for job in result.jobs] == ["1", "2", "3"]
    assert "JOB_LIMIT_REACHED" in [w.code for w in result.warnings]


async def test_cancellation_is_honoured_between_pages(settings: WorkerSettings) -> None:
    connector = PagedConnector([[make_job(1)], [make_job(2)]])
    context, progress = make_task_context(settings, board_input(), task_type="fetch_board")

    original = connector.discover

    async def cancel_after_first(*args: Any, **kwargs: Any) -> DiscoveryPage:
        page = await original(*args, **kwargs)
        context.cancel.request()
        return page

    connector.discover = cancel_after_first  # type: ignore[method-assign]
    with pytest.raises(TaskCancelledError):
        await run_discovery(
            context, connector, ConnectorConfig(board_key="b", base_url=None, limits=limits())
        )
    assert connector.calls == [None], "the second page was never requested"
    assert progress and progress[0][0] == "fetching"
