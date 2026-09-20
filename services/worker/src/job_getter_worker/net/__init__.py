"""Outbound HTTP for job discovery, with the network protections applied first.

``docs/spec/05_DISCOVERY_CONNECTORS.md`` -> "For arbitrary URLs" and
``docs/spec/09_SECURITY_PRIVACY.md`` put the protections *before* any generic
fetch exists, so this package is the only way the worker reaches a job source.
Connectors and the URL importer both go through :class:`Fetcher`; nothing else
in the worker opens a socket to a job site.
"""

from .fetch import (
    USER_AGENT,
    AccessDeniedError,
    BlockedDestinationError,
    BodyTooLargeError,
    ContentTypeRejectedError,
    Fetcher,
    FetchError,
    FetchPolicy,
    FetchResult,
    FetchUnavailableError,
    RateLimitedError,
    RedirectLimitError,
    RobotsDisallowedError,
    SchemaDriftError,
    get_default_fetcher,
)
from .policy import (
    HTML_CONTENT_TYPES,
    JSON_CONTENT_TYPES,
    BlockedAddressError,
    ResolvedTarget,
    Resolver,
    address_block_reason,
    resolve_and_validate,
    validate_url,
)

__all__ = [
    "HTML_CONTENT_TYPES",
    "JSON_CONTENT_TYPES",
    "USER_AGENT",
    "AccessDeniedError",
    "BlockedAddressError",
    "BlockedDestinationError",
    "BodyTooLargeError",
    "ContentTypeRejectedError",
    "FetchError",
    "FetchPolicy",
    "FetchResult",
    "FetchUnavailableError",
    "Fetcher",
    "RateLimitedError",
    "RedirectLimitError",
    "ResolvedTarget",
    "Resolver",
    "RobotsDisallowedError",
    "SchemaDriftError",
    "address_block_reason",
    "get_default_fetcher",
    "resolve_and_validate",
    "validate_url",
]
