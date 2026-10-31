"""The communes of France (API Découpage administratif, INSEE's COG): what turns a buyer's
SIREN into its commune, a commune into its intercommunality and département, and gives the
populations the amounts per inhabitant are measured with, and each commune's box (west, south,
east, north), which frames the commune on the drone view's map whatever it holds.

Out: <root>/national/communes.json {"communes": {insee: {nom, dep, pop, epci, siren, bbox}},
"epcis": {siren: nom}, "departements": {code: nom}}. Three requests.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from lacarte_registre import fetch

SOURCE = "communes"


def box(g: dict[str, Any] | None) -> list[float] | None:
    """[west, south, east, north] of the API's `bbox` polygon, to 5 decimals (about a metre)."""
    try:
        ring = g["coordinates"][0] if g else None
        xs = [p[0] for p in ring or []]
        ys = [p[1] for p in ring or []]
    except (KeyError, IndexError, TypeError):
        return None
    if not xs:
        return None
    return [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)]


def collect(f: fetch.Fetcher, out_dir: Path) -> dict[str, Any]:
    src = f.conf["sources"][SOURCE]
    communes = {
        c["code"]: {
            "nom": c["nom"],
            "dep": c.get("codeDepartement"),
            "pop": int(c.get("population") or 0),
            "epci": c.get("codeEpci") or "",
            "siren": c.get("siren"),
            "bbox": box(c.get("bbox")),
        }
        for c in f.get_json(src["communes"])
    }
    epcis = {e["code"]: e["nom"] for e in f.get_json(src["epcis"])}
    deps = {d["code"]: d["nom"] for d in f.get_json(src["departements"])}
    out = out_dir / "communes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(".communes.json.tmp")
    data = {"communes": communes, "epcis": epcis, "departements": deps}
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out)
    return {"source": SOURCE, "communes": len(communes), "epcis": len(epcis),
            "departements": len(deps), "requetes": f.requests}  # fmt: skip
