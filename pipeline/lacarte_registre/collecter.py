"""`lacarte-registre collecter [--source S] [--resume] [--departement D …]`: the national
public procurement, from its sources, under the machine's lock (lacarte.lock).

The sources, in this order: `communes` (the communes of France, three requests), `decp`
(the contracts), `boamp` (the notices), `sirene` (the companies and buyers they name: after
the other two). Each asks through fetch.py only and keeps its raw files under
data/registre/brut/<source>/ (not versioned).

All or nothing: the normalised outputs are written to data/registre/national/.prochain/,
then moved into data/registre/national/ (one rename per file) only when every source asked
succeeded. A source that fails or is blocked leaves the previous outputs as they were, its
state (brut/<source>/etat.json) says why, and `--resume` goes on from its cursor. construire,
offline, reads data/registre/national/ alone.

`--departement`: a partial collection (the session's test on the Rhône); its outputs say so
and the coverage reads them as such.
"""

from __future__ import annotations

import datetime as dt
import json
import shutil
from pathlib import Path
from typing import Any

import lacarte_registre as registre
from lacarte import lock
from lacarte_registre import boamp, communes, decp, fetch, sirene

SOURCES = ("communes", "decp", "boamp", "sirene")
OUTPUTS = {
    "communes": ("communes.json",),
    "decp": ("decp.jsonl.gz", "decp.json"),
    "boamp": ("boamp.jsonl.gz", "boamp.json"),
    "sirene": ("sirene.json",),
}


def _sirens(folder: Path, fallback: Path) -> set[str]:
    """The SIRENs met: the contracts' holders and buyers, the notices' holders."""
    out: set[str] = set()

    def pick(name: str) -> Path | None:
        for d in (folder, fallback):
            if (d / name).is_file():
                return d / name
        return None

    if p := pick("decp.jsonl.gz"):
        for c in decp.load(p):
            out.add((c.get("acheteur_id") or "")[:9])
            for m in c["lignes"]:
                out |= {t[:9] for t in m.get("titulaires") or [] if t[:9].isdigit()}
    if p := pick("boamp.jsonl.gz"):
        for n in boamp.load(p):
            out |= set(n["resultat"]["titulaires"])
    return {s for s in out if len(s) == 9 and s.isdigit()}


def run(
    root: Path | None = None,
    sources: tuple[str, ...] = SOURCES,
    resume: bool = False,
    departements: set[str] | None = None,
    contact: str | None = None,
    today: dt.date | None = None,
) -> dict[str, Any]:
    root = root or registre.ROOT
    today = today or dt.date.today()
    final = root / "national"
    nxt = final / ".prochain"
    if nxt.exists() and not resume:
        shutil.rmtree(nxt)
    nxt.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {}
    for name in [s for s in SOURCES if s in sources]:
        f = fetch.Fetcher(name, root, contact=contact)
        try:
            if name == "communes":
                s = communes.collect(f, nxt)
            elif name == "decp":
                s = decp.collect(f, nxt, departements, resume)
            elif name == "boamp":
                s = boamp.collect(f, nxt, departements, resume, today)
            else:
                s = sirene.collect(f, nxt, _sirens(nxt, final))
        except (fetch.Blocked, fetch.Forbidden, fetch.Failed) as e:
            f.save_state(statut="bloque" if not isinstance(e, fetch.Failed) else "echec",
                         raison=e.raison, adresse=e.url)  # fmt: skip
            raise
        s["collecte_le"] = today.isoformat()
        for out in OUTPUTS[name]:
            if out.endswith(".json") and (nxt / out).is_file() and name in ("decp", "boamp"):
                data = json.loads((nxt / out).read_text("utf-8"))
                (nxt / out).write_text(json.dumps({**data, **s}, ensure_ascii=False), "utf-8")
        f.save_state(statut="termine", raison=None, curseur=None, derniere_collecte=s)
        summary[name] = s
    # every source asked succeeded: their outputs in place, one rename each
    for name in summary:
        for out in OUTPUTS[name]:
            if (nxt / out).is_file():
                (nxt / out).replace(final / out)
    shutil.rmtree(nxt, ignore_errors=True)
    return summary


def main(**kw: Any) -> dict[str, Any]:
    with lock.held("lacarte-registre collecter"):
        return run(**kw)
