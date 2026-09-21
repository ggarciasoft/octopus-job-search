"""AT21 and AT22, from the worker's side.

    AT21 | Cloud provider unavailable | No surprise provider switch; local/draft
          work preserved
    AT22 | Budget exhausted | New inference blocked; review/export still work

The "review/export still work" half of AT22 is an API property and is asserted
in ``apps/api/tests/usage.test.ts``. What belongs here is the half only the
worker can prove: that a refusal arrives **before** anything is sent to a model,
and that a provider that will not answer is reported rather than quietly
replaced by another one.

Every test runs the real ``parse_profile`` handler over a real fixture document,
through the real API client against an enforcing HTTP mock.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from job_getter_worker.errors import TaskFailureError
from job_getter_worker.providers.base import ProviderUnavailableError
from job_getter_worker.settings import WorkerSettings

from .conftest import SettingsFactory, UsageLedgerStub
from .test_parse_profile import BASE_URL, TASK_ID, run_parse


class RefusingProvider:
    """A provider that records being asked, and refuses.

    Being asked at all is the failure these tests are looking for: a budget
    checked after the request has already spent the money.
    """

    def __init__(self, error: Exception) -> None:
        self.calls = 0
        self._error = error

    async def generate_structured(self, **_kwargs: Any) -> Any:
        self.calls += 1
        raise self._error

    async def supports_structured_output(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None


def _install(monkeypatch: pytest.MonkeyPatch, provider: RefusingProvider) -> None:
    """Put this provider in place of whatever configuration would have built."""
    monkeypatch.setattr(
        "job_getter_worker.handlers.parse_profile.build_provider",
        lambda _settings: provider,
    )


# ---------------------------------------------------------------------------
# AT22: budget exhausted
# ---------------------------------------------------------------------------


@respx.mock
async def test_at22_an_exhausted_budget_blocks_inference_before_any_request_is_sent(
    fake_provider_settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = RefusingProvider(AssertionError("the model must not be asked"))
    _install(monkeypatch, provider)
    ledger = UsageLedgerStub(BASE_URL, TASK_ID, exhausted=True)

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(fake_provider_settings, cv="text-cv.pdf", ledger=ledger)

    assert raised.value.code == "BUDGET_EXHAUSTED"
    # The point of reserving first: nothing was sent, so nothing was spent.
    assert provider.calls == 0
    assert ledger.settled == []


@respx.mock
async def test_at22_a_budget_refusal_is_not_retried(
    fake_provider_settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch, RefusingProvider(AssertionError("the model must not be asked")))
    ledger = UsageLedgerStub(BASE_URL, TASK_ID, exhausted=True)

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(fake_provider_settings, cv="text-cv.pdf", ledger=ledger)

    # The server is told not to retry. A cap does not move until the day's
    # requests age out, so a second attempt would fail identically and spend one
    # of the task's three attempts finding that out.
    assert raised.value.retryable is False

    # And the client did not retry the reservation either: the API answers 409,
    # not 429, precisely so the transient-retry path is never entered. One
    # refusal, one call.
    reserve_calls = [
        call for call in respx.calls if call.request.url.path.endswith("/usage/reserve")
    ]
    assert len(reserve_calls) == 1


@respx.mock
async def test_at22_the_message_says_what_still_works(
    fake_provider_settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch, RefusingProvider(AssertionError("the model must not be asked")))

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(
            fake_provider_settings,
            cv="text-cv.pdf",
            ledger=UsageLedgerStub(BASE_URL, TASK_ID, exhausted=True),
        )

    # A user who hits a cap needs to know the rest of the product is still
    # theirs, not just that something failed.
    message = raised.value.redacted_message.lower()
    assert "review" in message or "exporting" in message


@respx.mock
async def test_at22_the_worker_own_cap_also_refuses_before_the_request(
    make_settings: SettingsFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The operator's per-process cap is the stricter of the two, and still applies."""
    provider = RefusingProvider(AssertionError("the model must not be asked"))
    _install(monkeypatch, provider)
    settings = make_settings(
        PROVIDER_DEFAULT="fake",
        WORKER_MODEL="fake-deterministic-v1",
        WORKER_PROVIDER_DAILY_TOKEN_BUDGET="1",
    )
    ledger = UsageLedgerStub(BASE_URL, TASK_ID)

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(settings, cv="text-cv.pdf", ledger=ledger)

    assert raised.value.code == "BUDGET_EXHAUSTED"
    assert provider.calls == 0
    # Refused locally, so the workspace's ledger was never even asked: a
    # reservation the worker knows it cannot use must not occupy the day's
    # budget while it fails.
    assert ledger.reserved == []


