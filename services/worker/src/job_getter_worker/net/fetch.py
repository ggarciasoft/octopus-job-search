"""The arbitrary-URL fetcher.

This is the only code in the worker that connects to a job source. It applies
``docs/spec/05_DISCOVERY_CONNECTORS.md`` -> "For arbitrary URLs" and
``docs/spec/09_SECURITY_PRIVACY.md`` in this order, and refuses rather than
degrades when any step fails:

1. **Shape.** HTTPS only, no credentials in the URL, default port only.
2. **robots.txt.** Fetched once per host per process and honoured for the
   path. A disallow is ``ROBOTS_DISALLOWED``; there is no bypass.
3. **Resolve and validate.** Every address the name resolves to must be
   public (``net.policy``). This happens before the first connection and
   again after every redirect.
4. **Pin.** The request is sent to the validated *address*, not the name.
   The ``Host`` header and the TLS server name carry the hostname, so the
   certificate is still verified against the real name (see
   :meth:`Fetcher._send` for how). A DNS answer that changes between the
   check and the connect therefore changes nothing.
5. **Bound.** 20 s overall, at most 3 redirects, an accepted media type only,
   and a body cap enforced *while streaming* - a response that lies about its
   length is cut off, not buffered.
6. **Politeness.** One in-flight request per host and at least one second
   between requests to the same host, honouring ``Crawl-delay`` when longer.

Nothing identifying is ever sent: no cookies (the jar is emptied after every
response and the header is stripped before every send), no ``Authorization``,
no proxy or ``.netrc`` from the environment, and a fixed User-Agent that names
the project honestly.
"""

from __future__ import annotations

import asyncio
import os
import time
import types
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Final, Self, get_args
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser

import httpx

from ..cancellation import CancellationToken
from ..contracts.generated import FetchJobInputPolicy, FetchLimits, FetchWarning
from ..errors import WorkerError
from ..logging import log_shape
from .policy import (
    MAX_BODY_BYTES,
    MAX_REDIRECTS,
    MAX_TIMEOUT_SECONDS,
    BlockedAddressError,
    ResolvedTarget,
    Resolver,
    resolve_and_validate,
)

#: Every warning code the contract accepts, read off the generated model.
FETCH_WARNING_CODES: Final[tuple[str, ...]] = tuple(
    get_args(FetchWarning.model_fields["code"].annotation)
)


def _limits_upper_bound(field_name: str) -> int:
    for item in FetchLimits.model_fields[field_name].metadata:
        upper = getattr(item, "le", None)
        if upper is not None:
            return int(upper)
    raise RuntimeError(f"FetchLimits.{field_name} carries no upper bound")  # pragma: no cover


#: ``FetchLimits.timeout_seconds`` ceiling from the contract (board scans).
BOARD_MAX_TIMEOUT_SECONDS: Final[int] = _limits_upper_bound("timeout_seconds")

#: Fixed and honest. The product token is what robots.txt rules are matched
#: against, so an operator can address this fetcher specifically.
ROBOTS_PRODUCT_NAME: Final = "JobGetter"
USER_AGENT: Final = (
    f"{ROBOTS_PRODUCT_NAME}/0.1 (+https://github.com/octopus-job-search; "
    "job discovery for a single user; contact via the repository)"
)

#: The spec's minimum spacing between requests to one host, in seconds.
MIN_REQUEST_INTERVAL_SECONDS: Final = 1.0
#: A ``Crawl-delay`` above this is honoured only up to this ceiling, so one
#: robots file cannot make a task outlive its lease.
MAX_CRAWL_DELAY_SECONDS: Final = 30.0
#: robots.txt is small; RFC 9309 asks parsers to read at least 500 KiB.
ROBOTS_MAX_BYTES: Final = 512 * 1024
ROBOTS_CACHE_SECONDS: Final = 24 * 3600.0

_CHUNK_BYTES: Final = 64 * 1024

