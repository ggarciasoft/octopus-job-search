"""The fact allowlist and the never-invent-a-qualification rule.

This module is the reason the worker can be trusted with a model's output. A
model proposes; this code decides what survives, and it decides by asking one
question of every value: *is this in the document the user uploaded?*

Invariant 2, from ``docs/spec/00_AI_IMPLEMENTATION_INSTRUCTIONS.md``:

    Never invent qualifications, employers, dates, degrees, authorization,
    salary history, certifications, or achievement numbers.

Concretely, and each of these is tested:

* Output is validated against the **generated closed schema** for its fact
  kind. An unknown kind, or an extra key, is rejected rather than coerced.
* An employer, institution, certification, project or contact name that is not
  in the document is dropped.
* A bullet must be supported by the document text *and* carry an
  ``evidence_reference``. Every number in it must be a number the document
  contains.
* A month that is not in the document is reported as ambiguous rather than
  presented as read; a year that is not in the document drops the fact.
* Work authorization is only ``yes`` when the document says so. ``unknown`` is
  never promoted, in either direction, by inference.
* A skill gets no proficiency and no year count unless the document states one,
  and a skill the person "wants to learn" is not a skill.
* Provenance is *recomputed* from the document, never taken from the model. A
  locator the worker cannot reproduce is not provenance.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Final

from pydantic import BaseModel, ValidationError

from ..contracts.generated import (
    AuthorizationValue,
    CertificationValue,
    ContactValue,
    DraftFact,
    EducationValue,
    ExperienceValue,
    LanguageValue,
    ProfileImportWarning,
    ProjectValue,
    SkillValue,
    SummaryValue,
)
from .grounding import Haystack, normalise
from .sanitize import SanitizedDocument

#: The fact allowlist: kind -> the generated closed model for its value.
#: Anything not in this mapping is not a fact this system knows how to hold.
FACT_VALUE_MODELS: Final[dict[str, type[BaseModel]]] = {
    "contact": ContactValue,
    "summary": SummaryValue,
    "experience": ExperienceValue,
    "education": EducationValue,
    "skill": SkillValue,
    "language": LanguageValue,
    "authorization": AuthorizationValue,
    "project": ProjectValue,
    "certification": CertificationValue,
}

MAX_DRAFT_FACTS: Final = 500
MAX_WARNINGS: Final = 100
MAX_EXCERPT_CHARS: Final = 2000

#: Phrases that turn a skill mention into an aspiration rather than experience.
ASPIRATIONAL_MARKERS: Final[tuple[str, ...]] = (
    "want to learn",
    "wants to learn",
    "would like to learn",
    "hoping to learn",
    "learning",
    "interested in",
    "curious about",
    "exposure",
    "familiar with",
    "no experience",
    "beginner",
    "reading about",
)

#: Enough country names to check the common cases. An unlisted code falls back
#: to requiring the literal code in the document, which is strict rather than
#: permissive - the safe direction.
COUNTRY_NAMES: Final[dict[str, tuple[str, ...]]] = {
    "AR": ("argentina",),
    "AT": ("austria",),
    "AU": ("australia",),
    "BE": ("belgium",),
    "BR": ("brazil", "brasil"),
    "CA": ("canada",),
    "CH": ("switzerland",),
    "CL": ("chile",),
    "CO": ("colombia",),
    "CZ": ("czech",),
    "DE": ("germany", "deutschland"),
    "DK": ("denmark",),
    "ES": ("spain", "espana"),
    "FI": ("finland",),
    "FR": ("france",),
    "GB": ("united kingdom", "uk", "great britain", "england", "scotland", "wales"),
    "IE": ("ireland",),
    "IL": ("israel",),
    "IN": ("india",),
    "IT": ("italy", "italia"),
    "JP": ("japan",),
    "MX": ("mexico",),
    "NL": ("netherlands", "holland"),
    "NO": ("norway",),
    "NZ": ("new zealand",),
    "PE": ("peru",),
    "PL": ("poland",),
    "PT": ("portugal",),
    "PY": ("paraguay",),
    "RO": ("romania",),
    "SE": ("sweden",),
    "SG": ("singapore",),
    "US": ("united states", "usa", "u.s.", "america"),
    "UY": ("uruguay",),
    "ZA": ("south africa",),
}

LANGUAGE_NAMES: Final[dict[str, tuple[str, ...]]] = {
    "de": ("german", "deutsch", "aleman"),
    "en": ("english", "ingles"),
    "es": ("spanish", "espanol", "castellano"),
    "fr": ("french", "francais", "frances"),
    "it": ("italian", "italiano"),
    "pt": ("portuguese", "portugues"),
}

#: An explicit authorization statement. Nationality, a city or a phone prefix
#: is not one, which is the whole point of AT07.
_AUTHORIZED_PATTERNS: Final[tuple[str, ...]] = (
    r"(authori[sz]ed|eligible|permitted|entitled)[^.\n]{{0,60}}{term}",
    r"{term}[^.\n]{{0,60}}(citizen|citizenship|passport|work permit|work visa)",
    r"(citizen|permanent resident|work permit|work visa)[^.\n]{{0,40}}{term}",
    r"right to work[^.\n]{{0,60}}{term}",
)

_PROFICIENCY_WORDS: Final[dict[str, tuple[str, ...]]] = {
    "beginner": ("beginner", "basic", "novice"),
    "intermediate": ("intermediate",),
    "advanced": ("advanced",),
    "expert": ("expert", "expert-level"),
}


@dataclass
class ValidatedFacts:
    """What survived validation, and why anything did not."""

    facts: list[DraftFact] = field(default_factory=list)
    warnings: list[ProfileImportWarning] = field(default_factory=list)
    dropped: int = 0

    def warn(self, code: str, message: str, detail: str | None = None) -> None:
        candidate = ProfileImportWarning.model_validate(
            {"code": code, "message": message[:500], "detail": detail[:500] if detail else None}
        )
        for existing in self.warnings:
            if existing.code == candidate.code and existing.detail == candidate.detail:
                return
        if len(self.warnings) < MAX_WARNINGS:
            self.warnings.append(candidate)


def validate_result_shape(payload: Any) -> dict[str, Any]:
    """Cheap structural check used as the provider's validation callback.

    Deliberately shallow: its job is to decide whether the *response* is a
    result at all, which is what a correction attempt can fix. Per-fact
    truthfulness is decided afterwards by :func:`validate_draft_facts`, and a
    model cannot correct its way past that.
    """
    if not isinstance(payload, dict):
        raise ValueError("response is not a JSON object")
    facts = payload.get("draft_facts")
    if not isinstance(facts, list):
        raise ValueError("draft_facts is missing or not a list")
    warnings = payload.get("warnings", [])
    if not isinstance(warnings, list):
        raise ValueError("warnings is not a list")
    return payload


def validate_draft_facts(payload: Any, document: SanitizedDocument) -> ValidatedFacts:
    """Check every proposed fact against the document. Drop what is not there."""
    outcome = ValidatedFacts()
    haystack = Haystack(document.text)

    raw_warnings = payload.get("warnings", []) if isinstance(payload, dict) else []
    for item in raw_warnings if isinstance(raw_warnings, list) else []:
        try:
            warning = ProfileImportWarning.model_validate(item)
        except ValidationError:
            continue
        outcome.warn(warning.code, warning.message, warning.detail)

    raw_facts = payload.get("draft_facts", []) if isinstance(payload, dict) else []
    seen_ids: set[str] = set()

    for index, item in enumerate(raw_facts if isinstance(raw_facts, list) else []):
        if len(outcome.facts) >= MAX_DRAFT_FACTS:
            outcome.warn(
                "FIELD_DROPPED_INVALID",
                f"More than {MAX_DRAFT_FACTS} facts were proposed; the rest were ignored.",
                detail="draft fact limit",
            )
            break

        fact = _validate_one(item, index, haystack, document, outcome, seen_ids)
        if fact is None:
            outcome.dropped += 1
            continue
        seen_ids.add(fact.draft_id)
        outcome.facts.append(fact)

    return outcome


# ---------------------------------------------------------------------------
# One fact
# ---------------------------------------------------------------------------


def _validate_one(
    item: Any,
    index: int,
    haystack: Haystack,
    document: SanitizedDocument,
    outcome: ValidatedFacts,
    seen_ids: set[str],
) -> DraftFact | None:
    try:
        draft = DraftFact.model_validate(item)
    except ValidationError:
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "A proposed fact did not match the expected structure and was discarded.",
            detail=f"draft fact #{index + 1}",
        )
        return None

    if draft.draft_id in seen_ids:
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "Two proposed facts shared the same identifier; the duplicate was discarded.",
            detail=f"draft_id {draft.draft_id}",
        )
        return None

    model = FACT_VALUE_MODELS.get(draft.kind)
    if model is None:  # pragma: no cover - DraftFact.kind is already closed
        return None

    try:
        value = model.model_validate(draft.value)
    except ValidationError:
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A proposed {draft.kind} entry was incomplete or malformed, so it was not "
            "added. You can still enter it by hand.",
            detail=f"draft_id {draft.draft_id}",
        )
        return None

    checked = _CHECKERS[draft.kind](value, haystack, outcome, draft.draft_id)
    if checked is None:
        return None

    identity = _IDENTITY[draft.kind](checked)
    locator = document.locator_for(identity) if identity else None
    if identity and locator is None:
        locator = _locator_by_coverage(identity, document)

    excerpt = _excerpt_for(draft.source_excerpt, identity, haystack, document)

    return DraftFact(
        draft_id=draft.draft_id,
        kind=draft.kind,
        value=checked.model_dump(mode="json"),
        source_excerpt=excerpt,
        source_locator=locator,
        # Confidence is a parsing aid, never confirmation (docs/spec/04).
        confidence=draft.confidence,
    )


def _locator_by_coverage(identity: str, document: SanitizedDocument) -> str | None:
    best: tuple[float, str] | None = None
    for block in document.blocks:
        score = Haystack(block.text).coverage(identity)
        if best is None or score > best[0]:
            best = (score, block.locator)
    if best is not None and best[0] >= 0.85:
        return best[1]
    return None


def _excerpt_for(
    proposed: str | None,
    identity: str,
    haystack: Haystack,
    document: SanitizedDocument,
) -> str | None:
    """Keep the model's excerpt only if the document really contains it."""
    if proposed and haystack.covers(proposed):
        return proposed[:MAX_EXCERPT_CHARS]
    for block in document.blocks:
        if identity and normalise(identity) in normalise(block.text):
            return block.text[:MAX_EXCERPT_CHARS]
    return None


