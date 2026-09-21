"""DOCX rendering through python-docx.

Single column, packaged fonts, ordinary heading and list styles. The spec's
reasoning is parseability: an ATS reads a simple document far more reliably
than a two-column design with text boxes. It still cannot be promised to parse
everywhere, and the UI says so rather than claiming ATS compatibility.

Every string written here comes from the validated document. python-docx writes
text as text -- there is no markup path into the file -- so a job description
that contained angle brackets or a formula cannot become anything but
characters on a page.
"""

from __future__ import annotations

import io

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt

from ..contracts.generated import ResumeDocument, ResumeEntry

#: Minimum body size the spec allows. Nothing here scales below it: an
#: unreadable CV that fits is worse than a readable one that runs over.
#: Written as a code point so the source stays unambiguous ASCII; the
#: rendered output is an en dash either way.
EN_DASH = chr(0x2013)

BODY_PT = 10.5
NAME_PT = 20
HEADING_PT = 12


def _date_range(entry: ResumeEntry, current_label: str) -> str:
    if entry.start_month is None and entry.end_month is None:
        return ""
    start = entry.start_month or ""
    end = current_label if entry.current else entry.end_month or ""
    if start and end:
        return f"{start} {EN_DASH} {end}"
    return start or end


def render_docx(document: ResumeDocument) -> bytes:
    """Return the .docx bytes for a validated document."""
    current_label = "Present" if document.language == "en" else "Actualidad"
    doc = Document()

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(BODY_PT)

    contact = document.contact
    name = doc.add_paragraph()
    name.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = name.add_run(contact.full_name)
    run.bold = True
    run.font.size = Pt(NAME_PT)

    details = [part for part in (contact.email, contact.phone, contact.location) if part]
    details.extend(contact.links)
    if details:
        line = doc.add_paragraph(" · ".join(details))
        line.runs[0].font.size = Pt(BODY_PT)

    for section in document.sections:
        heading = doc.add_paragraph()
        heading_run = heading.add_run(section.heading)
        heading_run.bold = True
        heading_run.font.size = Pt(HEADING_PT)

        if section.kind in {"skills", "languages"}:
            # A comma list rather than one bullet per skill: a page of
            # single-word bullets wastes the reviewer's first impression.
            items = []
            for entry in section.entries:
                label = entry.title or ""
                if entry.detail:
                    label = f"{label} ({entry.detail})"
                if label:
                    items.append(label)
            if items:
                doc.add_paragraph(", ".join(items))
            continue

        for entry in section.entries:
            headline_parts = [part for part in (entry.title, entry.organization) if part]
            headline = " — ".join(headline_parts)
            dates = _date_range(entry, current_label)
            paragraph = doc.add_paragraph()
            if headline:
                entry_run = paragraph.add_run(headline)
                entry_run.bold = True
                entry_run.font.size = Pt(BODY_PT)
            if dates:
                paragraph.add_run(f"   {dates}").font.size = Pt(BODY_PT)
            if entry.detail:
                doc.add_paragraph(entry.detail)
            for bullet in entry.bullets:
                doc.add_paragraph(bullet.text, style="List Bullet")

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()
