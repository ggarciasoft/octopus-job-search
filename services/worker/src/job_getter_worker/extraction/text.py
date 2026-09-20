"""Plain text: pasted input and LinkedIn exports.

``docs/spec/06_AI_PROFILE_AND_CV.md``: "LinkedIn import means exported text/file
or pasted user text, not authenticated scraping." There is deliberately no
network path in this module.
"""

from __future__ import annotations

from typing import Final

from ..contracts.generated import ProfileImportWarning
from ..errors import TaskFailureError
from .limits import ExtractionLimits
from .types import ExtractedDocument, TextBlock

_FORMAT: Final = "text"


def decode_text(data: bytes, *, source_name: str) -> str:
    """Decode uploaded bytes as text, refusing anything that is not text."""
    for encoding in ("utf-8", "utf-8-sig"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise TaskFailureError(
        "FILE_UNREADABLE",
        f"{source_name!r} is not valid UTF-8 text.",
    )


def extract_text(
    text: str,
    *,
    source_name: str,
    limits: ExtractionLimits,
) -> ExtractedDocument:
    """Split text into line blocks, one locator per line.

    Lines are the finest provenance a flat text file supports, and they are
    enough to cite where a proposed fact came from.
    """
    if len(text) > limits.max_extracted_chars:
        raise TaskFailureError(
            "LIMIT_EXCEEDED",
            f"{source_name!r} contains {len(text)} characters, above the "
            f"{limits.max_extracted_chars} character limit.",
        )

    normalised = text.replace("\r\n", "\n").replace("\r", "\n")
    warnings: list[ProfileImportWarning] = []
    if len(normalised) > limits.task_max_extracted_chars:
        normalised = normalised[: limits.task_max_extracted_chars]
        warnings.append(
            ProfileImportWarning(
                code="CHARS_TRUNCATED",
                message=(
                    f"Only the first {limits.task_max_extracted_chars} characters were "
                    "read; the rest was not considered."
                ),
            )
        )

    blocks = tuple(
        TextBlock(text=line.strip(), locator=f"line {index}")
        for index, line in enumerate(normalised.split("\n"), start=1)
        if line.strip()
    )

    if not blocks:
        raise TaskFailureError(
            "EXTRACTION_EMPTY",
            f"{source_name!r} contains no readable text.",
        )

    return ExtractedDocument(
        source_name=source_name,
        source_format=_FORMAT,
        blocks=blocks,
        page_count=None,
        warnings=tuple(warnings),
    )