# ---------------------------------------------------------------------------
# Shared checks
# ---------------------------------------------------------------------------


def _month_ok(
    month: str | None, haystack: Haystack, outcome: ValidatedFacts, subject: str
) -> tuple[bool, str | None]:
    """Validate a ``YYYY-MM`` value against the document.

    Returns ``(keep_fact, month_or_None)``. A year the document does not
    mention means the whole entry is unfounded. A year that is present with a
    month that is not is reported as ambiguous and kept for the user to
    confirm - that is what ``DATE_AMBIGUOUS`` is for.
    """
    if month is None:
        return True, None
    year = month.split("-")[0]
    if year not in haystack.numbers:
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A date was proposed for {subject} that does not appear in the document, "
            "so the entry was not added.",
            detail=f"{subject}: {month}",
        )
        return False, None
    if not haystack.contains_exact(month):
        outcome.warn(
            "DATE_AMBIGUOUS",
            f"The document gives a year but not a month for {subject}. The month shown "
            "is a placeholder and needs your confirmation.",
            detail=f"{subject}: {month}",
        )
    return True, month


def _clean_bullets(
    bullets: list[Any],
    haystack: Haystack,
    outcome: ValidatedFacts,
    subject: str,
) -> list[Any]:
    kept = []
    for bullet in bullets:
        if not bullet.evidence_reference.strip():
            outcome.warn(
                "FIELD_DROPPED_INVALID",
                f"A bullet for {subject} carried no evidence reference and was removed.",
                detail=subject,
            )
            continue
        if not haystack.covers(bullet.text):
            outcome.warn(
                "FIELD_DROPPED_INVALID",
                f"A bullet proposed for {subject} is not supported by the document, so "
                "it was removed.",
                detail=subject,
            )
            continue
        if not haystack.has_all_numbers(bullet.text):
            outcome.warn(
                "FIELD_DROPPED_INVALID",
                f"A bullet for {subject} contains a number the document does not, so it "
                "was removed rather than shown as read from your CV.",
                detail=subject,
            )
            continue
        kept.append(bullet)
    return kept


