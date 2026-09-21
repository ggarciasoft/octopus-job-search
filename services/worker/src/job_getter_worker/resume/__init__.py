"""Resume documents: assembly, validation and rendering (PR07)."""

from .document import build_document, document_strings
from .docx_render import render_docx
from .pdf_render import build_html, render_pdf
from .validation import validate_document

__all__ = [
    "build_document",
    "build_html",
    "document_strings",
    "render_docx",
    "render_pdf",
    "validate_document",
]
