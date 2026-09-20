"""Provider abstraction: determinism, correction bounds, budgets, no fallback."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.contracts.generated import ParseProfileResult, ProviderLimits, RateCard
from job_getter_worker.profile.truthfulness import validate_result_shape
from job_getter_worker.providers import (
    BudgetExhaustedError,
    BudgetLedger,
    FakeModelProvider,
    OllamaProvider,
    OpenAICompatibleProvider,
    ProviderInvalidOutputError,
    ProviderUnavailableError,
    build_provider,
)
from job_getter_worker.providers.base import TokenUsage
from job_getter_worker.settings import WorkerSettings

from .conftest import MODEL_FIXTURES, SettingsFactory

LIMITS = ProviderLimits(
    context_limit=8192,
    output_token_limit=2048,
    temperature=0.0,
    timeout_seconds=60,
    daily_token_budget=None,
    daily_cost_budget=None,
)

SCHEMA = ParseProfileResult.model_json_schema()


def fake(scenario: str | None = None) -> FakeModelProvider:
    return FakeModelProvider(MODEL_FIXTURES, scenario=scenario)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


async def test_fake_provider_is_deterministic_across_runs() -> None:
    results = []
    for _ in range(3):
        generation = await fake("parse_profile.text-cv").generate_structured(
            schema=SCHEMA,
            prompt="Ana Rivera",
            limits=LIMITS,
            validate=validate_result_shape,
            prompt_version="parse_profile/v1",
        )
        results.append(generation.parsed)

    assert results[0] == results[1] == results[2]
    assert results[0]["draft_facts"][0]["kind"] == "contact"


async def test_fake_provider_routes_by_document_marker() -> None:
    injection = await fake().generate_structured(
        schema=SCHEMA,
        prompt="...Blair Okonkwo, Platform Engineer...",
        limits=LIMITS,
        validate=validate_result_shape,
    )
    codes = {warning["code"] for warning in injection.parsed["warnings"]}
    assert "PROMPT_INJECTION_TEXT_IGNORED" in codes


async def test_fake_provider_reports_usage_and_metadata() -> None:
    generation = await fake("parse_profile.text-cv").generate_structured(
        schema=SCHEMA,
        prompt="Ana Rivera",
        limits=LIMITS,
        validate=validate_result_shape,
        prompt_version="parse_profile/v1",
    )
    assert generation.metadata.provider_id == "fake"
    assert generation.metadata.prompt_version == "parse_profile/v1"
    assert generation.metadata.structured_output is True
    assert generation.metadata.correction_attempts == 0
    assert generation.usage.input_tokens is not None


# ---------------------------------------------------------------------------
# The single correction attempt
# ---------------------------------------------------------------------------


async def test_malformed_then_valid_uses_exactly_one_correction() -> None:
    provider = fake("provider.malformed-then-valid")
    generation = await provider.generate_structured(
        schema=SCHEMA,
        prompt="Ana Rivera",
        limits=LIMITS,
        validate=validate_result_shape,
    )

    assert generation.parsed == {"draft_facts": [], "warnings": []}
    assert generation.metadata.correction_attempts == 1
    assert len(provider.prompts) == 2
    assert "NOT VALID AND WAS DISCARDED" in provider.prompts[1]
    # The correction restates the rules rather than relying on memory of them.
    assert "never invent a qualification" in provider.prompts[1]


async def test_always_invalid_fails_after_at_most_one_correction() -> None:
    provider = fake("provider.always-invalid")
    with pytest.raises(ProviderInvalidOutputError) as raised:
        await provider.generate_structured(
            schema=SCHEMA,
            prompt="Ana Rivera",
            limits=LIMITS,
            validate=validate_result_shape,
        )

    assert raised.value.code == "PROVIDER_INVALID_OUTPUT"
    assert len(provider.prompts) == 2, "more than one correction was attempted"
    assert raised.value.retryable is False


# ---------------------------------------------------------------------------
# ADR07 - no automatic fallback
# ---------------------------------------------------------------------------


@respx.mock
async def test_a_failing_local_provider_does_not_fall_back_to_a_cloud_provider(
    make_settings: SettingsFactory,
) -> None:
    """ADR07: a CV must never be silently uploaded because Ollama was down."""
    local = respx.get("http://localhost:11434/api/version").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    cloud = respx.post("https://api.openai.example/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": []})
    )
    cloud_models = respx.get("https://api.openai.example/v1/models").mock(
        return_value=httpx.Response(200, json={"data": []})
    )

    settings = make_settings(
        PROVIDER_DEFAULT="ollama",
        LOCAL_MODEL_BASE_URL="http://localhost:11434",
        WORKER_MODEL="llama3.2",
    )
    provider = build_provider(settings)
    assert isinstance(provider, OllamaProvider)

    with pytest.raises(ProviderUnavailableError) as raised:
        await provider.generate_structured(
            schema=SCHEMA,
            prompt="Ana Rivera",
            limits=LIMITS,
            validate=validate_result_shape,
        )
    await provider.aclose()

    assert raised.value.code == "PROVIDER_UNAVAILABLE"
    assert "any other provider" in raised.value.redacted_message
    assert local.called
    assert cloud.call_count == 0, "the worker contacted a cloud endpoint"
    assert cloud_models.call_count == 0


def test_build_provider_returns_exactly_one_provider(make_settings: SettingsFactory) -> None:
    assert build_provider(make_settings()) is None  # PROVIDER_DEFAULT=none
    assert isinstance(build_provider(make_settings(PROVIDER_DEFAULT="fake")), FakeModelProvider)
    ollama = build_provider(
        make_settings(
            PROVIDER_DEFAULT="ollama",
            LOCAL_MODEL_BASE_URL="http://localhost:11434",
            WORKER_MODEL="llama3.2",
        )
    )
    assert isinstance(ollama, OllamaProvider)
    assert not isinstance(ollama, OpenAICompatibleProvider)


# ---------------------------------------------------------------------------
# Structured-output detection
# ---------------------------------------------------------------------------


@respx.mock
async def test_ollama_detects_structured_output_from_the_server_version() -> None:
    respx.get("http://localhost:11434/api/version").mock(
        return_value=httpx.Response(200, json={"version": "0.4.7"})
    )
    generate = respx.post("http://localhost:11434/api/generate").mock(
        return_value=httpx.Response(
            200,
            json={
                "response": '{"draft_facts": [], "warnings": []}',
                "prompt_eval_count": 120,
                "eval_count": 8,
            },
        )
    )

    provider = OllamaProvider("http://localhost:11434", "llama3.2")
    generation = await provider.generate_structured(
        schema=SCHEMA, prompt="Ana Rivera", limits=LIMITS, validate=validate_result_shape
    )
    await provider.aclose()

    assert generation.metadata.structured_output is False
    body: dict[str, Any] = json.loads(generate.calls[0].request.content)
    assert "format" not in body, "a schema was sent to a server that cannot honour it"
    assert generation.usage.input_tokens == 120


@respx.mock
async def test_openai_compatible_downgrades_when_response_format_is_rejected() -> None:
    responses = [
        httpx.Response(
            400,
            json={"error": {"message": "Unsupported parameter: response_format"}},
        ),
        httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"draft_facts": [], "warnings": []}'}}],
                "usage": {"prompt_tokens": 90, "completion_tokens": 12},
            },
        ),
    ]
    route = respx.post("https://api.example.invalid/v1/chat/completions").mock(
        side_effect=responses
    )

    provider = OpenAICompatibleProvider(
        "https://api.example.invalid/v1", "some-model", api_key="sk-test-not-real"
    )
    generation = await provider.generate_structured(
        schema=SCHEMA, prompt="Ana Rivera", limits=LIMITS, validate=validate_result_shape
    )
    await provider.aclose()

    assert route.call_count == 2
    assert generation.parsed == {"draft_facts": [], "warnings": []}
    # The retry dropped the parameter rather than assuming support.
    second = json.loads(route.calls[1].request.content)
    assert "response_format" not in second


@respx.mock
async def test_provider_api_key_never_appears_in_the_result() -> None:
    respx.post("https://api.example.invalid/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"draft_facts": [], "warnings": []}'}}]},
        )
    )
    secret = "sk-super-secret-value-0000"
    provider = OpenAICompatibleProvider(
        "https://api.example.invalid/v1", "some-model", api_key=secret
    )
    generation = await provider.generate_structured(
        schema=SCHEMA, prompt="Ana Rivera", limits=LIMITS, validate=validate_result_shape
    )
    await provider.aclose()

    assert secret not in repr(generation)
    assert secret not in str(generation.parsed)
    assert secret not in str(generation.metadata)


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


def test_budget_reserves_before_the_request_and_blocks_when_exhausted() -> None:
    ledger = BudgetLedger(daily_token_budget=1000)
    reservation = ledger.reserve(400, 400)
    assert ledger.tokens_reserved == 800

    with pytest.raises(BudgetExhaustedError) as raised:
        ledger.reserve(400, 400)
    assert raised.value.code == "BUDGET_EXHAUSTED"
    assert "No request was sent" in raised.value.redacted_message

    ledger.settle(reservation, TokenUsage(input_tokens=300, output_tokens=100))
    assert ledger.tokens_used == 400
    assert ledger.tokens_reserved == 0


def test_request_cap_is_enforced_without_a_rate_card() -> None:
    ledger = BudgetLedger(requests_per_day=1)
    ledger.reserve(10, 10)
    with pytest.raises(BudgetExhaustedError):
        ledger.reserve(10, 10)


def test_unknown_price_is_recorded_as_unknown_never_zero() -> None:
    ledger = BudgetLedger(daily_token_budget=10_000)
    reservation = ledger.reserve(100, 100)
    settled = ledger.settle(reservation, TokenUsage(input_tokens=100, output_tokens=50))

    assert settled.measured_cost is None
    assert settled.cost_is_unknown is True
    assert ledger.cost_used == 0.0
    assert ledger.unknown_cost_requests == 1


def test_a_cost_cap_without_a_rate_card_is_not_enforced_but_is_reported() -> None:
    ledger = BudgetLedger(daily_cost_budget=1.0, rate_card=None)
    assert ledger.cost_cap_enforceable is False
    assert any("rate card" in note for note in ledger.notes)
    # Token and request caps still apply; the cost cap does not silently
    # become "everything is free".
    ledger.reserve(100_000, 100_000)


def test_a_cost_cap_with_a_rate_card_is_enforced() -> None:
    ledger = BudgetLedger(
        daily_cost_budget=0.01,
        rate_card=RateCard(
            currency="USD", input_cost_per_million=1000.0, output_cost_per_million=1000.0
        ),
    )
    assert ledger.cost_cap_enforceable is True
    with pytest.raises(BudgetExhaustedError):
        ledger.reserve(50_000, 50_000)


def test_settled_cost_uses_the_rate_card_when_one_exists() -> None:
    ledger = BudgetLedger(
        rate_card=RateCard(currency="USD", input_cost_per_million=2.0, output_cost_per_million=6.0)
    )
    reservation = ledger.reserve(1_000_000, 0)
    settled = ledger.settle(reservation, TokenUsage(input_tokens=1_000_000, output_tokens=0))
    assert settled.measured_cost == pytest.approx(2.0)
    assert settled.currency == "USD"
    assert settled.cost_is_unknown is False


def test_budget_settings_are_read_from_configuration(settings: WorkerSettings) -> None:
    assert settings.provider_limits.daily_token_budget is None
    assert settings.provider_daily_cost_budget is None
