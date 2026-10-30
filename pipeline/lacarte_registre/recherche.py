"""What the national search and the lists read, written by construire.

- data/registre/recherche.tsv.gz (not served: the database's, migration 027): one row per
  document for GET /api/registre/recherche: its keys for the filters (kind, département,
  device, year group, as the registre's home names them), its sorts (date, counted amount),
  its words (title, objet, commune, buyer or beneficiary, companies, reference, the other
  communes of a shared act; accents and case folded) and the document with the names it
  needs, as the files serve them (references included, refs.py). Loaded at the deploy by
  db/load_registre.sh; `charger` loads it the same way (the tests).
- site/listes.json: the register's lists of names (communes, intercommunalities,
  départements, buyers, companies; the redesign v2's V2-Liste), each row with its figures,
  uncut, the names they need with their references, and every list's count (index.json
  carries them too, for the summary): computed here as the browser did over every document,
  which no longer comes.
"""

from __future__ import annotations

import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any

from lacarte_registre import fermetures
from lacarte_registre.regles import EI, Event, disp, sort_key, typ, year_group
from lacarte_registre.selection import plain

COLUMNS = ("id", "t", "d", "p", "y", "date", "rang", "mots", "doc", "dico")


def _tsv(v: str) -> str:
    """A COPY text field: backslash, tab, newline and carriage return escaped."""
    return v.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def mots(ctx: fermetures.Context, e: Event) -> str:
    reg = ctx.reg
    names = [e.get("objet"), e.get("ref"), e.get("id")]
    a = reg.affaires.get(e.get("affaire") or "") or {}
    names.append(a.get("titre"))
    if c := reg.communes.get(e.get("insee") or ""):
        names.append(c.get("nom"))
    for k in e.get("partage") or []:
        names.append((reg.communes.get(k) or {}).get("nom"))
    if b := reg.buyer(e):
        names.append(ctx.acheteur(b).get("nom"))
    names.append(e.get("acheteur"))
    if e.get("beneficiaire") and e.get("nom_publie", True):
        names.append(e["beneficiaire"])
    for s in e.get("entreprises") or []:
        if s != EI:
            names.append(ctx.entreprise(s).get("nom"))
    return " ".join(plain(x) for x in names if x)


def rows(ctx: fermetures.Context) -> list[tuple[Any, ...]]:
    out = []
    for e in ctx.reg.evenements:
        counted = e.get("compte") or e["t"].startswith("subvention")
        rang = (e.get("montant") or 0) if counted else 0
        if typ(e) == "aut":
            # a decree's second sort is its cameras (the list of decrees), -1 when unknown
            rang = e["cameras"] if isinstance(e.get("cameras"), int | float) else -1
        dico = fermetures._dico(ctx, [e])
        out.append((
            e["id"], typ(e), e.get("dep") or "", disp(e), year_group(e.get("date")),
            sort_key(e), float(rang), mots(ctx, e),
            json.dumps(e, ensure_ascii=False, separators=(",", ":")),
            json.dumps(dico, ensure_ascii=False, separators=(",", ":")),
        ))  # fmt: skip
    return out


def write_tsv(path: Path, data: list[tuple[Any, ...]]) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as g:
        for r in data:
            g.write("\t".join(_tsv(str(v)) for v in r) + "\n")
    tmp.replace(path)


def charger(conn: Any, path: Path) -> int:
    """Load recherche.tsv.gz into registre_recherche, all or nothing (the tests; the deploy
    runs db/load_registre.sh, the same COPY)."""
    n = 0
    with conn.transaction():
        conn.execute("DELETE FROM registre_recherche")
        with (
            conn.cursor().copy(f"COPY registre_recherche ({', '.join(COLUMNS)}) FROM STDIN") as cp,
            gzip.open(path, "rb") as g,
        ):
            for line in g:
                cp.write(line)
                n += 1
    return n


# a buyer's category as the lists group it (web/src/registre/listes.ts CAT_DE): the
# collectivités (commune, intercommunality, métropole, département) are territories, in none
LISTE_CAT = {"etat": "etat", "bailleur": "bailleur", "transports": "transports", "sante": "autres",
             "education": "autres", "autre": "autres", "region": "autres"}  # fmt: skip
LISTES_DOCS = {"con": "contrats", "mod": "modifications", "ao": "appels-d-offres",
               "aut": "arretes", "sub": "subventions"}  # fmt: skip


