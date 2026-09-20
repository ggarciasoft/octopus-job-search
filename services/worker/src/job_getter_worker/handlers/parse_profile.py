"""The ``parse_profile`` handler (M1).

The pipeline, and the reason for each step:

1. **Fetch** the declared input file through the task-scoped endpoint, or take
   the pasted text from the task input. Nothing else is reachable.
2. **Extract** text with bounds, preserving page/paragraph locators.
3. **Sanitize** - remove any text in the document that addresses an AI system,
   so it is neither sent to the model nor usable as evidence (AT09).
4. **Build the prompt** from versioned constants, with the document clearly
   marked as untrusted data.
5. **Generate** through the one configured provider, with budget reserved
   beforehand and settled afterwards.
6. **Validate** every proposed fact against the document and drop anything that
   is not in it (invariant 2).
7. **Return** draft facts with recomputed provenance. Nothing is confirmed:
   ``docs/spec/06`` is explicit that "No extracted field is verified until user
   confirmation."

The handler never writes anything anywhere. It returns a result; the API
applies it (ADR03).
"""

from __future__ import annotations

import asyncio
from typing import Any

from ..contracts.generated import (
    ParseProfileInput,
    ParseProfileResult,
    ParseProfileResultProvider,
    ProfileImportWarning,
)
from ..errors import TaskFailureError
from ..extraction import ExtractionLimits, extract_document, is_short
from ..logging import log_shape
from ..profile.sanitize import SanitizedDocument, sanitize_document
from ..profile.truthfulness import (
    MAX_WARNINGS,
    ValidatedFacts,
    validate_draft_facts,
    validate_result_shape,
)
from ..prompts import build_parse_profile_prompt
from ..providers import (
    ModelProvider,
    build_budget,
    build_provider,
    estimate_tokens,
)
from ..providers.base import GenerationResult
from . import TaskContext

#: The closed schema the provider must satisfy, taken from the generated model
#: rather than written out again here.
RESULT_JSON_SCHEMA: dict[str, Any] = ParseProfileResult.model_json_schema()


async def handle_parse_profile(ctx: TaskContext) -> ParseProfileResult:
    """Propose draft facts from an uploaded CV or pasted text."""
    payload = ParseProfileInput.model_validate(ctx.input)
    limits = ExtractionLimits.from_settings(ctx.settings, payload.limits)

    ctx.report_progress("fetching", 5)
    ctx.cancel.raise_if_cancelled()
    data, source_name = await _load_source(ctx, payload, limits)

    ctx.report_progress("extracting", 20)
    ctx.cancel.raise_if_cancelled()
    document = await asyncio.to_thread(
        extract_document,
        data,
        source_name=source_name,
        format_hint=payload.format_hint,
        limits=limits,
        cancel=ctx.cancel,
    )
    log_shape(
        "parse_profile.extracted",
        source_format=document.source_format,
        pages=document.page_count,
        blocks=len(document.blocks),
        chars=document.char_count,
    )

    ctx.cancel.raise_if_cancelled()
    sanitized = sanitize_document(document)
    if sanitized.injection_detected:
        log_shape(
            "parse_profile.injection_ignored",
            removed_chars=sanitized.removed_chars,
            locators=len(sanitized.removed_locators),
        )

    warnings: list[ProfileImportWarning] = [*document.warnings, *sanitized.warnings()]

    if is_short(document) or not sanitized.blocks:
        # Nothing plausible to parse. Returning zero facts with the reason is
        # the honest answer; sending six characters to a model and accepting
        # whatever comes back is how a profile gets invented.
        return _result(
            facts=ValidatedFacts(warnings=warnings),
            extracted_chars=document.char_count,
            provider_id="none",
            model="",
            usage=None,
        )

    provider = build_provider(ctx.settings)
    if provider is None:
        warnings.append(
            ProfileImportWarning(
                code="NO_PROVIDER_CONFIGURED",
                message=(
                    "No AI provider is configured, so no facts were proposed. The text "
                    "was read successfully and you can enter your profile manually."
                ),
            )
        )
        return _result(
            facts=ValidatedFacts(warnings=warnings),
            extracted_chars=document.char_count,
            provider_id="none",
            model="",
            usage=None,
        )

    try:
        ctx.report_progress("inferring", 50)
        generation = await _generate(ctx, provider, sanitized, payload)
    finally:
        await provider.aclose()

    ctx.report_progress("validating", 80)
    ctx.cancel.raise_if_cancelled()

    validated = validate_draft_facts(generation.parsed, sanitized)
    validated.warnings = _merge_warnings(warnings, validated.warnings)
    if generation.metadata.correction_attempts >= 1:
        validated.warn(
            "MODEL_CORRECTED_ONCE",
            "The model's first response was not valid and it was asked once to correct "
            "it. The corrected response was used.",
        )

    log_shape(
        "parse_profile.validated",
        proposed=len(validated.facts),
        dropped=validated.dropped,
        warnings=len(validated.warnings),
        corrections=generation.metadata.correction_attempts,
        prompt_version=generation.metadata.prompt_version,
    )

    return _result(
        facts=validated,
        extracted_chars=document.char_count,
        provider_id=generation.metadata.provider_id,
        model=generation.metadata.model,
        usage=generation,
    )