Sleeper = Callable[[float], Awaitable[None]]


# ---------------------------------------------------------------------------
# errors


class FetchError(WorkerError):
    """A fetch that ended without a usable body.

    ``code`` is a ``FetchWarningCode`` when the outcome is something the user
    should see as a warning on the result (blocked, denied, rate limited,
    disallowed ...), and ``None`` for transport-level failures that map onto a
    task failure code instead.
    """

    code: str | None = None

    def __init__(
        self,
        message: str,
        *,
        http_status: int | None = None,
        detail: str | None = None,
    ) -> None:
        if self.code is not None and self.code not in FETCH_WARNING_CODES:
            raise ValueError(f"{self.code!r} is not a FetchWarning code")  # pragma: no cover
        super().__init__(message)
        self.message = message
        self.http_status = http_status
        self.detail = detail

    def to_warning(self) -> FetchWarning:
        if self.code is None:
            raise ValueError("this fetch error has no warning code")  # pragma: no cover
        # model_validate lets the contract's closed code set do the checking.
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message[:500],
            "detail": self.detail[:500] if self.detail else None,
        }
        return FetchWarning.model_validate(payload)


class BlockedDestinationError(FetchError):
    code = "BLOCKED_DESTINATION"


class RedirectLimitError(FetchError):
    code = "REDIRECT_LIMIT"


class ContentTypeRejectedError(FetchError):
    code = "CONTENT_TYPE_REJECTED"


class BodyTooLargeError(FetchError):
    code = "BODY_TRUNCATED"


class RobotsDisallowedError(FetchError):
    """The fetch was withheld because of robots.txt.

    ``assumed`` distinguishes a rule that was actually read from a disallow
    that was *assumed* because robots.txt itself could not be read (a 5xx or a
    redirect loop; RFC 9309 section 2.3.1.4). The two must be reported
    differently: only a real rule is a statement about the site, and only a
    real rule may move a source towards the blocked state.
    """

    code = "ROBOTS_DISALLOWED"

    def __init__(
        self,
        message: str,
        *,
        http_status: int | None = None,
        detail: str | None = None,
        assumed: bool = False,
    ) -> None:
        super().__init__(message, http_status=http_status, detail=detail)
        self.assumed = assumed


class AccessDeniedError(FetchError):
    code = "ACCESS_DENIED"


class RateLimitedError(FetchError):
    code = "RATE_LIMITED"

    def __init__(
        self,
        message: str,
        *,
        http_status: int | None = 429,
        retry_after_seconds: int | None = None,
    ) -> None:
        detail = (
            f"retry_after_seconds={retry_after_seconds}"
            if retry_after_seconds is not None
            else None
        )
        super().__init__(message, http_status=http_status, detail=detail)
        self.retry_after_seconds = retry_after_seconds


class SchemaDriftError(FetchError):
    """A connector saw a response it does not recognise. Raised by connectors."""

    code = "SCHEMA_DRIFT"


class FetchUnavailableError(FetchError):
    """Timeout, transport failure or an HTTP status with nothing to show.

    ``kind`` is ``"timeout"``, ``"transport"`` or ``"http"``; the handler maps
    it onto ``TIMEOUT`` / ``FETCH_BLOCKED`` task failure codes.
    """

    code = None

    def __init__(self, message: str, *, kind: str, http_status: int | None = None) -> None:
        super().__init__(message, http_status=http_status)
        self.kind = kind


# ---------------------------------------------------------------------------
# policy and result


