"""``job-getter-runner`` - the paired local desktop runner.

**Not implemented. It arrives in M4.**

``docs/spec/10_DEPLOYMENT.md`` names the command that must exist::

    uv run --project services/worker job-getter-runner pair --server http://localhost:3000

so the command exists, and it tells you plainly that it does not work yet. It
does not print a fake pairing code, it does not open a browser and it exits
non-zero.

That is deliberate. Invariant 10 - "No unsupported website may be presented as a
working integration" - and the delivery rule "Never replace missing backend
behavior with a button that reports success" both point the same way: a stub
that *looks* like it worked is worse than no stub, because the failure surfaces
later and somewhere else.

When it is built (M4, ADR05), it will:

* call ``POST /devices/pairing`` from an authenticated web session to get a
  single-use code, which you type in here rather than pass on the command line,
  so it never reaches your shell history;
* exchange that code at ``POST /devices/exchange`` for a scoped device token,
  stored in OS-protected local storage;
* poll the same internal task protocol as the container worker, but claim
  **only** ``fill_local`` tasks for its own owner;
* drive a **visible** browser on your desktop, inside your existing sessions,
  pausing at login, CAPTCHA and identity checks rather than working around
  them, and never performing the final submit.

No part of ``fill_local`` is implemented in this package, in either the runner
or the container worker.
"""

from __future__ import annotations

import argparse
import sys

MILESTONE = "M4"

NOT_IMPLEMENTED_MESSAGE = f"""\
job-getter-runner is not implemented yet. It is scheduled for milestone {MILESTONE}
(docs/spec/12_IMPLEMENTATION_PLAN.md).

Nothing was paired, no device token was created and no browser was opened.

When it ships, `job-getter-runner pair --server <url>` will:
  * ask you to approve the device in an authenticated web session,
  * take a single-use pairing code typed in interactively (never on the command
    line, so it stays out of your shell history),
  * exchange it for a scoped token that can claim only your own fill_local tasks,
  * and drive a visible browser on this desktop, pausing at login, CAPTCHA and
    identity checks, never submitting on your behalf.

Until then:
  * the container worker (`job-getter-worker`) handles parsing and, from M3,
    rendering. It deliberately cannot claim fill_local: a headless container has
    no access to your desktop browser (docs/spec/02_ARCHITECTURE.md, ADR05).
  * application packets can still be prepared and filled in by hand.
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="job-getter-runner",
        description=(
            "Local desktop browser runner for Job Getter. NOT IMPLEMENTED YET - "
            f"scheduled for {MILESTONE}."
        ),
    )
    subparsers = parser.add_subparsers(dest="command")

    pair = subparsers.add_parser(
        "pair",
        help=f"Pair this desktop with a Job Getter server (not implemented until {MILESTONE}).",
    )
    pair.add_argument(
        "--server",
        required=True,
        help="Base URL of your Job Getter server, for example http://localhost:3000",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Always reports that the runner is unavailable. That is the point."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help(sys.stderr)
        return 2

    print(NOT_IMPLEMENTED_MESSAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
