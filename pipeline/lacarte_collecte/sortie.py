"""What the collection gives `construire`, in SORTIE (each file written whole, then renamed):

- `avis.jsonl.gz`: the BOAMP's video surveillance notices (boamp.notice's shape, plus the
  DILA's `mention`), each idweb once, the erased ones (rules/registre_effacements.yaml) out;
- `subventions_etat.jsonl.gz`: the DGCL's subsidies (the pilot's event shape);
- `arretes.jsonl.gz`: the acts read (parse_raa.Acte, plus their recueil, administration,
  département, official address and the text they were read from);
- `recueils.jsonl.gz`: every recueil met, read or not (`statut`, `raison`, `lien`);
- `couverture.json`: per administration and source, its state, the last month read, its
  newest recueil and whether it is fresh (`fraicheur_jours`); the DILA's days and years
  left; the DGCL's last year published;
- `rapport.json` and `rapport.txt`: the collection's report: requests per source and per
  address, their time, the cuts, the stale administrations.
"""

from __future__ import annotations

import csv
import datetime as dt
import gzip
import json
import os
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from lacarte_collecte.contexte import Contexte, rules
from lacarte_collecte.etat import Etat, Store


def _write_gz(path: Path, items: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}")
    n = 0
    with gzip.open(tmp, "wt", encoding="utf-8") as g:
        for x in items:
            g.write(json.dumps(x, ensure_ascii=False, separators=(",", ":")) + "\n")
            n += 1
    tmp.replace(path)
    return n


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    tmp.replace(path)


