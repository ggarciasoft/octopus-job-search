"""Typed access to the confirmed facts a match is allowed to use.

``ProfileFact.value`` is ``Any`` by contract, because the value schema is
chosen by ``kind``. This module validates each value against the schema its
kind names and keeps the fact id beside it, so every component can cite the
fact it scored from.

A fact whose value does not validate is **dropped**, not coerced. It is
already confirmed data, so a malformed one means something upstream went
wrong; guessing at its intent here would turn a storage bug into a claim about
the user's experience.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from ..contracts.generated import (
    AuthorizationValue,
    ExperienceValue,
    LanguageValue,
    ProfileFact,
    SkillValue,
)


@dataclass(frozen=True)
class Held[T: BaseModel]:
    """One validated fact value with the id it came from."""

    fact_id: str
    value: T


@dataclass(frozen=True)
class ConfirmedProfile:
    """The confirmed profile, bucketed by the kinds matching reads."""

    skills: tuple[Held[SkillValue], ...] = ()
    experiences: tuple[Held[ExperienceValue], ...] = ()
    languages: tuple[Held[LanguageValue], ...] = ()
    authorizations: tuple[Held[AuthorizationValue], ...] = ()
    #: Facts dropped because their value did not validate, for the log.
    dropped: tuple[str, ...] = field(default=())

    @property
    def is_empty(self) -> bool:
        return not (self.skills or self.experiences or self.languages or self.authorizations)


def _parse[T: BaseModel](model: type[T], fact: ProfileFact) -> Held[T] | None:
    try:
        return Held(fact_id=fact.id, value=model.model_validate(fact.value))
    except ValidationError:
        return None


def collect(facts: list[ProfileFact]) -> ConfirmedProfile:
    """Bucket confirmed facts by kind.

    Unconfirmed facts are rejected outright rather than filtered quietly: the
    API is contracted to send only confirmed facts, and scoring against a draft
    would turn an extraction guess into a claim the user never agreed to.
    """
    skills: list[Held[SkillValue]] = []
    experiences: list[Held[ExperienceValue]] = []
    languages: list[Held[LanguageValue]] = []
    authorizations: list[Held[AuthorizationValue]] = []
    dropped: list[str] = []

    for fact in facts:
        if not fact.confirmed:
            dropped.append(fact.id)
            continue
        match fact.kind:
            case "skill":
                held_skill = _parse(SkillValue, fact)
                (skills.append(held_skill) if held_skill else dropped.append(fact.id))
            case "experience":
                held_experience = _parse(ExperienceValue, fact)
                (
                    experiences.append(held_experience)
                    if held_experience
                    else dropped.append(fact.id)
                )
            case "language":
                held_language = _parse(LanguageValue, fact)
                (languages.append(held_language) if held_language else dropped.append(fact.id))
            case "authorization":
                held_auth = _parse(AuthorizationValue, fact)
                (authorizations.append(held_auth) if held_auth else dropped.append(fact.id))
            case _:
                # contact, summary, education, project and certification carry
                # no signal for fit v1. They are not dropped data: they are
                # simply not read by any component.
                continue

    return ConfirmedProfile(
        skills=tuple(skills),
        experiences=tuple(experiences),
        languages=tuple(languages),
        authorizations=tuple(authorizations),
        dropped=tuple(dropped),
    )
