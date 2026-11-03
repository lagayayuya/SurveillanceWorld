"""`lacarte-collecte` (`python -m lacarte_collecte.cli`), on the server:

- `tourner [--heures H]`: a run (lacarte-collecte.service, every 6 hours): the communes, then
  the DGCL, then the DILA's archives and the prefectoral acts side by side (two servers, two
  queues), within H hours (default 5: an hour free before the next run, for the reference
  readings' texts), each source resuming where the last run stopped; then the derived files and
  the report (SORTIE). Once everything is caught up, only the night's run works (`NUIT`, Paris
  time; the day's end at once, without a request), and one less than 7 days after the last
  complete one only reads the day's flow.
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
    from lacarte_collecte.cache import Cache

    Cache(ctx.root).purger(ctx.today)  # the texts kept longer than 12 months
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
    # the reading by the model (the API's key in the unit's environment): the batches sent by
    # the last run fetched, the acts not yet read sent; without the API, the rules alone
    if only in (None, "arretes") and os.environ.get("LACARTE_ANTHROPIC_KEY"):
        from lacarte_collecte import modele

        try:
            lk = (ctx.root / ".modele.lock").open("w")
            fcntl.flock(lk, fcntl.LOCK_EX)
            summary["modele"] = modele.suivre(ctx)
            todo = modele.a_lire(ctx)[:2000]
            summary["modele"]["envoyes"] = len(todo) if modele.envoyer(ctx, todo) else 0
            summary["modele"]["depense"] = modele.depense(ctx)
        except Exception as e:  # noqa: BLE001 (the API down: the run goes on, said in the report)
            summary["modele"] = {"erreur": f"{type(e).__name__}: {e}"[:300]}
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


def charger_env(path: str | None) -> None:
    """An environment file read as systemd's EnvironmentFile: KEY=VALUE lines, whitespace
    around the value stripped, quotes removed, comments ignored; the environment wins."""
    if not path or not Path(path).is_file():
        return
    for line in Path(path).read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith(("#", ";")) or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def main(argv: list[str] | None = None) -> None:
    charger_env(os.environ.get("LACARTE_ENV_FILE"))
    p = argparse.ArgumentParser(prog="lacarte-collecte", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("tourner")
    t.add_argument("--heures", type=float, default=5.0)
    s = sub.add_parser("source")
    s.add_argument("nom", choices=("dgcl", "dila", "arretes"))
    s.add_argument("--heures", type=float, default=5.0)
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
    ca = sse.add_parser("calibrer", help="several models, rereadings, one set of texts (the Mac)")
    ca.add_argument("actes", type=Path)
    ca.add_argument("--modeles", default="claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5")
    ca.add_argument("--relire", default="claude-haiku-5-5,claude-sonnet-5-5")
    ca.add_argument("--effort", default="medium")
    ca.add_argument("--dossier", type=Path, required=True)
    ca.add_argument("--reference", type=Path, required=True)
    me = sse.add_parser("mesurer-lot", help="a drawn lot's references and measure (the Mac)")
    me.add_argument("lot", type=Path)
    me.add_argument("--dossier", type=Path, required=True)
    me.add_argument("--attente", type=float, default=30, help="hours to wait for idle windows")
    rl = sub.add_parser("relire", help="the cached texts read again by the code sent, no request")
    rl.add_argument("--admin")
    rl.add_argument("--actes", help="act ids, comma-separated")
    mo = sub.add_parser("montrer", help="an act's text, from the cache (the server, to diagnose)")
    mo.add_argument("acte")
    er = sub.add_parser("effacer-recueil", help="a recueil's text, acts and record, erased")
    er.add_argument("recueil", nargs="+")
    md = sub.add_parser("modele", help="the reading by the model (the server, as its user)")
    md.add_argument(
        "action", choices=("lire", "suivre", "calibrer", "references", "mesurer", "statut")
    )
    md.add_argument("--types", help="dep-kind pairs, comma-separated (references)")
    md.add_argument("--graine", type=int, default=20261103)
    md.add_argument("--admin")
    md.add_argument("--actes", help="act ids, comma-separated")
    sub.add_parser("textes", help="acts' texts from Attrap, JSON lines on stdout (the server)")
    a = p.parse_args(argv)
    if a.cmd == "seuil":
        from lacarte_collecte import seuil

        refs = collecte.SORTIE.parent / "references"
        if a.action == "mesurer-lot":
            from lacarte_collecte import calibrer

            out = calibrer.mesurer_lot(a.lot, a.dossier, a.attente)
        elif a.action == "calibrer":
            from lacarte_collecte import calibrer

            out = calibrer.calibrer(
                a.actes,
                a.modeles.split(","),
                [m for m in a.relire.split(",") if m],
                a.effort,
                a.dossier,
                a.reference,
            )
        elif a.action == "lire":
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
    if a.cmd == "relire":
        # beside a run if need be (Ju: iterate without waiting): it only appends records
        from lacarte_collecte import arretes

        ctx = contexte(1.0)
        out = arretes.relire(ctx, a.admin, set(a.actes.split(",")) if a.actes else None)
        sortie.ecrire(ctx, dt.datetime.now(dt.UTC).isoformat(timespec="seconds"), {"relire": out})
        print(json.dumps(out, ensure_ascii=False))
        return
    if a.cmd == "modele":
        from lacarte_collecte import modele

        ctx = contexte(5.0)
        ctx.root.mkdir(parents=True, exist_ok=True)
        # one follower of the batches at a time (this command, the run's end): a batch is
        # never processed twice
        lk = (ctx.root / ".modele.lock").open("w")
        fcntl.flock(lk, fcntl.LOCK_EX)
        if a.action == "calibrer":
            out = modele.calibrer(ctx, json.load(sys.stdin))
        elif a.action == "references":
            # stdin: the ids that tuned the reader or the instruction, never drawn
            exclure = set(json.load(sys.stdin)) if not sys.stdin.isatty() else set()
            pairs = [tuple(x.split("-", 1)) for x in (a.types or "").split(",") if x]
            out = modele.references_lot(ctx, pairs, a.graine, exclure)
        elif a.action == "statut":
            out = modele.statut(ctx)
        elif a.action == "mesurer":
            out = modele.mesurer(ctx)
            (ctx.sortie / "mesures.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
        elif a.action == "lire":
            todo = modele.a_lire(ctx, a.admin, set(a.actes.split(",")) if a.actes else None)
            out = {"actes": len(todo), "lot": modele.envoyer(ctx, todo)}
        else:
            out = modele.suivre(ctx)
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return
    if a.cmd == "montrer":
        from lacarte_collecte import textes
        from lacarte_collecte.cache import Cache

        act = next((x for x in Store(collecte.ROOT, "actes").records() if x["id"] == a.acte), None)
        d = Cache(collecte.ROOT).get(act["recueil"]) if act else None
        if not d:
            sys.exit(f"{a.acte}: no act, or its recueil's text is not in the cache")
        print(f"{act['id']} · {act['type']} · {d['name']} · {d['date']}\n")
        print(textes.fenetre(d["content"], act["acte"].rsplit(":", 1)[-1]) or d["content"][:20000])
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
        elif a.cmd == "effacer-recueil":
            from lacarte_collecte.cache import Cache

            gone = set(a.recueil)
            for rid in gone:
                Cache(ctx.root).effacer(rid)
            acts = Store(ctx.root, "actes")
            acts.compact({x["id"] for x in acts.records() if x.get("recueil") in gone})
            Store(ctx.root, "recueils").compact(gone)
            rep = sortie.ecrire(ctx, dt.datetime.now(dt.UTC).isoformat(timespec="seconds"), {})
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
