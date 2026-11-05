"""The figures of a commune, an intercommunality, a département, a région and a company (lot
R5 « les données », section 4), with each commune's rank in its population stratum. The
rules are rules/registre_chiffres.yaml.

Every figure is {v, etat, ...}: « lu » (the source covers the place), « partiel » (part of
its documents read), « non_lu » (not covered: v is None, never 0). The input is plain, built
by explorer.py from the assembled registre:

- a contract {id, insee, dep, acheteur, communal, compte, date, montant, offres,
  entreprises, natures};
- a grant {id, siren, insee, communal, date, montant, source: etat | region};
- an act {id, insee, dep, dossier, date, sous_type, titulaire: mairie | commerces | autres
  | None, cameras};
- a flight act {id, insees, dep, dates, texte};
- a commune {nom, dep, pop, epci, siren}.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml

from lacarte_registre.natures import AUTRE, fold

LU, PARTIEL, NON_LU = "lu", "partiel", "non_lu"
FIN = ("abrogation", "refus")


def rules(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def fig(v: Any, etat: str = LU, **kw: Any) -> dict[str, Any]:
    return {"v": None if etat == NON_LU else v, "etat": etat, **kw}


def strate(pop: int | None, conf: dict[str, Any]) -> int | None:
    """The stratum's index (0 = the smallest), None without a population."""
    if not pop:
        return None
    return sum(1 for b in conf["strates"]["bornes"] if pop >= b)


def region_of(conf: dict[str, Any]) -> dict[str, str]:
    return {d: code for code, r in conf["regions"].items() for d in r["deps"]}


def etats_actes(couverture: dict[str, Any] | None) -> dict[str, str]:
    """{département: state} of the prefectoral acts' reading (collecte/couverture.json); a
    département read by one administration and not by another (Paris: the prefecture and
    the prefecture of police) is « partiel »."""
    by: dict[str, set[str]] = defaultdict(set)
    for key, a in ((couverture or {}).get("administrations") or {}).items():
        # a région's code (« 75 », Nouvelle-Aquitaine) is not a département's
        if a.get("code") and not key.startswith("region"):
            by[a["code"].upper()].add(a.get("statut"))
    out = {}
    for d, st in by.items():
        out[d] = (
            LU if st == {"termine"} else PARTIEL if "termine" in st or "en_cours" in st else NON_LU
        )
    return out


# --- drone flights -------------------------------------------------------------------------------
def jours(dates: Iterable[str]) -> set[str]:
    """The days of a flight act (« 2025-12-05 au 2025-12-08 » is four)."""
    out: set[str] = set()
    for s in dates or ():
        m = re.findall(r"\d{4}-\d{2}-\d{2}", s or "")
        if len(m) >= 2:
            a, b = dt.date.fromisoformat(m[0]), dt.date.fromisoformat(m[1])
            out.update((a + dt.timedelta(i)).isoformat() for i in range(min((b - a).days, 366) + 1))
        elif m:
            out.add(m[0])
    return out


def motif(texte: str | None, conf: dict[str, Any]) -> str:
    t = fold(texte)
    for m in conf["vols"]["motifs"]:
        if any(re.search(w, t) for w in m["mots"]):
            return m["id"]
    return AUTRE


def vols(acts: Iterable[dict[str, Any]], today: str, conf: dict[str, Any]) -> dict[str, Any]:
    """{jours, motif, motifs} of the flights within the window ending `today`."""
    end = dt.date.fromisoformat(today)
    start = (end - dt.timedelta(conf["vols"]["fenetre_jours"])).isoformat()
    days: set[str] = set()
    motifs: Counter[str] = Counter()
    for a in acts:
        ds = {d for d in jours(a.get("dates") or []) if start < d <= today}
        if ds:
            days |= ds
            motifs[motif(a.get("texte"), conf)] += len(ds)
    top = max(sorted(motifs), key=lambda k: motifs[k]) if motifs else None
    return {"jours": len(days), "motif": top, "motifs": dict(motifs)}


