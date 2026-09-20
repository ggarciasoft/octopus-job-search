"""DOCX text extraction with python-docx, paragraphs *and* tables.

A CV that keeps its employment history in a table is common and a naive reader
skips it silently - which is the worst possible failure, because the output
looks fine and is missing the candidate's jobs. ``fixtures/cvs/text-cv.docx``
puts the employers only inside a table for exactly this reason.

Security posture, per ``docs/spec/09_SECURITY_PRIVACY.md``:

* The archive's *uncompressed* size is checked before anything is read, so a
  zip bomb is refused rather than expanded.
* A document carrying a macro project is refused. Nothing in it is executed
  here, but a macro-enabled CV is not something to pass further down the line.
* External references are not resolved. python-docx parses with
  ``lxml.etree.XMLParser(..., resolve_entities=False)``
  (see ``docx/oxml/parser.py``), which disables entity expansion and therefore
  classic XXE and billion-laughs attacks. Because that is *their* setting and
  not ours, the XML is additionally refused outright if it declares a DTD or an
  entity - a legitimate ``.docx`` never does.
"""

from __future__ import annotations

import io
import re
import time
import zipfile
from typing import Any, Final

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from ..cancellation import CancellationToken
from ..contracts.generated import ProfileImportWarning
from ..errors import TaskCancelledError, TaskFailureError
from .limits import ExtractionLimits
from .types import ExtractedDocument, TextBlock

_FORMAT: Final = "docx"
_DOCUMENT_ENTRY: Final = "word/document.xml"
_MACRO_ENTRIES: Final = ("word/vbaProject.bin", "word/vbaData.xml")
_DOCTYPE_PATTERN: Final = re.compile(rb"<!(DOCTYPE|ENTITY)", re.IGNORECASE)


