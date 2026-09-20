"""The discovery connector contract.

``docs/spec/05_DISCOVERY_CONNECTORS.md`` -> "Connector contract": each
connector declares ``id``, ``version``, ``allowed_hosts``, ``capabilities``,
``config_schema``, ``rate_policy`` and ``policy_review_url/date``, and
implements ``discover(config, cursor)``, ``get_job(external_id)`` and
``healthcheck()``.

Connectors are *read-only clients of documented public APIs*. They go through
the same :class:`~job_getter_worker.net.Fetcher` as the arbitrary-URL importer,
inherit its politeness and destination policy, and may only contact the hosts
they declare: the fetcher refuses any other host, including one reached by a
redirect. They never authenticate, never retry a 403 or a 429, and never fill
a gap in a response with a guess - a response they do not recognise is
``SCHEMA_DRIFT``.

Application form adapters are a different thing (M4) and do not live here.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from ..cancellation import CancellationToken
from ..contracts.generated import ConnectorId, FetchLimits, FetchWarning, NormalizedJob
from ..errors import TaskFailureError
from ..net import Fetcher, FetchPolicy
from ..net.fetch import ConditionalHeaders


@dataclass(frozen=True)
class RatePolicy:
    """The spec's defaults; a connector may only be stricter."""

    per_host_concurrency: int = 1
    min_request_interval_ms: int = 1000
    timeout_seconds: int = 20
    max_jobs_per_scan: int = 1000
    max_pages_per_scan: int = 100


@dataclass(frozen=True)
class ConnectorDescriptor:
    id: ConnectorId
    version: str
    allowed_hosts: frozenset[str]
    capabilities: tuple[str, ...]
    config_schema: dict[str, Any]
    rate_policy: RatePolicy
    policy_review_url: str
    policy_review_date: str


@dataclass(frozen=True)
class ConnectorConfig:
    """What ``FetchBoardInput`` carries for one source."""

    board_key: str
    base_url: str | None
    limits: FetchLimits
    etag: str | None = None
    last_modified: str | None = None

    @property
    def conditional(self) -> ConditionalHeaders:
        return ConditionalHeaders(etag=self.etag, last_modified=self.last_modified)

    @property
    def fetch_policy(self) -> FetchPolicy:
        return FetchPolicy.from_limits(self.limits)


@dataclass
class DiscoveryPage:
    """One page of a board, already normalised.

    ``not_modified`` is true when the source answered 304 to the conditional
    request: nothing changed since the hints were recorded, and no job list
    was transferred. The handler must not report that as a complete snapshot
    with zero jobs.
    """

    jobs: list[NormalizedJob]
    next_cursor: str | None
    http_status: int | None
    etag: str | None = None
    last_modified: str | None = None
    not_modified: bool = False
    warnings: list[FetchWarning] = field(default_factory=list)
    #: Duplicate identities the connector collapsed within this page.
    duplicates_collapsed: int = 0


@dataclass(frozen=True)
class ConnectorHealth:
    id: ConnectorId
    version: str
    capabilities: tuple[str, ...]
    allowed_hosts: tuple[str, ...]
    policy_review_url: str
    policy_review_date: str


class Connector(ABC):
    """Base for discovery connectors. Subclasses set :attr:`descriptor`."""

    descriptor: ConnectorDescriptor

    def __init__(self, fetcher: Fetcher) -> None:
        self._fetcher = fetcher

    @abstractmethod
    async def discover(
        self,
        config: ConnectorConfig,
        cursor: str | None,
        *,
        retrieved_at: datetime,
        cancel: CancellationToken | None = None,
    ) -> DiscoveryPage:
        """Fetch one page of the board and normalise its jobs.

        Raises:
            FetchError: any typed fetch failure, including
                :class:`~job_getter_worker.net.SchemaDriftError`.
            TaskFailureError: ``INPUT_INVALID`` for a configuration the
                connector cannot honour (for example a Lever ``base_url``
                that is not a documented Lever host).
        """

    @abstractmethod
    async def get_job(
        self,
        config: ConnectorConfig,
        external_id: str,
        *,
        retrieved_at: datetime,
        cancel: CancellationToken | None = None,
    ) -> NormalizedJob:
        """Fetch one job by its external id, normalised."""

    async def healthcheck(self) -> ConnectorHealth:
        """The connector's declared capabilities. No network."""
        return ConnectorHealth(
            id=self.descriptor.id,
            version=self.descriptor.version,
            capabilities=self.descriptor.capabilities,
            allowed_hosts=tuple(sorted(self.descriptor.allowed_hosts)),
            policy_review_url=self.descriptor.policy_review_url,
            policy_review_date=self.descriptor.policy_review_date,
        )

    # -- helpers for subclasses ---------------------------------------------------

    def _assert_allowed(self, url: str) -> None:
        """Refuse to build a request for a host outside the declaration.

        The fetcher enforces the same set on every hop; this check exists so a
        configuration error is reported as ``INPUT_INVALID`` before any
        network activity rather than as a blocked destination after it.
        """
        from urllib.parse import urlsplit

        host = (urlsplit(url).hostname or "").lower()
        if host not in self.descriptor.allowed_hosts:
            raise TaskFailureError(
                "INPUT_INVALID",
                f"The {self.descriptor.id.value} connector may only contact "
                f"{sorted(self.descriptor.allowed_hosts)}; the configured endpoint is not one "
                "of them.",
            )


def dedupe_by_source_key(jobs: list[NormalizedJob]) -> tuple[list[NormalizedJob], int]:
    """Keep the first job per ``source_key``.

    A board that lists the same posting twice (the same external id under two
    departments, say) must not yield two rows with one identity; the API's
    canonical key is connector + board + external id and it expects one entry
    per key in a snapshot. Provenance is untouched: the kept job is the first
    as the source listed it.
    """
    seen: set[str] = set()
    kept: list[NormalizedJob] = []
    for job in jobs:
        if job.source_key in seen:
            continue
        seen.add(job.source_key)
        kept.append(job)
    return kept, len(jobs) - len(kept)


def source_key_for(connector: ConnectorId, board_key: str, external_id: str) -> str:
    """``connector:board:external_id`` - the canonical key from ``03_DATA_MODEL.md``."""
    return f"{connector.value}:{board_key}:{external_id}"


__all__ = [
    "Connector",
    "ConnectorConfig",
    "ConnectorDescriptor",
    "ConnectorHealth",
    "DiscoveryPage",
    "RatePolicy",
    "dedupe_by_source_key",
    "source_key_for",
]
