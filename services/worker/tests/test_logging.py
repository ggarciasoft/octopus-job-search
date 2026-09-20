"""Logging redaction.

``docs/spec/09_SECURITY_PRIVACY.md``: "Do not log CV text, answers, tokens or
raw prompts."
"""

from __future__ import annotations

import io

import pytest

from job_getter_worker.logging import (
    REDACTED_PLACEHOLDER,
    configure_logging,
    get_logger,
    log_shape,
)


def test_sensitive_keys_are_redacted() -> None:
    stream = io.StringIO()
    configure_logging("info", stream=stream)
    get_logger("test").info(
        "something.happened",
        lease_token="lease-token-0123456789abcdef0123456789",
        source_excerpt="Ana Rivera, Senior Backend Engineer at Northwind Logistics",
        prompt="RULES: never invent a qualification",
        api_key="sk-live-should-never-appear",
        chars=4821,
    )
    output = stream.getvalue()

    assert "lease-token-0123456789abcdef0123456789" not in output
    assert "Northwind Logistics" not in output
    assert "sk-live-should-never-appear" not in output
    assert "never invent a qualification" not in output
    assert output.count(REDACTED_PLACEHOLDER) >= 4
    # The shape survives: an operator can still see the fields were present.
    assert '"chars": 4821' in output or '"chars":4821' in output


def test_log_shape_refuses_a_content_bearing_key() -> None:
    configure_logging("info", stream=io.StringIO())
    with pytest.raises(ValueError, match="carries content"):
        log_shape("parse.done", source_excerpt="Ana Rivera")


def test_log_shape_refuses_something_that_looks_like_document_text() -> None:
    configure_logging("info", stream=io.StringIO())
    with pytest.raises(ValueError, match="document text"):
        log_shape("parse.done", stage="Ana Rivera\nSenior Backend Engineer")


def test_log_shape_emits_counts() -> None:
    stream = io.StringIO()
    configure_logging("info", stream=stream)
    log_shape("parse_profile.extracted", chars=4821, proposed_facts=23, pages=2)
    output = stream.getvalue()
    assert "4821" in output
    assert "23" in output
    assert "parse_profile.extracted" in output
