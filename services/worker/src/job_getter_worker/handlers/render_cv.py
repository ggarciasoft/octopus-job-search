"""The ``render_cv`` handler (M3, PR07).

The order of operations is the design:

1. **Build a true document deterministically** from the confirmed facts. This
   is the floor. A workspace with no provider configured stops here and gets a
   real CV, so the feature works with no AI at all.
2. **Optionally ask a model to present it better.** The model may reorder,
   shorten and re-emphasise. It is given the true document rather than a blank
   page, because a blank page is where inventions come from.
3. **Validate whatever came back against the confirmed facts**, and drop what
   fails. A model's output is untrusted data like any other (invariant 9); if
   it comes back unusable, the deterministic document is used instead and the
   result says so.
4. **Render both formats** from the one validated document, so the DOCX and
   the PDF cannot disagree about what the user is sending.

The task never marks anything approved. Approval is a user action on a
document they have read, and generating a CV is not evidence that anyone read
it (06_AI_PROFILE_AND_CV.md: user approval is mandatory).
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from ..contracts.generated import (
    RESUME_TEMPLATE_VERSION,
    ProfileFact,
    RenderCvInput,
    RenderCvResult,
    ResumeDocument,
    ResumeFinding,
    ResumeProvenance,
    ResumeValidation,
)
from ..errors import TaskFailureError
from ..logging import log_shape
from ..prompts.render_cv import RENDER_CV_PROMPT_VERSION, build_render_cv_prompt
from ..providers import build_budget, build_provider, estimate_tokens
from ..providers.base import ModelProvider, ProviderInvalidOutputError
from ..resume.document import build_document
from ..resume.docx_render import render_docx
from ..resume.pdf_render import render_pdf
from ..resume.validation import validate_document
from . import TaskContext

#: The closed schema the provider must satisfy: the document's own.
DOCUMENT_JSON_SCHEMA: dict[str, Any] = ResumeDocument.model_json_schema()


def _finding(code: str, where: str | None, excerpt: str | None) -> ResumeFinding:
    from ..resume.validation import BLOCKING_CODES

    return ResumeFinding(
        code=code,  # type: ignore[arg-type]
        severity="blocking" if code in BLOCKING_CODES else "warning",
        where=where,
        excerpt=excerpt,
        removed=False,
    )


def _validate_model_document(payload: Any) -> dict[str, Any]:
    """Shape check applied inside the provider's own correction loop."""
    if not isinstance(payload, dict):
        raise ProviderInvalidOutputError("The model did not return a JSON object.")
    try:
        ResumeDocument.model_validate(payload)
    except ValidationError as error:
        raise ProviderInvalidOutputError(
            f"Not a resume document: {error.error_count()} problem(s)."
        ) from error
    return payload


async def _tailor(
    ctx: TaskContext,
    provider: ModelProvider,
    baseline: ResumeDocument,
    payload: RenderCvInput,
) -> tuple[ResumeDocument, list[ResumeFinding], str | None, str | None]:
    """Ask the model to re-present the true document.

    Returns the document to validate, any findings, and the provider/model
    identifiers for the provenance record. A model that fails, times out or
    returns something unusable costs the user nothing: the baseline is already
    a real CV.
    """
    job = payload.job
    prompt = build_render_cv_prompt(
        baseline.model_dump(mode="json"),
        language=payload.language,
        job_title=job.title if job else None,
        job_company=job.company if job else None,
        requirements=[requirement.text for requirement in job.requirements] if job else [],
        style_suffix=payload.prompt_style_suffix,
    )

    budget = build_budget(ctx.settings)
    reservation = budget.reserve(
        estimate_tokens(prompt.text), ctx.settings.provider_output_token_limit
    )
    try:
        generation = await provider.generate_structured(
            schema=DOCUMENT_JSON_SCHEMA,
            prompt=prompt.text,
            limits=ctx.settings.provider_limits,
            validate=_validate_model_document,
            prompt_version=prompt.version,
        )
    except BaseException:
        budget.release(reservation)
        raise

    settled = budget.settle(reservation, generation.usage)
    log_shape(
        "render_cv.model_usage",
        provider=generation.metadata.provider_id,
        structured_output=generation.metadata.structured_output,
        input_tokens=settled.input_tokens,
        output_tokens=settled.output_tokens,
        cost_known=not settled.cost_is_unknown,
    )

    findings: list[ResumeFinding] = []
    if generation.metadata.correction_attempts > 0:
        findings.append(_finding("MODEL_CORRECTED_ONCE", None, None))

    try:
        tailored = ResumeDocument.model_validate(generation.parsed)
    except ValidationError:
        # Unusable output is not a failed task: the true document already
        # exists, so the user gets a CV and a finding explaining what happened.
        findings.append(
            _finding(
                "MODEL_OUTPUT_REJECTED", None, "The model's document did not match the schema."
            )
        )
        return baseline, findings, generation.metadata.provider_id, generation.metadata.model

    # The model does not get to rewrite who the person is or which language the
    # document is in. Those come back from the baseline regardless.
    tailored = tailored.model_copy(
        update={
            "schema_version": 1,
            "language": baseline.language,
            "contact": baseline.contact,
        }
    )
    return tailored, findings, generation.metadata.provider_id, generation.metadata.model


