"""The poll / lease / heartbeat loop.

Claim one task, run its handler, complete or fail it, repeat. Every rule in
here comes from ``docs/spec/02_ARCHITECTURE.md`` -> "Queue semantics" and
``docs/spec/04_API_CONTRACTS.md`` -> "Internal task protocol":

* A 204 from claim means *no work*, so the loop sleeps and backs off. It is not
  an error and is never logged as one.
* A heartbeat goes out every ``HEARTBEAT_SECONDS`` while a handler runs,
  carrying progress. The lease is 120 seconds; missing heartbeats loses it.
* ``cancel_requested`` sets a cancellation token the handler checks at safe
  checkpoints. Only then is the task failed with ``CANCELLED`` - nothing is
  left half applied.
* If the lease expires, or a heartbeat returns 409, the work is **abandoned**.
  No complete, no fail: the API has already given the task to someone else, and
  a stale token would be rejected anyway.
* On SIGTERM/SIGINT the loop stops claiming and lets the current task finish. A
  second signal asks the handler to stop at its next checkpoint.
"""

from __future__ import annotations

import asyncio
import contextlib
import signal
from collections.abc import Callable
from dataclasses import dataclass, field
from types import FrameType

from .api import ApiRequestError, TaskApiClient, TransientApiError
from .cancellation import CancellationToken
from .clock import parse_timestamp, utc_now
from .contracts.generated import HEARTBEAT_SECONDS, ClaimResponse, TaskProgress, TaskType
from .errors import LeaseLostError, TaskCancelledError, TaskFailureError
from .handlers import HandlerRegistry, TaskContext, build_default_registry
from .logging import bind_task, bind_worker, clear_task, get_logger, log_shape
from .settings import WorkerSettings

_log = get_logger("job_getter_worker.worker")


@dataclass
class _TaskState:
    """Mutable state shared between a running handler and its heartbeat."""

    progress: TaskProgress | None = None
    lease_lost: bool = False
    cancel_requested: bool = False
    lease_expires_at: str = ""
    heartbeats: int = field(default=0)


