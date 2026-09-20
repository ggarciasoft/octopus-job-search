"""JSON-LD ``JobPosting`` extraction from the synthetic pages.

A page is untrusted data: every value is validated and a bad one is dropped
with a warning that names the field but never repeats the value.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from job_getter_worker.contracts.generated import NormalizedJob
from job_getter_worker.discovery import extract_job_postings, normalize_job, normalize_url
from job_getter_worker.discovery.html_text import html_title, html_to_text
from job_getter_worker.discovery.jobposting import extract_ld_json_blocks, url_identity

from .conftest import read_page

NOW = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
PAGE_URL = "https://jobs.example.test/careers/1"


def extract(markup: str, **hints: str) -> tuple[list[NormalizedJob], list[str]]:
    result = extract_job_postings(markup, page_url=PAGE_URL, retrieved_at=NOW, **hints)
    jobs = [normalize_job(raw).job for raw in result.jobs]
    for job in jobs:
        NormalizedJob.model_validate(job.model_dump(mode="json"))
    return jobs, [f"{w.code}: {w.message}" for w in result.warnings]


def page_with(*blocks: object, body: str = "<h1>x</h1>") -> str:
    scripts = "".join(
        f'<script type="application/ld+json">{json.dumps(block)}</script>' for block in blocks
    )
    return f"<html><head><title>t</title>{scripts}</head><body>{body}</body></html>"


def test_single_posting_reads_every_structured_field() -> None:
    jobs, warnings = extract(read_page("jobposting-single.html"))
    assert warnings == []
    (job,) = jobs
    assert job.title == "Machine Learning Engineer"
    assert job.company == "Northlight Analytics"
    assert job.canonical_url == "https://careers.northlight-analytics.example/jobs/ml-engineer-2291"
    assert job.published_at == "2026-09-10T00:00:00.000Z"
    assert job.remote_type == "remote"  # jobLocationType TELECOMMUTE is structured
    assert job.eligible_countries == ["CA"]  # applicantLocationRequirements is structured
    assert [(loc.country, loc.region, loc.city) for loc in job.locations] == [
        ("CA", "ON", "Toronto")
    ]
    assert job.employment_type == "full_time"
    assert job.language == "en"
    assert job.salary is not None
    assert (job.salary.min, job.salary.max, job.salary.currency, job.salary.period) == (
        120000,
        150000,
        "CAD",
        "year",
    )
    assert {item.field for item in job.inferred} == {"requirements"}
    assert [(r.kind, r.text) for r in job.requirements] == [
        ("required", "3+ years shipping ML models to production"),
        ("required", "Strong Python and SQL"),
        ("preferred", "Time-series forecasting experience"),
    ]
    assert "<" not in job.description_text and "script" not in job.description_text.lower()


def test_graph_with_two_postings_yields_two_candidates() -> None:
    jobs, warnings = extract(read_page("jobposting-multiple.html"))
    assert warnings == []
    assert [job.title for job in jobs] == ["Warehouse Systems Engineer", "Fleet Data Analyst"]
    assert len({job.source_key for job in jobs}) == 2
    assert jobs[0].published_at == "2026-09-08T09:00:00.000Z"
    assert jobs[1].published_at is None
    assert [loc.country for loc in jobs[0].locations] == ["NL"]  # "Netherlands" via the table
    assert [loc.country for loc in jobs[1].locations] == ["NL"]  # "NL" as a structured code


def test_page_without_structured_data_yields_nothing_and_clean_text() -> None:
    markup = read_page("jobposting-none.html")
    jobs, warnings = extract(markup)
    assert jobs == [] and warnings == []
    text = html_to_text(markup)
    assert "NVQ Level 3" in text
    assert "£38,000 per year" in text  # entities decoded
    assert "__tracking" not in text and "alert(" not in text and "font-family" not in text
    assert "- Company van" in text
    assert html_title(markup) == "Field Service Technician - Meridian Elevators"


def test_nonsense_date_posted_is_null_with_a_warning_that_does_not_quote_it() -> None:
    jobs, warnings = extract(read_page("jobposting-prompt-injection.html"))
    (job,) = jobs
    assert job.published_at is None
    assert any(w.startswith("FIELD_DROPPED_INVALID") and "datePosted" in w for w in warnings)
    assert not any("posted recently" in w for w in warnings)


@pytest.mark.parametrize("date", ["2026-13-45", "yesterday", "1850-01-01", "2099-01-01", 20260910])
def test_invalid_dates_never_become_a_guess(date: object) -> None:
    jobs, warnings = extract(
        page_with({"@type": "JobPosting", "title": "T", "datePosted": date, "description": "d"})
    )
    assert jobs[0].published_at is None
    assert any("datePosted" in w for w in warnings)


def test_type_list_cdata_and_broken_blocks_are_tolerated() -> None:
    markup = (
        '<html><head><script type="application/ld+json">{not json</script>'
        '<script type="application/ld+json"><!--\n'
        + json.dumps({"@type": ["Thing", "JobPosting"], "title": "Listed", "description": "d"})
        + "\n--></script>"
        '<script type="application/ld+json">//<![CDATA[\n'
        + json.dumps({"@context": "https://schema.org", "@type": "Organization", "name": "x"})
        + "\n//]]></script></head><body></body></html>"
    )
    assert len(extract_ld_json_blocks(markup)) == 3
    jobs, _ = extract(markup)
    assert [job.title for job in jobs] == ["Listed"]


def test_untrusted_values_are_validated_field_by_field() -> None:
    jobs, warnings = extract(
        page_with(
            {
                "@type": "JobPosting",
                "title": ["not", "a", "string"],
                "description": "d",
            },
            {
                "@type": "JobPosting",
                "title": "Valid",
                "description": {"nested": "object"},
                "hiringOrganization": {"@type": "Organization", "name": 42},
                "baseSalary": {
                    "@type": "MonetaryAmount",
                    "currency": "dollars",
                    "value": {"minValue": "80000", "maxValue": 90000, "unitText": "FORTNIGHT"},
                },
                "applicantLocationRequirements": [
                    {"@type": "Country", "name": "Narnia"},
                    {"@type": "Country", "name": "Spain"},
                ],
                "jobLocation": "just a string address",
                "employmentType": "Part-time",
                "inLanguage": "ES_es",
                "url": "javascript:alert(1)",
            },
        )
    )
    assert [job.title for job in jobs] == ["Valid"]
    job = jobs[0]
    assert job.company == "(company not stated)"
    assert job.salary is not None
    assert (job.salary.min, job.salary.max, job.salary.currency, job.salary.period) == (
        80000,
        90000,
        None,
        None,
    )
    assert job.eligible_countries == ["ES"]
    assert job.employment_type == "part_time"
    assert job.language == "es-ES"
    assert job.canonical_url == PAGE_URL, "a non-https url is ignored"
    joined = "\n".join(warnings)
    for field in (
        "title",
        "description",
        "baseSalary.currency",
        "unitText",
        "applicantLocationRequirements",
    ):
        assert field in joined
    assert "Narnia" not in joined and "dollars" not in joined


def test_hints_fill_gaps_but_never_override_the_page() -> None:
    jobs, _ = extract(
        page_with({"@type": "JobPosting", "title": "Page title", "description": "d"}),
        company_hint="User Co",
        title_hint="User title",
        apply_url_hint="https://jobs.example.test/apply",
    )
    assert jobs[0].title == "Page title"
    assert jobs[0].company == "User Co"
    assert jobs[0].apply_url == "https://jobs.example.test/apply"


def test_url_identity_is_stable_and_strips_tracking() -> None:
    a = url_identity("HTTPS://Jobs.Example.test/careers/1/?utm_source=x&b=2&a=1#frag")
    b = url_identity("https://jobs.example.test/careers/1?a=1&b=2")
    assert a == b
    external_id, source_key = a
    assert (
        len(external_id) == 64 and source_key == "url:https://jobs.example.test/careers/1?a=1&b=2"
    )
    assert normalize_url("https://x.example/p?gh_jid=5") == "https://x.example/p?gh_jid=5"
    long_url = "https://jobs.example.test/" + "a" * 600
    assert url_identity(long_url)[1].startswith("url:sha256:")
