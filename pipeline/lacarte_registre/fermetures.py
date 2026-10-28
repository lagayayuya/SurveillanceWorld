"""The registre's files: for each page, the subset of the data it reads, closed.

A file holds its documents as full records with their flags (regles.py), every affaire they
belong to with all its documents, the affaires grouped with them in one tender (faits.js
lots and doublons), and the dictionaries of the companies, buyers and communes they name.
Nothing is recomputed in the browser: a page reads the flags and the figures given here.

- index.json: the home, small and always loaded (totals, facets, the latest and the
  largest documents);
- recherche.json: every document, loaded by the search, a filter, the second sort and the
  rankings;
- commune/<insee>.json: one per commune of the pilot's reference (every commune of a pilot
  département, and those of a document elsewhere), with the copies of the acts it shares,
  the figures of its intercommunality and its département, the map's counts, its drone
  zones and its département's coverage;
- departement/, entreprise/, acheteur/, document/<affaire>.json: the same closure for the
  pages of the next lot.
A file is named after its id as is (a space or an accent included); the page asks for it
through encodeURIComponent and the server decodes the path.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from lacarte_registre import comptes
from lacarte_registre.regles import Event, Registre, disp, sort_key, typ, year_group

Writer = Callable[[str, dict[str, Any]], None]
ENT_DICO = ("nom", "entrepreneur_individuel", "naf", "naf_libelle", "verifie_sirene")
ACH_DICO = ("nom", "categorie", "dep", "insee_siege")
COM_DICO = ("nom", "dep", "pop", "epci")
AFF_SHORT = ("acheteur_siren", "acheteur_communal", "titre")
NON_LU_ROW = ("id", "t", "date", "dep", "insee", "ref", "url", "page")


def file_name(key: str) -> str:
    if not key or "/" in key or "\0" in key or key.startswith("."):
        raise ValueError(f"an id that cannot name a file: {key!r}")
    return key


class Context:
    """What every file reads, computed once."""

    def __init__(self, reg: Registre, couverture: dict[str, Any], pilot_deps: list[str]):
        self.reg = reg
        self.couverture = couverture
        self.pilot_deps = pilot_deps
        p = reg.pilote
        self.lots: dict[str, str] = p.get("LOTS", {})
        self.groupes: dict[str, Any] = p.get("LOTS_GROUPES", {})
        self.libelles: dict[str, Any] = p.get("LIBELLES", {})
        self.noms_courts: dict[str, str] = p.get("NOMS_COURTS", {})
        self.epcis: dict[str, str] = p.get("EPCIS", {})
        self.acheteurs: dict[str, Any] = p.get("ACHETEURS", {})
        self.dep_names = {k: v.get("nom") for k, v in p.get("DEP", {}).items()}
        self.ent_stats = comptes.entreprises(reg)
        self.buy_stats = comptes.acheteurs(reg)
        self.affaires_of: dict[str, list[str]] = {}
        for aid, a in reg.affaires.items():
            if a.get("insee"):
                self.affaires_of.setdefault(a["insee"], []).append(aid)
        self._commune_stats: dict[str, dict[str, Any]] = {}

    def commune_stats(self, insee: str) -> dict[str, Any]:
        if insee not in self._commune_stats:
            self._commune_stats[insee] = comptes.commune(self.reg, insee)
        return self._commune_stats[insee]

    def nom_court(self, siren: str) -> str | None:
        cat = (self.acheteurs.get(siren) or {}).get("categorie")
        epci = self.epcis.get(siren) if cat in ("intercommunalite", "metropole") else None
        return self.noms_courts.get(siren) or epci

    def acheteur(self, siren: str) -> dict[str, Any]:
        a = self.acheteurs.get(siren) or {}
        out = {k: a.get(k) for k in ACH_DICO if k in a}
        if self.nom_court(siren):
            out["nom_court"] = self.nom_court(siren)
        return out

    def entreprise(self, siren: str) -> dict[str, Any]:
        x = self.reg.pilote.reg.get("entreprises", {}).get(siren) or {}
        return {k: x.get(k) for k in ENT_DICO if k in x}

    def commune(self, insee: str) -> dict[str, Any]:
        c = self.reg.communes.get(insee) or {}
        return {k: c.get(k) for k in COM_DICO}


class Closure:
    """Documents, their affaires and the dictionaries they need."""

    def __init__(self, ctx: Context):
        self.ctx = ctx
        self.events: dict[str, Event] = {}
        self.communes: set[str] = set()
        self.buyers: set[str] = set()

    def add(self, events: Iterable[Event]) -> Closure:
        for e in events:
            self.events.setdefault(e["id"], e)
        return self

    def close(self, affaires: Iterable[str] = ()) -> dict[str, Any]:
        ctx, reg = self.ctx, self.ctx.reg
        aff = dict.fromkeys([*(e["affaire"] for e in self.events.values()), *affaires])
        groups = dict.fromkeys(ctx.lots[a] for a in aff if a in ctx.lots)
        for g in groups:
            aff.update(dict.fromkeys(m["affaire"] for m in ctx.groupes[g].get("membres") or []))
        aff = {a: None for a in aff if a in reg.affaires}
        for a in aff:
            self.add(reg.by_id[i] for i in reg.affaires[a]["events"])
        events = list(self.events.values())
        sirens = {s for e in events for s in e.get("entreprises") or []}
        sirens |= {s for a in aff for s in reg.affaires[a].get("entreprises") or []}
        buyers = self.buyers | {b for e in events if (b := reg.buyer(e))}
        buyers |= {b for a in aff if (b := reg.affaires[a].get("acheteur_siren"))}
        insees = set(self.communes)
        for e in events:
            insees.update([e.get("insee"), e.get("insee0"), *(e.get("partage") or [])])
        insees |= {reg.affaires[a].get("insee") for a in aff}
        return {
            "evenements": events,
            "affaires": {a: reg.affaires[a] for a in aff},
            "entreprises": {s: ctx.entreprise(s) for s in sorted(sirens)},
            "acheteurs": {b: ctx.acheteur(b) for b in sorted(buyers)},
            "communes": {k: ctx.commune(k) for k in sorted(i for i in insees if i in reg.communes)},
            "lots": {g: ctx.groupes[g] for g in groups},
            "libelles": {a: ctx.libelles[a] for a in aff if a in ctx.libelles},
        }


def _restrict(x: dict[str, Any], insee: str) -> dict[str, Any]:
    parts = x.get("parts") or {}
    return {**x, "parts": {insee: parts[insee]} if insee in parts else {}}


def zones(ctx: Context, insee: str) -> dict[str, Any]:
    """The drone and algorithmic-analysis acts naming the commune, their zones, and the
    sites and units drawn from them, cut to the commune."""
    p = ctx.reg.pilote
    auts = [a for a in p.get("AUTORISATIONS", []) if insee in (a.get("insee") or [])]
    zids = {z for a in auts for z in a.get("zones") or []}
    zs = [z for z in p.get("ZONES", []) if z["id"] in zids]
    sids = {z.get("site") for z in zs}
    return {
        "autorisations": auts,
        "zones": zs,
        "sites": [_restrict(s, insee) for s in p.get("SITES", []) if s["id"] in sids],
        "unites": [_restrict(u, insee) for u in p.get("UNITES", []) if zids & set(u["zones"])],
    }


def _dep_row(ctx: Context, dep: str) -> dict[str, Any]:
    cov = ctx.couverture
    return cov["departements"].get(dep) or cov["defaut"]


def commune_file(ctx: Context, insee: str) -> dict[str, Any]:
    reg = ctx.reg
    c = reg.communes[insee]
    dep, epci = c.get("dep"), c.get("epci")
    cl = Closure(ctx).add(reg.by_insee.get(insee, []))
    ep_all = comptes.communes_epci(reg, epci) if epci else []
    ep_reg = [k for k in ep_all if reg.by_insee.get(k)]
    dep_ks = comptes.communes_dep(reg, dep)
    stat_ks = sorted({insee, *ep_reg, *dep_ks})
    cl.communes.update(stat_ks, ep_all)
    if epci:
        cl.buyers.add(epci)
    body = cl.close(ctx.affaires_of.get(insee, []))
    achat = ctx.buy_stats.get(epci or "")
    stats = {
        "communes": {k: ctx.commune_stats(k) for k in stat_ks},
        "epci": {
            "code": epci,
            "nom": ctx.epcis.get(epci),
            "communes": ep_all,
            "uniq": comptes.uniq(reg, ep_reg),
            "achat": {"n": achat["n"], "montant": achat["montant"]} if achat else None,
        }
        if epci
        else None,
        "dep": {
            "code": dep,
            "nom": ctx.dep_names.get(dep),
            "communes_registre": len(dep_ks),
            "uniq": comptes.uniq(reg, dep_ks),
            "depStats": comptes.departement(reg, dep),
        },
    }
    p = reg.pilote
    return {
        "v": 1,
        "commune": {"insee": insee, **ctx.commune(insee)},
        **body,
        "stats": stats,
        "carte": {
            "n": comptes.carte(reg, insee),
            "pub": p.get("CARTE_PUB", {}).get(insee),
            "all": p.get("CARTE_N_ALL", {}).get(insee),
        },
        "zones": zones(ctx, insee),
        "mandats": reg.pilote.reg.get("mandats", []),
        "couverture": {
            "maj": ctx.couverture["maj"],
            "departement": _dep_row(ctx, dep),
            "sources": ctx.couverture["sources"],
        },
    }


def departement_file(ctx: Context, dep: str) -> dict[str, Any]:
    reg = ctx.reg
    ks = comptes.communes_dep(reg, dep)
    cl = Closure(ctx).add(reg.by_dep.get(dep, []))
    for k in ks:
        cl.add(reg.by_insee[k])
    epcis: dict[str, list[str]] = {}
    for k in ks:
        if reg.communes[k].get("epci"):
            epcis.setdefault(reg.communes[k]["epci"], []).append(k)
    cl.communes.update(ks)
    return {
        "v": 1,
        "departement": {"code": dep, "nom": ctx.dep_names.get(dep)},
        **cl.close(),
        "stats": {
            "depStats": comptes.departement(reg, dep),
            "uniq": comptes.uniq(reg, ks),
            "communes": {k: ctx.commune_stats(k) for k in ks},
            "epcis": {
                code: {"nom": ctx.epcis.get(code), "communes": v, "uniq": comptes.uniq(reg, v)}
                for code, v in epcis.items()
            },
        },
        "couverture": _dep_row(ctx, dep),
    }


def entreprise_file(ctx: Context, siren: str) -> dict[str, Any]:
    reg = ctx.reg
    evs = [e for e in reg.evenements if siren in (e.get("entreprises") or [])]
    return {
        "v": 1,
        "entreprise": reg.pilote.reg["entreprises"].get(siren) or {"siren": siren},
        **Closure(ctx).add(evs).close(),
        "stats": ctx.ent_stats.get(siren),
    }


def acheteur_file(ctx: Context, siren: str) -> dict[str, Any]:
    reg = ctx.reg
    evs = [e for e in reg.evenements if reg.buyer(e) == siren]
    p = reg.pilote
    return {
        "v": 1,
        "acheteur": {
            "siren": siren,
            **(ctx.acheteurs.get(siren) or {}),
            "nom_court": ctx.nom_court(siren),
            "lie": p.get("ACHETEURS_LIES", {}).get(siren),
            "lead": p.get("LEADS_ACHETEURS", {}).get(siren),
        },
        **Closure(ctx).add(evs).close(),
        "stats": ctx.buy_stats.get(siren),
    }


def document_file(ctx: Context, affaire: str) -> dict[str, Any]:
    return {"v": 1, "affaire": ctx.reg.affaires[affaire], **Closure(ctx).close([affaire])}


def _dico(ctx: Context, events: list[Event]) -> dict[str, Any]:
    reg = ctx.reg
    sirens = sorted({s for e in events for s in e.get("entreprises") or []})
    buyers = sorted({b for e in events if (b := reg.buyer(e))})
    insees = sorted({k for e in events if (k := e.get("insee")) and k in reg.communes})
    return {
        "entreprises": {s: ctx.entreprise(s) for s in sirens},
        "acheteurs": {b: ctx.acheteur(b) for b in buyers},
        "communes": {k: ctx.commune(k) for k in insees},
        # the buyer of a contract is its affaire's when the document does not name it
        "affaires": {
            a: {k: x[k] for k in AFF_SHORT if x.get(k) is not None}
            for a in sorted({e["affaire"] for e in events if e.get("affaire")})
            if (x := reg.affaires.get(a))
        },
    }


def _dep_group(ctx: Context, dep: str | None) -> str:
    return dep if dep in ctx.pilot_deps else "xx"


def index_file(ctx: Context) -> dict[str, Any]:
    evs = ctx.reg.evenements
    kinds = Counter(typ(e) for e in evs)
    recents = sorted(evs, key=sort_key, reverse=True)[:10]
    gros = sorted((e for e in evs if e["compte"]), key=lambda e: -(e.get("montant") or 0))[:10]
    return {
        "v": 1,
        "maj": ctx.couverture["maj"],
        "totaux": {
            **{k: kinds.get(k, 0) for k in ("con", "ao", "aut", "mod", "sub")},
            "docs": len(evs),
        },
        "facettes": {
            "t": dict(Counter(typ(e) for e in evs)),
            "d": dict(Counter(_dep_group(ctx, e.get("dep")) for e in evs)),
            "p": dict(Counter(disp(e) for e in evs)),
            "y": dict(Counter(year_group(e.get("date")) for e in evs)),
        },
        "recents": recents,
        "gros": gros,
        "non_lus": len(ctx.reg.non_lus),
        "dico": _dico(ctx, recents + gros),
    }


def recherche_file(ctx: Context) -> dict[str, Any]:
    reg = ctx.reg
    buyers = sorted(set(ctx.acheteurs) | {b for e in reg.evenements if (b := reg.buyer(e))})
    return {
        "v": 1,
        "evenements": reg.evenements,
        "entreprises": {s: ctx.entreprise(s) for s in sorted(reg.pilote.reg["entreprises"])},
        "acheteurs": {b: ctx.acheteur(b) for b in buyers},
        # each commune with its map's count (« Sur la carte » in the rankings)
        "communes": {
            k: {**ctx.commune(k), "carte": ctx.commune_stats(k).get("carte")}
            for k in sorted(reg.communes)
        },
        "affaires": {
            a: {k: x[k] for k in AFF_SHORT if x.get(k) is not None} for a, x in reg.affaires.items()
        },
    }


def non_lus_file(ctx: Context) -> dict[str, Any]:
    rows = []
    for e in ctx.reg.non_lus:
        row = {k: e.get(k) for k in NON_LU_ROW if k in e and (k != "insee" or e.get(k))}
        if (nom := (ctx.reg.communes.get(e.get("insee") or "") or {}).get("nom")) is not None:
            row["commune"] = nom
        rows.append({**row, "raisons": e["non_lu"]})
    return {"v": 1, "non_lus": rows}


def write_all(ctx: Context, out: Path, write: Writer) -> dict[str, int]:
    """Write every file under `out` through write(relative path, data); counts per kind."""
    reg = ctx.reg
    write("index.json", index_file(ctx))
    write("recherche.json", recherche_file(ctx))
    write("non_lus.json", non_lus_file(ctx))
    write("couverture.json", ctx.couverture)
    insees = sorted(set(reg.communes) | set(reg.by_insee))
    for k in insees:
        write(f"commune/{file_name(k)}.json", commune_file(ctx, k))
    deps = sorted(d for d in reg.by_dep if d)
    for d in deps:
        write(f"departement/{file_name(d)}.json", departement_file(ctx, d))
    sirens = sorted({s for e in reg.evenements for s in e.get("entreprises") or []})
    for s in sirens:
        write(f"entreprise/{file_name(s)}.json", entreprise_file(ctx, s))
    buyers = sorted({b for e in reg.evenements if (b := reg.buyer(e))})
    for b in buyers:
        write(f"acheteur/{file_name(b)}.json", acheteur_file(ctx, b))
    for a in sorted(reg.affaires):
        write(f"document/{file_name(a)}.json", document_file(ctx, a))
    return {
        "commune": len(insees),
        "departement": len(deps),
        "entreprise": len(sirens),
        "acheteur": len(buyers),
        "document": len(reg.affaires),
    }
