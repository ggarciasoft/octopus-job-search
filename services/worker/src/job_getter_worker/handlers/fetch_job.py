"""The ``fetch_job`` handler (M2).

Resolve one user-supplied URL or pasted description into a normalised job.

* **URL path.** The page is fetched through :mod:`job_getter_worker.net`
  under the task's policy (never looser than the contract's bounds), then
  read structured-data first: one JSON-LD ``JobPosting`` becomes ``job``;
  several become ``candidates`` with ``job=None`` and ``MULTIPLE_POSTINGS``,
  because choosing for the user would be a guess; none falls back to the
  page's sanitised text with ``NO_STRUCTURED_DATA``.
* **Pasted path.** No network. The text is normalised with
  ``extraction="pasted_text"`` and the user's company / title / apply URL are
  recorded exactly as given - they are the user's provenance, not an
  inference.

A blocked, disallowed, denied or rate-limited fetch is a *result* carrying the
warning, not a task failure: the UI offers paste mode instead, and nothing is
bypassed (``docs/spec/05_DISCOVERY_CONNECTORS.md``). Only transport failures
and timeouts fail the task, so the API can decide about a retry.
"""

from __future__ import annotations

from ..clock import utc_now
from ..contracts.generated import (
    FetchJobInput,
    FetchJobResult,
    FetchJobResultFetch,
    FetchWarning,
    NormalizedJob,
)
from ..discovery import (
    NormalizedResult,
    RawJob,
    extract_job_postings,
    html_title,
    html_to_text,
    make_warning,
    normalize_job,
    plain_text,
    url_identity,
)
from ..discovery.jobposting import MAX_CANDIDATES
from ..errors import TaskFailureError
from ..logging import log_shape
from ..net import (
    HTML_CONTENT_TYPES,
    Fetcher,
    FetchError,
    FetchPolicy,
    FetchResult,
    FetchUnavailableError,
    get_default_fetcher,
)
from ..net.fetch import fetch_error_to_task_failure
from ..net.policy import BlockedAddressError, validate_url
from . import TaskContext

#: Placeholders for fields the contract requires but the user did not give.
#: They are visibly not data, and the API/UI is expected to ask the user.
COMPANY_PLACEHOLDER = "(company not stated)"
TITLE_PLACEHOLDER = "(untitled)"
#: Identity prefix for pasted jobs: ``manual:<content_hash>``. Agreed with the
#: API, which keys a pasted job by exactly this string.
MANUAL_PREFIX = "manual:"


async def handle_fetch_job(ctx: TaskContext, *, fetcher: Fetcher | None = None) -> FetchJobResult:
    payload = FetchJobInput.model_validate(ctx.input)
    has_url = bool(payload.url and payload.url.strip())
    has_text = bool(payload.description_text and payload.description_text.strip())
    if has_url == has_text:
        raise TaskFailureError(
            "INPUT_INVALID",
            "A job import needs exactly one of a URL or a pasted description.",
        )
    if has_text:
        return _from_pasted_text(payload)
    active = fetcher if fetcher is not None else get_default_fetcher()
    return await _from_url(ctx, payload, active)


# ---------------------------------------------------------------------------
# pasted text


def _from_pasted_text(payload: FetchJobInput) -> FetchJobResult:
    """Normalise pasted text. Identity is ``manual:<content_hash>``.

    There is no page URL, so ``canonical_url`` and ``source_key`` are the
    deterministic ``manual:<content_hash>`` placeholder the API keys pasted
    jobs by - not an invented https URL. The hash is computed by the
    normaliser from the content, so the job is normalised once with a
    provisional identity and the identity is then filled in from the hash
    (``canonical_url`` is not an input to the hash).
    """
    text = plain_text(payload.description_text or "")
    apply_url = _https_or_none(payload.apply_url_hint)
    raw = RawJob(
        external_id=MANUAL_PREFIX,
        source_key=MANUAL_PREFIX,
        canonical_url=MANUAL_PREFIX,
        apply_url=apply_url,
        company=payload.company_hint or COMPANY_PLACEHOLDER,
        title=payload.title_hint or TITLE_PLACEHOLDER,
        description_text=text,
        retrieved_at=utc_now(),
    )
    provisional = normalize_job(raw)
    identity = f"{MANUAL_PREFIX}{provisional.job.content_hash}"
    normalised = NormalizedResult(
        job=provisional.job.model_copy(
            update={"external_id": identity, "source_key": identity, "canonical_url": identity}
        ),
        warnings=provisional.warnings,
    )
    log_shape(
        "fetch_job.pasted",
        chars=len(text),
        inferred=len(normalised.job.inferred),
        warnings=len(normalised.warnings),
    )
    return FetchJobResult(
        job=normalised.job,
        candidates=[],
        fetch=FetchJobResultFetch(
            performed=False,
            final_url=None,
            http_status=None,
            content_type=None,
            bytes=None,
            redirects=0,
            extraction="pasted_text",
        ),
        warnings=normalised.warnings,
    )


