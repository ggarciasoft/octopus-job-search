"""Driving one approved packet into one employer's form.

The order of operations is the spec's, and every step can only ever stop the
run, never widen it:

1. **Recheck what the API told us.** "Runner claims only its owner's fill_local
   work and rechecks origin, packet approval, job identity and duplicate
   state." The device id, the destination origin and the allowed-origin set are
   all verified here before a browser opens, because a runner that trusts its
   input is a runner that fills whatever it is handed.
2. **Pick an adapter, or stop.** Only tested adapters exist. No adapter means
   the ``unsupported`` outcome: the user's packet is kept and they are told to
   apply themselves (AT17).
3. **Check the page is the job.** A page whose stated employer or role is not
   the packet's is a hard failure, not a pause. Nothing is typed.
4. **Inspect, then plan, then fill.** Planning is the pure function in
   :mod:`job_getter_worker.runner.plan`; this module only carries out what it
   decided.
5. **Stop before submit.** There is no code path here that clicks a submit
   control. The best outcome is a filled form and a person looking at it.
"""

from __future__ import annotations

import hashlib
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from ..contracts.generated import FilledField, FillLocalInput, FillLocalResult
from ..errors import TaskFailureError
from ..logging import get_logger, log_shape
from .adapters import ADAPTERS, Adapter, adapter_named, check_identity, parse_identity
from .browser import NavigationBlockedError, RunnerBrowser, origin_of
from .forms import CHOICE_KINDS, FieldKind, FormSchema
from .plan import FillPlan, PlannedValue, build_plan

if TYPE_CHECKING:  # pragma: no cover - typing only
    from playwright.async_api import Page

_log = get_logger(__name__)


@dataclass(frozen=True)
class FillContext:
    """Everything the driver needs that is not the page."""

    payload: FillLocalInput
    #: The CV on disk, already downloaded through the lease-scoped endpoint.
    attachment: Path | None
    #: This runner's own device id, from its paired token.
    device_id: str


def assert_authorised(context: FillContext) -> None:
    """Refuse work that is not this runner's, or not for where it says.

    The API checked all of this. Checking it again is not redundancy for its
    own sake: the runner is the process with a browser and the user's sessions,
    and it is the last place that can refuse.
    """
    payload = context.payload
    if payload.device_id != context.device_id:
        raise TaskFailureError(
            "INPUT_INVALID",
            "This fill was assigned to a different paired device.",
            retryable=False,
        )
    allowed = tuple(payload.allowed_origins)
    if not allowed:
        raise TaskFailureError(
            "INPUT_INVALID",
            "This fill names no permitted origin, so there is nowhere it may go.",
            retryable=False,
        )
    if payload.destination.origin not in allowed:
        raise TaskFailureError(
            "INPUT_INVALID",
            "The destination is outside the origins this fill was authorised for.",
            retryable=False,
        )
    if origin_of(payload.destination.url) != payload.destination.origin:
        raise TaskFailureError(
            "INPUT_INVALID",
            "The destination URL does not belong to the origin it declares.",
            retryable=False,
        )


async def choose_adapter(page: Page, url: str, hint: str | None) -> Adapter | None:
    """The hinted adapter if it claims the page, otherwise the first that does."""
    candidates: list[Adapter] = []
    hinted = adapter_named(hint)
    if hinted is not None:
        candidates.append(hinted)
    candidates.extend(adapter for adapter in ADAPTERS if adapter is not hinted)

    for adapter in candidates:
        marker = bool(await page.evaluate(adapter.marker_script))
        if adapter.handles(url, marker):
            return adapter
    return None


async def inspect_page(page: Page, adapter: Adapter) -> FormSchema:
    return adapter.parse_inspection(await page.evaluate(adapter.inspect_script))


async def verify_identity(page: Page, adapter: Adapter, payload: FillLocalInput) -> None:
    identity = parse_identity(
        await page.evaluate(adapter.identity_script), page.url, origin_of(page.url)
    )
    verdict = check_identity(identity, payload.job.company, payload.job.title)
    if not verdict.matches:
        raise TaskFailureError(
            "INPUT_INVALID",
            f"Nothing was filled: {verdict.reason}.",
            retryable=False,
        )


async def apply_plan(page: Page, plan: FillPlan, attachment: Path | None) -> list[FilledField]:
    """Type the planned values. One failure does not abandon the rest."""
    outcomes: list[FilledField] = []
    for planned in plan.values:
        try:
            await _apply_one(page, planned, attachment)
        except Exception as error:  # one bad control must not abandon the rest
            _log.warning("runner.field_failed", key=planned.field.key, error=type(error).__name__)
            outcomes.append(
                FilledField(
                    question_key=planned.field.key,
                    outcome="failed",
                    matched_label=planned.field.label or None,
                )
            )
            continue
        outcomes.append(
            FilledField(
                question_key=planned.field.key,
                outcome="filled",
                matched_label=planned.field.label or None,
            )
        )
    return outcomes


def _submit_value(planned: PlannedValue, option_label: str) -> str:
    """The value a control needs for an option the user reads as `option_label`."""
    field = planned.field
    try:
        index = field.options.index(option_label)
    except ValueError:  # pragma: no cover - the planner only emits real options
        return option_label
    if index < len(field.option_values):
        return field.option_values[index]
    return option_label


