"""The adapter interface, and the part of it that needs no browser.

``docs/spec/07_APPLICATION_AUTOMATION.md`` names five operations:

    identify(page)             -> job identity, origin, supported version
    inspect(page)              -> fields, fingerprint
    plan(packet, fields)       -> proposed values, unmatched fields, warnings
    fill(plan)                 -> per-field outcomes
    observe_confirmation()     -> evidence or unknown

Only ``identify``, ``inspect`` and ``fill`` touch a page, and each of those is
split here into a JavaScript snippet that reads the DOM and a pure Python
function that interprets what came back. That is not an aesthetic preference:
it means the interpretation - which control is required, what a question is
called, which widget is unsupported - is unit-testable in isolation, and the
browser test only has to establish that the snippet sees the page correctly.

``plan`` lives in :mod:`job_getter_worker.runner.plan` and never varies by
site. A per-adapter planner would be a per-adapter opportunity to relax the
exact-match rule on a work-authorization question.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from ..forms import FieldKind, FormField, FormSchema


@dataclass(frozen=True)
class PageIdentity:
    """What the page says it is, as the page says it."""

    company: str | None
    title: str | None
    url: str
    origin: str


@dataclass(frozen=True)
class IdentityCheck:
    """Whether the page matches the job this packet was approved for."""

    matches: bool
    reason: str | None = None


@runtime_checkable
class Adapter(Protocol):
    """A versioned reader for one family of application pages."""

    name: str
    version: str

    def handles(self, url: str, marker_found: bool) -> bool:
        """Whether this adapter claims the page.

        `marker_found` is the result of running :attr:`marker_script`, so an
        adapter can recognise a board by structure as well as by host.
        """

    @property
    def marker_script(self) -> str: ...

    @property
    def identity_script(self) -> str: ...

    @property
    def inspect_script(self) -> str: ...

    def parse_inspection(self, raw: Any) -> FormSchema: ...


#: Kinds the shared parser understands from an HTML input `type`.
_INPUT_KINDS: dict[str, FieldKind] = {
    "text": FieldKind.TEXT,
    "email": FieldKind.EMAIL,
    "tel": FieldKind.TEL,
    "url": FieldKind.URL,
    "number": FieldKind.NUMBER,
    "search": FieldKind.TEXT,
    "textarea": FieldKind.TEXTAREA,
    "select": FieldKind.SELECT,
    "radio": FieldKind.RADIO,
    "checkbox": FieldKind.CHECKBOX,
    "file": FieldKind.FILE,
}


def kind_from_raw(raw_kind: str) -> FieldKind:
    """Map a control's reported type onto a planner kind.

    Anything unrecognised - a date picker, a rich text editor, a custom
    combobox - becomes ``UNSUPPORTED`` rather than being optimistically treated
    as text. "Do not claim every iframe, shadow DOM or custom widget is
    supported."
    """
    return _INPUT_KINDS.get(raw_kind.strip().lower(), FieldKind.UNSUPPORTED)


def parse_fields(raw: Any, *, key_for: Any = None) -> tuple[FormField, ...]:
    """Turn the inspection snippet's JSON into fields.

    Shared by every adapter, because the snippet's output shape is part of this
    module's contract rather than each adapter's:

        [{"selector", "label", "kind", "required", "options": [...],
          "option_values": [...]}]

    A row missing its selector or label is dropped to an unnamed unsupported
    field rather than discarded: a control the runner cannot name is still a
    control the user needs to be told about.
    """
    from ..forms import normalize_question_key

    naming = key_for if key_for is not None else normalize_question_key
    fields: list[FormField] = []
    seen: set[str] = set()
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        label = str(entry.get("label") or "").strip()
        selector = str(entry.get("selector") or "")
        kind = kind_from_raw(str(entry.get("kind") or ""))
        raw_options = [
            (str(option), str(value))
            for option, value in zip(
                entry.get("options") or [],
                entry.get("option_values") or entry.get("options") or [],
                strict=False,
            )
            if str(option).strip() != ""
        ]
        options = tuple(option for option, _ in raw_options)
        option_values = tuple(value for _, value in raw_options)
        key = naming(label)
        if key in seen:
            # Two controls normalising to one key would make an answer
            # ambiguous. The second is reported as unsupported so the user can
            # see both rather than having one silently overwrite the other.
            fields.append(
                FormField(
                    key="",
                    label=label,
                    kind=FieldKind.UNSUPPORTED,
                    required=bool(entry.get("required")),
                    options=options,
                    option_values=option_values,
                    selector=selector,
                )
            )
            continue
        if key:
            seen.add(key)
        fields.append(
            FormField(
                key=key,
                label=label,
                kind=kind,
                required=bool(entry.get("required")),
                options=options,
                option_values=option_values,
                selector=selector,
            )
        )
    return tuple(fields)


def parse_identity(raw: Any, url: str, origin: str) -> PageIdentity:
    data = raw if isinstance(raw, dict) else {}
    company = str(data.get("company") or "").strip() or None
    title = str(data.get("title") or "").strip() or None
    return PageIdentity(company=company, title=title, url=url, origin=origin)


def _normalise(value: str) -> str:
    return " ".join(value.split()).casefold()


def check_identity(page: PageIdentity, expected_company: str, expected_title: str) -> IdentityCheck:
    """Compare what the page says against what the packet was approved for.

    The comparison is containment in either direction after whitespace and case
    normalisation, because boards decorate titles ("Senior Engineer (Remote)")
    and companies ("Acme, Inc."). A page that states neither is *not* treated as
    matching: "Check all linked identities before filling" cannot be satisfied
    by a page that declines to say who it belongs to.
    """
    if page.company is None and page.title is None:
        return IdentityCheck(False, "the page does not state a company or a role")

    for observed, expected, what in (
        (page.company, expected_company, "company"),
        (page.title, expected_title, "role"),
    ):
        if observed is None or expected.strip() == "":
            continue
        left, right = _normalise(observed), _normalise(expected)
        if left not in right and right not in left:
            return IdentityCheck(False, f"the page's {what} is not the one this packet names")
    return IdentityCheck(True)
