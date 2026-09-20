"""Format detection by signature, not by filename.

``docs/spec/09_SECURITY_PRIVACY.md``: "Validate file signature and extension".
``fixtures/cvs/mislabelled.docx`` is PDF bytes with a ``.docx`` name and exists
precisely to prove this check is real.
"""

from __future__ import annotations

import io
import zipfile
from typing import Final

from ..errors import TaskFailureError

PDF_MAGIC: Final = b"%PDF-"
ZIP_MAGIC: Final = b"PK\x03\x04"
DOCX_REQUIRED_ENTRY: Final = "word/document.xml"

FORMAT_PDF: Final = "pdf"
FORMAT_DOCX: Final = "docx"
FORMAT_TEXT: Final = "text"

_EXTENSION_FORMATS: Final[dict[str, str]] = {
    ".pdf": FORMAT_PDF,
    ".docx": FORMAT_DOCX,
    ".txt": FORMAT_TEXT,
    ".text": FORMAT_TEXT,
    ".md": FORMAT_TEXT,
}

#: ``format_hint`` values from the generated ``ParseProfileInput``.
_HINT_FORMATS: Final[dict[str, str]] = {
    "pdf": FORMAT_PDF,
    "docx": FORMAT_DOCX,
    "linkedin_export_text": FORMAT_TEXT,
    "plain_text": FORMAT_TEXT,
}


def sniff_format(data: bytes) -> str | None:
    """Identify the container from its leading bytes. ``None`` if unknown."""
    if data.startswith(PDF_MAGIC):
        return FORMAT_PDF
    if data.startswith(ZIP_MAGIC):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
        except (zipfile.BadZipFile, OSError):
            return None
        return FORMAT_DOCX if DOCX_REQUIRED_ENTRY in names else None
    return None


def _extension_of(filename: str) -> str:
    _, _, tail = filename.rpartition(".")
    return f".{tail.lower()}" if tail and tail != filename else ""


def detect_format(data: bytes, *, source_name: str, format_hint: str = "auto") -> str:
    """Decide how to read ``data``, refusing anything inconsistent.

    Raises:
        TaskFailureError: ``FILE_UNREADABLE`` when the signature contradicts the
            filename or the declared hint, or when the container is neither a
            readable document nor decodable text.
    """
    if not data:
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} is empty, so there is nothing to extract.",
        )

    sniffed = sniff_format(data)
    claimed_extension = _EXTENSION_FORMATS.get(_extension_of(source_name))
    hinted = _HINT_FORMATS.get(format_hint)

    if sniffed is not None:
        if claimed_extension is not None and claimed_extension != sniffed:
            raise TaskFailureError(
                "FILE_UNREADABLE",
                f"{source_name!r} is named as {claimed_extension} but its "
                f"contents are {sniffed}. The file was rejected rather than parsed as "
                "something it is not.",
            )
        if hinted is not None and hinted != sniffed and hinted != FORMAT_TEXT:
            raise TaskFailureError(
                "FILE_UNREADABLE",
                f"{source_name!r} was declared as {hinted} but its contents are "
                f"{sniffed}. The file was rejected rather than parsed as something "
                "it is not.",
            )
        return sniffed

    # No known binary signature. It is only acceptable as text, and only if the
    # bytes really are text: a truncated or corrupt PDF/DOCX must not slip
    # through as "plain text" and yield garbage facts.
    if data.startswith(PDF_MAGIC[:4]) or data.startswith(ZIP_MAGIC[:2]):
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} looks like a PDF or DOCX container but is malformed, "
            "so it could not be opened.",
        )
    if claimed_extension in (FORMAT_PDF, FORMAT_DOCX):
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} is named as {claimed_extension} but has no valid "
            f"{claimed_extension} signature.",
        )
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} is neither a supported document nor UTF-8 text.",
        ) from error
    return FORMAT_TEXT
