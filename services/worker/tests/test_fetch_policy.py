"""AT20: the arbitrary-URL fetcher refuses private destinations, before access.

``docs/spec/11_TESTING_ACCEPTANCE.md``: "Private IP or redirect fetch ->
Blocked before access, including IPv6/rebinding cases." Every blocked case
here asserts two things: the typed error, and that *no request left the
process* for the blocked destination. The transport records everything it
is asked to send, so "blocked before access" is a fact about the recorded
list, not an inference from the error.
"""

from __future__ import annotations

import ipaddress
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from job_getter_worker.net import (
    HTML_CONTENT_TYPES,
    USER_AGENT,
    AccessDeniedError,
    BlockedDestinationError,
    BodyTooLargeError,
    ContentTypeRejectedError,
    FetchPolicy,
    FetchResult,
    FetchUnavailableError,
    RateLimitedError,
    RedirectLimitError,
    RobotsDisallowedError,
    address_block_reason,
)
from job_getter_worker.net.fetch import ConditionalHeaders, _retry_after_seconds
from job_getter_worker.net.policy import MAX_BODY_BYTES, MAX_REDIRECTS, MAX_TIMEOUT_SECONDS

from .conftest import (
    PUBLIC_V4,
    PUBLIC_V6,
    REPO_ROOT,
    FakeSite,
    html_response,
    make_fetcher,
    read_page,
)

HOST = "jobs.example.test"
POLICY = FetchPolicy()


async def fetch(site: FakeSite, url: str, **kwargs: Any) -> FetchResult:
    fetcher = make_fetcher(site)
    try:
        return await fetcher.fetch(
            url, policy=POLICY, accepted_content_types=HTML_CONTENT_TYPES, **kwargs
        )
    finally:
        await fetcher.aclose()


# ---------------------------------------------------------------------------
# blocked destinations


@pytest.mark.parametrize(
    "url",
    [
        "http://jobs.example.test/job/1",
        "https://127.0.0.1/job/1",
        "https://[::1]/job/1",
        "https://169.254.169.254/latest/meta-data/",
        "https://10.0.0.1/job/1",
        "https://[fd00:ec2::254]/latest/meta-data/",
        "https://[::ffff:10.0.0.1]/job/1",
        "https://[64:ff9b::a00:1]/job/1",
        "https://[2002:a00:1::]/job/1",
        "https://100.64.0.1/job/1",
        "https://224.0.0.1/job/1",
        "https://0.0.0.0/job/1",
        "https://private.example.test/job/1",
        "https://mixed.example.test/job/1",
        "https://metadata.example.test/",
        "https://localhost/job/1",
        "https://jobs.example.test:8443/job/1",
        "https://user:secret@jobs.example.test/job/1",
        "https://unknown-name.example.test/job/1",
    ],
)
async def test_blocked_destinations_are_refused_before_any_request(url: str) -> None:
    site = FakeSite()
    site.add(HOST, "/job/1", html_response("<html><body>never</body></html>"))
    with pytest.raises(BlockedDestinationError):
        await fetch(site, url)
    assert site.requests == [], "a blocked destination must not be contacted at all"


async def test_redirect_from_public_to_private_is_blocked_after_the_redirect() -> None:
    """The classic SSRF bypass: a public page answering with a private Location."""
    site = FakeSite()
    site.add(
        HOST,
        "/start",
        httpx.Response(302, headers={"location": "https://evil.example.test/secret"}),
    )
    site.add("evil.example.test", "/secret", html_response("<html>internal</html>"))

    with pytest.raises(BlockedDestinationError):
        await fetch(site, f"https://{HOST}/start")

    assert site.hosts_contacted() == [HOST, HOST]  # robots.txt then /start
    assert "evil.example.test" not in site.hosts_contacted()
    for request in site.requests:
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers


@pytest.mark.parametrize(
    "location",
    [
        "https://127.0.0.1/x",
        "https://[::ffff:169.254.169.254]/x",
        "http://jobs.example.test/downgrade",
        "https://jobs.example.test:8080/port",
    ],
)
async def test_every_redirect_hop_is_validated(location: str) -> None:
    site = FakeSite()
    site.add(HOST, "/start", httpx.Response(302, headers={"location": location}))
    with pytest.raises(BlockedDestinationError):
        await fetch(site, f"https://{HOST}/start")
    assert [r.url.path for r in site.requests] == ["/robots.txt", "/start"]


# ---------------------------------------------------------------------------
# pinning


