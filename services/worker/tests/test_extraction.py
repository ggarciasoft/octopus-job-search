"""Document extraction against the real fixture corpus.

Covers AT02 (text PDF/DOCX with provenance) and AT03 (scanned, encrypted,
malformed and implausibly short documents), plus the processing bounds in
``docs/spec/09_SECURITY_PRIVACY.md``.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from job_getter_worker.errors import TaskFailureError
from job_getter_worker.extraction import (
    MIN_PLAUSIBLE_CHARS,
    ExtractionLimits,
    extract_document,
    is_short,
)
from job_getter_worker.extraction.detect import detect_format, sniff_format

from .conftest import read_cv

LIMITS = ExtractionLimits()


# ---------------------------------------------------------------------------
# AT02 - text documents extract with provenance
# ---------------------------------------------------------------------------


def test_text_pdf_extracts_pages_with_locators() -> None:
    document = extract_document(read_cv("text-cv.pdf"), source_name="text-cv.pdf", limits=LIMITS)

    assert document.source_format == "pdf"
    assert document.page_count == 2
    assert [block.locator for block in document.blocks] == ["page 1", "page 2"]
    assert "Northwind Logistics" in document.text
    assert document.locator_for("Fenix Software") == "page 2"
    assert document.char_count > MIN_PLAUSIBLE_CHARS


def test_spanish_pdf_keeps_its_text_accents_and_all() -> None:
    """AT12/AT27 start here: an accent lost on the way in is lost for good.

    The fixture used to spell its Spanish without accents, so this test passed
    while proving nothing about them. It now asserts the characters themselves,
    not merely that some Spanish-looking words came back.
    """
    document = extract_document(
        read_cv("text-cv-es.pdf"), source_name="text-cv-es.pdf", limits=LIMITS
    )
    assert "Ingeniera de Backend Senior" in document.text
    assert "Universidad de la República" in document.text
    assert "migración" in document.text
    assert "¿Quién soy?" in document.text
    assert "Español (nativo), Inglés (profesional)" in document.text
    assert "biligüe" in document.text
    assert "EDUCACIÓN" in document.text


def test_docx_reads_table_rows_not_only_paragraphs() -> None:
    """The employers exist *only* inside a table in this fixture."""
    document = extract_document(read_cv("text-cv.docx"), source_name="text-cv.docx", limits=LIMITS)

    table_blocks = [block for block in document.blocks if block.locator.startswith("table ")]
    assert table_blocks, "no table rows were extracted"

    table_text = "\n".join(block.text for block in table_blocks)
    for employer in ("Northwind Logistics", "Cobalt Analytics", "Fenix Software"):
        assert employer in table_text

    paragraph_text = "\n".join(
        block.text for block in document.blocks if block.locator.startswith("paragraph ")
    )
    assert "Northwind Logistics" not in paragraph_text

    assert any(warning.code == "TABLE_LAYOUT_UNCERTAIN" for warning in document.warnings)


def test_plain_text_extracts_line_locators() -> None:
    document = extract_document(
        read_cv("linkedin-export.txt"), source_name="linkedin-export.txt", limits=LIMITS
    )
    assert document.source_format == "text"
    assert document.blocks[0].locator == "line 1"
    assert document.locator_for("Northwind Logistics") is not None


# ---------------------------------------------------------------------------
# AT03 - the hard cases fail explicitly
# ---------------------------------------------------------------------------


def test_scanned_pdf_requires_ocr_rather_than_guessing() -> None:
    with pytest.raises(TaskFailureError) as raised:
        extract_document(read_cv("scanned-cv.pdf"), source_name="scanned-cv.pdf", limits=LIMITS)
    assert raised.value.code == "OCR_REQUIRED"
    assert "recognition is not available" in raised.value.redacted_message


def test_encrypted_pdf_is_refused_without_trying_a_password() -> None:
    with pytest.raises(TaskFailureError) as raised:
        extract_document(read_cv("encrypted-cv.pdf"), source_name="encrypted-cv.pdf", limits=LIMITS)
    assert raised.value.code == "ENCRYPTED_DOCUMENT"
    assert "password" in raised.value.redacted_message.lower()


def test_malformed_pdf_is_rejected_cleanly() -> None:
    with pytest.raises(TaskFailureError) as raised:
        extract_document(read_cv("malformed.pdf"), source_name="malformed.pdf", limits=LIMITS)
    assert raised.value.code == "FILE_UNREADABLE"


def test_malformed_docx_is_rejected_cleanly() -> None:
    with pytest.raises(TaskFailureError) as raised:
        extract_document(read_cv("malformed.docx"), source_name="malformed.docx", limits=LIMITS)
    assert raised.value.code == "FILE_UNREADABLE"


def test_mislabelled_docx_is_caught_by_signature_not_name() -> None:
    """PDF bytes named .docx. Validation reads the signature."""
    assert sniff_format(read_cv("mislabelled.docx")) == "pdf"
    with pytest.raises(TaskFailureError) as raised:
        extract_document(read_cv("mislabelled.docx"), source_name="mislabelled.docx", limits=LIMITS)
    assert raised.value.code == "FILE_UNREADABLE"
    assert "contents are pdf" in raised.value.redacted_message


def test_too_short_pdf_is_flagged_not_padded() -> None:
    document = extract_document(
        read_cv("too-short.pdf"), source_name="too-short.pdf", limits=LIMITS
    )
    assert is_short(document)
    codes = {warning.code for warning in document.warnings}
    assert "EXTRACTION_SHORT" in codes


def test_declared_format_that_contradicts_the_bytes_is_refused() -> None:
    with pytest.raises(TaskFailureError) as raised:
        extract_document(
            read_cv("text-cv.pdf"),
            source_name="cv",
            format_hint="docx",
            limits=LIMITS,
        )
    assert raised.value.code == "FILE_UNREADABLE"


def test_empty_upload_is_refused() -> None:
    with pytest.raises(TaskFailureError) as raised:
        detect_format(b"", source_name="empty.pdf")
    assert raised.value.code == "FILE_UNREADABLE"


# ---------------------------------------------------------------------------
# Processing bounds
# ---------------------------------------------------------------------------


def _many_page_pdf(pages: int) -> bytes:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def test_pdf_over_the_page_cap_is_refused() -> None:
    limits = ExtractionLimits(max_pdf_pages=3, task_max_pdf_pages=3)
    with pytest.raises(TaskFailureError) as raised:
        extract_document(_many_page_pdf(4), source_name="long.pdf", limits=limits)
    assert raised.value.code == "LIMIT_EXCEEDED"
    assert "page limit" in raised.value.redacted_message


def test_text_over_the_character_cap_is_refused() -> None:
    limits = ExtractionLimits(max_extracted_chars=500, task_max_extracted_chars=500)
    payload = ("Ana Rivera, Senior Backend Engineer. " * 100).encode("utf-8")
    with pytest.raises(TaskFailureError) as raised:
        extract_document(payload, source_name="pasted.txt", limits=limits)
    assert raised.value.code == "LIMIT_EXCEEDED"


def test_a_stricter_task_limit_truncates_with_a_warning() -> None:
    """A task-declared bound is a request for less, not a dangerous input."""
    limits = ExtractionLimits(task_max_extracted_chars=400)
    document = extract_document(read_cv("text-cv.pdf"), source_name="text-cv.pdf", limits=limits)
    assert document.char_count <= 400
    assert {warning.code for warning in document.warnings} & {"CHARS_TRUNCATED"}


def test_a_stricter_task_page_limit_warns_rather_than_failing() -> None:
    limits = ExtractionLimits(task_max_pdf_pages=1)
    document = extract_document(read_cv("text-cv.pdf"), source_name="text-cv.pdf", limits=limits)
    assert [block.locator for block in document.blocks] == ["page 1"]
    assert any(warning.code == "PAGES_TRUNCATED" for warning in document.warnings)


def _zip_bomb(*, declared_bytes: int) -> bytes:
    """A small archive whose entries declare a huge uncompressed size."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("[Content_Types].xml", b"<Types/>")
        # Highly compressible: a few kilobytes on disk, megabytes expanded.
        archive.writestr("word/document.xml", b"\x00" * declared_bytes)
    return buffer.getvalue()