# ---------------------------------------------------------------------------
# URL


async def _from_url(ctx: TaskContext, payload: FetchJobInput, fetcher: Fetcher) -> FetchJobResult:
    url = (payload.url or "").strip()
    policy = FetchPolicy.from_job_policy(payload.policy)
    ctx.report_progress("fetching", 10)

    try:
        result = await fetcher.fetch(
            url,
            policy=policy,
            accepted_content_types=HTML_CONTENT_TYPES,
            cancel=ctx.cancel,
        )
    except FetchUnavailableError as error:
        code, retryable, message = fetch_error_to_task_failure(error)
        raise TaskFailureError(code, message, retryable=retryable) from error
    except FetchError as error:
        log_shape("fetch_job.refused", code=error.code, http_status=error.http_status)
        return FetchJobResult(
            job=None,
            candidates=[],
            fetch=FetchJobResultFetch(
                performed=True,
                final_url=None,
                http_status=error.http_status,
                content_type=None,
                bytes=None,
                redirects=0,
                extraction="none",
            ),
            warnings=[error.to_warning()],
        )

    ctx.cancel.raise_if_cancelled()
    ctx.report_progress("extracting", 60)

    markup = result.text()
    if result.content_type == "application/ld+json":
        # A bare JSON-LD document: wrap it so the same extractor reads it.
        markup = f'<script type="application/ld+json">{markup}</script>'

    extraction = extract_job_postings(
        markup,
        page_url=result.final_url,
        retrieved_at=utc_now(),
        company_hint=payload.company_hint,
        title_hint=payload.title_hint,
        apply_url_hint=_https_or_none(payload.apply_url_hint),
    )
    warnings: list[FetchWarning] = list(extraction.warnings)

    if len(extraction.jobs) == 1:
        normalised = normalize_job(extraction.jobs[0])
        warnings.extend(normalised.warnings)
        return _result(result, "jsonld_jobposting", job=normalised.job, warnings=warnings)

    if len(extraction.jobs) > 1:
        candidates: list[NormalizedJob] = []
        for raw in extraction.jobs[:MAX_CANDIDATES]:
            normalised = normalize_job(raw)
            candidates.append(normalised.job)
            warnings.extend(normalised.warnings)
        warnings.append(
            make_warning(
                "MULTIPLE_POSTINGS",
                f"The page describes {len(candidates)} postings. Choose the one you mean; "
                "none was selected automatically.",
            )
        )
        return _result(result, "jsonld_jobposting", candidates=candidates, warnings=warnings)

    # No structured posting: the page's text, clearly marked as such.
    text = html_to_text(markup)
    warnings.append(
        make_warning(
            "NO_STRUCTURED_DATA",
            "The page has no JSON-LD JobPosting, so the visible text was read instead. "
            "Review the title, company and description before relying on them.",
        )
    )
    if not text.strip():
        return _result(result, "none", warnings=warnings)

    external_id, source_key = url_identity(result.final_url)
    raw = RawJob(
        external_id=external_id,
        source_key=source_key,
        canonical_url=result.final_url,
        apply_url=_https_or_none(payload.apply_url_hint),
        company=payload.company_hint or COMPANY_PLACEHOLDER,
        title=payload.title_hint or html_title(markup) or TITLE_PLACEHOLDER,
        description_text=text,
        retrieved_at=utc_now(),
    )
    normalised = normalize_job(raw)
    warnings.extend(normalised.warnings)
    return _result(result, "html_text", job=normalised.job, warnings=warnings)


def _result(
    fetched: FetchResult,
    extraction: str,
    *,
    job: NormalizedJob | None = None,
    candidates: list[NormalizedJob] | None = None,
    warnings: list[FetchWarning],
) -> FetchJobResult:
    log_shape(
        "fetch_job.completed",
        extraction=extraction,
        status=fetched.status,
        body_bytes=fetched.bytes,
        redirects=fetched.redirects,
        candidates=len(candidates or []),
        has_job=job is not None,
        warnings=len(warnings),
    )
    return FetchJobResult(
        job=job,
        candidates=candidates or [],
        fetch=FetchJobResultFetch.model_validate(
            {
                "performed": True,
                "final_url": fetched.final_url[:2000],
                "http_status": fetched.status,
                "content_type": (fetched.content_type or "")[:120] or None,
                "bytes": fetched.bytes,
                "redirects": fetched.redirects,
                "extraction": extraction,
            }
        ),
        warnings=warnings[:100],
    )


def _https_or_none(value: str | None) -> str | None:
    """A user hint is kept only if it is a well-formed public HTTPS URL."""
    if not value or not value.strip():
        return None
    try:
        validate_url(value)
    except BlockedAddressError:
        return None
    return value.strip()


__all__ = ["COMPANY_PLACEHOLDER", "TITLE_PLACEHOLDER", "handle_fetch_job"]
