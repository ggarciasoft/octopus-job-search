"""The internal task protocol, exercised against enforcing mocks.

The mocks here deliberately *check the credential* rather than matching any
request. A mock that answers 200 to anything only proves a URL was called; it
would happily pass a client that forgot to send its lease token.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.api import (
    LEASE_TOKEN_HEADER,
    ApiRequestError,
    TaskApiClient,
    TransientApiError,
    _retry_wait,
)
from job_getter_worker.contracts.generated import PROTOCOL_VERSION, TaskProgress, TaskType
from job_getter_worker.errors import LeaseLostError, TaskFailureError

from .conftest import LEASE_TOKEN, claim_payload, lease_expiry, task_ack

BASE_URL = "http://api.internal.test"
TASK_ID = "11111111-2222-4333-8444-555555555555"
FILE_ID = "99999999-8888-4777-8666-555555555555"
AUTH = "worker-credential-for-tests"


def client(**kwargs: Any) -> TaskApiClient:
    return TaskApiClient(
        BASE_URL,
        AUTH,
        timeout_seconds=5.0,
        max_download_bytes=kwargs.pop("max_download_bytes", 10 * 1024 * 1024),
        **kwargs,
    )


def _requires_bearer(request: httpx.Request) -> httpx.Response | None:
    if request.headers.get("authorization") != f"Bearer {AUTH}":
        return httpx.Response(401, json={"error": {"code": "UNAUTHENTICATED", "message": "no"}})
    return None


# ---------------------------------------------------------------------------
# claim
# ---------------------------------------------------------------------------


@respx.mock
async def test_claim_sends_worker_identity_and_protocol_version() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        denied = _requires_bearer(request)
        if denied is not None:
            return denied
        captured.update(json.loads(request.content))
        return httpx.Response(200, json=claim_payload())

    respx.post(f"{BASE_URL}/internal/v1/tasks/claim").mock(side_effect=handler)

    async with client() as api:
        claim = await api.claim("test-worker-1", (TaskType.NOOP_ECHO, TaskType.PARSE_PROFILE))

    assert claim is not None
    assert captured["worker_id"] == "test-worker-1"
    assert captured["capabilities"] == ["noop_echo", "parse_profile"]
    assert captured["protocol_version"] == PROTOCOL_VERSION


@respx.mock
async def test_204_means_no_work_not_an_error() -> None:
    respx.post(f"{BASE_URL}/internal/v1/tasks/claim").mock(return_value=httpx.Response(204))
    async with client() as api:
        assert await api.claim("test-worker-1", (TaskType.NOOP_ECHO,)) is None


# ---------------------------------------------------------------------------
# heartbeat
# ---------------------------------------------------------------------------


@respx.mock
async def test_heartbeat_extends_the_lease_and_reports_cancellation() -> None:
    new_expiry = lease_expiry(300)
    route = respx.post(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/heartbeat").mock(
        return_value=httpx.Response(
            200, json={"cancel_requested": True, "lease_expires_at": new_expiry}
        )
    )

    async with client() as api:
        response = await api.heartbeat(
            TASK_ID, LEASE_TOKEN, TaskProgress(stage="extracting", percent=20)
        )

    assert response.cancel_requested is True
    assert response.lease_expires_at == new_expiry
    body = json.loads(route.calls[0].request.content)
    assert body["lease_token"] == LEASE_TOKEN
    assert body["progress"] == {"stage": "extracting", "percent": 20}


@respx.mock
async def test_heartbeat_409_means_the_lease_is_gone() -> None:
    respx.post(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/heartbeat").mock(
        return_value=httpx.Response(409, json={"error": {"code": "CONFLICT", "message": "stale"}})
    )
    async with client() as api:
        with pytest.raises(LeaseLostError):
            await api.heartbeat(TASK_ID, LEASE_TOKEN)


# ---------------------------------------------------------------------------
# file download - the lease token must be present
# ---------------------------------------------------------------------------


def _file_route(payload: bytes, *, chunked: bool = False) -> respx.Route:
    """A task-file route that enforces both credentials, like the real API."""

    def handler(request: httpx.Request) -> httpx.Response:
        denied = _requires_bearer(request)
        if denied is not None:
            return denied
        token = request.headers.get(LEASE_TOKEN_HEADER)
        if token is None:
            return httpx.Response(
                403,
                json={"error": {"code": "FORBIDDEN", "message": "lease token header missing"}},
            )
        if token != LEASE_TOKEN:
            return httpx.Response(
                403, json={"error": {"code": "FORBIDDEN", "message": "lease token mismatch"}}
            )
        if chunked:
            return httpx.Response(200, stream=_ChunkedStream(payload))
        return httpx.Response(200, content=payload)

    return respx.get(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/files/{FILE_ID}").mock(
        side_effect=handler
    )


class _ChunkedStream(httpx.AsyncByteStream):
    """Streams a payload in pieces so the cap is tested mid-transfer."""

    def __init__(self, payload: bytes, size: int = 1024) -> None:
        self._payload = payload
        self._size = size

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for start in range(0, len(self._payload), self._size):
            yield self._payload[start : start + self._size]


@respx.mock
async def test_download_sends_the_lease_token_header() -> None:
    route = _file_route(b"%PDF-1.7 fake")
    async with client() as api:
        data = await api.download_input_file(
            TASK_ID, FILE_ID, lease_token=LEASE_TOKEN, max_bytes=1024
        )
    assert data == b"%PDF-1.7 fake"
    assert route.calls[0].request.headers[LEASE_TOKEN_HEADER] == LEASE_TOKEN


@respx.mock
async def test_download_without_the_lease_token_is_refused() -> None:
    """Guards against a refactor quietly dropping the header."""
    _file_route(b"%PDF-1.7 fake")
    async with client() as api:
        with pytest.raises(ApiRequestError) as raised:
            await api.download_input_file(TASK_ID, FILE_ID, lease_token="", max_bytes=1024)
    assert raised.value.status_code == 403


@respx.mock
async def test_download_with_the_wrong_lease_token_is_refused() -> None:
    _file_route(b"%PDF-1.7 fake")
    async with client() as api:
        with pytest.raises(ApiRequestError) as raised:
            await api.download_input_file(
                TASK_ID, FILE_ID, lease_token="someone-elses-lease-token-000000", max_bytes=1024
            )
    assert raised.value.status_code == 403


@respx.mock
async def test_download_is_capped_while_streaming() -> None:
    _file_route(b"x" * 40_000, chunked=True)
    async with client(max_download_bytes=8_000) as api:
        with pytest.raises(TaskFailureError) as raised:
            await api.download_input_file(
                TASK_ID, FILE_ID, lease_token=LEASE_TOKEN, max_bytes=8_000
            )
    assert raised.value.code == "LIMIT_EXCEEDED"


@respx.mock
async def test_download_refuses_an_oversized_declared_length() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-length": "999999999"}, content=b"")

    respx.get(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/files/{FILE_ID}").mock(side_effect=handler)
    async with client(max_download_bytes=1024) as api:
        with pytest.raises(TaskFailureError) as raised:
            await api.download_input_file(TASK_ID, FILE_ID, lease_token=LEASE_TOKEN, max_bytes=1024)
    assert raised.value.code == "LIMIT_EXCEEDED"


# ---------------------------------------------------------------------------
# artifacts
# ---------------------------------------------------------------------------


@respx.mock
async def test_artifact_upload_carries_the_lease_token_in_the_body() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.content
        seen["has_token"] = LEASE_TOKEN.encode() in body
        if not seen["has_token"]:
            return httpx.Response(
                403, json={"error": {"code": "FORBIDDEN", "message": "no lease token"}}
            )
        return httpx.Response(
            200, json={"file_id": "22222222-3333-4444-8555-666666666666", "committed": False}
        )

    respx.post(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/artifacts").mock(side_effect=handler)

    async with client() as api:
        response = await api.upload_artifact(
            TASK_ID, LEASE_TOKEN, filename="draft.json", content=b"{}"
        )

    assert seen["has_token"] is True
    assert response.committed is False


# ---------------------------------------------------------------------------
# complete / fail
# ---------------------------------------------------------------------------


@respx.mock
async def test_complete_posts_the_result_with_the_lease_token() -> None:
    route = respx.post(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/complete").mock(
        return_value=httpx.Response(200, json=task_ack(TASK_ID))
    )
    async with client() as api:
        ack = await api.complete(TASK_ID, LEASE_TOKEN, {"echoed": "hello"})

    assert ack.state == "succeeded"
    body = json.loads(route.calls[0].request.content)
    assert body["lease_token"] == LEASE_TOKEN
    assert body["result_schema_version"] == 1


@respx.mock
async def test_complete_409_is_terminal_and_not_retried() -> None:
    """Retrying a lost lease could double-apply the work."""
    route = respx.post(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/complete").mock(
        return_value=httpx.Response(
            409, json={"error": {"code": "CONFLICT", "message": "stale lease"}}
        )
    )
    async with client() as api:
        with pytest.raises(LeaseLostError):
            await api.complete(TASK_ID, LEASE_TOKEN, {})
    assert route.call_count == 1


@respx.mock
async def test_fail_reports_a_contract_code() -> None:
    route = respx.post(f"{BASE_URL}/internal/v1/tasks/{TASK_ID}/fail").mock(
        return_value=httpx.Response(200, json=task_ack(TASK_ID, "failed"))
    )
    failure = TaskFailureError("OCR_REQUIRED", "no extractable text", retryable=False)
    async with client() as api:
        await api.fail(TASK_ID, failure.to_fail_request(LEASE_TOKEN))

    body = json.loads(route.calls[0].request.content)
    assert body["code"] == "OCR_REQUIRED"
    assert body["retryable"] is False


# ---------------------------------------------------------------------------
# retry policy
# ---------------------------------------------------------------------------


@respx.mock
async def test_4xx_is_never_retried() -> None:
    route = respx.post(f"{BASE_URL}/internal/v1/tasks/claim").mock(
        return_value=httpx.Response(
            422, json={"error": {"code": "UNPROCESSABLE", "message": "bad capability"}}
        )
    )
    async with client() as api:
        with pytest.raises(ApiRequestError):
            await api.claim("test-worker-1", (TaskType.NOOP_ECHO,))
    assert route.call_count == 1


@respx.mock
async def test_5xx_is_retried_then_succeeds() -> None:
    responses = [
        httpx.Response(503, json={"error": {"code": "INTERNAL_ERROR", "message": "down"}}),
        httpx.Response(204),
    ]
    route = respx.post(f"{BASE_URL}/internal/v1/tasks/claim").mock(side_effect=responses)
    async with client() as api:
        assert await api.claim("test-worker-1", (TaskType.NOOP_ECHO,)) is None
    assert route.call_count == 2


@respx.mock
async def test_429_retry_after_is_honoured() -> None:
    delay = 0.4
    responses = [
        httpx.Response(429, headers={"retry-after": str(delay)}, json={}),
        httpx.Response(204),
    ]
    route = respx.post(f"{BASE_URL}/internal/v1/tasks/claim").mock(side_effect=responses)

    started = time.monotonic()
    async with client() as api:
        await api.claim("test-worker-1", (TaskType.NOOP_ECHO,))
    elapsed = time.monotonic() - started

    assert route.call_count == 2
    assert elapsed >= delay


def test_retry_wait_prefers_retry_after_over_backoff() -> None:
    class _Outcome:
        @staticmethod
        def exception() -> BaseException:
            return TransientApiError("rate limited", retry_after=7.0)

    class _State:
        outcome = _Outcome()
        attempt_number = 1
        idle_for = 0.0

    assert _retry_wait(_State()) == 7.0  # type: ignore[arg-type]


def test_retry_wait_falls_back_to_jittered_backoff() -> None:
    class _Outcome:
        @staticmethod
        def exception() -> BaseException:
            return TransientApiError("connection reset")

    class _State:
        outcome = _Outcome()
        attempt_number = 2
        idle_for = 0.0

    waits = {_retry_wait(_State()) for _ in range(20)}  # type: ignore[arg-type]
    assert all(wait >= 0 for wait in waits)
    # Jitter means the backoff is not a single fixed number.
    assert len(waits) > 1
