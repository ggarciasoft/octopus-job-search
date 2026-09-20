"""Configuration behaviour, including the capability safety rule."""

from __future__ import annotations

import pytest

from job_getter_worker.contracts.generated import RUNNER_ONLY_CAPABILITIES, TaskType
from job_getter_worker.handlers import build_default_registry
from job_getter_worker.settings import CapabilityConfigurationError

from .conftest import SettingsFactory


def test_capabilities_are_parsed_against_the_generated_enum(
    make_settings: SettingsFactory,
) -> None:
    settings = make_settings(WORKER_CAPABILITIES=" noop_echo , parse_profile ,noop_echo ")
    assert settings.declared_capabilities == (TaskType.NOOP_ECHO, TaskType.PARSE_PROFILE)


def test_container_worker_refuses_to_start_with_fill_local(
    make_settings: SettingsFactory,
) -> None:
    """A headless container is not the user's desktop browser (ADR05)."""
    assert "fill_local" in RUNNER_ONLY_CAPABILITIES

    with pytest.raises(CapabilityConfigurationError) as raised:
        make_settings(WORKER_CAPABILITIES="noop_echo,fill_local")

    message = str(raised.value)
    assert "fill_local" in message
    assert "desktop" in message
    assert "job-getter-runner pair" in message


def test_unknown_capability_is_rejected(make_settings: SettingsFactory) -> None:
    with pytest.raises(CapabilityConfigurationError) as raised:
        make_settings(WORKER_CAPABILITIES="noop_echo,teleport")
    assert "teleport" in str(raised.value)


def test_empty_capabilities_are_rejected(make_settings: SettingsFactory) -> None:
    with pytest.raises(CapabilityConfigurationError):
        make_settings(WORKER_CAPABILITIES=" , ")


def test_bad_log_level_is_rejected(make_settings: SettingsFactory) -> None:
    with pytest.raises(Exception, match="LOG_LEVEL"):
        make_settings(LOG_LEVEL="chatty")


def test_parse_limits_default_to_the_spec_bounds(make_settings: SettingsFactory) -> None:
    settings = make_settings()
    assert settings.max_pdf_pages == 100
    assert settings.max_extracted_chars == 200_000
    assert settings.max_docx_uncompressed_bytes == 50 * 1024 * 1024
    assert settings.max_download_bytes == 10 * 1024 * 1024


def test_provider_limits_use_the_generated_model(make_settings: SettingsFactory) -> None:
    settings = make_settings(
        WORKER_PROVIDER_CONTEXT_LIMIT="16384",
        WORKER_PROVIDER_OUTPUT_TOKEN_LIMIT="2048",
    )
    limits = settings.provider_limits
    assert limits.context_limit == 16384
    assert limits.output_token_limit == 2048
    assert limits.daily_token_budget is None


def test_registry_refuses_capabilities_it_cannot_serve() -> None:
    registry = build_default_registry()
    registry.assert_capabilities_supported((TaskType.NOOP_ECHO, TaskType.PARSE_PROFILE))

    with pytest.raises(RuntimeError) as raised:
        registry.assert_capabilities_supported((TaskType.RENDER_CV,))
    assert "render_cv" in str(raised.value)