def listes(ctx: fermetures.Context) -> dict[str, Any]:
    """The lists of names (web/src/registre/listes.ts), every row uncut: the browser filters,
    sorts and pages them. The documents' lists ask the search API instead."""
    reg = ctx.reg
    ents: dict[str, dict[str, Any]] = {}
    buyers: dict[str, dict[str, Any]] = {}
    coms: dict[str, dict[str, Any]] = {}
    deps: dict[str, dict[str, Any]] = {}
    kinds: Counter[str] = Counter()
    for e in reg.evenements:
        kinds[typ(e)] += 1
        if e.get("dep"):
            o = deps.setdefault(e["dep"], {"n": 0, "con": 0, "aut": 0, "amt": 0.0})
            o["n"] += 1
            # a contract counted once (a copy is the second publication)
            o["con"] += e["t"] == "attribution" and not e.get("copie")
            o["aut"] += e["t"].startswith("arrete")
            if e.get("compte"):
                o["amt"] += e.get("montant") or 0
        for k in dict.fromkeys([e.get("insee"), *(e.get("partage") or [])]):
            if not k or k not in reg.communes:
                continue
            c = coms.setdefault(k, {"docs": 0, "con": 0, "cam": 0, "dr": 0})
            c["docs"] += 1
            c["con"] += e["t"] == "attribution"
            c["cam"] += e["t"] == "arrete"
            c["dr"] += e["t"] == "arrete_drone"
        if e["t"] != "attribution":
            continue
        # a contract published twice still names its company and its buyer, and counts once
        b = reg.buyer(e)
        for s in e.get("entreprises") or []:
            if s == EI:
                continue
            o = ents.setdefault(s, {"n": 0, "clientes": set(), "amt": 0.0, "deps": Counter(),
                                    "y0": "9999"})  # fmt: skip
            if e["copie"]:
                continue
            o["n"] += 1
            if b:
                o["clientes"].add(b)
            if e["compte"]:
                o["amt"] += e.get("montant") or 0
            if e.get("dep"):
                o["deps"][e["dep"]] += 1
            if e.get("date") and e["date"][:4] < o["y0"]:
                o["y0"] = e["date"][:4]
        if not b:
            continue
        o = buyers.setdefault(b, {"n": 0, "amt": 0.0, "ents": set(), "centrale": False})
        if e["copie"]:
            continue
        o["n"] += 1
        if e["compte"]:
            o["amt"] += e.get("montant") or 0
        if e.get("hors_totaux") == "centrale":
            o["centrale"] = True
        o["ents"] |= {s for s in e.get("entreprises") or [] if s != EI}
    for k, c in coms.items():
        c["carte"] = ctx.commune_stats(k).get("carte")
    # a company named in a contract that counts, never a sole trader
    dico_ent = {s: ctx.entreprise(s) for s in sorted(ents)}
    ent_rows = {
        s: {"n": o["n"], "clientes": len(o["clientes"]), "amt": round(o["amt"], 2),
            "y0": o["y0"], "deps": dict(o["deps"])}
        for s, o in sorted(ents.items())
        if o["n"] > 0 and not dico_ent[s].get("entrepreneur_individuel")
    }  # fmt: skip
    dico_buy = {s: ctx.acheteur(s) for s in sorted(ctx.acheteurs)}
    buy_rows = {
        s: {"n": o["n"], "amt": round(o["amt"], 2), "ents": len(o["ents"]),
            "centrale": o["centrale"]}
        for s, o in sorted(buyers.items())
    }  # fmt: skip
    cats = Counter(c for s in dico_buy if (c := LISTE_CAT.get(dico_buy[s].get("categorie") or "")))
    epcis = {c for k in coms if (c := (reg.communes[k] or {}).get("epci"))}
    n_deps = len(ctx.couverture["departements"])
    return {
        "v": 1,
        "maj": ctx.couverture["maj"],
        # each list's rows by id (the dictionaries' names are under `dico`)
        "lignes": {
            "communes": dict(sorted(coms.items())),
            "acheteurs": buy_rows,
            "entreprises": ent_rows,
            "departements": {d: {**o, "amt": round(o["amt"], 2)} for d, o in sorted(deps.items())},
        },
        "comptes": {
            "listes": {
                "communes": len(coms),
                "intercommunalites": len(epcis),
                "departements": n_deps,
                "acheteurs": sum(cats.values()),
                "entreprises": len(ent_rows),
                **{v: kinds.get(k, 0) for k, v in LISTES_DOCS.items()},
            },
            "categories": {c: cats.get(c, 0) for c in ("etat", "bailleur", "transports", "autres")},
        },  # fmt: skip
        "dico": {
            "entreprises": {s: dico_ent[s] for s in ent_rows},
            "acheteurs": {
                s: a
                for s, a in dico_buy.items()
                if LISTE_CAT.get(a.get("categorie") or "") or s in epcis
            },  # fmt: skip
            "communes": {k: ctx.commune(k) for k in sorted(coms)},
        },
    }
