"""Command-line entry points.

The runner tests matter more than they look: invariant 10 and the delivery rule
"Never replace missing backend behavior with a button that reports success"
mean an unimplemented command must *say so* and fail, not print something
reassuring.
"""

from __future__ import annotations

import pytest

from job_getter_worker import cli, runner_cli


def test_runner_pair_is_honestly_unimplemented(capsys: pytest.CaptureFixture[str]) -> None:
    exit_code = runner_cli.main(["pair", "--server", "http://localhost:3000"])
    output = capsys.readouterr().err

    assert exit_code != 0, "an unimplemented command must not report success"
    assert "not implemented" in output.lower()
    assert runner_cli.MILESTONE in output
    assert "Nothing was paired" in output
    # It must not imply anything happened.
    assert "paired successfully" not in output.lower()
    assert "success" not in output.lower()


def test_runner_without_a_command_shows_help(capsys: pytest.CaptureFixture[str]) -> None:
    assert runner_cli.main([]) == 2
    assert "NOT IMPLEMENTED YET" in capsys.readouterr().err


def test_runner_help_says_the_command_does_not_work_yet() -> None:
    parser = runner_cli.build_parser()
    assert "NOT IMPLEMENTED YET" in (parser.description or "")


def test_fill_local_is_not_implemented_anywhere() -> None:
    """The container worker must not carry browser-filling code (ADR05)."""
    from job_getter_worker.handlers import build_default_registry

    registered = {task_type.value for task_type in build_default_registry().registered}
    assert registered == {"noop_echo", "parse_profile", "fetch_board", "fetch_job"}
    assert "fill_local" not in registered


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
