"""Text normalisation shared by every matcher.

Deliberately boring: case folding, accent folding, punctuation stripping and
whitespace collapsing, and nothing else. No stemming, no fuzzy distance, no
embedding. Every rule here has to be explainable to a user looking at their own
CV beside a job posting and asking why a line matched, so each one is a rule a
person can check by eye.
"""

from __future__ import annotations

import re
import unicodedata

#: Tokens carrying no signal for a title or skill comparison. Kept small on
#: purpose: an aggressive stop list quietly changes what a match means.
_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "de",
        "del",
        "en",
        "for",
        "in",
        "la",
        "of",
        "or",
        "the",
        "to",
        "with",
        "y",
    }
)

_NON_WORD = re.compile(r"[^a-z0-9+#.]+")
_WHITESPACE = re.compile(r"\s+")


def fold(text: str) -> str:
    """Lower-case, strip accents and collapse whitespace.

    Accents are folded so that a Spanish CV matches a Spanish posting written
    without them, which is common enough in job text to matter.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return _WHITESPACE.sub(" ", stripped.lower()).strip()


def tokens(text: str) -> list[str]:
    """Significant tokens, in order, with duplicates preserved.

    ``+``, ``#`` and ``.`` survive because they are load-bearing in skill
    names: dropping them turns "C++" into "c" and ".NET" into "net".
    """
    return [token for token in _NON_WORD.split(fold(text)) if token and token not in _STOP_WORDS]


def token_set(text: str) -> frozenset[str]:
    return frozenset(tokens(text))


def overlap(left: str, right: str) -> float:
    """Symmetric token overlap in 0-1.

    Divided by the larger token set rather than the intersection's own size, so
    that "engineer" against "senior staff platform engineer" scores 0.25 rather
    than a perfect 1. A short string must not score full marks against a long
    one just by being contained in it.
    """
    left_tokens = token_set(left)
    right_tokens = token_set(right)
    if not left_tokens or not right_tokens:
        return 0.0
    shared = left_tokens & right_tokens
    return len(shared) / max(len(left_tokens), len(right_tokens))


def contains_phrase(haystack: str, needle: str) -> bool:
    """Whole-token phrase containment.

    Substring matching would let "r" match "for" and "go" match "algorithm",
    so the needle is matched against token boundaries instead.
    """
    needle_tokens = tokens(needle)
    if not needle_tokens:
        return False
    hay_tokens = tokens(haystack)
    span = len(needle_tokens)
    for index in range(len(hay_tokens) - span + 1):
        if hay_tokens[index : index + span] == needle_tokens:
            return True
    return False


def excerpt(text: str, limit: int = 600) -> str:
    """A quotable excerpt, trimmed to the contract's evidence length."""
    collapsed = _WHITESPACE.sub(" ", text).strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "…"
