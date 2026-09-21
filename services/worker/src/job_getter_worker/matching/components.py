"""The five weighted score components (06_AI_PROFILE_AND_CV.md).

Each component returns a value in 0-1 *or* declares itself not evaluable. The
distinction is the load-bearing part of this file. A component that cannot be
judged is excluded from the renormalised score and counted against coverage;
it is never scored 0, because 0 is a judgement ("a bad match") and absence of
evidence is not one.

Every value carries the text it came from. A number a user cannot trace back to
a line of their CV and a line of the posting is not reviewable, and this
product's whole claim is that its output can be reviewed.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..contracts.generated import (
    SKILL_PREFERRED_WEIGHT,
    SKILL_REQUIRED_WEIGHT,
    ExperienceValue,
    MatchComponent,
    MatchedRequirement,
    MatchEvidence,
    MatchJobSnapshot,
    Preferences,
    SkillValue,
)
from .aliases import equivalents, related
from .profile_facts import ConfirmedProfile, Held
from .text import contains_phrase, excerpt, fold, overlap

#: Seniority ladder, lowest first. Distance along it drives the component, so
#: the *order* matters and the exact labels do not.
_SENIORITY_LADDER: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("intern", ("intern", "internship", "becario", "pasante", "trainee")),
    ("junior", ("junior", "jr", "entry level", "entry", "graduate", "associate")),
    ("mid", ("mid", "mid level", "intermediate", "ssr", "semi senior")),
    ("senior", ("senior", "sr", "senior level")),
    ("staff", ("staff", "principal", "architect", "lead", "tech lead")),
    ("director", ("director", "head", "vp", "vice president", "chief", "cto")),
)

_LADDER_INDEX = {name: index for index, (name, _) in enumerate(_SENIORITY_LADDER)}


def _evidence_job(text: str) -> MatchEvidence:
    return MatchEvidence(source="job", excerpt=excerpt(text), fact_id=None)


def _evidence_profile(text: str, fact_id: str) -> MatchEvidence:
    return MatchEvidence(source="profile", excerpt=excerpt(text), fact_id=fact_id)


def _unknown(key: str, weight: int, code: str) -> MatchComponent:
    return MatchComponent(
        key=key,  # type: ignore[arg-type]
        value=None,
        weight=weight,
        evaluable=False,
        unknown_code=code,  # type: ignore[arg-type]
        evidence=[],
        fact_ids=[],
    )


def _scored(
    key: str,
    weight: int,
    value: float,
    evidence: list[MatchEvidence],
    fact_ids: list[str],
) -> MatchComponent:
    return MatchComponent(
        key=key,  # type: ignore[arg-type]
        value=max(0.0, min(1.0, value)),
        weight=weight,
        evaluable=True,
        unknown_code=None,
        evidence=evidence[:20],
        fact_ids=fact_ids[:50],
    )


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SkillsOutcome:
    component: MatchComponent
    requirements: list[MatchedRequirement]


def _skill_names(held: Held[SkillValue]) -> list[str]:
    value = held.value
    return [value.canonical_name, *value.aliases]


def _match_requirement(
    requirement_text: str,
    skills: tuple[Held[SkillValue], ...],
) -> tuple[str, Held[SkillValue] | None, str | None]:
    """Resolve one requirement against the confirmed skills.

    Returns ``(outcome, held, matched_name)``. An exact or equivalent name
    found in the requirement text is a match; a merely *related* name is
    ``uncertain`` and deliberately earns nothing.
    """
    uncertain: tuple[Held[SkillValue], str] | None = None
    for held in skills:
        for name in _skill_names(held):
            if not name:
                continue
            for equivalent in equivalents(name):
                if contains_phrase(requirement_text, equivalent):
                    return "matched", held, name
            if uncertain is None:
                for neighbour in related(name):
                    if contains_phrase(requirement_text, neighbour):
                        uncertain = (held, name)
                        break
    if uncertain is not None:
        held, name = uncertain
        return "uncertain", held, name
    return "missing", None, None


def skills_component(
    job: MatchJobSnapshot,
    profile: ConfirmedProfile,
    weight: int,
) -> SkillsOutcome:
    """Weighted matched requirements over weighted requirements.

    Required requirements count double (``SKILL_REQUIRED_WEIGHT``). A
    requirement the extractor could not classify counts as preferred rather
    than required: treating an unclassified line as mandatory would overstate
    what the employer actually asked for.
    """
    if not job.requirements:
        return SkillsOutcome(_unknown("skills", weight, "JOB_STATES_NOTHING"), [])
    if not profile.skills:
        matched = [
            MatchedRequirement(
                requirement=requirement,
                outcome="missing",
                weight=(
                    SKILL_REQUIRED_WEIGHT
                    if requirement.kind == "required"
                    else SKILL_PREFERRED_WEIGHT
                ),
                fact_ids=[],
                matched_skill=None,
            )
            for requirement in job.requirements
        ]
        return SkillsOutcome(_unknown("skills", weight, "PROFILE_STATES_NOTHING"), matched)

    results: list[MatchedRequirement] = []
    total_weight = 0
    matched_weight = 0
    evidence: list[MatchEvidence] = []
    fact_ids: list[str] = []

    for requirement in job.requirements:
        requirement_weight = (
            SKILL_REQUIRED_WEIGHT if requirement.kind == "required" else SKILL_PREFERRED_WEIGHT
        )
        total_weight += requirement_weight
        outcome, held, matched_name = _match_requirement(requirement.text, profile.skills)
        if outcome == "matched" and held is not None:
            matched_weight += requirement_weight
            results.append(
                MatchedRequirement(
                    requirement=requirement,
                    outcome="matched",
                    weight=requirement_weight,
                    fact_ids=[held.fact_id],
                    matched_skill=matched_name,
                )
            )
            if len(evidence) < 20:
                evidence.append(_evidence_job(requirement.evidence_excerpt))
            if held.fact_id not in fact_ids:
                fact_ids.append(held.fact_id)
        elif outcome == "uncertain" and held is not None:
            results.append(
                MatchedRequirement(
                    requirement=requirement,
                    outcome="uncertain",
                    weight=requirement_weight,
                    # Not credited, so not cited as supporting evidence either.
                    fact_ids=[],
                    matched_skill=matched_name,
                )
            )
        else:
            results.append(
                MatchedRequirement(
                    requirement=requirement,
                    outcome="missing",
                    weight=requirement_weight,
                    fact_ids=[],
                    matched_skill=None,
                )
            )

    if total_weight == 0:  # pragma: no cover - every kind carries weight >= 1
        return SkillsOutcome(_unknown("skills", weight, "NOT_COMPARABLE"), results)

    return SkillsOutcome(
        _scored("skills", weight, matched_weight / total_weight, evidence, fact_ids),
        results,
    )


# ---------------------------------------------------------------------------
# Role / title
# ---------------------------------------------------------------------------


def role_title_component(
    job: MatchJobSnapshot,
    preferences: Preferences,
    profile: ConfirmedProfile,
    weight: int,
) -> MatchComponent:
    """Best token overlap between the posting's title and a title the user owns.

    "Owns" means a title they said they want (``target_titles``) or one they
    have actually held (a confirmed experience fact). Both are compared the
    same way, and the winning comparison is cited.
    """
    candidates: list[tuple[str, str | None]] = [
        (title, None) for title in preferences.target_titles
    ]
    candidates.extend((held.value.title, held.fact_id) for held in profile.experiences)
    if not candidates:
        return _unknown("role_title", weight, "PROFILE_STATES_NOTHING")

    best_value = 0.0
    best_source: tuple[str, str | None] | None = None
    for title, fact_id in candidates:
        value = overlap(job.title, title)
        if value > best_value:
            best_value = value
            best_source = (title, fact_id)

    evidence = [_evidence_job(job.title)]
    fact_ids: list[str] = []
    if best_source is not None:
        title, fact_id = best_source
        if fact_id is None:
            evidence.append(MatchEvidence(source="profile", excerpt=excerpt(title), fact_id=None))
        else:
            evidence.append(_evidence_profile(title, fact_id))
            fact_ids.append(fact_id)

    return _scored("role_title", weight, best_value, evidence, fact_ids)


# ---------------------------------------------------------------------------
# Seniority
# ---------------------------------------------------------------------------


def _seniority_of(text: str) -> tuple[str, str] | None:
    """The ladder rung named in ``text``, with the phrase that named it.

    The ladder is scanned from the top down so that "senior staff engineer"
    resolves to staff rather than senior.
    """
    folded = fold(text)
    for name, phrases in reversed(_SENIORITY_LADDER):
        for phrase in phrases:
            if contains_phrase(folded, phrase):
                return name, phrase
    return None


def seniority_component(
    job: MatchJobSnapshot,
    profile: ConfirmedProfile,
    weight: int,
) -> MatchComponent:
    """Distance along the seniority ladder, one rung at a time.

    Only the job *title* is read, not the description: a description
    mentioning "you will mentor junior engineers" says nothing about the level
    of the role being advertised, and reading it as if it did was the obvious
    way to get this wrong.
    """
    job_level = _seniority_of(job.title)
    if job_level is None:
        return _unknown("seniority", weight, "JOB_STATES_NOTHING")
    if not profile.experiences:
        return _unknown("seniority", weight, "PROFILE_STATES_NOTHING")

    best: tuple[int, Held[ExperienceValue], str] | None = None
    for held in profile.experiences:
        found = _seniority_of(held.value.title)
        if found is None:
            continue
        index = _LADDER_INDEX[found[0]]
        if best is None or index > best[0]:
            best = (index, held, found[0])
    if best is None:
        return _unknown("seniority", weight, "PROFILE_STATES_NOTHING")

    profile_index, held, profile_level = best
    distance = abs(_LADDER_INDEX[job_level[0]] - profile_index)
    # One rung apart is still a plausible application; three is not.
    value = max(0.0, 1.0 - 0.34 * distance)

    return _scored(
        "seniority",
        weight,
        value,
        [
            _evidence_job(job.title),
            _evidence_profile(f"{held.value.title} ({profile_level})", held.fact_id),
        ],
        [held.fact_id],
    )


# ---------------------------------------------------------------------------
# Work arrangement
# ---------------------------------------------------------------------------


def work_arrangement_component(
    job: MatchJobSnapshot,
    preferences: Preferences,
    weight: int,
) -> MatchComponent:
    """Remote mode and country, averaged over whichever of the two is knowable.

    An unknown ``remote_type`` is not an onsite job and not a remote one, so it
    contributes nothing rather than a guess. If neither sub-signal can be read,
    the component is not evaluable at all.
    """
    if not preferences.remote_modes:
        return _unknown("work_arrangement", weight, "PROFILE_STATES_NOTHING")

    signals: list[float] = []
    evidence: list[MatchEvidence] = []

    if job.remote_type != "unknown":
        matched = job.remote_type in preferences.remote_modes
        signals.append(1.0 if matched else 0.0)
        evidence.append(_evidence_job(job.remote_type))

    job_countries = {location.country for location in job.locations if location.country is not None}
    if job_countries and preferences.countries:
        shared = job_countries & set(preferences.countries)
        signals.append(1.0 if shared else 0.0)
        evidence.append(_evidence_job(", ".join(sorted(job_countries))))

    if not signals:
        return _unknown("work_arrangement", weight, "JOB_STATES_NOTHING")

    return _scored("work_arrangement", weight, sum(signals) / len(signals), evidence, [])


# ---------------------------------------------------------------------------
# Industry
# ---------------------------------------------------------------------------


def industry_component(weight: int) -> MatchComponent:
    """Always unevaluable in v1, and honest about why.

    Neither the job contracts nor the profile contracts carry an industry: no
    connector extracts one and the preferences schema has no field for one.
    Inferring it from the company name would be a guess presented as a fact, so
    the component declares itself unknown and gives its weight back to the
    others through renormalisation. Coverage therefore tops out below 100%
    whenever the industry weight is above 0, which is the true statement.
    """
    return _unknown("industry", weight, "JOB_STATES_NOTHING")