def load(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    with gzip.open(path, "rt", encoding="utf-8") as g:
        return [json.loads(line) for line in g if line.strip()]


def couverture(ctx: Contexte) -> dict[str, Any]:
    conf = rules("collecte_administrations.yaml", ctx.rules_dir)["administrations"]
    src = rules("registre_sources.yaml", ctx.rules_dir)["sources"]
    days = int(src["attrap"]["fraicheur_jours"])
    att, par = Etat(ctx.root, "attrap").all(), Etat(ctx.root, "parcours").all()
    admins = {}
    for admin, c in conf.items():
        st = {**att.get(admin, {}), **par.get(admin, {})}
        newest = st.get("dernier_recueil") or st.get("dernier_document")
        months = st.get("mois") or {}
        upto = st.get("jusqu_au") or {}
        read_to = min(months.values()) if months else None
        if upto and st.get("statut") == "termine":
            read_to = None  # every kind searched over the whole period: to the search's day
        if read_to:
            # the month given is the last one searched: read to its end
            d = dt.date.fromisoformat(read_to)
            read_to = min(
                (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1),
                ctx.today,
            ).isoformat()
        stale = bool(newest) and (ctx.today - dt.date.fromisoformat(newest)).days > days
        admins[admin] = {
            "code": c["code"],
            "genre": c["genre"],
            "nom": c["nom"],
            "source": "attrap"
            if c.get("attrap") and not c.get("collecteur_arrete")
            else "parcours"
            if c.get("parcours") and c.get("index")
            else None,
            "defi": bool(c.get("defi")),
            "statut": st.get("statut") or "pas_encore_lu",
            "raison": st.get("raison"),
            "lu_jusqu_au": read_to
            or (min(upto.values()) if upto and st.get("statut") == "termine" else None),
            "dernier_recueil": newest,
            "perime": stale,
        }
    dila = Etat(ctx.root, "dila")
    dila_days = {k[5:]: v for k, v in dila.all().items() if k.startswith("jour-")}
    over = sorted(d for d, v in dila_days.items() if v.get("termine"))
    years = {
        k[6:]: v.get("termine", False) for k, v in dila.all().items() if k.startswith("annee-")
    }
    dgcl = Etat(ctx.root, "dgcl").get("")
    return {
        "le": ctx.today.isoformat(),
        "fraicheur_jours": days,
        "administrations": admins,
        "dila": {
            "jours_lus": len(over),
            "premier_jour": over[0] if over else None,
            "dernier_jour": over[-1] if over else None,
            "annees": years,
        },
        "dgcl": {
            "annees": dgcl.get("annees") or [],
            "derniere_annee_publiee": dgcl.get("derniere_annee_publiee"),
        },
    }


def journal(root: Path, since: str) -> dict[str, Any]:
    """The requests journaled since `since` (UTC, ISO): per source and per address, their
    number, their time, their cuts (network errors) and refusals."""
    per_source: dict[str, Counter] = defaultdict(Counter)
    per_address: dict[str, Counter] = defaultdict(Counter)
    starts: dict[str, list[dt.datetime]] = {}
    for p in sorted((root / "brut" / "_journal").glob("requetes-*.tsv")):
        with p.open(encoding="utf-8") as fh:
            for row in csv.reader(fh, delimiter="\t"):
                if len(row) < 6 or row[0] < since:
                    continue
                when, address, _, status, ms, source = row[:6]
                # the journal dates a request when it ends: its start is that less its time,
                # and the pace is between two starts (cadence.py waits from a start)
                at = dt.datetime.fromisoformat(when) - dt.timedelta(milliseconds=float(ms or 0))
                starts.setdefault(address, []).append(at)
                for c in (per_source[source], per_address[address]):
                    c["requetes"] += 1
                    c["ms"] += int(float(ms or 0))
                    c["coupures"] += status == "réseau"
                    c["refus"] += status in ("401", "403", "429")
    gap: dict[str, float] = {}
    for address, ts in starts.items():
        ts.sort()
        if len(ts) > 1:
            gap[address] = min((b - a).total_seconds() for a, b in zip(ts, ts[1:], strict=False))
    adresses = {
        k: {**dict(v), "ecart_min_s": round(gap[k], 2) if k in gap else None}
        for k, v in per_address.items()
    }
    return {"sources": {k: dict(v) for k, v in per_source.items()}, "adresses": adresses}


def ecrire(ctx: Contexte, started: str, summary: dict[str, Any]) -> dict[str, Any]:
    erased = ctx.effaces()
    out = ctx.sortie
    n = {
        "avis": _write_gz(
            out / "avis.jsonl.gz",
            (r for r in Store(ctx.root, "avis").records() if r["id"] not in erased),
        ),
        "subventions_etat": _write_gz(
            out / "subventions_etat.jsonl.gz", Store(ctx.root, "subventions_etat").records()
        ),
        "arretes": _write_gz(out / "arretes.jsonl.gz", Store(ctx.root, "actes").records()),
        "recueils": _write_gz(out / "recueils.jsonl.gz", Store(ctx.root, "recueils").records()),
        # the fields read by the rules and the model, checked, with their origin (no text)
        "champs": _write_gz(out / "champs.jsonl.gz", Store(ctx.root, "champs").records()),
    }
    cov = couverture(ctx)
    _write_json(out / "couverture.json", cov)
    stale = sorted(a for a, v in cov["administrations"].items() if v["perime"])
    rep = {
        "debut": started,
        "fin": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "fichiers": n,
        "sources": summary,
        "journal": journal(ctx.root, started),
        "perimes": stale,
    }
    _write_json(out / "rapport.json", rep)
    lines = [f"Collecte du {started} au {rep['fin']}"]
    lines += [f"  {k} : {v} lignes" for k, v in n.items()]
    for s, c in sorted(rep["journal"]["sources"].items()):
        lines.append(
            f"  {s} : {c['requetes']} requêtes, {c['ms'] / 1000:.0f} s, "
            f"{c['coupures']} coupures, {c['refus']} refus"
        )
    for a, c in sorted(rep["journal"]["adresses"].items(), key=lambda kv: -kv[1]["requetes"]):
        lines.append(
            f"  adresse {a} : {c['requetes']} requêtes, {c['coupures']} coupures, "
            f"écart minimal {c['ecart_min_s']} s"
        )
    if stale:
        names = ", ".join(f"{cov['administrations'][a]['nom']} ({a})" for a in stale)
        lines.append(f"  sans nouveau recueil depuis {cov['fraicheur_jours']} jours : {names}")
    (out / "rapport.txt").write_text("\n".join(lines) + "\n", "utf-8")
    return rep
