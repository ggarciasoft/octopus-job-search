"""JSON-LD ``JobPosting`` extraction from a fetched page.

``docs/spec/05_DISCOVERY_CONNECTORS.md``: "Prefer structured JobPosting data
but validate fields. Require user review if there are several postings on a
page." A page is untrusted (invariant 9): every property is type-checked
before use, a value that fails validation is dropped with a warning that
names the field but never quotes it, and nothing is executed - the script
blocks are read as text and parsed as JSON, never evaluated.

The module produces :class:`RawJob` values; ``normalize.py`` turns them into
``NormalizedJob`` so JSON-LD and connector data go through one set of rules.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from html.parser import HTMLParser
from typing import Any, Final
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..contracts.generated import FetchWarning
from .countries import iso_country
from .html_text import html_to_text
from .normalize import (
    EmploymentTypeLiteral,
    RawJob,
    RawLocation,
    RawSalary,
    RemoteType,
    SalaryPeriod,
    make_warning,
)

#: The contract's ``FetchJobResult.candidates`` ceiling.
MAX_CANDIDATES: Final = 50
_MAX_GRAPH_DEPTH: Final = 6

_EMPLOYMENT_TYPES: Final[dict[str, EmploymentTypeLiteral]] = {
    "full_time": "full_time",
    "fulltime": "full_time",
    "part_time": "part_time",
    "parttime": "part_time",
    "contractor": "contract",
    "contract": "contract",
    "temporary": "temporary",
    "temp": "temporary",
    "intern": "internship",
    "internship": "internship",
    "freelance": "freelance",
}
_SALARY_UNITS: Final[dict[str, SalaryPeriod]] = {
    "HOUR": "hour",
    "DAY": "day",
    "WEEK": "week",
    "MONTH": "month",
    "YEAR": "year",
}
_CURRENCY: Final = re.compile(r"^[A-Z]{3}$")
_LANGUAGE: Final = re.compile(r"^[a-z]{2}(-[A-Z]{2})?$")
_TRACKING_PARAMS: Final = re.compile(r"^(utm_|gh_src$|lever-source$|fbclid$|gclid$|mc_cid$)")


# ---------------------------------------------------------------------------
# URL identity


def normalize_url(url: str) -> str:
    """The employer-URL form of a canonical key (``03_DATA_MODEL.md``).

    Lower-cases scheme and host, drops the fragment and known tracking
    parameters, sorts the remaining query and removes a trailing slash. It
    never adds anything the URL did not contain.
    """
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    if parts.port is not None and parts.port != 443:
        host = f"{host}:{parts.port}"
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not _TRACKING_PARAMS.match(k)
    ]
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return urlunsplit((parts.scheme.lower(), host, path, urlencode(sorted(query)), ""))


def url_identity(url: str) -> tuple[str, str]:
    """``(external_id, source_key)`` for a job identified by its URL.

    ``external_id`` is the SHA-256 of the normalised URL, which fits the
    200-character field for any URL. ``source_key`` is ``url:<normalised
    URL>``, or ``url:sha256:<digest>`` when the URL would not fit 500.
    """
    normalised = normalize_url(url)
    digest = hashlib.sha256(normalised.encode("utf-8")).hexdigest()
    key = f"url:{normalised}"
    if len(key) > 500:
        key = f"url:sha256:{digest}"
    return digest, key


# ---------------------------------------------------------------------------
# script block extraction


class _LdJsonCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._capturing = False
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        kind = next((value or "" for name, value in attrs if name.lower() == "type"), "")
        if kind.strip().lower() == "application/ld+json":
            self._capturing = True
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._capturing:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capturing:
            self._capturing = False
            self.blocks.append("".join(self._buffer))


_CDATA: Final = re.compile(r"^\s*(?:<!--)?\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*(?:-->)?\s*$", re.S)


def extract_ld_json_blocks(markup: str) -> list[str]:
    collector = _LdJsonCollector()
    collector.feed(markup)
    collector.close()
    cleaned: list[str] = []
    for block in collector.blocks:
        match = _CDATA.match(block)
        cleaned.append(match.group(1) if match else block)
    return cleaned


def _is_job_posting(node: dict[str, Any]) -> bool:
    kind = node.get("@type")
    if isinstance(kind, str):
        return kind.strip().lower() == "jobposting"
    if isinstance(kind, list):
        return any(isinstance(item, str) and item.strip().lower() == "jobposting" for item in kind)
    return False


def _walk(node: Any, depth: int, found: list[dict[str, Any]]) -> None:
    if depth > _MAX_GRAPH_DEPTH or len(found) >= MAX_CANDIDATES:
        return
    if isinstance(node, list):
        for item in node:
            _walk(item, depth + 1, found)
        return
    if not isinstance(node, dict):
        return
    if _is_job_posting(node):
        found.append(node)
        return
    graph = node.get("@graph")
    if graph is not None:
        _walk(graph, depth + 1, found)
    main = node.get("mainEntity")
    if main is not None:
        _walk(main, depth + 1, found)


def find_job_postings(markup: str) -> tuple[list[dict[str, Any]], int]:
    """Every ``JobPosting`` object on the page, and how many blocks parsed."""
    found: list[dict[str, Any]] = []
    parsed_blocks = 0
    for block in extract_ld_json_blocks(markup):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        parsed_blocks += 1
        _walk(data, 0, found)
    return found, parsed_blocks


# ---------------------------------------------------------------------------
# field validation


@dataclass
class _Ctx:
    warnings: list[FetchWarning] = field(default_factory=list)

    def dropped(self, field_name: str, why: str) -> None:
        self.warnings.append(
            make_warning(
                "FIELD_DROPPED_INVALID",
                f"The page's JobPosting.{field_name} {why}, so it was ignored.",
            )
        )


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _name_of(value: Any) -> str | None:
    """A schema.org thing is often either a string or ``{"name": ...}``."""
    if isinstance(value, dict):
        return _text(value.get("name"))
    return _text(value)


def _parse_date(value: Any, field_name: str, ctx: _Ctx) -> datetime | None:
    raw = _text(value)
    if raw is None:
        if value is not None:
            ctx.dropped(field_name, "is not a string")
        return None
    candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        ctx.dropped(field_name, "is not an ISO-8601 date")
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    now = datetime.now(UTC)
    if parsed.year < 1990 or parsed > now + timedelta(days=366):
        ctx.dropped(field_name, "is outside a plausible range")
        return None
    return parsed


def _locations(value: Any, ctx: _Ctx) -> tuple[RawLocation, ...]:
    items = value if isinstance(value, list) else [value] if value is not None else []
    out: list[RawLocation] = []
    for item in items[:50]:
        if isinstance(item, str):
            out.append(RawLocation(name=item.strip()))
            continue
        if not isinstance(item, dict):
            ctx.dropped("jobLocation", "is not a Place")
            continue
        address = item.get("address")
        if isinstance(address, str):
            out.append(RawLocation(name=address.strip()))
            continue
        if isinstance(address, dict):
            country = _name_of(address.get("addressCountry"))
            region = _text(address.get("addressRegion"))
            city = _text(address.get("addressLocality"))
            name = ", ".join(part for part in (city, region, country) if part) or None
            if country or region or city:
                out.append(
                    RawLocation(
                        name=name,
                        country=iso_country(country) if country else None,
                        region=region,
                        city=city,
                    )
                )
                continue
        name = _text(item.get("name"))
        if name:
            out.append(RawLocation(name=name))
    return tuple(out)


def _eligibility(value: Any, ctx: _Ctx) -> tuple[str, ...] | None:
    if value is None:
        return None
    items = value if isinstance(value, list) else [value]
    codes: list[str] = []
    unresolved = False
    for item in items[:250]:
        name = _name_of(item)
        code = iso_country(name) if name else None
        if code is None:
            unresolved = True
            continue
        if code not in codes:
            codes.append(code)
    if unresolved:
        ctx.dropped("applicantLocationRequirements", "named a place the country table cannot map")
    return tuple(codes) if codes else None


def _employment_type(value: Any) -> EmploymentTypeLiteral | None:
    items = value if isinstance(value, list) else [value]
    for item in items:
        text = _text(item)
        if text is None:
            continue
        key = re.sub(r"[\s\-]+", "_", text.strip().lower())
        mapped = _EMPLOYMENT_TYPES.get(key)
        if mapped is not None:
            return mapped
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float) and value >= 0:
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value.replace(",", ""))
        except ValueError:
            return None
        return parsed if parsed >= 0 else None
    return None


def _salary(value: Any, ctx: _Ctx) -> RawSalary | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        ctx.dropped("baseSalary", "is not a MonetaryAmount")
        return None
    currency_raw = _text(value.get("currency"))
    currency = (
        currency_raw.upper() if currency_raw and _CURRENCY.match(currency_raw.upper()) else None
    )
    if currency_raw and currency is None:
        ctx.dropped("baseSalary.currency", "is not an ISO-4217 code")

    amount = value.get("value")
    low = high = None
    period: SalaryPeriod | None = None
    if isinstance(amount, dict):
        low = _number(amount.get("minValue"))
        high = _number(amount.get("maxValue"))
        single = _number(amount.get("value"))
        if low is None and high is None and single is not None:
            low = high = single
        unit = _text(amount.get("unitText"))
        period = _SALARY_UNITS.get(unit.upper()) if unit else None
        if unit and period is None:
            ctx.dropped("baseSalary.value.unitText", "is not a recognised period")
    else:
        single = _number(amount)
        if single is not None:
            low = high = single
    if low is None and high is None:
        ctx.dropped("baseSalary", "carries no numeric value")
        return None
    if low is not None and high is not None and high < low:
        low, high = high, low
    excerpt = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)[:300]
    return RawSalary(min=low, max=high, currency=currency, period=period, source_excerpt=excerpt)


def _language(value: Any) -> str | None:
    text = _text(value)
    if text is None:
        return None
    parts = text.replace("_", "-").split("-", 1)
    code = parts[0].lower()
    if len(parts) == 2 and len(parts[1]) == 2:
        code = f"{code}-{parts[1].upper()}"
    return code if _LANGUAGE.match(code) else None


def _https_url(value: Any) -> str | None:
    text = _text(value)
    if text is None or len(text) > 2000:
        return None
    parts = urlsplit(text)
    return text if parts.scheme == "https" and parts.hostname else None


# ---------------------------------------------------------------------------
# assembling raw jobs


@dataclass
class JobPostingExtraction:
    jobs: list[RawJob]
    warnings: list[FetchWarning]
    parsed_blocks: int


def extract_job_postings(
    markup: str,
    *,
    page_url: str,
    retrieved_at: datetime,
    company_hint: str | None = None,
    title_hint: str | None = None,
    apply_url_hint: str | None = None,
) -> JobPostingExtraction:
    """Read every valid ``JobPosting`` on the page into :class:`RawJob` values.

    Hints are applied only where the page states nothing: a user's company or
    title is recorded as given, never used to override structured data.
    """
    nodes, parsed_blocks = find_job_postings(markup)
    ctx = _Ctx()
    jobs: list[RawJob] = []

    for index, node in enumerate(nodes[:MAX_CANDIDATES]):
        title = _text(node.get("title")) or title_hint
        if title is None:
            ctx.dropped("title", "is missing or empty")
            continue

        description_raw = node.get("description")
        description = html_to_text(description_raw) if isinstance(description_raw, str) else ""
        if description_raw is not None and not isinstance(description_raw, str):
            ctx.dropped("description", "is not a string")

        company = _name_of(node.get("hiringOrganization")) or company_hint or "(company not stated)"

        posting_url = _https_url(node.get("url"))
        canonical_url = posting_url or page_url
        identity_source = canonical_url if posting_url else f"{page_url}#jobposting-{index}"
        external_id, source_key = url_identity(identity_source)

        remote = node.get("jobLocationType")
        remote_type: RemoteType | None = (
            "remote"
            if isinstance(remote, str) and remote.strip().upper() == "TELECOMMUTE"
            else None
        )

        jobs.append(
            RawJob(
                external_id=external_id,
                source_key=source_key,
                canonical_url=canonical_url,
                apply_url=apply_url_hint,
                company=company,
                title=title,
                description_text=description,
                retrieved_at=retrieved_at,
                published_at=_parse_date(node.get("datePosted"), "datePosted", ctx),
                updated_at=_parse_date(node.get("dateModified"), "dateModified", ctx),
                locations=_locations(node.get("jobLocation"), ctx),
                remote_type=remote_type,
                eligible_countries=_eligibility(node.get("applicantLocationRequirements"), ctx),
                employment_type=_employment_type(node.get("employmentType")),
                salary=_salary(node.get("baseSalary"), ctx),
                language=_language(node.get("inLanguage")),
            )
        )

    return JobPostingExtraction(jobs=jobs, warnings=ctx.warnings, parsed_blocks=parsed_blocks)


__all__ = [
    "MAX_CANDIDATES",
    "JobPostingExtraction",
    "extract_job_postings",
    "extract_ld_json_blocks",
    "find_job_postings",
    "normalize_url",
    "url_identity",
]