def _guard_archive(data: bytes, *, source_name: str, limits: ExtractionLimits) -> None:
    """Refuse dangerous archives before a single entry is decompressed."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            names = {info.filename for info in infos}

            uncompressed = sum(info.file_size for info in infos)
            if uncompressed > limits.max_docx_uncompressed_bytes:
                raise TaskFailureError(
                    "LIMIT_EXCEEDED",
                    f"{source_name!r} expands to {uncompressed} bytes, above the "
                    f"{limits.max_docx_uncompressed_bytes} byte expansion limit. "
                    "The archive was refused without being extracted.",
                )

            if _DOCUMENT_ENTRY not in names:
                raise TaskFailureError(
                    "FILE_UNREADABLE",
                    f"{source_name!r} is a zip archive but not a Word document: it has "
                    f"no {_DOCUMENT_ENTRY} part.",
                )

            macros = sorted(names.intersection(_MACRO_ENTRIES))
            if macros:
                raise TaskFailureError(
                    "FILE_UNREADABLE",
                    f"{source_name!r} contains a macro project ({', '.join(macros)}). "
                    "Macro-enabled documents are refused. Save it as a plain .docx "
                    "and upload it again.",
                )

            # Read only the main part's bytes for the DTD check. Its declared
            # size is already inside the expansion budget checked above.
            head = archive.read(_DOCUMENT_ENTRY)[:4096]
            if _DOCTYPE_PATTERN.search(head):
                raise TaskFailureError(
                    "FILE_UNREADABLE",
                    f"{source_name!r} declares an XML DTD or entity. A Word document "
                    "never needs one, and resolving it is how external-entity attacks "
                    "work, so the file was refused.",
                )
    except zipfile.BadZipFile as error:
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} is not a readable .docx archive; the container is "
            "malformed, so no text was read from it.",
        ) from error
    except (OSError, RuntimeError) as error:
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} could not be opened as a .docx archive.",
        ) from error


def _iter_body_blocks(document: Any) -> list[TextBlock]:
    """Walk the document body in order, yielding paragraphs and table rows.

    Order matters: a heading and the table beneath it only make sense together.
    """
    body = document.element.body
    blocks: list[TextBlock] = []
    paragraph_index = 0
    table_index = 0

    for child in body.iterchildren():
        tag = str(child.tag)
        if tag.endswith("}p"):
            paragraph_index += 1
            text = Paragraph(child, document).text.strip()
            if text:
                blocks.append(TextBlock(text=text, locator=f"paragraph {paragraph_index}"))
        elif tag.endswith("}tbl"):
            table_index += 1
            table = Table(child, document)
            for row_index, row in enumerate(table.rows, start=1):
                cells = [cell.text.strip() for cell in row.cells]
                # Word repeats a cell object across a horizontal merge; collapse
                # the repeats so a merged header is not emitted three times.
                deduplicated: list[str] = []
                for value in cells:
                    if not deduplicated or deduplicated[-1] != value:
                        deduplicated.append(value)
                text = " | ".join(value for value in deduplicated if value)
                if text:
                    blocks.append(
                        TextBlock(
                            text=text,
                            locator=f"table {table_index} row {row_index}",
                        )
                    )
    return blocks


def extract_docx(
    data: bytes,
    *,
    source_name: str,
    limits: ExtractionLimits,
    cancel: CancellationToken | None = None,
) -> ExtractedDocument:
    """Read paragraph and table text from a DOCX.

    Raises:
        TaskFailureError: ``FILE_UNREADABLE``, ``LIMIT_EXCEEDED``,
            ``EXTRACTION_EMPTY`` or ``TIMEOUT``.
    """
    if len(data) > limits.max_bytes:
        raise TaskFailureError(
            "LIMIT_EXCEEDED",
            f"{source_name!r} is {len(data)} bytes, above the {limits.max_bytes} byte limit.",
        )

    started = time.monotonic()
    _guard_archive(data, source_name=source_name, limits=limits)

    if cancel is not None and cancel.is_cancelled:
        raise TaskCancelledError("extraction stopped before opening the document")

    try:
        document = Document(io.BytesIO(data))
        raw_blocks = _iter_body_blocks(document)
    except TaskFailureError:
        raise
    except Exception as error:
        # python-docx raises a wide and undocumented range of lxml/KeyError/
        # ValueError types on damaged parts. Whatever it is, the honest result
        # is the same: this file could not be read.
        raise TaskFailureError(
            "FILE_UNREADABLE",
            f"{source_name!r} could not be parsed as a Word document.",
        ) from error

    if time.monotonic() - started > limits.time_budget_seconds:
        raise TaskFailureError(
            "TIMEOUT",
            f"Reading {source_name!r} exceeded the "
            f"{limits.time_budget_seconds:g} second extraction budget.",
            retryable=True,
        )

    warnings: list[ProfileImportWarning] = []
    blocks: list[TextBlock] = []
    total = 0
    for block in raw_blocks:
        remaining = limits.task_max_extracted_chars - total
        if remaining <= 0:
            warnings.append(
                ProfileImportWarning(
                    code="CHARS_TRUNCATED",
                    message=(
                        f"Extraction stopped at {limits.task_max_extracted_chars} "
                        "characters; the rest of the document was not read."
                    ),
                )
            )
            break
        text = block.text[:remaining]
        total += len(text)
        blocks.append(TextBlock(text=text, locator=block.locator))

    if any(block.locator.startswith("table ") for block in blocks):
        warnings.append(
            ProfileImportWarning(
                code="TABLE_LAYOUT_UNCERTAIN",
                message=(
                    "Part of this document is laid out in a table. The rows were read, "
                    "but check that each role lines up with the right employer and dates."
                ),
            )
        )

    if total == 0:
        raise TaskFailureError(
            "EXTRACTION_EMPTY",
            f"{source_name!r} opened correctly but contains no text in its paragraphs "
            "or tables. If the content is an image, it cannot be read yet.",
        )

    return ExtractedDocument(
        source_name=source_name,
        source_format=_FORMAT,
        blocks=tuple(blocks),
        page_count=None,
        warnings=tuple(warnings),
    )