# --- cameras authorised --------------------------------------------------------------------------
def autorisees(acts: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """The cameras of the systems in force: each dossier's latest act (an abrogation or a
    refusal ends it), summed by holder; a dossier whose holder or count is not read is
    counted apart (« dossiers non lus »). A dossier is a system: Lyon's are its buildings
    (a library, a swimming pool), summed. Known limit: a system renumbered counts twice
    (Saint-Priest, 2026: 321, 327, 329 cameras under one number, then 332, 333, 358 under
    another); `dossiers_mairie` says how many were summed."""
    last: dict[str, dict[str, Any]] = {}
    for a in acts:
        k = a.get("dossier") or a["id"]
        if k not in last or (a.get("date") or "") >= (last[k].get("date") or ""):
            last[k] = a
    out = {"mairie": 0, "commerces": 0, "autres": 0, "dossiers": 0, "non_lus": 0,
           "dossiers_mairie": 0}  # fmt: skip
    for a in last.values():
        if a.get("sous_type") in FIN:
            continue
        out["dossiers"] += 1
        if a.get("titulaire") is None or a.get("cameras") is None:
            out["non_lus"] += 1
        else:
            out[a["titulaire"]] += int(a["cameras"])
            out["dossiers_mairie"] += a["titulaire"] == "mairie"
    return out


# --- contracts and grants ------------------------------------------------------------------------
def _since(rows: Iterable[dict[str, Any]], depuis: str) -> list[dict[str, Any]]:
    return [r for r in rows if (r.get("date") or "") >= depuis]


def offre_unique(contrats: Iterable[dict[str, Any]], conf: dict[str, Any]) -> dict[str, Any]:
    known = [c["offres"] for c in contrats if c.get("offres") is not None]
    n1 = sum(1 for o in known if o == 1)
    if len(known) < conf["offre_unique"]["min_contrats"]:
        return fig(None, LU, n=len(known), n1=n1, raison="trop peu de contrats")
    return fig(round(n1 / len(known), 3), LU, n=len(known), n1=n1)


def argent(contrats: list[dict[str, Any]], grants: list[dict[str, Any]], pop: int | None,
           region_lue: bool, conf: dict[str, Any]) -> dict[str, Any]:  # fmt: skip
    """The euros of contracts, per inhabitant, and the share financed by grants."""
    cs = _since(contrats, conf["montants"]["depuis"])
    total = sum(c.get("montant") or 0 for c in cs)
    gs = _since(grants, conf["subventions"]["depuis"])
    paid = sum(g.get("montant") or 0 for g in gs)
    out = {
        "montant": fig(round(total), n=len(cs)),
        "euros_hab": fig(round(total / pop, 2) if pop else None),
        "subventions": fig(round(paid), PARTIEL if not region_lue else LU, n=len(gs),
                           sources="État et Région" if region_lue else "État seul"),
        "part_subventions": fig(round(paid / total, 3) if total else None,
                                PARTIEL if not region_lue else LU),
        "offre_unique": offre_unique(cs, conf),
    }  # fmt: skip
    if total and paid > total:
        out["part_subventions"]["note"] = "plus de subventions que de contrats trouvés"
    return out


# --- the communes --------------------------------------------------------------------------------
def communes(
    noms: dict[str, dict[str, Any]],
    contrats: list[dict[str, Any]],
    grants: list[dict[str, Any]],
    actes: list[dict[str, Any]],
    flights: list[dict[str, Any]],
    cartes: dict[str, int],
    etats: dict[str, str],
    today: str,
    conf: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """{insee: figures} of every commune of the reference, ranks included."""
    reg_of = region_of(conf)
    regions_lues = {reg_of.get(g.get("dep") or "") for g in grants if g.get("source") == "region"}
    by_c: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in contrats:
        if c.get("compte") and c.get("communal") and c.get("insee"):
            by_c[c["insee"]].append(c)
    siren_insee = {v["siren"]: k for k, v in noms.items() if v.get("siren")}
    by_g: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g in grants:
        k = siren_insee.get(g.get("siren") or "") or (g.get("insee") if g.get("communal") else None)
        if k:
            by_g[k].append(g)
    by_a: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in actes:
        if a.get("insee"):
            by_a[a["insee"]].append(a)
    by_v: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in flights:
        for k in dict.fromkeys(f.get("insees") or []):
            by_v[k].append(f)
    out = {}
    for k, c in noms.items():
        dep = c.get("dep") or ""
        etat = etats.get(dep, NON_LU)
        au = autorisees(by_a.get(k, []))
        read = au["dossiers"] - au["non_lus"]
        aut_etat = (
            NON_LU if etat == NON_LU or (au["dossiers"] and not read)
            else PARTIEL if au["non_lus"] or etat == PARTIEL else LU
        )  # fmt: skip
        vo = vols(by_v.get(k, []), today, conf)
        out[k] = {
            "insee": k,
            "nom": c.get("nom"),
            "dep": dep,
            "region": reg_of.get(dep),
            "epci": c.get("epci"),
            "pop": c.get("pop"),
            "strate": strate(c.get("pop"), conf),
            # OpenStreetMap's mapping, not the ground truth: always « lu »
            "cameras_carte": fig(cartes.get(k, 0)),
            "cameras_autorisees": fig(au["mairie"] + au["commerces"], aut_etat, **au),
            **argent(
                by_c.get(k, []),
                by_g.get(k, []),
                c.get("pop"),
                reg_of.get(dep) in regions_lues,
                conf,
            ),  # fmt: skip
            "jours_vol": fig(vo["jours"], etat, motif=vo["motif"], motifs=vo["motifs"]),
        }
    rangs(out, ["cameras_carte", "montant", "euros_hab", "jours_vol"], conf)
    rangs(out, ["offre_unique", "part_subventions"], conf, numeric=True)
    return out


def rangs(rows: dict[str, dict[str, Any]], keys: Iterable[str], conf: dict[str, Any],
          numeric: bool = False) -> None:  # fmt: skip
    """Each figure's rank within the commune's stratum, the highest first, among the
    communes whose figure is « lu » (ties share a rank). `numeric`: only the communes with
    a value take part (a share of nothing is not 0)."""
    for key in keys:
        groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for r in rows.values():
            f = r[key]
            if r["strate"] is not None and f["etat"] == LU and (f["v"] is not None or not numeric):
                groups[r["strate"]].append(r)
        for s, rs in groups.items():
            vals = sorted((r[key]["v"] or 0 for r in rs), reverse=True)
            first = {}
            for i, v in enumerate(vals):
                first.setdefault(v, i + 1)
            for r in rs:
                r[key]["rang"] = first[r[key]["v"] or 0]
                r[key]["sur"] = len(rs)
                r[key]["strate"] = conf["strates"]["libelles"][s]


# --- the territories -----------------------------------------------------------------------------
def territoire(
    insees: list[str],
    rows: dict[str, dict[str, Any]],
    contrats: list[dict[str, Any]],
    grants: list[dict[str, Any]],
    flights: list[dict[str, Any]],
    today: str,
    conf: dict[str, Any],
    region_lue: bool,
) -> dict[str, Any]:
    """An intercommunality's, a département's or a région's figures: its communes' sums for
    the map and the acts (« non lu » if one of its communes is), its own contracts and
    grants (given by the caller: an intercommunality's are its own as a buyer)."""
    cs = [rows[k] for k in insees if k in rows]
    pop = sum(r.get("pop") or 0 for r in cs)

    def total(key: str, sub: str | None = None) -> dict[str, Any]:
        etats = {r[key]["etat"] for r in cs}
        etat = NON_LU if etats == {NON_LU} else PARTIEL if etats - {LU} else LU
        v = sum(
            (r[key].get(sub) if sub else r[key]["v"]) or 0 for r in cs if r[key]["etat"] != NON_LU
        )
        return fig(v, etat, communes_non_lues=sum(1 for r in cs if r[key]["etat"] == NON_LU))

    ks = set(insees)
    fl = [f for f in flights if ks & set(f.get("insees") or [])]
    vo = vols(fl, today, conf)
    return {
        "communes": len(cs),
        "pop": pop,
        "cameras_carte": total("cameras_carte"),
        "cameras_autorisees": total("cameras_autorisees"),
        **argent(contrats, grants, pop, region_lue, conf),
        # each day once, whichever communes it flew over
        "jours_vol": {**total("jours_vol"), "v": vo["jours"], "motif": vo["motif"]},
    }


# --- the companies -------------------------------------------------------------------------------
def entreprises(contrats: list[dict[str, Any]], conf: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """{siren: figures} of the companies holding counted contracts, their « concurrents » as
    the rules define them (registre_chiffres.yaml `entreprises`)."""
    top = conf["entreprises"]["top"]
    held: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_buyer: dict[str, Counter[str]] = defaultdict(Counter)
    by_nat_dep: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for c in contrats:
        if not c.get("compte"):
            continue
        for s in c.get("entreprises") or []:
            held[s].append(c)
            if c.get("acheteur"):
                by_buyer[c["acheteur"]][s] += 1
            for n in c.get("natures") or []:
                by_nat_dep[(n, c.get("dep") or "")][s] += 1
    out = {}
    for s, cs in held.items():
        buyers = {c["acheteur"] for c in cs if c.get("acheteur")}
        nats = Counter(n for c in cs for n in c.get("natures") or [])
        deps = Counter(c.get("dep") for c in cs if c.get("dep"))
        partners = Counter(x for c in cs for x in c.get("entreprises") or [] if x != s)
        same_buyers: Counter[str] = Counter()
        for b in buyers:
            same_buyers.update({x: 1 for x in by_buyer[b] if x != s and x not in partners})
        same_nat: Counter[str] = Counter()
        for n in nats:
            if n == AUTRE:
                continue
            for d in deps:
                same_nat.update({x: 1 for x in by_nat_dep[(n, d)] if x != s and x not in partners})
        years = Counter((c.get("date") or "")[:4] for c in cs if c.get("date"))
        out[s] = {
            "siren": s,
            "contrats": len(cs),
            "montant": round(sum(c.get("montant") or 0 for c in cs)),
            "montant_annee": {
                y: round(sum(c.get("montant") or 0 for c in cs if (c.get("date") or "")[:4] == y))
                for y in sorted(years)
            },  # fmt: skip
            "clients": sorted(buyers),
            "departements": dict(deps.most_common()),
            "annees": dict(sorted(years.items())),
            "natures": dict(nats.most_common()),
            "offre_unique": offre_unique(cs, conf),
            "partenaires": dict(partners.most_common(top)),
            "memes_clients": dict(same_buyers.most_common(top)),
            "memes_natures_departements": dict(same_nat.most_common(top)),
        }
    return out
