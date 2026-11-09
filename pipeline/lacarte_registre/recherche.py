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
  uncut, the names they need with their references (`dico.epcis`: every listed commune's
  intercommunality, named by France's reference, `ref` or `sans_fiche`), and every list's
  count (index.json carries them too, for the summary): computed here as the browser did over
  every document,
  which no longer comes.
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from lacarte_registre import chiffres, comptes, fermetures
from lacarte_registre.regles import (
    EI,
    Event,
    disp,
    is_drone_act,
    is_helico_act,
    sort_key,
    typ,
    year_group,
)
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
    # the days a drone may film, over the twelve months that end on the build's update (its
    # acts' days, Paris's calendar days): the one count of « jours de vol » (R5.2 §3)
    fin = ctx.couverture["maj"][:10]
    debut = (dt.date.fromisoformat(fin) - dt.timedelta(days=365)).isoformat()
    vols: defaultdict[str, set[str]] = defaultdict(set)
    # a helicopter's days apart, never a drone's (rule:registre_drones@1:aeronef)
    vols_h: defaultdict[str, set[str]] = defaultdict(set)
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
            c = coms.setdefault(k, {"docs": 0, "con": 0, "cam": 0, "dr": 0, "helico": 0})
            if is_drone_act(e) or is_helico_act(e):
                # the collection's acts list their days; the pilot's give a period
                days = e.get("jours") or chiffres.jours([e.get("periode") or ""])
                (vols if is_drone_act(e) else vols_h)[k].update(d for d in days if debut < d <= fin)
            c["docs"] += 1
            c["con"] += e["t"] == "attribution" and not e.get("copie")
            c["cam"] += e["t"] == "arrete"
            c["dr"] += is_drone_act(e)
            c["helico"] += is_helico_act(e)
        if e["t"] != "attribution":
            continue
        # a contract published twice still names its company and its buyer, and counts once
        b = reg.buyer(e)
        for s in e.get("entreprises") or []:
            if s == EI:
                continue
            o = ents.setdefault(s, {"n": 0, "clientes": set(), "amt": 0.0, "deps": Counter(),
                                    "cdeps": defaultdict(set), "y0": "9999"})  # fmt: skip
            if e["copie"]:
                continue
            o["n"] += 1
            if b:
                o["clientes"].add(b)
            if e["compte"]:
                o["amt"] += e.get("montant") or 0
            if e.get("dep"):
                o["deps"][e["dep"]] += 1
                if b:
                    o["cdeps"][e["dep"]].add(b)
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
        st = ctx.commune_stats(k)
        c["carte"] = st.get("carte")
        # its own counted contracts (comptes.commune, as departement/<d>.json stats.communes)
        c["amt"] = round(st.get("montant") or 0, 2)
        c["jv"] = len(vols.get(k, ()))
        c["couverture_actes"] = st["couverture_actes"]
        c["jv_helico"] = len(vols_h.get(k, ()))
    # a département's map counts every commune of it, a document or not; its acts as its
    # page counts them (comptes.departement)
    carte_dep: Counter[str] = Counter()
    for k, n in (reg.pilote.get("CARTE_N_ALL", {}) or {}).items():
        if n and (d := (reg.communes.get(k) or {}).get("dep")):
            carte_dep[d] += n
    for d, o in deps.items():
        dst = comptes.departement(reg, d)
        o.update(carte=carte_dep.get(d, 0), cam=dst["cam"], dr=dst["dr"], helico=dst["helico"],
                 dr_commune=dst["dr_commune"], dr_autorite=dst["dr_autorite"])  # fmt: skip
        # what a commune of it without a row says (rule:registre_couverture@1:actes_commune)
        o["couverture_actes_communes"] = ctx.couverture_actes(d, {})
    # a company named in a contract that counts, never a sole trader
    dico_ent = {s: ctx.entreprise(s) for s in sorted(ents)}
    ent_rows = {
        s: {"n": o["n"], "clientes": len(o["clientes"]), "amt": round(o["amt"], 2),
            "y0": o["y0"], "deps": dict(o["deps"]),
            # its distinct buyers per département of their contracts (the comparison's cells)
            "clients_deps": {d: len(v) for d, v in sorted(o["cdeps"].items())}}
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
            # its town hall's point, [lon, lat] to 3 decimals (about 100 m): « autour de moi »
            "communes": {k: {**ctx.commune(k), **_ll(reg.communes.get(k))} for k in sorted(coms)},
            # every intercommunality of a listed commune, named by France's reference (the
            # buyers' dictionary names only those that buy): its fiche, its buyer's page, when
            # this build writes one, else `sans_fiche` (its row leads nowhere and says so)
            "epcis": {s: epci(ctx, s) for s in sorted(epcis)},
        },
    }


