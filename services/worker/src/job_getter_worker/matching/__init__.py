"""Fit algorithm v1: deterministic scoring with citable evidence.

``compute_match`` is a pure function of its input. No clock beyond the stamp on
the result, no network, no provider call, no randomness: the same
``MatchJobInput`` produces the same ``MatchJobResult`` on any worker, which is
what makes a score reproducible and what lets the API key a cached row on the
revision tuple alone.

Deliberately not AI. The specification permits a model to *suggest* a title or
seniority classification, but requires score assembly and the hard filters to
stay deterministic. v1 keeps the whole path deterministic: it costs no budget,
it works with no provider configured, and a user asking "why 62?" gets an
answer made of their own text rather than a model's opinion.
"""

from __future__ import annotations

from ..clock import utc_now_string
from ..contracts.generated import (
    MATCH_ALGORITHM_VERSION,
    SKILL_ALIAS_MAP_VERSION,
    MatchComponent,
    MatchExplanation,
    MatchJobInput,
    MatchJobResult,
)
from . import components as component_rules
from . import eligibility as eligibility_rules
from .profile_facts import collect

__all__ = ["collect", "compute_match"]


def _assemble_score(components: list[MatchComponent]) -> tuple[int | None, int]:
    """Renormalise over the evaluable components only.

    Returns ``(score, evaluated_weight)``. With nothing evaluable the score is
    ``None`` rather than 0: "we could not tell" and "a bad match" are different
    answers, and only one of them is honest here.
    """
    evaluated = [
        component
        for component in components
        if component.evaluable and component.value is not None and component.weight > 0
    ]
    total_weight = sum(component.weight for component in evaluated)
    if total_weight == 0:
        return None, 0
    weighted = sum(component.weight * (component.value or 0.0) for component in evaluated)
    return round(100 * weighted / total_weight), total_weight


def compute_match(task_input: MatchJobInput) -> MatchJobResult:
    """Score one job against the confirmed profile and the user's preferences."""
    job = task_input.job
    preferences = task_input.preferences
    weights = preferences.match_weights
    profile = collect(task_input.confirmed_facts)

    checks, eligible = eligibility_rules.evaluate(job, preferences, profile)

    skills = component_rules.skills_component(job, profile, weights.skills)
    components = [
        skills.component,
        component_rules.role_title_component(job, preferences, profile, weights.role_title),
        component_rules.seniority_component(job, profile, weights.seniority),
        component_rules.work_arrangement_component(job, preferences, weights.work_arrangement),
        component_rules.industry_component(weights.industry),
    ]

    score, evaluated_weight = _assemble_score(components)

    # Coverage is measured against the weight the user actually configured, so
    # that zeroing a component's weight does not quietly count as a gap.
    total_weight = (
        weights.skills
        + weights.role_title
        + weights.seniority
        + weights.work_arrangement
        + weights.industry
    )
    coverage = round(100 * evaluated_weight / total_weight) if total_weight > 0 else 0

    fact_ids: list[str] = []
    for component in components:
        for fact_id in component.fact_ids:
            if fact_id not in fact_ids:
                fact_ids.append(fact_id)

    explanation = MatchExplanation(
        algorithm_version=MATCH_ALGORITHM_VERSION,
        alias_map_version=SKILL_ALIAS_MAP_VERSION,
        components=components,
        eligibility=checks,
        requirements=skills.requirements,
        unknown_components=[component.key for component in components if not component.evaluable],
        fact_ids=fact_ids[:200],
        evaluated_weight=evaluated_weight,
    )

    return MatchJobResult(
        eligible=eligible,  # type: ignore[arg-type]
        score=score,
        coverage_percent=coverage,
        explanation=explanation,
        computed_at=utc_now_string(),
    )
