"""Client for the internal task protocol.

Implements exactly the endpoints in ``docs/spec/04_API_CONTRACTS.md`` ->
"Internal task protocol". Every request and response body is a generated
contract model, so the worker and the API cannot disagree about shape.

The worker is an *outbound polling client*. It has no inbound surface, writes
nothing to the database and holds no workspace context of its own
(invariant 1, ADR03).
"""

from __future__ import annotations

import types
from typing import Any, Final, Self

import httpx
from tenacity import AsyncRetrying, RetryCallState, retry_if_exception_type, stop_after_attempt
from tenacity.wait import wait_exponential_jitter

from .contracts.generated import (
    PROTOCOL_VERSION,
    RESULT_SCHEMA_VERSION,
    ArtifactUploadResponse,
    ClaimRequest,
    ClaimResponse,
    CompleteRequest,
    FailRequest,
    HeartbeatRequest,
    HeartbeatResponse,
    TaskAck,
    TaskProgress,
    TaskType,
)
from .errors import LeaseLostError, TaskFailureError, WorkerError
from .logging import get_logger

_INTERNAL_PREFIX: Final = "/internal/v1/tasks"

#: Header carrying the task lease token on the one request that has no body.
#: Mirrors ``LEASE_TOKEN_HEADER`` in ``apps/api/src/routes/internal.ts``.
#: S105 is suppressed below because the linter sees "token" in the value: this
#: is the header *name*, not a credential. The credential is passed in at call
#: time and never appears in source.
LEASE_TOKEN_HEADER: Final = "x-lease-token"  # noqa: S105
_MAX_ATTEMPTS: Final = 4
_MAX_RETRY_WAIT_SECONDS: Final = 30.0

_log = get_logger(__name__)


