"""What the registre covers, per source and per département (couverture.json).

A source (rules/registre_couverture.yaml) is the set of documents of some types, maybe of
one reference prefix or one département. Its `jusqu_au` is its latest document with a full
date: a subsidy list dated by its year only (`date_annee`, the Rhône's DETR list « 2026 »
dated 31/12/2026) never counts, so a source made only of those has none. For the
préfecture's acts it is the last collection (recueil) read, the date written in its file
name, else its latest act. Its `collecte_le` is the latest collection date of its documents
in the pilot's own list (REG.documents: each source document with the day it was fetched);
the pilot's build date (REG.meta.construit) only when a document is not listed there.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Any

import yaml

from lacarte_registre import partage
from lacarte_registre.regles import Event, Registre

# RAA_69-2025-284-031125.pdf: the Rhône's collection n° 284 of 2025, of 3 November 2025.
RECUEIL = re.compile(r"RAA_(\d{2,3}|2[AB])-\d{4}-\d+-(\d{2})(\d{2})(\d{2})\b")
NON_LU = ("nombre_illisible", "commune_introuvable", "zone_non_deduite")


def rules(path: Path) -> dict[str, Any]:
    conf = yaml.safe_load(path.read_text())
    entries = [*conf["sources"], conf["default"], *conf["departements"].values()]
    for x in entries:
        if not (x.get("id") and x.get("rationale")):
            raise ValueError(f"{path.name}: every entry needs an id and a rationale: {x}")
    for x in [conf["default"], *conf["departements"].values()]:
        if x["etat"] not in ("collecte", "non_collecte", "impossible"):
            raise ValueError(f"{path.name}: {x['id']}: unknown etat {x['etat']}")
    return conf


# The families of documents the summary names (« Contrats et avis : toute la France. Arrêtés :
# Rhône. »), in its order, each from the sources whose id it starts.
FAMILLES = ("contrats", "avis", "arretes", "subventions")


# Where a decree comes from (`provenance`, on every act): the collection of its own département's
# recueils (`collecte`); a zone préfecture's act for another département of its zone, published
# in its seat's recueils (`zone`: the Rhône's préfet is the Sud-Est zone's; « publié par la
# préfecture de zone »); another préfecture's act for this département (`autre_prefecture`: the
# police prefecture's for Seine-Saint-Denis); an act of a département whose recueils are not
# collected, read one by one by the pilot's exploration (`exploration`). The recueil's
# département is the act's number's prefix (« 69-2025-11-28-00010 »: the Rhône's).
PROVENANCES = ("collecte", "zone", "autre_prefecture", "exploration")
ACT_NUMBER = re.compile(r"^(\d{2,3}|2[AB])-\d{4}-")


def provenance(e: Event, collected: set[str] | frozenset[str]) -> tuple[str, str | None]:
    """A decree's provenance and the département of the recueil that published it."""
    m = ACT_NUMBER.match(e.get("id") or "")
    recueil = m.group(1) if m else None
    dep = e.get("dep")
    if recueil and recueil != dep:
        if "zone" in (e.get("publie_par") or "").lower():
            return "zone", recueil
        return "autre_prefecture", recueil
    return ("collecte" if dep in collected else "exploration"), recueil or dep


def provenances(reg: Registre, conf: dict[str, Any]) -> Counter[str]:
    """Write every decree's `provenance` (and `recueil_dep` when its recueil is another
    département's), the copies of a shared one too; count them."""
    collected = {k for k, d in conf["departements"].items() if d["etat"] == "collecte"}
    every = {id(e): e for e in reg.evenements}
    for evs in reg.by_insee.values():
        every.update((id(e), e) for e in evs)
    n: Counter[str] = Counter()
    for e in every.values():
        if not e["t"].startswith("arrete"):
            continue
        p, recueil = provenance(e, collected)
        e["provenance"] = p
        if recueil and recueil != e.get("dep"):
            e["recueil_dep"] = recueil
        else:
            e.pop("recueil_dep", None)
    for e in reg.evenements:
        if e["t"].startswith("arrete"):
            n[e["provenance"]] += 1
    return n


def hors_collecte(reg: Registre) -> dict[str, Any] | None:
    """The decrees outside the collected départements' own: how many, in which départements,
    from where (the summary adds them to « Arrêtés : Rhône »)."""
    acts = [e for e in reg.evenements
            if e["t"].startswith("arrete") and e.get("provenance") != "collecte"]  # fmt: skip
    if not acts:
        return None
    deps = Counter(e.get("dep") or "" for e in acts)
    kinds = Counter(e["provenance"] for e in acts)
    return {
        "n": len(acts),
        "departements": dict(sorted(deps.items())),
        "provenances": {k: kinds[k] for k in PROVENANCES if kinds.get(k)},
    }


