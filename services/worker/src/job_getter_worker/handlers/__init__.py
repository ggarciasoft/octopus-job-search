"""Task handler registry.

A handler turns a claimed task into a validated result model. The registry maps
a generated :class:`TaskType` to exactly one handler, and startup refuses to
continue if the capabilities this worker advertises and the handlers it has do
not agree - a worker that claims work it cannot do just burns attempts.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

from ..cancellation import CancellationToken
from ..contracts.generated import TaskInputFile, TaskType
from ..errors import TaskFailureError

if TYPE_CHECKING:  # pragma: no cover - import cycle only matters to type checkers
    from ..api import TaskApiClient
    from ..settings import WorkerSettings


@dataclass(frozen=True)
class TaskContext:
    """Everything a handler is allowed to see.

    Deliberately narrow: a handler gets the task snapshot, its declared files
    and a cancellation token. It has no database, no workspace identity and no
    way to reach anything the task did not declare.
    """

    task_id: str
    task_type: TaskType
    attempt: int
    input: Any
    files: tuple[TaskInputFile, ...]
    settings: WorkerSettings
    api: TaskApiClient
    cancel: CancellationToken
    report_progress: Callable[[str, int], None]
    #: The task lease. It is a short-lived credential, so it is kept out of
    #: this dataclass's repr: a context that ends up in a log line or a
    #: traceback must not carry it there.
    lease_token: str = field(default="", repr=False)


TaskHandler = Callable[[TaskContext], Awaitable[BaseModel]]


class HandlerRegistry:
    """Task type -> handler, with the capability agreement check."""

    def __init__(self) -> None:
        self._handlers: dict[TaskType, TaskHandler] = {}

    def register(self, task_type: TaskType, handler: TaskHandler) -> None:
        if task_type in self._handlers:
            raise ValueError(f"a handler for {task_type.value} is already registered")
        self._handlers[task_type] = handler

    def get(self, task_type: TaskType) -> TaskHandler:
        """Look up a handler.

        An unknown task type is a failed *task*, never a crashed loop: the API
        may know about task types this build does not.
        """
        handler = self._handlers.get(task_type)
        if handler is None:
            raise TaskFailureError(
                "UNSUPPORTED_TASK_TYPE",
                f"This worker has no handler for task type {task_type.value!r}. "
                f"It implements {sorted(item.value for item in self._handlers)}.",
                retryable=False,
            )
        return handler

    @property
    def registered(self) -> tuple[TaskType, ...]:
        return tuple(sorted(self._handlers, key=lambda item: item.value))

    def assert_capabilities_supported(self, capabilities: tuple[TaskType, ...]) -> None:
        """Refuse to start when declared capabilities outrun the code.

        Raises:
            RuntimeError: if a declared capability has no handler.
        """
        missing = [item.value for item in capabilities if item not in self._handlers]
        if missing:
            raise RuntimeError(
                f"WORKER_CAPABILITIES declares {missing}, but this worker has no handler "
                f"for {'it' if len(missing) == 1 else 'them'}. It implements "
                f"{[item.value for item in self.registered]}. Claiming work this process "
                "cannot perform would fail every attempt and stall the queue."
            )


def build_default_registry() -> HandlerRegistry:
    """The handlers implemented as of M3."""
    from .fetch_board import handle_fetch_board
    from .fetch_job import handle_fetch_job
    from .match_job import handle_match_job
    from .noop_echo import handle_noop_echo
    from .parse_profile import handle_parse_profile

    registry = HandlerRegistry()
    registry.register(TaskType.NOOP_ECHO, handle_noop_echo)
    registry.register(TaskType.PARSE_PROFILE, handle_parse_profile)
    registry.register(TaskType.FETCH_BOARD, handle_fetch_board)
    registry.register(TaskType.FETCH_JOB, handle_fetch_job)
    registry.register(TaskType.MATCH_JOB, handle_match_job)
    return registry


__all__ = [
    "HandlerRegistry",
    "TaskContext",
    "TaskHandler",
    "build_default_registry",
]