async def test_connection_is_pinned_to_the_validated_address() -> None:
    site = FakeSite()
    site.add(HOST, "/job/7", html_response("<html><body>ok</body></html>"))

    result = await fetch(site, f"https://{HOST}/job/7")

    page = next(r for r in site.requests if r.url.path == "/job/7")
    assert page.url.host == PUBLIC_V4, "the socket must go to the address that was validated"
    assert page.headers["host"] == HOST, "the Host header carries the real name"
    assert page.extensions["sni_hostname"] == HOST, "TLS verifies the real name"
    assert result.final_url == f"https://{HOST}/job/7"
    assert result.status == 200


async def test_public_ipv6_destinations_are_allowed_and_pinned() -> None:
    site = FakeSite()
    site.add("v6.example.test", "/j", html_response("<html>v6</html>"))
    await fetch(site, "https://v6.example.test/j")
    page = next(r for r in site.requests if r.url.path == "/j")
    assert ipaddress.ip_address(page.url.host) == ipaddress.ip_address(PUBLIC_V6)
    assert page.headers["host"] == "v6.example.test"


# ---------------------------------------------------------------------------
# redirects, size, content type


async def test_more_than_the_maximum_redirects_is_refused() -> None:
    site = FakeSite()
    for hop in range(1, 6):
        site.add(HOST, f"/r{hop}", httpx.Response(302, headers={"location": f"/r{hop + 1}"}))
    site.add(HOST, "/r6", html_response("<html>final</html>"))

    with pytest.raises(RedirectLimitError):
        await fetch(site, f"https://{HOST}/r1")

    paths = [r.url.path for r in site.requests if r.url.path != "/robots.txt"]
    assert paths == ["/r1", "/r2", "/r3", "/r4"], "the 4th redirect is refused, not followed"


async def test_exactly_the_maximum_redirects_succeeds() -> None:
    site = FakeSite()
    site.add(HOST, "/a", httpx.Response(301, headers={"location": "/b"}))
    site.add(HOST, "/b", httpx.Response(302, headers={"location": "/c"}))
    site.add(HOST, "/c", httpx.Response(307, headers={"location": "/d"}))
    site.add(HOST, "/d", html_response("<html>final</html>"))
    result = await fetch(site, f"https://{HOST}/a")
    assert result.redirects == MAX_REDIRECTS == 3
    assert result.final_url == f"https://{HOST}/d"


async def test_a_body_over_the_cap_is_stopped_mid_stream() -> None:
    chunk = b"x" * (64 * 1024)
    total_chunks = 48  # 3 MiB, over the 2 MiB cap
    yielded = 0

    async def body() -> AsyncIterator[bytes]:
        nonlocal yielded
        for _ in range(total_chunks):
            yielded += 1
            yield chunk

    site = FakeSite()
    site.add(
        HOST,
        "/big",
        lambda _r: httpx.Response(200, content=body(), headers={"content-type": "text/html"}),
    )
    with pytest.raises(BodyTooLargeError):
        await fetch(site, f"https://{HOST}/big")
    assert 0 < yielded < total_chunks, "the stream was cut off, not read to the end"
    assert MAX_BODY_BYTES == 2 * 1024 * 1024


async def test_a_declared_oversize_body_is_refused_without_reading() -> None:
    site = FakeSite()
    site.add(
        HOST,
        "/declared",
        httpx.Response(
            200,
            content=b"<html>small</html>",
            headers={"content-type": "text/html", "content-length": str(MAX_BODY_BYTES + 1)},
        ),
    )
    with pytest.raises(BodyTooLargeError):
        await fetch(site, f"https://{HOST}/declared")


@pytest.mark.parametrize("content_type", ["application/pdf", "text/plain", "image/png", ""])
async def test_disallowed_content_types_are_rejected(content_type: str) -> None:
    site = FakeSite()
    site.add(
        HOST,
        "/file",
        httpx.Response(200, content=b"%PDF-1.4", headers={"content-type": content_type}),
    )
    with pytest.raises(ContentTypeRejectedError):
        await fetch(site, f"https://{HOST}/file")


def test_content_type_allowlist_matches_the_contract_source() -> None:
    """``URL_FETCH_POLICY.allowedContentTypes`` is not generated; pin it by hand."""
    source = (REPO_ROOT / "packages/contracts/src/schemas/jobs.ts").read_text(encoding="utf-8")
    line = next(line for line in source.splitlines() if "allowedContentTypes" in line)
    for media_type in HTML_CONTENT_TYPES:
        assert f"'{media_type}'" in line
    assert MAX_TIMEOUT_SECONDS == 20


# ---------------------------------------------------------------------------
# robots.txt