def resume(
    sources: list[dict[str, Any]], deps: dict[str, Any], hors: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """What each family of documents covers, the families that cover the same together:
    `zone` "france", "pilote" (the pilot's areas), or département codes. The decrees cover
    the départements whose acts are collected; the row that says so carries the others
    (`arretes_hors_collecte`, hors_collecte) when there are some; a family without a document
    is left out."""
    zones: dict[str, Any] = {}
    for f in FAMILLES:
        rows = [s for s in sources if s["id"].startswith(f) and s["documents"]]
        if f == "arretes":
            codes = sorted(k for k, d in deps.items() if d["etat"] == "collecte")
            if rows and codes:
                zones[f] = codes
            continue
        if not rows:
            continue
        per = {s["perimetre"] for s in rows}
        if per == {"france"}:
            zones[f] = "france"
        elif per <= {"pilote"}:
            zones[f] = "pilote"
        else:
            zones[f] = sorted(
                {c for p in per for c in p.split(",") if p not in ("france", "pilote")}
            )
    out: list[dict[str, Any]] = []
    for f, z in zones.items():
        same = next((r for r in out if r["zone"] == z), None)
        if same:
            same["familles"].append(f)
        else:
            out.append({"familles": [f], "zone": z})
    for r in out:
        if "arretes" in r["familles"] and hors:
            r["arretes_hors_collecte"] = hors
    return out


def pilot_departements(conf: dict[str, Any]) -> list[str]:
    return list(conf["departements"])


def _full_date(e: Event) -> str | None:
    d = e.get("date") or ""
    return d if len(d) == 10 and not e.get("date_annee") else None


def recueil(e: Event) -> str | None:
    m = RECUEIL.search(e.get("url") or "")
    return f"20{m.group(4)}-{m.group(3)}-{m.group(2)}" if m else None


def _members(reg: Registre, src: dict[str, Any]) -> list[Event]:
    return [
        e
        for e in reg.evenements
        if e["t"] in src["types"]
        and (not src.get("ref_prefix") or (e.get("ref") or "").startswith(src["ref_prefix"]))
        and (not src.get("dep") or e.get("dep") == src["dep"])
    ]


def _latest(values: list[str | None]) -> str | None:
    found = [v for v in values if v]
    return max(found) if found else None


def build(
    reg: Registre, conf: dict[str, Any], national: dict[str, Any] | None = None
) -> dict[str, Any]:
    """`national`: the national collection's summaries (national/decp.json, boamp.json):
    the sources it feeds say its collection day and « France entière »."""
    national = national or {}
    docs = reg.pilote.reg.get("documents", {})
    built = (reg.pilote.reg.get("meta") or {}).get("construit")
    sources = []
    for src in conf["sources"]:
        evs = _members(reg, src)
        until = _latest([_full_date(e) for e in evs])
        if src.get("recueil"):
            until = _latest([recueil(e) for e in evs]) or until
        row = {
            "id": src["source"],
            "libelle": f"registre.source.{src['source']}",
            "documents": len(evs),
            "jusqu_au": until,
            "collecte_le": _latest(
                [(docs.get(e.get("url")) or {}).get("collecte") or built for e in evs]
            ),
            "perimetre": src.get("perimetre", "pilote"),
        }
        nat = national.get(src.get("national") or "")
        if nat:
            # the national collection: its day, all of France (a pilot-only document of the
            # same kind keeps the source's latest document date, not its collection day)
            row["collecte_le"] = nat.get("collecte_le") or row["collecte_le"]
            row["perimetre"] = (
                "france" if not nat.get("departements") else ",".join(nat["departements"])
            )
            row["version_source"] = nat.get("version")
        sources.append(row)
    deps: dict[str, Any] = {}
    present = sorted({e["dep"] for e in reg.evenements if e.get("dep")})
    for code in dict.fromkeys([*conf["departements"], *present]):
        rule = conf["departements"].get(code, conf["default"])
        row = {k: rule[k] for k in ("etat", "raison", "depuis", "documents_demandes") if k in rule}
        # its name: the catalogue's (every département), else the data's
        nom = partage.dep_nom(code, (reg.pilote.globals.get("DEP", {}).get(code) or {}).get("nom"))
        if nom:
            row["nom"] = nom
        if rule["etat"] == "collecte":
            row["dernier_recueil"] = _latest(
                [recueil(e) for e in reg.by_dep.get(code, []) if e["t"].startswith("arrete")]
            )
        deps[code] = row
    why = Counter(r for e in reg.non_lus for r in e["non_lu"])
    return {
        "v": 1,
        "maj": _latest([s["collecte_le"] for s in sources]),
        "sources": sources,
        # the summary's sentence: what each family of documents covers
        "resume": resume(sources, deps, hors_collecte(reg)),
        "departements": deps,
        "defaut": {"etat": conf["default"]["etat"]},
        "non_lus": {k: why.get(k, 0) for k in NON_LU},
    }