@dataclass(frozen=True)
class FetchPolicy:
    """Per-fetch bounds. Never looser than the contract's hard bounds."""

    max_redirects: int = MAX_REDIRECTS
    max_body_bytes: int = MAX_BODY_BYTES
    timeout_seconds: float = float(MAX_TIMEOUT_SECONDS)
    min_request_interval_seconds: float = MIN_REQUEST_INTERVAL_SECONDS
    #: The arbitrary-URL ceiling is 20 s. A board scan may run to the
    #: ``FetchLimits`` ceiling (120 s) because it reads one large listing.
    timeout_ceiling_seconds: float = float(MAX_TIMEOUT_SECONDS)

    def __post_init__(self) -> None:
        ceiling = max(0.1, min(self.timeout_ceiling_seconds, float(BOARD_MAX_TIMEOUT_SECONDS)))
        clamped = {
            "max_redirects": max(0, min(self.max_redirects, MAX_REDIRECTS)),
            "max_body_bytes": max(1, min(self.max_body_bytes, MAX_BODY_BYTES)),
            "timeout_ceiling_seconds": ceiling,
            "timeout_seconds": max(0.1, min(self.timeout_seconds, ceiling)),
            "min_request_interval_seconds": max(
                MIN_REQUEST_INTERVAL_SECONDS, self.min_request_interval_seconds
            ),
        }
        for name, value in clamped.items():
            object.__setattr__(self, name, value)

    @classmethod
    def from_job_policy(cls, policy: FetchJobInputPolicy) -> FetchPolicy:
        return cls(
            max_redirects=policy.max_redirects,
            max_body_bytes=policy.max_html_bytes,
            timeout_seconds=float(policy.timeout_seconds),
        )

    @classmethod
    def from_limits(cls, limits: FetchLimits) -> FetchPolicy:
        return cls(
            timeout_seconds=float(limits.timeout_seconds),
            min_request_interval_seconds=limits.min_request_interval_ms / 1000,
            timeout_ceiling_seconds=float(BOARD_MAX_TIMEOUT_SECONDS),
        )


@dataclass(frozen=True)
class ConditionalHeaders:
    """``ETag`` / ``Last-Modified`` hints from the previous successful fetch."""

    etag: str | None = None
    last_modified: str | None = None


@dataclass(frozen=True)
class FetchResult:
    status: int
    final_url: str
    content_type: str | None
    body: bytes
    redirects: int
    etag: str | None = None
    last_modified: str | None = None
    charset: str | None = None

    @property
    def bytes(self) -> int:
        return len(self.body)

    @property
    def not_modified(self) -> bool:
        return self.status == 304

    def text(self) -> str:
        """Decode the body: declared charset, then UTF-8, then a lossless
        fallback that never raises. Bytes are data; decoding is never an
        excuse to fail a fetch that already succeeded."""
        for encoding in (self.charset, "utf-8"):
            if encoding is None:
                continue
            try:
                return self.body.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                continue
        return self.body.decode("cp1252", errors="replace")


# ---------------------------------------------------------------------------
# helpers


def _media_type(content_type: str | None) -> tuple[str | None, str | None]:
    """Split ``text/html; charset=utf-8`` into media type and charset."""
    if not content_type:
        return None, None
    media, _, rest = content_type.partition(";")
    charset: str | None = None
    for param in rest.split(";"):
        key, _, value = param.strip().partition("=")
        if key.strip().lower() == "charset" and value:
            charset = value.strip().strip('"').lower()
    return media.strip().lower() or None, charset


def _retry_after_seconds(response: httpx.Response) -> int | None:
    """``Retry-After`` as whole seconds, from either documented form.

    The delay-seconds form is used as given. The HTTP-date form is compared
    with the response's own ``Date`` header when present (the server's clock,
    so no skew), else with the local clock; a date already in the past is 0.
    Anything unparseable is reported as unknown, never guessed.
    """
    raw = response.headers.get("retry-after")
    if raw is None:
        return None
    raw = raw.strip()
    if raw.isdigit():
        return int(raw)
    try:
        target = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        return None
    if target.tzinfo is None:
        target = target.replace(tzinfo=UTC)
    reference = datetime.now(UTC)
    server_date = response.headers.get("date")
    if server_date is not None:
        try:
            parsed = parsedate_to_datetime(server_date)
            reference = parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except (TypeError, ValueError, IndexError):
            pass
    return max(0, int((target - reference).total_seconds()))