def _clean_skill_list(
    skills: list[str], haystack: Haystack, outcome: ValidatedFacts, subject: str
) -> list[str]:
    kept = [skill for skill in skills if haystack.contains_word(skill)]
    if len(kept) != len(skills):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"Some skills listed under {subject} do not appear in the document and were removed.",
            detail=subject,
        )
    return kept


# ---------------------------------------------------------------------------
# Per-kind checks
# ---------------------------------------------------------------------------


def _check_contact(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> ContactValue | None:
    contact: ContactValue = value
    if not haystack.contains_exact(contact.full_name):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "A name was proposed that does not appear in the document, so it was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None
    if not haystack.contains_exact(contact.email):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "An email address was proposed that does not appear in the document, so the "
            "contact entry was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None

    links = [link for link in (contact.links or []) if haystack.contains_exact(link.url)]
    if contact.links is not None and len(links) != len(contact.links):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "A link was proposed that does not appear in the document. Links are never "
            "taken from anywhere but your own file, so it was removed.",
            detail=f"draft_id {draft_id}",
        )

    phone = contact.phone if contact.phone and haystack.contains_exact(contact.phone) else None
    city = contact.city if contact.city and haystack.contains_exact(contact.city) else None
    country = (
        contact.country if contact.country and haystack.contains_exact(contact.country) else None
    )
    return contact.model_copy(
        update={"links": links or None, "phone": phone, "city": city, "country": country}
    )


