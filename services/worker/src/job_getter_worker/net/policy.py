"""Destination policy for outbound job-source requests (AT20).

``docs/spec/05_DISCOVERY_CONNECTORS.md`` -> "For arbitrary URLs":

    HTTPS only, public IP validation before connect and after each redirect,
    max 3 redirects, 2 MiB HTML limit, 20-second timeout, allowed content
    types, no credentials/cookies. Block private, loopback, link-local and
    cloud metadata destinations including IPv6 and DNS rebinding.

Everything in this module is pure: it parses a URL, resolves a name through an
injectable resolver and decides whether an address may be connected to. The
decision is made on *every* address a name resolves to, because a hostname
with one public and one private record is how a resolver-side rebinding attack
is usually staged - the attacker only needs the worker to pick the wrong one.

The hard bounds (redirect count, body size, timeout) are read off the generated
``FetchJobInputPolicy`` model rather than restated, so the worker cannot drift
away from ``URL_FETCH_POLICY`` in ``packages/contracts/src/schemas/jobs.ts``.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit

from ..contracts.generated import FetchJobInputPolicy

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

#: Resolves a hostname to the string form of every address it has.
Resolver = Callable[[str], Awaitable[list[str]]]


def _upper_bound(field: str) -> int:
    """Read the ``le`` constraint of a generated model field."""
    for item in FetchJobInputPolicy.model_fields[field].metadata:
        upper = getattr(item, "le", None)
        if upper is not None:
            return int(upper)
    raise RuntimeError(f"FetchJobInputPolicy.{field} carries no upper bound")  # pragma: no cover


#: ``URL_FETCH_POLICY`` from the contracts, as carried by the generated model.
MAX_REDIRECTS: Final[int] = _upper_bound("max_redirects")
MAX_BODY_BYTES: Final[int] = _upper_bound("max_html_bytes")
MAX_TIMEOUT_SECONDS: Final[int] = _upper_bound("timeout_seconds")

#: ``URL_FETCH_POLICY.allowedContentTypes``. The generator does not export the
#: list, so it is mirrored here and pinned by a test against the TypeScript
#: source. Media types only; parameters such as charset are ignored.
HTML_CONTENT_TYPES: Final[frozenset[str]] = frozenset(
    {"text/html", "application/xhtml+xml", "application/ld+json"}
)
#: What the documented ATS APIs answer with. Connectors use this set; the
#: arbitrary-URL importer never does.
JSON_CONTENT_TYPES: Final[frozenset[str]] = frozenset({"application/json"})

#: The only port the fetcher will connect to. A job page lives on 443; an
#: explicit port is how an internal service on a public-looking name gets
#: reached, so it is refused rather than validated.
HTTPS_PORT: Final = 443

#: Cloud metadata endpoints. Most are already inside a blocked range; they are
#: listed anyway so the reason given is precise and so a future change to the
#: generic rules cannot quietly reopen them.
_METADATA_ADDRESSES: Final[frozenset[IPAddress]] = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),  # AWS, GCP, Azure, OpenStack
        ipaddress.ip_address("169.254.170.2"),  # AWS ECS task metadata
        ipaddress.ip_address("100.100.100.200"),  # Alibaba Cloud
        ipaddress.ip_address("fd00:ec2::254"),  # AWS IMDS over IPv6
    }
)

#: IPv6 prefixes that carry an IPv4 address the generic checks cannot see.
_NAT64_WELL_KNOWN: Final = ipaddress.ip_network("64:ff9b::/96")
_NAT64_LOCAL: Final = ipaddress.ip_network("64:ff9b:1::/48")

#: Names that mean "this machine" regardless of what a resolver says.
_LOCAL_NAMES: Final[frozenset[str]] = frozenset({"localhost", "localhost.localdomain"})
_LOCAL_SUFFIXES: Final[tuple[str, ...]] = (".localhost", ".local", ".internal", ".home.arpa")


class BlockedAddressError(ValueError):
    """The destination is not a public host, with the reason it was refused."""


@dataclass(frozen=True)
class ResolvedTarget:
    """A URL whose host has been resolved and every address validated."""

    url: str
    scheme: str
    host: str
    port: int
    path: str
    address: IPAddress
    all_addresses: tuple[IPAddress, ...]

    @property
    def pinned_url(self) -> str:
        """The URL rewritten to the validated address.

        The request is sent *here*, while the ``Host`` header and TLS server
        name stay :attr:`host`, so a second DNS answer between validation and
        connection cannot change where the bytes go.
        """
        literal = f"[{self.address}]" if self.address.version == 6 else str(self.address)
        return f"{self.scheme}://{literal}:{self.port}{self.path}"


def address_block_reason(address: IPAddress) -> str | None:
    """Return why ``address`` may not be connected to, or ``None`` if it may.

    Order matters only for the message: every rule is applied, and an address
    embedded inside an IPv6 transition form is judged as the IPv4 address it
    carries. ``is_global`` alone is not enough - on Python 3.12 multicast and
    NAT64 addresses report as global, and shared address space (100.64/10)
    reports as neither global nor private - so each class is named.
    """
    if address in _METADATA_ADDRESSES:
        return "cloud metadata endpoint"

    if isinstance(address, ipaddress.IPv6Address):
        embedded = address.ipv4_mapped or address.sixtofour
        if embedded is None and address.teredo is not None:
            _, embedded = address.teredo
        if embedded is None and (address in _NAT64_WELL_KNOWN or address in _NAT64_LOCAL):
            embedded = ipaddress.IPv4Address(int(address) & 0xFFFF_FFFF)
        if embedded is not None:
            inner = address_block_reason(embedded)
            if inner is not None:
                return f"IPv6 form of an IPv4 {inner}"
            # A transition address wrapping a public IPv4 is still not a route
            # the fetcher will take: connect to the IPv4 address directly.
            return "IPv4-embedded IPv6 address"

    if address.is_loopback:
        return "loopback address"
    if address.is_link_local:
        return "link-local address"
    if address.is_unspecified:
        return "unspecified address"
    if address.is_multicast:
        return "multicast address"
    if address.is_private:
        return "private address"
    if address.is_reserved:
        return "reserved address"
    if not address.is_global:
        return "non-global address"
    return None


@dataclass(frozen=True)
class _ParsedUrl:
    scheme: str
    host: str
    port: int
    path: str
    literal: IPAddress | None


def validate_url(url: str, *, allowed_hosts: frozenset[str] | None = None) -> _ParsedUrl:
    """Check the URL shape before any network activity.

    Raises:
        BlockedAddressError: not HTTPS, carries credentials, names a non-default
            port, names a local host, or (when ``allowed_hosts`` is given) is
            not one of the hosts a connector declared.
    """
    if len(url) > 2000:
        raise BlockedAddressError("URL is longer than 2000 characters")
    try:
        parts = urlsplit(url.strip())
    except ValueError as error:
        raise BlockedAddressError("URL could not be parsed") from error

    if parts.scheme.lower() != "https":
        raise BlockedAddressError(f"only https:// is allowed, got {parts.scheme or 'no'} scheme")
    if parts.username is not None or parts.password is not None:
        raise BlockedAddressError("URL carries credentials, which are never sent")
    host = (parts.hostname or "").strip().rstrip(".").lower()
    if not host:
        raise BlockedAddressError("URL has no host")
    try:
        port = parts.port
    except ValueError as error:
        raise BlockedAddressError("URL port is not a number") from error
    if port is not None and port != HTTPS_PORT:
        raise BlockedAddressError(f"only port {HTTPS_PORT} is allowed, got {port}")

    if host in _LOCAL_NAMES or host.endswith(_LOCAL_SUFFIXES):
        raise BlockedAddressError(f"{host!r} is a local name")

    literal: IPAddress | None = None
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        # A DNS name. It must be encodable as IDNA to be resolvable at all.
        try:
            host.encode("idna")
        except UnicodeError as error:
            raise BlockedAddressError("hostname is not a valid IDNA name") from error

    if allowed_hosts is not None and host not in allowed_hosts:
        raise BlockedAddressError(f"{host!r} is not one of the hosts this connector may contact")

    path = parts.path or "/"
    if parts.query:
        path = f"{path}?{parts.query}"
    return _ParsedUrl(scheme="https", host=host, port=HTTPS_PORT, path=path, literal=literal)


async def system_resolver(host: str) -> list[str]:
    """Resolve through the event loop's resolver, returning every address."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, HTTPS_PORT, type=socket.SOCK_STREAM)
    addresses: list[str] = []
    for info in infos:
        candidate = str(info[4][0])
        # getaddrinfo may append a scope id to a link-local IPv6 address.
        candidate = candidate.split("%", 1)[0]
        if candidate not in addresses:
            addresses.append(candidate)
    return addresses


