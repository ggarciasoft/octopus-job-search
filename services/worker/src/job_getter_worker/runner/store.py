"""Where the runner keeps its device token and its browser profile.

Both are credentials in everything but name: the token can claim this
workspace's fill work, and the profile holds whatever employer sessions the
user signed into inside that window. ``docs/spec/07_APPLICATION_AUTOMATION.md``
says to "store its isolated profile in a restricted local directory, outside
the app export and outside git", and the same goes for the token.

So: one directory under the platform's own per-user state location, created
0700 where the platform has POSIX modes, holding a 0600 JSON file and the
Chromium profile. It is deliberately not inside the repository, not inside the
workspace export and not anywhere a backup script reaches - a backup that
carried a live device token would hand out the runner's authority with the
restore.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: Layout under the state directory.
# A filename, not a credential; the linter only sees the word "token" nearby.
TOKEN_FILENAME = "device.json"  # noqa: S105
PROFILE_DIRNAME = "chromium-profile"


class PairingStoreError(RuntimeError):
    """The stored pairing is missing or unreadable."""


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
        if os.name == "posix":
            self.state_dir.chmod(0o700)

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
