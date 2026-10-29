"""A commune's slots of drone flight and algorithmic analysis (« Carte et drones »), computed once.

The pilot's AUTORISATIONS give each drone or algorithmic-analysis act its communes, its zones
and its periods (`periodes`: t0, t1 in ms, the hours read and whether they are sure); ZONES
place a zone in a site and give its status (`relu`, `indicatif`, `relecture`); SITES cut a site
by commune (`parts`). The page reads:
- `creneaux`: the slots of flight, sorted by start: one per (period, sites, kind) of the acts
  whose zone was deduced, the acts that authorise the same flights grouped in one slot (their
  ids in `actes`); `heures` the hours the act states, null when it does not state them
  (`heures_sures` false or no hours: the frieze's dashed bar, « horaires non précisés »);
  `sites` the commune's sites drawn from its zones (a zone under review is not drawn);
  `statut` « relu » when every zone drawn for it was reviewed, else « indicatif »;
- `non_deduits`: the acts whose zone was not deduced (the build's `non_lu`, regles.py), listed
  with their source, never drawn.
What the pilot lacks (no periods, no sites) gives no slot or no site, not an error.
"""

from __future__ import annotations

import re
from typing import Any

from lacarte_registre.regles import Event, Pilote

KINDS = {"arrete_drone": "drone", "arrete_vsa": "vsa"}
NON_DEDUITE = "zone_non_deduite"
# « dans le cadre du maintien de l'ordre » → « maintien de l'ordre » (the prototype's)
CADRE = re.compile(r"^dans le cadre (des|de la|du|de l'|d')\s*", re.IGNORECASE)


def finalite(text: str | None) -> str | None:
    """An act's purpose as the list shows it: one line, without « dans le cadre de »."""
    if not text:
        return None
    return CADRE.sub("", re.sub(r"\s+", " ", text).strip()) or None


def non_deduite(e: Event | None) -> bool:
    return bool(e) and NON_DEDUITE in (e.get("non_lu") or [])


def non_deduits(events: list[Event]) -> list[dict[str, Any]]:
    """The drone and algorithmic-analysis acts whose zone was not deduced, newest first."""
    rows = [
        {
            "acte": e["id"],
            "kind": KINDS[e["t"]],
            "date": e.get("date"),
            "url": e.get("url"),
            "ref": e.get("ref"),
            "page": e.get("page"),
            "raisons": e["non_lu"],
        }
        for e in events
        if e.get("t") in KINDS and non_deduite(e)
    ]
    return sorted(rows, key=lambda r: (r["date"] or "", r["acte"]), reverse=True)


def creneaux(
    autorisations: list[dict[str, Any]],
    zones: list[dict[str, Any]],
    sites: list[dict[str, Any]],
    by_id: dict[str, Event],
    insee: str,
) -> list[dict[str, Any]]:
    """The commune's slots of flight, sorted by start (then end, then kind)."""
    zid = {z["id"]: z for z in zones}
    here = {s["id"] for s in sites if insee in (s.get("parts") or {})}
    out: dict[tuple[Any, ...], dict[str, Any]] = {}
    for a in autorisations:
        if insee not in (a.get("insee") or []) or non_deduite(by_id.get(a["acte"])):
            continue
        drawn = [
            z for i in a.get("zones") or [] if (z := zid.get(i)) and z.get("statut") != "relecture"
        ]
        site_ids = sorted({z["site"] for z in drawn if z.get("site") in here})
        kind = a.get("kind") or "drone"
        for p in a.get("periodes") or []:
            key = (p["t0"], p["t1"], tuple(site_ids), kind)
            slot = out.get(key)
            if slot is None:
                sure = bool(p.get("heures_sures")) and p.get("heures") is not None
                slot = out[key] = {
                    "t0": p["t0"],
                    "t1": p["t1"],
                    "heures": p["heures"] if sure else None,
                    "kind": kind,
                    "service": a.get("service") or None,
                    "finalite": finalite(a.get("finalite")),
                    "url": a.get("url") or (by_id.get(a["acte"]) or {}).get("url"),
                    "actes": [],
                    "sites": site_ids,
                    "_statuts": set(),
                }
            if a["acte"] not in slot["actes"]:
                slot["actes"].append(a["acte"])
            slot["_statuts"].update(
                z.get("statut") for z in drawn if not site_ids or z.get("site") in site_ids
            )
    rows = sorted(out.values(), key=lambda s: (s["t0"], s["t1"], s["kind"], s["sites"]))
    for s in rows:
        st = s.pop("_statuts")
        s["statut"] = "relu" if st == {"relu"} else "indicatif"
    return rows


def commune(p: Pilote, events: list[Event], by_id: dict[str, Event], insee: str) -> dict[str, Any]:
    """The commune file's `drones` key: its slots and its acts whose zone was not deduced."""
    return {
        "creneaux": creneaux(
            p.get("AUTORISATIONS", []), p.get("ZONES", []), p.get("SITES", []), by_id, insee
        ),
        "non_deduits": non_deduits(events),
    }
