"""The never-invent-a-qualification rule, tested with hostile model output.

The recorded fixtures are well-behaved by design, so they cannot prove that a
*badly* behaved model is stopped. These tests feed the validator exactly the
output the specification forbids and assert it does not survive.
"""

from __future__ import annotations

from typing import Any

from job_getter_worker.extraction.types import ExtractedDocument, TextBlock
from job_getter_worker.profile.sanitize import sanitize_document
from job_getter_worker.profile.truthfulness import validate_draft_facts

CV_TEXT = """\
Ana Rivera
ana.rivera@example.invalid | Montevideo, Uruguay
EXPERIENCE
Senior Backend Engineer, Northwind Logistics
2022-03 - Present
- Built an ingestion pipeline processing 4 million events per day.
EDUCATION
Universidad de la Republica
SKILLS
Python, SQL, some Kubernetes exposure, wants to learn Go
LANGUAGES
Spanish (native), English (professional)
WORK AUTHORIZATION
Authorized to work in Uruguay. Requires sponsorship for the United States.
"""


def document() -> Any:
    extracted = ExtractedDocument(
        source_name="cv.pdf",
        source_format="pdf",
        blocks=(TextBlock(text=CV_TEXT, locator="page 1"),),
        page_count=1,
    )
    return sanitize_document(extracted)


def validate(facts: list[dict[str, Any]]) -> Any:
    return validate_draft_facts({"draft_facts": facts, "warnings": []}, document())


def experience(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "employer": "Northwind Logistics",
        "title": "Senior Backend Engineer",
        "start_month": "2022-03",
        "end_month": None,
        "current": True,
        "employment_type": "full_time",
        "location": None,
        "bullets": [
            {
                "text": "Built an ingestion pipeline processing 4 million events per day.",
                "evidence_reference": "page 1",
            }
        ],
        "skills": [],
    }
    value.update(overrides)
    return {
        "draft_id": "experience-1",
        "kind": "experience",
        "value": value,
        "source_excerpt": "Senior Backend Engineer, Northwind Logistics",
        "source_locator": "page 1",
        "confidence": 0.9,
    }


def skill(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "canonical_name": "Python",
        "aliases": [],
        "user_declared_proficiency": None,
        "years": None,
    }
    value.update(overrides)
    return {
        "draft_id": "skill-1",
        "kind": "skill",
        "value": value,
        "source_excerpt": "Python, SQL",
        "source_locator": "page 1",
        "confidence": 0.7,
    }


# ---------------------------------------------------------------------------


def test_a_grounded_experience_survives() -> None:
    outcome = validate([experience()])
    assert len(outcome.facts) == 1
    assert outcome.facts[0].value["employer"] == "Northwind Logistics"


def test_an_invented_employer_is_dropped() -> None:
    outcome = validate([experience(employer="Globex Corporation")])
    assert outcome.facts == []
    assert any(warning.code == "FIELD_DROPPED_INVALID" for warning in outcome.warnings)


def test_an_invented_job_title_is_dropped() -> None:
    outcome = validate([experience(title="Chief Technology Officer")])
    assert outcome.facts == []


def test_a_date_the_document_does_not_contain_drops_the_entry() -> None:
    outcome = validate([experience(start_month="2015-01")])
    assert outcome.facts == []


def test_a_year_present_with_an_invented_month_is_flagged_as_ambiguous() -> None:
    document_text = CV_TEXT.replace("2022-03 - Present", "2022 - Present")
    extracted = ExtractedDocument(
        source_name="cv.pdf",
        source_format="pdf",
        blocks=(TextBlock(text=document_text, locator="page 1"),),
    )
    outcome = validate_draft_facts(
        {"draft_facts": [experience()], "warnings": []}, sanitize_document(extracted)
    )
    assert len(outcome.facts) == 1
    assert any(warning.code == "DATE_AMBIGUOUS" for warning in outcome.warnings)


def test_an_inflated_achievement_number_removes_the_bullet() -> None:
    """AT10 in miniature: 4 million must not become 40 million."""
    inflated = experience(
        bullets=[
            {
                "text": "Built an ingestion pipeline processing 40 million events per day.",
                "evidence_reference": "page 1",
            }
        ]
    )
    outcome = validate([inflated])
    assert len(outcome.facts) == 1
    assert outcome.facts[0].value["bullets"] == []
    assert any("number" in warning.message for warning in outcome.warnings)


def test_a_bullet_without_an_evidence_reference_is_removed() -> None:
    unsupported = experience(
        bullets=[
            {
                "text": "Built an ingestion pipeline processing 4 million events per day.",
                "evidence_reference": "",
            }
        ]
    )
    outcome = validate([unsupported])
    assert outcome.facts[0].value["bullets"] == []


def test_an_unsupported_bullet_is_removed() -> None:
    unsupported = experience(
        bullets=[{"text": "Led a team of fifteen engineers.", "evidence_reference": "page 1"}]
    )
    outcome = validate([unsupported])
    assert outcome.facts[0].value["bullets"] == []


