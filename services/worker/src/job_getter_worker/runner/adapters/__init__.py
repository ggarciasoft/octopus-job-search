"""Site adapters, and the rule about which pages have one.

The registry holds only adapters that have been tested against a fixture of
the real form's shape. There is no generic "try our best on any page" adapter
and there will not be one: a page nobody has looked at is a page where the
runner cannot tell a salary question from a demographic one, and inventing a
best effort there is exactly what invariant 10 and AT17 forbid. A destination
with no adapter produces the ``unsupported`` outcome, which tells the user to
apply in their own browser and keeps their packet.

Two adapters exist, Greenhouse and Lever, each tested against a synthetic page
of its board's shape. No page may be claimed by both: Lever's form shares
Greenhouse's ``#application-form`` id, so the Greenhouse marker refuses a form
built from Lever's question blocks, and the suite asserts every fixture is
claimed by exactly one adapter.
"""

from __future__ import annotations

from .base import (
    CONFIRMATION_SCRIPT,
    Adapter,
    IdentityCheck,
    PageIdentity,
    check_identity,
    kind_from_raw,
    parse_fields,
    parse_identity,
)
from .greenhouse import GreenhouseAdapter
from .lever import LeverAdapter

#: Every adapter this build actually has. Order is preference order.
ADAPTERS: tuple[Adapter, ...] = (GreenhouseAdapter(), LeverAdapter())


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
    "CONFIRMATION_SCRIPT",
    "Adapter",
    "GreenhouseAdapter",
    "IdentityCheck",
    "LeverAdapter",
    "PageIdentity",
    "adapter_named",
    "check_identity",
    "kind_from_raw",
    "parse_fields",
    "parse_identity",
]
