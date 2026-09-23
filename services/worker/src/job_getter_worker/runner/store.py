"""Where the runner keeps its device token and its browser profile.

Both are credentials in everything but name: the token can claim this
workspace's fill work, and the profile holds whatever employer sessions the
user signed into inside that window. ``docs/spec/07_APPLICATION_AUTOMATION.md``
says to "store its isolated profile in a restricted local directory, outside
the app export and outside git", and the same goes for the token.

So: one directory under the platform's own per-user state location, holding
a 0600 JSON file and the Chromium profile. On POSIX the directory is 0700. On
Windows a mode means nothing, and the directory would otherwise inherit its
parent's ACL, which is not necessarily "only you": a machine can grant a local
group read access to every profile's AppData. So there the directory's
inherited entries are removed and access is granted to the current user,
SYSTEM and Administrators only, the last two being able to read anything
anyway. If that cannot be done, nothing is written.

It is deliberately not inside the repository, not inside the
workspace export and not anywhere a backup script reaches - a backup that
carried a live device token would hand out the runner's authority with the
restore.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: Layout under the state directory.
# A filename, not a credential; the linter only sees the word "token" nearby.
TOKEN_FILENAME = "device.json"  # noqa: S105
PROFILE_DIRNAME = "chromium-profile"


class PairingStoreError(RuntimeError):
    """The stored pairing is missing or unreadable."""


#: Well-known SIDs, which unlike group names do not change with the OS language.
_SYSTEM_SID = "S-1-5-18"
_ADMINISTRATORS_SID = "S-1-5-32-544"

Runner = Callable[..., subprocess.CompletedProcess[str]]


def _system_tool(name: str) -> str:
    """A Windows tool by its full path, so nothing earlier on PATH can stand in."""
    root = os.environ.get("SYSTEMROOT") or r"C:\Windows"
    return str(Path(root) / "System32" / name)


def restrict_windows_dir(path: Path, run: Runner = subprocess.run) -> None:
    """Make ``path`` accessible to the current user, SYSTEM and Administrators only.

    ``/inheritance:r`` drops every entry inherited from the parent, and Windows
    recomputes the inherited entries of everything already inside, so a token
    written by an older version is covered too. ``(OI)(CI)`` makes the grants
    apply to the files and folders created in it later.
    """
    try:
        who = run(
            [_system_tool("whoami.exe"), "/user", "/fo", "csv", "/nh"],
            capture_output=True,
            text=True,
            check=True,
        )
        sid = who.stdout.strip().rsplit(",", 1)[-1].strip().strip('"')
        if not sid.startswith("S-1-"):
            raise PairingStoreError(f"Could not determine your account's SID (got {sid!r}).")
        run(
            [
                _system_tool("icacls.exe"),
                str(path),
                "/inheritance:r",
                "/grant:r",
                f"*{sid}:(OI)(CI)F",
                f"*{_SYSTEM_SID}:(OI)(CI)F",
                f"*{_ADMINISTRATORS_SID}:(OI)(CI)F",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", None) or getattr(error, "stdout", None) or str(error)
        raise PairingStoreError(
            f"Could not restrict {path} to your account, so nothing was stored there: "
            f"{str(detail).strip()}"
        ) from error


def default_state_dir() -> Path:
    """The per-user state directory, following each platform's convention."""
    override = os.environ.get("JOB_GETTER_RUNNER_HOME")
    if override:
        return Path(override).expanduser()
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "JobGetter" / "runner"
    xdg = os.environ.get("XDG_STATE_HOME")
    base_path = Path(xdg) if xdg else Path.home() / ".local" / "state"
    return base_path / "job-getter" / "runner"


@dataclass(frozen=True)
class StoredPairing:
    """Everything the runner needs to act as a paired device."""

    server: str
    device_id: str
    token: str
    expires_at: str
    allowed_origins: tuple[str, ...]


class PairingStore:
    """Reads and writes the pairing file, and nothing else."""

    def __init__(self, state_dir: Path | None = None) -> None:
        self.state_dir = state_dir if state_dir is not None else default_state_dir()

    @property
    def token_path(self) -> Path:
        return self.state_dir / TOKEN_FILENAME

    @property
    def profile_dir(self) -> Path:
        return self.state_dir / PROFILE_DIRNAME

    def ensure_dir(self) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.secure()

    def secure(self) -> None:
        """Restrict the state directory to its owner. Idempotent."""
        if os.name == "posix":
            self.state_dir.chmod(0o700)
        elif os.name == "nt":
            restrict_windows_dir(self.state_dir)

    def save(self, pairing: StoredPairing) -> None:
        self.ensure_dir()
        payload: dict[str, Any] = {
            "server": pairing.server,
            "device_id": pairing.device_id,
            "token": pairing.token,
            "expires_at": pairing.expires_at,
            "allowed_origins": list(pairing.allowed_origins),
        }
        path = self.token_path
        # Written with the restrictive mode from the start rather than chmod'ed
        # afterwards: between the two there is a window where the token is
        # world-readable, and that window is the whole problem.
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)

    def load(self) -> StoredPairing:
        path = self.token_path
        if not path.exists():
            raise PairingStoreError(
                f"No pairing found at {path}. Run `job-getter-runner pair --server <url>` first."
            )
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise PairingStoreError(f"The pairing file at {path} could not be read.") from error
        try:
            return StoredPairing(
                server=str(data["server"]),
                device_id=str(data["device_id"]),
                token=str(data["token"]),
                expires_at=str(data["expires_at"]),
                allowed_origins=tuple(str(item) for item in data.get("allowed_origins", [])),
            )
        except KeyError as error:
            raise PairingStoreError(f"The pairing file at {path} is incomplete.") from error

    def clear(self) -> None:
        self.token_path.unlink(missing_ok=True)
