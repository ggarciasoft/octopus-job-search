"""Exchanging a pairing code for a device token.

One HTTP call, against the only unauthenticated route in the public API. The
code is typed in interactively rather than passed as an argument, so it never
reaches a shell history or a process listing - the CLI enforces that, and this
module never sees where the code came from.

The token that comes back is written to the restricted store and is not printed
anywhere. If the runner loses it, pairing again is the recovery: the server
holds only a digest, so nothing can hand the value back a second time.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from ..contracts.generated import DeviceExchangeRequest, DeviceExchangeResponse

EXCHANGE_PATH = "/api/v1/devices/exchange"


class PairingError(RuntimeError):
    """The server refused the code, or could not be reached."""


@dataclass(frozen=True)
class PairingResult:
    device_id: str
    token: str
    expires_at: str
    allowed_origins: tuple[str, ...]


async def exchange_code(
    server: str,
    pairing_code: str,
    device_public_id: str,
    *,
    timeout_seconds: float = 20.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> PairingResult:
    """Redeem a single-use code. Never retried: the code is spent either way."""
    request = DeviceExchangeRequest(
        pairing_code=pairing_code.strip(),
        device_public_id=device_public_id,
    )
    async with httpx.AsyncClient(
        base_url=server.rstrip("/"),
        timeout=httpx.Timeout(timeout_seconds),
        transport=transport,
        follow_redirects=False,
    ) as client:
        try:
            response = await client.post(
                EXCHANGE_PATH,
                json=request.model_dump(mode="json"),
                headers={"accept": "application/json"},
            )
        except httpx.HTTPError as error:
            raise PairingError(f"{server} could not be reached: {error}") from error

    if response.status_code != 200:
        raise PairingError(_message_from(response))

    parsed = DeviceExchangeResponse.model_validate(response.json())
    return PairingResult(
        device_id=parsed.device_id,
        token=parsed.token,
        expires_at=parsed.expires_at,
        allowed_origins=tuple(parsed.allowed_origins),
    )


def _message_from(response: httpx.Response) -> str:
    """The server's own words where it gave any, never a guess at the cause."""
    try:
        payload = response.json()
    except ValueError:
        return f"The server answered HTTP {response.status_code}."
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    return f"The server answered HTTP {response.status_code}."
