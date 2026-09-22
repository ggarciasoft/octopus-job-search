"""AT12: what comes out of the renderers, read back the way a recipient would.

    AT12 | PDF/DOCX render | Text extractable, accents intact, no clipped
          sections on representative fixtures

Every other resume test asserts what goes *into* the renderer. These assert what
comes out: a real Chromium prints the PDF, pypdf reads it back, python-docx
reads the DOCX back, and the text is compared against the document that was
rendered. The three failures the scenario names are each a way a CV can look
fine on screen and be wrong in the file the employer opens.

**Text extractable.** A PDF of an image of a CV passes every visual check and is
unreadable to the applicant tracking system that will parse it first. Nobody
finds out.

**Accents intact.** `Muñoz` arriving as `Muoz` is somebody's name, misspelled,
on a job application they sent under it.

**Nothing clipped.** A page's worth of content is not a document's worth. The
long-document test below is the one that matters: a CV that overflows A4 must
continue onto page two, not stop at the bottom of page one, and the way to prove
that is to ask for the *last* line of the document after the render.
"""

from __future__ import annotations

import io
from typing import Any

import pytest
from docx import Document as DocxDocument
from pypdf import PdfReader

from job_getter_worker.contracts.generated import ProfileFact, ResumeDocument
from job_getter_worker.resume.document import build_document
from job_getter_worker.resume.docx_render import render_docx
from job_getter_worker.resume.pdf_render import render_pdf

from .test_resume import CONTACT_ID, EXPERIENCE_ID, SKILL_ID, experience_fact, fact, skill_fact

#: Every accented character Spanish actually needs, as they appear in the
#: fixture CV. Asserted individually so a failure names the one that was lost.
SPANISH_CHARACTERS = "áéíóúñüÓ¿"


def spanish_contact() -> ProfileFact:
    return fact(
        CONTACT_ID,
        "contact",
        {
            "full_name": "José Muñoz",
            "email": "jose@example.invalid",
            "phone": "+598 99 000 000",
            "city": "Asunción",
            "country": "Paraguay",
            "links": [],
        },
    )


def spanish_facts() -> list[ProfileFact]:
    """A document carrying every character in SPANISH_CHARACTERS."""
    return [
        spanish_contact(),
        experience_fact(
            employer="Northwind Logística",
            title="Ingeniera de Backend Sénior",
            bullets=[
                "Dirigí la migración del servicio de seguimiento.",
                "Documenté el sistema en español e inglés, de forma bilingüe.",
                "¿Quién redujo la latencia? Yo. EDUCACIÓN incluida.",
                "Automaticé el análisis de más de mil búsquedas.",
            ],
        ),
        skill_fact("Programación"),
    ]


def long_facts(entries: int = 14) -> list[ProfileFact]:
    """Comfortably more than one A4 page of experience.

    The last entry is named so the assertion can ask for it by name rather than
    guessing where the page break landed.
    """
    facts: list[ProfileFact] = [spanish_contact(), skill_fact()]
    for index in range(entries):
        last = index == entries - 1
        facts.append(
            experience_fact(
                fact_id=f"{EXPERIENCE_ID[:-2]}{index:02d}",
                employer="Último Empleador" if last else f"Empleador Número {index}",
                title="Ingeniera de Plataforma",
                bullets=[
                    f"Mantuve el servicio número {index} en producción.",
                    f"Reduje el coste operativo del equipo {index}.",
                    "La última línea de la última entrada." if last else "Otra tarea.",
                ],
            )
        )
    return facts


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def docx_text(data: bytes) -> str:
    parsed = DocxDocument(io.BytesIO(data))
    return "\n".join(paragraph.text for paragraph in parsed.paragraphs)


def every_string_in(document: ResumeDocument) -> list[str]:
    """Every piece of prose the document claims to contain.

    Rendering is only correct if all of this survives; a section heading that
    silently disappears is exactly the clipping AT12 asks about.
    """
    strings: list[str | None] = [document.contact.full_name]
    for section in document.sections:
        strings.append(section.heading)
        for item in section.entries:
            strings.append(item.title)
            strings.append(item.organization)
            strings.extend(bullet.text for bullet in item.bullets)
    return [value for value in strings if value]


async def rendered_pdf(document: ResumeDocument) -> bytes:
    result = await render_pdf(document)
    if result.pdf is None:
        pytest.skip(f"Chromium is not available in this build: {result.unavailable_reason}")
    return result.pdf


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


