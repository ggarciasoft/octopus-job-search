"""The ``fetch_board`` handler (M2).

Pull one configured public board through its connector and return normalised
jobs. The one rule that matters more than any other here, from
``packages/contracts/src/tasks/fetch-board.ts``:

    complete_snapshot: True only when every page was fetched within limits and
    no request failed. A false value forbids closing jobs that were not seen.

So every early exit - a cap, a denial, a rate limit, a drift, a failed page,
a 304 - sets ``complete_snapshot=False``. A scan that returns fewer jobs than
exist and claims completeness would let the API close live postings (AT06),
which is worse than any amount of staleness.

The handler observes and reports; the API decides. ``observed_health`` is the
worker's reading of one scan; the API keeps the consecutive-failure count and
chooses the stored state.
"""

from __future__ import annotations

from ..clock import utc_now, utc_now_string
from ..connectors import Connector, ConnectorConfig, get_connector
from ..contracts.generated import (
    FetchBoardInput,
    FetchBoardResult,
    FetchBoardResultObservedHealth,
    FetchWarning,
    NormalizedJob,
)
from ..discovery import make_warning
from ..errors import TaskFailureError
from ..logging import log_shape
from ..net import (
    AccessDeniedError,
    Fetcher,
    FetchError,
    FetchUnavailableError,
    RateLimitedError,
    get_default_fetcher,
)
from ..net.fetch import fetch_error_to_task_failure
from . import TaskContext

#: The contract caps warnings at 100 per result.
_MAX_WARNINGS = 100


async def handle_fetch_board(
    ctx: TaskContext, *, fetcher: Fetcher | None = None
) -> FetchBoardResult:
    """Scan one board. See the module docstring for the completeness rule."""
    payload = FetchBoardInput.model_validate(ctx.input)
    active_fetcher = fetcher if fetcher is not None else get_default_fetcher()
    connector = get_connector(payload.connector, active_fetcher)
    config = ConnectorConfig(
        board_key=payload.board_key,
        base_url=payload.base_url,
        limits=payload.limits,
        etag=payload.etag,
        last_modified=payload.last_modified,
    )
    return await run_discovery(ctx, connector, config)


async def run_discovery(
    ctx: TaskContext, connector: Connector, config: ConnectorConfig
) -> FetchBoardResult:
    """Page through ``connector`` with cancellation checkpoints between pages."""
    limits = config.limits
    started = utc_now()
    jobs: list[NormalizedJob] = []
    warnings: list[FetchWarning] = []
    complete = True
    pages = 0
    cursor: str | None = None
    etag: str | None = None
    last_modified: str | None = None
    health_state = "ok"
    http_status: int | None = None
    retry_after: int | None = None
    next_cursor: str | None = None

    while True:
        # Safe checkpoint: nothing is half-applied between pages, because the
        # worker returns a result and the API applies it in one transaction.
        ctx.cancel.raise_if_cancelled()
        ctx.report_progress("fetching", min(95, 5 + int(90 * pages / max(1, limits.max_pages))))

        if pages >= limits.max_pages:
            warnings.append(
                make_warning(
                    "PAGE_LIMIT_REACHED",
                    f"Stopped after {limits.max_pages} pages; the board may have more. The "
                    "snapshot is incomplete and cannot be used to close jobs.",
                )
            )
            complete = False
            next_cursor = cursor
            break

        try:
            page = await connector.discover(
                config, cursor, retrieved_at=utc_now(), cancel=ctx.cancel
            )
        except AccessDeniedError as error:
            warnings.append(error.to_warning())
            complete, health_state, http_status = False, "blocked", error.http_status
            break
        except RateLimitedError as error:
            warnings.append(error.to_warning())
            complete, health_state, http_status = False, "degraded", error.http_status
            retry_after = error.retry_after_seconds
            break
        except FetchUnavailableError as error:
            if pages == 0:
                code, retryable, message = fetch_error_to_task_failure(error)
                raise TaskFailureError(code, message, retryable=retryable) from error
            # A later page failed: keep what was seen, but say it is partial.
            complete, health_state, http_status = False, "degraded", error.http_status
            log_shape("fetch_board.page_failed", page=pages + 1, kind=error.kind)
            break
        except FetchError as error:
            # SCHEMA_DRIFT, BLOCKED_DESTINATION, ROBOTS_DISALLOWED, REDIRECT_LIMIT,
            # CONTENT_TYPE_REJECTED, BODY_TRUNCATED: all carry a warning code.
            warnings.append(error.to_warning())
            complete = False
            health_state = "blocked" if error.code == "ROBOTS_DISALLOWED" else "degraded"
            http_status = error.http_status
            break

        pages += 1
        http_status = page.http_status
        etag = page.etag or etag
        last_modified = page.last_modified or last_modified
        warnings.extend(page.warnings)
        if page.duplicates_collapsed:
            log_shape("fetch_board.duplicates_collapsed", count=page.duplicates_collapsed)

        if page.not_modified:
            # Nothing was transferred. Zero jobs with complete_snapshot=True
            # would close every job on the board; the API reads NOT_MODIFIED
            # and keeps the previous snapshot instead.
            complete = False
            break

        room = limits.max_jobs - len(jobs)
        if len(page.jobs) > room:
            jobs.extend(page.jobs[:room])
            warnings.append(
                make_warning(
                    "JOB_LIMIT_REACHED",
                    f"Stopped after {limits.max_jobs} jobs; the board has more. The snapshot "
                    "is incomplete and cannot be used to close jobs.",
                )
            )
            complete = False
            next_cursor = page.next_cursor
            break
        jobs.extend(page.jobs)

        if page.next_cursor is None:
            break
        cursor = page.next_cursor

    ctx.report_progress("assembling", 97)
    log_shape(
        "fetch_board.completed",
        connector=connector.descriptor.id.value,
        pages=pages,
        jobs=len(jobs),
        complete_snapshot=complete,
        warnings=len(warnings),
        health=health_state,
        http_status=http_status,
        elapsed_ms=int((utc_now() - started).total_seconds() * 1000),
    )

    return FetchBoardResult(
        jobs=jobs,
        complete_snapshot=complete,
        next_cursor=next_cursor,
        pages_fetched=pages,
        etag=etag,
        last_modified=last_modified,
        observed_health=FetchBoardResultObservedHealth.model_validate(
            {"state": health_state, "http_status": http_status, "retry_after_seconds": retry_after}
        ),
        warnings=_dedupe(warnings)[:_MAX_WARNINGS],
        fetched_at=utc_now_string(),
    )


def _dedupe(warnings: list[FetchWarning]) -> list[FetchWarning]:
    """Collapse repeated identical warnings (one FIELD_INFERRED per field per job
    across a 1000-job board would drown the useful ones)."""
    seen: set[tuple[str, str, str | None]] = set()
    kept: list[FetchWarning] = []
    for warning in warnings:
        key = (warning.code, warning.message, warning.detail)
        if key in seen:
            continue
        seen.add(key)
        kept.append(warning)
    return kept


__all__ = ["handle_fetch_board", "run_discovery"]