async def _apply_one(page: Page, planned: PlannedValue, attachment: Path | None) -> None:
    field = planned.field
    if planned.upload:
        if attachment is None:  # pragma: no cover - the planner guards this
            raise RuntimeError("no attachment to upload")
        await page.set_input_files(field.selector, str(attachment))
        return

    if field.kind is FieldKind.SELECT:
        await page.select_option(field.selector, value=_submit_value(planned, planned.values[0]))
        return

    if field.kind in CHOICE_KINDS:
        for option_label in planned.values:
            value = _submit_value(planned, option_label)
            await page.check(f'{field.selector}[value="{value}"]')
        return

    await page.fill(field.selector, planned.values[0])


async def run_fill(page: Page, context: FillContext) -> FillLocalResult:
    """Inspect, plan, fill, and stop. Never submit."""
    payload = context.payload
    adapter = await choose_adapter(page, page.url, payload.adapter)

    if adapter is None:
        # AT17. Nothing was typed, the packet is untouched, and the honest
        # answer is that this page has no tested adapter.
        log_shape("runner.unsupported_page", origin=payload.destination.origin)
        return FillLocalResult(
            packet_id=payload.packet_id,
            filled_fields=[],
            unresolved_fields=[],
            page_url=page.url,
            form_fingerprint=None,
            outcome="unsupported",
            adapter=None,
            adapter_version=None,
            screenshot_file_id=None,
        )

    await verify_identity(page, adapter, payload)

    schema = await inspect_page(page, adapter)
    plan = build_plan(schema.fields, payload.fields, has_attachment=context.attachment is not None)
    filled = await apply_plan(page, plan, context.attachment)

    # The generated result model types `outcome` as a Literal, so these are
    # written as the contract's own strings rather than as an enum.
    outcome: Literal["needs_input", "awaiting_user_submit"] = (
        "needs_input" if plan.has_unresolved_required else "awaiting_user_submit"
    )
    log_shape(
        "runner.fill_finished",
        outcome=outcome,
        field_count=len(schema.fields),
        filled_count=sum(1 for item in filled if item.outcome == "filled"),
        unresolved_count=len(plan.unresolved),
    )
    return FillLocalResult(
        packet_id=payload.packet_id,
        filled_fields=filled,
        unresolved_fields=list(plan.unresolved),
        page_url=page.url,
        form_fingerprint=schema.fingerprint,
        outcome=outcome,
        adapter=adapter.name,
        adapter_version=adapter.version,
        # Evidence capture is opt-in and off by default
        # (`consented_evidence_capture: false`), so v1 never takes one.
        screenshot_file_id=None,
    )


async def download_attachment(ctx: Any, payload: FillLocalInput) -> Path | None:
    """Fetch the CV through the lease-scoped endpoint, into a temporary file.

    Only a file the task *declared* can be fetched, and only with the active
    lease: the runner cannot reach any other document in the workspace, and the
    bytes it uploads are the bytes the packet's hash covers.
    """
    if payload.resume_file_id is None:
        return None
    declared = {item.file_id: item for item in ctx.files}
    meta = declared.get(payload.resume_file_id)
    if meta is None:
        raise TaskFailureError(
            "INPUT_INVALID",
            "The packet names a CV this task did not declare as an input.",
            retryable=False,
        )
    data = await ctx.api.download_input_file(
        ctx.task_id,
        payload.resume_file_id,
        lease_token=ctx.lease_token,
        max_bytes=ctx.settings.max_download_bytes,
    )
    if payload.resume_sha256 is not None:
        actual = hashlib.sha256(data).hexdigest()
        if actual != payload.resume_sha256:
            # The approved packet binds this hash. Different bytes are a
            # different CV, and sending one the user did not approve is the
            # failure this whole mechanism exists to prevent.
            raise TaskFailureError(
                "INPUT_INVALID",
                "The CV on the server is not the one this packet was approved with.",
                retryable=False,
            )
    directory = Path(tempfile.mkdtemp(prefix="job-getter-fill-"))
    name = payload.resume_filename or "cv.pdf"
    target = directory / Path(name).name
    target.write_bytes(data)
    return target


def build_fill_handler(
    browser: RunnerBrowser,
    device_id: str,
    *,
    fetch_attachment: Any = download_attachment,
    keep_page_open: bool = True,
) -> Any:
    """Bind the driver to a browser and return a task handler.

    `keep_page_open` is true in the product and false in tests. The whole point
    of the runner is that the user is left looking at a filled form in a real
    window; closing it the moment the task completes would take the form away
    from the person who has to submit it.
    """

    async def handler(ctx: Any) -> FillLocalResult:
        payload = FillLocalInput.model_validate(ctx.input)
        attachment = await fetch_attachment(ctx, payload)
        context = FillContext(payload=payload, attachment=attachment, device_id=device_id)
        assert_authorised(context)

        ctx.report_progress("opening the page", 10)
        try:
            page = await browser.open(payload.destination.url, tuple(payload.allowed_origins))
        except NavigationBlockedError as error:
            raise TaskFailureError("INPUT_INVALID", str(error), retryable=False) from error

        try:
            ctx.cancel.raise_if_cancelled()
            ctx.report_progress("reading the form", 40)
            result = await run_fill(page, context)
            ctx.report_progress("waiting for you", 100)
            return result
        finally:
            if not keep_page_open:
                await page.close()

    return handler
