"""Is this string actually in the document?

Every truthfulness check in :mod:`job_getter_worker.profile.truthfulness`
reduces to that question, so it is answered in one place and in one way.

Two modes, because two kinds of value need different treatment:

* ``EXACT`` - identity values (a name, an employer, an institution, a URL).
  These must appear literally. "Northwind Logistics" either is in the CV or it
  is not, and a near miss is an invention.
* ``COVERAGE`` - free text (a bullet, a summary). A model legitimately
  reflows whitespace and drops a leading dash, so the check is on tokens: at
  least :data:`COVERAGE_THRESHOLD` of the value's words must be present.

On top of both, every *number* in a value must be present in the document.
That single rule is what stops "4 million events" becoming "40 million" and
"15 years of Kubernetes experience" appearing from nowhere.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Final

#: Fraction of a free-text value's tokens that must appear in the document.
COVERAGE_THRESHOLD: Final = 0.85

_WHITESPACE = re.compile(r"\s+")
_TOKEN = re.compile(r"[a-z0-9]+")
_NUMBER = re.compile(r"\d+")

_DASHES: Final = str.maketrans(
    {
        "‐": "-",
        "‑": "-",
        "‒": "-",
        "–": "-",
        "—": "-",
        "―": "-",
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        " ": " ",
    }
)


def normalise(text: str) -> str:
    """Lower-case, fold accents and unify punctuation and whitespace.

    Accents are folded because a PDF may encode ``Republica`` and a model may
    return ``República``; that is an encoding difference, not a different fact.
    """
    folded = unicodedata.normalize("NFKD", text.translate(_DASHES))
    stripped = "".join(char for char in folded if not unicodedata.combining(char))
    return _WHITESPACE.sub(" ", stripped.lower()).strip()


def tokens(text: str) -> list[str]:
    return _TOKEN.findall(normalise(text))


def numbers(text: str) -> list[str]:
    return _NUMBER.findall(text)


class Haystack:
    """The document text a value may be checked against."""

    def __init__(self, text: str) -> None:
        self.raw = text
        self.normalised = normalise(text)
        self.tokens = set(_TOKEN.findall(self.normalised))
        self.numbers = set(_NUMBER.findall(self.normalised))

    def contains_exact(self, needle: str) -> bool:
        candidate = normalise(needle)
        return bool(candidate) and candidate in self.normalised

    def contains_word(self, needle: str) -> bool:
        """Exact match on word boundaries.

        Needed for short skill names: ``Go`` must not match ``Django``.
        """
        candidate = normalise(needle)
        if not candidate:
            return False
        pattern = rf"(?<![a-z0-9]){re.escape(candidate)}(?![a-z0-9])"
        return re.search(pattern, self.normalised) is not None

    def coverage(self, needle: str) -> float:
        needle_tokens = _TOKEN.findall(normalise(needle))
        if not needle_tokens:
            return 0.0
        present = sum(1 for token in needle_tokens if token in self.tokens)
        return present / len(needle_tokens)

    def covers(self, needle: str, threshold: float = COVERAGE_THRESHOLD) -> bool:
        return self.coverage(needle) >= threshold

    def has_all_numbers(self, needle: str) -> bool:
        """Every number in ``needle`` appears in the document."""
        return all(value in self.numbers for value in _NUMBER.findall(needle))

    def windows_around(self, needle: str, radius: int = 60) -> list[str]:
        """Text surrounding each word-boundary occurrence of ``needle``.

        Used to ask context questions - "is this skill mentioned as something
        the person wants to learn?" - without a parser.
        """
        candidate = normalise(needle)
        if not candidate:
            return []
        pattern = rf"(?<![a-z0-9]){re.escape(candidate)}(?![a-z0-9])"
        found: list[str] = []
        for match in re.finditer(pattern, self.normalised):
            start = max(0, match.start() - radius)
            end = min(len(self.normalised), match.end() + radius)
            found.append(self.normalised[start:end])
        return found
