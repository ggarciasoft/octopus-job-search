"""Profile import: sanitising a document and deciding what may become a fact."""

from __future__ import annotations

from .grounding import Haystack, normalise
from .sanitize import INJECTION_PATTERNS, SanitizedDocument, sanitize_document
from .truthfulness import (
    FACT_VALUE_MODELS,
    ValidatedFacts,
    validate_draft_facts,
    validate_result_shape,
)

__all__ = [
    "FACT_VALUE_MODELS",
    "INJECTION_PATTERNS",
    "Haystack",
    "SanitizedDocument",
    "ValidatedFacts",
    "normalise",
    "sanitize_document",
    "validate_draft_facts",
    "validate_result_shape",
]
