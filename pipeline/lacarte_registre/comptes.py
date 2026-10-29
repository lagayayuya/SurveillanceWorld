"""The registre's figures, from the flags of regles.py: a commune's, a territory's (each
document once), a département's, a company's and a buyer's.

A commune's amount adds its own counted contracts (`compte` and `communal`); a
département's, every counted contract placed in it; a company's, its counted contracts; a
buyer's, its contracts but the central purchasing bodies', the out-of-totals and the
national ones, a copy never. The map's count of a commune is OpenStreetMap's (ODbL); the
pilot has no cut of its own per commune (no CARTE_N), so it is the France-wide count.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from lacarte_registre.regles import EI, Event, Registre, is_act, is_camera_act, is_drone_act


def _counts(events: Iterable[Event]) -> dict[str, int]:
    o = {"docs": 0, "con": 0, "cam": 0, "dr": 0, "arr": 0}
    for e in events:
        o["docs"] += 1
        o["con"] += e["t"] == "attribution"
        o["cam"] += is_camera_act(e)
        o["dr"] += is_drone_act(e)
        o["arr"] += is_act(e)
    return o


def _amount(events: Iterable[Event]) -> float:
    return sum(e.get("montant") or 0 for e in events)


def carte(reg: Registre, insee: str) -> int | None:
    return reg.pilote.get("CARTE_N_ALL", {}).get(insee)


def commune(reg: Registre, insee: str) -> dict[str, Any]:
    evs = reg.by_insee.get(insee, [])
    return {
        **_counts(evs),
        "montant": _amount(e for e in evs if e["compte"] and e["communal"]),
        "carte": carte(reg, insee),
    }


def uniq(reg: Registre, insees: Iterable[str]) -> dict[str, int]:
    """A set of communes, each document once (a shared act is in several)."""
    seen: set[str] = set()
    evs = []
    for k in insees:
        for e in reg.by_insee.get(k, []):
            if e["id"] not in seen:
                seen.add(e["id"])
                evs.append(e)
    return _counts(evs)


def departement(reg: Registre, dep: str) -> dict[str, Any]:
    evs = reg.by_dep.get(dep, [])
    return {
        **_counts(evs),
        "sansCommune": sum(1 for e in evs if not e.get("insee") or e["insee"] not in reg.communes),
        "montant": _amount(e for e in evs if e["compte"]),
        "montantBrut": _amount(e for e in evs if e["t"] == "attribution"),
    }


def communes_dep(reg: Registre, dep: str) -> list[str]:
    """The communes of a département with a document."""
    return sorted(k for k, evs in reg.by_insee.items() if evs and reg.communes[k]["dep"] == dep)


def communes_epci(reg: Registre, code: str) -> list[str]:
    """Every commune of an intercommunality (those of the pilot's reference)."""
    return sorted(k for k, c in reg.communes.items() if code and c.get("epci") == code)


def entreprises(reg: Registre) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for e in reg.evenements:
        if e["t"] != "attribution":
            continue
        for s in e.get("entreprises") or []:
            if s == EI:  # a sole trader: no page, no ranking
                continue
            o = out.setdefault(
                s,
                {
                    "siren": s,
                    "n": 0,
                    "copies": 0,
                    "clientes": [],
                    "montant": 0.0,
                    "deps": {},
                    "y0": None,
                    "contrats": [],
                },
            )
            if e["copie"]:
                o["copies"] += 1
                continue
            o["n"] += 1
            o["contrats"].append(e["id"])
            b = reg.buyer(e)
            if b and b not in o["clientes"]:
                o["clientes"].append(b)
            if e["compte"]:
                o["montant"] += e.get("montant") or 0
            if e.get("dep"):
                o["deps"][e["dep"]] = o["deps"].get(e["dep"], 0) + 1
            y = (e.get("date") or "")[:4]
            if y and (o["y0"] is None or y < o["y0"]):
                o["y0"] = y
    return out


def acheteurs(reg: Registre) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for e in reg.evenements:
        b = reg.buyer(e) if e["t"] == "attribution" else None
        if not b:
            continue
        o = out.setdefault(b, {"siren": b, "n": 0, "montant": 0.0, "ents": [], "contrats": []})
        if e["copie"]:
            continue
        o["n"] += 1
        o["contrats"].append(e["id"])
        if not e.get("hors_totaux") and not e.get("national"):
            o["montant"] += e.get("montant") or 0
        for s in e.get("entreprises") or []:
            if s != EI and s not in o["ents"]:
                o["ents"].append(s)
    return out
