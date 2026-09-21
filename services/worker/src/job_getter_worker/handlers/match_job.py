"""The ``match_job`` handler (M3).

Score one job against the confirmed profile and the user's preferences.

The handler itself is thin on purpose: validate the input, run the
deterministic matcher, log the shape of what came out. All the judgement lives
in :mod:`job_getter_worker.matching`, where it can be unit-tested without a
task, a lease or an API.

Unlike every other handler here this one touches nothing external. No fetch, no
provider, no file download - so it cannot be rate-limited, cannot leak the job
text anywhere, and cannot fail for a reason outside its own input. A malformed
input is the only failure it has, and that is not retryable: the same bytes
would fail the same way on the next attempt.
"""

from __future__ import annotations

from pydantic import ValidationError

from ..contracts.generated import MatchJobInput, MatchJobResult
from ..errors import TaskFailureError
from ..logging import log_shape
from ..matching import compute_match
from . import TaskContext


async def handle_match_job(ctx: TaskContext) -> MatchJobResult:
    """Validate the snapshot and score it."""
    try:
        payload = MatchJobInput.model_validate(ctx.input)
    except ValidationError as error:
        raise TaskFailureError(
            "INPUT_INVALID",
            "The match input did not match the contract, so nothing was scored.",
            retryable=False,
        ) from error

    ctx.cancel.raise_if_cancelled()
    ctx.report_progress("scoring", 50)

    result = compute_match(payload)

    ctx.cancel.raise_if_cancelled()
    log_shape(
        "match_job.completed",
        # Shapes and counts only: the job text and the user's facts are not
        # log material, and the score on its own says nothing identifying.
        eligible=result.eligible,
        has_score=result.score is not None,
        coverage_percent=result.coverage_percent,
        requirement_count=len(result.explanation.requirements),
        unknown_component_count=len(result.explanation.unknown_components),
        confirmed_fact_count=len(payload.confirmed_facts),
    )
    ctx.report_progress("scored", 100)
    return result
