"""The poll / lease / heartbeat loop, end to end against mocked HTTP.

These are behaviour tests: each asserts what the worker *did to the protocol*,
not that a mock was called.
"""

from __future__ import annotations

import json
import platform
from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.api import TaskApiClient
from job_getter_worker.contracts.generated import HEARTBEAT_SECONDS
from job_getter_worker.handlers import build_default_registry
from job_getter_worker.settings import WorkerSettings
from job_getter_worker.worker import Worker

from .conftest import LEASE_TOKEN, claim_payload, lease_expiry, task_ack

BASE_URL = "http://api.internal.test"
TASK_ID = "11111111-2222-4333-8444-555555555555"


def api_client() -> TaskApiClient:
    return TaskApiClient(
        BASE_URL,
        "worker-credential-for-tests",
        timeout_seconds=5.0,
        max_download_bytes=10 * 1024 * 1024,
    )


def route(path: str) -> str:
    return f"{BASE_URL}/internal/v1/tasks/{path}"


def bodies(mocked: respx.Route) -> list[dict[str, Any]]:
    return [json.loads(call.request.content) for call in mocked.calls]


# ---------------------------------------------------------------------------


@respx.mock
async def test_claim_to_complete_happy_path(settings: WorkerSettings) -> None:
    respx.post(route("claim")).mock(
        side_effect=[
            httpx.Response(200, json=claim_payload(task_id=TASK_ID)),
            httpx.Response(204),
        ]
    )
    complete = respx.post(route(f"{TASK_ID}/complete")).mock(
        return_value=httpx.Response(200, json=task_ack(TASK_ID))
    )

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry())
        assert await worker.run_once() is True

    assert complete.call_count == 1
    body = bodies(complete)[0]
    assert body["lease_token"] == LEASE_TOKEN
    result = body["result"]
    assert result["echoed"] == "hello"
    assert result["worker_id"] == "test-worker-1"
    # The runtime is the real interpreter, not a placeholder string.
    assert platform.python_version() in result["worker_runtime"]


@respx.mock
async def test_204_leaves_the_worker_idle(settings: WorkerSettings) -> None:
    respx.post(route("claim")).mock(return_value=httpx.Response(204))
    complete = respx.post(route(f"{TASK_ID}/complete"))

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry())
        assert await worker.run_once() is False

    assert complete.call_count == 0


@respx.mock
async def test_heartbeat_carries_progress_and_extends_the_lease(
    settings: WorkerSettings,
) -> None:
    extended = lease_expiry(600)
    respx.post(route("claim")).mock(
        return_value=httpx.Response(
            200,
            json=claim_payload(task_id=TASK_ID, task_input={"message": "slow", "delay_ms": 400}),
        )
    )
    heartbeat = respx.post(route(f"{TASK_ID}/heartbeat")).mock(
        return_value=httpx.Response(
            200, json={"cancel_requested": False, "lease_expires_at": extended}
        )
    )
    complete = respx.post(route(f"{TASK_ID}/complete")).mock(
        return_value=httpx.Response(200, json=task_ack(TASK_ID))
    )

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry(), heartbeat_seconds=0.05)
        await worker.run_once()

    assert heartbeat.call_count >= 2
    sent = bodies(heartbeat)
    assert sent[0]["lease_token"] == LEASE_TOKEN
    assert sent[-1]["progress"]["stage"] == "sleeping"
    assert complete.call_count == 1


@respx.mock
async def test_cancel_requested_stops_the_handler_and_fails_with_cancelled(
    settings: WorkerSettings,
) -> None:
    """Running work stops at its next safe checkpoint, and nothing is applied."""
    respx.post(route("claim")).mock(
        return_value=httpx.Response(
            200,
            json=claim_payload(task_id=TASK_ID, task_input={"message": "slow", "delay_ms": 5000}),
        )
    )
    respx.post(route(f"{TASK_ID}/heartbeat")).mock(
        return_value=httpx.Response(
            200, json={"cancel_requested": True, "lease_expires_at": lease_expiry(600)}
        )
    )
    complete = respx.post(route(f"{TASK_ID}/complete"))
    fail = respx.post(route(f"{TASK_ID}/fail")).mock(
        return_value=httpx.Response(200, json=task_ack(TASK_ID, "cancelled"))
    )

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry(), heartbeat_seconds=0.05)
        await worker.run_once()

    assert complete.call_count == 0
    assert fail.call_count == 1
    body = bodies(fail)[0]
    assert body["code"] == "CANCELLED"
    assert body["retryable"] is False


