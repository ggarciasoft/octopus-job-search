"""Versioned prompt construction.

Prompt text lives in constants with a version string so a result can be
reproduced later (``docs/spec/06_AI_PROFILE_AND_CV.md`` -> "Cache outputs by
[...] prompt version").
"""

from __future__ import annotations

from .parse_profile import (
    PARSE_PROFILE_PROMPT_VERSION,
    PARSE_PROFILE_RULES,
    BuiltPrompt,
    build_parse_profile_prompt,
    sanitize_style_suffix,
)

__all__ = [
    "PARSE_PROFILE_PROMPT_VERSION",
    "PARSE_PROFILE_RULES",
    "BuiltPrompt",
    "build_parse_profile_prompt",
    "sanitize_style_suffix",
]