def test_docx_zip_bomb_is_refused_before_expansion() -> None:
    payload = _zip_bomb(declared_bytes=8 * 1024 * 1024)
    assert len(payload) < 100_000, "the bomb should be small on disk"

    limits = ExtractionLimits(max_docx_uncompressed_bytes=1024 * 1024)
    with pytest.raises(TaskFailureError) as raised:
        extract_document(payload, source_name="bomb.docx", limits=limits)

    assert raised.value.code == "LIMIT_EXCEEDED"
    assert "without being extracted" in raised.value.redacted_message


def test_docx_with_a_macro_project_is_refused() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", b"<w:document/>")
        archive.writestr("word/vbaProject.bin", b"\x00\x01")
    with pytest.raises(TaskFailureError) as raised:
        extract_document(buffer.getvalue(), source_name="macro.docx", limits=LIMITS)
    assert raised.value.code == "FILE_UNREADABLE"
    assert "macro" in raised.value.redacted_message


def test_docx_declaring_an_xml_entity_is_refused() -> None:
    """No external entity is resolved, and a document that asks is refused."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "word/document.xml",
            b'<?xml version="1.0"?><!DOCTYPE t [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
            b"<w:document>&x;</w:document>",
        )
    with pytest.raises(TaskFailureError) as raised:
        extract_document(buffer.getvalue(), source_name="xxe.docx", limits=LIMITS)
    assert raised.value.code == "FILE_UNREADABLE"
    assert "entity" in raised.value.redacted_message.lower()