# ---------------------------------------------------------------------------
# AT21: cloud provider unavailable
# ---------------------------------------------------------------------------


@respx.mock
async def test_at21_an_unavailable_provider_fails_the_task_without_switching(
    fake_provider_settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = RefusingProvider(ProviderUnavailableError("the configured endpoint did not answer"))
    _install(monkeypatch, provider)
    ledger = UsageLedgerStub(BASE_URL, TASK_ID)

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(fake_provider_settings, cv="text-cv.pdf", ledger=ledger)

    assert raised.value.code == "PROVIDER_UNAVAILABLE"
    # ADR07: "a user who configured a local model for privacy reasons must never
    # have their CV silently sent to a cloud API". One provider was asked, once.
    # Nothing looked for a second one.
    assert provider.calls == 1


@respx.mock
async def test_at21_an_unsent_request_gives_its_reservation_back(
    fake_provider_settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch, RefusingProvider(ProviderUnavailableError("no answer")))
    ledger = UsageLedgerStub(BASE_URL, TASK_ID)

    with pytest.raises(TaskFailureError):
        await run_parse(fake_provider_settings, cv="text-cv.pdf", ledger=ledger)

    # A provider that never answered cost nothing, so the day's budget must not
    # be left holding the reservation for it.
    assert len(ledger.reserved) == 1
    assert ledger.settled == []
    assert len(ledger.released) == 1


@respx.mock
async def test_at21_a_provider_failure_proposes_no_facts_at_all(
    fake_provider_settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The failure is reported. It is never dressed up as an empty result.

    An empty draft would read to the user as "your CV contains nothing", which
    is a different and much worse claim than "the model could not be reached".
    """
    _install(monkeypatch, RefusingProvider(ProviderUnavailableError("no answer")))

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(
            fake_provider_settings,
            cv="text-cv.pdf",
            ledger=UsageLedgerStub(BASE_URL, TASK_ID),
        )

    assert raised.value.code == "PROVIDER_UNAVAILABLE"
    assert raised.value.retryable is True


@respx.mock
async def test_at21_the_failure_message_carries_no_document_text(
    fake_provider_settings: WorkerSettings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(
        monkeypatch,
        RefusingProvider(ProviderUnavailableError("upstream said 503 for model gpt-4o-mini")),
    )

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(
            fake_provider_settings,
            cv="text-cv.pdf",
            ledger=UsageLedgerStub(BASE_URL, TASK_ID),
        )

    # The message is stored on the task and shown to the user, so it must carry
    # the operational fact and nothing from the CV. These strings are really in
    # fixtures/cvs/text-cv.pdf, which is what makes their absence mean anything.
    message = raised.value.redacted_message
    assert "503" in message, "the operational detail should survive"
    for personal in ("Ana Rivera", "ana.rivera@example.invalid", "Montevideo", "Northwind"):
        assert personal not in message


@respx.mock
async def test_an_http_transport_failure_is_reported_as_provider_unavailable(
    make_settings: SettingsFactory,
) -> None:
    """The real adapter, not a stand-in: a refused connection must not look like
    an empty answer from a working model."""
    settings = make_settings(
        PROVIDER_DEFAULT="openai_compatible",
        WORKER_MODEL="a-model",
        LOCAL_MODEL_BASE_URL="http://provider.internal.test/v1",
    )
    endpoint = respx.post("http://provider.internal.test/v1/chat/completions").mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    with pytest.raises(TaskFailureError) as raised:
        await run_parse(settings, cv="text-cv.pdf", ledger=UsageLedgerStub(BASE_URL, TASK_ID))

    assert raised.value.code == "PROVIDER_UNAVAILABLE"
    # Without this the test would pass just as well if the run had failed
    # before it ever reached the provider.
    assert endpoint.called
