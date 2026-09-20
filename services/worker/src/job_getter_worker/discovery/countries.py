"""A small, versioned table of country names to ISO-3166-1 alpha-2 codes.

``docs/spec/05_DISCOVERY_CONNECTORS.md`` wants ``country`` as an ISO code, and
the invariant behind everything in discovery is that nothing is invented. So
the table only contains names that are unambiguous: "Georgia" is absent
because it is also a US state, and "CA" is absent because it is both Canada
and California. A name that is not in the table yields ``None`` and the
original text is kept as the excerpt, which is the honest outcome.

The version is part of the normaliser's provenance. Bump it when the table
changes, so a job whose country changed can be traced to a table change
rather than to the posting.
"""

from __future__ import annotations

import re
from typing import Final

COUNTRY_TABLE_VERSION: Final = "2026-09-20.1"

_NAMES: Final[dict[str, str]] = {
    # English and Spanish names, common abbreviations. Lower-case keys.
    "united states": "US",
    "united states of america": "US",
    "usa": "US",
    "u.s.": "US",
    "u.s.a.": "US",
    "us": "US",
    "estados unidos": "US",
    "ee. uu.": "US",
    "ee.uu.": "US",
    "united kingdom": "GB",
    "uk": "GB",
    "u.k.": "GB",
    "great britain": "GB",
    "reino unido": "GB",
    "gb": "GB",
    "canada": "CA",
    "canadá": "CA",
    "mexico": "MX",
    "méxico": "MX",
    "spain": "ES",
    "españa": "ES",
    "germany": "DE",
    "deutschland": "DE",
    "alemania": "DE",
    "france": "FR",
    "francia": "FR",
    "italy": "IT",
    "italia": "IT",
    "portugal": "PT",
    "netherlands": "NL",
    "the netherlands": "NL",
    "países bajos": "NL",
    "belgium": "BE",
    "bélgica": "BE",
    "ireland": "IE",
    "irlanda": "IE",
    "switzerland": "CH",
    "suiza": "CH",
    "austria": "AT",
    "poland": "PL",
    "polonia": "PL",
    "sweden": "SE",
    "suecia": "SE",
    "norway": "NO",
    "noruega": "NO",
    "denmark": "DK",
    "dinamarca": "DK",
    "finland": "FI",
    "finlandia": "FI",
    "czech republic": "CZ",
    "czechia": "CZ",
    "greece": "GR",
    "grecia": "GR",
    "romania": "RO",
    "rumanía": "RO",
    "hungary": "HU",
    "hungría": "HU",
    "argentina": "AR",
    "brazil": "BR",
    "brasil": "BR",
    "chile": "CL",
    "colombia": "CO",
    "peru": "PE",
    "perú": "PE",
    "uruguay": "UY",
    "ecuador": "EC",
    "costa rica": "CR",
    "dominican republic": "DO",
    "república dominicana": "DO",
    "australia": "AU",
    "new zealand": "NZ",
    "nueva zelanda": "NZ",
    "india": "IN",
    "japan": "JP",
    "japón": "JP",
    "singapore": "SG",
    "singapur": "SG",
    "south africa": "ZA",
    "sudáfrica": "ZA",
    "israel": "IL",
    "united arab emirates": "AE",
    "uae": "AE",
    "philippines": "PH",
    "filipinas": "PH",
    "south korea": "KR",
    "republic of korea": "KR",
    "corea del sur": "KR",
    "türkiye": "TR",
    "turkey": "TR",
    "turquía": "TR",
}

_ALPHA2: Final = re.compile(r"^[A-Z]{2}$")
_REMOTE_WORDS: Final[frozenset[str]] = frozenset(
    {"remote", "remoto", "remota", "fully remote", "100% remote", "work from home", "wfh"}
)


def country_code(name: str) -> str | None:
    """Alpha-2 code for an unambiguous country name, else ``None``.

    An input that is already a two-letter upper-case code is accepted only if
    the table knows it, so ``"CA"`` (ambiguous) stays ``None`` while ``"US"``
    resolves.
    """
    cleaned = name.strip().strip(".,;:()[]").strip()
    if not cleaned:
        return None
    # A two-letter token goes through the same table: "US" and "UK" are keys,
    # "CA" is not, so the ambiguity is resolved by absence.
    return _NAMES.get(cleaned.lower())


_KNOWN_CODES: Final[frozenset[str]] = frozenset(_NAMES.values())


def iso_country(code: object) -> str | None:
    """Accept a *structured* ISO alpha-2 value the table knows, else ``None``.

    Only for fields documented to carry a country code (Lever ``country``,
    JSON-LD ``addressCountry``). Free text goes through :func:`country_code`,
    where ``"CA"`` must stay ambiguous.
    """
    if not isinstance(code, str):
        return None
    cleaned = code.strip().upper()
    if _ALPHA2.match(cleaned) and cleaned in _KNOWN_CODES:
        return cleaned
    return country_code(code)


def is_remote_word(token: str) -> bool:
    return token.strip().lower().strip(".,") in _REMOTE_WORDS


__all__ = ["COUNTRY_TABLE_VERSION", "country_code", "is_remote_word", "iso_country"]
