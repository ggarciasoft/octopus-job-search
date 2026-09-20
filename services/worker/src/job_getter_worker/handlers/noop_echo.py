"""The M0 end-to-end probe.

``noop_echo`` exists so the whole path - web -> API -> queued task -> Python ->
stored result -> UI - can be proved before any real processing exists
(``docs/spec/12_IMPLEMENTATION_PLAN.md`` -> M0).

It is also the only task type that can be made to wait or fail on demand, which
is what makes the cancellation and failure paths genuinely exercisable rather
than merely written down.
"""

from __future__ import annotations

import platform

from ..clock import utc_now_string
from ..contracts.generated import NoopEchoInput, NoopEchoResult
from ..errors import TaskFailureError
from ..logging import log_shape
from . import TaskContext

#: How long a single cancellable slice of ``delay_ms`` lasts. Short enough that
#: a cancel request is honoured promptly, long enough not to spin.
_SLICE_SECONDS = 0.05


async def handle_noop_echo(ctx: TaskContext) -> NoopEchoResult:
    """Echo the input back, optionally slowly, optionally failing."""
    payload = NoopEchoInput.model_validate(ctx.input)

    if payload.fail_with is not None:
        # Deterministic failure for protocol tests. The code is validated
        # against the generated contract by TaskFailureError itself, so an unknown
        # value fails loudly here rather than being posted to the API.
        raise TaskFailureError(
            payload.fail_with,
            "noop_echo was asked to fail deterministically for testing.",
            retryable=False,
        )

    delay_seconds = (payload.delay_ms or 0) / 1000
    waited = 0.0
    while waited < delay_seconds:
        # Safe checkpoint: nothing is half-applied between slices.
        ctx.cancel.raise_if_cancelled()
        slice_seconds = min(_SLICE_SECONDS, delay_seconds - waited)
        await ctx.cancel.sleep(slice_seconds)
        waited += slice_seconds
        if delay_seconds > 0:
            ctx.report_progress("sleeping", min(99, int(100 * waited / delay_seconds)))

    ctx.cancel.raise_if_cancelled()
    log_shape("noop_echo.completed", message_chars=len(payload.message), delay_ms=payload.delay_ms)

    return NoopEchoResult(
        echoed=payload.message,
        worker_id=ctx.settings.worker_id,
        worker_runtime=f"{platform.python_implementation()} {platform.python_version()}",
        processed_at=utc_now_string(),
    )
