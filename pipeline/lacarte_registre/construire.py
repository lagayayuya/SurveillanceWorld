"""`lacarte-registre construire`: the registre's site files from the imported pilot.

Reads data/registre/pilote/ (importer.py), rules/registre_corrections.yaml then, when
present, data/registre/corrections.yaml (the corrections accepted in /revue: exporter.py),
and rules/registre_couverture.yaml; flags every document (regles.py), measures the coverage
(couverture.py) and writes each page's file (fermetures.py) and the commune maps' layers into
data/registre/site/, served
at /data/registre/. It holds the machine's lock (lacarte.lock), as `lacarte build` does, and
writes in a temporary folder renamed at the end: an interrupted run leaves the previous
site as it was.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import lacarte_registre as registre
from lacarte import lock
from lacarte_registre import couverture, exporter, fermetures, regles, sortie


def run(root: Path | None = None, rules: Path | None = None) -> dict[str, Any]:
    """Build <root>/site from <root>/pilote; returns a summary of what was written."""
    root = root or registre.ROOT
    rules = rules or registre.RULES
    pilote = regles.charger(root / "pilote")
    accepted = root / exporter.FILE
    corr = regles.corrections(rules / "registre_corrections.yaml",
                              *([accepted] if accepted.is_file() else []))  # fmt: skip
    reg = regles.appliquer(pilote, corr)
    conf = couverture.rules(rules / "registre_couverture.yaml")
    cov = couverture.build(reg, conf)
    maps = sorted((root / "pilote" / "carte").glob("*.json"))
    ctx = fermetures.Context(
        reg, cov, couverture.pilot_departements(conf), frozenset(m.stem for m in maps)
    )
    summary: dict[str, Any] = {}

    def write(tmp: Path) -> None:
        def put(rel: str, data: dict[str, Any]) -> None:
            sortie.dump(tmp / rel, data)

        summary["fichiers"] = fermetures.write_all(ctx, tmp, put)
        # the tilted commune maps' layers, as imported (OpenStreetMap, ODbL)
        if maps:
            (tmp / "carte").mkdir()
            for path in maps:
                shutil.copyfile(path, tmp / "carte" / path.name)
        summary["fichiers"]["carte"] = len(maps)

    sortie.replace_dir(root / "site", write)
    summary["documents"] = len(reg.evenements)
    summary["non_lus"] = cov["non_lus"]
    summary["maj"] = cov["maj"]
    return summary


def main(root: Path | None = None) -> dict[str, Any]:
    with lock.held("lacarte-registre construire"):
        return run(root)