# ---------------------------------------------------------------------------


async def _load_source(
    ctx: TaskContext, payload: ParseProfileInput, limits: ExtractionLimits
) -> tuple[bytes, str]:
    """Take the pasted text, or download the one declared input file."""
    if payload.inline_text is not None:
        if len(payload.inline_text) > limits.max_extracted_chars:
            raise TaskFailureError(
                "LIMIT_EXCEEDED",
                f"The pasted text is {len(payload.inline_text)} characters, above the "
                f"{limits.max_extracted_chars} character limit.",
            )
        return payload.inline_text.encode("utf-8"), "pasted text"

    if payload.source_file_id is None:
        raise TaskFailureError(
            "INPUT_INVALID",
            "The import has neither a file nor pasted text, so there is nothing to read.",
        )

    declared = {item.file_id: item for item in ctx.files}
    meta = declared.get(payload.source_file_id)
    if meta is None:
        raise TaskFailureError(
            "INPUT_INVALID",
            "The import names a file that this task did not declare as an input. "
            "Only declared inputs can be fetched.",
        )
    if meta.bytes > limits.max_bytes:
        raise TaskFailureError(
            "LIMIT_EXCEEDED",
            f"{meta.original_name!r} is {meta.bytes} bytes, above the "
            f"{limits.max_bytes} byte limit.",
        )

    data = await ctx.api.download_input_file(
        ctx.task_id,
        payload.source_file_id,
        lease_token=ctx.lease_token,
        max_bytes=limits.max_bytes,
    )
    return data, meta.original_name


async def _generate(
    ctx: TaskContext,
    provider: ModelProvider,
    sanitized: SanitizedDocument,
    payload: ParseProfileInput,
) -> GenerationResult:
    """Reserve budget, ask the provider once, settle what it actually cost."""
    prompt = build_parse_profile_prompt(
        sanitized.text,
        locale=payload.locale,
        source_name=sanitized.source_name,
        # Style preferences live in Preferences and are not carried by
        # ParseProfileInput yet; see services/worker/README.md -> "Known gaps".
        style_suffix=None,
    )

    budget = build_budget(ctx.settings)
    reservation = budget.reserve(
        estimate_tokens(prompt.text), ctx.settings.provider_output_token_limit
    )

    try:
        generation = await provider.generate_structured(
            schema=RESULT_JSON_SCHEMA,
            prompt=prompt.text,
            limits=ctx.settings.provider_limits,
            validate=validate_result_shape,
            prompt_version=prompt.version,
        )
    except BaseException:
        budget.release(reservation)
        raise

    settled = budget.settle(reservation, generation.usage)
    log_shape(
        "parse_profile.model_usage",
        provider=generation.metadata.provider_id,
        structured_output=generation.metadata.structured_output,
        input_tokens=settled.input_tokens,
        output_tokens=settled.output_tokens,
        # Unknown price is reported as unknown. It is never rendered as 0.
        cost_known=not settled.cost_is_unknown,
        measured_cost=settled.measured_cost,
    )
    return generation


def _merge_warnings(
    first: list[ProfileImportWarning], second: list[ProfileImportWarning]
) -> list[ProfileImportWarning]:
    merged: list[ProfileImportWarning] = []
    for warning in (*first, *second):
        if any(
            existing.code == warning.code and existing.detail == warning.detail
            for existing in merged
        ):
            continue
        merged.append(warning)
        if len(merged) >= MAX_WARNINGS:
            break
    return merged


def _result(
    *,
    facts: ValidatedFacts,
    extracted_chars: int,
    provider_id: str,
    model: str,
    usage: GenerationResult | None,
) -> ParseProfileResult:
    return ParseProfileResult(
        draft_facts=facts.facts,
        warnings=facts.warnings,
        extracted_chars=extracted_chars,
        provider=ParseProfileResultProvider(
            id=provider_id,
            model=model,
            input_tokens=usage.usage.input_tokens if usage else None,
            output_tokens=usage.usage.output_tokens if usage else None,
        ),
    )


__all__ = ["RESULT_JSON_SCHEMA", "handle_parse_profile"]
