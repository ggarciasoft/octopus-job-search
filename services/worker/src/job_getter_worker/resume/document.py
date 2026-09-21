"""Build a resume document from confirmed facts, deterministically.

This is the floor the whole feature stands on. It takes confirmed profile facts
and assembles the document *without rewriting anything*: every string it emits
is either copied from a fact or is a section heading from a fixed label table.
It invents nothing because it composes nothing.

That makes it two useful things at once. It is the document a workspace with no
provider configured gets, so CV generation works with no AI at all (AT28). And
it is the baseline a model's output is checked against: the tailored path may
reorder, shorten and re-emphasise what is here, and anything it introduces that
is not here is a finding.

Ordering is the one judgement it makes. Experience is newest first, and when a
job is supplied the entries whose text overlaps the job's requirements are
lifted within their section. Choosing what to *show first* is emphasis, not
invention, which is precisely the line the spec draws.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from ..contracts.generated import (
    ContactValue,
    JobRequirement,
    ProfileFact,
    ResumeBullet,
    ResumeContact,
    ResumeDocument,
    ResumeEntry,
    ResumeSection,
)
from ..matching.text import fold, overlap

#: A confirmed fact's validated JSON value, as stored.
FactValue = dict[str, object]

#: Section headings in both supported languages. Renderers never translate;
#: whatever the worker puts here is what appears on the page.
HEADINGS: Final[dict[str, dict[str, str]]] = {
    "en": {
        "summary": "Summary",
        "skills": "Skills",
        "experience": "Experience",
        "projects": "Projects",
        "education": "Education",
        "certifications": "Certifications",
        "languages": "Languages",
    },
    "es": {
        "summary": "Perfil",
        "skills": "Habilidades",
        "experience": "Experiencia",
        "projects": "Proyectos",
        "education": "Formación",
        "certifications": "Certificaciones",
        "languages": "Idiomas",
    },
}

#: The spec's default order. An empty section is omitted, not left as a bare
#: heading over nothing.
SECTION_ORDER: Final[tuple[str, ...]] = (
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
    "certifications",
    "languages",
)

#: Declared language levels, rendered as the user stated them.
_LANGUAGE_LEVELS: Final[dict[str, dict[str, str]]] = {
    "en": {
        "basic": "Basic",
        "conversational": "Conversational",
        "professional": "Professional",
        "native": "Native",
    },
    "es": {
        "basic": "Básico",
        "conversational": "Conversacional",
        "professional": "Profesional",
        "native": "Nativo",
    },
}


@dataclass(frozen=True)
class FactIndex:
    """Confirmed facts bucketed by kind, with their ids kept alongside."""

    by_kind: dict[str, list[tuple[str, FactValue]]]

    @classmethod
    def build(cls, facts: list[ProfileFact]) -> FactIndex:
        buckets: dict[str, list[tuple[str, FactValue]]] = {}
        for fact in facts:
            if not fact.confirmed:
                continue
            if not isinstance(fact.value, dict):
                continue
            buckets.setdefault(fact.kind, []).append((fact.id, fact.value))
        return cls(by_kind=buckets)

    def of(self, kind: str) -> list[tuple[str, FactValue]]:
        return self.by_kind.get(kind, [])


def _text(value: FactValue, key: str) -> str | None:
    raw = value.get(key)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _month(value: FactValue, key: str) -> str | None:
    """A calendar month as stored, or None. Never coerced from anything else."""
    raw = value.get(key)
    return raw if isinstance(raw, str) else None


def _relevance(text: str, requirements: list[JobRequirement]) -> float:
    """How strongly a string echoes the job's requirements.

    Used only to order entries. It can never add or remove one, so the worst a
    bad score does is put a true thing lower on the page.
    """
    if not requirements:
        return 0.0
    return max(overlap(text, requirement.text) for requirement in requirements)


def _contact(index: FactIndex) -> ResumeContact:
    for fact_id, value in index.of("contact"):
        try:
            parsed = ContactValue.model_validate(value)
        except Exception:  # noqa: S112 - a malformed contact is simply not used
            continue
        location = ", ".join(part for part in (parsed.city, parsed.country) if part)
        return ResumeContact(
            full_name=parsed.full_name,
            email=parsed.email,
            phone=parsed.phone,
            location=location or None,
            # The URL is what a reader can act on; the label is decoration
            # that would be indistinguishable from an invented one on paper.
            links=[link.url for link in (parsed.links or [])][:10],
            fact_ids=[fact_id],
        )
    # No confirmed contact fact. The document still renders; the validator
    # reports the gap rather than inventing a name.
    return ResumeContact(
        full_name="",
        email=None,
        phone=None,
        location=None,
        links=[],
        fact_ids=[],
    )


def _summary_section(index: FactIndex, language: str) -> ResumeSection | None:
    entries: list[ResumeEntry] = []
    for fact_id, value in index.of("summary"):
        text = _text(value, "text")
        if text is None:
            continue
        entries.append(
            ResumeEntry(
                title=None,
                organization=None,
                start_month=None,
                end_month=None,
                current=False,
                detail=None,
                bullets=[ResumeBullet(text=text, fact_ids=[fact_id])],
                fact_ids=[fact_id],
            )
        )
    if not entries:
        return None
    return ResumeSection(kind="summary", heading=HEADINGS[language]["summary"], entries=entries)


def _skills_section(
    index: FactIndex, language: str, requirements: list[JobRequirement]
) -> ResumeSection | None:
    entries: list[tuple[float, ResumeEntry]] = []
    for fact_id, value in index.of("skill"):
        name = _text(value, "canonical_name")
        if name is None:
            continue
        # Proficiency and years are shown only when the user stated them.
        proficiency = value.get("user_declared_proficiency")
        years = value.get("years")
        detail_parts: list[str] = []
        if isinstance(proficiency, str) and proficiency:
            detail_parts.append(proficiency)
        if isinstance(years, (int, float)):
            detail_parts.append(f"{years:g}")
        entry = ResumeEntry(
            title=name,
            organization=None,
            start_month=None,
            end_month=None,
            current=False,
            detail=", ".join(detail_parts) or None,
            bullets=[],
            fact_ids=[fact_id],
        )
        entries.append((_relevance(name, requirements), entry))
    if not entries:
        return None
    # Requirement-matching skills first; ties keep their profile order.
    ordered = [entry for _, entry in sorted(entries, key=lambda pair: -pair[0])]
    return ResumeSection(kind="skills", heading=HEADINGS[language]["skills"], entries=ordered)


def _experience_section(
    index: FactIndex, language: str, requirements: list[JobRequirement]
) -> ResumeSection | None:
    entries: list[tuple[str, float, ResumeEntry]] = []
    for fact_id, value in index.of("experience"):
        title = _text(value, "title")
        employer = _text(value, "employer")
        if title is None and employer is None:
            continue
        bullets: list[ResumeBullet] = []
        raw_bullets = value.get("bullets")
        if isinstance(raw_bullets, list):
            for raw in raw_bullets:
                if not isinstance(raw, dict):
                    continue
                text = _text(raw, "text")
                if text is None:
                    continue
                bullets.append(ResumeBullet(text=text, fact_ids=[fact_id]))
        start = _month(value, "start_month")
        entry = ResumeEntry(
            title=title,
            organization=employer,
            start_month=start,
            end_month=_month(value, "end_month"),
            current=bool(value.get("current")),
            detail=None,
            bullets=bullets,
            fact_ids=[fact_id],
        )
        haystack = " ".join(part for part in (title, employer) if part)
        entries.append(
            (start if isinstance(start, str) else "", _relevance(haystack, requirements), entry)
        )
    if not entries:
        return None
    # Newest first by start month; relevance breaks ties without reordering
    # history, because a CV that lists roles out of chronological order reads
    # as though something is being hidden.
    ordered = [
        entry for _, _, entry in sorted(entries, key=lambda item: (item[0], item[1]), reverse=True)
    ]
    return ResumeSection(
        kind="experience", heading=HEADINGS[language]["experience"], entries=ordered
    )


def _projects_section(index: FactIndex, language: str) -> ResumeSection | None:
    entries: list[ResumeEntry] = []
    for fact_id, value in index.of("project"):
        name = _text(value, "name")
        if name is None:
            continue
        bullets: list[ResumeBullet] = []
        raw_bullets = value.get("bullets")
        if isinstance(raw_bullets, list):
            for raw in raw_bullets:
                if isinstance(raw, dict):
                    text = _text(raw, "text")
                    if text is not None:
                        bullets.append(ResumeBullet(text=text, fact_ids=[fact_id]))
        entries.append(
            ResumeEntry(
                title=name,
                # Deliberately not an organization: a project is not an
                # employer, and putting one here is how a side project starts
                # reading as a job.
                organization=None,
                start_month=_month(value, "start_month"),
                end_month=_month(value, "end_month"),
                current=False,
                detail=_text(value, "role"),
                bullets=bullets,
                fact_ids=[fact_id],
            )
        )
    if not entries:
        return None
    return ResumeSection(kind="projects", heading=HEADINGS[language]["projects"], entries=entries)


def _education_section(index: FactIndex, language: str) -> ResumeSection | None:
    entries: list[ResumeEntry] = []
    for fact_id, value in index.of("education"):
        institution = _text(value, "institution")
        degree = _text(value, "degree")
        if institution is None and degree is None:
            continue
        entries.append(
            ResumeEntry(
                title=degree,
                organization=institution,
                start_month=_month(value, "start_month"),
                end_month=_month(value, "end_month"),
                current=False,
                detail=_text(value, "subject"),
                bullets=[],
                fact_ids=[fact_id],
            )
        )
    if not entries:
        return None
    return ResumeSection(kind="education", heading=HEADINGS[language]["education"], entries=entries)


def _certifications_section(index: FactIndex, language: str) -> ResumeSection | None:
    entries: list[ResumeEntry] = []
    for fact_id, value in index.of("certification"):
        name = _text(value, "name")
        if name is None:
            continue
        entries.append(
            ResumeEntry(
                title=name,
                organization=_text(value, "issuer"),
                start_month=_month(value, "issued_month"),
                end_month=None,
                current=False,
                detail=_text(value, "credential_id"),
                bullets=[],
                fact_ids=[fact_id],
            )
        )
    if not entries:
        return None
    return ResumeSection(
        kind="certifications", heading=HEADINGS[language]["certifications"], entries=entries
    )


def _languages_section(index: FactIndex, language: str) -> ResumeSection | None:
    entries: list[ResumeEntry] = []
    levels = _LANGUAGE_LEVELS[language]
    for fact_id, value in index.of("language"):
        code = _text(value, "code")
        if code is None:
            continue
        declared = value.get("declared_level")
        entries.append(
            ResumeEntry(
                title=code,
                organization=None,
                start_month=None,
                end_month=None,
                current=False,
                detail=levels.get(declared) if isinstance(declared, str) else None,
                bullets=[],
                fact_ids=[fact_id],
            )
        )
    if not entries:
        return None
    return ResumeSection(kind="languages", heading=HEADINGS[language]["languages"], entries=entries)


def build_document(
    facts: list[ProfileFact],
    language: str,
    requirements: list[JobRequirement] | None = None,
) -> ResumeDocument:
    """Assemble the deterministic document. Nothing here rewrites a fact."""
    index = FactIndex.build(facts)
    wanted = requirements or []

    builders = {
        "summary": lambda: _summary_section(index, language),
        "skills": lambda: _skills_section(index, language, wanted),
        "experience": lambda: _experience_section(index, language, wanted),
        "projects": lambda: _projects_section(index, language),
        "education": lambda: _education_section(index, language),
        "certifications": lambda: _certifications_section(index, language),
        "languages": lambda: _languages_section(index, language),
    }

    sections: list[ResumeSection] = []
    for kind in SECTION_ORDER:
        section = builders[kind]()
        if section is not None:
            sections.append(section)

    return ResumeDocument(
        schema_version=1,
        language=language,  # type: ignore[arg-type]
        contact=_contact(index),
        sections=sections,
    )


def document_strings(document: ResumeDocument) -> list[str]:
    """Every user-visible string, for the validator to check against facts."""
    out: list[str] = []
    contact = document.contact
    out.extend(
        part for part in (contact.full_name, contact.email, contact.phone, contact.location) if part
    )
    out.extend(contact.links)
    for section in document.sections:
        for entry in section.entries:
            out.extend(part for part in (entry.title, entry.organization, entry.detail) if part)
            out.extend(bullet.text for bullet in entry.bullets)
    return out


def fold_all(values: list[str]) -> str:
    """One folded haystack, for cheap containment checks."""
    return " ␟ ".join(fold(value) for value in values)
