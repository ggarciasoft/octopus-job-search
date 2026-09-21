"""The vendor-neutral description of a form, and how a question is named.

An adapter's job is to turn whatever an employer's page happens to be into
:class:`FormField` values. Everything downstream - planning, the fingerprint,
the unresolved list the API turns into new packet questions - works on this
shape and never touches a DOM. That split is what makes the interesting
behaviour testable without a browser, and it is why the rules below can be
stated once instead of per adapter.

Two of those rules matter more than the rest.

**A question key is derived, never invented.** It comes from the field's
accessible label by a deterministic normalisation, so the same question on the
same form is the same key on every run, and an answer stored under that key
means what it says.

**Classification only ever narrows.** :func:`sensitivity_for` marks a label as
``never_reuse`` when it looks like a demographic, identity or assessment
question. It can be wrong in one direction only: it may refuse to reuse an
answer that would have been fine, and it may not permit reuse of one that
would not. ``docs/spec/07_APPLICATION_AUTOMATION.md``: "Never answer
assessments, personality tests, identity verification, or medical/demographic
questions using inferred values."
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

from ..contracts.generated import AnswerSensitivity

#: Longest key the contract's ``QuestionKey`` pattern accepts.
MAX_QUESTION_KEY_LENGTH: Final = 120

_NON_KEY_CHARS: Final = re.compile(r"[^a-z0-9]+")


class FieldKind(StrEnum):
    """What kind of control this is, from the planner's point of view."""

    TEXT = "text"
    TEXTAREA = "textarea"
    EMAIL = "email"
    TEL = "tel"
    URL = "url"
    NUMBER = "number"
    SELECT = "select"
    RADIO = "radio"
    CHECKBOX = "checkbox"
    FILE = "file"
    #: A widget the adapter recognised but cannot drive: a rich text editor, a
    #: custom combobox, a date picker with no text input behind it. Named
    #: rather than omitted, so the user is told it needs them.
    UNSUPPORTED = "unsupported"


#: Kinds whose value must exactly match one of the offered options. Guessing
#: here is how a "no" becomes a "yes" on a work-authorization question.
CHOICE_KINDS: Final = frozenset({FieldKind.SELECT, FieldKind.RADIO, FieldKind.CHECKBOX})

#: Kinds a plain string can be typed into.
FREE_TEXT_KINDS: Final = frozenset(
    {
        FieldKind.TEXT,
        FieldKind.TEXTAREA,
        FieldKind.EMAIL,
        FieldKind.TEL,
        FieldKind.URL,
        FieldKind.NUMBER,
    }
)

#: Label fragments that mark a question as one the spec forbids answering from
#: a stored or inferred value. Matched case-insensitively as substrings, which
#: over-matches on purpose: the cost of an unnecessary pause is a question the
#: user answers themselves, and the cost of a miss is a false statement about
#: their health, ethnicity or identity sent to an employer.
NEVER_REUSE_LABEL_FRAGMENTS: Final = (
    "gender",
    "race",
    "ethnic",
    "hispanic",
    "latino",
    "veteran",
    "disability",
    "disabled",
    "sexual orientation",
    "date of birth",
    "birth date",
    "social security",
    "ssn",
    "national id",
    "identity verification",
    "passport number",
    "driver's license",
    "assessment",
    "personality",
    "criminal",
    "background check",
    "medical",
    "pregnan",
    "religio",
)

#: Fragments that mark a question as personal but reusable within its scope.
SENSITIVE_LABEL_FRAGMENTS: Final = (
    "phone",
    "address",
    "salary",
    "compensation",
    "visa",
    "sponsor",
    "work authorization",
    "right to work",
    "notice period",
)


def normalize_question_key(label: str) -> str:
    """Turn a visible label into a stable key.

    Lower-cased, non-alphanumeric runs collapsed to ``_``, trimmed to the
    contract's length. An empty or punctuation-only label yields ``""``; the
    caller decides what to do about a field nobody can name, which is always
    "report it as unsupported", never "make one up".
    """
    collapsed = _NON_KEY_CHARS.sub("_", label.strip().lower()).strip("_")
    return collapsed[:MAX_QUESTION_KEY_LENGTH]


def sensitivity_for(label: str) -> AnswerSensitivity:
    """Classify a question by its label. Only ever narrows what may be reused."""
    lowered = label.lower()
    if any(fragment in lowered for fragment in NEVER_REUSE_LABEL_FRAGMENTS):
        return AnswerSensitivity.NEVER_REUSE
    if any(fragment in lowered for fragment in SENSITIVE_LABEL_FRAGMENTS):
        return AnswerSensitivity.SENSITIVE
    return AnswerSensitivity.STANDARD


@dataclass(frozen=True)
class FormField:
    """One control on the page, as the planner sees it."""

    key: str
    label: str
    kind: FieldKind
    required: bool
    #: Exact option labels for a choice field, in page order. Empty otherwise.
    options: tuple[str, ...] = ()
    #: The value each option submits, positionally aligned with `options`. The
    #: label is what a person reads and what an answer is matched against; the
    #: value is what the control needs. Keeping both means the driver never has
    #: to re-derive one from the other at typing time.
    option_values: tuple[str, ...] = ()
    #: How the driver reaches this control again. Opaque to the planner.
    selector: str = ""

    @property
    def sensitivity(self) -> AnswerSensitivity:
        return sensitivity_for(self.label)


@dataclass(frozen=True)
class FormSchema:
    """Every field the adapter found, plus the digest that identifies the set."""

    fields: tuple[FormField, ...] = field(default_factory=tuple)

    @property
    def fingerprint(self) -> str:
        return fingerprint(self.fields)


def fingerprint(fields: tuple[FormField, ...] | list[FormField]) -> str:
    """A stable digest of the *shape* of a form.

    Keys, kinds, required-ness and option sets, sorted by key. Deliberately not
    the labels' exact text or the page's markup: a reworded heading is not a
    different form, while a new required question or a changed option list is.
    A packet approved against one fingerprint is not approved against another.
    """
    parts = []
    for item in sorted(fields, key=lambda entry: entry.key):
        options = "|".join(sorted(item.options))
        parts.append(f"{item.key}:{item.kind.value}:{int(item.required)}:{options}")
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return f"v1:{digest[:32]}"
