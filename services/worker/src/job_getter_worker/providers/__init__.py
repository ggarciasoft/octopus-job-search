"""Model providers.

One interface, three adapters, and **no fallback between them**. ADR07:

    Explicitly rejected: automatic failover to a different provider. A user who
    configured a local model for privacy reasons must never have their CV
    silently sent to a cloud API.

:func:`build_provider` therefore returns exactly one provider, chosen by
configuration. If it fails, the task fails; nothing here selects a second one.
"""

from __future__ import annotations

from pathlib import Path

from ..contracts.generated import ProviderId, RateCard
from ..settings import WorkerSettings
from .base import (
    GenerationResult,
    ModelMetadata,
    ModelProvider,
    ProviderInvalidOutputError,
    ProviderUnavailableError,
    RawCompletion,
    TokenUsage,
    estimate_tokens,
)
from .budget import BudgetExhaustedError, BudgetLedger, Reservation, SettledUsage
from .fake import FakeModelProvider
from .ollama import OllamaProvider
from .openai_compatible import OpenAICompatibleProvider


def _fake_fixture_dir(settings: WorkerSettings) -> Path:
    """Where the fake provider reads recorded responses from."""
    if settings.fake_fixture_dir:
        return Path(settings.fake_fixture_dir)
    return Path("fixtures") / "model-responses"


class ProviderNotConfiguredError(RuntimeError):
    """No provider is configured. Manual profile entry still works (AT28)."""


def build_provider(
    settings: WorkerSettings, *, fixture_dir: Path | None = None
) -> ModelProvider | None:
    """Construct the single configured provider, or ``None`` if there is none.

    Returning ``None`` is a supported state, not an error: without a model the
    worker still extracts text, reports what it found and proposes nothing,
    which is what AT28 ("No AI configured") requires.
    """
    provider = settings.provider

    if provider is ProviderId.NONE:
        return None

    if provider is ProviderId.FAKE:
        directory = fixture_dir or _fake_fixture_dir(settings)
        return FakeModelProvider(
            directory, model=settings.provider_model or "fake-deterministic-v1"
        )

    if provider is ProviderId.OLLAMA:
        if not settings.provider_base_url:
            raise ProviderNotConfiguredError(
                "PROVIDER_DEFAULT=ollama requires LOCAL_MODEL_BASE_URL to point at the "
                "local Ollama endpoint."
            )
        if not settings.provider_model:
            raise ProviderNotConfiguredError(
                "PROVIDER_DEFAULT=ollama requires WORKER_MODEL. Model selection is "
                "explicit; the worker will not pick one for you."
            )
        return OllamaProvider(
            settings.provider_base_url,
            settings.provider_model,
            timeout_seconds=float(settings.provider_timeout_seconds),
        )

    if not settings.provider_base_url:
        raise ProviderNotConfiguredError(
            "PROVIDER_DEFAULT=openai_compatible requires a base URL for the endpoint."
        )
    if not settings.provider_model:
        raise ProviderNotConfiguredError(
            "PROVIDER_DEFAULT=openai_compatible requires WORKER_MODEL. Model selection "
            "is explicit; the worker will not pick one for you."
        )
    return OpenAICompatibleProvider(
        settings.provider_base_url,
        settings.provider_model,
        api_key=(
            settings.provider_api_key.get_secret_value() if settings.provider_api_key else None
        ),
        timeout_seconds=float(settings.provider_timeout_seconds),
    )


def build_rate_card(settings: WorkerSettings) -> RateCard | None:
    """Build a rate card only when every part of it is configured.

    A partial rate card would produce a partly invented price, so there is no
    such thing here: either all three values are present, or the price is
    unknown.
    """
    if (
        settings.provider_rate_currency is None
        or settings.provider_input_cost_per_million is None
        or settings.provider_output_cost_per_million is None
    ):
        return None
    return RateCard(
        currency=settings.provider_rate_currency,
        input_cost_per_million=settings.provider_input_cost_per_million,
        output_cost_per_million=settings.provider_output_cost_per_million,
    )


def build_budget(settings: WorkerSettings) -> BudgetLedger:
    return BudgetLedger(
        daily_token_budget=settings.provider_daily_token_budget,
        daily_cost_budget=settings.provider_daily_cost_budget,
        requests_per_day=settings.provider_requests_per_day,
        rate_card=build_rate_card(settings),
    )


__all__ = [
    "BudgetExhaustedError",
    "BudgetLedger",
    "FakeModelProvider",
    "GenerationResult",
    "ModelMetadata",
    "ModelProvider",
    "OllamaProvider",
    "OpenAICompatibleProvider",
    "ProviderInvalidOutputError",
    "ProviderNotConfiguredError",
    "ProviderUnavailableError",
    "RawCompletion",
    "Reservation",
    "SettledUsage",
    "TokenUsage",
    "build_budget",
    "build_provider",
    "build_rate_card",
    "estimate_tokens",
]
