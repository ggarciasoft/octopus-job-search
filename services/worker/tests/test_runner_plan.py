"""The planner: what the runner will type, and everything it refuses to.

No browser here on purpose. The interesting behaviour - exact option matching,
the demographic refusal, the difference between a question we have no answer
for and one the form has just invented - is a pure function over fields and
answers, and this suite pins it there rather than through a page.
"""

from __future__ import annotations

from job_getter_worker.contracts.generated import AnswerSensitivity, FillField
from job_getter_worker.runner.forms import (
    FieldKind,
    FormField,
    fingerprint,
    normalize_question_key,
    sensitivity_for,
)
from job_getter_worker.runner.plan import build_plan


def field(
    key: str,
    kind: FieldKind = FieldKind.TEXT,
    *,
    label: str | None = None,
    required: bool = False,
    options: tuple[str, ...] = (),
    option_values: tuple[str, ...] = (),
) -> FormField:
    return FormField(
        key=key,
        label=label if label is not None else key.replace("_", " "),
        kind=kind,
        required=required,
        options=options,
        option_values=option_values or options,
        selector=f"#{key}",
    )


def answer(key: str, value: object, *, sensitivity: str = "standard") -> FillField:
    return FillField(
        question_key=key,
        label=key,
        answer=value,  # type: ignore[arg-type]
        required=True,
        sensitivity=sensitivity,  # type: ignore[arg-type]
    )


class TestQuestionKeys:
    def test_a_label_becomes_a_stable_key(self) -> None:
        assert normalize_question_key("Why do you want this role? *") == "why_do_you_want_this_role"

    def test_the_same_label_always_yields_the_same_key(self) -> None:
        assert normalize_question_key("Notice period") == normalize_question_key(
            "  NOTICE  period "
        )

    def test_a_label_with_no_letters_yields_no_key(self) -> None:
        # Reported as unsupported by the caller rather than given a made-up name.
        assert normalize_question_key("***") == ""


class TestSensitivityClassification:
    def test_demographic_questions_are_never_reusable(self) -> None:
        for label in ("Gender", "Are you a protected veteran?", "Disability status", "Race"):
            assert sensitivity_for(label) is AnswerSensitivity.NEVER_REUSE, label

    def test_assessment_and_identity_questions_are_never_reusable(self) -> None:
        for label in ("Personality assessment", "Social Security Number", "Passport number"):
            assert sensitivity_for(label) is AnswerSensitivity.NEVER_REUSE, label

    def test_personal_but_reusable_questions_are_marked_sensitive(self) -> None:
        for label in ("Phone", "Salary expectation", "Do you require visa sponsorship?"):
            assert sensitivity_for(label) is AnswerSensitivity.SENSITIVE, label

    def test_an_ordinary_question_is_standard(self) -> None:
        assert sensitivity_for("Why do you want this role?") is AnswerSensitivity.STANDARD


class TestFreeText:
    def test_an_answered_text_field_is_planned(self) -> None:
        plan = build_plan(
            [field("first_name", required=True)],
            [answer("first_name", "Ada")],
            has_attachment=False,
        )
        assert [item.values for item in plan.values] == [("Ada",)]
        assert plan.unresolved == ()

    def test_a_required_field_with_no_answer_pauses_as_a_new_question(self) -> None:
        plan = build_plan([field("referral_code", required=True)], [], has_attachment=False)
        assert plan.values == ()
        assert plan.unresolved[0].reason == "new_question"
        assert plan.has_unresolved_required

    def test_an_optional_unanswered_field_does_not_block_the_run(self) -> None:
        plan = build_plan([field("phone")], [], has_attachment=False)
        assert not plan.has_unresolved_required

    def test_a_number_is_typed_without_a_spurious_decimal(self) -> None:
        plan = build_plan(
            [field("salary_expectation", FieldKind.NUMBER)],
            [answer("salary_expectation", 60000.0)],
            has_attachment=False,
        )
        assert plan.values[0].values == ("60000",)


