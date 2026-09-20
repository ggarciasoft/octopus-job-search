"""Greenhouse and Lever connectors against the pinned fixtures (AT05, drift,
denial, rate limit, conditional requests, host restriction).

``respx`` intercepts at the transport, so the URLs it sees are the *pinned*
ones: the validated address as host, the real name in the ``Host`` header.
Routing on the address and asserting on the header proves the connectors go
through the same pinned fetcher as the URL importer.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
import respx

from job_getter_worker.connectors import (
    ConnectorConfig,
    GreenhouseConnector,
    LeverConnector,
    get_connector,
    source_key_for,
)
from job_getter_worker.contracts.generated import ConnectorId, FetchLimits, NormalizedJob
from job_getter_worker.errors import TaskFailureError
from job_getter_worker.net import (
    AccessDeniedError,
    BlockedDestinationError,
    RateLimitedError,
    SchemaDriftError,
)

from .conftest import GREENHOUSE_IP, LEVER_EU_IP, LEVER_IP, make_fetcher, read_job_fixture

NOW = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
GH_JOBS = f"https://{GREENHOUSE_IP}/v1/boards/acme-robotics/jobs"
LEVER_POSTINGS = f"https://{LEVER_IP}/v0/postings/orbital-foods"
LIMITS = FetchLimits(max_jobs=1000, max_pages=100, timeout_seconds=20, min_request_interval_ms=1000)


def config(board: str, **overrides: object) -> ConnectorConfig:
    values: dict[str, object] = {"board_key": board, "base_url": None, "limits": LIMITS}
    values.update(overrides)
    return ConnectorConfig(**values)  # type: ignore[arg-type]


def no_robots(ip: str) -> None:
    respx.get(f"https://{ip}/robots.txt").mock(return_value=httpx.Response(404))


def assert_valid(job: NormalizedJob) -> None:
    NormalizedJob.model_validate(job.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Greenhouse


@respx.mock
async def test_greenhouse_board_yields_one_job_per_identity_with_provenance() -> None:
    """AT05: a duplicate posting in one snapshot collapses on source_key."""
    no_robots(GREENHOUSE_IP)
    route = respx.get(GH_JOBS, params={"content": "true"}).mock(
        return_value=httpx.Response(
            200,
            json=read_job_fixture("greenhouse.acme-robotics.jobs.json"),
            headers={"etag": '"snap-1"', "last-modified": "Sat, 12 Sep 2026 14:15:00 GMT"},
        )
    )
    fetcher = make_fetcher()
    try:
        page = await GreenhouseConnector(fetcher).discover(
            config("acme-robotics"), None, retrieved_at=NOW
        )
    finally:
        await fetcher.aclose()

    request = route.calls.last.request
    assert request.headers["host"] == "boards-api.greenhouse.io"
    assert request.url.host == GREENHOUSE_IP
    assert "authorization" not in request.headers and "cookie" not in request.headers

    assert page.next_cursor is None and page.http_status == 200
    assert page.etag == '"snap-1"' and page.last_modified == "Sat, 12 Sep 2026 14:15:00 GMT"
    assert page.duplicates_collapsed == 1
    keys = [job.source_key for job in page.jobs]
    assert keys == [
        "greenhouse:acme-robotics:4001",
        "greenhouse:acme-robotics:4002",
        "greenhouse:acme-robotics:4003",
    ]
    assert len(set(keys)) == len(keys)
    assert source_key_for(ConnectorId.GREENHOUSE, "acme-robotics", "4003") == keys[2]
    for job in page.jobs:
        assert_valid(job)
        assert job.company == "Acme Robotics"
        assert job.canonical_url.startswith("https://boards.greenhouse.io/acmerobotics/jobs/")
        assert job.external_id in job.canonical_url
        assert job.published_at is not None  # first_published is a stated field
        assert job.updated_at is not None


@respx.mock
async def test_greenhouse_second_snapshot_drops_one_job_for_the_api_closure_tests() -> None:
    no_robots(GREENHOUSE_IP)
    respx.get(GH_JOBS).mock(
        return_value=httpx.Response(
            200, json=read_job_fixture("greenhouse.acme-robotics.jobs.snapshot2.json")
        )
    )
    fetcher = make_fetcher()
    try:
        page = await GreenhouseConnector(fetcher).discover(
            config("acme-robotics"), None, retrieved_at=NOW
        )
    finally:
        await fetcher.aclose()
    assert [job.external_id for job in page.jobs] == ["4001", "4003"]


@respx.mock
@pytest.mark.parametrize(
    "payload",
    [
        {"postings": []},
        {"jobs": "not-a-list"},
        {"jobs": [{"id": 1, "title": "x", "absolute_url": "https://a.example/1"}]},  # no content
        {
            "jobs": [
                {"id": "4001", "title": "x", "absolute_url": "https://a.example/1", "content": ""}
            ]
        },
        {"jobs": [{"id": 1, "title": "", "absolute_url": "https://a.example/1", "content": ""}]},
        {"jobs": [{"id": 1, "title": "x", "absolute_url": "http://a.example/1", "content": ""}]},
        {"jobs": [None]},
    ],
)
async def test_greenhouse_schema_drift_yields_no_invented_jobs(payload: object) -> None:
    no_robots(GREENHOUSE_IP)
    respx.get(GH_JOBS).mock(return_value=httpx.Response(200, json=payload))
    fetcher = make_fetcher()
    try:
        with pytest.raises(SchemaDriftError) as info:
            await GreenhouseConnector(fetcher).discover(
                config("acme-robotics"), None, retrieved_at=NOW
            )
    finally:
        await fetcher.aclose()
    warning = info.value.to_warning()
    assert warning.code == "SCHEMA_DRIFT"
    assert warning.detail is not None
    assert "x" not in (warning.message + warning.detail).split()  # names fields, not values


@respx.mock
async def test_greenhouse_non_json_body_is_schema_drift() -> None:
    no_robots(GREENHOUSE_IP)
    respx.get(GH_JOBS).mock(
        return_value=httpx.Response(
            200, content=b"<html>maintenance</html>", headers={"content-type": "application/json"}
        )
    )
    fetcher = make_fetcher()
    try:
        with pytest.raises(SchemaDriftError):
            await GreenhouseConnector(fetcher).discover(
                config("acme-robotics"), None, retrieved_at=NOW
            )
    finally:
        await fetcher.aclose()


@respx.mock
async def test_greenhouse_403_is_access_denied_with_no_retry() -> None:
    no_robots(GREENHOUSE_IP)
    route = respx.get(GH_JOBS).mock(return_value=httpx.Response(403, json={"error": "nope"}))
    fetcher = make_fetcher()
    try:
        with pytest.raises(AccessDeniedError) as info:
            await GreenhouseConnector(fetcher).discover(
                config("acme-robotics"), None, retrieved_at=NOW
            )
    finally:
        await fetcher.aclose()
    assert info.value.http_status == 403
    assert route.call_count == 1


@respx.mock
async def test_greenhouse_429_carries_retry_after_seconds() -> None:
    no_robots(GREENHOUSE_IP)
    route = respx.get(GH_JOBS).mock(return_value=httpx.Response(429, headers={"retry-after": "30"}))
    fetcher = make_fetcher()
    try:
        with pytest.raises(RateLimitedError) as info:
            await GreenhouseConnector(fetcher).discover(
                config("acme-robotics"), None, retrieved_at=NOW
            )
    finally:
        await fetcher.aclose()
    assert info.value.retry_after_seconds == 30
    assert route.call_count == 1


@respx.mock
async def test_greenhouse_etag_round_trip() -> None:
    no_robots(GREENHOUSE_IP)

    def route(request: httpx.Request) -> httpx.Response:
        if request.headers.get("if-none-match") == '"snap-1"':
            assert request.headers.get("if-modified-since") == "Sat, 12 Sep 2026 14:15:00 GMT"
            return httpx.Response(304, headers={"etag": '"snap-1"'})
        return httpx.Response(
            200,
            json=read_job_fixture("greenhouse.acme-robotics.jobs.json"),
            headers={"etag": '"snap-1"'},
        )

    respx.get(GH_JOBS).mock(side_effect=route)
    fetcher = make_fetcher()
    try:
        connector = GreenhouseConnector(fetcher)
        first = await connector.discover(config("acme-robotics"), None, retrieved_at=NOW)
        second = await connector.discover(
            config(
                "acme-robotics",
                etag=first.etag,
                last_modified="Sat, 12 Sep 2026 14:15:00 GMT",
            ),
            None,
            retrieved_at=NOW,
        )
    finally:
        await fetcher.aclose()
    assert first.etag == '"snap-1"' and len(first.jobs) == 3
    assert second.not_modified and second.jobs == [] and second.http_status == 304
    assert second.etag == '"snap-1"'
    assert second.last_modified == "Sat, 12 Sep 2026 14:15:00 GMT"
    assert [w.code for w in second.warnings] == ["NOT_MODIFIED"]


@respx.mock
async def test_greenhouse_redirect_off_its_host_is_blocked() -> None:
    no_robots(GREENHOUSE_IP)
    respx.get(GH_JOBS).mock(
        return_value=httpx.Response(302, headers={"location": "https://jobs.example.test/x"})
    )
    fetcher = make_fetcher()
    try:
        with pytest.raises(BlockedDestinationError):
            await GreenhouseConnector(fetcher).discover(
                config("acme-robotics"), None, retrieved_at=NOW
            )
    finally:
        await fetcher.aclose()
    assert not any(call.request.url.path == "/x" for call in respx.calls)


@pytest.mark.parametrize("board", ["../other", "acme robotics", "", "a/b"])
async def test_greenhouse_rejects_a_board_token_that_could_change_the_path(board: str) -> None:
    fetcher = make_fetcher()
    try:
        with pytest.raises(TaskFailureError) as info:
            await GreenhouseConnector(fetcher).discover(config(board), None, retrieved_at=NOW)
    finally:
        await fetcher.aclose()
    assert info.value.code == "INPUT_INVALID"


# ---------------------------------------------------------------------------
# Lever


@respx.mock
async def test_lever_postings_are_normalised_from_structured_fields() -> None:
    no_robots(LEVER_IP)
    route = respx.get(LEVER_POSTINGS, params={"mode": "json"}).mock(
        return_value=httpx.Response(200, json=read_job_fixture("lever.orbital-foods.postings.json"))
    )
    fetcher = make_fetcher()
    try:
        page = await LeverConnector(fetcher).discover(
            config("orbital-foods"), None, retrieved_at=NOW
        )
    finally:
        await fetcher.aclose()

    assert route.calls.last.request.headers["host"] == "api.lever.co"
    assert route.calls.last.request.url.host == LEVER_IP
    assert [job.source_key for job in page.jobs] == [
        "lever:orbital-foods:6f2c1a3e-1111-4a2b-9c3d-000000000001",
        "lever:orbital-foods:6f2c1a3e-2222-4a2b-9c3d-000000000002",
    ]
    platform, analista = page.jobs
    for job in page.jobs:
        assert_valid(job)

    assert platform.remote_type == "remote"  # workplaceType is structured
    assert not any(item.field == "remote_type" for item in platform.inferred)
    assert platform.employment_type == "full_time"
    assert platform.salary is not None
    assert (platform.salary.min, platform.salary.max) == (60000, 75000)
    assert platform.salary.currency == "GBP" and platform.salary.period == "year"
    assert not any(item.field == "salary" for item in platform.inferred)
    assert [loc.country for loc in platform.locations] == ["GB"]
    assert platform.apply_url is not None and platform.apply_url.endswith("/apply")
    assert platform.published_at == "2025-09-10T10:26:40.000Z"
    kinds = {req.kind for req in platform.requirements}
    assert kinds == {"required", "preferred"}
    assert platform.eligible_countries is None  # a job location is not an eligibility rule

    assert analista.remote_type == "hybrid"
    assert analista.language == "es"
    assert any(item.field == "language" for item in analista.inferred)
    assert analista.salary is None
    assert [loc.country for loc in analista.locations] == ["ES"]


@respx.mock
async def test_lever_regional_endpoint_is_honoured_when_documented() -> None:
    no_robots(LEVER_EU_IP)
    route = respx.get(f"https://{LEVER_EU_IP}/v0/postings/orbital-foods").mock(
        return_value=httpx.Response(200, json=[])
    )
    fetcher = make_fetcher()
    try:
        page = await LeverConnector(fetcher).discover(
            config("orbital-foods", base_url="https://api.eu.lever.co"), None, retrieved_at=NOW
        )
    finally:
        await fetcher.aclose()
    assert page.jobs == []
    assert route.calls.last.request.headers["host"] == "api.eu.lever.co"


@respx.mock
@pytest.mark.parametrize(
    "base_url",
    [
        "https://jobs.example.test",
        "https://api.lever.co.evil.example.test",
        "http://api.lever.co",
        "https://api.lever.co:8443",
        "https://api.lever.co/v1/other",
        "https://user@api.lever.co",
    ],
)
async def test_lever_refuses_an_undocumented_base_url_before_any_request(base_url: str) -> None:
    fetcher = make_fetcher()
    try:
        with pytest.raises(TaskFailureError) as info:
            await LeverConnector(fetcher).discover(
                config("orbital-foods", base_url=base_url), None, retrieved_at=NOW
            )
    finally:
        await fetcher.aclose()
    assert info.value.code == "INPUT_INVALID"
    assert respx.calls.call_count == 0


@respx.mock
@pytest.mark.parametrize(
    "payload",
    [
        {"ok": False, "error": "Document not found"},
        [{"id": "abc", "text": "x"}],  # no hostedUrl
        [{"id": 12, "text": "x", "hostedUrl": "https://jobs.lever.co/x/12"}],
        [{"id": "abc", "text": "", "hostedUrl": "https://jobs.lever.co/x/abc"}],
    ],
)
async def test_lever_schema_drift_yields_no_invented_jobs(payload: object) -> None:
    no_robots(LEVER_IP)
    respx.get(LEVER_POSTINGS).mock(return_value=httpx.Response(200, json=payload))
    fetcher = make_fetcher()
    try:
        with pytest.raises(SchemaDriftError):
            await LeverConnector(fetcher).discover(config("orbital-foods"), None, retrieved_at=NOW)
    finally:
        await fetcher.aclose()


@respx.mock
async def test_lever_403_and_429_stop_without_retry() -> None:
    no_robots(LEVER_IP)
    denied = respx.get(LEVER_POSTINGS).mock(return_value=httpx.Response(403))
    fetcher = make_fetcher()
    try:
        with pytest.raises(AccessDeniedError):
            await LeverConnector(fetcher).discover(config("orbital-foods"), None, retrieved_at=NOW)
        assert denied.call_count == 1
        denied.mock(return_value=httpx.Response(429, headers={"retry-after": "7"}))
        with pytest.raises(RateLimitedError) as info:
            await LeverConnector(fetcher).discover(config("orbital-foods"), None, retrieved_at=NOW)
        assert info.value.retry_after_seconds == 7
        assert denied.call_count == 2
    finally:
        await fetcher.aclose()


# ---------------------------------------------------------------------------
# registry and contract


def test_registry_only_knows_board_connectors() -> None:
    fetcher = make_fetcher()
    assert isinstance(get_connector("greenhouse", fetcher), GreenhouseConnector)
    assert isinstance(get_connector("lever", fetcher), LeverConnector)
    for bad in ("manual", "url", "workday"):
        with pytest.raises(TaskFailureError) as info:
            get_connector(bad, fetcher)
        assert info.value.code == "INPUT_INVALID"


async def test_connectors_declare_the_spec_contract() -> None:
    fetcher = make_fetcher()
    for cls in (GreenhouseConnector, LeverConnector):
        descriptor = cls.descriptor
        assert descriptor.id in {ConnectorId.GREENHOUSE, ConnectorId.LEVER}
        assert descriptor.version == "1"
        assert descriptor.allowed_hosts and all("." in host for host in descriptor.allowed_hosts)
        assert "discover" in descriptor.capabilities and "get_job" in descriptor.capabilities
        assert descriptor.config_schema["type"] == "object"
        assert descriptor.rate_policy.per_host_concurrency == 1
        assert descriptor.rate_policy.min_request_interval_ms == 1000
        assert descriptor.policy_review_url.startswith("https://")
        assert descriptor.policy_review_date == "2026-09-20"
        health = await cls(fetcher).healthcheck()
        assert health.capabilities == descriptor.capabilities
    assert GreenhouseConnector.descriptor.allowed_hosts == frozenset({"boards-api.greenhouse.io"})
    assert LeverConnector.descriptor.allowed_hosts == frozenset({"api.lever.co", "api.eu.lever.co"})