class TestPdfOutput:
    async def test_the_text_is_extractable_not_a_picture(self) -> None:
        document = build_document(spanish_facts(), "es")
        text = pdf_text(await rendered_pdf(document))

        # An applicant tracking system reads the file, not the pixels. A PDF
        # whose text cannot be pulled out is unreadable to the first thing that
        # will look at it, and nobody finds out.
        assert len(text.strip()) > 100
        assert "José Muñoz" in text

    async def test_accents_survive_the_print(self) -> None:
        document = build_document(spanish_facts(), "es")
        text = pdf_text(await rendered_pdf(document))

        for character in SPANISH_CHARACTERS:
            assert character in text, f"{character!r} was lost in the PDF"

    async def test_nothing_the_document_claims_is_missing_from_the_pdf(self) -> None:
        document = build_document(spanish_facts(), "es")
        text = pdf_text(await rendered_pdf(document))

        missing = [value for value in every_string_in(document) if value not in text]
        assert missing == [], f"these are in the document but not in the PDF: {missing}"

    async def test_a_long_cv_continues_onto_a_second_page_rather_than_stopping(self) -> None:
        """The clipping case, which is the one worth having.

        Content that does not fit A4 must flow onto the next page. If the
        renderer ever gains a fixed height, an `overflow: hidden`, or a
        single-page print option, this is what catches it — and what it catches
        is a CV that ends mid-sentence in the file the employer opens.
        """
        document = build_document(long_facts(), "es")
        result = await render_pdf(document)
        if result.pdf is None:
            pytest.skip(f"Chromium is not available in this build: {result.unavailable_reason}")

        assert result.pages is not None and result.pages > 1, (
            "the fixture is meant to overflow one page; it did not, so the test "
            "below would prove nothing"
        )

        text = pdf_text(result.pdf)
        # Named rather than positional: which page the break lands on is the
        # renderer's business, but the last line existing is not.
        assert "Último Empleador" in text
        assert "La última línea de la última entrada." in text

    async def test_every_entry_of_a_long_cv_survives(self) -> None:
        document = build_document(long_facts(), "es")
        text = pdf_text(await rendered_pdf(document))

        missing = [value for value in every_string_in(document) if value not in text]
        assert missing == [], f"{len(missing)} item(s) were clipped: {missing[:5]}"

    async def test_the_page_count_is_reported_rather_than_guessed(self) -> None:
        short = await render_pdf(build_document(spanish_facts(), "es"))
        if short.pdf is None:
            pytest.skip("Chromium is not available in this build")
        assert short.pages == 1
        assert short.unavailable_reason is None


# ---------------------------------------------------------------------------
# DOCX
# ---------------------------------------------------------------------------


class TestDocxOutput:
    def test_accents_survive_the_write(self) -> None:
        text = docx_text(render_docx(build_document(spanish_facts(), "es")))
        for character in SPANISH_CHARACTERS:
            assert character in text, f"{character!r} was lost in the DOCX"

    def test_nothing_the_document_claims_is_missing_from_the_docx(self) -> None:
        document = build_document(spanish_facts(), "es")
        text = docx_text(render_docx(document))

        missing = [value for value in every_string_in(document) if value not in text]
        assert missing == [], f"these are in the document but not in the DOCX: {missing}"

    def test_a_long_cv_keeps_its_last_entry(self) -> None:
        """A DOCX has no pages until something paginates it, so there is nothing
        here to clip — which is worth asserting rather than assuming."""
        document = build_document(long_facts(), "es")
        text = docx_text(render_docx(document))

        assert "Último Empleador" in text
        assert "La última línea de la última entrada." in text
        missing = [value for value in every_string_in(document) if value not in text]
        assert missing == []

    def test_the_headings_are_in_the_documents_own_language(self) -> None:
        spanish = docx_text(render_docx(build_document(spanish_facts(), "es")))
        english = docx_text(render_docx(build_document(spanish_facts(), "en")))

        assert "Experiencia" in spanish
        assert "Habilidades" in spanish
        assert "Experience" in english
        # The *content* is the user's own words and is never translated: only
        # the headings the product supplies follow the language setting.
        assert "Dirigí la migración del servicio de seguimiento." in english


# ---------------------------------------------------------------------------
# Both formats agree
# ---------------------------------------------------------------------------


async def test_the_two_formats_carry_the_same_facts(_: Any = None) -> None:
    """A CV that differs between the PDF and the DOCX is two CVs.

    The employer receives one of them and the user reviewed the other.
    """
    document = build_document(spanish_facts(), "es")
    pdf = pdf_text(await rendered_pdf(document))
    docx = docx_text(render_docx(document))

    for value in every_string_in(document):
        assert value in pdf, f"{value!r} missing from the PDF"
        assert value in docx, f"{value!r} missing from the DOCX"


def test_skill_fact_ids_stay_distinct() -> None:
    """Guards the long-document builder, not the renderer.

    `long_facts` mints ids by slicing a constant; if that ever collided the
    clipping tests would quietly render fewer entries than they claim to.
    """
    ids = {item.id for item in long_facts()}
    assert len(ids) == len(long_facts())
    assert SKILL_ID in ids
