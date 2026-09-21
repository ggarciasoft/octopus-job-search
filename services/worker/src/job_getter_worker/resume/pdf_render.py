"""PDF rendering: a sanitised Jinja2 template printed by Playwright Chromium.

The template is the security boundary, so it is built to make the dangerous
thing impossible rather than unlikely:

* **Autoescaping is on and every value is escaped.** No ``|safe`` appears
  anywhere in the template, so a name containing ``<script>`` renders as those
  characters. Documents are assembled from job text and imported CVs, both
  untrusted (invariant 9).
* **No external resource can be fetched.** There is no ``<link>``, ``<img>``,
  ``<script>`` or webfont; styling is one inline stylesheet and the fonts are
  the ones already on the system. A CV that phoned a CDN on render would leak
  the fact that it was being rendered, and to whom.
* **The page is loaded as a data document, not from a URL**, and the browser
  is launched with no network use at all.

If Playwright or its browser is unavailable the PDF is simply not produced.
The DOCX still is, the result says which formats exist, and the UI offers what
was actually made -- rather than a download button that fails when pressed.
"""

from __future__ import annotations

import html
from dataclasses import dataclass

from jinja2 import Environment, select_autoescape

from ..contracts.generated import ResumeDocument
from ..logging import log_shape

#: Bumped with any visual change; recorded in the resume's provenance.
PDF_TEMPLATE_VERSION = "simple/v1"

#: Written as a code point so the source stays unambiguous ASCII; the
#: rendered output is an en dash either way.
EN_DASH = chr(0x2013)

_TEMPLATE_SOURCE = """<!doctype html>
<html lang="{{ document.language }}">
<head>
<meta charset="utf-8">
<title>{{ document.contact.full_name }}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Calibri, Carlito, "DejaVu Sans", sans-serif;
    font-size: 10.5pt;
    line-height: 1.35;
    color: #111;
    margin: 0;
  }
  h1 { font-size: 20pt; margin: 0 0 2mm 0; }
  .contact { font-size: 10.5pt; margin-bottom: 4mm; }
  h2 {
    font-size: 12pt;
    margin: 4mm 0 1.5mm 0;
    padding-bottom: 0.8mm;
    border-bottom: 0.4pt solid #888;
  }
  .entry { margin-bottom: 2.5mm; page-break-inside: avoid; }
  .entry-head { display: flex; justify-content: space-between; gap: 6mm; }
  .entry-title { font-weight: 700; }
  .entry-dates { white-space: nowrap; color: #333; }
  .detail { color: #333; }
  ul { margin: 1mm 0 0 0; padding-left: 5mm; }
  li { margin-bottom: 0.8mm; }
  .inline-list { margin: 0; }
</style>
</head>
<body>
  <h1>{{ document.contact.full_name }}</h1>
  {% if contact_line %}<div class="contact">{{ contact_line }}</div>{% endif %}

  {% for section in document.sections %}
    <section>
      <h2>{{ section.heading }}</h2>
      {% if section.kind in ('skills', 'languages') %}
        <p class="inline-list">{{ inline_lists[section.kind] }}</p>
      {% else %}
        {% for entry in section.entries %}
          <div class="entry">
            <div class="entry-head">
              <span class="entry-title">{{ entry.headline }}</span>
              {% if entry.dates %}<span class="entry-dates">{{ entry.dates }}</span>{% endif %}
            </div>
            {% if entry.detail %}<div class="detail">{{ entry.detail }}</div>{% endif %}
            {% if entry.bullets %}
              <ul>
                {% for bullet in entry.bullets %}<li>{{ bullet }}</li>{% endfor %}
              </ul>
            {% endif %}
          </div>
        {% endfor %}
      {% endif %}
    </section>
  {% endfor %}
</body>
</html>
"""


@dataclass(frozen=True)
class RenderedPdf:
    pdf: bytes | None
    pages: int | None
    #: Why the PDF is missing, when it is. Reported, never swallowed.
    unavailable_reason: str | None


def _environment() -> Environment:
    return Environment(
        autoescape=select_autoescape(default_for_string=True, default=True),
        # No loader: the only template is the constant above, so no file on
        # disk can be substituted for it.
    )


def build_html(document: ResumeDocument) -> str:
    """Render the document to a standalone HTML string."""
    current_label = "Present" if document.language == "en" else "Actualidad"

    contact = document.contact
    contact_parts = [p for p in (contact.email, contact.phone, contact.location) if p]
    contact_parts.extend(contact.links)

    inline_lists: dict[str, str] = {}
    # A plain view model for the template: headings, strings and lists only.
    view_sections: list[dict[str, object]] = []
    for section in document.sections:
        if section.kind in {"skills", "languages"}:
            items = []
            for entry in section.entries:
                label = entry.title or ""
                if entry.detail:
                    label = f"{label} ({entry.detail})"
                if label:
                    items.append(label)
            inline_lists[section.kind] = ", ".join(items)
            view_sections.append({"kind": section.kind, "heading": section.heading, "entries": []})
            continue

        entries: list[dict[str, object]] = []
        for entry in section.entries:
            headline = " — ".join(p for p in (entry.title, entry.organization) if p)
            if entry.start_month or entry.end_month:
                start = entry.start_month or ""
                end = current_label if entry.current else (entry.end_month or "")
                dates = f"{start} {EN_DASH} {end}" if start and end else (start or end)
            else:
                dates = ""
            entries.append(
                {
                    "headline": headline,
                    "dates": dates,
                    "detail": entry.detail,
                    "bullets": [bullet.text for bullet in entry.bullets],
                }
            )
        view_sections.append({"kind": section.kind, "heading": section.heading, "entries": entries})

    template = _environment().from_string(_TEMPLATE_SOURCE)
    return template.render(
        document={
            "language": document.language,
            "contact": {"full_name": document.contact.full_name},
            "sections": view_sections,
        },
        contact_line=" · ".join(contact_parts),
        inline_lists=inline_lists,
    )


async def render_pdf(document: ResumeDocument) -> RenderedPdf:
    """Print the document with Chromium, or explain why it could not be."""
    markup = build_html(document)

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return RenderedPdf(None, None, "Playwright is not installed in this worker build.")

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(args=["--disable-dev-shm-usage"])
            try:
                page = await browser.new_page()
                # set_content, not a URL: nothing is served and nothing is
                # fetched. The template references no external resource, so
                # "networkidle" would only ever wait for nothing.
                await page.set_content(markup, wait_until="load")
                pdf = await page.pdf(format="A4", print_background=True)
            finally:
                await browser.close()
    except Exception as error:
        log_shape("render_cv.pdf_failed", error=type(error).__name__)
        return RenderedPdf(None, None, f"Chromium could not render the PDF: {type(error).__name__}")

    return RenderedPdf(pdf, _count_pages(pdf), None)


def _count_pages(pdf: bytes) -> int | None:
    """Page count, for the overflow warning. Never guesses."""
    try:
        import io

        from pypdf import PdfReader

        return len(PdfReader(io.BytesIO(pdf)).pages)
    except Exception:
        return None


def escape_preview(text: str) -> str:
    """Escaped text for any preview surface that is not the template."""
    return html.escape(text, quote=True)
