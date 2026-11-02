"""`lacarte-collecte` (`python -m lacarte_collecte.cli`), on the server:

- `tourner [--heures H]`: a run (lacarte-collecte.service, every 6 hours): the communes, then the
  DGCL, then the DILA's archives and the prefectoral acts side by side (two servers, two
  queues), within H hours (default 5.5, under the unit's 6), each source resuming where the
  last run stopped; then the derived files and the report (SORTIE). Once everything is
  caught up, only the night's run works (`NUIT`, Paris time; the day's end at once,
  without a request), and one less than 7 days after the last complete one only reads the
  day's flow.
- `source NOM`: one source alone (dgcl, dila, arretes), the same way.
- `effacer IDWEB…`: a BOAMP notice erased from the records (it must also be listed in
  rules/registre_effacements.yaml, which every run and construire apply), then SORTIE again.
- `sortie`: the derived files and the report again, without a request.

On the Mac, offline, on the derived files brought back (data/registre/collecte):
- `seuil tirer DEP TYPE [--n 30]`: the acts drawn for the blind reference readings;
- `seuil mesurer`: the accuracy per département and kind, against the reference readings
  (data/registre/references/<dep>-<type>.csv), and whether each is published.
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import importlib
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import lacarte_collecte as collecte
from lacarte_collecte import sortie
from lacarte_collecte.contexte import Contexte
from lacarte_collecte.etat import Etat, Store
from lacarte_registre import communes, fetch


def contexte(hours: float) -> Contexte:
    return Contexte(
        root=collecte.ROOT,
        sortie=collecte.SORTIE,
        rules_dir=collecte.RULES,
        deadline=time.monotonic() + hours * 3600,
    )


def _communes(ctx: Contexte) -> None:
    """The communes of France (three requests), for the reader; again after 30 days."""
    path = ctx.root / "communes.json"
    if path.is_file() and time.time() - path.stat().st_mtime < 30 * 86400:
        return
    f = ctx.fetcher("communes")
    communes.collect(f, ctx.root)


# The sources a run asks, in order (imported when asked: a module per source)
SOURCES = {
    "dgcl": "lacarte_collecte.dgcl",
    "dila": "lacarte_collecte.dila",
    "arretes": "lacarte_collecte.arretes",
}


def _guarded(name: str, ctx: Contexte, out: dict[str, Any]) -> None:
    try:
        out[name] = importlib.import_module(SOURCES[name]).collect(ctx)
    except (fetch.Blocked, fetch.Forbidden) as e:
        out[name] = {"statut": "ferme_aux_robots", "raison": e.raison, "adresse": e.url}
    except fetch.Failed as e:
        out[name] = {"statut": "echec", "raison": e.raison, "adresse": e.url}


# The night's hours (Paris time) in which a run works once the catching up is over
NUIT = range(0, 6)


def tourner(
    ctx: Contexte, only: str | None = None, now: dt.datetime | None = None
) -> dict[str, Any]:
    now = now or dt.datetime.now(ZoneInfo("Europe/Paris"))
    started = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    run = Etat(ctx.root, "tourner")
    st = run.get()
    if only is None and st.get("rattrapage_fini") and now.hour not in NUIT:
        return {"hors_nuit": now.isoformat(timespec="minutes")}  # caught up: the night's only
    summary: dict[str, Any] = {}
    weekly = (
        st.get("rattrapage_fini")
        and st.get("derniere_complete")
        and (ctx.today - dt.date.fromisoformat(st["derniere_complete"])).days < 7
    )
    _communes(ctx)
    if only in (None, "dgcl") and not weekly:
        _guarded("dgcl", ctx, summary)
    jobs = [n for n in ("dila", "arretes") if only in (None, n)]
    if weekly:
        jobs = [n for n in jobs if n == "dila"]  # the day's flow only
    threads = [threading.Thread(target=_guarded, args=(n, ctx, summary)) for n in jobs]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    rep = sortie.ecrire(ctx, started, summary)
    if only is None and not weekly:
        d = summary.get("dila") or {}
        left = d.get("jours_restants", 1) or d.get("annees_restantes")
        admins = {v for v in (summary.get("arretes") or {}).get("administrations", {}).values()}
        done = not left and admins <= {"termine", "non_couvert", "ferme_aux_robots"}
        run.save(
            rattrapage_fini=bool(done),
            derniere_complete=ctx.today.isoformat() if done else st.get("derniere_complete"),
        )
    return rep


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="lacarte-collecte", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("tourner")
    t.add_argument("--heures", type=float, default=5.5)
    s = sub.add_parser("source")
    s.add_argument("nom", choices=("dgcl", "dila", "arretes"))
    s.add_argument("--heures", type=float, default=5.5)
    e = sub.add_parser("effacer")
    e.add_argument("idweb", nargs="+")
    sub.add_parser("sortie")
    se = sub.add_parser("seuil")
    sse = se.add_subparsers(dest="action", required=True)
    ti = sse.add_parser("tirer")
    ti.add_argument("dep")
    ti.add_argument("type")
    ti.add_argument("--n", type=int, default=30)
    sse.add_parser("mesurer")
    lr = sse.add_parser("lire", help="reference readings through the Batch API (the Mac)")
    lr.add_argument("actes", type=Path, help="JSON lines: id, administration, recueil, acte")
    lr.add_argument("--modele", default="claude-haiku-5-5")
    lr.add_argument("--effort", default="medium")
    lr.add_argument("--sortie", type=Path, required=True, help="the readings' CSV")
    lr.add_argument("--reference", type=Path, help="a reference CSV to compare with")
    sub.add_parser("textes", help="acts' texts from Attrap, JSON lines on stdout (the server)")
    a = p.parse_args(argv)
    if a.cmd == "seuil":
        from lacarte_collecte import seuil

        refs = collecte.SORTIE.parent / "references"
        if a.action == "lire":
            from lacarte_collecte import calibrer

            out = calibrer.lire(a.actes, a.modele, a.effort, a.sortie, a.reference)
        elif a.action == "tirer":
            out = seuil.tirer(sortie.load(collecte.SORTIE / "arretes.jsonl.gz"), a.dep, a.type, a.n)
        else:
            out = seuil.mesurer(
                sortie.load(collecte.SORTIE / "arretes.jsonl.gz"), refs, collecte.RULES
            )
        json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
        return
    if a.cmd == "textes":
        from lacarte_collecte import textes

        root = Path(os.environ.get("LACARTE_TEXTES_DIR") or "/tmp/lacarte-textes")
        textes.main(root, os.environ.get(fetch.CONTACT_ENV))
        return
    collecte.ROOT.mkdir(parents=True, exist_ok=True)
    with (collecte.ROOT / ".tourner.lock").open("w") as lk:
        try:
            fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            sys.exit("lacarte-collecte: a run is already going on")
        ctx = contexte(getattr(a, "heures", 0.5))
        if a.cmd == "tourner":
            rep = tourner(ctx)
        elif a.cmd == "source":
            rep = tourner(ctx, a.nom)
        elif a.cmd == "effacer":
            gone = Store(ctx.root, "avis").forget(set(a.idweb))
            rep = {"effaces": gone, **sortie.ecrire(ctx, dt.datetime.now(dt.UTC).isoformat(), {})}
        else:
            rep = sortie.ecrire(ctx, dt.datetime.now(dt.UTC).isoformat(timespec="seconds"), {})
    if isinstance(rep, dict) and rep.get("hors_nuit"):
        print(f"rattrapage fini, hors de la nuit ({rep['hors_nuit']}) : rien à faire")
        return
    print((collecte.SORTIE / "rapport.txt").read_text("utf-8") if a.cmd != "effacer" else rep)


if __name__ == "__main__":
    main()
