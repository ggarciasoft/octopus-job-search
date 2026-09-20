"""Raw connector data -> ``NormalizedJob``.

The rule, from ``packages/contracts/src/schemas/jobs.ts``: *nothing is
invented*. Concretely:

* A value read from a **structured** field (an API field, a JSON-LD property)
  is used as-is after validation. Mapping ``"United States"`` to ``"US"``
  through the versioned table is normalisation, not inference.
* A value derived from **free text** by a heuristic is an *inference*. It is
  used only when the excerpt it came from is recorded in ``inferred``, and a
  ``FIELD_INFERRED`` warning names the field - without quoting the text.
* Anything the source does not state is ``None`` / ``unknown``. A remote job
  is not "open anywhere"; a salary with no currency has ``currency=None`` and
  is never converted; a missing date is ``None``.

Text addressed to an AI system (AT09) is excluded from every heuristic. It
stays in ``description_text`` as data, because the description *is* what the
page said, but no field is ever derived from it.

``content_hash`` is documented at :func:`compute_content_hash`.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Final, Literal

from ..clock import to_timestamp_string
from ..contracts.generated import (
    FetchWarning,
    InferredField,
    JobLocation,
    JobRequirement,
    JobSalary,
    NormalizedJob,
)
from ..profile.sanitize import INJECTION_PATTERNS
from .countries import COUNTRY_TABLE_VERSION, country_code, is_remote_word, iso_country

NORMALIZER_VERSION: Final = f"1+{COUNTRY_TABLE_VERSION}"

RemoteType = Literal["remote", "hybrid", "onsite", "unknown"]
EmploymentTypeLiteral = Literal[
    "full_time", "part_time", "contract", "internship", "temporary", "freelance"
]
SalaryPeriod = Literal["year", "month", "week", "day", "hour"]
RequirementKind = Literal["required", "preferred", "unknown"]

#: Contract maxima, kept next to the code that enforces them.
MAX_TITLE: Final = 300
MAX_COMPANY: Final = 200
MAX_DESCRIPTION: Final = 200_000
MAX_URL: Final = 2000
MAX_EXCERPT: Final = 300
MAX_EVIDENCE: Final = 600
MAX_LOCATIONS: Final = 50
MAX_REQUIREMENTS: Final = 200
MAX_INFERRED: Final = 20


def make_warning(code: str, message: str, detail: str | None = None) -> FetchWarning:
    """Build a ``FetchWarning`` through the generated model's own validation.

    ``model_validate`` lets the contract's closed code set do the checking, the
    same way ``errors.py`` builds a ``FailRequest``.
    """
    payload: dict[str, Any] = {"code": code, "message": message[:500], "detail": detail}
    return FetchWarning.model_validate(payload)


# ---------------------------------------------------------------------------
# raw input


@dataclass(frozen=True)
class RawLocation:
    """A location as the source stated it.

    ``name`` is free text from a structured *location* field. ``country``,
    ``region`` and ``city`` are set only when the source has separate fields.
    """

    name: str | None = None
    country: str | None = None
    region: str | None = None
    city: str | None = None


@dataclass(frozen=True)
class RawSalary:
    """A salary from a structured field, already validated by the connector."""

    min: float | None
    max: float | None
    currency: str | None
    period: SalaryPeriod | None
    source_excerpt: str


@dataclass(frozen=True)
class RawSection:
    """A titled list the source provides as structure (Lever ``lists``)."""

    heading: str
    items: tuple[str, ...]


@dataclass(frozen=True)
class RawJob:
    external_id: str
    source_key: str
    canonical_url: str
    apply_url: str | None
    company: str
    title: str
    description_text: str
    retrieved_at: datetime
    published_at: datetime | None = None
    updated_at: datetime | None = None
    locations: tuple[RawLocation, ...] = ()
    remote_type: RemoteType | None = None
    eligible_countries: tuple[str, ...] | None = None
    employment_type: EmploymentTypeLiteral | None = None
    salary: RawSalary | None = None
    language: str | None = None
    sections: tuple[RawSection, ...] = ()


@dataclass
class NormalizedResult:
    job: NormalizedJob
    warnings: list[FetchWarning] = field(default_factory=list)


# ---------------------------------------------------------------------------
# text hygiene


#: Typographic characters the heuristics accept, named so the source stays
#: ASCII: en dash, em dash, right single quote, bullet, middle dot.
_DASHES: Final = chr(0x2013) + chr(0x2014)
_RSQUO: Final = chr(0x2019)
_BULLET_CHARS: Final = chr(0x2022) + chr(0xB7) + _DASHES

#: Bullet markers: hyphen, asterisk, bullet, middle dot, en dash, em dash.
_BULLET: Final = re.compile(rf"^\s*(?:[-*{_BULLET_CHARS}]|\d+[.)])\s+")
_SENTENCE_SPLIT: Final = re.compile(r"(?<=[.!?;])\s+|\n+")
_WS: Final = re.compile(r"\s+")


def _excerpt(text: str, limit: int = MAX_EXCERPT) -> str:
    collapsed = _WS.sub(" ", text).strip()
    return collapsed[:limit] if collapsed else ""


def strip_injected_text(text: str) -> tuple[str, bool]:
    """Remove paragraphs that address an AI system from the *inference* text.

    A paragraph starts being dropped at the first line matching an injection
    pattern and stops at the next blank line. The description itself is not
    changed by this; only what the heuristics may read.
    """
    kept: list[str] = []
    dropping = False
    detected = False
    for line in text.split("\n"):
        if dropping:
            if not line.strip():
                dropping = False
                kept.append(line)
            continue
        if any(pattern.search(line) for pattern in INJECTION_PATTERNS):
            dropping = True
            detected = True
            continue
        kept.append(line)
    return "\n".join(kept), detected


def _sentences(text: str) -> list[str]:
    return [item.strip() for item in _SENTENCE_SPLIT.split(text) if item and item.strip()]


# ---------------------------------------------------------------------------
# locations and remote


_LOCATION_SEPARATORS: Final = re.compile(rf"\s*(?:,|/|\||;|\(|\)|\s[-{_DASHES}]\s)\s*")


def parse_location_name(name: str) -> tuple[JobLocation, bool]:
    """Split ``"Remote - US"`` / ``"Berlin, Germany"`` into a location.

    Returns the location and whether the name carries a remote word. Country
    comes only from the table; an unresolved trailing token becomes ``region``
    (a field the source stated, whose meaning is left to the reader) and
    nothing is guessed from it.
    """
    tokens = [token.strip() for token in _LOCATION_SEPARATORS.split(name) if token.strip()]
    remote = any(is_remote_word(token) for token in tokens)
    tokens = [token for token in tokens if not is_remote_word(token)]

    country: str | None = None
    region: str | None = None
    city: str | None = None
    if tokens:
        resolved = country_code(tokens[-1])
        if resolved is not None:
            country = resolved
            tokens = tokens[:-1]
    if tokens:
        city = tokens[0][:120]
        if len(tokens) > 1:
            region = ", ".join(tokens[1:])[:120]
    return (
        JobLocation(country=country, region=region, city=city, source_excerpt=_excerpt(name)),
        remote,
    )


_REMOTE_TEXT: Final[tuple[tuple[re.Pattern[str], RemoteType], ...]] = (
    (
        re.compile(
            r"\b(?:fully|100%|completely)\s+remote\b|\bremote[- ]first\b|"
            r"\bthis (?:role|position|job) is (?:fully )?remote\b|\bwork from anywhere\b|"
            r"\b(?:totalmente|100%)\s+remoto\b",
            re.I,
        ),
        "remote",
    ),
    (re.compile(r"\bhybrid\b|\bh[íi]brido\b", re.I), "hybrid"),
    (
        re.compile(r"\b(?:on[- ]?site|in[- ]office|in[- ]person)\s+(?:role|position|only)\b", re.I),
        "onsite",
    ),
)


def _infer_remote_type(text: str) -> tuple[RemoteType, str] | None:
    found: dict[RemoteType, str] = {}
    for sentence in _sentences(text):
        for pattern, kind in _REMOTE_TEXT:
            if kind not in found and pattern.search(sentence):
                found[kind] = sentence
    if len(found) != 1:
        # Nothing, or conflicting signals: the honest answer is unknown.
        return None
    kind, sentence = next(iter(found.items()))
    return kind, sentence


# ---------------------------------------------------------------------------
# eligibility


_COUNTRY_CAPTURE: Final = r"(?P<c>[A-Za-z][A-Za-z. ]{1,39}?)"
_CAPTURE_END: Final = r"(?=[.,;:!?)\n]|$|\s+(?:and|or|to|with|without|who|for|at|as|on|in)\b)"
_ELIGIBILITY_TEXT: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(
        r"\b(?:must|need to|needs to|required to|have to)\s+(?:be\s+)?"
        r"(?:physically\s+|currently\s+)?"
        r"(?:located|based|reside|residing|live|living)\s+(?:in|within)\s+(?:the\s+)?"
        + _COUNTRY_CAPTURE
        + _CAPTURE_END,
        re.I,
    ),
    re.compile(
        r"\b(?:only\s+)?(?:open|available|offered)\s+(?:only\s+)?to\s+"
        r"(?:candidates|applicants|those|people|individuals)\s+(?:who\s+are\s+)?"
        r"(?:currently\s+)?(?:located|based|residing|living)\s+(?:in|within)\s+(?:the\s+)?"
        + _COUNTRY_CAPTURE
        + _CAPTURE_END,
        re.I,
    ),
    re.compile(
        r"\b(?:authori[sz]ed|eligible|legally\s+(?:authori[sz]ed|able))\s+to\s+work\s+in\s+"
        r"(?:the\s+)?" + _COUNTRY_CAPTURE + _CAPTURE_END,
        re.I,
    ),
    re.compile(r"\b(?P<c>[A-Z][A-Za-z.]{1,30})[- ]only\b"),
)


def _infer_eligible_countries(text: str) -> tuple[list[str], str] | None:
    for sentence in _sentences(text):
        for pattern in _ELIGIBILITY_TEXT:
            match = pattern.search(sentence)
            if match is None:
                continue
            code = _resolve_country_phrase(match.group("c"))
            if code is not None:
                return [code], sentence
    return None


def _resolve_country_phrase(phrase: str) -> str | None:
    """The country named inside a captured phrase, longest window first.

    "the United States" -> "United States"; "US without sponsorship" -> "US".
    Only a window the table knows resolves; nothing else is guessed.
    """
    words = phrase.strip().split()
    for size in range(min(len(words), 4), 0, -1):
        for start in range(0, len(words) - size + 1):
            code = country_code(" ".join(words[start : start + size]))
            if code is not None:
                return code
    return None


# ---------------------------------------------------------------------------
# salary


_CURRENCY_TOKENS: Final[dict[str, str | None]] = {
    "USD": "USD",
    "US$": "USD",
    "EUR": "EUR",
    "€": "EUR",
    "GBP": "GBP",
    "£": "GBP",
    "CAD": "CAD",
    "CA$": "CAD",
    "C$": "CAD",
    "AUD": "AUD",
    "A$": "AUD",
    "MXN": "MXN",
    "CHF": "CHF",
    "BRL": "BRL",
    "R$": "BRL",
    "ARS": "ARS",
    "COP": "COP",
    "CLP": "CLP",
    "INR": "INR",
    "₹": "INR",
    "JPY": "JPY",
    "SEK": "SEK",
    "NOK": "NOK",
    "DKK": "DKK",
    "PLN": "PLN",
    # Ambiguous symbols: a currency marker was present, so the figure is a
    # salary, but the code stays None because several currencies share them.
    "$": None,
    "¥": None,
}
_CURRENCY_RE: Final = "|".join(
    re.escape(token) for token in sorted(_CURRENCY_TOKENS, key=len, reverse=True)
)
_NUMBER_RE: Final = r"\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d{1,2})?"
_SALARY_RE: Final = re.compile(
    rf"(?P<c1>{_CURRENCY_RE})?\s*(?P<n1>{_NUMBER_RE})\s*(?P<k1>[kK])?(?![A-Za-z%])"
    rf"\s*(?P<c2>{_CURRENCY_RE})?"
    rf"(?:\s*(?:-|[{_DASHES}]|to|a|hasta|and)\s*(?P<c3>{_CURRENCY_RE})?\s*(?P<n2>{_NUMBER_RE})"
    rf"\s*(?P<k2>[kK])?(?![A-Za-z%])\s*(?P<c4>{_CURRENCY_RE})?)?"
)
_PERIOD_RE: Final = re.compile(
    r"(?:\bper\s+|/\s*|\ba\s+|\bal\s+|\bpor\s+)?\b(?P<p>annum|year|yr|años?|anual(?:es)?|"
    r"month|mes|mensual(?:es)?|week|semana|semanal(?:es)?|day|d[ií]a|diario|hour|hr|hora|"
    r"annually|yearly|monthly|weekly|daily|hourly|pa)\b",
    re.I,
)
_PERIOD_MAP: Final[dict[str, SalaryPeriod]] = {
    "annum": "year",
    "year": "year",
    "yr": "year",
    "año": "year",
    "años": "year",
    "anual": "year",
    "anuales": "year",
    "annually": "year",
    "yearly": "year",
    "pa": "year",
    "month": "month",
    "mes": "month",
    "mensual": "month",
    "mensuales": "month",
    "monthly": "month",
    "week": "week",
    "semana": "week",
    "semanal": "week",
    "semanales": "week",
    "weekly": "week",
    "day": "day",
    "día": "day",
    "dia": "day",
    "diario": "day",
    "daily": "day",
    "hour": "hour",
    "hr": "hour",
    "hora": "hour",
    "hourly": "hour",
}
#: A figure below this for the period is not a salary ("$5 per day parking").
_PLAUSIBLE_MINIMUM: Final[dict[SalaryPeriod, float]] = {
    "year": 1000,
    "month": 100,
    "week": 50,
    "day": 20,
    "hour": 1,
}


def _parse_number(raw: str, thousands_suffix: str | None) -> float:
    cleaned = raw
    if re.fullmatch(r"\d{1,3}(?:[,.]\d{3})+", raw):
        cleaned = re.sub(r"[,.]", "", raw)
    value = float(cleaned)
    if thousands_suffix:
        value *= 1000
    return value


def _infer_salary(text: str) -> tuple[JobSalary, str] | None:
    """Salary only from explicit text with a currency marker *and* a period."""
    for sentence in _sentences(text):
        period_match = _PERIOD_RE.search(sentence)
        if period_match is None:
            continue
        period = _PERIOD_MAP[period_match.group("p").lower()]
        for match in _SALARY_RE.finditer(sentence):
            present = [
                token for token in (match.group(n) for n in ("c1", "c2", "c3", "c4")) if token
            ]
            if not present:
                continue
            codes = {_CURRENCY_TOKENS[token] for token in present}
            currency = next(iter(codes)) if len(codes) == 1 else None
            low = _parse_number(match.group("n1"), match.group("k1"))
            high = _parse_number(match.group("n2"), match.group("k2")) if match.group("n2") else low
            if high < low:
                low, high = high, low
            if low < _PLAUSIBLE_MINIMUM[period]:
                continue
            excerpt = _excerpt(sentence)
            return (
                JobSalary(
                    min=low, max=high, currency=currency, period=period, source_excerpt=excerpt
                ),
                sentence,
            )
    return None


# ---------------------------------------------------------------------------
# requirements


_HEADING_MAX: Final = 70
_REQUIRED_HEADING: Final = re.compile(
    r"^(?:minimum |basic |required |core |key |essential |technical )?"
    r"(?:requirements?|qualifications?|skills? (?:and|&) (?:experience|qualifications?)|"
    rf"what you(?:'|{_RSQUO})?ll need|what you need|what we(?:'|{_RSQUO})?re looking for|"
    rf"must[- ]haves?|you have|you bring|you(?:'|{_RSQUO})?ll bring|we expect|"
    r"requisitos|lo que necesitas|lo que buscamos|qu[ée] buscamos)\b",
    re.I,
)
_PREFERRED_HEADING: Final = re.compile(
    r"^(?:nice[- ]to[- ]haves?|preferred(?: qualifications| skills| experience)?|"
    r"bonus(?: points| skills)?|pluses|a plus|good to have|it would be great if|"
    r"deseable|valorable|se valorar[áa]|preferible|extras?)\b",
    re.I,
)
_UNKNOWN_HEADING: Final = re.compile(
    r"^(?:about you|your profile|who you are|skills|experience|perfil|sobre ti|tu perfil)\b", re.I
)
_OTHER_HEADING: Final = re.compile(
    rf"^(?:responsibilities|what you(?:'|{_RSQUO})?ll do|the role|"
    r"about (?:us|the (?:role|team|company))|"
    r"benefits|perks|compensation|salary|how to apply|equal opportunity|our values|the team|"
    r"funciones|responsabilidades|beneficios|sobre nosotros|qu[ée] har[áa]s)\b",
    re.I,
)


def _heading_kind(line: str) -> RequirementKind | Literal["other"] | None:
    stripped = line.strip()
    if not stripped or len(stripped) > _HEADING_MAX or _BULLET.match(stripped):
        return None
    if stripped.endswith((".", "!", "?")):
        return None
    if _PREFERRED_HEADING.match(stripped):
        return "preferred"
    if _REQUIRED_HEADING.match(stripped):
        return "required"
    if _UNKNOWN_HEADING.match(stripped):
        return "unknown"
    if _OTHER_HEADING.match(stripped) or stripped.endswith(":"):
        return "other"
    return None


def _classify_heading(heading: str) -> RequirementKind | None:
    kind = _heading_kind(heading)
    if kind is None or kind == "other":
        return None
    return kind


def _requirements_from_text(text: str) -> tuple[list[JobRequirement], str | None]:
    """Split explicit requirement sections out of the description.

    A section starts at a recognised heading. Inside it, bullet lines are
    items; once bullets have begun, the first non-bullet line ends the
    section. A section with no bullets takes plain lines up to the first
    blank line, so a heading can never swallow the rest of the posting.
    """
    requirements: list[JobRequirement] = []
    current: RequirementKind | None = None
    bulleted = False
    section_items = 0
    first_heading: str | None = None

    for line in text.split("\n"):
        kind = _heading_kind(line)
        if kind is not None:
            current = None if kind == "other" else kind
            bulleted = False
            section_items = 0
            if current is not None and first_heading is None:
                first_heading = line.strip()
            continue
        if current is None:
            continue
        if not line.strip():
            if not bulleted and section_items:
                current = None
            continue
        is_bullet = bool(_BULLET.match(line))
        if bulleted and not is_bullet:
            current = None
            continue
        bulleted = bulleted or is_bullet
        section_items += 1
        item = _BULLET.sub("", line).strip()
        requirements.append(
            JobRequirement(
                text=item[:MAX_EVIDENCE],
                kind=current,
                evidence_excerpt=line.strip()[:MAX_EVIDENCE],
            )
        )
        if len(requirements) >= MAX_REQUIREMENTS:
            break
    return requirements, first_heading


def _requirements_from_sections(
    sections: tuple[RawSection, ...],
) -> tuple[list[JobRequirement], str | None]:
    requirements: list[JobRequirement] = []
    first_heading: str | None = None
    for section in sections:
        kind = _classify_heading(section.heading)
        if kind is None:
            continue
        if first_heading is None:
            first_heading = section.heading.strip()
        for item in section.items:
            cleaned = _WS.sub(" ", item).strip()
            if not cleaned:
                continue
            requirements.append(
                JobRequirement(
                    text=cleaned[:MAX_EVIDENCE],
                    kind=kind,
                    evidence_excerpt=f"{section.heading.strip()}: {cleaned}"[:MAX_EVIDENCE],
                )
            )
            if len(requirements) >= MAX_REQUIREMENTS:
                return requirements, first_heading
    return requirements, first_heading


# ---------------------------------------------------------------------------
# language


_STOPWORDS: Final[dict[str, frozenset[str]]] = {
    "en": frozenset(
        [
            "the",
            "and",
            "with",
            "for",
            "you",
            "will",
            "our",
            "are",
            "this",
            "that",
            "from",
            "have",
            "experience",
            "team",
            "work",
            "role",
            "years",
        ]
    ),
    "es": frozenset(
        [
            "el",
            "la",
            "los",
            "las",
            "con",
            "para",
            "que",
            "del",
            "una",
            "por",
            "experiencia",
            "equipo",
            "nuestro",
            "trabajo",
            "años",
            "puesto",
            "buscamos",
        ]
    ),
}
_WORD: Final = re.compile(r"[a-záéíóúñü]+", re.I)


def _infer_language(text: str) -> tuple[str, str] | None:
    words = [word.lower() for word in _WORD.findall(text)]
    if len(words) < 20:
        return None
    scores = {code: sum(1 for word in words if word in stop) for code, stop in _STOPWORDS.items()}
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best, second = ranked[0], ranked[1]
    if best[1] < 5 or best[1] < 2 * max(second[1], 1):
        return None
    first_line = next((line for line in text.split("\n") if line.strip()), "")
    return best[0], first_line


# ---------------------------------------------------------------------------
# content hash


def _canonical_ws(text: str) -> str:
    return _WS.sub(" ", text).strip()


def compute_content_hash(
    *,
    title: str,
    company: str,
    description_text: str,
    locations: list[JobLocation],
    salary: JobSalary | None,
    apply_url: str | None,
) -> str:
    """SHA-256 of the fields whose change counts as the job changing.

    The canonical form is stable and documented so the API can rely on it:

    ``{"v":1, "title", "company", "description_text", "locations", "salary",
    "apply_url"}`` serialised with ``json.dumps(sort_keys=True,
    separators=(",", ":"), ensure_ascii=False)`` and hashed as UTF-8, where

    * ``title``, ``company`` and ``description_text`` have runs of whitespace
      collapsed to one space and are stripped, so a re-flow of the same words
      is not a change;
    * ``locations`` is the sorted list of ``[country, region, city]`` triples
      with ``""`` for null (excerpts excluded: they are provenance);
    * ``salary`` is ``[min, max, currency, period]`` or ``null`` (excerpt
      excluded for the same reason);
    * ``apply_url`` is the string or ``null``.

    Excluded on purpose: ``published_at`` / ``updated_at`` (the source's
    clock, not the posting), ``retrieved_at``, ``requirements`` and
    ``inferred`` (derived from the description, which is already hashed),
    ``remote_type`` / ``eligible_countries`` / ``language`` (flags that follow
    from the fields above), and every URL other than ``apply_url``.
    """
    payload = {
        "v": 1,
        "title": _canonical_ws(title),
        "company": _canonical_ws(company),
        "description_text": _canonical_ws(description_text),
        "locations": sorted(
            [loc.country or "", loc.region or "", loc.city or ""] for loc in locations
        ),
        "salary": [salary.min, salary.max, salary.currency, salary.period] if salary else None,
        "apply_url": apply_url or None,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# the normaliser


def _timestamp(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return to_timestamp_string(moment)


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    cleaned = _canonical_ws(value)
    return cleaned[:limit] if cleaned else None


def normalize_job(raw: RawJob) -> NormalizedResult:
    """Build a validated ``NormalizedJob`` from what a connector read."""
    warnings: list[FetchWarning] = []
    inferred: list[InferredField] = []

    def infer(field_name: str, excerpt: str) -> None:
        cut = _excerpt(excerpt, MAX_EVIDENCE)
        if not cut or len(inferred) >= MAX_INFERRED:
            return
        payload: dict[str, Any] = {"field": field_name, "source_excerpt": cut}
        inferred.append(InferredField.model_validate(payload))
        warnings.append(
            make_warning(
                "FIELD_INFERRED",
                f"{field_name} was inferred from the posting's text rather than read from a "
                "structured field. The excerpt it came from is recorded on the job.",
            )
        )

    description = raw.description_text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(description) > MAX_DESCRIPTION:
        description = description[:MAX_DESCRIPTION]
        warnings.append(
            make_warning(
                "BODY_TRUNCATED",
                f"The description was longer than {MAX_DESCRIPTION} characters and was cut there.",
            )
        )
    if not description:
        description = "(The source provided no description text.)"

    inference_text, injection_detected = strip_injected_text(description)
    if injection_detected:
        warnings.append(
            make_warning(
                "FIELD_DROPPED_INVALID",
                "The description contains text addressed to an AI system. It was kept as "
                "data in the description and excluded from every inference.",
            )
        )

    # -- locations and remote ----------------------------------------------------
    locations: list[JobLocation] = []
    remote_from_location: str | None = None
    for raw_location in raw.locations[:MAX_LOCATIONS]:
        if raw_location.country or raw_location.region or raw_location.city:
            locations.append(
                JobLocation(
                    country=iso_country(raw_location.country),
                    region=_clip(raw_location.region, 120),
                    city=_clip(raw_location.city, 120),
                    source_excerpt=_excerpt(raw_location.name or "") or None,
                )
            )
            continue
        if raw_location.name and raw_location.name.strip():
            location, remote = parse_location_name(raw_location.name)
            if remote and remote_from_location is None:
                remote_from_location = raw_location.name
            if location.country or location.region or location.city:
                locations.append(location)

    remote_type: RemoteType = "unknown"
    if raw.remote_type is not None:
        remote_type = raw.remote_type
    elif remote_from_location is not None:
        remote_type = "remote"
        infer("remote_type", remote_from_location)
    else:
        remote_guess = _infer_remote_type(inference_text)
        if remote_guess is not None:
            remote_type, sentence = remote_guess
            infer("remote_type", sentence)

    # -- eligibility -------------------------------------------------------------
    eligible: list[str] | None = None
    if raw.eligible_countries is not None:
        eligible = [code for code in (iso_country(item) for item in raw.eligible_countries) if code]
        if not eligible:
            eligible = None
    else:
        eligibility_guess = _infer_eligible_countries(inference_text)
        if eligibility_guess is not None:
            eligible, sentence = eligibility_guess
            infer("eligible_countries", sentence)

    # -- salary --------------------------------------------------------------------
    salary: JobSalary | None = None
    if raw.salary is not None:
        salary = JobSalary(
            min=raw.salary.min,
            max=raw.salary.max,
            currency=raw.salary.currency,
            period=raw.salary.period,
            source_excerpt=_excerpt(raw.salary.source_excerpt) or "(structured salary field)",
        )
    else:
        salary_guess = _infer_salary(inference_text)
        if salary_guess is not None:
            salary, sentence = salary_guess
            infer("salary", sentence)

    # -- requirements ----------------------------------------------------------------
    requirements, heading = _requirements_from_sections(raw.sections)
    if not requirements:
        requirements, heading = _requirements_from_text(inference_text)
    if requirements and heading:
        infer("requirements", heading)

    # -- language --------------------------------------------------------------------
    language = raw.language
    if language is None:
        language_guess = _infer_language(inference_text)
        if language_guess is not None:
            language, first_line = language_guess
            infer("language", first_line)

    # -- scalar fields ---------------------------------------------------------------
    title = _clip(raw.title, MAX_TITLE) or "(untitled)"
    company = _clip(raw.company, MAX_COMPANY) or "(company not stated)"
    apply_url = raw.apply_url.strip() if raw.apply_url and raw.apply_url.strip() else None
    if apply_url is not None and len(apply_url) > MAX_URL:
        apply_url = None
        warnings.append(
            make_warning(
                "FIELD_DROPPED_INVALID",
                "The apply URL was longer than the contract allows and was dropped.",
            )
        )
    canonical_url = raw.canonical_url.strip()[:MAX_URL]

    job = NormalizedJob(
        external_id=raw.external_id[:200],
        source_key=raw.source_key[:500],
        canonical_url=canonical_url,
        apply_url=apply_url,
        company=company,
        title=title,
        description_text=description,
        published_at=_timestamp(raw.published_at),
        updated_at=_timestamp(raw.updated_at),
        locations=locations,
        remote_type=remote_type,
        eligible_countries=eligible,
        employment_type=raw.employment_type,
        salary=salary,
        language=language,
        requirements=requirements,
        inferred=inferred,
        content_hash=compute_content_hash(
            title=title,
            company=company,
            description_text=description,
            locations=locations,
            salary=salary,
            apply_url=apply_url,
        ),
        retrieved_at=to_timestamp_string(raw.retrieved_at),
    )
    return NormalizedResult(job=job, warnings=warnings)


__all__ = [
    "MAX_DESCRIPTION",
    "NORMALIZER_VERSION",
    "NormalizedResult",
    "RawJob",
    "RawLocation",
    "RawSalary",
    "RawSection",
    "compute_content_hash",
    "make_warning",
    "normalize_job",
    "parse_location_name",
    "strip_injected_text",
]
