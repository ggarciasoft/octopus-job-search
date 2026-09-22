"""``job-getter-runner`` - the paired local desktop runner.

``docs/spec/10_DEPLOYMENT.md`` names the command::

    uv run --project services/worker job-getter-runner pair --server http://localhost:3000
    uv run --project services/worker job-getter-runner run

``pair`` reads a single-use code from the terminal - never from an argument, so
it stays out of shell history and out of the process list - and exchanges it
for a scoped device token stored under a restricted per-user directory.

``run`` polls the same internal task protocol as the container worker, with two
differences that are the whole point of this process existing: it presents a
device token rather than the operator credential, so it can claim only
``fill_local`` and only its owner's, and it drives a **visible** Chromium it
owns. The user logs in, solves challenges and presses submit in that window.
This process never does.

``status`` prints what is paired, without printing the token.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import platform
import socket
import sys
from pathlib import Path

from pydantic import SecretStr

from .api import TaskApiClient
from .contracts.generated import TaskType
from .logging import configure_logging, get_logger
from .runner import build_runner_registry
from .runner.browser import BrowserOptions, BrowserUnavailableError, RunnerBrowser
from .runner.pairing import PairingError, exchange_code
from .runner.store import PairingStore, PairingStoreError, StoredPairing
from .settings import WorkerSettings
from .worker import Worker

_log = get_logger("job_getter_worker.runner_cli")

#: Ceiling on the CV this runner will download and attach.
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


def device_public_id() -> str:
    """How this machine names itself to the server. No secrets, no user id."""
    return f"{platform.system().lower()}-{socket.gethostname()}"[:200]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="job-getter-runner",
        description=(
            "Local desktop browser runner for Job Getter. Fills approved application "
            "packets into supported forms and stops before the final submit."
        ),
    )
    subparsers = parser.add_subparsers(dest="command")

    pair = subparsers.add_parser("pair", help="Pair this desktop with a Job Getter server.")
    pair.add_argument(
        "--server",
        required=True,
        help="Base URL of your Job Getter server, for example http://localhost:3000",
    )
    pair.add_argument(
        "--state-dir",
        default=None,
        help="Where to keep the device token and browser profile. Defaults to your "
        "per-user state directory.",
    )

    run = subparsers.add_parser("run", help="Poll for fill work and drive the browser.")
    run.add_argument("--state-dir", default=None)
    run.add_argument(
        "--headless",
        action="store_true",
        help="Run Chromium without a window. Intended for tests; you cannot log in, "
        "solve a challenge or submit in a browser you cannot see.",
    )

    status = subparsers.add_parser("status", help="Show what this desktop is paired with.")
    status.add_argument("--state-dir", default=None)
    return parser


def _store(state_dir: str | None) -> PairingStore:
    return PairingStore(Path(state_dir).expanduser() if state_dir else None)


# ---------------------------------------------------------------------------
# pair
# ---------------------------------------------------------------------------


def command_pair(server: str, store: PairingStore) -> int:
    print(
        "Open Job Getter in your browser, go to Settings -> Devices, and create a\n"
        "pairing code for this machine. The code is valid for five minutes.\n"
    )
    try:
        code = getpass.getpass("Pairing code (not echoed): ").strip()
    except (EOFError, KeyboardInterrupt):  # pragma: no cover - interactive only
        print("\nNothing was paired.", file=sys.stderr)
        return 130
    if code == "":
        print("job-getter-runner: no code entered. Nothing was paired.", file=sys.stderr)
        return 2

    try:
        result = asyncio.run(exchange_code(server, code, device_public_id()))
    except PairingError as error:
        print(f"job-getter-runner: {error}", file=sys.stderr)
        return 1

    store.save(
        StoredPairing(
            server=server.rstrip("/"),
            device_id=result.device_id,
            token=result.token,
            expires_at=result.expires_at,
            allowed_origins=result.allowed_origins,
        )
    )
    print(
        f"Paired. Device {result.device_id}, token valid until {result.expires_at}.\n"
        f"Stored in {store.token_path} (readable only by you).\n"
        "Start filling with: job-getter-runner run"
    )
    return 0


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------


async def _run_loop(pairing: StoredPairing, store: PairingStore, *, headless: bool) -> None:
    settings = WorkerSettings(
        api_base_url=pairing.server,
        # The runner never holds the operator credential. The field is required
        # by the shared settings model, so it is explicitly empty here rather
        # than quietly populated from the environment.
        auth_token=SecretStr(""),
        worker_id=f"runner-{pairing.device_id}",
        capabilities=f"{TaskType.FILL_LOCAL.value},{TaskType.OBSERVE_CONFIRMATION.value}",
        max_download_bytes=_MAX_ATTACHMENT_BYTES,
    )

    browser = RunnerBrowser(BrowserOptions(profile_dir=store.profile_dir, headless=headless))
    await browser.start()
    try:
        async with TaskApiClient(
            pairing.server,
            "",
            timeout_seconds=settings.request_timeout_seconds,
            max_download_bytes=_MAX_ATTACHMENT_BYTES,
            device_token=pairing.token,
            user_agent="job-getter-runner/0",
        ) as api:
            worker = Worker(settings, api, build_runner_registry(browser, pairing.device_id))
            worker.install_signal_handlers()
            await worker.run_forever()
    finally:
        await browser.aclose()


def command_run(store: PairingStore, *, headless: bool) -> int:
    try:
        pairing = store.load()
    except PairingStoreError as error:
        print(f"job-getter-runner: {error}", file=sys.stderr)
        return 2

    try:
        asyncio.run(_run_loop(pairing, store, headless=headless))
    except BrowserUnavailableError as error:
        print(f"job-getter-runner: {error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:  # pragma: no cover - interactive only
        return 130
    return 0


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------


def command_status(store: PairingStore) -> int:
    try:
        pairing = store.load()
    except PairingStoreError as error:
        print(f"job-getter-runner: {error}", file=sys.stderr)
        return 2
    origins = ", ".join(pairing.allowed_origins) or "(resolved per fill)"
    print(
        f"Server:   {pairing.server}\n"
        f"Device:   {pairing.device_id}\n"
        f"Expires:  {pairing.expires_at}\n"
        f"Origins:  {origins}\n"
        f"Profile:  {store.profile_dir}"
    )
    # The token itself is never printed. It exists on disk and nowhere else.
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help(sys.stderr)
        return 2

    configure_logging("info")
    store = _store(getattr(args, "state_dir", None))

    if args.command == "pair":
        return command_pair(args.server, store)
    if args.command == "run":
        return command_run(store, headless=bool(args.headless))
    if args.command == "status":
        return command_status(store)
    parser.print_help(sys.stderr)  # pragma: no cover - argparse covers this
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