async def test_robots_disallow_is_honoured_and_cached() -> None:
    site = FakeSite()
    site.add(
        HOST,
        "/robots.txt",
        httpx.Response(
            200,
            content=read_page("robots-disallow.txt").encode(),
            headers={"content-type": "text/plain"},
        ),
    )
    site.add(HOST, "/careers/internal/9", html_response("<html>secret</html>"))
    site.add(HOST, "/careers/open/1", html_response("<html>open</html>"))

    fetcher = make_fetcher(site)
    try:
        with pytest.raises(RobotsDisallowedError):
            await fetcher.fetch(
                f"https://{HOST}/careers/internal/9",
                policy=POLICY,
                accepted_content_types=HTML_CONTENT_TYPES,
            )
        assert "/careers/internal/9" not in site.paths_for(HOST)

        result = await fetcher.fetch(
            f"https://{HOST}/careers/open/1",
            policy=POLICY,
            accepted_content_types=HTML_CONTENT_TYPES,
        )
        assert result.status == 200
        assert site.paths_for(HOST).count("/robots.txt") == 1, "robots.txt is cached per host"
        # Crawl-delay: 2 for our product token is honoured over the 1 s floor
        # (the fake clock has already ticked a few milliseconds since the
        # robots fetch finished, so the wait is just under two seconds).
        assert any(1.9 <= delay <= 2.0 for delay in fetcher.recorded_sleeps)
    finally:
        await fetcher.aclose()


async def test_missing_robots_means_allowed_and_server_error_means_disallowed() -> None:
    site = FakeSite()  # no robots route -> 404
    site.add(HOST, "/j", html_response("<html>ok</html>"))
    result = await fetch(site, f"https://{HOST}/j")
    assert result.status == 200

    broken = FakeSite()
    broken.add(
        HOST,
        "/robots.txt",
        httpx.Response(503, content=b"", headers={"content-type": "text/plain"}),
    )
    broken.add(HOST, "/j", html_response("<html>ok</html>"))
    with pytest.raises(RobotsDisallowedError):
        await fetch(broken, f"https://{HOST}/j")
    assert "/j" not in broken.paths_for(HOST)


# ---------------------------------------------------------------------------
# no credentials, no cookies, honest agent


async def test_no_cookie_or_credential_header_is_ever_sent() -> None:
    site = FakeSite()
    site.add(
        HOST,
        "/start",
        httpx.Response(
            302,
            headers={
                "location": "/final",
                "set-cookie": "session=attacker-planted; Path=/",
            },
        ),
    )
    site.add(HOST, "/final", html_response("<html>done</html>", headers={"set-cookie": "b=2"}))

    fetcher = make_fetcher(site)
    try:
        await fetcher.fetch(
            f"https://{HOST}/start", policy=POLICY, accepted_content_types=HTML_CONTENT_TYPES
        )
        await fetcher.fetch(
            f"https://{HOST}/final", policy=POLICY, accepted_content_types=HTML_CONTENT_TYPES
        )
    finally:
        await fetcher.aclose()

    assert len(site.requests) >= 3
    for request in site.requests:
        assert "cookie" not in request.headers, "a Set-Cookie must never come back"
        assert "authorization" not in request.headers
        assert "proxy-authorization" not in request.headers
        assert request.headers["user-agent"] == USER_AGENT
    assert "JobGetter" in USER_AGENT


async def test_politeness_spaces_requests_to_one_host() -> None:
    site = FakeSite()
    site.add(HOST, "/a", html_response("<html>a</html>"))
    site.add(HOST, "/b", html_response("<html>b</html>"))
    fetcher = make_fetcher(site)
    try:
        await fetcher.fetch(
            f"https://{HOST}/a", policy=POLICY, accepted_content_types=HTML_CONTENT_TYPES
        )
        await fetcher.fetch(
            f"https://{HOST}/b", policy=POLICY, accepted_content_types=HTML_CONTENT_TYPES
        )
    finally:
        await fetcher.aclose()
    # robots.txt, /a and /b all hit the same host: two waits of ~1 s.
    assert len(fetcher.recorded_sleeps) >= 2
    assert all(0.9 <= delay <= 1.0 for delay in fetcher.recorded_sleeps)


# ---------------------------------------------------------------------------
# status handling


async def test_forbidden_is_reported_once_without_retry() -> None:
    site = FakeSite()
    site.add(HOST, "/j", httpx.Response(403, content=b"no", headers={"content-type": "text/html"}))
    with pytest.raises(AccessDeniedError) as info:
        await fetch(site, f"https://{HOST}/j")
    assert info.value.http_status == 403
    assert site.paths_for(HOST).count("/j") == 1


