"""The cameras a territory's video-protection acts authorise (rules/registre_cameras.yaml): by
holder (« mairie », « commerces », « autres »), inside, outside and on the public road, over the
period of the acts counted. A holder or a number not read stays null, never 0.

A dossier is a system: its latest act counts (an abrogation or a refusal ends it); an act
whose file number is not read counts alone (a renewal of it may then count twice: said by
`sans_dossier`)."""

from __future__ import annotations

import re
from collections.abc import Iterable
from functools import cache
from pathlib import Path
from typing import Any

import yaml

from lacarte_registre.lecture_drones import plie

FIN = {"abrogation", "refus"}
TITULAIRES = ("mairie", "commerces", "autres")
SUJET = re.compile(
    r"^(.*?)\b(?:est|sont) (?:autoris|accord|reconduit|renouvel)"
    r"|^(.*?)\bl.autorisation (?:sollicitee|precedemment)"
)
# the pilot's holders (the Rhône's reading): their categories
PILOTE = {"commune": "mairie", "epci": "mairie", "commerce": "commerces", "banque": "commerces"}


@cache
def regles(rules_dir: Path) -> dict[str, re.Pattern[str]]:
    conf = yaml.safe_load((rules_dir / "registre_cameras.yaml").read_text("utf-8"))["titulaire"]
    return {k: re.compile(conf[k]) for k in TITULAIRES}


def titulaire(champs: dict[str, Any], titre: str | None, rules_dir: Path) -> str | None:
    """« mairie », « commerces », « autres » or None (rule:registre_cameras@1:titulaire): read
    on the subject of article 1, then the visas' « pour l'établissement… », then the title."""
    r = regles(rules_dir)
    a1 = re.sub(r"^article ?(?:1er|premier|1)\W*", "", plie(champs.get("article_1") or ""))
    m = SUJET.search(a1)
    subject = (m.group(1) or m.group(2) or "") if m else ""
    for src in (subject, plie(champs.get("titulaire_extrait") or ""), plie(titre or "")):
        for k in TITULAIRES:
            if src and r[k].search(src):
                return k
    return None


def _holder(e: dict[str, Any]) -> str | None:
    if e.get("titulaire") in TITULAIRES:
        return e["titulaire"]
    t = e.get("type_beneficiaire")
    return PILOTE.get(t) or ("autres" if t else None)


def autorisees(events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """`cam_aut` of a territory's camera acts (`t` « arrete »), each act once."""
    last: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    sans = 0
    for e in events:
        if e.get("t") != "arrete" or e["id"] in seen:
            continue
        seen.add(e["id"])
        k = e.get("dossier") or e["id"]
        sans += not e.get("dossier")
        if k not in last or (e.get("date") or "") >= (last[k].get("date") or ""):
            last[k] = e
    out: dict[str, Any] = {
        **dict.fromkeys(TITULAIRES, None), "non_classees": None,
        "interieures": None, "exterieures": None, "voie_publique": None,
        "dossiers": 0, "dossiers_non_lus": 0, "sans_dossier": sans, "periode": None,
    }  # fmt: skip
    days: list[str] = []
    for e in last.values():
        if e.get("sous_type") in FIN:
            continue
        out["dossiers"] += 1
        n = e.get("cameras")
        if n is None:
            out["dossiers_non_lus"] += 1
            continue
        days.append(e.get("date") or "")
        who = _holder(e) or "non_classees"
        out[who] = (out[who] or 0) + int(n)
        for key, field in (("interieures", "cameras_int"), ("exterieures", "cameras_ext"),
                           ("voie_publique", "cameras_vp")):  # fmt: skip
            if e.get(field) is not None:
                out[key] = (out[key] or 0) + int(e[field])
    days = sorted(d for d in days if d)
    if days:
        out["periode"] = {"de": days[0], "a": days[-1]}  # the map reads « de », « a »
    return out
