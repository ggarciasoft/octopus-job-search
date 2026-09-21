"""Hard filters (06_AI_PROFILE_AND_CV.md, "Fit algorithm v1").

These run before any score, and they answer a different question from it: not
"how well does this fit?" but "can this person apply at all?".

Three rules hold throughout:

* ``unknown`` is never rounded to ``yes`` or ``no``. A posting that does not
  state where it can be done is unknown, not worldwide.
* An ``unknown`` on a *blocking* filter blocks application readiness. It never
  hides the job: the user can still read it, and the UI says what is missing.
* Nothing is converted. A salary in another currency or over another period is
  ``SALARY_NOT_COMPARABLE``, because an invented exchange rate would produce a
  confident comparison out of two numbers that were never comparable.
"""

from __future__ import annotations

from ..contracts.generated import (
    EligibilityCheck,
    MatchEvidence,
    MatchJobSnapshot,
    Preferences,
)
from .profile_facts import ConfirmedProfile
from .text import excerpt, fold

#: Filters where "we cannot tell" must stop an application rather than pass
#: quietly. Location and work authorization are the two the user cannot fix by
#: reading the posting more carefully, and the two where being wrong means
#: applying for something they are not allowed to take.
BLOCKING_FILTERS = frozenset({"location", "work_authorization"})


def _check(
    filter_name: str,
    verdict: str,
    code: str,
    evidence: list[MatchEvidence] | None = None,
) -> EligibilityCheck:
    return EligibilityCheck(
        filter=filter_name,  # type: ignore[arg-type]
        verdict=verdict,  # type: ignore[arg-type]
        code=code,  # type: ignore[arg-type]
        blocking=filter_name in BLOCKING_FILTERS,
        evidence=evidence or [],
    )


def _job_evidence(text: str) -> MatchEvidence:
    return MatchEvidence(source="job", excerpt=excerpt(text), fact_id=None)


def _profile_evidence(text: str, fact_id: str) -> MatchEvidence:
    return MatchEvidence(source="profile", excerpt=excerpt(text), fact_id=fact_id)


def check_excluded_employer(job: MatchJobSnapshot, preferences: Preferences) -> EligibilityCheck:
    if not preferences.excluded_companies:
        return _check("excluded_employer", "yes", "NOT_CONFIGURED")
    company = fold(job.company)
    for excluded in preferences.excluded_companies:
        if fold(excluded) == company:
            return _check(
                "excluded_employer",
                "no",
                "EMPLOYER_EXCLUDED",
                [_job_evidence(job.company)],
            )
    return _check("excluded_employer", "yes", "PASSES")


def check_employment_type(job: MatchJobSnapshot, preferences: Preferences) -> EligibilityCheck:
    if not preferences.employment_types:
        return _check("employment_type", "yes", "NOT_CONFIGURED")
    if job.employment_type is None:
        return _check("employment_type", "unknown", "EMPLOYMENT_TYPE_NOT_STATED")
    if job.employment_type in preferences.employment_types:
        return _check("employment_type", "yes", "PASSES", [_job_evidence(job.employment_type)])
    return _check(
        "employment_type",
        "no",
        "EMPLOYMENT_TYPE_NOT_ACCEPTED",
        [_job_evidence(job.employment_type)],
    )


def check_location(job: MatchJobSnapshot, preferences: Preferences) -> EligibilityCheck:
    """Declared location eligibility.

    ``eligible_countries is None`` means the posting does not say. That is the
    common case and it is reported as unknown, never as "anywhere": a remote
    posting restricted to one country reads exactly the same until someone
    checks.
    """
    if not preferences.countries:
        # Nothing to check against. Not the user's failure and not the job's,
        # so it does not block: it is a setting they have not filled in.
        return EligibilityCheck(
            filter="location",
            verdict="unknown",
            code="NOT_CONFIGURED",
            blocking=False,
            evidence=[],
        )
    if job.eligible_countries is None:
        return _check("location", "unknown", "COUNTRY_NOT_STATED")
    shared = set(job.eligible_countries) & set(preferences.countries)
    if shared:
        return _check(
            "location",
            "yes",
            "PASSES",
            [_job_evidence(", ".join(sorted(shared)))],
        )
    return _check(
        "location",
        "no",
        "COUNTRY_NOT_ELIGIBLE",
        [_job_evidence(", ".join(sorted(job.eligible_countries)))],
    )