async def test_rate_limit_carries_retry_after_and_is_not_retried() -> None:
    site = FakeSite()
    site.add(
        HOST,
        "/j",
        httpx.Response(429, headers={"retry-after": "120", "content-type": "text/html"}),
    )
    with pytest.raises(RateLimitedError) as info:
        await fetch(site, f"https://{HOST}/j")
    assert info.value.retry_after_seconds == 120
    assert info.value.to_warning().detail == "retry_after_seconds=120"
    assert site.paths_for(HOST).count("/j") == 1


def test_retry_after_http_date_is_converted_to_seconds() -> None:
    response = httpx.Response(
        429,
        headers={
            "date": "Sun, 20 Sep 2026 10:00:00 GMT",
            "retry-after": "Sun, 20 Sep 2026 10:01:30 GMT",
        },
    )
    assert _retry_after_seconds(response) == 90
    past = httpx.Response(
        429,
        headers={
            "date": "Sun, 20 Sep 2026 10:00:00 GMT",
            "retry-after": "Sun, 20 Sep 2026 09:00:00 GMT",
        },
    )
    assert _retry_after_seconds(past) == 0
    assert _retry_after_seconds(httpx.Response(429, headers={"retry-after": "soon"})) is None


async def test_conditional_headers_and_304() -> None:
    site = FakeSite()

    def route(request: httpx.Request) -> httpx.Response:
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304, headers={"etag": '"v1"'})
        return html_response("<html>v1</html>", headers={"etag": '"v1"'})

    site.add(HOST, "/j", route)
    fetcher = make_fetcher(site)
    try:
        first = await fetcher.fetch(
            f"https://{HOST}/j", policy=POLICY, accepted_content_types=HTML_CONTENT_TYPES
        )
        second = await fetcher.fetch(
            f"https://{HOST}/j",
            policy=POLICY,
            accepted_content_types=HTML_CONTENT_TYPES,
            conditional=ConditionalHeaders(etag=first.etag),
        )
    finally:
        await fetcher.aclose()
    assert first.etag == '"v1"' and not first.not_modified
    assert second.not_modified and second.body == b"" and second.etag == '"v1"'


async def test_timeouts_and_transport_failures_are_typed() -> None:
    site = FakeSite()

    def slow(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    site.add(HOST, "/slow", slow)
    with pytest.raises(FetchUnavailableError) as info:
        await fetch(site, f"https://{HOST}/slow")
    assert info.value.kind == "timeout"

    def down(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    site.add(HOST, "/down", down)
    with pytest.raises(FetchUnavailableError) as info:
        await fetch(site, f"https://{HOST}/down")
    assert info.value.kind == "transport"


def test_policy_never_loosens_the_hard_bounds() -> None:
    loose = FetchPolicy(max_redirects=10, max_body_bytes=50_000_000, timeout_seconds=600)
    assert loose.max_redirects == MAX_REDIRECTS
    assert loose.max_body_bytes == MAX_BODY_BYTES
    assert loose.timeout_seconds == MAX_TIMEOUT_SECONDS
    assert FetchPolicy(min_request_interval_seconds=0.01).min_request_interval_seconds == 1.0


# ---------------------------------------------------------------------------
# address classification table


@pytest.mark.parametrize(
    ("address", "blocked"),
    [
        ("93.184.216.34", False),
        ("2001:4860:4860::8888", False),
        ("127.0.0.1", True),
        ("::1", True),
        ("10.0.0.1", True),
        ("172.16.5.5", True),
        ("192.168.1.1", True),
        ("169.254.169.254", True),
        ("169.254.170.2", True),
        ("100.64.0.1", True),
        ("100.100.100.200", True),
        ("224.0.0.1", True),
        ("240.0.0.1", True),
        ("255.255.255.255", True),
        ("0.0.0.0", True),  # noqa: S104 - a test input; nothing binds to it
        ("::", True),
        ("fd00:ec2::254", True),
        ("fe80::1", True),
        ("ff02::1", True),
        ("::ffff:10.0.0.1", True),
        ("::ffff:93.184.216.34", True),
        ("64:ff9b::a00:1", True),
        ("2002:a00:1::", True),
        ("2001:0:4136:e378:8000:63bf:3fff:fdd2", True),
        ("203.0.113.10", True),
    ],
)
def test_address_block_reason_table(address: str, blocked: bool) -> None:
    reason = address_block_reason(ipaddress.ip_address(address))
    assert (reason is not None) is blocked, f"{address}: {reason}"