def _ll(c: dict[str, Any] | None) -> dict[str, list[float]]:
    m = (c or {}).get("mairie")
    return {"ll": [round(m[0], 3), round(m[1], 3)]} if m else {}


# a département of the Code officiel géographique, not a collectivity beyond (975, 977, 987…)
DEPARTEMENT = re.compile(r"^(\d\d|2[AB]|97[1-46])$")


def totaux(ctx: fermetures.Context, lists: dict[str, Any]) -> dict[str, Any]:
    """The home page's totals, from the lists it does not load: the public money (the sum of
    the départements' counted contracts, as the lists add them), the cameras on the map (every
    commune of France, a document or not), the départements whose acts are read."""
    deps = lists["lignes"]["departements"]
    cov = ctx.couverture["departements"]
    return {
        "montant": round(sum(o["amt"] for o in deps.values())),
        "carte": sum(n or 0 for n in (ctx.reg.pilote.get("CARTE_N_ALL", {}) or {}).values()),
        "deps_lus": sum(
            1 for d, v in cov.items() if v.get("etat") == "collecte" and DEPARTEMENT.match(d)
        ),
    }


def aretes(ctx: fermetures.Context) -> dict[str, Any]:
    """The national graph of buyers and companies (« chemin entre deux… »): one edge per buyer
    and company that signed a contract together, [buyer, company, amount, n]. A contract
    counted once (a copy never), its whole amount when it counts (`compte`) on each of its
    holders' edges, so the edges do not add up to the total; legal persons only: a sole
    trader is in no edge, whatever its contracts."""
    reg = ctx.reg
    edges: dict[tuple[str, str], list[float]] = {}
    for e in reg.evenements:
        if e["t"] != "attribution" or e.get("copie") or not (b := reg.buyer(e)):
            continue
        for s in dict.fromkeys(e.get("entreprises") or []):
            # a buyer named as its own holder (a SIREN on both sides) is no path
            if s in (EI, b) or ctx.entreprise(s).get("entrepreneur_individuel"):
                continue
            o = edges.setdefault((b, s), [0.0, 0])
            o[0] += (e.get("montant") or 0) if e.get("compte") else 0
            o[1] += 1
    # every buyer of an edge named (the lists name only some: a commune buying is not in
    # them), its fiche when it has one; the companies are the lists' (dico.entreprises)
    noms = {}
    for b in sorted({b for b, _ in edges}):
        a = ctx.acheteur(b)
        noms[b] = {k: a[k] for k in ("nom_court", "nom", "nom_inconnu", "ref") if a.get(k)}
    return {
        "v": 1,
        "maj": ctx.couverture["maj"],
        "aretes": [[b, s, round(m), n] for (b, s), (m, n) in sorted(edges.items())],
        "acheteurs": noms,
    }


def epci(ctx: fermetures.Context, siren: str) -> dict[str, Any]:
    out: dict[str, Any] = {"nom": ctx.nom_court(siren) or ctx.epcis.get(siren)}
    if r := ctx.fiches.acheteur(siren):
        out["ref"] = r
    else:
        out["sans_fiche"] = True
    return out
