"""The runner's state directory is its owner's alone, on Windows too.

The directory holds the device token and the browser profile with the user's
employer sessions. On POSIX a mode does it. On Windows a mode means nothing and
the directory inherits its parent's ACL, and on a real machine that parent can
grant a local group read access, so the restriction is done explicitly and
checked here against the security descriptor Windows actually stores.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from job_getter_worker.runner import store as store_module
from job_getter_worker.runner.store import (
    PairingStore,
    PairingStoreError,
    StoredPairing,
    restrict_windows_dir,
)

PAIRING = StoredPairing(
    server="http://127.0.0.1:3000",
    device_id="00000000-0000-4000-8000-000000000000",
    token="jgd_secret-token-value",
    expires_at="2026-10-22T00:00:00.000Z",
    allowed_origins=(),
)


class FakeRun:
    def __init__(self, whoami: str = '"host\\person","S-1-5-21-1-2-3-1001"\n') -> None:
        self.whoami = whoami
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        assert kwargs.get("shell") is not True
        self.calls.append(args)
        stdout = self.whoami if args[0].lower().endswith("whoami.exe") else ""
        return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")


def test_it_drops_inheritance_and_grants_only_the_user_system_and_administrators(
    tmp_path: Path,
) -> None:
    run = FakeRun()
    restrict_windows_dir(tmp_path, run=run)

    whoami, icacls = run.calls
    assert whoami[0].lower().endswith(os.path.join("system32", "whoami.exe"))
    assert icacls[0].lower().endswith(os.path.join("system32", "icacls.exe"))
    assert icacls[1:] == [
        str(tmp_path),
        "/inheritance:r",
        "/grant:r",
        "*S-1-5-21-1-2-3-1001:(OI)(CI)F",
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F",
    ]


def test_an_unreadable_account_is_refused_rather_than_guessed(tmp_path: Path) -> None:
    with pytest.raises(PairingStoreError, match="SID"):
        restrict_windows_dir(tmp_path, run=FakeRun(whoami="nonsense\n"))


def test_a_failed_restriction_is_reported_with_the_tool_s_own_words(tmp_path: Path) -> None:
    def failing(args: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        if args[0].lower().endswith("icacls.exe"):
            raise subprocess.CalledProcessError(5, args, output="", stderr="Access is denied.")
        return subprocess.CompletedProcess(args, 0, stdout='"h\\p","S-1-5-21-9"', stderr="")

    with pytest.raises(PairingStoreError, match="Access is denied"):
        restrict_windows_dir(tmp_path, run=failing)


def test_nothing_is_written_when_the_directory_cannot_be_restricted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(self: PairingStore) -> None:
        raise PairingStoreError("could not restrict")

    monkeypatch.setattr(PairingStore, "secure", refuse)
    store = PairingStore(tmp_path / "state")

    with pytest.raises(PairingStoreError):
        store.save(PAIRING)
    assert not store.token_path.exists()


def sddl(path: Path) -> str:
    result = subprocess.run(  # noqa: S603
        [
            os.path.join(
                os.environ.get("SYSTEMROOT", r"C:\Windows"),
                "System32",
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe",
            ),
            "-NoProfile",
            "-Command",
            f"(Get-Acl -LiteralPath '{path}').Sddl",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def my_sid() -> str:
    who = subprocess.run(  # noqa: S603
        [store_module._system_tool("whoami.exe"), "/user", "/fo", "csv", "/nh"],
        capture_output=True,
        text=True,
        check=True,
    )
    return who.stdout.strip().rsplit(",", 1)[-1].strip().strip('"')


@pytest.mark.skipif(os.name != "nt", reason="Windows ACLs")
def test_on_windows_a_parent_that_lets_everyone_read_no_longer_reaches_the_token(
    tmp_path: Path,
) -> None:
    parent = tmp_path / "shared"
    parent.mkdir()
    # The situation being defended against: a parent readable by others.
    subprocess.run(  # noqa: S603
        [store_module._system_tool("icacls.exe"), str(parent), "/grant", "*S-1-1-0:(OI)(CI)R"],
        capture_output=True,
        check=True,
    )
    state = parent / "runner"
    state.mkdir()
    # A token written by an older version, before the directory was restricted.
    (state / "device.json").write_text("{}", encoding="utf-8")
    assert "WD" in sddl(state / "device.json")

    store = PairingStore(state)
    store.save(PAIRING)

    for path in (state, store.token_path):
        descriptor = sddl(path)
        dacl = descriptor.split("D:", 1)[1]
        assert "WD" not in dacl, f"Everyone can still reach {path}: {descriptor}"
        assert my_sid() in dacl
        # Protected: nothing inherited from the parent any more.
        assert dacl.startswith("P") or path != state, descriptor