@dataclass
class _HostState:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_finished: float | None = None


@dataclass(frozen=True)
class _RobotsEntry:
    parser: RobotFileParser | None
    cached_at: float
    # Set when ``parser`` is a synthetic disallow-everything because
    # robots.txt could not be read (5xx, redirect loop). None for a real file
    # or for "no rules" (4xx / unparseable).
    unavailable: str | None = None


# ---------------------------------------------------------------------------
# the fetcher


def _disallow_everything() -> RobotFileParser:
    """RFC 9309 section 2.3.1.4: an unreachable robots.txt means no access."""
    parser = RobotFileParser()
    parser.parse(["User-agent: *", "Disallow: /"])
    return parser


def _operator_trust_store() -> str | bool:
    """The ``verify`` value for the HTTP transport.

    ``trust_env=False`` (see :class:`Fetcher`) stops httpx reading the
    environment, which is wanted for proxies and ``.netrc`` but also silences
    ``SSL_CERT_FILE`` -- the one variable an operator legitimately needs when
    the deployment sits behind TLS interception (docs/RUNBOOK.md section 6).
    Returning that path, when set, lets httpx verify against the operator's
    bundle. When unset, ``True`` keeps httpx's default bundle. Verification is
    never turned off: there is no path through here that yields ``False``.
    """
    return os.environ.get("SSL_CERT_FILE") or True


