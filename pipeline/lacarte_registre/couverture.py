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
        # its name when the export gives one (the pilot names its own départements only)
        nom = (reg.pilote.globals.get("DEP", {}).get(code) or {}).get("nom")
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
        "departements": deps,
        "defaut": {"etat": conf["default"]["etat"]},
        "non_lus": {k: why.get(k, 0) for k in NON_LU},
    }
