"""The single model-provider interface.

``docs/spec/06_AI_PROFILE_AND_CV.md``:

    Python ModelProvider.generate_structured(schema, prompt, input, limits) ->
    parsed result, usage, model metadata. [...] Compatibility is tested, not
    assumed: detect structured-output support; otherwise parse and validate
    JSON with at most one correction attempt. Invalid output fails gracefully.

The correction rule lives here, in the base class, so every adapter obeys it
and none can quietly grant itself a second chance. Providers never fall back to
one another: ADR07 rejects automatic failover outright, and there is
deliberately no code path in this package that could perform one.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final

from ..contracts.generated import ProviderLimits
from ..errors import TaskFailureError
from ..logging import log_shape

#: A deliberately crude estimate. It is used only to reserve budget *before* a
#: request; the real usage replaces it afterwards when the provider reports it.
_CHARS_PER_TOKEN: Final = 4

_JSON_BLOCK = re.compile(r"```(?:json)?\s*(?P<body>.+?)\s*```", re.DOTALL)


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // _CHARS_PER_TOKEN)


@dataclass(frozen=True)
class TokenUsage:
    """What a request actually cost, in tokens.

    ``None`` means the provider did not report the figure. It never means zero:
    an unknown quantity recorded as zero is a silent under-count of a budget.
    """

    input_tokens: int | None = None
    output_tokens: int | None = None

    @property
    def total(self) -> int | None:
        if self.input_tokens is None and self.output_tokens is None:
            return None
        return (self.input_tokens or 0) + (self.output_tokens or 0)


@dataclass(frozen=True)
class ModelMetadata:
    """Reproducibility metadata recorded alongside every result."""

    provider_id: str
    model: str
    prompt_version: str
    structured_output: bool
    correction_attempts: int


@dataclass(frozen=True)
class GenerationResult:
    """Parsed result, usage and model metadata - the spec's three returns."""

    parsed: Any
    usage: TokenUsage
    metadata: ModelMetadata


@dataclass(frozen=True)
class RawCompletion:
    """One raw response from an adapter, before any validation."""

    text: str
    usage: TokenUsage
    structured_output: bool


class ProviderUnavailableError(TaskFailureError):
    """The configured provider could not be reached or refused the request.

    Raised as ``PROVIDER_UNAVAILABLE``. Crucially, nothing catches this to try
    a *different* provider (ADR07): the user who configured a local model for
    privacy reasons must never have their CV sent to a cloud API instead.
    """

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__("PROVIDER_UNAVAILABLE", message, retryable=retryable)


class ProviderInvalidOutputError(TaskFailureError):
    """The provider returned something that is not a valid result."""

    def __init__(self, message: str) -> None:
        super().__init__("PROVIDER_INVALID_OUTPUT", message, retryable=False)


def extract_json_object(text: str) -> Any:
    """Parse a JSON object out of a model response.

    Tolerates a fenced code block and leading prose, because many models add
    them, but never repairs the JSON itself: a truncated object is an invalid
    result, not something to guess the end of.
    """
    candidate = text.strip()
    if not candidate:
        raise ValueError("empty response")

    fenced = _JSON_BLOCK.search(candidate)
    if fenced is not None:
        candidate = fenced.group("body").strip()

    if not candidate.startswith("{"):
        start = candidate.find("{")
        if start == -1:
            raise ValueError("no JSON object in response")
        candidate = candidate[start:]

    return json.loads(candidate)


class ModelProvider(ABC):
    """Base class implementing the schema/correction/limits contract."""

    #: Provider identifier from the generated ``ProviderId`` enum.
    provider_id: str = "none"

    def __init__(self, model: str) -> None:
        self.model = model
        self._structured_output_supported: bool | None = None

    # -- adapter surface ---------------------------------------------------------

    @abstractmethod
    async def _complete(
        self,
        prompt: str,
        *,
        schema: Mapping[str, Any] | None,
        limits: ProviderLimits,
        attempt: int,
    ) -> RawCompletion:
        """Perform one request. ``schema`` is ``None`` when unstructured."""

    @abstractmethod
    async def supports_structured_output(self) -> bool:
        """Detect, do not assume, whether the endpoint can enforce a schema."""

    async def aclose(self) -> None:  # pragma: no cover - overridden where needed
        """Release any network resources. Adapters without any do nothing."""
        return None

    # -- the contract ------------------------------------------------------------

    async def generate_structured(
        self,
        *,
        schema: Mapping[str, Any],
        prompt: str,
        # `input` shadows a builtin, but the parameter name is fixed by the
        # spec's published signature; renaming it would hide the contract.
        input: str | None = None,  # noqa: A002
        limits: ProviderLimits,
        validate: Callable[[Any], Any],
        prompt_version: str = "unversioned",
    ) -> GenerationResult:
        """Request a structured result, validating it before returning.

        Args:
            schema: the closed JSON Schema the output must satisfy.
            prompt: the fully built prompt, already treating input as data.
            input: optional extra input appended to the prompt by the adapter.
            limits: context/output/temperature/timeout from provider settings.
            validate: raises if the decoded object is not an acceptable result.
            prompt_version: recorded in the returned metadata.

        Raises:
            ProviderInvalidOutputError: after at most one correction attempt.
            ProviderUnavailableError: if the endpoint could not be reached.
        """
        if self._structured_output_supported is None:
            self._structured_output_supported = await self.supports_structured_output()
        structured = self._structured_output_supported

        full_prompt = prompt if input is None else f"{prompt}\n\n{input}"
        corrections = 0
        last_reason = "no response"
        usage = TokenUsage()

        # Attempt 0 is the request; attempt 1 is the single permitted
        # correction. There is no attempt 2: a provider that cannot produce
        # valid output twice is failing, and pretending otherwise would mean
        # coercing invalid output into shape.
        for attempt in range(2):
            completion = await self._complete(
                full_prompt if attempt == 0 else self._correction_prompt(full_prompt, last_reason),
                schema=dict(schema) if structured else None,
                limits=limits,
                attempt=attempt,
            )
            usage = completion.usage
            try:
                decoded = extract_json_object(completion.text)
                parsed = validate(decoded)
            except Exception as error:
                last_reason = type(error).__name__
                corrections = attempt + 1
                log_shape(
                    "provider.invalid_output",
                    provider=self.provider_id,
                    attempt=attempt,
                    reason=last_reason,
                    response_chars=len(completion.text),
                )
                continue

            return GenerationResult(
                parsed=parsed,
                usage=usage,
                metadata=ModelMetadata(
                    provider_id=self.provider_id,
                    model=self.model,
                    prompt_version=prompt_version,
                    structured_output=structured,
                    correction_attempts=attempt,
                ),
            )

        raise ProviderInvalidOutputError(
            f"The {self.provider_id} provider did not return a result matching the "
            f"required schema, and the single permitted correction attempt also failed "
            f"({last_reason}). Nothing was inferred from this document. "
            f"corrections_attempted={corrections}"
        )

    @staticmethod
    def _correction_prompt(original: str, reason: str) -> str:
        """The one and only correction request.

        It repeats the constraints rather than referring back to them, so the
        correction cannot become a gap through which the rules are dropped.
        """
        return (
            f"{original}\n\n"
            "YOUR PREVIOUS RESPONSE WAS NOT VALID AND WAS DISCARDED "
            f"(reason: {reason}).\n"
            "Reply with one JSON object only, matching the schema exactly, with no "
            "prose, no code fence and no commentary. All the rules above still apply: "
            "use only facts present in the document, and never invent a qualification."
        )
