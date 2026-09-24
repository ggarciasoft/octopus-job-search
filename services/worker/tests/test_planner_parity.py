"""The Python planner must still agree with the committed parity vectors.

`fixtures/fill-planner/vectors.json` is generated from this implementation and
asserted by the TypeScript port in `packages/fill-planner`. This suite closes
the loop from the other side: change `forms.py` or `plan.py` without
regenerating, and these tests fail here rather than silently invalidating the
fixture the extension is pinned to.

Both directions are needed. Without the TypeScript suite, a Python change
plus a regeneration would move the fixture and leave the port behind. Without
this one, a Python change with no regeneration would leave the fixture
describing behaviour the runner no longer has, and the extension would be
pinned to a runner that no longer exists.
"""

from __future__ import annotations

import http.server
import json
import pathlib
import threading
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest

from job_getter_worker.contracts.generated import FillField
from job_getter_worker.runner.adapters import Adapter, GreenhouseAdapter, LeverAdapter
from job_getter_worker.runner.adapters.base import check_identity, parse_fields, parse_identity
from job_getter_worker.runner.browser import (
    BrowserOptions,
    BrowserUnavailableError,
    RunnerBrowser,
)
from job_getter_worker.runner.forms import (
    FieldKind,
    FormField,
    fingerprint,
    normalize_question_key,
    sensitivity_for,
)
from job_getter_worker.runner.plan import build_plan

VECTORS = json.loads(
    (pathlib.Path(__file__).resolve().parents[3] / "fixtures/fill-planner/vectors.json").read_text(
        encoding="utf-8"
    )
)


def to_field(vector: dict[str, Any]) -> FormField:
    return FormField(
        key=vector["key"],
        label=vector["label"],
        kind=FieldKind(vector["kind"]),
        required=vector["required"],
        options=tuple(vector["options"]),
        option_values=tuple(vector["option_values"]),
        selector=vector["selector"],
    )


def from_field(item: FormField) -> dict[str, Any]:
    return {
        "key": item.key,
        "label": item.label,
        "kind": item.kind.value,
        "required": item.required,
        "options": list(item.options),
        "option_values": list(item.option_values),
        "selector": item.selector,
    }


@pytest.mark.parametrize(
    "vector", VECTORS["normalize_question_key"], ids=lambda v: v["key"] or "empty"
)
def test_question_keys_match_the_fixture(vector: dict[str, Any]) -> None:
    assert normalize_question_key(vector["label"]) == vector["key"]


@pytest.mark.parametrize("vector", VECTORS["sensitivity_for"], ids=lambda v: v["label"][:40])
def test_sensitivity_matches_the_fixture(vector: dict[str, Any]) -> None:
    assert str(sensitivity_for(vector["label"])) == vector["sensitivity"]


@pytest.mark.parametrize("vector", VECTORS["fingerprint"], ids=lambda v: v["name"])
def test_fingerprints_match_the_fixture(vector: dict[str, Any]) -> None:
    fields = tuple(to_field(item) for item in vector["fields"])
    assert fingerprint(fields) == vector["fingerprint"]


@pytest.mark.parametrize("vector", VECTORS["parse_fields"], ids=lambda v: v["name"])
def test_parsed_fields_match_the_fixture(vector: dict[str, Any]) -> None:
    assert [from_field(item) for item in parse_fields(vector["raw"])] == vector["fields"]


@pytest.mark.parametrize("vector", VECTORS["check_identity"], ids=lambda v: v["name"])
def test_identity_checks_match_the_fixture(vector: dict[str, Any]) -> None:
    identity = parse_identity(vector["raw"], "https://x.example/a", "https://x.example")
    assert {"company": identity.company, "title": identity.title} == vector["identity"]

    result = check_identity(identity, vector["expected_company"], vector["expected_title"])
    assert {"matches": result.matches, "reason": result.reason} == vector["result"]


