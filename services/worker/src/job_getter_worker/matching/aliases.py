"""The versioned skill alias map (06_AI_PROFILE_AND_CV.md).

Two kinds of entry, and the difference between them is the whole point:

* **Equivalents** are names for the same thing. "js" and "javascript" are the
  same skill written two ways, so a profile claiming one satisfies a
  requirement naming the other.
* **Related** names are neighbours, not equals. React experience is evidence
  about React, not about React Native; PostgreSQL is not MySQL. A requirement
  matched only through a related name resolves to ``uncertain``: it is
  reported, it is visible to the user, and it does **not** count towards the
  score. "Uncertain semantic equivalents remain uncertain" is a rule about not
  quietly crediting someone with experience they never claimed.

The map is small and hand-checked on purpose. A large generated synonym list
would be impossible to audit, and every wrong entry here is a false claim
about a person's experience. Anything absent simply does not match, which is
the safe failure: a missed match understates the score, an invented one
overstates the person.

Changing this file means bumping ``SKILL_ALIAS_MAP_VERSION`` in
``packages/contracts``: the version is persisted with every match so an old
score can still be explained by the map that produced it.
"""

from __future__ import annotations

from .text import fold

#: Names for one and the same skill. Each tuple is an equivalence class.
_EQUIVALENTS: tuple[tuple[str, ...], ...] = (
    ("javascript", "js", "ecmascript"),
    ("typescript", "ts"),
    ("python", "py"),
    ("postgresql", "postgres", "psql"),
    ("kubernetes", "k8s"),
    ("golang", "go"),
    ("c#", "csharp", "c sharp"),
    ("c++", "cpp", "c plus plus"),
    (".net", "dotnet", "dot net"),
    ("node.js", "node", "nodejs"),
    ("amazon web services", "aws"),
    ("google cloud platform", "gcp", "google cloud"),
    ("microsoft azure", "azure"),
    ("continuous integration", "ci"),
    ("continuous delivery", "cd"),
    ("infrastructure as code", "iac"),
    ("machine learning", "ml"),
    ("natural language processing", "nlp"),
    ("user interface", "ui"),
    ("user experience", "ux"),
    ("structured query language", "sql"),
    ("representational state transfer", "rest", "restful"),
    ("test driven development", "tdd"),
    ("react.js", "react", "reactjs"),
    ("vue.js", "vue", "vuejs"),
    ("ruby on rails", "rails"),
    ("español", "espanol", "spanish", "castellano"),
    ("english", "ingles"),
)

#: Neighbouring skills. A match through this table is reported as uncertain
#: and never counted as evidence of experience.
_RELATED: tuple[tuple[str, str], ...] = (
    ("react", "react native"),
    ("javascript", "typescript"),
    ("postgresql", "mysql"),
    ("postgresql", "sqlite"),
    ("kubernetes", "docker"),
    ("aws", "google cloud platform"),
    ("aws", "microsoft azure"),
    ("python", "django"),
    ("python", "flask"),
    ("java", "kotlin"),
    ("c#", "java"),
    ("node.js", "deno"),
    ("machine learning", "deep learning"),
)


def _build_equivalents() -> dict[str, frozenset[str]]:
    table: dict[str, set[str]] = {}
    for group in _EQUIVALENTS:
        folded = {fold(name) for name in group}
        for name in folded:
            table.setdefault(name, set()).update(folded)
    return {name: frozenset(values) for name, values in table.items()}


def _build_related() -> dict[str, frozenset[str]]:
    table: dict[str, set[str]] = {}
    for left, right in _RELATED:
        left_folded, right_folded = fold(left), fold(right)
        table.setdefault(left_folded, set()).add(right_folded)
        table.setdefault(right_folded, set()).add(left_folded)
    return {name: frozenset(values) for name, values in table.items()}


_EQUIVALENT_TABLE = _build_equivalents()
_RELATED_TABLE = _build_related()


def equivalents(name: str) -> frozenset[str]:
    """Every folded name that means the same skill, including ``name``."""
    folded = fold(name)
    return _EQUIVALENT_TABLE.get(folded, frozenset({folded}))


def related(name: str) -> frozenset[str]:
    """Neighbouring folded names, expanded through the equivalence classes.

    A relation declared for "react" also applies to "react.js", since those are
    the same skill; the relation itself stays uncertain either way.
    """
    result: set[str] = set()
    for equivalent in equivalents(name):
        for neighbour in _RELATED_TABLE.get(equivalent, frozenset()):
            result.update(equivalents(neighbour))
    return frozenset(result - equivalents(name))
