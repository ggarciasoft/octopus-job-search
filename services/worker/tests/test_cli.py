"""Command-line entry points.

The runner tests matter more than they look. Until M4 the runner was a stub
whose whole job was to say so, and these tests asserted that it did. Now that
it works, they assert the properties that replaced that honesty: the container
worker still cannot claim browser work, the pairing code never arrives as an
argument, and nothing prints a token.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from job_getter_worker import cli, runner_cli
from job_getter_worker.runner.store import PairingStore, StoredPairing


@pytest.fixture(autouse=True)
def _keep_pytest_logging(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stop an entry point from tearing out pytest's log capture.

    Both `main()` functions call `configure_logging`, which runs
    `logging.basicConfig(..., force=True)` against the stdout that exists at
    that moment. Under pytest that stdout is a capture buffer which is closed
    when the test ends, so every later test in the session writes its log lines
    into a closed file and fails for a reason that has nothing to do with it.

    Process-wide logging setup is not what these tests are about.
    """
    monkeypatch.setattr(runner_cli, "configure_logging", lambda *args, **kwargs: None)
    monkeypatch.setattr(cli, "configure_logging", lambda *args, **kwargs: None)


def test_run_without_a_pairing_says_so_and_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = runner_cli.main(["run", "--state-dir", str(tmp_path)])
    assert exit_code == 2
    assert "No pairing found" in capsys.readouterr().err


def test_the_pairing_code_cannot_be_passed_as_an_argument() -> None:
    """It is typed in, so it stays out of shell history and the process list."""
    parser = runner_cli.build_parser()
    # argparse offers no public way to reach a subparser's options, so this
    # asks the parser the way a user would: an unknown option must be rejected.
    for rejected in ("--code", "--pairing-code"):
        with pytest.raises(SystemExit):
            parser.parse_args(["pair", "--server", "http://localhost:3000", rejected, "123456"])


def test_status_never_prints_the_token(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    secret = "device-token-that-must-never-be-printed-0123456789"
    store = PairingStore(tmp_path)
    store.save(
        StoredPairing(
            server="http://localhost:3000",
            device_id="11111111-1111-4111-8111-111111111111",
            token=secret,
            expires_at="2026-10-21T00:00:00Z",
            allowed_origins=("https://boards.greenhouse.io",),
        )
    )

    assert runner_cli.main(["status", "--state-dir", str(tmp_path)]) == 0
    printed = capsys.readouterr()
    assert secret not in printed.out
    assert secret not in printed.err
    assert "11111111-1111-4111-8111-111111111111" in printed.out


def test_the_container_worker_cannot_claim_browser_work() -> None:
    """ADR05: a headless container has no access to a desktop browser."""
    from job_getter_worker.handlers import build_default_registry

    registered = {task_type.value for task_type in build_default_registry().registered}
    assert registered == {
        "noop_echo",
        "parse_profile",
        "fetch_board",
        "fetch_job",
        "match_job",
        "render_cv",
    }
    assert "fill_local" not in registered


def test_the_runner_registry_carries_only_browser_work() -> None:
    from job_getter_worker.runner import build_runner_registry

    registry = build_runner_registry(object(), "device-1")
    # Both of these drive a real browser on the user's own machine, and neither
    # of them ever clicks submit: one fills a form and stops, the other reads
    # the page after the person has submitted it themselves.
    assert {task_type.value for task_type in registry.registered} == {
        "fill_local",
        "observe_confirmation",
    }


def test_worker_cli_fails_fast_on_a_bad_capability(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("WORKER_API_BASE_URL", "http://api.internal.test")
    monkeypatch.setenv("WORKER_AUTH_TOKEN", "worker-credential-for-tests")
    monkeypatch.setenv("WORKER_ID", "test-worker-1")
    monkeypatch.setenv("WORKER_CAPABILITIES", "fill_local")

    with pytest.raises(SystemExit) as raised:
        cli.main()

    assert raised.value.code == 2
    assert "fill_local" in capsys.readouterr().err


def test_worker_cli_reports_missing_configuration(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    for key in ("WORKER_API_BASE_URL", "WORKER_AUTH_TOKEN", "WORKER_ID"):
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(SystemExit) as raised:
        cli.main()

    assert raised.value.code == 2
    message = capsys.readouterr().err
    assert "missing required configuration" in message
    assert ".env.example" in message
