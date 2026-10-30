"""`lacarte-registre comparer AVANT APRES [--fiche REF …]`: the pilot's control table, before
and after a build (lot R3 § 3).

AVANT and APRES are two built sites (data/registre/site, or a copy of the one served: `rsync
<host>:<release>/data/registre/ AVANT/`). For each record (by default Mions, Lyon, Paris,
Serfim T.I.C., the Sytral and the Rhône), the figures its page shows, side by side, with the
difference: a Markdown table on the standard output. Offline: the two folders only.

Why a figure may move (said in the table's notes): a newer DECP file (a contract published
since, an amount or a holder corrected at the source, a modification added), a contract
published twice now kept once, a notice linked to its contract by the national BOAMP, an
amount now « to check » or no longer (its notice's estimated value), a holder now checked in
SIRENE (a company not found there is not named and has no page), a commune's document now
placed in another commune (the buyer's SIREN read in the COG of the year).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FICHES = (
    "commune/69283",
    "commune/69123",
    "commune/75056",
    "entreprise/431903954",
    "acheteur/256900994",
    "departement/69",
)
FILE = {"commune": "commune", "departement": "departement", "acheteur": "acheteur",
        "entreprise": "entreprise"}  # fmt: skip


def chiffres(site: Path, ref: str) -> dict[str, float | None] | None:
    kind, key = ref.split("/", 1)
    path = site / FILE[kind] / f"{key}.json"
    if not path.is_file():
        return None
    f: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    if kind == "commune":
        s = f["stats"]["communes"][key]
        return {"documents": s["docs"], "contrats": s["con"], "arrêtés": s["arr"],
                "montant compté (€)": s["montant"]}  # fmt: skip
    if kind == "departement":
        s = f["stats"]["depStats"]
        n = len(f["stats"]["communes"])
        return {"documents": s["docs"], "contrats": s["con"], "arrêtés": s["arr"],
                "communes": n, "montant compté (€)": s["montant"]}  # fmt: skip
    if kind == "entreprise":
        s = f.get("stats") or {}
        return {"contrats": s.get("n"), "acheteurs": len(s.get("clientes") or []),
                "montant compté (€)": s.get("montant")}  # fmt: skip
    s = f.get("stats") or {}
    return {"contrats": s.get("n"), "entreprises": len(s.get("ents") or []),
            "montant compté (€)": s.get("montant")}  # fmt: skip


def _n(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{round(v):,}".replace(",", " ")


def table(avant: Path, apres: Path, fiches: tuple[str, ...] = FICHES) -> str:
    lines = ["| Fiche | Chiffre | Avant | Après | Écart |", "|---|---|---:|---:|---:|"]
    for ref in fiches:
        a, b = chiffres(avant, ref), chiffres(apres, ref)
        if a is None and b is None:
            lines.append(f"| `{ref}` | (aucune fiche) | — | — | — |")
            continue
        for k in b or a or {}:
            va, vb = (a or {}).get(k), (b or {}).get(k)
            d = "—" if va is None or vb is None else f"{vb - va:+,.0f}".replace(",", " ")
            lines.append(f"| `{ref}` | {k} | {_n(va)} | {_n(vb)} | {d} |")
    return "\n".join(lines) + "\n"
