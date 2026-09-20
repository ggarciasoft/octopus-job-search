"""Document text extraction.

Dispatch by *signature*, extract with bounds, and report what happened
honestly. Nothing in this package fetches a URL, executes document content or
resolves an external reference.
"""

from __future__ import annotations

from typing import Final

from ..cancellation import CancellationToken
from ..contracts.generated import ProfileImportWarning
from .detect import FORMAT_DOCX, FORMAT_PDF, FORMAT_TEXT, detect_format, sniff_format
from .docx import extract_docx
from .limits import ExtractionLimits
from .pdf import extract_pdf
from .text import decode_text, extract_text
from .types import ExtractedDocument, TextBlock

#: Below this, an "extraction" is not a CV. ``fixtures/cvs/too-short.pdf`` is
#: six characters of text: technically valid, nothing to build a profile from.
#: The document is still returned, with a warning, so the user sees the real
#: reason rather than an empty review screen.
MIN_PLAUSIBLE_CHARS: Final = 120


def extract_document(
    data: bytes,
    *,
    source_name: str,
    format_hint: str = "auto",
    limits: ExtractionLimits,
    cancel: CancellationToken | None = None,
) -> ExtractedDocument:
    """Extract text from uploaded bytes, choosing the reader by signature."""
    detected = detect_format(data, source_name=source_name, format_hint=format_hint)

    if detected == FORMAT_PDF:
        document = extract_pdf(data, source_name=source_name, limits=limits, cancel=cancel)
    elif detected == FORMAT_DOCX:
        document = extract_docx(data, source_name=source_name, limits=limits, cancel=cancel)
    else:
        document = extract_text(
            decode_text(data, source_name=source_name),
            source_name=source_name,
            limits=limits,
        )

    return _flag_short_extraction(document)


def _flag_short_extraction(document: ExtractedDocument) -> ExtractedDocument:
    """Attach ``EXTRACTION_SHORT`` when there is too little text to parse."""
    if document.char_count >= MIN_PLAUSIBLE_CHARS:
        return document
    warning = ProfileImportWarning(
        code="EXTRACTION_SHORT",
        message=(
            f"Only {document.char_count} characters were extracted from "
            f"{document.source_name!r}, which is far too little for a CV. Nothing was "
            "inferred from it. Check that you uploaded the right file, or paste the "
            "text instead."
        ),
    )
    return ExtractedDocument(
        source_name=document.source_name,
        source_format=document.source_format,
        blocks=document.blocks,
        page_count=document.page_count,
        warnings=(*document.warnings, warning),
    )


def is_short(document: ExtractedDocument) -> bool:
    """True when the document is too small to be worth sending to a model."""
    return document.char_count < MIN_PLAUSIBLE_CHARS


__all__ = [
    "FORMAT_DOCX",
    "FORMAT_PDF",
    "FORMAT_TEXT",
    "MIN_PLAUSIBLE_CHARS",
    "ExtractedDocument",
    "ExtractionLimits",
    "TextBlock",
    "decode_text",
    "detect_format",
    "extract_document",
    "extract_docx",
    "extract_pdf",
    "extract_text",
    "is_short",
    "sniff_format",
]
