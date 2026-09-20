"""Bounds on document processing.

Two kinds of bound exist and they behave differently, which resolves an
apparent conflict between ``docs/spec/09_SECURITY_PRIVACY.md`` and the
``PAGES_TRUNCATED`` / ``CHARS_TRUNCATED`` warnings in the contract:

*Security bounds* (10 MiB upload, 100 PDF pages, 200 000 characters, 50 MiB
DOCX expansion, a wall-clock budget) are hard. Exceeding one is a refusal with
``LIMIT_EXCEEDED``; a document that large is not something to process partially.

*Task bounds* arrive in ``ParseProfileInput.limits`` and may only be stricter.
Exceeding one truncates and raises the matching warning, because the caller
asked for less, not because the input is dangerous.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..contracts.generated import MAX_UPLOAD_BYTES, ParseProfileInputLimits
from ..settings import (
    DEFAULT_MAX_DOCX_UNCOMPRESSED_BYTES,
    DEFAULT_MAX_EXTRACTED_CHARS,
    DEFAULT_MAX_PDF_PAGES,
    WorkerSettings,
)


@dataclass(frozen=True)
class ExtractionLimits:
    """Hard security bounds plus the (never larger) task bounds."""

    max_bytes: int = MAX_UPLOAD_BYTES
    max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES
    max_extracted_chars: int = DEFAULT_MAX_EXTRACTED_CHARS
    max_docx_uncompressed_bytes: int = DEFAULT_MAX_DOCX_UNCOMPRESSED_BYTES
    time_budget_seconds: float = 30.0

    task_max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES
    task_max_extracted_chars: int = DEFAULT_MAX_EXTRACTED_CHARS

    @classmethod
    def from_settings(
        cls, settings: WorkerSettings, task_limits: ParseProfileInputLimits | None = None
    ) -> ExtractionLimits:
        task_pages = settings.max_pdf_pages
        task_chars = settings.max_extracted_chars
        if task_limits is not None:
            # A task may tighten a bound but never loosen one.
            task_pages = min(task_pages, task_limits.max_pdf_pages)
            task_chars = min(task_chars, task_limits.max_extracted_chars)
        return cls(
            max_bytes=settings.max_download_bytes,
            max_pdf_pages=settings.max_pdf_pages,
            max_extracted_chars=settings.max_extracted_chars,
            max_docx_uncompressed_bytes=settings.max_docx_uncompressed_bytes,
            time_budget_seconds=settings.extraction_timeout_seconds,
            task_max_pdf_pages=task_pages,
            task_max_extracted_chars=task_chars,
        )
