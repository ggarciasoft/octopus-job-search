"""PDF text extraction with pypdf.

Security posture, per ``docs/spec/09_SECURITY_PRIVACY.md``:

* An encrypted document is refused with ``ENCRYPTED_DOCUMENT``. No password is
  guessed, tried or brute-forced - not even the empty one, which some readers
  attempt silently.
* A PDF with pages but no extractable text is ``OCR_REQUIRED``. OCR is deferred,
  and a deferred feature must not be replaced by a guess.
* Nothing in the document is executed. pypdf only reads content streams; it
  runs no JavaScript, follows no ``/Launch`` action and resolves no external
  reference. Annotations, embedded files and actions are never touched here -
  only page text objects are read.
"""

from __future__ import annotations

import io
import time
from typing import Final

from pypdf import PdfReader
from pypdf.errors import PdfReadError, PyPdfError

from ..cancellation import CancellationToken
from ..contracts.generated import ProfileImportWarning
from ..errors import TaskCancelledError, TaskFailureError
from .limits import ExtractionLimits
from .types import ExtractedDocument, TextBlock

_FORMAT: Final = "pdf"


def extract_pdf(
    data: bytes,
    *,
    source_name: str,
    limits: ExtractionLimits,
    cancel: CancellationToken | None = None,
) -> ExtractedDocument:
    """Read page text from a PDF, one :class:`TextBlock` per page.

    Raises:
        TaskFailureError: ``ENCRYPTED_DOCUMENT``, ``OCR_REQUIRED``,
            ``FILE_UNREADABLE``, ``LIMIT_EXCEEDED`` or ``TIMEOUT``.
    """
    if len(data) > limits.max_bytes:
        raise TaskFailureError(
            "LIMIT_EXCEEDED",
            f"{source_name!r} is {len(data)} bytes, above the {limits.max_bytes} byte limit.",
        )

    started = time.monotonic()
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
    except (PdfReadError, PyPdfError, ValueError, OSError) as error:
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} could not be opened as a PDF. The container is "
            "malformed, so no text was read from it.",
        ) from error

    if reader.is_encrypted:
        # Deliberately no decrypt() call: refusing is the specified behaviour
        # and attempting a password would be exactly the wrong instinct.
        raise TaskFailureError(
            "ENCRYPTED_DOCUMENT",
            f"{source_name!r} is password protected. Remove the password in your "
            "PDF viewer and upload it again, or paste the text instead. No attempt "
            "was made to open it without the password.",
        )

    try:
        page_count = len(reader.pages)
    except (PdfReadError, PyPdfError, ValueError) as error:
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} has an unreadable page tree.",
        ) from error

    if page_count == 0:
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} contains no pages.",
        )
    if page_count > limits.max_pdf_pages:
        raise TaskFailureError(
            "LIMIT_EXCEEDED",
            f"{source_name!r} has {page_count} pages, above the "
            f"{limits.max_pdf_pages} page limit for CV parsing.",
        )

    warnings: list[ProfileImportWarning] = []
    read_pages = page_count
    if page_count > limits.task_max_pdf_pages:
        read_pages = limits.task_max_pdf_pages
        warnings.append(
            ProfileImportWarning(
                code="PAGES_TRUNCATED",
                message=(
                    f"Only the first {read_pages} of {page_count} pages were read, "
                    "so later pages were not considered."
                ),
            )
        )

    blocks: list[TextBlock] = []
    total_chars = 0
    truncated_chars = False

    for index in range(read_pages):
        if cancel is not None and cancel.is_cancelled:
            # Safe checkpoint: a partially read document is simply discarded.
            raise TaskCancelledError("extraction stopped at a page boundary")
        if time.monotonic() - started > limits.time_budget_seconds:
            raise TaskFailureError(
                "TIMEOUT",
                f"Reading {source_name!r} exceeded the "
                f"{limits.time_budget_seconds:g} second extraction budget.",
                retryable=True,
            )
        try:
            page_text = reader.pages[index].extract_text() or ""
        except (PdfReadError, PyPdfError, ValueError, KeyError, TypeError):
            # One unreadable page must not discard the rest of the document.
            page_text = ""
            warnings.append(
                ProfileImportWarning(
                    code="FIELD_DROPPED_INVALID",
                    message=f"Page {index + 1} could not be decoded and was skipped.",
                )
            )

        remaining = limits.task_max_extracted_chars - total_chars
        if remaining <= 0:
            truncated_chars = True
            break
        if len(page_text) > remaining:
            page_text = page_text[:remaining]
            truncated_chars = True

        total_chars += len(page_text)
        if page_text.strip():
            blocks.append(TextBlock(text=page_text, locator=f"page {index + 1}"))

    if truncated_chars:
        warnings.append(
            ProfileImportWarning(
                code="CHARS_TRUNCATED",
                message=(
                    f"Extraction stopped at {limits.task_max_extracted_chars} characters; "
                    "the rest of the document was not read."
                ),
            )
        )

    if total_chars == 0:
        # Pages exist, text does not. That is a scan, not an empty file.
        raise TaskFailureError(
            "OCR_REQUIRED",
            f"{source_name!r} has {page_count} page(s) but no extractable text, so it "
            "is almost certainly a scan or an image-only export. Optical character "
            "recognition is not available yet, and this worker will not guess at the "
            "contents. Upload a text PDF, a DOCX, or paste the text instead.",
        )

    return ExtractedDocument(
        source_name=source_name,
        source_format=_FORMAT,
        blocks=tuple(blocks),
        page_count=page_count,
        warnings=tuple(warnings),
    )
