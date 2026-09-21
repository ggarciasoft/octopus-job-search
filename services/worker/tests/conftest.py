"""Shared fixtures.

Everything here is deterministic and offline. The document corpus comes from
``fixtures/`` at the repository root, which is generated, checksummed and
property-verified by its own tooling.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.api import TaskApiClient
from job_getter_worker.cancellation import CancellationToken
from job_getter_worker.clock import to_timestamp_string, utc_now
from job_getter_worker.contracts.generated import TaskType
from job_getter_worker.handlers import TaskContext
from job_getter_worker.net import Fetcher
from job_getter_worker.settings import WorkerSettings, load_settings

REPO_ROOT = Path(__file__).resolve().parents[3]
CV_FIXTURES = REPO_ROOT / "fixtures" / "cvs"
MODEL_FIXTURES = REPO_ROOT / "fixtures" / "model-responses"

#: A lease token long enough for the contract's ``min_length=32``.
LEASE_TOKEN = "lease-token-0123456789abcdef0123456789"

#: Environment variables the worker reads. Cleared before each test so a
#: developer's own shell cannot change a result.
_WORKER_ENV_KEYS = (
    "WORKER_API_BASE_URL",
    "WORKER_AUTH_TOKEN",
    "WORKER_ID",
    "WORKER_CAPABILITIES",
    "WORKER_POLL_INTERVAL_SECONDS",
    "WORKER_IDLE_POLL_MAX_SECONDS",
    "WORKER_REQUEST_TIMEOUT_SECONDS",
    "WORKER_MAX_DOWNLOAD_BYTES",
    "WORKER_MAX_PDF_PAGES",
    "WORKER_MAX_EXTRACTED_CHARS",
    "WORKER_MAX_DOCX_UNCOMPRESSED_BYTES",
    "WORKER_EXTRACTION_TIMEOUT_SECONDS",
    "WORKER_MODEL",
    "WORKER_PROVIDER_API_KEY",
    "WORKER_FAKE_FIXTURE_DIR",
    "WORKER_PROVIDER_CONTEXT_LIMIT",
    "WORKER_PROVIDER_OUTPUT_TOKEN_LIMIT",
    "WORKER_PROVIDER_TEMPERATURE",
    "WORKER_PROVIDER_TIMEOUT_SECONDS",
    "WORKER_PROVIDER_DAILY_TOKEN_BUDGET",
    "WORKER_PROVIDER_DAILY_COST_BUDGET",
    "WORKER_PROVIDER_REQUESTS_PER_DAY",
    "WORKER_PROVIDER_RATE_CURRENCY",
    "WORKER_PROVIDER_INPUT_COST_PER_MILLION",
    "WORKER_PROVIDER_OUTPUT_COST_PER_MILLION",
    "PROVIDER_DEFAULT",
    "LOCAL_MODEL_BASE_URL",
    "LOG_LEVEL",
)

_DEFAULT_ENV = {
    "WORKER_API_BASE_URL": "http://api.internal.test",
    "WORKER_AUTH_TOKEN": "worker-credential-for-tests",
    "WORKER_ID": "test-worker-1",
    "WORKER_CAPABILITIES": "noop_echo,parse_profile",
}

SettingsFactory = Callable[..., WorkerSettings]


@pytest.fixture
def make_settings(monkeypatch: pytest.MonkeyPatch) -> SettingsFactory:
    """Build :class:`WorkerSettings` from a controlled environment."""

    def _make(**overrides: str) -> WorkerSettings:
        for key in _WORKER_ENV_KEYS:
            monkeypatch.delenv(key, raising=False)
        values = {**_DEFAULT_ENV, **overrides}
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        return load_settings()

    return _make


@pytest.fixture
def settings(make_settings: SettingsFactory) -> WorkerSettings:
    return make_settings()


@pytest.fixture
def fake_provider_settings(make_settings: SettingsFactory) -> WorkerSettings:
    """Settings wired to the deterministic fake provider."""
    return make_settings(
        PROVIDER_DEFAULT="fake",
        WORKER_MODEL="fake-deterministic-v1",
        WORKER_FAKE_FIXTURE_DIR=str(MODEL_FIXTURES),
    )


def lease_expiry(seconds: int = 120) -> str:
    return to_timestamp_string(utc_now() + timedelta(seconds=seconds))


def claim_payload(
    *,
    task_id: str = "11111111-2222-4333-8444-555555555555",
    task_type: str = "noop_echo",
    task_input: Any = None,
    files: list[dict[str, Any]] | None = None,
    lease_seconds: int = 120,
    attempt: int = 1,
) -> dict[str, Any]:
    """A claim response body matching the generated ``ClaimResponse``."""
    return {
        "task_id": task_id,
        "type": task_type,
        "lease_token": LEASE_TOKEN,
        "lease_expires_at": lease_expiry(lease_seconds),
        "attempt": attempt,
        "max_attempts": 3,
        "input_schema_version": 1,
        "input": task_input if task_input is not None else {"message": "hello"},
        "files": files or [],
    }


def task_ack(task_id: str, state: str = "succeeded") -> dict[str, Any]:
    return {"task_id": task_id, "state": state}


def input_file_entry(
    file_id: str,
    *,
    original_name: str,
    size: int,
    mime: str = "application/pdf",
) -> dict[str, Any]:
    return {
        "file_id": file_id,
        "purpose": "cv_original",
        "original_name": original_name,
        "mime": mime,
        "bytes": size,
        "sha256": "0" * 64,
    }


def read_cv(name: str) -> bytes:
    return (CV_FIXTURES / name).read_bytes()


# ---------------------------------------------------------------------------
# M2 discovery helpers: a stub resolver, a recording transport, task contexts.
# ---------------------------------------------------------------------------

JOB_FIXTURES = REPO_ROOT / "fixtures" / "jobs"
ATS_PAGES = REPO_ROOT / "fixtures" / "ats-pages"

#: Genuinely global addresses (documentation ranges count as private on
#: Python 3.12, so they cannot stand in for "public" here).
PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2001:4860:4860::8888"
GREENHOUSE_IP = "8.8.8.8"
LEVER_IP = "1.1.1.1"
LEVER_EU_IP = "9.9.9.9"

#: The only DNS the discovery tests know. Anything else fails to resolve.
STUB_DNS: dict[str, list[str]] = {
    "jobs.example.test": [PUBLIC_V4],
    "v6.example.test": [PUBLIC_V6],
    "private.example.test": ["10.0.0.1"],
    "mixed.example.test": [PUBLIC_V4, "10.0.0.1"],
    "evil.example.test": ["127.0.0.1"],
    "metadata.example.test": ["169.254.169.254"],
    "boards-api.greenhouse.io": [GREENHOUSE_IP],
    "api.lever.co": [LEVER_IP],
    "api.eu.lever.co": [LEVER_EU_IP],
}


async def stub_resolver(host: str) -> list[str]:
    try:
        return list(STUB_DNS[host])
    except KeyError as error:
        raise OSError(f"no stub DNS record for {host!r}") from error


RouteHandler = Callable[[httpx.Request], httpx.Response]


class FakeSite:
    """Routes keyed by (Host header, path) for ``httpx.MockTransport``.

    The fetcher pins connections to the resolved address, so the request URL
    host is an IP; the *name* travels in the ``Host`` header. Routing on the
    header is therefore also an assertion that pinning happened.
    """

    def __init__(self) -> None:
        self.routes: dict[tuple[str, str], RouteHandler] = {}
        self.requests: list[httpx.Request] = []

    def add(self, host: str, path: str, response: httpx.Response | RouteHandler) -> None:
        if isinstance(response, httpx.Response):
            fixed = response
            self.routes[(host, path)] = lambda _request: fixed
        else:
            self.routes[(host, path)] = response

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        route = self.routes.get((request.headers.get("host", ""), request.url.path))
        if route is None:
            return httpx.Response(404, content=b"not found", headers={"content-type": "text/plain"})
        return route(request)

    def hosts_contacted(self) -> list[str]:
        return [request.headers.get("host", "") for request in self.requests]

    def paths_for(self, host: str) -> list[str]:
        return [
            request.url.path for request in self.requests if request.headers.get("host", "") == host
        ]


class RecordingFetcher(Fetcher):
    """A fetcher whose politeness waits are recorded instead of slept."""

    recorded_sleeps: list[float]


def make_fetcher(site: FakeSite | None = None) -> RecordingFetcher:
    """A :class:`Fetcher` wired to the stub resolver and an instant clock.

    With ``site`` the transport is a ``MockTransport`` over the site's routes;
    without it the default transport is used, which is what ``respx`` patches.
    """
    state = {"now": 1000.0}
    sleeps: list[float] = []

    def monotonic() -> float:
        state["now"] += 0.001
        return state["now"]

    async def sleeper(seconds: float) -> None:
        sleeps.append(seconds)
        state["now"] += seconds
        await asyncio.sleep(0)

    fetcher = RecordingFetcher(
        resolver=stub_resolver,
        transport=httpx.MockTransport(site.handler) if site is not None else None,
        sleeper=sleeper,
        monotonic=monotonic,
    )
    fetcher.recorded_sleeps = sleeps
    return fetcher


def html_response(
    body: str, status: int = 200, headers: dict[str, str] | None = None
) -> httpx.Response:
    return httpx.Response(
        status,
        content=body.encode("utf-8"),
        headers={"content-type": "text/html; charset=utf-8", **(headers or {})},
    )


def make_task_context(
    settings: WorkerSettings,
    task_input: Any,
    *,
    task_type: str = "fetch_job",
) -> tuple[TaskContext, list[tuple[str, int]]]:
    """A ``TaskContext`` for handler tests plus the progress it reports.

    The API client is never used by the discovery handlers, so it points at a
    transport that refuses."""

    def refuse(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("discovery handlers must not call the task API")

    progress: list[tuple[str, int]] = []
    context = TaskContext(
        task_id="11111111-2222-4333-8444-555555555555",
        task_type=TaskType(task_type),
        attempt=1,
        input=task_input,
        files=(),
        settings=settings,
        api=TaskApiClient(
            "http://api.internal.test",
            "worker-credential-for-tests",
            max_download_bytes=1024,
            transport=httpx.MockTransport(refuse),
        ),
        cancel=CancellationToken(),
        report_progress=lambda stage, percent: progress.append((stage, percent)),
        lease_token=LEASE_TOKEN,
    )
    return context, progress


def read_page(name: str) -> str:
    return (ATS_PAGES / name).read_text(encoding="utf-8")


def read_job_fixture(name: str) -> Any:
    return json.loads((JOB_FIXTURES / name).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# The usage ledger, as the worker sees it
# ---------------------------------------------------------------------------


class UsageLedgerStub:
    """A stand-in for the API's usage ledger, mounted on ``respx``.

    It mirrors ``apps/api/src/usage/service.ts`` closely enough to exercise the
    worker's half of the protocol: a reservation is created before the request,
    settled with whatever the provider reported, or released when the request
    was never sent. A refusal arrives the way the API sends one — **409 with
    ``BUDGET_EXHAUSTED``**, not 429, because a budget refusal must not be
    retried.

    The recorded calls are the point: a test can assert that the reservation
    happened *before* the model was asked anything.
    """

    def __init__(self, base_url: str, task_id: str, *, exhausted: bool = False) -> None:
        self._base = f"{base_url}/internal/v1/tasks/{task_id}/usage"
        self.exhausted = exhausted
        self.reserved: list[dict[str, Any]] = []
        self.settled: list[dict[str, Any]] = []
        self.released: list[str] = []

    RESERVATION_ID = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa"

    def _reserve(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if self.exhausted:
            return httpx.Response(
                409,
                json={
                    "error": {
                        "code": "BUDGET_EXHAUSTED",
                        "message": (
                            "The daily limit of 50 model requests has been reached. "
                            "Reviewing, editing and exporting still work."
                        ),
                        "request_id": "11111111-1111-4111-8111-111111111111",
                    }
                },
            )
        self.reserved.append(body)
        return httpx.Response(
            201,
            json={
                "reservation_id": self.RESERVATION_ID,
                "reserved_tokens": body["estimated_input_tokens"] + body["estimated_output_tokens"],
                "reserved_cost": None,
                "currency": None,
            },
        )

    def _settle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.settled.append(body)
        # Nulls mean the provider reported nothing; the estimate then stands,
        # exactly as the API does it.
        estimate = self.reserved[-1] if self.reserved else {}
        input_tokens = body["input_tokens"] or estimate.get("estimated_input_tokens", 0)
        output_tokens = body["output_tokens"] or estimate.get("estimated_output_tokens", 0)
        return httpx.Response(
            200,
            json={
                "reservation_id": self.RESERVATION_ID,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "measured_cost": None,
                "currency": None,
                "cost_is_unknown": True,
            },
        )

    def _release(self, request: httpx.Request) -> httpx.Response:
        self.released.append(str(request.url))
        return httpx.Response(204)

    def mount(self) -> UsageLedgerStub:
        respx.post(f"{self._base}/reserve").mock(side_effect=self._reserve)
        respx.post(f"{self._base}/{self.RESERVATION_ID}/settle").mock(side_effect=self._settle)
        respx.post(f"{self._base}/{self.RESERVATION_ID}/release").mock(side_effect=self._release)
        return self
