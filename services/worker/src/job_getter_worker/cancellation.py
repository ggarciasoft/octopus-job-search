"""Cooperative cancellation.

The worker never kills a handler mid-step. A heartbeat that returns
``cancel_requested`` sets this token; the handler notices at its next
checkpoint, unwinds, and the task is failed with ``CANCELLED``. That is what
"running work stops at its next safe checkpoint" means in practice, and it is
why a half-applied result cannot happen.
"""

from __future__ import annotations

import asyncio

from .errors import TaskCancelled


class CancellationToken:
    """A one-way flag a handler polls at safe checkpoints.

    The flag is set from the event loop (heartbeat task or signal handler) and
    may be *read* from a worker thread doing extraction, which is safe because
    reading it is a single boolean load.
    """

    def __init__(self, reason: str = "cancel_requested") -> None:
        self._event = asyncio.Event()
        self._reason = reason

    @property
    def is_cancelled(self) -> bool:
        return self._event.is_set()

    @property
    def reason(self) -> str:
        return self._reason

    def request(self, reason: str | None = None) -> None:
        """Ask the handler to stop. Idempotent."""
        if reason is not None and not self._event.is_set():
            self._reason = reason
        self._event.set()

    def raise_if_cancelled(self) -> None:
        """The checkpoint itself.

        Handlers call this between steps, never in the middle of one.
        """
        if self._event.is_set():
            raise TaskCancelled(self._reason)

    async def sleep(self, seconds: float) -> None:
        """Sleep, returning early and raising if cancellation is requested.

        A handler that slept uninterruptibly would make cancellation a lie, so
        every wait in the worker goes through here.
        """
        if seconds <= 0:
            self.raise_if_cancelled()
            return
        try:
            await asyncio.wait_for(self._event.wait(), timeout=seconds)
        except TimeoutError:
            return
        raise TaskCancelled(self._reason)

    async def wait_or_timeout(self, seconds: float) -> bool:
        """Wait up to ``seconds``; return True if cancellation was requested.

        Used by the poll loop, which wants to stop sleeping on shutdown without
        treating shutdown as a task failure.
        """
        if seconds <= 0:
            return self._event.is_set()
        try:
            await asyncio.wait_for(self._event.wait(), timeout=seconds)
        except TimeoutError:
            return False
        return True
