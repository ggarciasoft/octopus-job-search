"""Local Ollama adapter.

Talks to an operator-allowlisted local endpoint. Nothing here reaches a cloud
provider, and nothing here falls back to one if the local model is down
(ADR07): a user who chose a local model for privacy gets an honest
``PROVIDER_UNAVAILABLE`` instead of a surprise upload.

Structured output is *detected*. Ollama gained JSON-Schema-constrained output
in 0.5.0; older builds accept only ``format: "json"``, which is not a schema.
The adapter asks the server for its version rather than assuming either.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Final

import httpx

from ..clock import utc_now
from ..contracts.generated import ProviderId, ProviderLimits, ProviderTestResult
from .base import ModelProvider, ProviderUnavailableError, RawCompletion, TokenUsage

#: First Ollama release able to constrain output with a JSON Schema.
STRUCTURED_OUTPUT_MIN_VERSION: Final = (0, 5, 0)


def _parse_version(raw: str) -> tuple[int, int, int]:
    parts = raw.strip().lstrip("v").split("-")[0].split(".")
    numbers: list[int] = []
    for part in parts[:3]:
        try:
            numbers.append(int(part))
        except ValueError:
            numbers.append(0)
    while len(numbers) < 3:
        numbers.append(0)
    return (numbers[0], numbers[1], numbers[2])


class OllamaProvider(ModelProvider):
    """Adapter for a local Ollama server."""

    provider_id = ProviderId.OLLAMA.value

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        timeout_seconds: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(model)
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
            follow_redirects=False,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _server_version(self) -> str:
        try:
            response = await self._client.get("/api/version")
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise ProviderUnavailableError(
                "The local Ollama endpoint did not respond. Check that Ollama is "
                "running and that LOCAL_MODEL_BASE_URL points at it. Nothing was sent "
                "to any other provider."
            ) from error
        payload = response.json()
        return str(payload.get("version", "0.0.0"))

    async def supports_structured_output(self) -> bool:
        version = _parse_version(await self._server_version())
        return version >= STRUCTURED_OUTPUT_MIN_VERSION

    async def probe(self) -> ProviderTestResult:
        """Connectivity and capability check, for POST /settings/providers/test."""
        started = utc_now()
        try:
            version = await self._server_version()
        except ProviderUnavailableError as error:
            return ProviderTestResult(
                reachable=False,
                structured_output_supported=None,
                model_available=None,
                latency_ms=None,
                detail=error.redacted_message,
            )

        model_available: bool | None = None
        try:
            tags = await self._client.get("/api/tags")
            tags.raise_for_status()
            names = {str(item.get("name", "")) for item in tags.json().get("models", [])}
            model_available = self.model in names or any(
                name.split(":")[0] == self.model for name in names
            )
        except (httpx.HTTPError, ValueError, AttributeError):
            model_available = None

        latency_ms = int((utc_now() - started).total_seconds() * 1000)
        structured = _parse_version(version) >= STRUCTURED_OUTPUT_MIN_VERSION
        return ProviderTestResult(
            reachable=True,
            structured_output_supported=structured,
            model_available=model_available,
            latency_ms=latency_ms,
            detail=(
                f"Ollama {version}. Schema-constrained output "
                f"{'is' if structured else 'is not'} available; without it, output is "
                "parsed and validated with a single correction attempt."
            ),
        )

    async def _complete(
        self,
        prompt: str,
        *,
        schema: Mapping[str, Any] | None,
        limits: ProviderLimits,
        attempt: int,
    ) -> RawCompletion:
        body: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": limits.temperature,
                "num_ctx": limits.context_limit,
                "num_predict": limits.output_token_limit,
            },
        }
        if schema is not None:
            body["format"] = schema

        try:
            response = await self._client.post("/api/generate", json=body)
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            raise ProviderUnavailableError(
                f"The local Ollama endpoint returned HTTP {error.response.status_code}. "
                "No other provider was contacted.",
                retryable=error.response.status_code >= 500,
            ) from error
        except httpx.HTTPError as error:
            raise ProviderUnavailableError(
                "The local Ollama endpoint could not be reached. No other provider was contacted."
            ) from error

        payload = response.json()
        return RawCompletion(
            text=str(payload.get("response", "")),
            usage=TokenUsage(
                input_tokens=payload.get("prompt_eval_count"),
                output_tokens=payload.get("eval_count"),
            ),
            structured_output=schema is not None,
        )
