"""Shared fixtures.

Everything here is deterministic and offline. The document corpus comes from
``fixtures/`` at the repository root, which is generated, checksummed and
property-verified by its own tooling.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from job_getter_worker.clock import to_timestamp_string, utc_now
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