def _check_summary(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> SummaryValue | None:
    summary: SummaryValue = value
    if not haystack.covers(summary.text) or not haystack.has_all_numbers(summary.text):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "A summary was proposed that is not supported by the document, so it was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None
    return summary


def _check_experience(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> ExperienceValue | None:
    experience: ExperienceValue = value
    subject = experience.employer

    if not haystack.contains_exact(experience.employer):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "An employer was proposed that does not appear in the document. Nothing was "
            "added for it.",
            detail=f"draft_id {draft_id}",
        )
        return None
    if not haystack.contains_exact(experience.title):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A job title was proposed for {subject} that does not appear in the "
            "document, so the role was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None

    keep_start, start = _month_ok(experience.start_month, haystack, outcome, subject)
    if not keep_start or start is None:
        return None
    keep_end, end = _month_ok(experience.end_month, haystack, outcome, subject)
    if not keep_end:
        end = None

    location = (
        experience.location
        if experience.location and haystack.contains_exact(experience.location)
        else None
    )

    return experience.model_copy(
        update={
            "start_month": start,
            "end_month": end,
            "location": location,
            "bullets": _clean_bullets(list(experience.bullets), haystack, outcome, subject),
            "skills": _clean_skill_list(list(experience.skills), haystack, outcome, subject),
        }
    )


def _check_education(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> EducationValue | None:
    education: EducationValue = value
    if not haystack.contains_exact(education.institution):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "An institution was proposed that does not appear in the document. No "
            "education entry was added for it.",
            detail=f"draft_id {draft_id}",
        )
        return None

    subject = education.institution
    degree = education.degree if education.degree and haystack.covers(education.degree) else None
    if education.degree and degree is None:
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A degree was proposed for {subject} that the document does not state, so "
            "it was left blank rather than assumed.",
            detail=f"draft_id {draft_id}",
        )
    field_of_study = (
        education.subject if education.subject and haystack.covers(education.subject) else None
    )

    keep_start, start = _month_ok(education.start_month, haystack, outcome, subject)
    keep_end, end = _month_ok(education.end_month, haystack, outcome, subject)
    return education.model_copy(
        update={
            "degree": degree,
            "subject": field_of_study,
            "start_month": start if keep_start else None,
            "end_month": end if keep_end else None,
        }
    )


def _check_skill(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> SkillValue | None:
    skill: SkillValue = value
    name = skill.canonical_name
    segments = haystack.segments_around(name)
    if not segments:
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A skill was proposed ({name}) that does not appear in the document, so it "
            "was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None

    if all(any(marker in segment for marker in ASPIRATIONAL_MARKERS) for segment in segments):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"The document mentions {name} as something wanted, being learned or only "
            "briefly encountered. That is an interest, not experience, so it was not "
            "proposed as a skill.",
            detail=f"draft_id {draft_id}",
        )
        return None

    proficiency = skill.user_declared_proficiency
    if proficiency is not None:
        words = _PROFICIENCY_WORDS.get(proficiency, ())
        if not any(word in segment for segment in segments for word in words):
            outcome.warn(
                "FIELD_DROPPED_INVALID",
                f"A proficiency level was proposed for {name} that the document does not "
                "state. Proficiency is yours to declare, so it was left blank.",
                detail=f"draft_id {draft_id}",
            )
            proficiency = None

    years = skill.years
    if years is not None:
        rendered = f"{years:g}"
        if not any(
            re.search(rf"(?<![0-9]){re.escape(rendered)}(?![0-9])[^.\n]{{0,20}}year", segment)
            for segment in segments
        ):
            outcome.warn(
                "FIELD_DROPPED_INVALID",
                f"A number of years was proposed for {name} that the document does not "
                "state, so it was left blank rather than estimated.",
                detail=f"draft_id {draft_id}",
            )
            years = None

    aliases = [alias for alias in skill.aliases if haystack.contains_word(alias)]
    return skill.model_copy(
        update={"user_declared_proficiency": proficiency, "years": years, "aliases": aliases}
    )


