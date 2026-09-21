"""Failure codes and the exception handlers raise to report them.

The closed set of failure codes belongs to the generated ``FailRequest``
contract. It is *derived* here rather than restated, so the worker cannot drift
away from the API. ``docs/spec/04_API_CONTRACTS.md``: "Server, not worker,
decides whether retry is allowed" - ``retryable`` is the worker's honest
opinion, which the server is free to override.
"""

from __future__ import annotations

from typing import Any, Final, get_args

from .contracts.generated import FailRequest

#: Every failure code the API accepts, read straight off the generated model.
TASK_FAILURE_CODES: Final[tuple[str, ...]] = tuple(
    get_args(FailRequest.model_fields["code"].annotation)
)


class WorkerError(Exception):
    """Base class for worker failures that map onto a contract failure code."""


class TaskFailureError(WorkerError):
    """A handler failure that should be reported to the API with a code.

    Attributes:
        code: one of :data:`TASK_FAILURE_CODES`.
        retryable: whether *this worker* believes another attempt could succeed.
        redacted_message: an explanation safe to store and show. It must never
            contain document text, answers, prompts or credentials.
    """

    def __init__(self, code: str, redacted_message: str, *, retryable: bool = False) -> None:
        if code not in TASK_FAILURE_CODES:
            raise ValueError(
                f"{code!r} is not a failure code in the generated contract. "
                f"Valid codes: {TASK_FAILURE_CODES}"
            )
        super().__init__(f"{code}: {redacted_message}")
        self.code = code
        self.retryable = retryable
        # The contract caps this at 2000 characters; truncate rather than let a
        # failure report itself fail validation.
        self.redacted_message = redacted_message[:2000]

    def to_fail_request(self, lease_token: str) -> FailRequest:
        """Build the generated request model.

        ``model_validate`` is used so the closed ``Literal`` set in the contract
        does the checking, instead of this module restating it.
        """
        payload: dict[str, Any] = {
            "lease_token": lease_token,
            "code": self.code,
            "retryable": self.retryable,
            "redacted_message": self.redacted_message,
        }
        return FailRequest.model_validate(payload)


class BudgetExhaustedError(TaskFailureError):
    """A new request would exceed the configured daily budget.

    Never retryable: the cap does not move until the day's requests age out, so
    a second attempt would fail identically and spend an attempt doing it. It
    lives here rather than beside the arithmetic in ``providers/budget.py``
    because the authoritative refusal now arrives from the API, and
    :mod:`job_getter_worker.api` cannot import the provider package without a
    cycle. ``providers.budget`` re-exports it, so the name is unchanged for
    everything that already raised or caught it.
    """

    def __init__(self, message: str) -> None:
        super().__init__("BUDGET_EXHAUSTED", message, retryable=False)


class TaskCancelledError(WorkerError):
    """Raised at a safe checkpoint after the API requested cancellation.

    ``docs/spec/08_UX_AND_CUSTOMIZATION.md`` and the queue semantics in
    ``docs/spec/02_ARCHITECTURE.md`` agree: running work stops at its next safe
    checkpoint and leaves nothing half-applied.
    """


class LeaseLostError(WorkerError):
    """The lease is no longer ours.

    The API has already handed the task to another attempt, so the only correct
    action is to abandon the work without completing it. Completing with a stale
    token would be rejected with 409 anyway and must never be retried.
    """