class Fetcher:
    """Policy-enforcing HTTPS GET with per-host politeness and a robots cache.

    One instance per process is the intent (see :func:`get_default_fetcher`),
    because the politeness clock and the robots cache are per host and only
    make sense shared. Tests build their own with a stub resolver, a mock
    transport and an instant sleeper.
    """

    def __init__(
        self,
        *,
        resolver: Resolver | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        sleeper: Sleeper | None = None,
        monotonic: Callable[[], float] | None = None,
        user_agent: str = USER_AGENT,
    ) -> None:
        self._resolver = resolver
        self._sleep: Sleeper = sleeper if sleeper is not None else asyncio.sleep
        self._monotonic = monotonic if monotonic is not None else time.monotonic
        self._user_agent = user_agent
        self._hosts: dict[str, _HostState] = {}
        self._robots: dict[str, _RobotsEntry] = {}
        # trust_env=False on both: no proxy from the environment, no .netrc
        # credentials, nothing the operator's shell could add to a request.
        #
        # That flag also makes httpx ignore SSL_CERT_FILE, which is the one
        # environment variable an operator legitimately needs: a deployment
        # behind TLS interception (docs/RUNBOOK.md section 6) must be able to
        # supply the intercepting root, or every outbound fetch fails
        # certificate verification. Honouring an operator-provided trust
        # store is not the same as disabling verification, which never
        # happens here. Proxies and .netrc stay ignored.
        self._client = httpx.AsyncClient(
            transport=transport
            if transport is not None
            else httpx.AsyncHTTPTransport(
                verify=_operator_trust_store(), retries=0, trust_env=False
            ),
            follow_redirects=False,
            trust_env=False,
            headers={
                "user-agent": user_agent,
                "accept": "text/html, application/xhtml+xml, application/ld+json, "
                "application/json;q=0.9, */*;q=0.1",
                "accept-language": "en, es;q=0.8",
            },
        )

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: types.TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    # -- public ------------------------------------------------------------------

    async def fetch(
        self,
        url: str,
        *,
        policy: FetchPolicy,
        accepted_content_types: frozenset[str],
        allowed_hosts: frozenset[str] | None = None,
        check_robots: bool = True,
        conditional: ConditionalHeaders | None = None,
        cancel: CancellationToken | None = None,
    ) -> FetchResult:
        """GET ``url`` under ``policy``.

        Raises:
            FetchError: one of the typed subclasses. A ``BlockedDestinationError``
                is raised *before* any connection to the offending address; a
                redirect to a blocked address is refused before it is followed.
        """
        try:
            async with asyncio.timeout(policy.timeout_seconds):
                return await self._fetch_with_redirects(
                    url,
                    policy=policy,
                    accepted_content_types=accepted_content_types,
                    allowed_hosts=allowed_hosts,
                    check_robots=check_robots,
                    conditional=conditional,
                    cancel=cancel,
                )
        except TimeoutError as error:
            raise FetchUnavailableError(
                f"The fetch did not complete within {policy.timeout_seconds:g} seconds.",
                kind="timeout",
            ) from error

    # -- redirects ---------------------------------------------------------------

    async def _fetch_with_redirects(
        self,
        url: str,
        *,
        policy: FetchPolicy,
        accepted_content_types: frozenset[str],
        allowed_hosts: frozenset[str] | None,
        check_robots: bool,
        conditional: ConditionalHeaders | None,
        cancel: CancellationToken | None,
    ) -> FetchResult:
        current = url
        redirects = 0
        while True:
            if cancel is not None:
                cancel.raise_if_cancelled()

            # Validate *this* hop. On a redirect, the new target has not been
            # checked by anything yet: it is parsed, resolved and validated
            # from scratch before any connection is attempted.
            try:
                target = await resolve_and_validate(
                    current, resolver=self._resolver, allowed_hosts=allowed_hosts
                )
            except BlockedAddressError as error:
                raise BlockedDestinationError(
                    "The destination is not a public HTTPS host, so it was not contacted.",
                    detail=str(error)[:500],
                ) from error

            if check_robots:
                robots = await self._robots_entry(target, policy)
                if robots.parser is not None and not robots.parser.can_fetch(
                    ROBOTS_PRODUCT_NAME, target.url
                ):
                    if robots.unavailable is not None:
                        # No rule was read; the disallow is assumed for this
                        # attempt only. Say exactly that.
                        raise RobotsDisallowedError(
                            f"The site's robots.txt could not be read ({robots.unavailable}), "
                            "so this attempt was treated as disallowed. Try again later, or "
                            "paste the description instead.",
                            detail=f"{target.host}: {robots.unavailable}",
                            assumed=True,
                        )
                    raise RobotsDisallowedError(
                        "The site's robots.txt disallows this path for this fetcher, so it "
                        "was not fetched. Paste the description instead.",
                        detail=f"{target.host} disallows {target.path[:200]}",
                    )

            response = await self._send_polite(
                target, policy, conditional if redirects == 0 else None
            )
            try:
                if response.is_redirect and "location" in response.headers:
                    redirects += 1
                    if redirects > policy.max_redirects:
                        raise RedirectLimitError(
                            f"The page redirected more than {policy.max_redirects} times.",
                            http_status=response.status_code,
                        )
                    current = urljoin(target.url, response.headers["location"])
                    log_shape("fetch.redirect", hop=redirects, status=response.status_code)
                    continue

                return await self._read(
                    response,
                    target=target,
                    policy=policy,
                    accepted_content_types=accepted_content_types,
                    redirects=redirects,
                )
            finally:
                await response.aclose()
                self._finished(target.host)

    # -- one request -------------------------------------------------------------

    async def _send_polite(
        self,
        target: ResolvedTarget,
        policy: FetchPolicy,
        conditional: ConditionalHeaders | None,
    ) -> httpx.Response:
        state = self._hosts.setdefault(target.host, _HostState())
        # Concurrency 1 per host: the lock is held for the whole exchange,
        # released in _finished() once the body has been read or discarded.
        await state.lock.acquire()
        try:
            await self._wait_for_interval(state, target.host, policy)
            return await self._send(target, policy, conditional)
        except BaseException:
            state.lock.release()
            raise

    def _finished(self, host: str) -> None:
        state = self._hosts.get(host)
        if state is None:  # pragma: no cover - a host is registered before it is sent to
            return
        state.last_finished = self._monotonic()
        if state.lock.locked():
            state.lock.release()

    async def _wait_for_interval(self, state: _HostState, host: str, policy: FetchPolicy) -> None:
        interval = policy.min_request_interval_seconds
        entry = self._robots.get(host)
        if entry is not None and entry.parser is not None:
            crawl_delay = entry.parser.crawl_delay(ROBOTS_PRODUCT_NAME)
            if crawl_delay is not None:
                interval = max(interval, min(float(crawl_delay), MAX_CRAWL_DELAY_SECONDS))
        if state.last_finished is None:
            return
        remaining = interval - (self._monotonic() - state.last_finished)
        if remaining > 0:
            await self._sleep(remaining)

    async def _send(
        self,
        target: ResolvedTarget,
        policy: FetchPolicy,
        conditional: ConditionalHeaders | None,
    ) -> httpx.Response:
        """Send one pinned request and return the unread, streaming response.

        Pinning, and why the certificate is still checked against the name:
        the URL given to httpx is ``https://<validated address>/path``, so the
        TCP connection goes to the address that passed the policy and nowhere
        else. Two things then restore the hostname where it matters:

        * the ``Host`` header is set explicitly to the name (httpx only fills
          it in when absent), so the server routes the request correctly;
        * the httpcore request extension ``sni_hostname`` is set to the name.
          httpcore passes it as ``server_hostname`` to the TLS handshake, which
          is both the SNI sent to the server and the name Python's ``ssl``
          verifies the certificate against (``check_hostname`` is on in
          httpx's default context). A certificate for the IP would fail; only
          a certificate valid for the real hostname is accepted.

        The alternative - connecting by name and hoping the resolver answers
        the same twice - is exactly the DNS-rebinding window AT20 exists to
        close, so it is not used anywhere.
        """
        headers: dict[str, str] = {"host": target.host}
        if conditional is not None:
            if conditional.etag:
                headers["if-none-match"] = conditional.etag
            if conditional.last_modified:
                headers["if-modified-since"] = conditional.last_modified

        request = self._client.build_request(
            "GET",
            target.pinned_url,
            headers=headers,
            timeout=httpx.Timeout(policy.timeout_seconds),
            extensions={"sni_hostname": target.host},
        )
        # Belt and braces: build_request merges the client's cookie jar, which
        # is emptied after every response, and nothing sets these headers -
        # but a request that carries them must not leave the process.
        for forbidden in ("cookie", "authorization", "proxy-authorization"):
            request.headers.pop(forbidden, None)

        try:
            response = await self._client.send(request, stream=True)
        except httpx.TimeoutException as error:
            raise FetchUnavailableError(
                "The site did not respond in time.", kind="timeout"
            ) from error
        except httpx.TransportError as error:
            raise FetchUnavailableError(
                f"{type(error).__name__} while contacting the site.", kind="transport"
            ) from error
        finally:
            # A Set-Cookie on this response must not ride along on the next
            # hop, or on any later fetch to the same host.
            self._client.cookies.clear()
        return response

    async def _read(
        self,
        response: httpx.Response,
        *,
        target: ResolvedTarget,
        policy: FetchPolicy,
        accepted_content_types: frozenset[str],
        redirects: int,
    ) -> FetchResult:
        status = response.status_code
        etag = response.headers.get("etag")
        last_modified = response.headers.get("last-modified")

        if status == 304:
            return FetchResult(
                status=304,
                final_url=target.url,
                content_type=None,
                body=b"",
                redirects=redirects,
                etag=etag,
                last_modified=last_modified,
            )
        if status in (401, 403):
            raise AccessDeniedError(
                f"The site answered {status}, which means access is denied. "
                "It was not retried and nothing was bypassed.",
                http_status=status,
            )
        if status == 429:
            raise RateLimitedError(
                "The site is rate limiting this fetcher. It was not retried.",
                retry_after_seconds=_retry_after_seconds(response),
            )
        if status >= 400:
            raise FetchUnavailableError(
                f"The site answered HTTP {status}.", kind="http", http_status=status
            )
        if status >= 300:
            # A 3xx without a Location header, or 304 handled above.
            raise FetchUnavailableError(
                f"The site answered HTTP {status} with no redirect target.",
                kind="http",
                http_status=status,
            )

        media, charset = _media_type(response.headers.get("content-type"))
        if media not in accepted_content_types:
            raise ContentTypeRejectedError(
                "The response is not a content type this fetcher reads, so the body "
                "was not downloaded.",
                http_status=status,
                detail=f"content-type={media or 'missing'}",
            )

        declared = response.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > policy.max_body_bytes:
            raise BodyTooLargeError(
                f"The response declares {int(declared)} bytes, above the "
                f"{policy.max_body_bytes} byte limit; nothing was downloaded.",
                http_status=status,
            )

        body = await self._read_bounded(response.aiter_bytes(_CHUNK_BYTES), policy.max_body_bytes)
        log_shape(
            "fetch.completed",
            status=status,
            redirects=redirects,
            body_bytes=len(body),
            media_type=media,
        )
        return FetchResult(
            status=status,
            final_url=target.url,
            content_type=media,
            body=body,
            redirects=redirects,
            etag=etag,
            last_modified=last_modified,
            charset=charset,
        )

    @staticmethod
    async def _read_bounded(chunks: AsyncIterator[bytes], limit: int) -> bytes:
        """Accumulate chunks, stopping the moment the cap is crossed."""
        buffer: list[bytes] = []
        total = 0
        try:
            async for chunk in chunks:
                total += len(chunk)
                if total > limit:
                    raise BodyTooLargeError(
                        f"The response exceeds the {limit} byte limit; the download was "
                        "stopped mid-stream and the partial body discarded."
                    )
                buffer.append(chunk)
        except httpx.TimeoutException as error:
            raise FetchUnavailableError(
                "The site stopped sending data before the body was complete.", kind="timeout"
            ) from error
        except httpx.TransportError as error:
            raise FetchUnavailableError(
                f"{type(error).__name__} while reading the body.", kind="transport"
            ) from error
        return b"".join(buffer)

    # -- robots.txt --------------------------------------------------------------

    async def _robots_entry(self, target: ResolvedTarget, policy: FetchPolicy) -> _RobotsEntry:
        entry = self._robots.get(target.host)
        now = self._monotonic()
        if entry is None or now - entry.cached_at > ROBOTS_CACHE_SECONDS:
            parser, unavailable = await self._load_robots(target, policy)
            entry = _RobotsEntry(parser=parser, cached_at=now, unavailable=unavailable)
            self._robots[target.host] = entry
        return entry

    async def _robots_allow(self, target: ResolvedTarget, policy: FetchPolicy) -> bool:
        entry = await self._robots_entry(target, policy)
        if entry.parser is None:
            return True
        return entry.parser.can_fetch(ROBOTS_PRODUCT_NAME, target.url)

    async def _load_robots(
        self, target: ResolvedTarget, policy: FetchPolicy
    ) -> tuple[RobotFileParser | None, str | None]:
        """Fetch and parse ``/robots.txt`` for the target's host.

        Returns ``(parser, unavailable)``. RFC 9309 section 2.3.1: a 4xx means
        no rules (``(None, None)``); a 5xx or a redirect loop means the crawler
        assumes it is disallowed for this attempt, returned as a synthetic
        disallow-everything parser *with the reason*, so the caller can report
        "robots.txt could not be read" rather than inventing a rule the site
        never published. A blocked destination propagates - it is the same host
        the real request would go to.

        A transport failure (connection refused, TLS verification, timeout) is
        NOT turned into a disallow: nothing was learned about the site, and
        reporting it as a robots decision would misdiagnose the operator's own
        network as the site's policy. It propagates as the transport failure it
        is, which the handlers already map to a retryable task failure.
        """
        robots_url = f"https://{target.host}/robots.txt"
        robots_policy = FetchPolicy(
            max_redirects=policy.max_redirects,
            max_body_bytes=ROBOTS_MAX_BYTES,
            timeout_seconds=policy.timeout_seconds,
            min_request_interval_seconds=policy.min_request_interval_seconds,
            timeout_ceiling_seconds=policy.timeout_ceiling_seconds,
        )
        try:
            result = await self._fetch_with_redirects(
                robots_url,
                policy=robots_policy,
                # Any text is parsed; a misconfigured host serving robots.txt as
                # text/plain, text/html or octet-stream is still just rules.
                accepted_content_types=frozenset(
                    {"text/plain", "text/html", "application/octet-stream", "text/x-robots"}
                ),
                allowed_hosts=None,
                check_robots=False,
                conditional=None,
                cancel=None,
            )
        except BlockedDestinationError:
            raise
        except FetchUnavailableError as error:
            if error.kind == "http":
                if error.http_status is not None and error.http_status < 500:
                    return None, None
                return _disallow_everything(), f"robots.txt returned HTTP {error.http_status}"
            # Transport or timeout: the site was never reached. Re-raise as the
            # transport failure it is, naming the robots step and, for a TLS
            # failure, the most likely operator-side cause.
            cause = str(error.__cause__ or "")
            hint = ""
            if "SSL" in cause or "certificate" in cause.lower():
                hint = (
                    " Certificate verification failed; if this deployment sits behind TLS "
                    "interception, see docs/RUNBOOK.md section 6."
                )
            raise FetchUnavailableError(
                f"The site could not be reached while checking robots.txt "
                f"({error.message.rstrip('.')}).{hint}",
                kind=error.kind,
            ) from error
        except (ContentTypeRejectedError, BodyTooLargeError):
            # Not a robots file we can read: RFC 9309 treats an unparseable
            # file as having no rules.
            return None, None
        except (AccessDeniedError, RateLimitedError):
            return None, None
        except RedirectLimitError:
            return _disallow_everything(), "robots.txt redirected more times than allowed"

        parser = RobotFileParser()
        parser.parse(result.text().splitlines())
        return parser, None

    # -- test support ------------------------------------------------------------

    def robots_cache_size(self) -> int:
        return len(self._robots)

    def politeness_state(self, host: str) -> float | None:
        state = self._hosts.get(host)
        return state.last_finished if state is not None else None


