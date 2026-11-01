"""The publication threshold per département and act kind (rules/collecte_seuils.yaml).

The reference readings are made blind on the official PDF (LECTURE-AVEUGLE: a reader that
never sees what the reader below produced), by cheaper sub-agents during a lot, never by a
person correcting an act: they measure, they never correct. One CSV per département and
kind (`<refs>/<dep>-<type>.csv`), one row per act, the columns of the blind reading:
acte, dispositif, sous_type, commune, insee, n_interieur, n_exterieur, n_voie_publique,
n_total, dates, horaires, n_cameras_drone, zone_mot, lisible, remarque, plus `source`
(« pdf », or « attrap » for the hosts behind an anti-robot check, whose PDFs we never ask).

- `tirer`: the acts to read: `echantillon` drawn at random (a fixed seed: the same draw for
  the same acts) among the kind's acts since `depuis`, all of them when there are fewer.
- `juger`: one act, read and referenced: right or not, and whether a number is wrong.
- `mesurer`: per département and kind, the acts measured, the rate, the wrong numbers, and
  `publie` (rate ≥ `taux` and no wrong number).
"""

from __future__ import annotations

import csv
import random
import re
import unicodedata
from pathlib import Path
from typing import Any

import yaml


def conf(rules_dir: Path) -> dict[str, Any]:
    return yaml.safe_load((rules_dir / "collecte_seuils.yaml").read_text("utf-8"))


def tirer(
    acts: list[dict[str, Any]],
    dep: str,
    kind: str,
    n: int = 30,
    depuis: str = "2024-01-01",
    seed: int = 20261101,
) -> list[dict[str, Any]]:
    pool = sorted(
        (
            a
            for a in acts
            if a["departement"] == dep
            and a["type"] == kind
            and (a.get("date_acte") or a["recueil_date"]) >= depuis
        ),
        key=lambda a: a["id"],
    )
    pick = pool if len(pool) <= n else random.Random(f"{seed}:{dep}:{kind}").sample(pool, n)
    return [
        {
            "acte": a["id"],
            "recueil": a["recueil_nom"],
            "url": a["url"],
            "date": a["recueil_date"],
            "texte": a["texte"],
        }
        for a in pick
    ]


def _norm(s: Any) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _num(x: Any) -> int | None:
    try:
        return int(float(str(x).strip()))
    except ValueError:
        return None


def _hours(s: Any) -> list[str]:
    items = s if isinstance(s, list) else [str(s or "")]
    found = {h for x in items for h in re.findall(r"\d{1,2}h\d{2}", str(x).replace(" ", ""))}
    return sorted(found)


def _span(days: Any) -> str:
    if isinstance(days, list):
        return "" if not days else days[0] if len(days) == 1 else f"{days[0]} au {days[-1]}"
    return str(days or "")


def juger(read: dict[str, Any] | None, ref: dict[str, str]) -> dict[str, Any]:
    """{"juste", "nombre_faux", "erreurs"} for one act; `read` is the reader's act or None."""
    if read is None:
        return {"juste": False, "nombre_faux": False, "erreurs": ["acte non lu"]}
    errs, wrong = [], False
    f = read.get("champs") or {}
    if read["type"] != ref["dispositif"]:
        errs.append(f"type {read['type']}≠{ref['dispositif']}")
    if ref.get("insee") and _norm(read.get("insee")) != _norm(ref["insee"]):
        errs.append(f"commune {read.get('commune')}≠{ref.get('commune')}")
    counts: list[tuple[str, Any]] = []
    if ref["dispositif"] in ("videoprotection", "cameras_pietons"):
        counts = [
            (k, f.get(k))
            for k in ("n_total", "n_interieur", "n_exterieur", "n_voie_publique")
            if k == "n_total" or f.get(k) is not None
        ]
    elif ref["dispositif"] == "drone":
        counts = [("n_cameras_drone", f.get("n_cameras_drone"))]
        if _norm(_span(f.get("dates"))) != _norm(ref.get("dates")):
            errs.append(f"dates {_span(f.get('dates'))}≠{ref.get('dates')}")
        if _hours(f.get("horaires")) != _hours(ref.get("horaires")):
            errs.append(f"horaires {f.get('horaires')}≠{ref.get('horaires')}")
        key = _norm(ref.get("zone_mot"))
        if key and key not in _norm(f.get("zone_extrait")) + " " + _norm(read.get("commune")):
            errs.append(f"zone sans « {ref.get('zone_mot')} »")
    for k, v in counts:
        truth = _num(ref.get(k, ""))
        if v is None and truth is None:
            continue
        if v is None:
            errs.append(f"{k} absent (≠{truth})")
        elif v != truth:
            errs.append(f"{k} {v}≠{truth}")
            wrong = True  # a number given and wrong: never published
    return {"juste": not errs, "nombre_faux": wrong, "erreurs": errs}


def references(folder: Path) -> dict[tuple[str, str], list[dict[str, str]]]:
    out: dict[tuple[str, str], list[dict[str, str]]] = {}
    for p in sorted(folder.glob("*-*.csv")) if folder.is_dir() else []:
        dep, kind = p.stem.split("-", 1)
        with p.open(encoding="utf-8", newline="") as fh:
            out[(dep, kind)] = list(csv.DictReader(fh))
    return out


def mesurer(acts: list[dict[str, Any]], refs_dir: Path, rules_dir: Path) -> dict[str, Any]:
    c = conf(rules_dir)
    by_id = {a["id"]: a for a in acts}
    out: dict[str, Any] = {}
    for (dep, kind), rows in references(refs_dir).items():
        verdicts = [juger(by_id.get(r["acte"]), r) for r in rows if r.get("lisible") != "non"]
        right = sum(v["juste"] for v in verdicts)
        wrong = sum(v["nombre_faux"] for v in verdicts)
        rate = right / len(verdicts) if verdicts else 0.0
        need = float(c["types"].get(kind, {}).get("taux", 1.0))
        out[f"{dep}-{kind}"] = {
            "departement": dep,
            "type": kind,
            "mesures": len(verdicts),
            "justes": right,
            "taux": round(rate, 3),
            "nombres_faux": wrong,
            "seuil": need,
            "publie": bool(verdicts) and rate >= need and wrong == 0,
            "source_references": sorted({r.get("source") or "pdf" for r in rows}),
            "erreurs": [e for v in verdicts for e in v["erreurs"]][:20],
        }
    return out