async def resolve_and_validate(
    url: str,
    *,
    resolver: Resolver | None = None,
    allowed_hosts: frozenset[str] | None = None,
) -> ResolvedTarget:
    """Parse, resolve and validate a URL; return the pinned target.

    Every address the name resolves to is checked, and one blocked record
    rejects the whole name (mixed public/private records are the rebinding
    setup). The address chosen for the connection is the first public one in
    resolver order, so the operating system's preference is respected.

    Raises:
        BlockedAddressError: for any reason the destination may not be contacted.
    """
    parsed = validate_url(url, allowed_hosts=allowed_hosts)

    if parsed.literal is not None:
        addresses: tuple[IPAddress, ...] = (parsed.literal,)
    else:
        resolve = resolver if resolver is not None else system_resolver
        try:
            raw = await resolve(parsed.host)
        except (OSError, ValueError) as error:
            raise BlockedAddressError(f"{parsed.host!r} could not be resolved") from error
        parsed_addresses: list[IPAddress] = []
        for item in raw:
            try:
                parsed_addresses.append(ipaddress.ip_address(item))
            except ValueError as error:
                raise BlockedAddressError(
                    f"resolver returned a non-address record for {parsed.host!r}"
                ) from error
        addresses = tuple(parsed_addresses)

    if not addresses:
        raise BlockedAddressError(f"{parsed.host!r} resolved to no addresses")

    for address in addresses:
        reason = address_block_reason(address)
        if reason is not None:
            where = "is a" if parsed.literal is not None else "resolves to a"
            raise BlockedAddressError(f"{parsed.host!r} {where} {reason} ({address})")

    return ResolvedTarget(
        url=url.strip(),
        scheme=parsed.scheme,
        host=parsed.host,
        port=parsed.port,
        path=parsed.path,
        address=addresses[0],
        all_addresses=addresses,
    )


__all__ = [
    "HTML_CONTENT_TYPES",
    "HTTPS_PORT",
    "JSON_CONTENT_TYPES",
    "MAX_BODY_BYTES",
    "MAX_REDIRECTS",
    "MAX_TIMEOUT_SECONDS",
    "BlockedAddressError",
    "ResolvedTarget",
    "Resolver",
    "address_block_reason",
    "resolve_and_validate",
    "system_resolver",
    "validate_url",
]