async def handle_render_cv(ctx: TaskContext) -> RenderCvResult:
    """Generate a reviewable CV in both formats."""
    try:
        payload = RenderCvInput.model_validate(ctx.input)
    except ValidationError as error:
        raise TaskFailureError(
            "INPUT_INVALID",
            "The CV input did not match the contract, so nothing was generated.",
            retryable=False,
        ) from error

    ctx.cancel.raise_if_cancelled()
    ctx.report_progress("assembling", 10)

    facts: list[ProfileFact] = list(payload.confirmed_facts)
    requirements = list(payload.job.requirements) if payload.job else []
    baseline = build_document(facts, payload.language, requirements)

    findings: list[ResumeFinding] = []
    provider_id: str | None = None
    model_name: str | None = None
    deterministic = True

    provider = build_provider(ctx.settings)
    if provider is None:
        # Not a failure. The deterministic document is a real CV; it is simply
        # not tailored, and the result says exactly that.
        findings.append(_finding("NO_PROVIDER_CONFIGURED", None, None))
        document = baseline
    else:
        ctx.report_progress("tailoring", 35)
        try:
            document, tailor_findings, provider_id, model_name = await _tailor(
                ctx, provider, baseline, payload
            )
            findings.extend(tailor_findings)
            deterministic = False
        finally:
            await provider.aclose()

    ctx.cancel.raise_if_cancelled()
    ctx.report_progress("validating", 55)

    outcome = validate_document(document, facts)
    findings.extend(outcome.findings)
    document = outcome.document

    ctx.cancel.raise_if_cancelled()
    ctx.report_progress("rendering", 70)

    docx_bytes = render_docx(document)
    rendered_pdf = await render_pdf(document)
    if rendered_pdf.unavailable_reason is not None:
        # The DOCX still exists, so this is a warning rather than a failure:
        # the UI offers the format that was actually produced instead of a
        # download button that would fail when pressed.
        findings.append(_finding("PDF_UNAVAILABLE", None, rendered_pdf.unavailable_reason))
        log_shape("render_cv.pdf_unavailable", reason=rendered_pdf.unavailable_reason)

    if rendered_pdf.pages is not None and rendered_pdf.pages > payload.page_target:
        # Overflow is an editable warning, never a silent truncation and never
        # a font shrunk below the readable minimum.
        findings.append(
            _finding(
                "PAGE_OVERFLOW",
                None,
                f"{rendered_pdf.pages} pages rendered against a target of {payload.page_target}.",
            )
        )

    ctx.cancel.raise_if_cancelled()
    ctx.report_progress("uploading", 85)

    stem = "cv"
    docx_upload = await ctx.api.upload_artifact(
        ctx.task_id,
        ctx.lease_token,
        filename=f"{stem}.docx",
        content=docx_bytes,
        content_type=("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    )
    docx_file_id = docx_upload.file_id
    pdf_file_id: str | None = None
    if rendered_pdf.pdf is not None:
        pdf_upload = await ctx.api.upload_artifact(
            ctx.task_id,
            ctx.lease_token,
            filename=f"{stem}.pdf",
            content=rendered_pdf.pdf,
            content_type="application/pdf",
        )
        pdf_file_id = pdf_upload.file_id

    validation = ResumeValidation(
        passed_automatic_checks=not any(f.severity == "blocking" for f in findings),
        findings=findings,
        fact_ids=outcome.fact_ids,
        provenance=ResumeProvenance(
            template_version=RESUME_TEMPLATE_VERSION,
            prompt_version=None if deterministic else RENDER_CV_PROMPT_VERSION,
            provider=provider_id,
            model=model_name,
            deterministic=deterministic,
        ),
        pdf_pages=rendered_pdf.pages,
    )

    log_shape(
        "render_cv.completed",
        # Shapes only: no bullet text, no employer, no name.
        sections=len(document.sections),
        entries=sum(len(section.entries) for section in document.sections),
        findings=len(findings),
        blocking=sum(1 for f in findings if f.severity == "blocking"),
        deterministic=deterministic,
        pdf=pdf_file_id is not None,
        pages=rendered_pdf.pages,
    )
    ctx.report_progress("done", 100)

    return RenderCvResult(
        document_json=document,
        validation=validation,
        pdf_file_id=pdf_file_id,
        docx_file_id=docx_file_id,
        fact_ids=outcome.fact_ids,
    )