def check_work_authorization(
    job: MatchJobSnapshot,
    preferences: Preferences,
    profile: ConfirmedProfile,
) -> EligibilityCheck:
    """Authorization to work in the countries the posting is open to.

    Note the order of the negatives. "No authorization fact at all" and "a
    fact that says no" are different outcomes, and neither is allowed to read
    as a yes.
    """
    if not profile.authorizations:
        return _check("work_authorization", "unknown", "AUTHORIZATION_ABSENT")
    if job.eligible_countries is None:
        # Which authorization would even apply is unknown, so the answer is.
        return _check("work_authorization", "unknown", "COUNTRY_NOT_STATED")

    relevant = [
        held for held in profile.authorizations if held.value.country in job.eligible_countries
    ]
    if not relevant:
        return _check("work_authorization", "unknown", "AUTHORIZATION_NOT_CONFIRMED")

    for held in relevant:
        if held.value.authorized == "yes":
            return _check(
                "work_authorization",
                "yes",
                "PASSES",
                [_profile_evidence(f"Authorized to work in {held.value.country}", held.fact_id)],
            )

    sponsorship_needed = [held for held in relevant if held.value.sponsorship_required == "yes"]
    if sponsorship_needed:
        held = sponsorship_needed[0]
        evidence = [
            _profile_evidence(
                f"Sponsorship required for {held.value.country}",
                held.fact_id,
            )
        ]
        if preferences.sponsorship_policy == "avoid":
            return _check("work_authorization", "no", "SPONSORSHIP_REQUIRED", evidence)
        # Whether an employer will sponsor is the employer's answer to give.
        return _check("work_authorization", "unknown", "SPONSORSHIP_REQUIRED", evidence)

    return _check("work_authorization", "unknown", "AUTHORIZATION_NOT_CONFIRMED")


def check_language(
    job: MatchJobSnapshot,
    preferences: Preferences,
    profile: ConfirmedProfile,
) -> EligibilityCheck:
    if job.language is None:
        return _check("language", "unknown", "LANGUAGE_NOT_STATED")

    job_base = job.language.split("-")[0].lower()
    for held in profile.languages:
        if held.value.code.split("-")[0].lower() == job_base:
            return _check(
                "language",
                "yes",
                "PASSES",
                [
                    _profile_evidence(
                        f"{held.value.code} ({held.value.declared_level})", held.fact_id
                    )
                ],
            )
    for declared in preferences.languages:
        if declared.split("-")[0].lower() == job_base:
            return _check("language", "yes", "PASSES", [_job_evidence(job.language)])
    return _check("language", "no", "LANGUAGE_NOT_DECLARED", [_job_evidence(job.language)])


def check_salary_minimum(job: MatchJobSnapshot, preferences: Preferences) -> EligibilityCheck:
    """Salary floor, and only where the two figures are actually comparable.

    The upper bound is the one compared: if the top of the advertised range is
    still under the minimum, no negotiation inside that range reaches it. A
    range with no upper bound falls back to its lower bound.
    """
    wanted = preferences.salary
    if wanted is None:
        return _check("salary_minimum", "yes", "NOT_CONFIGURED")
    offered = job.salary
    if offered is None:
        return _check("salary_minimum", "unknown", "SALARY_NOT_STATED")
    if offered.currency != wanted.currency or offered.period != wanted.period:
        return _check(
            "salary_minimum",
            "unknown",
            "SALARY_NOT_COMPARABLE",
            [_job_evidence(offered.source_excerpt)],
        )
    ceiling = offered.max if offered.max is not None else offered.min
    if ceiling is None:
        return _check(
            "salary_minimum",
            "unknown",
            "SALARY_NOT_STATED",
            [_job_evidence(offered.source_excerpt)],
        )
    if ceiling >= wanted.minimum:
        return _check("salary_minimum", "yes", "PASSES", [_job_evidence(offered.source_excerpt)])
    return _check(
        "salary_minimum",
        "no",
        "SALARY_BELOW_MINIMUM",
        [_job_evidence(offered.source_excerpt)],
    )


def evaluate(
    job: MatchJobSnapshot,
    preferences: Preferences,
    profile: ConfirmedProfile,
) -> tuple[list[EligibilityCheck], str]:
    """Run every hard filter and fold the results into one verdict.

    A single ``no`` decides the outcome. Otherwise an unknown on a blocking
    filter leaves the whole verdict unknown, and only a clean sweep is ``yes``.
    Non-blocking unknowns (an unstated salary, an unstated employment type) do
    not make someone ineligible; they are visible in the checks themselves.
    """
    checks = [
        check_excluded_employer(job, preferences),
        check_employment_type(job, preferences),
        check_location(job, preferences),
        check_work_authorization(job, preferences, profile),
        check_language(job, preferences, profile),
        check_salary_minimum(job, preferences),
    ]

    if any(check.verdict == "no" for check in checks):
        return checks, "no"
    if any(check.verdict == "unknown" and check.blocking for check in checks):
        return checks, "unknown"
    return checks, "yes"