@pytest.mark.parametrize("vector", VECTORS["build_plan"], ids=lambda v: v["name"])
def test_plans_match_the_fixture(vector: dict[str, Any]) -> None:
    fields = tuple(to_field(item) for item in vector["fields"])
    answers = tuple(
        FillField(
            question_key=item["question_key"],
            label=item["label"],
            answer=item["answer"],
            required=item["required"],
            sensitivity=item["sensitivity"],
        )
        for item in vector["answers"]
    )
    plan = build_plan(fields, answers, has_attachment=vector["has_attachment"])

    assert [
        {"key": value.field.key, "values": list(value.values), "upload": value.upload}
        for value in plan.values
    ] == vector["plan"]["values"]
    assert [
        {
            "question_key": item.question_key,
            "label": item.label,
            "required": item.required,
            "reason": item.reason,
            "options": list(item.options),
        }
        for item in plan.unresolved
    ] == vector["plan"]["unresolved"]
    assert plan.has_unresolved_required == vector["plan"]["has_unresolved_required"]


# ---------------------------------------------------------------------------
# The other parity, between two DOM engines
# ---------------------------------------------------------------------------
#
# The vectors above pin the two planners. They cannot pin the two *readers*:
# this runner reads an employer's form through Chromium, and the extension
# reads it through its own content script in a tab. A disagreement there
# produces two fingerprints for one page, and every approval made through one
# client reads as stale to the other.
#
# `fixtures/fill-planner/{greenhouse,lever}-page.json` record what Chromium
# saw, one file per adapter. `apps/extension/tests/parity.test.ts` asserts
# jsdom reproduces them; this asserts Chromium still does.

_PAGE_ADAPTERS: dict[str, Adapter] = {"greenhouse": GreenhouseAdapter(), "lever": LeverAdapter()}

PAGE_VECTORS = [
    (name, vector)
    for name in _PAGE_ADAPTERS
    for vector in json.loads(
        (
            pathlib.Path(__file__).resolve().parents[3] / f"fixtures/fill-planner/{name}-page.json"
        ).read_text(encoding="utf-8")
    )
]


@pytest.fixture(scope="module")
def ats_server() -> Iterator[str]:
    """Serve the fixture pages from a real loopback origin, as the runner sees them."""
    pages = pathlib.Path(__file__).resolve().parents[3] / "fixtures" / "ats-pages"

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=str(pages), **kwargs)  # type: ignore[arg-type]

        def log_message(self, *args: object) -> None:
            return

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.fixture
async def ats_browser(tmp_path: pathlib.Path) -> AsyncIterator[RunnerBrowser]:
    runner = RunnerBrowser(BrowserOptions(profile_dir=tmp_path / "profile", headless=True))
    try:
        await runner.start()
    except BrowserUnavailableError as error:
        # A skipped browser test must never read as a passing one.
        pytest.skip(f"Playwright Chromium is not installed here: {error}")
    try:
        yield runner
    finally:
        await runner.aclose()


@pytest.mark.parametrize(
    ("adapter_name", "expected"), PAGE_VECTORS, ids=[v["page"] for _, v in PAGE_VECTORS]
)
async def test_chromium_still_reads_the_recorded_page(
    ats_browser: RunnerBrowser, ats_server: str, adapter_name: str, expected: dict[str, Any]
) -> None:
    adapter = _PAGE_ADAPTERS[adapter_name]
    page = await ats_browser.open(f"{ats_server}/{expected['page']}", (ats_server,))
    rows = await page.evaluate(adapter.inspect_script)
    schema = adapter.parse_inspection(rows)

    assert [field.key for field in schema.fields] == expected["keys"]
    assert schema.fingerprint == expected["fingerprint"]


# `fixtures/fill-planner/greenhouse-confirmation.json` does the same for the
# confirmation reader, which both clients now turn into `submitted` evidence.

CONFIRMATION_VECTORS = json.loads(
    (
        pathlib.Path(__file__).resolve().parents[3]
        / "fixtures/fill-planner/greenhouse-confirmation.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("expected", CONFIRMATION_VECTORS, ids=lambda v: v["page"])
async def test_chromium_still_reads_the_recorded_confirmation(
    ats_browser: RunnerBrowser, ats_server: str, expected: dict[str, Any]
) -> None:
    adapter = GreenhouseAdapter()
    page = await ats_browser.open(f"{ats_server}/{expected['page']}", (ats_server,))
    raw = await page.evaluate(adapter.confirmation_script)
    if isinstance(raw, dict):
        raw = {**raw, "url": raw["url"].removeprefix(ats_server)}
    assert raw == expected["confirmation"]
