"""`lacarte-registre explorer SORTIE`: the lot R5 exploration's measures, written as JSON into
SORTIE, never into the site (lot R5 « les données »: nothing here is served).

It assembles the registre as construire does (pilot, national procurement, collection,
corrections), without writing anything under data/registre, then reads it with champs.py
(section 1), natures.py (2), dossiers.py (3), chiffres.py (4) and signaux.py (5). The
map's cameras come from the last map build (data/build/, OpenStreetMap, ODbL): their commune
and the date of their first version.
"""

from __future__ import annotations

import datetime as dt
import glob
import gzip
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import lacarte_registre as registre
from lacarte_registre import (
    champs,
    chiffres,
    collecte,
    dossiers,
    fusion,
    national,
    natures,
    regles,
    signaux,
)


@dataclass
class Donnees:
    reg: regles.Registre
    decp: dict[str, dict[str, Any]]
    avis: dict[str, dict[str, Any]]
    actes: dict[str, dict[str, Any]]
    subventions: dict[str, dict[str, Any]]
    sirene: dict[str, dict[str, Any]]
    communes: dict[str, dict[str, Any]]
    couverture: dict[str, Any] | None


def _jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    with gzip.open(path, "rt", encoding="utf-8") as g:
        return [json.loads(line) for line in g]


def charger(root: Path, rules: Path) -> Donnees:
    """The registre as construire assembles it (nothing written), and the raw records."""
    pilote = regles.charger(root / "pilote")
    nat = national.assembler(root, rules=rules)
    pilote, _ = fusion.fusionner(pilote, nat)
    if collecte.present(root):
        pilote, _ = collecte.fusionner(pilote, root, rules)
    export = root / "corrections.yaml"
    corr = regles.corrections(rules / "registre_corrections.yaml",
                              *([export] if export.is_file() else []))  # fmt: skip
    reg = regles.appliquer(pilote, corr)
    col = root / "collecte"
    com = json.loads((root / "national" / "communes.json").read_text("utf-8"))["communes"]
    cov = col / "couverture.json"
    return Donnees(
        reg=reg,
        decp={c["uid"]: c for c in _jsonl(root / "national" / "decp.jsonl.gz")},
        avis={a["idweb"]: a for a in _jsonl(col / "avis.jsonl.gz")},
        actes={a["id"]: a for a in _jsonl(col / "arretes.jsonl.gz")},
        subventions={s["id"]: s for s in _jsonl(col / "subventions_etat.jsonl.gz")},
        sirene=json.loads((root / "national" / "sirene.json").read_text("utf-8"))["unites"],
        communes=com,
        couverture=json.loads(cov.read_text("utf-8")) if cov.is_file() else None,
    )


def cameras_carte(build: Path) -> dict[str, list[str | None]]:
    """{insee (a city for its arrondissements): [first version's day or None]} of the map's
    cameras (is_camera, not gone), from the last France build and the regions' communes."""
    import geopandas as gpd
    import pandas as pd

    cams = gpd.read_parquet(
        build / "france" / "cameras_applied.parquet",
        columns=["camera_id", "osm_version", "osm_timestamp", "is_camera", "gone", "geometry"],
    )
    cams = cams[cams.is_camera & ~cams.gone.fillna(False).astype(bool)]
    parts = [
        gpd.read_parquet(f) for f in sorted(glob.glob(str(build / "fr-*" / "communes.parquet")))
    ]
    com = gpd.GeoDataFrame(pd.concat(parts).drop_duplicates("insee"), crs=parts[0].crs)
    j = gpd.sjoin(cams.to_crs(com.crs), com[["insee", "geometry"]], predicate="within")
    out: dict[str, list[str | None]] = defaultdict(list)
    for r in j.drop_duplicates("camera_id").itertuples():
        v = r.osm_version
        first = not pd.isna(v) and int(v) == 1 and isinstance(r.osm_timestamp, str)
        insee = national.ARR.get(r.insee, r.insee)
        out[insee].append(r.osm_timestamp[:10] if first else None)
    return dict(out)


