"""Greenhouse public Job Board API connector.

Documented endpoint (``docs/spec/05_DISCOVERY_CONNECTORS.md`` -> "Fetch
rules"): ``GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
?content=true``, and ``/jobs/{id}`` for one posting. The response schema this
code relies on is pinned by ``fixtures/jobs/greenhouse.*.json``:

* ``jobs`` - list; each entry has integer ``id``, string ``title``, string
  ``absolute_url`` and (with ``content=true``) string ``content`` holding
  entity-encoded HTML;
* optional per entry: ``updated_at`` and ``first_published`` (ISO-8601 with
  offset), ``location.name``, ``company_name``.

Anything required that is missing or of the wrong type is ``SCHEMA_DRIFT`` for
the whole page. A guess about what a changed API meant is how invented jobs
get in, so there is none. Greenhouse lists all of a board's jobs in one
response; there is no pagination and no cursor.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Final

from ..cancellation import CancellationToken
from ..contracts.generated import ConnectorId, NormalizedJob
from ..discovery import (
    RawJob,
    RawLocation,
    entity_encoded_html_to_text,
    make_warning,
    normalize_job,
)
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

GREENHOUSE_HOST: Final = "boards-api.greenhouse.io"
#: ``CreateSourceRequest.board_key`` pattern, so a token cannot carry a path.
_BOARD_TOKEN: Final = re.compile(r"^[A-Za-z0-9._-]+$")
_JOB_ID: Final = re.compile(r"^[0-9]{1,20}$")


def _parse_greenhouse_time(value: Any) -> datetime | None:
    """Greenhouse timestamps look like ``2024-01-15T10:30:00-05:00``."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


class GreenhouseConnector(Connector):
    descriptor = ConnectorDescriptor(
        id=ConnectorId.GREENHOUSE,
        version="1",
        allowed_hosts=frozenset({GREENHOUSE_HOST}),
        capabilities=("discover", "get_job", "conditional_requests"),
        config_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["board_key"],
            "properties": {
                "board_key": {
                    "type": "string",
                    "pattern": _BOARD_TOKEN.pattern,
                    "description": "Greenhouse board token",
                }
            },
        },
        rate_policy=RatePolicy(),
        policy_review_url="https://developers.greenhouse.io/job-board.html",
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
                "INPUT_INVALID", "The Greenhouse board API has a single page; no cursor exists."
            )
        board = self._board_token(config)
        url = f"https://{GREENHOUSE_HOST}/v1/boards/{board}/jobs?content=true"
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
                        "The board answered 304 Not Modified: nothing changed since the "
                        "last successful scan, so no job list was transferred.",
                    )
                ],
            )

        payload = self._json(result.text())
        entries = payload.get("jobs") if isinstance(payload, dict) else None
        if not isinstance(entries, list):
            raise SchemaDriftError(
                "The Greenhouse response does not have the expected shape (no `jobs` list). "
                "No jobs were read rather than guessing at a changed API.",
                http_status=result.status,
                detail="missing or non-list `jobs`",
            )

        jobs: list[NormalizedJob] = []
        warnings = []
        for index, entry in enumerate(entries):
            raw = self._raw_job(entry, board=board, retrieved_at=retrieved_at, index=index)
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
        board = self._board_token(config)
        if not _JOB_ID.match(external_id):
            raise TaskFailureError("INPUT_INVALID", "A Greenhouse job id is numeric.")
        url = f"https://{GREENHOUSE_HOST}/v1/boards/{board}/jobs/{external_id}"
        self._assert_allowed(url)
        result = await self._fetcher.fetch(
            url,
            policy=config.fetch_policy,
            accepted_content_types=JSON_CONTENT_TYPES,
            allowed_hosts=self.descriptor.allowed_hosts,
            cancel=cancel,
        )
        payload = self._json(result.text())
        raw = self._raw_job(payload, board=board, retrieved_at=retrieved_at, index=0)
        return normalize_job(raw).job

    # -- schema ------------------------------------------------------------------

    def _board_token(self, config: ConnectorConfig) -> str:
        if not _BOARD_TOKEN.match(config.board_key):
            raise TaskFailureError(
                "INPUT_INVALID",
                "The Greenhouse board token may only contain letters, digits, '.', '_' and '-'.",
            )
        if config.base_url:
            raise TaskFailureError(
                "INPUT_INVALID",
                "Greenhouse has a single documented endpoint; base_url is not configurable.",
            )
        return config.board_key

    @staticmethod
    def _json(text: str) -> Any:
        try:
            return json.loads(text)
        except ValueError as error:
            raise SchemaDriftError(
                "The Greenhouse response was not valid JSON, so no jobs were read.",
                detail="body is not JSON",
            ) from error

    @staticmethod
    def _raw_job(entry: Any, *, board: str, retrieved_at: datetime, index: int) -> RawJob:
        def drift(field: str, why: str) -> SchemaDriftError:
            return SchemaDriftError(
                "A Greenhouse job entry does not have the expected shape, so the board was "
                "not read. Nothing was guessed about the changed field.",
                detail=f"jobs[{index}].{field} {why}",
            )

        if not isinstance(entry, dict):
            raise drift("", "is not an object")

        job_id = entry.get("id")
        if isinstance(job_id, bool) or not isinstance(job_id, int) or job_id < 0:
            raise drift("id", "is not a non-negative integer")
        title = entry.get("title")
        if not isinstance(title, str) or not title.strip():
            raise drift("title", "is not a non-empty string")
        absolute_url = entry.get("absolute_url")
        if not isinstance(absolute_url, str) or not absolute_url.startswith("https://"):
            raise drift("absolute_url", "is not an https URL")
        content = entry.get("content")
        if not isinstance(content, str):
            raise drift("content", "is missing; the request asked for content=true")

        location = entry.get("location")
        location_name = location.get("name") if isinstance(location, dict) else None
        locations = (
            (RawLocation(name=location_name),)
            if isinstance(location_name, str) and location_name.strip()
            else ()
        )
        company = entry.get("company_name")
        external_id = str(job_id)

        return RawJob(
            external_id=external_id,
            source_key=source_key_for(ConnectorId.GREENHOUSE, board, external_id),
            canonical_url=absolute_url,
            apply_url=absolute_url,
            company=company if isinstance(company, str) and company.strip() else board,
            title=title,
            description_text=entity_encoded_html_to_text(content),
            retrieved_at=retrieved_at,
            published_at=_parse_greenhouse_time(entry.get("first_published")),
            updated_at=_parse_greenhouse_time(entry.get("updated_at")),
            locations=locations,
        )


__all__ = ["GREENHOUSE_HOST", "GreenhouseConnector"]