_default: Fetcher | None = None


def get_default_fetcher() -> Fetcher:
    """The process-wide fetcher used by handlers when none is injected."""
    global _default
    if _default is None:
        _default = Fetcher()
    return _default


def _reset_default_fetcher_for_tests() -> None:
    global _default
    _default = None


def fetch_error_to_task_failure(error: FetchUnavailableError) -> tuple[str, bool, str]:
    """Map a transport-level failure onto (failure code, retryable, message)."""
    if error.kind == "timeout":
        return ("TIMEOUT", True, error.message)
    if error.kind == "http":
        status = error.http_status or 0
        return ("FETCH_BLOCKED", status >= 500, error.message)
    return ("FETCH_BLOCKED", True, error.message)


__all__ = [
    "FETCH_WARNING_CODES",
    "MIN_REQUEST_INTERVAL_SECONDS",
    "ROBOTS_PRODUCT_NAME",
    "USER_AGENT",
    "AccessDeniedError",
    "BlockedDestinationError",
    "BodyTooLargeError",
    "ConditionalHeaders",
    "ContentTypeRejectedError",
    "FetchError",
    "FetchPolicy",
    "FetchResult",
    "FetchUnavailableError",
    "Fetcher",
    "RateLimitedError",
    "RedirectLimitError",
    "RobotsDisallowedError",
    "SchemaDriftError",
    "fetch_error_to_task_failure",
    "get_default_fetcher",
]
