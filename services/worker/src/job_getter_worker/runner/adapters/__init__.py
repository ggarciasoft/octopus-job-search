"""Site adapters, and the rule about which pages have one.

The registry holds only adapters that have been tested against a fixture of
the real form's shape. There is no generic "try our best on any page" adapter
and there will not be one: a page nobody has looked at is a page where the
runner cannot tell a salary question from a demographic one, and inventing a
best effort there is exactly what invariant 10 and AT17 forbid. A destination
with no adapter produces the ``unsupported`` outcome, which tells the user to
apply in their own browser and keeps their packet.

Lever is the spec's second target and is deliberately absent until it has the
same fixture-backed test Greenhouse has.
"""

from __future__ import annotations

from .base import (
    Adapter,
    IdentityCheck,
    PageIdentity,
    check_identity,
    kind_from_raw,
    parse_fields,
    parse_identity,
)
from .greenhouse import GreenhouseAdapter

#: Every adapter this build actually has. Order is preference order.
ADAPTERS: tuple[Adapter, ...] = (GreenhouseAdapter(),)


def adapter_named(name: str | None) -> Adapter | None:
    """Look one up by connector name, for the hint the packet carries."""
    if name is None:
        return None
    for adapter in ADAPTERS:
        if adapter.name == name:
            return adapter
    return None


__all__ = [
    "ADAPTERS",
    "Adapter",
    "GreenhouseAdapter",
    "IdentityCheck",
    "PageIdentity",
    "adapter_named",
    "check_identity",
    "kind_from_raw",
    "parse_fields",
    "parse_identity",
]