@respx.mock
async def test_lease_lost_on_heartbeat_abandons_without_completing(
    settings: WorkerSettings,
) -> None:
    """The API already handed the task to someone else. Do not finish it."""
    respx.post(route("claim")).mock(
        return_value=httpx.Response(
            200,
            json=claim_payload(task_id=TASK_ID, task_input={"message": "slow", "delay_ms": 5000}),
        )
    )
    respx.post(route(f"{TASK_ID}/heartbeat")).mock(
        return_value=httpx.Response(
            409, json={"error": {"code": "CONFLICT", "message": "reclaimed"}}
        )
    )
    complete = respx.post(route(f"{TASK_ID}/complete"))
    fail = respx.post(route(f"{TASK_ID}/fail"))

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry(), heartbeat_seconds=0.05)
        await worker.run_once()

    assert complete.call_count == 0
    assert fail.call_count == 0


@respx.mock
async def test_expired_lease_abandons_without_completing(settings: WorkerSettings) -> None:
    respx.post(route("claim")).mock(
        return_value=httpx.Response(
            200,
            json=claim_payload(
                task_id=TASK_ID,
                task_input={"message": "slow", "delay_ms": 5000},
                lease_seconds=0,
            ),
        )
    )
    heartbeat = respx.post(route(f"{TASK_ID}/heartbeat"))
    complete = respx.post(route(f"{TASK_ID}/complete"))
    fail = respx.post(route(f"{TASK_ID}/fail"))

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry(), heartbeat_seconds=0.05)
        await worker.run_once()

    # The clock, not the server, told us the lease was gone, so the worker did
    # not even send the heartbeat.
    assert heartbeat.call_count == 0
    assert complete.call_count == 0
    assert fail.call_count == 0


@respx.mock
async def test_complete_conflict_is_terminal(settings: WorkerSettings) -> None:
    respx.post(route("claim")).mock(
        return_value=httpx.Response(200, json=claim_payload(task_id=TASK_ID))
    )
    complete = respx.post(route(f"{TASK_ID}/complete")).mock(
        return_value=httpx.Response(
            409, json={"error": {"code": "CONFLICT", "message": "stale lease"}}
        )
    )
    fail = respx.post(route(f"{TASK_ID}/fail"))

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry())
        await worker.run_once()

    assert complete.call_count == 1
    # A 409 on complete is not a failure to report; it is someone else's task.
    assert fail.call_count == 0


@respx.mock
async def test_deterministic_handler_failure_reports_its_code(
    settings: WorkerSettings,
) -> None:
    respx.post(route("claim")).mock(
        return_value=httpx.Response(
            200,
            json=claim_payload(
                task_id=TASK_ID, task_input={"message": "boom", "fail_with": "TIMEOUT"}
            ),
        )
    )
    fail = respx.post(route(f"{TASK_ID}/fail")).mock(
        return_value=httpx.Response(200, json=task_ack(TASK_ID, "failed"))
    )

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry())
        await worker.run_once()

    assert bodies(fail)[0]["code"] == "TIMEOUT"


@respx.mock
async def test_unknown_task_type_fails_the_task_not_the_loop(
    settings: WorkerSettings,
) -> None:
    respx.post(route("claim")).mock(
        side_effect=[
            httpx.Response(
                200, json=claim_payload(task_id=TASK_ID, task_type="render_cv", task_input={})
            ),
            httpx.Response(204),
        ]
    )
    fail = respx.post(route(f"{TASK_ID}/fail")).mock(
        return_value=httpx.Response(200, json=task_ack(TASK_ID, "failed"))
    )

    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry())
        assert await worker.run_once() is True
        # The loop is still healthy and keeps polling.
        assert await worker.run_once() is False

    assert bodies(fail)[0]["code"] == "UNSUPPORTED_TASK_TYPE"


@respx.mock
async def test_transient_claim_failure_does_not_crash_the_loop(
    settings: WorkerSettings,
) -> None:
    respx.post(route("claim")).mock(side_effect=httpx.ConnectError("no route to host"))
    async with api_client() as api:
        worker = Worker(settings, api, build_default_registry())
        assert await worker.run_once() is False


async def test_worker_refuses_to_start_without_a_matching_handler(
    make_settings: Any,
) -> None:
    """Declared capabilities and registered handlers must agree.

    ``render_cv`` is the example because it is declared in the task registry
    but has no handler yet. When M3 gives it one, move this to the next
    unimplemented type rather than deleting the test: the check it makes is
    about the agreement itself, not about any particular task.
    """
    settings = make_settings(WORKER_CAPABILITIES="noop_echo,render_cv")
    async with api_client() as api:
        with pytest.raises(RuntimeError, match="render_cv"):
            Worker(settings, api, build_default_registry())


def test_heartbeat_interval_comes_from_the_contract(settings: WorkerSettings) -> None:
    api = api_client()
    try:
        worker = Worker(settings, api, build_default_registry())
        assert worker.heartbeat_seconds == float(HEARTBEAT_SECONDS)
    finally:
        pass
