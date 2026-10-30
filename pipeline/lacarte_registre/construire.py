"""`lacarte-registre construire`: the registre's site files from the imported pilot.

First the corrections accepted in /revue, exported from the database (exporter.py: over ssh,
DEPLOY_TARGET by default, or --dsn) into data/registre/corrections.yaml: a build never reads
an export older than the database's last decision (owner's answer on lot R1b). Without the
database it stops, unless --sans-corrections: then it ignores any older export and its mark
(data/registre/construction.json, not served) says so, and `lacarte-registre verifier`, which
the deploy runs, refuses to send it.

Reads data/registre/pilote/ (importer.py) and, when collected, data/registre/national/
(`lacarte-registre collecter`: the DECP, the BOAMP, SIRENE and the communes of France,
assembled by national.py and merged with the pilot by fusion.py: a document in both is the
national one), rules/registre_corrections.yaml then that export,
and rules/registre_couverture.yaml; flags every document (regles.py), measures the coverage
(couverture.py) and writes each page's file (fermetures.py) and the commune maps' layers into
data/registre/site/, served
at /data/registre/. It holds the machine's lock (lacarte.lock), as `lacarte build` does, and
writes in a temporary folder renamed at the end: an interrupted run leaves the previous
site as it was.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import lacarte_registre as registre
from lacarte import lock
from lacarte_registre import (
    couverture,
    exporter,
    fermetures,
    fusion,
    national,
    regles,
    sortie,
)

MARK = "construction.json"


class NoDatabase(Exception):
    """construire asked without a way to the database's corrections."""


def run(
    root: Path | None = None, rules: Path | None = None, accepted: bool = True
) -> dict[str, Any]:
    """Build <root>/site from <root>/pilote and, unless `accepted` is false, the corrections
    exported beside it; returns a summary of what was written."""
    root = root or registre.ROOT
    rules = rules or registre.RULES
    pilote = regles.charger(root / "pilote")
    nat = None
    if (root / "national" / "decp.jsonl.gz").is_file():
        # the national public procurement (lacarte-registre collecter), merged first
        nat = national.assembler(root)
        pilote, merged = fusion.fusionner(pilote, nat)
    export = root / exporter.FILE
    corr = regles.corrections(rules / "registre_corrections.yaml",
                              *([export] if accepted and export.is_file() else []))  # fmt: skip
    reg = regles.appliquer(pilote, corr)
    conf = couverture.rules(rules / "registre_couverture.yaml")
    cov = couverture.build(reg, conf, nat["sources"] if nat else None)
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
    # the names served without a reference to a record, by type and reason (refs.py)
    summary["sans_reference"] = {
        f"{k}/{why}": n for (k, why), n in sorted(ctx.manquants.items()) if n
    }
    if nat:
        summary["fusion"] = merged
    summary["non_lus"] = cov["non_lus"]
    summary["maj"] = cov["maj"]
    return summary


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(
    root: Path | None = None,
    *,
    dsn: str | None = None,
    ssh: str | None = None,
    sans_corrections: bool = False,
) -> dict[str, Any]:
    """The command, under the machine's lock: the database's accepted corrections exported
    (exporter.export), then the build, then its mark; `sans_corrections` builds without them."""
    root = root or registre.ROOT
    if not sans_corrections and not (dsn or ssh):
        raise NoDatabase(
            "construire exports the corrections accepted in /revue first: give --ssh HOST "
            "(or DEPLOY_TARGET) or --dsn DSN; --sans-corrections builds without them, and the "
            "deploy refuses such a build"
        )
    with lock.held("lacarte-registre construire"):
        export = None if sans_corrections else exporter.export(dsn, ssh, root)
        summary = run(root, accepted=export is not None)
        mark = {
            "corrections": "base" if export else "sans",
            "exportees": export["corrections"] if export else None,
            "le": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "index_sha256": _sha256(root / "site" / "index.json"),
        }
        sortie.dump(root / MARK, mark)
        summary["corrections"] = mark
        return summary


def verifier(root: Path | None = None) -> str | None:
    """Why the built site may not be deployed (`lacarte-registre verifier`, deploy.sh), or
    None: built by construire with the database's corrections, and not since replaced."""
    root = root or registre.ROOT
    path = root / MARK
    if not path.is_file():
        return f"no {MARK}: build the register with `lacarte-registre construire`"
    mark = json.loads(path.read_text(encoding="utf-8"))
    if mark.get("corrections") != "base":
        return "built --sans-corrections: build it again with the database's corrections"
    index = root / "site" / "index.json"
    if not index.is_file() or _sha256(index) != mark.get("index_sha256"):
        return "the site is not the one the last construire built: build it again"
    return None