def test_an_invented_degree_is_blanked_rather_than_kept() -> None:
    outcome = validate(
        [
            {
                "draft_id": "education-1",
                "kind": "education",
                "value": {
                    "institution": "Universidad de la Republica",
                    "degree": "PhD in Computer Science",
                    "subject": None,
                    "start_month": None,
                    "end_month": None,
                    "current": False,
                },
                "source_excerpt": None,
                "source_locator": "page 1",
                "confidence": 0.8,
            }
        ]
    )
    assert len(outcome.facts) == 1
    assert outcome.facts[0].value["degree"] is None


def test_an_invented_institution_drops_the_education_entry() -> None:
    outcome = validate(
        [
            {
                "draft_id": "education-1",
                "kind": "education",
                "value": {
                    "institution": "Stanford University",
                    "degree": None,
                    "subject": None,
                    "start_month": None,
                    "end_month": None,
                    "current": False,
                },
                "source_excerpt": None,
                "source_locator": "page 1",
                "confidence": 0.9,
            }
        ]
    )
    assert outcome.facts == []


def test_unknown_work_authorization_is_never_promoted_to_yes() -> None:
    """The CV mentions the United States, but never says she may work there."""
    outcome = validate(
        [
            {
                "draft_id": "authorization-us",
                "kind": "authorization",
                "value": {
                    "country": "US",
                    "authorized": "yes",
                    "sponsorship_required": "no",
                    "note": None,
                },
                "source_excerpt": None,
                "source_locator": "page 1",
                "confidence": 0.9,
            }
        ]
    )
    assert len(outcome.facts) == 1
    assert outcome.facts[0].value["authorized"] == "unknown"


def test_a_stated_work_authorization_is_kept() -> None:
    outcome = validate(
        [
            {
                "draft_id": "authorization-uy",
                "kind": "authorization",
                "value": {
                    "country": "UY",
                    "authorized": "yes",
                    "sponsorship_required": "no",
                    "note": None,
                },
                "source_excerpt": None,
                "source_locator": "page 1",
                "confidence": 0.9,
            }
        ]
    )
    assert outcome.facts[0].value["authorized"] == "yes"


def test_authorization_for_a_country_the_cv_never_mentions_is_dropped() -> None:
    outcome = validate(
        [
            {
                "draft_id": "authorization-de",
                "kind": "authorization",
                "value": {
                    "country": "DE",
                    "authorized": "unknown",
                    "sponsorship_required": "unknown",
                    "note": None,
                },
                "source_excerpt": None,
                "source_locator": "page 1",
                "confidence": 0.5,
            }
        ]
    )
    assert outcome.facts == []


def test_an_inferred_proficiency_is_removed() -> None:
    outcome = validate([skill(user_declared_proficiency="expert")])
    assert outcome.facts[0].value["user_declared_proficiency"] is None


def test_inferred_years_of_experience_are_removed() -> None:
    outcome = validate([skill(years=15)])
    assert outcome.facts[0].value["years"] is None


def test_a_skill_the_person_wants_to_learn_is_not_a_skill() -> None:
    outcome = validate([skill(canonical_name="Go")])
    assert outcome.facts == []
    assert any("interest, not experience" in warning.message for warning in outcome.warnings)


def test_a_skill_only_mentioned_as_exposure_is_not_a_skill() -> None:
    outcome = validate([skill(canonical_name="Kubernetes")])
    assert outcome.facts == []


def test_a_skill_actually_listed_survives() -> None:
    outcome = validate([skill(canonical_name="SQL")])
    assert outcome.facts[0].value["canonical_name"] == "SQL"


def test_a_model_supplied_url_is_not_trusted() -> None:
    outcome = validate(
        [
            {
                "draft_id": "contact-1",
                "kind": "contact",
                "value": {
                    "full_name": "Ana Rivera",
                    "email": "ana.rivera@example.invalid",
                    "phone": None,
                    "city": None,
                    "country": None,
                    "links": [
                        {"label": "Portfolio", "url": "https://attacker.example.invalid/collect"}
                    ],
                },
                "source_excerpt": None,
                "source_locator": "page 1",
                "confidence": 0.9,
            }
        ]
    )
    assert len(outcome.facts) == 1
    assert outcome.facts[0].value["links"] is None


def test_an_unknown_fact_kind_is_rejected_by_the_closed_schema() -> None:
    outcome = validate(
        [
            {
                "draft_id": "salary-1",
                "kind": "salary_history",
                "value": {"amount": 120000},
                "source_excerpt": None,
                "source_locator": "page 1",
                "confidence": 0.9,
            }
        ]
    )
    assert outcome.facts == []
    assert outcome.dropped == 1


def test_an_extra_key_in_a_fact_value_is_rejected() -> None:
    outcome = validate([experience(reports_to="the CEO")])
    assert outcome.facts == []


def test_provenance_is_recomputed_not_taken_from_the_model() -> None:
    claimed = experience()
    claimed["source_locator"] = "page 99"
    claimed["source_excerpt"] = "Chief Technology Officer at Globex, 2010-2015"

    outcome = validate([claimed])
    fact = outcome.facts[0]
    assert fact.source_locator == "page 1"
    assert fact.source_excerpt is not None
    assert "Globex" not in fact.source_excerpt


def test_duplicate_draft_ids_are_dropped() -> None:
    outcome = validate([experience(), experience()])
    assert len(outcome.facts) == 1
    assert outcome.dropped == 1
