"""The communes of France (API Découpage administratif, INSEE's COG): what turns a buyer's
SIREN into its commune, a commune into its intercommunality and département, and gives the
populations the amounts per inhabitant are measured with.

Out: <root>/national/communes.json {"communes": {insee: {nom, dep, pop, epci, siren}},
"epcis": {siren: nom}, "departements": {code: nom}}. Three requests.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from lacarte_registre import fetch

SOURCE = "communes"


def collect(f: fetch.Fetcher, out_dir: Path) -> dict[str, Any]:
    src = f.conf["sources"][SOURCE]
    communes = {
        c["code"]: {
            "nom": c["nom"],
            "dep": c.get("codeDepartement"),
            "pop": int(c.get("population") or 0),
            "epci": c.get("codeEpci") or "",
            "siren": c.get("siren"),
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
