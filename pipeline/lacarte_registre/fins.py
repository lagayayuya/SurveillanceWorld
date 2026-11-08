"""The drone acts that are no flight (rule:registre_drones@1:fin): the bans, which leave the
register, and the abrogations and withdrawals, which stay drone documents without days and
take the days of the act whose number they cite."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from lacarte_registre import collecte
from lacarte_registre.motifs import fold

FILE = "registre_drones.yaml"
# a decree's number as written: « 2026-00580 », « cab/spas/2025-878 », « pref-cab-bpa-2026-415 »
NUMERO = re.compile(r"\b((?:[a-z]+[/-])*[a-z]*\d[a-z0-9/_.-]*\d)")


@dataclass
class Fins:
    """What `lire` found: `interdictions` the ids of the bans; `fins` an ender's id → its kind
    (« abrogation », « retrait »); `cible` an ender's id → the ids of the act it ends (one
    decree, or its copies in several recueils: the Préfecture de police's decrees are also in
    the 92's, 93's, 94's);
    `par` an ended act's id → (its ender's id, kind, the ender's day)."""

    interdictions: set[str] = field(default_factory=set)
    fins: dict[str, str] = field(default_factory=dict)
    cible: dict[str, list[str]] = field(default_factory=dict)
    par: dict[str, tuple[str, str, str]] = field(default_factory=dict)


def regles(rules_dir: Path) -> dict[str, Any]:
    c = yaml.safe_load((rules_dir / FILE).read_text("utf-8"))["fin"]
    return {
        **{
            k: re.compile(c[k])
            for k in ("interdiction", "captation", "remplace", "fin_article_1", "retrait")
        },  # fmt: skip
        "cite": [re.compile(p) for p in c["cite"]],
        "pp": set(c["famille_pp"]),
    }


def _textes(a: dict[str, Any]) -> tuple[str, str]:
    a1 = fold((a.get("champs") or {}).get("article_1") or "")
    # article 1 only: a renewal's article 3 also says « … est abrogé »
    return fold(a.get("titre") or ""), re.split(r"\barticle 2\b", a1, maxsplit=1)[0]


def genre(a: dict[str, Any], r: dict[str, Any]) -> str | None:
    """« interdiction », « abrogation », « retrait » or None (a flight)."""
    t, a1 = _textes(a)
    if r["remplace"].search(t) or r["remplace"].search(a1):
        return None
    if a.get("sous_type") == "abrogation" or r["fin_article_1"].search(a1[:400]):
        return "retrait" if r["retrait"].search(f"{t} {a1[:300]}") else "abrogation"
    if r["interdiction"].search(t) and not r["captation"].search(a1):
        return "interdiction"
    return None


def cite(a: dict[str, Any], r: dict[str, Any]) -> str | None:
    """The number of the act it ends, as written, else None."""
    for txt in _textes(a):
        for p in r["cite"]:
            if m := p.search(txt):
                return m.group(1)
    return None


def cle(numero: str) -> tuple[str, ...]:
    """A number by its digits (« n°2026-00580 », « r02-2026-01-16-00010 », « cab/spas/2025-878 »
    are « 2026 580 », « 2 2026 1 16 10 », « 2025 878 »)."""
    return tuple(str(int(d)) for d in re.findall(r"\d+", numero))


def _famille(adm: str, r: dict[str, Any]) -> str:
    return "pp" if adm in r["pp"] else adm


def lire(acts: list[dict[str, Any]], rules_dir: Path) -> Fins:
    """The drone acts' bans and enders, and what each ender ends."""
    r = regles(rules_dir)
    out = Fins()
    drones = [a for a in acts if a.get("type") == "drone"]
    vols = []
    for a in drones:
        g = genre(a, r)
        if g == "interdiction":
            out.interdictions.add(a["id"])
        elif g:
            out.fins[a["id"]] = g
        else:
            vols.append(a)
    # the flights by their numbers: the reader's key, the decree's « n° », every number of the
    # head of its title (« Arrêté CAB/SPAS/2025-878 portant… »: no « n° »)
    index: defaultdict[tuple[str, tuple[str, ...]], set[str]] = defaultdict(set)
    decret = {a["id"]: collecte.numero(a) for a in vols}
    for a in vols:
        nums = {a.get("acte") or "", collecte.numero(a) or ""}
        nums |= set(NUMERO.findall(fold(a.get("titre") or "")[:120]))
        for n in nums:
            if k := cle(n):
                index[(_famille(a["administration"], r), k)].add(a["id"])
    for a in drones:
        if a["id"] not in out.fins or not (n := cite(a, r)):
            continue
        found = index.get((_famille(a["administration"], r), cle(n)), set())
        # one act, or copies of one decree (the same « n° » in their titles)
        if len(found) == 1 or (len({decret[x] for x in found}) == 1 and decret[min(found)]):
            out.cible[a["id"]] = sorted(found)
            jour = a.get("date_acte") or a["recueil_date"]
            for target in found:
                # two enders of one act (a withdrawal after an abrogation): the earliest day
                if target not in out.par or jour < out.par[target][2]:
                    out.par[target] = (a["id"], out.fins[a["id"]], jour)
    return out


def jours_restants(jours: list[str], genre_fin: str, jour: str) -> list[str]:
    """An ended act's days: none after a withdrawal, those before its day after an
    abrogation."""
    return [] if genre_fin == "retrait" else [d for d in jours if d < jour]
