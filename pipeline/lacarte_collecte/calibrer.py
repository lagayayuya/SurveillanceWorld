"""`lacarte-collecte seuil lire ACTES --modele M --sortie CSV [--reference CSV]`, on the Mac: the
acts' texts asked from the server (`textes`, over ssh to DEPLOY_TARGET, read from the deploy
environment file without printing it), refused while the collection's unit runs (one queue
per address: the unit's for attrap.fr); then one batch of reference readings
(references.py); the readings written to CSV, their usage and cost beside it
(`<sortie>.cout.json`), and, given a reference file, the comparison per act on the commune,
the numbers of cameras, the dates and the hours. No text is written anywhere."""

from __future__ import annotations

import csv
import json
import re
import subprocess
from pathlib import Path
from typing import Any

import yaml

import lacarte_collecte as collecte
from lacarte_collecte import references

DEPLOY_ENV = Path.home() / ".config" / "la-carte" / "deploy.env"
REMOTE = "/srv/lacarte-collecte/code/current"


def _target(path: Path = DEPLOY_ENV) -> str:
    for line in path.read_text("utf-8").splitlines():
        if line.startswith("DEPLOY_TARGET="):
            return line.split("=", 1)[1].strip().strip("'\"")
    raise RuntimeError(f"{path}: no DEPLOY_TARGET")


def textes_du_serveur(acts: list[dict[str, Any]], contact: str) -> dict[str, dict[str, Any]]:
    target = _target()
    state = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            target,
            "sudo -n /usr/bin/systemctl status --no-pager lacarte-collecte.service | sed -n 3p",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    ).stdout
    # « inactive (dead) » contains « active (»: the state's word, whole
    if re.search(r"Active: (activating|active|deactivating|reloading)\b", state):
        raise RuntimeError("la collecte tourne sur le serveur : textes demandés après son passage")
    cmd = (
        f"cd {REMOTE} && LACARTE_ROBOT_CONTACT='{contact}' PYTHONPATH=pipeline "
        f".venv/bin/python -m lacarte_collecte.cli textes"
    )
    asked = "".join(
        json.dumps({k: a[k] for k in ("id", "administration", "recueil", "acte")}) + "\n"
        for a in acts
    )
    r = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", target, cmd],
        input=asked,
        capture_output=True,
        text=True,
        timeout=3600,
        check=True,
    )
    return {x["id"]: x for x in map(json.loads, r.stdout.splitlines()) if x.get("texte")}


def lire(
    actes: Path,
    modele: str,
    effort: str,
    sortie: Path,
    reference: Path | None,
    contact: str | None = None,
) -> dict[str, Any]:
    import os

    acts = [json.loads(x) for x in actes.read_text("utf-8").splitlines() if x.strip()]
    contact = contact or os.environ.get("LACARTE_ROBOT_CONTACT") or ""
    if not contact:
        raise RuntimeError("LACARTE_ROBOT_CONTACT : le contact du robot qui demande les textes")
    texts = textes_du_serveur(acts, contact)
    ready = [{**a, **texts[a["id"]]} for a in acts if a["id"] in texts]
    rows = references.lire(ready, modele, effort, out=print) if ready else []
    by_id = {r["id"]: r for r in rows}
    cols = [
        references.en_colonnes(by_id[a["id"]], a["id"])
        if a["id"] in by_id
        else {
            "acte": a["id"],
            "remarque": "texte introuvable",
            "source": "texte Attrap",
            "modele": modele,
        }
        for a in acts
    ]
    references.ecrire(sortie, cols)
    prix = yaml.safe_load((collecte.RULES / "collecte_seuils.yaml").read_text("utf-8"))
    cost = references.cout(rows, prix["references"]["prix"])
    out: dict[str, Any] = {
        "modele": modele,
        "effort": effort,
        "actes": len(acts),
        "lus": sum(1 for r in rows if r.get("lecture")),
        **cost,
        "lots": sorted({r["lot"] for r in rows}),
    }
    if reference:
        with reference.open(encoding="utf-8", newline="") as fh:
            refs = {r["acte"]: r for r in csv.DictReader(fh)}
        per: dict[str, dict[str, bool]] = {}
        for c in cols:
            ref = refs.get(c["acte"].rsplit(":", 1)[-1]) or refs.get(c["acte"])
            if ref:
                per[c["acte"]] = references.comparer(c, ref)
        fields = ("commune", "nombres", "dates", "horaires")
        out["justes"] = {
            f: f"{sum(v[f] for v in per.values() if f in v)}/"
            f"{sum(1 for v in per.values() if f in v)}"
            for f in fields
        }
        out["tout_juste"] = f"{sum(all(v.values()) for v in per.values())}/{len(per)}"
        out["ecarts"] = {
            k: [f for f, ok in v.items() if not ok] for k, v in per.items() if not all(v.values())
        }
    sortie.with_name(sortie.stem + ".cout.json").write_text(
        json.dumps({**out, "lectures": rows}, ensure_ascii=False, indent=1), "utf-8"
    )
    return out
