"""Discovery connector registry.

Only connectors listed here can be selected by a ``fetch_board`` task, and the
set is checked against the generated ``ConnectorId`` so an id the contract
does not know cannot be registered. Hosted mode loads reviewed code only
(``docs/spec/02_ARCHITECTURE.md``): there is no plugin discovery.
"""

from __future__ import annotations

from typing import Final

from ..contracts.generated import ConnectorId
from ..errors import TaskFailureError
from ..net import Fetcher
from .base import (
    Connector,
    ConnectorConfig,
    ConnectorDescriptor,
    ConnectorHealth,
    DiscoveryPage,
    RatePolicy,
    dedupe_by_source_key,
    source_key_for,
)
from .greenhouse import GreenhouseConnector
from .lever import LeverConnector

CONNECTOR_CLASSES: Final[dict[ConnectorId, type[Connector]]] = {
    ConnectorId.GREENHOUSE: GreenhouseConnector,
    ConnectorId.LEVER: LeverConnector,
}


def get_connector(connector: str, fetcher: Fetcher) -> Connector:
    """Instantiate the connector for a ``FetchBoardInput.connector`` value."""
    try:
        connector_id = ConnectorId(connector)
    except ValueError as error:
        raise TaskFailureError(
            "INPUT_INVALID", f"{connector!r} is not a connector id in the contract."
        ) from error
    cls = CONNECTOR_CLASSES.get(connector_id)
    if cls is None:
        raise TaskFailureError(
            "INPUT_INVALID",
            f"{connector_id.value!r} is not a board connector this worker implements. "
            f"Implemented: {sorted(item.value for item in CONNECTOR_CLASSES)}.",
        )
    return cls(fetcher)


__all__ = [
    "CONNECTOR_CLASSES",
    "Connector",
    "ConnectorConfig",
    "ConnectorDescriptor",
    "ConnectorHealth",
    "DiscoveryPage",
    "GreenhouseConnector",
    "LeverConnector",
    "RatePolicy",
    "dedupe_by_source_key",
    "get_connector",
    "source_key_for",
]
