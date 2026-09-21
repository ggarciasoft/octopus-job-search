"""Deterministic validation of a resume document against confirmed facts.

The second of the spec's three layers. The first is the closed schema, which
Pydantic applies before anything here runs; the third is the user, whose
approval is mandatory and which no amount of this file replaces.

The question asked of every string is the same one the profile importer asks of
a model's output: *is this in the source?* Here the source is the set of
confirmed facts a document element cites. A bullet claiming "reduced latency by
40%" is kept only when 40 appears in a fact it cites; an employer name is kept
only when the user's profile contains that employer; a credential id is kept
only when the certification fact carries it.

What this cannot do is judge meaning. A bullet can be faithful in every number
and still overstate a contribution, and no deterministic check will catch that.
That is why the outcome is called ``passed_automatic_checks`` rather than
``valid``, and why the UI is required to say approval is the user's.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..contracts.generated import (
    ProfileFact,
    ResumeDocument,
    ResumeEntry,
    ResumeFinding,
    ResumeSection,
)
from ..matching.text import contains_phrase, fold

#: Numbers a bullet may use without the facts vouching for them: small counts
#: and years-of-experience style figures are almost always restatements, but a
#: number nobody wrote down is still an achievement claim, so nothing is exempt
#: by default. This stays empty deliberately; it is here to document the choice.
_EXEMPT_NUMBERS: frozenset[str] = frozenset()

_NUMBER = re.compile(r"\d[\d.,]*")
_MONTH = re.compile(r"^[0-9]{4}-(0[1-9]|1[0-2])$")

#: Findings that mean the document says something the profile does not support.
#: Anything in this set stops the CV being offered as ready to send.
BLOCKING_CODES: frozenset[str] = frozenset(
    {
        "UNKNOWN_FACT_ID",
        "NUMBER_NOT_IN_FACTS",
        "NAME_NOT_IN_FACTS",
        "DATE_NOT_IN_FACTS",
        "CREDENTIAL_NOT_IN_FACTS",
        "ROLES_MERGED",
        "PROJECT_PRESENTED_AS_EMPLOYMENT",
        "SKILL_NOT_CONFIRMED",
        "BULLET_WITHOUT_FACT",
        "MODEL_OUTPUT_REJECTED",
    }
)


@dataclass
class ValidationOutcome:
    """The document as it survived, plus what happened to it."""

    document: ResumeDocument
    findings: list[ResumeFinding] = field(default_factory=list)
    fact_ids: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not any(finding.severity == "blocking" for finding in self.findings)


def _finding(
    code: str,
    where: str | None,
    excerpt: str | None,
    *,
    removed: bool,
) -> ResumeFinding:
    return ResumeFinding(
        code=code,  # type: ignore[arg-type]
        severity="blocking" if code in BLOCKING_CODES else "warning",
        where=where,
        excerpt=excerpt[:600] if excerpt else None,
        removed=removed,
    )


def _fact_haystack(fact: ProfileFact) -> str:
    """Every string and number inside one fact, folded, for containment."""
    parts: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, str):
            parts.append(node)
        elif isinstance(node, bool):
            return
        elif isinstance(node, (int, float)):
            parts.append(f"{node:g}" if isinstance(node, float) else str(node))
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(fact.value)
    return fold(" ␟ ".join(parts))


def _normalize_number(token: str) -> str:
    """`40%`, `40`, `1,200` and `1200` compare as the same figure."""
    return token.replace(",", "").rstrip(".")


class _Facts:
    def __init__(self, facts: list[ProfileFact]) -> None:
        self.by_id: dict[str, ProfileFact] = {fact.id: fact for fact in facts if fact.confirmed}
        self.haystacks: dict[str, str] = {
            fact_id: _fact_haystack(fact) for fact_id, fact in self.by_id.items()
        }
        self.kinds: dict[str, str] = {fact_id: fact.kind for fact_id, fact in self.by_id.items()}
        self.skill_names: set[str] = set()
        for fact in self.by_id.values():
            if fact.kind == "skill" and isinstance(fact.value, dict):
                name = fact.value.get("canonical_name")
                if isinstance(name, str):
                    self.skill_names.add(fold(name))
                aliases = fact.value.get("aliases")
                if isinstance(aliases, list):
                    self.skill_names.update(fold(a) for a in aliases if isinstance(a, str))

    def haystack_for(self, fact_ids: list[str]) -> str:
        return " ␟ ".join(self.haystacks.get(fact_id, "") for fact_id in fact_ids)

    def numbers_in(self, fact_ids: list[str]) -> set[str]:
        found: set[str] = set()
        for fact_id in fact_ids:
            for token in _NUMBER.findall(self.haystacks.get(fact_id, "")):
                found.add(_normalize_number(token))
        return found


def _check_bullet_numbers(
    text: str, fact_ids: list[str], facts: _Facts, where: str
) -> list[ResumeFinding]:
    """Every figure in a bullet must be one the cited facts contain.

    This is the check that stops "improved throughput by 30%" appearing over a
    fact that never mentioned 30. AT10 is exactly this case.
    """
    available = facts.numbers_in(fact_ids)
    findings: list[ResumeFinding] = []
    for token in _NUMBER.findall(text):
        figure = _normalize_number(token)
        if figure in _EXEMPT_NUMBERS or figure in available:
            continue
        findings.append(_finding("NUMBER_NOT_IN_FACTS", where, text, removed=True))
        break
    return findings


def _check_entry(
    entry: ResumeEntry,
    section: ResumeSection,
    facts: _Facts,
    where: str,
) -> tuple[ResumeEntry | None, list[ResumeFinding]]:
    findings: list[ResumeFinding] = []

    unknown = [fact_id for fact_id in entry.fact_ids if fact_id not in facts.by_id]
    if unknown:
        findings.append(_finding("UNKNOWN_FACT_ID", where, ", ".join(unknown), removed=True))
        return None, findings

    kinds = {facts.kinds[fact_id] for fact_id in entry.fact_ids}

    # Two employments folded into one entry hides where someone actually
    # worked, and is called out by name in the spec.
    if (
        section.kind == "experience"
        and sum(1 for fact_id in entry.fact_ids if facts.kinds[fact_id] == "experience") > 1
    ):
        findings.append(_finding("ROLES_MERGED", where, entry.title or "", removed=True))
        return None, findings

    # A personal project must not be dressed as a job.
    if section.kind == "experience" and "project" in kinds:
        findings.append(
            _finding("PROJECT_PRESENTED_AS_EMPLOYMENT", where, entry.title or "", removed=True)
        )
        return None, findings
    if section.kind == "projects" and entry.organization:
        findings.append(
            _finding("PROJECT_PRESENTED_AS_EMPLOYMENT", where, entry.organization, removed=True)
        )
        entry = entry.model_copy(update={"organization": None})

    haystack = facts.haystack_for(entry.fact_ids)

    # A desired skill is not a skill.
    if (
        section.kind == "skills"
        and entry.title is not None
        and fold(entry.title) not in facts.skill_names
    ):
        findings.append(_finding("SKILL_NOT_CONFIRMED", where, entry.title, removed=True))
        return None, findings

    # Employer and institution names are checked literally: a name the profile
    # does not contain is a name nobody confirmed.
    if entry.organization and not contains_phrase(haystack, entry.organization):
        findings.append(_finding("NAME_NOT_IN_FACTS", where, entry.organization, removed=True))
        entry = entry.model_copy(update={"organization": None})

    for label, month in (("start_month", entry.start_month), ("end_month", entry.end_month)):
        if month is None:
            continue
        if not _MONTH.match(month) or month not in haystack:
            findings.append(_finding("DATE_NOT_IN_FACTS", f"{where}.{label}", month, removed=True))
            entry = entry.model_copy(update={label: None})

    if (
        section.kind == "certifications"
        and entry.detail
        and not contains_phrase(haystack, entry.detail)
    ):
        findings.append(_finding("CREDENTIAL_NOT_IN_FACTS", where, entry.detail, removed=True))
        entry = entry.model_copy(update={"detail": None})

    kept_bullets = []
    for index, bullet in enumerate(entry.bullets):
        bullet_where = f"{where}.bullets[{index}]"
        bullet_unknown = [fid for fid in bullet.fact_ids if fid not in facts.by_id]
        if bullet_unknown:
            findings.append(_finding("UNKNOWN_FACT_ID", bullet_where, bullet.text, removed=True))
            continue
        number_findings = _check_bullet_numbers(
            bullet.text, list(bullet.fact_ids), facts, bullet_where
        )
        if number_findings:
            findings.extend(number_findings)
            continue
        kept_bullets.append(bullet)

    if len(kept_bullets) != len(entry.bullets):
        entry = entry.model_copy(update={"bullets": kept_bullets})

    return entry, findings


def validate_document(
    document: ResumeDocument,
    facts: list[ProfileFact],
) -> ValidationOutcome:
    """Check a document against the confirmed facts and drop what fails.

    Removal rather than rejection is deliberate: one invented figure should
    cost the user that bullet, not the whole CV. The findings say exactly what
    went, so the removal is visible rather than silent.
    """
    index = _Facts(facts)
    findings: list[ResumeFinding] = []
    sections: list[ResumeSection] = []

    for section in document.sections:
        kept: list[ResumeEntry] = []
        for position, entry in enumerate(section.entries):
            where = f"{section.kind}[{position}]"
            checked, entry_findings = _check_entry(entry, section, index, where)
            findings.extend(entry_findings)
            if checked is not None:
                kept.append(checked)
        if kept:
            sections.append(section.model_copy(update={"entries": kept}))
        elif section.entries:
            # Everything in the section failed; say so rather than leaving a
            # heading over nothing or pretending the section never existed.
            findings.append(_finding("SECTION_OMITTED_EMPTY", section.kind, None, removed=True))

    cited: list[str] = []
    for section in sections:
        for entry in section.entries:
            for fact_id in entry.fact_ids:
                if fact_id not in cited:
                    cited.append(fact_id)
            for bullet in entry.bullets:
                for fact_id in bullet.fact_ids:
                    if fact_id not in cited:
                        cited.append(fact_id)
    for fact_id in document.contact.fact_ids:
        if fact_id not in cited:
            cited.append(fact_id)

    return ValidationOutcome(
        document=document.model_copy(update={"sections": sections}),
        findings=findings,
        fact_ids=cited,
    )
