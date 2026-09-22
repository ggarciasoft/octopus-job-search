"""Regenerate the fill-planner parity vectors from the Python implementation.

    cd services/worker && uv run python ../../fixtures/fill-planner/generate.py

The Python runner shipped first (M4) and its behaviour is what the browser
tests in `services/worker/tests/test_runner_greenhouse.py` were verified
against, so it is the source of truth for these vectors. The TypeScript port in
`packages/fill-planner` is pinned to them, and so is Python itself: both
`packages/fill-planner/tests/parity.test.ts` and
`services/worker/tests/test_planner_parity.py` read this file and fail on any
divergence.

That double assertion is the point. Regenerating after a deliberate change in
Python updates the fixture and immediately breaks TypeScript, which is the
signal to port the change rather than discover the drift later, on an
employer's page, as a packet that reads stale in one client and current in the
other.

The inputs below are chosen to cover every branch of `normalize_question_key`,
`sensitivity_for`, `fingerprint`, `parse_fields`, `check_identity` and
`build_plan`, including the ones whose whole job is to refuse.
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "services/worker/src"))

from job_getter_worker.contracts.generated import FillField  # noqa: E402
from job_getter_worker.runner.adapters.base import (  # noqa: E402
    check_identity,
    parse_fields,
    parse_identity,
)
from job_getter_worker.runner.forms import (  # noqa: E402
    FieldKind,
    FormField,
    fingerprint,
    normalize_question_key,
    sensitivity_for,
)
from job_getter_worker.runner.plan import build_plan  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent / "vectors.json"

KEY_LABELS = [
    "First name",
    "  Leading and trailing  ",
    "Why do you want THIS role?",
    "E-mail address",
    "Salary / compensation expectation",
    "",
    "!!!",
    "___",
    "a" * 200,
    "Años de experiencia",
    "中文标题",
    "Phone (mobile)",
    "Résumé",
]

SENSITIVITY_LABELS = [
    "First name",
    "Gender",
    "What is your race or ethnicity?",
    "Are you a protected veteran?",
    "Do you have a disability?",
    "Sexual orientation",
    "Date of birth",
    "Social Security number",
    "Passport number",
    "Driver's license",
    "Personality assessment",
    "Criminal history",
    "Background check consent",
    "Medical conditions",
    "Are you pregnant?",
    "Religious affiliation",
    "Phone number",
    "Home address",
    "Salary expectation",
    "Do you require visa sponsorship?",
    "Right to work in the UK",
    "Notice period",
    "Why this role?",
    # The over-match is deliberate and worth pinning: "gender" inside another
    # word still classifies, and so does a role that merely mentions salary.
    "Transgender policy awareness",
    "Tell us about your salary history",
]


def field(
    key: str,
    kind: FieldKind,
    *,
    label: str | None = None,
    required: bool = False,
    options: tuple[str, ...] = (),
) -> FormField:
    return FormField(
        key=key,
        label=label if label is not None else key.replace("_", " "),
        kind=kind,
        required=required,
        options=options,
        option_values=options,
        selector=f"#{key}" if key else "",
    )


FINGERPRINT_CASES: list[tuple[str, list[FormField]]] = [
    ("empty", []),
    ("one_text", [field("first_name", FieldKind.TEXT, required=True)]),
    (
        "sorted_by_key",
        [
            field("zeta", FieldKind.TEXT),
            field("alpha", FieldKind.TEXTAREA, required=True),
            field("Mixed_Case", FieldKind.EMAIL),
        ],
    ),
    (
        "options_sorted_and_joined",
        [field("authorized", FieldKind.SELECT, required=True, options=("Yes", "No", "Maybe"))],
    ),
    (
        "reordered_options_are_the_same_form",
        [field("authorized", FieldKind.SELECT, required=True, options=("No", "Maybe", "Yes"))],
    ),
    (
        "required_changes_the_digest",
        [field("authorized", FieldKind.SELECT, required=False, options=("Yes", "No", "Maybe"))],
    ),
    (
        "unicode_options",
        [field("idioma", FieldKind.RADIO, options=("Español", "Inglés"))],
    ),
    ("unnamed_control", [field("", FieldKind.UNSUPPORTED, label="Rich text editor")]),
]

PARSE_CASES: list[tuple[str, object]] = [
    ("not_a_list", {"label": "First name"}),
    ("empty_list", []),
    (
        "ordinary_rows",
        [
            {"selector": "#a", "label": "First name", "kind": "text", "required": True},
            {"selector": "#b", "label": "Cover letter", "kind": "textarea"},
            {
                "selector": "#c",
                "label": "Authorized to work?",
                "kind": "select",
                "required": True,
                "options": ["Yes", "No"],
                "option_values": ["y", "n"],
            },
        ],
    ),
    (
        "duplicate_keys_collapse_to_unsupported",
        [
            {"selector": "#a", "label": "Name", "kind": "text"},
            {"selector": "#b", "label": "NAME", "kind": "text"},
        ],
    ),
    (
        "unknown_kind_is_unsupported",
        [{"selector": "#a", "label": "Start date", "kind": "date"}],
    ),
    (
        "missing_label_is_unnamed",
        [{"selector": "#a", "label": "", "kind": "text", "required": True}],
    ),
    (
        "blank_options_are_dropped",
        [{"selector": "#a", "label": "Pick", "kind": "select", "options": ["", "  ", "Yes"]}],
    ),
    (
        "options_without_values_fall_back_to_labels",
        [{"selector": "#a", "label": "Pick", "kind": "radio", "options": ["Yes", "No"]}],
    ),
    ("rows_that_are_not_objects", [None, 3, "x", {"label": "Kept", "kind": "text"}]),
]

IDENTITY_CASES: list[tuple[str, object, str, str]] = [
    ("exact", {"company": "Acme", "title": "Backend Engineer"}, "Acme", "Backend Engineer"),
    (
        "decorated_title_contains_expected",
        {"company": "Acme, Inc.", "title": "Senior Engineer (Remote)"},
        "Acme",
        "Senior Engineer",
    ),
    ("page_states_nothing", {}, "Acme", "Backend Engineer"),
    ("company_only", {"company": "Acme"}, "Acme", "Backend Engineer"),
    (
        "wrong_company",
        {"company": "Globex", "title": "Backend Engineer"},
        "Acme",
        "Backend Engineer",
    ),
    ("wrong_title", {"company": "Acme", "title": "Chef"}, "Acme", "Backend Engineer"),
    (
        "whitespace_and_case",
        {"company": "  ACME   Inc  ", "title": "backend   engineer"},
        "Acme Inc",
        "Backend Engineer",
    ),
    ("expected_is_blank", {"company": "Acme", "title": "Anything"}, "Acme", "   "),
]


def answer(key: str, value: object, *, required: bool = True) -> FillField:
    return FillField(
        question_key=key,
        label=key.replace("_", " "),
        answer=value,
        required=required,
        sensitivity="standard",
    )


PLAN_CASES: list[tuple[str, list[FormField], list[FillField], bool]] = [
    (
        "free_text_is_typed",
        [field("first_name", FieldKind.TEXT, required=True)],
        [answer("first_name", "Ada")],
        False,
    ),
    (
        "exact_option_match",
        [field("authorized", FieldKind.SELECT, required=True, options=("Yes", "No"))],
        [answer("authorized", "yes")],
        False,
    ),
    (
        "near_miss_is_refused",
        [
            field(
                "authorized",
                FieldKind.SELECT,
                required=True,
                options=("Yes, with sponsorship", "No"),
            )
        ],
        [answer("authorized", "Yes")],
        False,
    ),
    (
        "boolean_renders_as_yes",
        [field("authorized", FieldKind.RADIO, required=True, options=("Yes", "No"))],
        [answer("authorized", True)],
        False,
    ),
    (
        "boolean_false_renders_as_no",
        [field("authorized", FieldKind.RADIO, required=True, options=("Yes", "No"))],
        [answer("authorized", False)],
        False,
    ),
    (
        "integral_number_drops_its_point",
        [field("salary", FieldKind.NUMBER)],
        [answer("salary", 60000.0)],
        False,
    ),
    (
        "fractional_number_is_kept",
        [field("years", FieldKind.NUMBER)],
        [answer("years", 2.5)],
        False,
    ),
    (
        "list_into_checkbox_group",
        [field("tools", FieldKind.CHECKBOX, options=("Python", "Go", "Rust"))],
        [answer("tools", ["Python", "Rust"])],
        False,
    ),
    (
        "list_with_one_unmatched_option_fills_nothing",
        [field("tools", FieldKind.CHECKBOX, options=("Python", "Go"))],
        [answer("tools", ["Python", "Haskell"])],
        False,
    ),
    (
        "list_joined_into_free_text",
        [field("languages", FieldKind.TEXT)],
        [answer("languages", ["English", "Spanish"])],
        False,
    ),
    (
        "empty_answer_is_no_answer",
        [field("cover_letter", FieldKind.TEXTAREA, required=True)],
        [answer("cover_letter", "   ")],
        False,
    ),
    (
        "unknown_question",
        [field("internal_referral_code", FieldKind.TEXT, required=True)],
        [answer("first_name", "Ada")],
        False,
    ),
    (
        "never_reuse_is_left_alone_even_with_an_answer",
        [field("gender", FieldKind.SELECT, label="Gender", required=True, options=("Woman", "Man"))],
        [answer("gender", "Woman")],
        False,
    ),
    (
        "file_with_attachment",
        [field("resume", FieldKind.FILE, required=True)],
        [],
        True,
    ),
    (
        "file_without_attachment",
        [field("resume", FieldKind.FILE, required=True)],
        [],
        False,
    ),
    (
        "unsupported_widget",
        [field("start_date", FieldKind.UNSUPPORTED, required=True)],
        [answer("start_date", "2026-01-01")],
        False,
    ),
    (
        "unnamed_control",
        [field("", FieldKind.UNSUPPORTED, label="Rich text editor", required=True)],
        [],
        False,
    ),
    (
        "unnamed_control_without_a_label",
        [field("", FieldKind.UNSUPPORTED, label="", required=False)],
        [],
        False,
    ),
    (
        "whole_greenhouse_shaped_form",
        [
            field("first_name", FieldKind.TEXT, required=True),
            field("last_name", FieldKind.TEXT, required=True),
            field("email", FieldKind.EMAIL, required=True),
            field("phone", FieldKind.TEL),
            field("resume", FieldKind.FILE, required=True),
            field("cover_letter", FieldKind.TEXTAREA),
            field(
                "authorized_to_work",
                FieldKind.SELECT,
                label="Are you authorized to work?",
                required=True,
                options=("Yes", "No"),
            ),
            field(
                "internal_referral_code",
                FieldKind.TEXT,
                label="Internal referral code",
                required=True,
            ),
            field("gender", FieldKind.SELECT, label="Gender", options=("Woman", "Man", "Decline")),
        ],
        [
            answer("first_name", "Ada"),
            answer("last_name", "Lovelace"),
            answer("email", "ada@example.invalid"),
            answer("phone", "+44 20 7946 0000", required=False),
            answer("cover_letter", "I would like to work here.", required=False),
            answer("authorized_to_work", "Yes"),
            answer("gender", "Woman", required=False),
        ],
        True,
    ),
]


def plan_json(plan: object) -> dict[str, object]:
    return {
        "values": [
            {
                "key": value.field.key,
                "values": list(value.values),
                "upload": value.upload,
            }
            for value in plan.values
        ],
        "unresolved": [
            {
                "question_key": item.question_key,
                "label": item.label,
                "required": item.required,
                "reason": item.reason,
                "options": list(item.options),
            }
            for item in plan.unresolved
        ],
        "has_unresolved_required": plan.has_unresolved_required,
    }


def field_json(item: FormField) -> dict[str, object]:
    return {
        "key": item.key,
        "label": item.label,
        "kind": item.kind.value,
        "required": item.required,
        "options": list(item.options),
        "option_values": list(item.option_values),
        "selector": item.selector,
    }


def fingerprint_material(fields: list[FormField]) -> str:
    parts = []
    for item in sorted(fields, key=lambda entry: entry.key):
        options = "|".join(sorted(item.options))
        parts.append(f"{item.key}:{item.kind.value}:{int(item.required)}:{options}")
    return "\n".join(parts)


def main() -> int:
    vectors = {
        "_comment": (
            "Generated by fixtures/fill-planner/generate.py from the Python runner, "
            "which is the source of truth. Asserted by both "
            "packages/fill-planner/tests/parity.test.ts and "
            "services/worker/tests/test_planner_parity.py. Do not hand-edit."
        ),
        "normalize_question_key": [
            {"label": label, "key": normalize_question_key(label)} for label in KEY_LABELS
        ],
        "sensitivity_for": [
            {"label": label, "sensitivity": str(sensitivity_for(label))}
            for label in SENSITIVITY_LABELS
        ],
        "fingerprint": [
            {
                "name": name,
                "fields": [field_json(item) for item in fields],
                "material": fingerprint_material(fields),
                "fingerprint": fingerprint(tuple(fields)),
            }
            for name, fields in FINGERPRINT_CASES
        ],
        "parse_fields": [
            {"name": name, "raw": raw, "fields": [field_json(item) for item in parse_fields(raw)]}
            for name, raw in PARSE_CASES
        ],
        "check_identity": [
            {
                "name": name,
                "raw": raw,
                "expected_company": company,
                "expected_title": title,
                "identity": {
                    "company": parse_identity(raw, "https://x.example/a", "https://x.example").company,
                    "title": parse_identity(raw, "https://x.example/a", "https://x.example").title,
                },
                "result": {
                    "matches": check_identity(
                        parse_identity(raw, "https://x.example/a", "https://x.example"),
                        company,
                        title,
                    ).matches,
                    "reason": check_identity(
                        parse_identity(raw, "https://x.example/a", "https://x.example"),
                        company,
                        title,
                    ).reason,
                },
            }
            for name, raw, company, title in IDENTITY_CASES
        ],
        "build_plan": [
            {
                "name": name,
                "fields": [field_json(item) for item in fields],
                "answers": [
                    {
                        "question_key": item.question_key,
                        "label": item.label,
                        "answer": item.answer,
                        "required": item.required,
                        "sensitivity": str(item.sensitivity),
                    }
                    for item in answers
                ],
                "has_attachment": has_attachment,
                "plan": plan_json(build_plan(fields, answers, has_attachment=has_attachment)),
            }
            for name, fields, answers, has_attachment in PLAN_CASES
        ],
    }

    OUT.write_text(json.dumps(vectors, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = {key: len(value) for key, value in vectors.items() if isinstance(value, list)}
    print(f"wrote {OUT} ({counts})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
