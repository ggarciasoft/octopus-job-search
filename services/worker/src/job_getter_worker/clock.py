"""Time helpers that produce contract-shaped timestamps."""

from __future__ import annotations

from datetime import UTC, datetime


def utc_now() -> datetime:
    return datetime.now(UTC)


def to_timestamp_string(moment: datetime) -> str:
    """Render an aware datetime as the contract's ``TimestampString``.

    The generated pattern accepts ``Z`` or ``+00:00``; ``Z`` is used because it
    is what the rest of the API emits.
    """
    return moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def utc_now_string() -> str:
    return to_timestamp_string(utc_now())


def parse_timestamp(value: str) -> datetime:
    """Parse a contract timestamp back into an aware datetime."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