def _jour_acte(act_id: str) -> str | None:
    """The day an act's number carries (« 74-2022-11-18-00014 »), else None."""
    m = re.match(r"^\d{2,3}[AB]?-(\d{4})-(\d{2})-(\d{2})-", act_id)
    return f"{m[1]}-{m[2]}-{m[3]}" if m else None


# --- section 2: natures -------------------------------------------------------------------
def natures_documents(d: Donnees, rn: natures.Regles) -> dict[str, dict[str, Any]]:
    """{event id: classer(...)} for every contract, modification and notice."""
    out = {}
    for e in d.reg.evenements:
        if e["t"] in ("attribution", "modification"):
            c = d.decp.get(e["affaire"]) or {}
            out[e["id"]] = natures.classer(e.get("objet") or c.get("objet"), [c.get("codeCPV")], rn)
        elif e["t"] in ("avis", "resultat", "rectificatif"):
            a = d.avis.get(e["id"]) or {}
            out[e["id"]] = natures.classer(e.get("objet"), a.get("cpv") or [], rn)
    return out


# --- section 3: dossiers ------------------------------------------------------------------
def entrees_dossiers(
    d: Donnees, nat: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """The affaires, grants and acts as dossiers.assembler reads them."""
    reg = d.reg
    affaires = []
    for a in reg.affaires.values():
        if a.get("kind") not in ("contrat", "contrat_non_retrouve"):
            continue
        evs = [reg.by_id[i] for i in a.get("events") or [] if i in reg.by_id]
        con = next((e for e in evs if e["t"] == "attribution"), None)
        avis = [e for e in evs if e["t"] in ("avis", "resultat")]
        ids = {e["id"] for e in avis}
        cited = {x for e in avis for x in (d.avis.get(e["id"]) or {}).get("avis_lies", [])}
        nats = sorted({k for e in evs for k in (nat.get(e["id"]) or {}).get("natures", [])})
        cams = [e.get("cameras") for e in evs if e.get("cameras")]
        if con:
            cams += [int(x) for x in national.CAM_IN_OBJET.findall(con.get("objet") or "")]
        affaires.append({
            "id": a["id"],
            "acheteur_siren": a.get("acheteur_siren"),
            "insee": a.get("insee"),
            "communal": bool(a.get("acheteur_communal")) or any(e.get("communal") for e in evs),
            "natures": [n for n in nats if n != natures.AUTRE] or [natures.AUTRE],
            "cameras": max(cams) if cams else None,
            "titre": a.get("titre") or (con or {}).get("objet"),
            "contrat": {"id": con["id"], "date": con["date"], "montant": con.get("montant")}
            if con and con.get("date") else None,
            "modifications": [e["id"] for e in evs if e["t"] == "modification"],
            "avis": [
                {
                    "id": e["id"],
                    "date": e["date"],
                    "nature": e["t"],
                    "objet": e.get("objet"),
                    "valeur_estimee": ((d.avis.get(e["id"]) or {}).get("resultat") or {}).get(
                        "valeur_estimee"),
                    "cite": e["id"] in cited and len(ids) > 1,
                }
                for e in avis
            ],
        })  # fmt: skip
    grants = []
    for e in reg.evenements:
        if not e["t"].startswith("subvention"):
            continue
        raw = d.subventions.get(e["id"]) or {}
        grants.append({
            "id": e["id"],
            "date": e["date"],
            "annee": e["date"][:4] if e.get("date_annee") else None,
            "siren": raw.get("beneficiaire_siren") or e.get("beneficiaire_siren"),
            "insee": e.get("insee"),
            "base": e.get("base"),
            "montant": e.get("montant"),
            "programme": e.get("programme") or raw.get("programme"),
        })  # fmt: skip
    acts = []
    for e in reg.evenements:
        if e["t"] != "arrete" or not e.get("date"):
            continue
        raw = d.actes.get(e["id"]) or {}
        titre = raw.get("titre") or (
            f"commune {e.get('beneficiaire') or ''}"
            if e.get("type_beneficiaire") in ("commune", "epci") else ""
        )  # fmt: skip
        acts.append({
            "id": e["id"],
            # the act's own day: its recueil may be years later (an act of 2020 in 2024)
            "date": _jour_acte(e["id"]) or raw.get("date_acte") or e["date"],
            "insee": national.ARR.get(e.get("insee") or "", e.get("insee")) or raw.get("insee"),
            "sous_type": e.get("sous_type"),
            "titre": titre,
            "cameras": e.get("cameras"),
        })  # fmt: skip
    return affaires, grants, acts


# --- section 4: figures ---------------------------------------------------------------------
def _insee(k: str | None, dep: str | None = None) -> str | None:
    """A city for its arrondissements; Paris for an act of the département of Paris."""
    return national.ARR.get(k or "", k) or ("75056" if dep == "75" else None)


def entrees_chiffres(
    d: Donnees, nat: dict[str, dict[str, Any]], cf: dict[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    """The contracts, grants, acts and flights as chiffres.py reads them."""
    reg = d.reg
    contrats, grants, acts, flights = [], [], [], []
    holders = {
        "commune": "mairie",
        "epci": "mairie",
        "commerce": "commerces",
        "banque": "commerces",
    }
    noms = {k: v["nom"] for k, v in d.communes.items()}
    rd = dossiers.rules(registre.RULES / "registre_dossiers.yaml")
    for e in reg.evenements:
        t = e["t"]
        if t == "attribution":
            raw = d.decp.get(e["affaire"]) or {}
            contrats.append({
                "id": e["id"], "insee": _insee(e.get("insee")), "dep": e.get("dep"),
                "acheteur": reg.buyer(e), "communal": e["communal"], "compte": e["compte"],
                "date": e.get("date"), "montant": champs.montant_ok(e.get("montant"), cf),
                "offres": champs.offres_ok(raw.get("offres"), cf),
                "entreprises": [s for s in e.get("entreprises") or [] if s != regles.EI],
                "natures": (nat.get(e["id"]) or {}).get("natures", []),
            })  # fmt: skip
        elif t.startswith("subvention"):
            raw = d.subventions.get(e["id"]) or {}
            grants.append({
                "id": e["id"],
                "siren": raw.get("beneficiaire_siren") or e.get("beneficiaire_siren"),
                "insee": _insee(e.get("insee")), "dep": e.get("dep"), "communal": e["communal"],
                "date": e.get("date"), "montant": e.get("montant"),
                "source": "region" if t == "subvention_region" else "etat",
            })  # fmt: skip
        elif t == "arrete":
            insee = _insee(e.get("insee"), e.get("dep"))
            titre = (d.actes.get(e["id"]) or {}).get("titre")
            who = holders.get(e.get("type_beneficiaire") or "") or (
                "autres" if e.get("type_beneficiaire") else None
            )
            if (
                who is None
                and insee
                and dossiers.arrete_communal({**e, "titre": titre}, noms.get(insee), rd)
            ):
                who = "mairie"
            acts.append({
                "id": e["id"], "insee": insee, "dep": e.get("dep"),
                "dossier": e.get("dossier") or e.get("affaire"),
                "date": _jour_acte(e["id"]) or e.get("date"), "sous_type": e.get("sous_type"),
                "titulaire": who, "cameras": e.get("cameras"),
            })  # fmt: skip
        elif t == "arrete_drone":
            raw = d.actes.get(e["id"]) or {}
            ch = raw.get("champs") or {}
            shared = e.get("partage") or []
            flights.append({
                "id": e["id"], "dep": e.get("dep"),
                "insees": [_insee(k, e.get("dep")) for k in [e.get("insee"), *shared]
                           if k or e.get("dep") == "75"],
                "dates": ch.get("dates") or ([e["periode"]] if e.get("periode") else []),
                "texte": f"{raw.get('titre') or ''} {ch.get('zone_extrait') or ''}",
            })  # fmt: skip
    return {"contrats": contrats, "subventions": grants, "actes": acts, "vols": flights}


def figures(d: Donnees, inp: dict[str, list[dict[str, Any]]], cams: dict[str, list[str | None]],
            today: str, conf: dict[str, Any]) -> dict[str, Any]:  # fmt: skip
    """The communes', intercommunalities', départements', régions' and companies' figures."""
    etats = chiffres.etats_actes(d.couverture)
    rows = chiffres.communes(d.communes, inp["contrats"], inp["subventions"], inp["actes"],
                             inp["vols"], {k: len(v) for k, v in cams.items()}, etats, today,
                             conf)  # fmt: skip
    reg_of = chiffres.region_of(conf)
    regions_lues = {reg_of.get(g.get("dep") or "") for g in inp["subventions"]
                    if g["source"] == "region"}  # fmt: skip
    counted = [c for c in inp["contrats"] if c["compte"]]

    def terr(ks: list[str], cs: list[dict[str, Any]], gs: list[dict[str, Any]], reg: str | None):
        return chiffres.territoire(ks, rows, cs, gs, inp["vols"], today, conf, reg in regions_lues)

    members: dict[str, list[str]] = defaultdict(list)
    for k, c in d.communes.items():
        if c.get("epci"):
            members[c["epci"]].append(k)
    epcis = {}
    for code, ks in members.items():
        cs = [c for c in counted if c["acheteur"] == code]
        gs = [g for g in inp["subventions"] if g["siren"] == code]
        reg = reg_of.get(d.communes[ks[0]]["dep"])
        epcis[code] = {"siren": code, **terr(ks, cs, gs, reg)}
    # the public money of a commune on three levels, side by side and never added up: the
    # commune itself, its intercommunality (its own contracts), every buyer on its territory
    # (the commune, a hospital, a transport authority, a social landlord…)
    on_site: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in counted:
        if c.get("insee"):
            on_site[c["insee"]].append(c)
    for k, r in rows.items():
        code = d.communes[k].get("epci")
        e = epcis.get(code) if code else None
        here = chiffres._since(on_site.get(k, []), conf["montants"]["depuis"])
        r["argent_niveaux"] = {
            "commune": r["montant"],
            "intercommunalite": {**e["montant"], "siren": code} if e else chiffres.fig(None),
            "territoire": chiffres.fig(
                round(sum(c.get("montant") or 0 for c in here)),
                n=len(here),
                acheteurs=len({c.get("acheteur") for c in here}),
            ),
            "note": "trois niveaux, jamais additionnés",
        }
    deps, regs = {}, {}
    for dep in sorted({c["dep"] for c in d.communes.values() if c.get("dep")}):
        ks = [k for k, c in d.communes.items() if c.get("dep") == dep]
        deps[dep] = {"etat_actes": etats.get(dep, chiffres.NON_LU), **terr(
            ks, [c for c in counted if c["dep"] == dep],
            [g for g in inp["subventions"] if g["dep"] == dep], reg_of.get(dep))}  # fmt: skip
    for code, r in conf["regions"].items():
        ks = [k for k, c in d.communes.items() if c.get("dep") in r["deps"]]
        regs[code] = {"nom": r["nom"], **terr(
            ks, [c for c in counted if c["dep"] in r["deps"]],
            [g for g in inp["subventions"] if g["dep"] in r["deps"]], code)}  # fmt: skip
    return {
        "communes": rows,
        "epci": epcis,
        "departements": deps,
        "regions": regs,
        "entreprises": chiffres.entreprises(inp["contrats"], conf),
    }


# --- section 5: signals --------------------------------------------------------------------
def entrees_signaux(
    d: Donnees,
    nat: dict[str, dict[str, Any]],
    affaires: list[dict[str, Any]],
    res: dict[str, Any],
    grants: list[dict[str, Any]],
    cf: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The counted contracts and the grants without a contract, as signaux.py reads them."""
    reg = d.reg
    by_aff = {a["id"]: a for a in affaires}
    sure = {
        (lk["de"], lk["vers"])
        for x in res["dossiers"]
        for lk in x["liens"]
        if lk["type"] == "avis" and lk["niveau"] == dossiers.SUR
    }
    contrats = []
    for e in reg.evenements:
        if e["t"] != "attribution" or not e["compte"]:
            continue
        raw = d.decp.get(e["affaire"]) or {}
        tech = (raw.get("techniques") or "").lower()
        aff = by_aff.get(e["affaire"]) or {}
        calls = [v for v in aff.get("avis") or [] if v["nature"] == "avis" and v.get("date")]
        first = min(calls, key=lambda v: v["date"]) if calls else None
        contrats.append({
            "id": e["id"], "acheteur": reg.buyer(e), "acheteur_nom": raw.get("acheteur_nom"),
            "date": e.get("date"), "montant": champs.montant_ok(e.get("montant"), cf),
            "offres": champs.offres_ok(raw.get("offres"), cf),
            "accord_cadre": "accord-cadre" in tech, "subsequent": bool(raw.get("idAccordCadre")),
            "natures": (nat.get(e["id"]) or {}).get("natures", []),
            "avenant": champs.avenant(raw.get("lignes") or [], cf),
            "procedure": raw.get("procedure"),
            "avis_jours": dossiers._days(first["date"], e["date"]) if first and e.get("date")
            else None,
            "avis_sur": bool(first) and (first["id"], e["affaire"]) in sure,
            "avec_avis": bool(aff.get("avis")),
            "titre": e.get("objet"), "document": e.get("ref"),
        })  # fmt: skip
    alone = set(res["sans_lien"]["subvention_sans_contrat"])
    out = []
    for g in grants:
        if g["id"] in alone:
            e = reg.by_id.get(g["id"]) or {}
            out.append({**g, "beneficiaire": e.get("beneficiaire"), "document": e.get("ref")})
    return contrats, out


def run(out: Path, root: Path | None = None, rules: Path | None = None,
        build: Path | None = None, today: str | None = None) -> dict[str, Any]:  # fmt: skip
    root = root or registre.ROOT
    rules = rules or registre.RULES
    build = build or registre.ROOT.parent / "build"
    today = today or dt.date.today().isoformat()
    out.mkdir(parents=True, exist_ok=True)
    d = charger(root, rules)
    summary: dict[str, Any] = {"documents": len(d.reg.evenements)}

    def put(name: str, data: Any) -> None:
        (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")

    # 1. the fields
    cf = champs.rules(rules / "registre_champs.yaml")
    rows = champs.charger(root, cf, today)
    fields = {
        "contrats": ["date", "offres", "duree", "cpv", "accord_cadre", "montant", "titulaires",
                     "avenant"],
        "avis": ["date", "valeur_estimee", "montant_attribue", "date_attribution", "titulaires",
                 "lieu", "cpv"],
        "entreprises": ["naf", "categorie", "actif", "ei"],
        "subventions": ["base", "taux", "montant", "programme"],
    }  # fmt: skip
    put("champs.json", {k: {"remplissage": champs.remplissage(rows[k], f),
                            "aberrations": champs.aberrations(rows[k], cf)}
                        for k, f in fields.items()})  # fmt: skip
    # 2. the natures
    rn = natures.load(rules / "registre_natures.yaml")
    nat = natures_documents(d, rn)
    put("natures.json", nat)
    summary["natures"] = dict(Counter(k for v in nat.values() for k in v["natures"]))
    # 3. the dossiers
    affaires, grants, acts = entrees_dossiers(d, nat)
    cams = cameras_carte(build) if (build / "france" / "cameras_applied.parquet").is_file() else {}
    noms = {k: v["nom"] for k, v in d.communes.items()}
    res = dossiers.assembler(affaires, grants, acts, cams, noms,
                             dossiers.rules(rules / "registre_dossiers.yaml"))  # fmt: skip
    put("dossiers.json", res)
    summary["dossiers"] = len(res["dossiers"])
    summary["sans_lien"] = {k: len(v) for k, v in res["sans_lien"].items()}
    # 4. the figures
    inp = entrees_chiffres(d, nat, cf)
    fg = figures(d, inp, cams, today, chiffres.rules(rules / "registre_chiffres.yaml"))
    some = {k: r for k, r in fg["communes"].items()
            if r["cameras_carte"]["v"] or r["montant"]["v"] or r["jours_vol"]["v"]
            or r["cameras_autorisees"].get("dossiers")}  # fmt: skip
    put("chiffres.json", {**fg, "communes": some})
    summary["chiffres"] = {"communes": len(some), "entreprises": len(fg["entreprises"])}
    # 5. the signals
    cs, gs = entrees_signaux(d, nat, affaires, res, grants, cf)
    sg = signaux.trouver(cs, gs, signaux.rules(rules / "registre_signaux.yaml"))
    put("signaux.json", sg)
    summary["signaux"] = {k: len(v) for k, v in sg.items()}
    return summary
