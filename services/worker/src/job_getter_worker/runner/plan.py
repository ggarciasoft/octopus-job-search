"""Deciding what to type, and what to refuse to type.

This is the whole of the runner's judgement, and it is deliberately a pure
function over :class:`FormField` and the packet's answers: no page, no
network, no model. Everything it will not do is easier to see that way.

``docs/spec/07_APPLICATION_AUTOMATION.md`` sets the rules and each one is a
branch below:

* "Checkbox/select answers require exact confirmed mappings; do not fuzzy-match
  legal authorization." A choice field is filled only when the answer equals an
  offered option exactly, ignoring surrounding whitespace and case. Nothing
  else - no prefix match, no synonym table, no "the closest one".
* "Never answer assessments, personality tests, identity verification, or
  medical/demographic questions using inferred values." Those labels are
  classified ``never_reuse`` and are left for the person even when an answer
  with the same key happens to be in the packet.
* "Questions such as salary expectation or years of experience need explicit
  facts/preferences, not free-form guesses." There is no code path that
  produces a value the packet did not contain, for any field.
* "Do not claim every iframe, shadow DOM or custom widget is supported." A
  widget the adapter could not model is reported as unsupported, not skipped
  silently.

A field the planner cannot fill is not a gap to paper over. It becomes an
``UnresolvedField``, which the API turns into a question in the next packet
revision for the user to answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, get_args

from ..contracts.generated import (
    AnswerSensitivity,
    FillField,
    UnresolvedField,
    UnresolvedReason,
)
from .forms import CHOICE_KINDS, FREE_TEXT_KINDS, FieldKind, FormField

#: The generated model types `reason` as a `Literal`, not as the enum, so the
#: values below are written out. The assertion keeps them honest: if the
#: contract gains or loses a reason, this module fails to import rather than
#: silently dropping a case.
Reason = Literal[
    "no_answer",
    "new_question",
    "unsupported_widget",
    "needs_exact_mapping",
    "never_inferable",
    "file_upload_blocked",
]
assert set(get_args(Reason)) == {member.value for member in UnresolvedReason}


@dataclass(frozen=True)
class PlannedValue:
    """One field the runner will actually type into."""

    field: FormField
    #: For a choice field this is the exact option label. For free text it is
    #: the answer rendered as a string. For a checkbox group, several options.
    values: tuple[str, ...]
    #: The attachment to upload, when the field is a file input.
    upload: bool = False


@dataclass(frozen=True)
class FillPlan:
    values: tuple[PlannedValue, ...]
    unresolved: tuple[UnresolvedField, ...]

    @property
    def has_unresolved_required(self) -> bool:
        return any(item.required for item in self.unresolved)


def _as_strings(answer: str | float | bool | list[str]) -> tuple[str, ...]:
    """Render a packet answer for comparison and typing.

    A boolean becomes ``yes``/``no`` because that is what forms offer; it is
    still only *used* when it matches an option exactly, so this is a rendering
    choice, not a mapping one.
    """
    if isinstance(answer, bool):
        return ("yes" if answer else "no",)
    if isinstance(answer, list):
        return tuple(str(item) for item in answer)
    if isinstance(answer, float):
        # 60000.0 is the same expectation as 60000 and should read that way.
        return (str(int(answer)) if answer.is_integer() else str(answer),)
    return (str(answer),)


def _match_option(value: str, options: tuple[str, ...]) -> str | None:
    """Exact match on an offered option, ignoring case and surrounding space.

    This is the only comparison in the module. Anything looser would let
    "Yes, with sponsorship" satisfy an answer of "Yes".
    """
    wanted = value.strip().casefold()
    for option in options:
        if option.strip().casefold() == wanted:
            return option
    return None


def _unresolved(
    form_field: FormField, reason: Reason, *, required: bool | None = None
) -> UnresolvedField:
    return UnresolvedField(
        question_key=form_field.key,
        label=form_field.label,
        required=form_field.required if required is None else required,
        reason=reason,
        options=list(form_field.options),
    )


def build_plan(
    fields: tuple[FormField, ...] | list[FormField],
    answers: tuple[FillField, ...] | list[FillField],
    *,
    has_attachment: bool,
) -> FillPlan:
    """Decide, field by field, what will be typed and what will be asked."""
    by_key = {answer.question_key: answer for answer in answers}
    known_keys = set(by_key)

    values: list[PlannedValue] = []
    unresolved: list[UnresolvedField] = []

    for form_field in fields:
        if form_field.key == "":
            # A control nobody can name cannot be matched to an answer and
            # cannot be asked about coherently either. Reported, never guessed.
            unresolved.append(
                UnresolvedField(
                    question_key="unnamed_field",
                    label=form_field.label or None,
                    required=form_field.required,
                    reason="unsupported_widget",
                    options=list(form_field.options),
                )
            )
            continue

        if form_field.kind is FieldKind.UNSUPPORTED:
            unresolved.append(_unresolved(form_field, "unsupported_widget"))
            continue

        if form_field.kind is FieldKind.FILE:
            if has_attachment:
                values.append(PlannedValue(field=form_field, values=(), upload=True))
            else:
                unresolved.append(_unresolved(form_field, "file_upload_blocked"))
            continue

        # The question is one the spec forbids answering from a stored value.
        # It stays unresolved whether or not the packet happens to carry a
        # matching key: the person answers it, on this form, this time.
        if form_field.sensitivity is AnswerSensitivity.NEVER_REUSE:
            unresolved.append(_unresolved(form_field, "never_inferable"))
            continue

        answer = by_key.get(form_field.key)
        if answer is None:
            reason: Reason = "no_answer" if form_field.key in known_keys else "new_question"
            unresolved.append(_unresolved(form_field, reason))
            continue

        rendered = _as_strings(answer.answer)

        if form_field.kind in CHOICE_KINDS:
            matched = tuple(
                option
                for option in (_match_option(value, form_field.options) for value in rendered)
                if option is not None
            )
            if len(matched) != len(rendered) or not matched:
                unresolved.append(_unresolved(form_field, "needs_exact_mapping"))
                continue
            values.append(PlannedValue(field=form_field, values=matched))
            continue

        if form_field.kind in FREE_TEXT_KINDS:
            text = ", ".join(rendered).strip()
            if text == "":
                unresolved.append(_unresolved(form_field, "no_answer"))
                continue
            values.append(PlannedValue(field=form_field, values=(text,)))
            continue

        unresolved.append(_unresolved(form_field, "unsupported_widget"))

    return FillPlan(values=tuple(values), unresolved=tuple(unresolved))
