"""Lever public postings API connector.

Documented endpoint: ``GET https://api.lever.co/v0/postings/{site}?mode=json``
(``https://github.com/lever/postings-api``), with the EU data-residency host
``api.eu.lever.co`` selectable through ``base_url``. Only those two hosts are
accepted; a ``base_url`` naming anything else is refused as ``INPUT_INVALID``
before any request is made.

The schema this code relies on is pinned by ``fixtures/jobs/lever.*.json``:

* the body is a JSON list; each posting has string ``id``, string ``text``
  (the title) and string ``hostedUrl``;
* optional: ``applyUrl``, ``descriptionPlain`` / ``description`` (HTML),
  ``additionalPlain``, ``lists`` (``[{text, content}]`` where ``content`` is
  HTML ``<li>`` markup), ``createdAt`` (epoch milliseconds), ``categories``
  (``location``, ``allLocations``, ``commitment``), ``workplaceType``,
  ``country`` (ISO alpha-2) and ``salaryRange`` (``min``, ``max``,
  ``currency``, ``interval``).

Lever returns the whole feed in one response; there is no cursor.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any, Final
from urllib.parse import urlsplit

from ..cancellation import CancellationToken
from ..contracts.generated import ConnectorId, NormalizedJob
from ..discovery import (
    RawJob,
    RawLocation,
    RawSalary,
    RawSection,
    html_to_text,
    make_warning,
    normalize_job,
    plain_text,
)
from ..discovery.normalize import EmploymentTypeLiteral, RemoteType, SalaryPeriod
from ..errors import TaskFailureError
from ..net import JSON_CONTENT_TYPES, SchemaDriftError
from .base import (
    Connector,
    ConnectorConfig,
    ConnectorDescriptor,
    DiscoveryPage,
    RatePolicy,
    dedupe_by_source_key,
    source_key_for,
)

LEVER_DEFAULT_BASE: Final = "https://api.lever.co"
LEVER_HOSTS: Final[frozenset[str]] = frozenset({"api.lever.co", "api.eu.lever.co"})
_SITE: Final = re.compile(r"^[A-Za-z0-9._-]+$")
_POSTING_ID: Final = re.compile(r"^[A-Za-z0-9-]{1,80}$")
_CURRENCY: Final = re.compile(r"^[A-Z]{3}$")

_WORKPLACE: Final[dict[str, RemoteType]] = {
    "remote": "remote",
    "hybrid": "hybrid",
    "on-site": "onsite",
    "onsite": "onsite",
    "on_site": "onsite",
}
_COMMITMENT: Final[dict[str, EmploymentTypeLiteral]] = {
    "full-time": "full_time",
    "full time": "full_time",
    "fulltime": "full_time",
    "part-time": "part_time",
    "part time": "part_time",
    "contract": "contract",
    "contractor": "contract",
    "intern": "internship",
    "internship": "internship",
    "temporary": "temporary",
    "freelance": "freelance",
}


def _epoch_ms(value: Any) -> datetime | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


_INTERVAL_WORDS: Final[tuple[tuple[str, SalaryPeriod], ...]] = (
    ("year", "year"),
    ("annual", "year"),
    ("month", "month"),
    ("week", "week"),
    ("day", "day"),
    ("hour", "hour"),
)


def _interval_period(value: Any) -> SalaryPeriod | None:
    """``per-year-salary`` / ``per-hour-wage`` -> the contract's period."""
    if not isinstance(value, str):
        return None
    lowered = value.lower()
    for word, period in _INTERVAL_WORDS:
        if word in lowered:
            return period
    return None


