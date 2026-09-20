"""The deterministic provider CI runs on.

Replays ``fixtures/model-responses/*.json``. No network, no key, no cost and no
clock: the same input produces the same bytes on every machine, so a failure is
a regression rather than an environmental accident.

Two fixture shapes are supported:

* ``parse_profile.*.json`` - a complete, well-formed result object.
* ``provider.*.json`` - an ``attempts`` list of raw strings with a ``valid``
  flag, which is how the malformed-then-valid and always-invalid correction
  paths get exercised.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Final

from ..contracts.generated import ProviderId, ProviderLimits
from .base import ModelProvider, RawCompletion, TokenUsage, estimate_tokens

#: Which fixture answers which document, chosen by a marker that appears in the
#: document text. Routing is explicit and ordered so it is reproducible; it is
#: fixture selection, not inference.
DEFAULT_ROUTES: Final[tuple[tuple[str, str], ...]] = (
    ("Blair Okonkwo", "parse_profile.prompt-injection-cv"),
    ("Sam Delgado", "parse_profile.ambiguous"),
    ("Ana Rivera", "parse_profile.text-cv"),
)

FALLBACK_SCENARIO: Final = "parse_profile.empty"


class FakeModelProvider(ModelProvider):
    """Replays a recorded response instead of calling a model."""

    provider_id = ProviderId.FAKE.value

    def __init__(
        self,
        fixture_dir: Path,
        *,
        model: str = "fake-deterministic-v1",
        scenario: str | None = None,
        routes: tuple[tuple[str, str], ...] = DEFAULT_ROUTES,
        structured_output: bool = True,
    ) -> None:
        super().__init__(model)
        self._fixture_dir = fixture_dir
        self._scenario = scenario
        self._routes = routes
        self._structured = structured_output
        #: Every prompt this provider was asked to answer, so a test can assert
        #: what was (and was not) sent to the model.
        self.prompts: list[str] = []

    async def supports_structured_output(self) -> bool:
        return self._structured

    def _select_scenario(self, prompt: str) -> str:
        if self._scenario is not None:
            return self._scenario
        for marker, scenario in self._routes:
            if marker in prompt:
                return scenario
        return FALLBACK_SCENARIO

    def _load(self, scenario: str) -> Any:
        if scenario == FALLBACK_SCENARIO:
            return {"draft_facts": [], "warnings": []}
        path = self._fixture_dir / f"{scenario}.json"
        if not path.is_file():
            raise FileNotFoundError(f"fake provider scenario {scenario!r} has no fixture at {path}")
        return json.loads(path.read_text(encoding="utf-8"))

    async def _complete(
        self,
        prompt: str,
        *,
        schema: Mapping[str, Any] | None,
        limits: ProviderLimits,
        attempt: int,
    ) -> RawCompletion:
        self.prompts.append(prompt)
        payload = self._load(self._select_scenario(prompt))

        if isinstance(payload, dict) and isinstance(payload.get("attempts"), list):
            attempts: list[Any] = payload["attempts"]
            # Clamp rather than wrap: the base class only ever asks twice, and a
            # fixture with a single attempt should keep returning that attempt.
            chosen = attempts[min(attempt, len(attempts) - 1)]
            text = str(chosen.get("raw", ""))
        else:
            text = json.dumps(payload, sort_keys=True)

        # Deterministic, prompt-derived "usage". A fake provider reports usage
        # because the budget path must be exercisable without a real bill.
        input_tokens = estimate_tokens(prompt)
        output_tokens = estimate_tokens(text)
        return RawCompletion(
            text=text,
            usage=TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens),
            structured_output=self._structured,
        )