def _check_language(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> LanguageValue | None:
    language: LanguageValue = value
    base = language.code.split("-")[0].lower()
    terms = LANGUAGE_NAMES.get(base, (base,))
    if not any(haystack.contains_word(term) for term in terms):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A language ({language.code}) was proposed that the document does not "
            "mention, so it was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None
    return language


def _check_authorization(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> AuthorizationValue | None:
    authorization: AuthorizationValue = value
    code = authorization.country
    terms = COUNTRY_NAMES.get(code, (code.lower(),))
    if not any(haystack.contains_word(term) for term in terms):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A work-authorization entry was proposed for {code}, which the document "
            "does not mention. It was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None

    authorized = authorization.authorized
    if authorized == "yes" and not _states_authorization(haystack, terms):
        # Unknown is never promoted to yes. A nationality, a city or a phone
        # prefix is not a statement of the right to work (AT07).
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"The document does not state that you are authorised to work in {code}, so "
            "this was recorded as unknown rather than assumed. You can confirm it "
            "yourself during review.",
            detail=f"draft_id {draft_id}",
        )
        authorized = "unknown"

    note = (
        authorization.note
        if authorization.note and haystack.covers(authorization.note, 0.5)
        else None
    )
    return authorization.model_copy(update={"authorized": authorized, "note": note})


def _states_authorization(haystack: Haystack, terms: tuple[str, ...]) -> bool:
    for term in terms:
        for template in _AUTHORIZED_PATTERNS:
            if re.search(template.format(term=re.escape(term)), haystack.normalised):
                return True
    return False


def _check_project(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> ProjectValue | None:
    project: ProjectValue = value
    if not haystack.contains_exact(project.name):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A project ({project.name}) was proposed that does not appear in the "
            "document, so it was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None

    url = project.url if project.url and haystack.contains_exact(project.url) else None
    if project.url and url is None:
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            "A project link was proposed that does not appear in the document. Links "
            "generated by a model are never trusted, so it was removed.",
            detail=f"draft_id {draft_id}",
        )
    role = project.role if project.role and haystack.covers(project.role) else None
    keep_start, start = _month_ok(project.start_month, haystack, outcome, project.name)
    keep_end, end = _month_ok(project.end_month, haystack, outcome, project.name)

    return project.model_copy(
        update={
            "url": url,
            "role": role,
            "start_month": start if keep_start else None,
            "end_month": end if keep_end else None,
            "bullets": _clean_bullets(list(project.bullets), haystack, outcome, project.name),
            "skills": _clean_skill_list(list(project.skills), haystack, outcome, project.name),
        }
    )


def _check_certification(
    value: Any, haystack: Haystack, outcome: ValidatedFacts, draft_id: str
) -> CertificationValue | None:
    certification: CertificationValue = value
    if not haystack.covers(certification.name):
        outcome.warn(
            "FIELD_DROPPED_INVALID",
            f"A certification ({certification.name}) was proposed that does not appear "
            "in the document. Certifications are never inferred, so it was not added.",
            detail=f"draft_id {draft_id}",
        )
        return None

    issuer = (
        certification.issuer
        if certification.issuer and haystack.contains_exact(certification.issuer)
        else None
    )
    credential = (
        certification.credential_id
        if certification.credential_id and haystack.contains_exact(certification.credential_id)
        else None
    )
    keep_issued, issued = _month_ok(
        certification.issued_month, haystack, outcome, certification.name
    )
    keep_expires, expires = _month_ok(
        certification.expires_month, haystack, outcome, certification.name
    )
    return certification.model_copy(
        update={
            "issuer": issuer,
            "credential_id": credential,
            "issued_month": issued if keep_issued else None,
            "expires_month": expires if keep_expires else None,
        }
    )


_CHECKERS: Final[dict[str, Any]] = {
    "contact": _check_contact,
    "summary": _check_summary,
    "experience": _check_experience,
    "education": _check_education,
    "skill": _check_skill,
    "language": _check_language,
    "authorization": _check_authorization,
    "project": _check_project,
    "certification": _check_certification,
}

_IDENTITY: Final[dict[str, Any]] = {
    "contact": lambda value: value.full_name,
    "summary": lambda value: value.text,
    "experience": lambda value: value.employer,
    "education": lambda value: value.institution,
    "skill": lambda value: value.canonical_name,
    "language": lambda value: "",
    "authorization": lambda value: "",
    "project": lambda value: value.name,
    "certification": lambda value: value.name,
}