class LeverConnector(Connector):
    descriptor = ConnectorDescriptor(
        id=ConnectorId.LEVER,
        version="1",
        allowed_hosts=LEVER_HOSTS,
        capabilities=("discover", "get_job", "conditional_requests", "regional_endpoint"),
        config_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["board_key"],
            "properties": {
                "board_key": {"type": "string", "pattern": _SITE.pattern, "description": "site"},
                "base_url": {
                    "type": ["string", "null"],
                    "enum": [None, "https://api.lever.co", "https://api.eu.lever.co"],
                },
            },
        },
        rate_policy=RatePolicy(),
        policy_review_url="https://github.com/lever/postings-api",
        policy_review_date="2026-09-20",
    )

    # -- contract ----------------------------------------------------------------

    async def discover(
        self,
        config: ConnectorConfig,
        cursor: str | None,
        *,
        retrieved_at: datetime,
        cancel: CancellationToken | None = None,
    ) -> DiscoveryPage:
        if cursor is not None:
            raise TaskFailureError(
                "INPUT_INVALID", "The Lever postings API has a single page; no cursor exists."
            )
        site = self._site(config)
        url = f"{self._base(config)}/v0/postings/{site}?mode=json"
        self._assert_allowed(url)

        result = await self._fetcher.fetch(
            url,
            policy=config.fetch_policy,
            accepted_content_types=JSON_CONTENT_TYPES,
            allowed_hosts=self.descriptor.allowed_hosts,
            conditional=config.conditional,
            cancel=cancel,
        )
        if result.not_modified:
            return DiscoveryPage(
                jobs=[],
                next_cursor=None,
                http_status=304,
                etag=result.etag or config.etag,
                last_modified=result.last_modified or config.last_modified,
                not_modified=True,
                warnings=[
                    make_warning(
                        "NOT_MODIFIED",
                        "The postings feed answered 304 Not Modified: nothing changed since "
                        "the last successful scan, so no job list was transferred.",
                    )
                ],
            )

        payload = self._json(result.text())
        if not isinstance(payload, list):
            raise SchemaDriftError(
                "The Lever response is not the documented list of postings. No jobs were "
                "read rather than guessing at a changed API.",
                http_status=result.status,
                detail="body is not a JSON list",
            )

        jobs: list[NormalizedJob] = []
        warnings = []
        for index, entry in enumerate(payload):
            raw = self._raw_job(entry, site=site, retrieved_at=retrieved_at, index=index)
            normalised = normalize_job(raw)
            jobs.append(normalised.job)
            warnings.extend(normalised.warnings)

        deduped, collapsed = dedupe_by_source_key(jobs)
        return DiscoveryPage(
            jobs=deduped,
            next_cursor=None,
            http_status=result.status,
            etag=result.etag,
            last_modified=result.last_modified,
            warnings=warnings,
            duplicates_collapsed=collapsed,
        )

    async def get_job(
        self,
        config: ConnectorConfig,
        external_id: str,
        *,
        retrieved_at: datetime,
        cancel: CancellationToken | None = None,
    ) -> NormalizedJob:
        site = self._site(config)
        if not _POSTING_ID.match(external_id):
            raise TaskFailureError("INPUT_INVALID", "A Lever posting id is an opaque token.")
        url = f"{self._base(config)}/v0/postings/{site}/{external_id}?mode=json"
        self._assert_allowed(url)
        result = await self._fetcher.fetch(
            url,
            policy=config.fetch_policy,
            accepted_content_types=JSON_CONTENT_TYPES,
            allowed_hosts=self.descriptor.allowed_hosts,
            cancel=cancel,
        )
        payload = self._json(result.text())
        raw = self._raw_job(payload, site=site, retrieved_at=retrieved_at, index=0)
        return normalize_job(raw).job

    # -- configuration -----------------------------------------------------------

    @staticmethod
    def _site(config: ConnectorConfig) -> str:
        if not _SITE.match(config.board_key):
            raise TaskFailureError(
                "INPUT_INVALID",
                "The Lever site slug may only contain letters, digits, '.', '_' and '-'.",
            )
        return config.board_key

    @staticmethod
    def _base(config: ConnectorConfig) -> str:
        """The documented host to use. Anything else is refused, not fetched."""
        if not config.base_url:
            return LEVER_DEFAULT_BASE
        parts = urlsplit(config.base_url.strip())
        host = (parts.hostname or "").lower()
        path = parts.path.rstrip("/")
        if (
            parts.scheme != "https"
            or host not in LEVER_HOSTS
            or parts.port not in (None, 443)
            or path not in ("", "/v0/postings")
            or parts.query
            or parts.username
        ):
            raise TaskFailureError(
                "INPUT_INVALID",
                "base_url must be one of the documented Lever hosts "
                "(https://api.lever.co or https://api.eu.lever.co). Arbitrary endpoints are "
                "not accepted.",
            )
        return f"https://{host}"

    # -- schema ------------------------------------------------------------------

    @staticmethod
    def _json(text: str) -> Any:
        try:
            return json.loads(text)
        except ValueError as error:
            raise SchemaDriftError(
                "The Lever response was not valid JSON, so no jobs were read.",
                detail="body is not JSON",
            ) from error

    @staticmethod
    def _raw_job(entry: Any, *, site: str, retrieved_at: datetime, index: int) -> RawJob:
        def drift(field: str, why: str) -> SchemaDriftError:
            return SchemaDriftError(
                "A Lever posting does not have the expected shape, so the feed was not read. "
                "Nothing was guessed about the changed field.",
                detail=f"postings[{index}].{field} {why}",
            )

        if not isinstance(entry, dict):
            raise drift("", "is not an object")
        posting_id = entry.get("id")
        if not isinstance(posting_id, str) or not _POSTING_ID.match(posting_id):
            raise drift("id", "is not an id string")
        title = entry.get("text")
        if not isinstance(title, str) or not title.strip():
            raise drift("text", "is not a non-empty string")
        hosted_url = entry.get("hostedUrl")
        if not isinstance(hosted_url, str) or not hosted_url.startswith("https://"):
            raise drift("hostedUrl", "is not an https URL")
        apply_url = entry.get("applyUrl")
        if apply_url is not None and not isinstance(apply_url, str):
            raise drift("applyUrl", "is not a string")

        # -- description: plain text where offered, else rendered HTML ---------
        parts: list[str] = []
        plain = entry.get("descriptionPlain")
        html = entry.get("description")
        if isinstance(plain, str) and plain.strip():
            parts.append(plain_text(plain))
        elif isinstance(html, str) and html.strip():
            parts.append(html_to_text(html))

        sections: list[RawSection] = []
        lists = entry.get("lists")
        if isinstance(lists, list):
            for item in lists[:50]:
                if not isinstance(item, dict):
                    continue
                heading = item.get("text")
                content = item.get("content")
                if not isinstance(heading, str) or not isinstance(content, str):
                    continue
                items = tuple(
                    line[2:].strip()
                    for line in html_to_text(f"<ul>{content}</ul>").split("\n")
                    if line.startswith("- ") and line[2:].strip()
                )
                sections.append(RawSection(heading=heading.strip(), items=items))
                if items:
                    parts.append(heading.strip() + "\n" + "\n".join(f"- {i}" for i in items))
        additional = entry.get("additionalPlain")
        if isinstance(additional, str) and additional.strip():
            parts.append(plain_text(additional))
        description = "\n\n".join(part for part in parts if part)

        # -- structured fields ----------------------------------------------------
        categories_raw = entry.get("categories")
        categories: dict[str, Any] = categories_raw if isinstance(categories_raw, dict) else {}
        names: list[str] = []
        all_locations = categories.get("allLocations")
        if isinstance(all_locations, list):
            names.extend(str(name) for name in all_locations if isinstance(name, str))
        primary = categories.get("location")
        if isinstance(primary, str) and primary.strip() and primary not in names:
            names.insert(0, primary)
        locations = tuple(RawLocation(name=name) for name in names if name.strip())

        workplace = entry.get("workplaceType")
        remote_type = (
            _WORKPLACE.get(workplace.strip().lower()) if isinstance(workplace, str) else None
        )
        commitment = categories.get("commitment")
        employment = (
            _COMMITMENT.get(commitment.strip().lower()) if isinstance(commitment, str) else None
        )

        salary: RawSalary | None = None
        salary_range = entry.get("salaryRange")
        if isinstance(salary_range, dict):
            low = salary_range.get("min")
            high = salary_range.get("max")
            currency = salary_range.get("currency")
            low_f = (
                float(low) if isinstance(low, int | float) and not isinstance(low, bool) else None
            )
            high_f = (
                float(high)
                if isinstance(high, int | float) and not isinstance(high, bool)
                else None
            )
            if low_f is not None or high_f is not None:
                salary = RawSalary(
                    min=low_f,
                    max=high_f,
                    currency=currency.upper()
                    if isinstance(currency, str) and _CURRENCY.match(currency.upper())
                    else None,
                    period=_interval_period(salary_range.get("interval")),
                    source_excerpt=json.dumps(
                        salary_range, ensure_ascii=False, separators=(",", ":"), sort_keys=True
                    )[:300],
                )

        return RawJob(
            external_id=posting_id,
            source_key=source_key_for(ConnectorId.LEVER, site, posting_id),
            canonical_url=hosted_url,
            apply_url=apply_url or hosted_url,
            # The public postings feed does not carry the employer's name; the
            # site slug is the identity the user registered the board under.
            company=site,
            title=title,
            description_text=description,
            retrieved_at=retrieved_at,
            published_at=_epoch_ms(entry.get("createdAt")),
            updated_at=_epoch_ms(entry.get("updatedAt")),
            locations=locations,
            remote_type=remote_type,
            employment_type=employment,
            salary=salary,
            sections=tuple(sections),
        )


__all__ = ["LEVER_DEFAULT_BASE", "LEVER_HOSTS", "LeverConnector"]