class Worker:
    """An outbound polling worker. It has no inbound surface at all."""

    def __init__(
        self,
        settings: WorkerSettings,
        api: TaskApiClient,
        registry: HandlerRegistry | None = None,
        *,
        heartbeat_seconds: float = float(HEARTBEAT_SECONDS),
    ) -> None:
        self.settings = settings
        self.api = api
        self.registry = registry if registry is not None else build_default_registry()
        self.heartbeat_seconds = heartbeat_seconds
        self.capabilities: tuple[TaskType, ...] = settings.declared_capabilities
        self.registry.assert_capabilities_supported(self.capabilities)

        self._shutdown = CancellationToken("shutdown")
        self._hard_stop = CancellationToken("shutdown_now")
        self._current: CancellationToken | None = None
        self._idle_seconds = settings.poll_interval_seconds

    # -- lifecycle ---------------------------------------------------------------

    def request_shutdown(self) -> None:
        """Stop claiming new work. A second call stops the current task too."""
        if self._shutdown.is_cancelled:
            self._hard_stop.request()
            if self._current is not None:
                self._current.request("shutdown_now")
            return
        self._shutdown.request()

    def install_signal_handlers(self) -> None:
        """Handle SIGTERM/SIGINT where the platform provides them."""

        def _handle(signum: int, _frame: FrameType | None) -> None:
            _log.info("worker.signal", signal=int(signum))
            self.request_shutdown()

        for name in ("SIGTERM", "SIGINT"):
            sig = getattr(signal, name, None)
            if sig is not None:
                with contextlib.suppress(ValueError, OSError):
                    signal.signal(sig, _handle)

    async def run_forever(self) -> None:
        """Poll until shutdown is requested."""
        bind_worker(self.settings.worker_id)
        log_shape(
            "worker.started",
            capabilities=len(self.capabilities),
            handlers=len(self.registry.registered),
            poll_interval_seconds=self.settings.poll_interval_seconds,
        )
        while True:
            if self._shutdown.is_cancelled:
                break
            did_work = await self.run_once()
            if did_work:
                # Work arriving resets the idle backoff: a busy queue should be
                # polled promptly, an empty one should not be hammered.
                self._idle_seconds = self.settings.poll_interval_seconds
                continue
            if await self._shutdown.wait_or_timeout(self._idle_seconds):
                break
            self._idle_seconds = min(self._idle_seconds * 2, self.settings.idle_poll_max_seconds)
        _log.info("worker.stopped")

    async def run_once(self) -> bool:
        """Claim and run at most one task. Returns True if work was done."""
        try:
            claim = await self.api.claim(self.settings.worker_id, self.capabilities)
        except TransientApiError as error:
            # The API is unreachable or unwell. Back off; do not crash the loop.
            _log.warning("worker.claim_unavailable", reason=type(error).__name__)
            return False
        except ApiRequestError as error:
            _log.error("worker.claim_rejected", status=error.status_code, code=error.code)
            return False

        if claim is None:
            # 204: no work. Normal, not an error.
            return False

        await self._execute(claim)
        return True

    # -- one task ----------------------------------------------------------------

    async def _execute(self, claim: ClaimResponse) -> None:
        bind_task(claim.task_id, claim.type)
        state = _TaskState(lease_expires_at=claim.lease_expires_at)
        cancel = CancellationToken()
        self._current = cancel
        if self._hard_stop.is_cancelled:
            cancel.request("shutdown_now")

        def report(stage: str, percent: int) -> None:
            state.progress = TaskProgress(stage=stage[:120], percent=max(0, min(100, percent)))

        heartbeat = asyncio.create_task(self._heartbeat_loop(claim, state, cancel))
        try:
            await self._run_handler(claim, state, cancel, report)
        finally:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat
            self._current = None
            clear_task()

    async def _run_handler(
        self,
        claim: ClaimResponse,
        state: _TaskState,
        cancel: CancellationToken,
        report: Callable[[str, int], None],
    ) -> None:
        try:
            task_type = TaskType(claim.type)
            handler = self.registry.get(task_type)
            context = TaskContext(
                task_id=claim.task_id,
                task_type=task_type,
                attempt=claim.attempt,
                input=claim.input,
                files=tuple(claim.files),
                settings=self.settings,
                api=self.api,
                cancel=cancel,
                report_progress=report,
                lease_token=claim.lease_token,
            )
            result = await handler(context)
        except TaskCancelledError:
            await self._fail(
                claim,
                state,
                TaskFailureError(
                    "CANCELLED",
                    "The task was cancelled and stopped at its next safe checkpoint. "
                    "Nothing was partially applied.",
                    retryable=False,
                ),
            )
            return
        except LeaseLostError:
            self._abandon(claim, "lease lost while the handler was running")
            return
        except TaskFailureError as failure:
            await self._fail(claim, state, failure)
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            # The message must stay free of document text, so nothing from the
            # exception is forwarded; the traceback goes to the local log only.
            _log.exception("worker.handler_error", task_type=claim.type)
            await self._fail(
                claim,
                state,
                TaskFailureError(
                    "INTERNAL_ERROR",
                    "The worker hit an unexpected error while processing this task. "
                    "The details were logged locally and deliberately not included here.",
                    retryable=True,
                ),
            )
            return

        if state.lease_lost:
            self._abandon(claim, "lease lost before the result could be submitted")
            return

        try:
            ack = await self.api.complete(
                claim.task_id, claim.lease_token, result.model_dump(mode="json")
            )
        except LeaseLostError as error:
            # 409 on complete is terminal. Retrying could double-apply the work.
            _log.warning("worker.complete_conflict", reason=str(error))
            return
        except (TransientApiError, ApiRequestError) as error:
            _log.error("worker.complete_failed", reason=type(error).__name__)
            return
        log_shape("worker.completed", state=ack.state)

    async def _fail(
        self, claim: ClaimResponse, state: _TaskState, failure: TaskFailureError
    ) -> None:
        if state.lease_lost:
            self._abandon(claim, "lease lost before the failure could be reported")
            return
        try:
            await self.api.fail(claim.task_id, failure.to_fail_request(claim.lease_token))
        except LeaseLostError:
            self._abandon(claim, "lease lost while reporting a failure")
            return
        except (TransientApiError, ApiRequestError) as error:
            _log.error("worker.fail_failed", reason=type(error).__name__)
            return
        log_shape("worker.failed", code=failure.code, retryable=failure.retryable)

    def _abandon(self, claim: ClaimResponse, reason: str) -> None:
        """Walk away without completing. Another attempt owns this task now."""
        _log.warning("worker.abandoned", task_type=claim.type, reason=reason)

    # -- heartbeat ---------------------------------------------------------------

    async def _heartbeat_loop(
        self, claim: ClaimResponse, state: _TaskState, cancel: CancellationToken
    ) -> None:
        """Extend the lease and relay cancellation while the handler runs."""
        while True:
            await asyncio.sleep(self.heartbeat_seconds)

            if self._lease_expired(state):
                state.lease_lost = True
                cancel.request("lease_expired")
                _log.warning("worker.lease_expired")
                return

            try:
                response = await self.api.heartbeat(
                    claim.task_id, claim.lease_token, state.progress
                )
            except LeaseLostError:
                state.lease_lost = True
                cancel.request("lease_lost")
                _log.warning("worker.lease_lost")
                return
            except (TransientApiError, ApiRequestError) as error:
                # A single failed heartbeat is survivable; the lease clock above
                # is what decides when the work must stop.
                _log.warning("worker.heartbeat_failed", reason=type(error).__name__)
                continue

            state.heartbeats += 1
            state.lease_expires_at = response.lease_expires_at
            if response.cancel_requested and not state.cancel_requested:
                state.cancel_requested = True
                cancel.request("cancel_requested")
                _log.info("worker.cancel_requested")

    def _lease_expired(self, state: _TaskState) -> bool:
        if not state.lease_expires_at:
            return False
        try:
            return parse_timestamp(state.lease_expires_at) <= utc_now()
        except ValueError:  # pragma: no cover - the contract validates the shape
            return False
