"""What a contract or a notice buys, and so what its holder does for the buyer (lot R5
« les données », section 2): natures read from the objet's words and the CPV codes by the
rules of rules/registre_natures.yaml, no model.

A document takes one or more natures, each with the rule that gave it and how (`mots`: a
word of the objet, `cpv`: a CPV prefix). The « action » natures (supply and installation,
maintenance, works, advice) come from the objet, and from the CPV only when the objet names
no action; the « domaine » natures (supervision centre, plates, algorithms, drones, network)
come from the objet only. Advice absorbs the other actions of the same objet. Nothing found:
`autre`.

A company's role towards a buyer follows: the roles of its contracts' action natures
(« installe », « entretient »…), each with its count.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

AUTRE = "autre"


def fold(s: str | None) -> str:
    """Lower case, no accents, « ° » (an abbreviation's « -on ») read as « on », « œ » as
    « oe », any run of spaces as one."""
    s = (s or "").replace("°", "on").replace("œ", "oe").replace("Œ", "oe")
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.replace("’", "'"))


@dataclass(frozen=True)
class Nature:
    key: str
    id: str
    genre: str
    role: str | None
    mots: tuple[re.Pattern[str], ...]
    cpv: tuple[str, ...]
    absorbe: tuple[str, ...]
    # words that give the nature only when no other action was read in the objet
    mots_faibles: tuple[re.Pattern[str], ...] = ()


@dataclass(frozen=True)
class Regles:
    natures: tuple[Nature, ...]
    # an objet that buys a watching service takes no nature from its CPV
    sans_repli_cpv: tuple[re.Pattern[str], ...]

    def __iter__(self) -> Iterator[Nature]:
        return iter(self.natures)


def load(path: Path) -> Regles:
    conf = yaml.safe_load(path.read_text(encoding="utf-8"))
    natures = tuple(
        Nature(
            key=k,
            id=v["id"],
            genre=v["genre"],
            role=v.get("role"),
            mots=tuple(re.compile(m) for m in v.get("mots") or ()),
            cpv=tuple(str(c) for c in v.get("cpv") or ()),
            absorbe=tuple(v.get("absorbe") or ()),
            mots_faibles=tuple(re.compile(m) for m in v.get("mots_faibles") or ()),
        )
        for k, v in conf["natures"].items()
    )
    bloque = (conf.get("sans_repli_cpv") or {}).get("mots") or ()
    return Regles(natures, tuple(re.compile(m) for m in bloque))


def _cpv_nature(cpvs: list[str], rules: Regles) -> tuple[Nature, str] | None:
    """The action nature of the longest CPV prefix among the document's codes."""
    best: tuple[int, Nature, str] | None = None
    for n in rules:
        if n.genre != "action":
            continue
        for c in cpvs:
            for p in n.cpv:
                if c.startswith(p) and (best is None or len(p) > best[0]):
                    best = (len(p), n, c)
    return (best[1], best[2]) if best else None


def classer(objet: str | None, cpvs: Iterable[str], rules: Regles) -> dict[str, Any]:
    """{natures: [keys], raisons: {key: {regle, par, valeur}}}; `natures` is [`autre`] when
    nothing matched."""
    text = fold(objet)
    cpvs = [str(c) for c in cpvs if c]
    found: dict[str, dict[str, str]] = {}

    def words(n: Nature, patterns: tuple[re.Pattern[str], ...]) -> None:
        for m in patterns:
            if hit := m.search(text):
                found[n.key] = {"regle": n.id, "par": "mots", "valeur": hit.group(0)}
                return

    def no_action() -> bool:
        return not any(r.genre == "action" and r.key in found for r in rules)

    for n in rules:
        words(n, n.mots)
    if no_action():
        for n in rules:
            words(n, n.mots_faibles)
    watched = any(m.search(text) for m in rules.sans_repli_cpv)
    if no_action() and not watched and (hit := _cpv_nature(cpvs, rules)):
        found[hit[0].key] = {"regle": hit[0].id, "par": "cpv", "valeur": hit[1]}
    for n in rules:
        if n.key in found:
            for k in n.absorbe:
                found.pop(k, None)
    keys = [n.key for n in rules if n.key in found]
    return {"natures": keys or [AUTRE], "raisons": found}


def roles(natures: Iterable[str], rules: Regles) -> list[str]:
    by_key = {n.key: n for n in rules}
    return [by_key[k].role for k in natures if k in by_key and by_key[k].role]


def roles_entreprise(
    contrats: Iterable[tuple[str, list[str]]], rules: Regles
) -> dict[str, Counter[str]]:
    """A company's roles per buyer from (buyer, natures) of its contracts: {buyer: Counter}."""
    out: dict[str, Counter[str]] = {}
    for buyer, nat in contrats:
        out.setdefault(buyer, Counter()).update(roles(nat, rules) or ["autre"])
    return out
