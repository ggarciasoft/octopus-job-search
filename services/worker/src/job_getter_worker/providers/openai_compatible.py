"""Adapter for any OpenAI-compatible ``/chat/completions`` endpoint.

"OpenAI-compatible" is a spectrum, so compatibility is *detected*:

1. The adapter asks for ``response_format: {"type": "json_schema", ...}``.
2. If the endpoint rejects that parameter, the adapter records that this
   endpoint cannot constrain output, and from then on parses and validates the
   JSON itself - with the single correction attempt the base class allows.

The API key is read from settings, sent in the ``Authorization`` header, and
never logged, never echoed back and never placed in a result. There is no
fallback to or from any other provider (ADR07).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Final

import httpx

from ..clock import utc_now
from ..contracts.generated import ProviderId, ProviderLimits, ProviderTestResult
from ..logging import log_shape
from .base import ModelProvider, ProviderUnavailableError, RawCompletion, TokenUsage

#: Response-format rejections look different on every server; these are the
#: substrings that reliably mean "I do not support this parameter".
_UNSUPPORTED_MARKERS: Final = (
    "response_format",
    "json_schema",
    "unsupported parameter",
    "unknown field",
)


class OpenAICompatibleProvider(ModelProvider):
    """Adapter for a hosted or self-hosted OpenAI-compatible endpoint."""

    provider_id = ProviderId.OPENAI_COMPATIBLE.value

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        api_key: str | None = None,
        timeout_seconds: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(model)
        headers = {"content-type": "application/json"}
        if api_key:
            headers["authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
            headers=headers,
            transport=transport,
            follow_redirects=False,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def supports_structured_output(self) -> bool:
        """Assume yes, then downgrade on the first rejection.

        Probing with a real request would cost a call on every start; the
        detection therefore happens on the first live request and is remembered
        for the process lifetime.
        """
        return True

    async def probe(self) -> ProviderTestResult:
        """Connectivity check for POST /settings/providers/test.

        Only the configured base URL is contacted. This is never a general
        "fetch a URL" facility - ``docs/spec/04_API_CONTRACTS.md`` says the test
        route must "never arbitrary URL fetch".
        """
        started = utc_now()
        try:
            response = await self._client.get("/models")
            response.raise_for_status()
        except httpx.HTTPError as error:
            return ProviderTestResult(
                reachable=False,
                structured_output_supported=None,
                model_available=None,
                latency_ms=None,
                detail=f"The endpoint did not respond ({type(error).__name__}).",
            )

        try:
            names = {str(item.get("id", "")) for item in response.json().get("data", [])}
        except (ValueError, AttributeError):
            names = set()

        return ProviderTestResult(
            reachable=True,
            structured_output_supported=None,
            model_available=(self.model in names) if names else None,
            latency_ms=int((utc_now() - started).total_seconds() * 1000),
            detail=(
                "The endpoint responded. Schema-constrained output is detected on the "
                "first real request, not assumed."
            ),
        )

    def _body(
        self, prompt: str, *, schema: Mapping[str, Any] | None, limits: ProviderLimits
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": limits.temperature,
            "max_tokens": limits.output_token_limit,
        }
        if schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "result", "schema": dict(schema), "strict": True},
            }
        return body

    async def _complete(
        self,
        prompt: str,
        *,
        schema: Mapping[str, Any] | None,
        limits: ProviderLimits,
        attempt: int,
    ) -> RawCompletion:
        response = await self._post(self._body(prompt, schema=schema, limits=limits))

        if response.status_code == 400 and schema is not None and _rejects_schema(response):
            # Detected, not assumed: this endpoint cannot constrain output.
            # Remember it and continue without the parameter. The base class
            # still validates the result and still allows only one correction.
            self._structured_output_supported = False
            log_shape(
                "provider.structured_output_unsupported",
                provider=self.provider_id,
                status=response.status_code,
            )
            response = await self._post(self._body(prompt, schema=None, limits=limits))

        if response.status_code >= 400:
            raise ProviderUnavailableError(
                f"The configured model endpoint returned HTTP {response.status_code}. "
                "No other provider was contacted and no data was sent anywhere else.",
                retryable=response.status_code >= 500 or response.status_code == 429,
            )

        payload = response.json()
        choices = payload.get("choices") or []
        text = ""
        if choices:
            text = str((choices[0].get("message") or {}).get("content") or "")
        usage_payload = payload.get("usage") or {}
        return RawCompletion(
            text=text,
            usage=TokenUsage(
                input_tokens=usage_payload.get("prompt_tokens"),
                output_tokens=usage_payload.get("completion_tokens"),
            ),
            structured_output=schema is not None,
        )

    async def _post(self, body: dict[str, Any]) -> httpx.Response:
        try:
            return await self._client.post("/chat/completions", json=body)
        except httpx.HTTPError as error:
            raise ProviderUnavailableError(
                "The configured model endpoint could not be reached. No other provider "
                "was contacted."
            ) from error


def _rejects_schema(response: httpx.Response) -> bool:
    """True when a 400 is specifically about ``response_format``."""
    try:
        detail = str(response.json()).lower()
    except ValueError:
        detail = response.text.lower()
    return any(marker in detail for marker in _UNSUPPORTED_MARKERS)