class TestChoiceFields:
    options = ("Yes", "No", "Yes, with sponsorship")

    def test_an_exact_option_is_selected(self) -> None:
        plan = build_plan(
            [field("work_auth", FieldKind.RADIO, options=self.options, required=True)],
            [answer("work_auth", "Yes")],
            has_attachment=False,
        )
        assert plan.values[0].values == ("Yes",)

    def test_matching_ignores_case_and_surrounding_space_only(self) -> None:
        plan = build_plan(
            [field("work_auth", FieldKind.RADIO, options=self.options)],
            [answer("work_auth", "  yes  ")],
            has_attachment=False,
        )
        assert plan.values[0].values == ("Yes",)

    def test_a_near_miss_is_never_resolved_to_the_closest_option(self) -> None:
        # "Yes, with sponsorship" is a different answer from "Yes" and the
        # difference is someone's legal right to work.
        plan = build_plan(
            [field("work_auth", FieldKind.RADIO, options=self.options, required=True)],
            [answer("work_auth", "Yes, if sponsored")],
            has_attachment=False,
        )
        assert plan.values == ()
        assert plan.unresolved[0].reason == "needs_exact_mapping"
        assert list(plan.unresolved[0].options) == list(self.options)

    def test_a_boolean_answer_matches_a_yes_no_option(self) -> None:
        plan = build_plan(
            [field("relocate", FieldKind.SELECT, options=("Yes", "No"))],
            [answer("relocate", True)],
            has_attachment=False,
        )
        assert plan.values[0].values == ("Yes",)

    def test_a_boolean_with_no_matching_option_is_not_forced(self) -> None:
        plan = build_plan(
            [field("relocate", FieldKind.SELECT, options=("Willing", "Not willing"))],
            [answer("relocate", True)],
            has_attachment=False,
        )
        assert plan.unresolved[0].reason == "needs_exact_mapping"

    def test_a_checkbox_group_takes_every_matching_option(self) -> None:
        plan = build_plan(
            [field("stack", FieldKind.CHECKBOX, options=("Python", "Go", "Rust"))],
            [answer("stack", ["Python", "Rust"])],
            has_attachment=False,
        )
        assert plan.values[0].values == ("Python", "Rust")

    def test_one_unmatched_member_leaves_the_whole_group_unresolved(self) -> None:
        # Ticking two of three boxes because the third did not match would send
        # a different answer from the one the user gave.
        plan = build_plan(
            [field("stack", FieldKind.CHECKBOX, options=("Python", "Go"))],
            [answer("stack", ["Python", "Erlang"])],
            has_attachment=False,
        )
        assert plan.values == ()
        assert plan.unresolved[0].reason == "needs_exact_mapping"


class TestRefusals:
    def test_a_demographic_question_is_left_for_the_person(self) -> None:
        plan = build_plan(
            [field("gender", FieldKind.SELECT, label="Gender", options=("Female", "Male"))],
            # Even with an exact, confident, matching answer in the packet.
            [answer("gender", "Female", sensitivity="never_reuse")],
            has_attachment=False,
        )
        assert plan.values == ()
        assert plan.unresolved[0].reason == "never_inferable"

    def test_an_unsupported_widget_is_reported_not_skipped(self) -> None:
        plan = build_plan(
            [field("current_location", FieldKind.UNSUPPORTED, required=True)],
            [answer("current_location", "Madrid")],
            has_attachment=False,
        )
        assert plan.values == ()
        assert plan.unresolved[0].reason == "unsupported_widget"

    def test_a_nameless_control_is_reported_under_a_placeholder_key(self) -> None:
        plan = build_plan([field("", label="")], [], has_attachment=False)
        assert plan.unresolved[0].question_key == "unnamed_field"
        assert plan.unresolved[0].reason == "unsupported_widget"

    def test_a_known_key_with_no_answer_reads_as_no_answer_not_a_new_question(self) -> None:
        plan = build_plan(
            [field("cover_letter", required=True), field("first_name")],
            # The packet knows about cover_letter but has nothing under it.
            [
                FillField(
                    question_key="cover_letter",
                    label="Cover letter",
                    answer="",
                    required=True,
                    sensitivity="standard",
                )
            ],
            has_attachment=False,
        )
        reasons = {item.question_key: item.reason for item in plan.unresolved}
        assert reasons["cover_letter"] == "no_answer"


class TestAttachments:
    def test_a_file_field_is_planned_when_a_cv_is_available(self) -> None:
        plan = build_plan([field("resume", FieldKind.FILE, required=True)], [], has_attachment=True)
        assert plan.values[0].upload is True
        assert not plan.has_unresolved_required

    def test_a_file_field_with_no_cv_pauses_rather_than_submitting_without_one(self) -> None:
        plan = build_plan(
            [field("resume", FieldKind.FILE, required=True)], [], has_attachment=False
        )
        assert plan.unresolved[0].reason == "file_upload_blocked"


class TestFingerprint:
    def test_the_same_form_yields_the_same_fingerprint(self) -> None:
        fields = [field("a"), field("b", FieldKind.SELECT, options=("x", "y"))]
        assert fingerprint(fields) == fingerprint(list(reversed(fields)))

    def test_a_reworded_label_is_not_a_different_form(self) -> None:
        before = [FormField(key="a", label="Your name", kind=FieldKind.TEXT, required=True)]
        after = [FormField(key="a", label="Your full name", kind=FieldKind.TEXT, required=True)]
        assert fingerprint(before) == fingerprint(after)

    def test_a_new_required_question_is_a_different_form(self) -> None:
        before = [field("a")]
        after = [field("a"), field("clearance", required=True)]
        assert fingerprint(before) != fingerprint(after)

    def test_a_changed_option_list_is_a_different_form(self) -> None:
        before = [field("auth", FieldKind.SELECT, options=("Yes", "No"))]
        after = [field("auth", FieldKind.SELECT, options=("Yes", "No", "Yes, with sponsorship"))]
        assert fingerprint(before) != fingerprint(after)