class ApiRequestError(WorkerError):
    """A 4xx the worker sent. Never retried: the request itself is wrong."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(f"HTTP {status_code} {code}: {message}")
        self.status_code = status_code
        self.code = code
        self.message = message


class TransientApiError(WorkerError):
    """A connection failure, a 5xx or a 429. Worth retrying."""

    def __init__(self, detail: str, *, retry_after: float | None = None) -> None:
        super().__init__(detail)
        self.retry_after = retry_after


def _retry_wait(retry_state: RetryCallState) -> float:
    """Exponential backoff with jitter, unless the server told us to wait.

    ``docs/spec/02_ARCHITECTURE.md``: "Respect Retry-After on 429."
    """
    outcome = retry_state.outcome
    exc = outcome.exception() if outcome is not None else None
    if isinstance(exc, TransientApiError) and exc.retry_after is not None:
        return min(max(exc.retry_after, 0.0), _MAX_RETRY_WAIT_SECONDS)
    fallback: float = wait_exponential_jitter(initial=0.5, max=8.0, jitter=0.5)(retry_state)
    return fallback


def _parse_retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return float(raw.strip())
    except ValueError:
        # An HTTP-date form is legal but rare here; fall back to normal backoff
        # rather than guessing a clock offset.
        return None


def _error_code(response: httpx.Response) -> tuple[str, str]:
    """Best-effort read of the standard error envelope."""
    try:
        payload = response.json()
    except ValueError:
        return ("UNPARSEABLE_ERROR", response.reason_phrase or "no error body")
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            code = str(error.get("code", "UNKNOWN"))
            # The envelope message is operator-facing and already redacted by
            # the API; it is still never logged alongside task content.
            return (code, str(error.get("message", "")))
    return ("UNKNOWN", "")


class TaskApiClient:
    """Bearer-authenticated client for ``/internal/v1/tasks``."""

    def __init__(
        self,
        base_url: str,
        auth_token: str,
        *,
        timeout_seconds: float = 30.0,
        max_download_bytes: int,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._max_download_bytes = max_download_bytes
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
            headers={
                "authorization": f"Bearer {auth_token}",
                "accept": "application/json",
                "user-agent": "job-getter-worker/0",
            },
            transport=transport,
            follow_redirects=False,
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

    # -- plumbing ---------------------------------------------------------------

    async def _send(
        self,
        method: str,
        url: str,
        *,
        json: Any | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
        expect_no_content: bool = False,
    ) -> httpx.Response:
        """Send one request, classifying the outcome. No retry logic here."""
        try:
            response = await self._client.request(method, url, json=json, files=files)
        except httpx.TransportError as error:  # connect/read/write/pool failures
            raise TransientApiError(f"{type(error).__name__} contacting the API") from error

        if response.status_code == 204 and expect_no_content:
            return response
        if response.status_code < 400:
            return response

        if response.status_code == 429:
            raise TransientApiError(
                "rate limited by the API", retry_after=_parse_retry_after(response)
            )
        if response.status_code >= 500:
            raise TransientApiError(f"API returned {response.status_code}")

        code, message = _error_code(response)
        raise ApiRequestError(response.status_code, code, message)

    async def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        json: Any | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
        expect_no_content: bool = False,
    ) -> httpx.Response:
        """Retry only genuinely transient failures.

        A 4xx is a bug or a lost lease; repeating it wastes time and, for
        ``complete``, risks double-applying work. Only
        :class:`TransientApiError` is retried.
        """
        attempts = AsyncRetrying(
            retry=retry_if_exception_type(TransientApiError),
            wait=_retry_wait,
            stop=stop_after_attempt(_MAX_ATTEMPTS),
            reraise=True,
        )
        async for attempt in attempts:
            with attempt:
                return await self._send(
                    method,
                    url,
                    json=json,
                    files=files,
                    expect_no_content=expect_no_content,
                )
        raise AssertionError("unreachable: AsyncRetrying always returns or raises")

    # -- protocol ---------------------------------------------------------------

    async def claim(
        self, worker_id: str, capabilities: tuple[TaskType, ...]
    ) -> ClaimResponse | None:
        """Claim one task.

        Returns ``None`` on 204, which means "no work right now" and is a normal
        idle response, not an error.
        """
        request = ClaimRequest.model_validate(
            {
                "worker_id": worker_id,
                "capabilities": [capability.value for capability in capabilities],
                "protocol_version": PROTOCOL_VERSION,
            }
        )
        response = await self._request_with_retry(
            "POST",
            f"{_INTERNAL_PREFIX}/claim",
            json=request.model_dump(mode="json"),
            expect_no_content=True,
        )
        if response.status_code == 204:
            return None
        return ClaimResponse.model_validate(response.json())

    async def heartbeat(
        self, task_id: str, lease_token: str, progress: TaskProgress | None = None
    ) -> HeartbeatResponse:
        """Extend the lease and learn whether cancellation was requested.

        A 409 means the lease is gone; the caller must abandon the work.
        """
        request = HeartbeatRequest(lease_token=lease_token, progress=progress)
        try:
            response = await self._request_with_retry(
                "POST",
                f"{_INTERNAL_PREFIX}/{task_id}/heartbeat",
                json=request.model_dump(mode="json"),
            )
        except ApiRequestError as error:
            if error.status_code == 409:
                raise LeaseLostError("heartbeat rejected: the lease is no longer ours") from error
            raise
        return HeartbeatResponse.model_validate(response.json())

    async def download_input_file(
        self, task_id: str, file_id: str, *, lease_token: str, max_bytes: int
    ) -> bytes:
        """Stream one declared input file, capped while streaming.

        This is the one endpoint where the lease token cannot travel in the
        body, because it is a GET. The API reads it from the
        :data:`LEASE_TOKEN_HEADER` header instead (``apps/api/src/routes/
        internal.ts``), and a request without it never reaches the file. The
        operator credential in the ``Authorization`` header is not sufficient:
        it says *which worker*, not *which task's lease*.

        The size cap is enforced chunk by chunk rather than after the fact: a
        response that lies about its length, or declares none, must not be able
        to exhaust worker memory
        (``docs/spec/09_SECURITY_PRIVACY.md`` -> "bound file size").
        """
        limit = min(max_bytes, self._max_download_bytes)
        url = f"{_INTERNAL_PREFIX}/{task_id}/files/{file_id}"

        try:
            async with self._client.stream(
                "GET", url, headers={LEASE_TOKEN_HEADER: lease_token}
            ) as response:
                if response.status_code >= 400:
                    await response.aread()
                    if response.status_code == 429:
                        raise TransientApiError(
                            "rate limited by the API", retry_after=_parse_retry_after(response)
                        )
                    if response.status_code >= 500:
                        raise TransientApiError(f"API returned {response.status_code}")
                    code, message = _error_code(response)
                    raise ApiRequestError(response.status_code, code, message)

                declared = response.headers.get("content-length")
                if declared is not None and declared.isdigit() and int(declared) > limit:
                    raise TaskFailureError(
                        "LIMIT_EXCEEDED",
                        f"The input file declares {int(declared)} bytes, above the "
                        f"{limit} byte limit for this worker.",
                    )

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > limit:
                        raise TaskFailureError(
                            "LIMIT_EXCEEDED",
                            f"The input file exceeds the {limit} byte limit; "
                            "download was stopped without buffering the rest.",
                        )
                    chunks.append(chunk)
        except httpx.TransportError as error:
            raise TransientApiError(f"{type(error).__name__} downloading task input") from error

        return b"".join(chunks)

    async def upload_artifact(
        self,
        task_id: str,
        lease_token: str,
        *,
        filename: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> ArtifactUploadResponse:
        """Upload a task artifact.

        The upload is staging only until the task completes
        (``docs/spec/02_ARCHITECTURE.md``: unreferenced artifacts expire after
        ``ARTIFACT_STAGING_TTL_HOURS``).
        """
        response = await self._request_with_retry(
            "POST",
            f"{_INTERNAL_PREFIX}/{task_id}/artifacts",
            files={
                "file": (filename, content, content_type),
                # The lease token travels in the multipart body, not a log line.
                "lease_token": ("", lease_token.encode("utf-8"), "text/plain"),
            },
        )
        return ArtifactUploadResponse.model_validate(response.json())

    async def complete(self, task_id: str, lease_token: str, result: Any) -> TaskAck:
        """Report success.

        A 409 is **terminal**. It means another attempt owns the task now, so
        retrying could double-apply the same work. The worker gives up quietly
        instead.
        """
        request = CompleteRequest(
            lease_token=lease_token,
            result_schema_version=RESULT_SCHEMA_VERSION,
            result=result,
        )
        try:
            response = await self._request_with_retry(
                "POST",
                f"{_INTERNAL_PREFIX}/{task_id}/complete",
                json=request.model_dump(mode="json"),
            )
        except ApiRequestError as error:
            if error.status_code == 409:
                raise LeaseLostError(
                    "complete rejected with 409: the lease was lost and the result "
                    "was not applied. Not retrying, because a second attempt could "
                    "double-apply the work."
                ) from error
            raise
        return TaskAck.model_validate(response.json())

    async def fail(self, task_id: str, request: FailRequest) -> TaskAck:
        """Report a failure. The server decides whether it will be retried."""
        try:
            response = await self._request_with_retry(
                "POST",
                f"{_INTERNAL_PREFIX}/{task_id}/fail",
                json=request.model_dump(mode="json"),
            )
        except ApiRequestError as error:
            if error.status_code == 409:
                raise LeaseLostError("fail rejected: the lease is no longer ours") from error
            raise
        return TaskAck.model_validate(response.json())
