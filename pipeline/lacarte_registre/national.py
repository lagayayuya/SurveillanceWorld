# ruff: noqa: E501  (the exploration's regular expressions and phrases, kept whole)
"""The national public procurement in the registre's own shape, offline: the four sources
collected (decp.py, boamp.py, sirene.py, communes.py, under <root>/national/) assembled into
documents (`evenements`), affaires, companies, buyers, communes and lots, by the exploration's
rules (design/registre/collecte/build_registre.py, boamp_link.py, faits.py, ported; the
values in rules/registre_selection.yaml). Called by construire, which merges it with what
still comes from the pilot (merge.py); nothing here asks the network.

The ids are the official ones, as the pilot's: a contract `<uid>~<modification>`, its affaire
the DECP uid; a notice its BOAMP idweb, its affaire its contract's uid or `avis-<idweb>`; a
company or a buyer its SIREN; a commune its INSEE code (an arrondissement of Paris, Lyon or
Marseille is its city).
"""

from __future__ import annotations

import datetime as dt
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any

from lacarte_registre import boamp, decp, selection

DECP_PAGE = "https://www.data.gouv.fr/datasets/608c055b35eb4e6ee20eb325"
ARR = {
    **{f"751{i:02d}": "75056" for i in range(1, 21)},
    **{f"6938{i}": "69123" for i in range(1, 10)},
    **{f"132{i:02d}": "13055" for i in range(1, 17)},
}
SIREN_OR_SIRET = re.compile(r"\d{9}(\d{5})?")
CAM_IN_OBJET = re.compile(
    r"(?<![\w,.])(\d{1,4})\s+(?:nouvelles?\s+|nlles\s+|nlels\s+)?cam[ée]ras?", re.I
)
# A buyer's category from its name, first match wins (build_acheteurs.py KEYWORDS)
KEYWORDS = [
    ("etat", r"\bPREFECTURE\b|\bMINISTERE|\bGENDARMERIE\b|\bPOLICE NATIONALE\b|\bCOMMISSARIAT\b"
             r"|\bPENITENTIAIRE|\bSGAMI\b|\bSGAP\b|SECRETARIAT GENERAL POUR L ADMINISTRATION"
             r"|AGENCE REGIONALE (DE )?SANTE|\bDISP\b|\bDIRECTION (INTER)?REGIONALE"
             r"|\bDIRECTION (INTER)?DEPARTEMENTALE|\bDREAL\b|\bDRIEA"),
    ("sante", r"\bHOPITA|\bHOSPITALIER|\bHOSPITALO|\bHOSPICES\b|\bCHU\b|\bCHR\b|\bGHT\b|\bGHU\b"
              r"|ASSISTANCE PUBLIQUE|\bAP H[PM]\b|\bCLINIQUE|\bEHPAD\b|INSTITUT CURIE"
              r"|\bUNION DES HOPITAUX|\bACHETEURS HOSPITALIERS"),
    ("bailleur", r"\bOPH\b|\bOPHLM\b|\bHABITAT\b|\bLOGEMENTS?\b|\bHLM\b|LOYER MODERE|\bOPAC\b"
                 r"|OFFICE PUB(LIC)? D|HABITATIONS|\bIMMOBILIERE\b|\bELOGIE\b|\bIN LI\b|\bSIEMP\b"),
    ("education", r"\bUNIVERSITE|\bUNIV\b|\bLYCEE\b|\bCOLLEGE\b|\bECOLE\b|\bRECTORAT\b|\bRECT\b"
                  r"|\bACADEMIE\b|\bCROUS\b|\bINSA\b|ENSEIGNEMENT SUPERIEUR|CENTRALESUPELEC|\bIUT\b"
                  r"|ETUDES POLITIQUES"),
    ("etat", r"SCIENCES ET TECHNOLOGIES DES TRANSPORTS|\bCEREMA\b|CENTRE D ETUDES ET D EXPERTISE"),
    ("autre", r"^SOCIETE D ECONOMIE MIXTE|^SEM\b"),
    ("transports", r"\bSYTRAL\b|\bMOBILITES?\b|\bTRANSPORTS?\b|\bRATP\b|\bSNCF\b|\bTRAMWAY"
                   r"|\bAEROPORTS?\b|\bGRAND PORT\b|\bPORT AUTONOME\b|\bHAROPA\b"
                   r"|\bVOIES NAVIGABLES\b|\bAUTOROUTES?\b|\bRTM\b"),
    ("etat", r"\bARMEES?\b|SERVICES DE L ETAT|\bJUSTICE\b|COUR D APPEL|COUR ADMINISTRATIVE"
             r"|\bTRIBUNAL\b|COUR DES COMPTES|CONSEIL D ETAT|SECRETARIAT GENERAL|FINANCES PUBLIQUES"
             r"|\bDGFIP\b|\bNATIONA(L|LE|LES|UX)\b|\bFRANCE TRAVAIL\b|\bASSEMBLEE NATIONALE\b"
             r"|\bSENAT\b|\bAUTORITE\b"),
    ("metropole", r"^METROPOLE\b|\bMETROPOLE$|\bMETROPOLE (DE|DU|D|NICE|AIX|EUROPEENNE|ROUEN|GRAND)\b"),
    ("intercommunalite", r"\bCOMMUNAUTE (D AGGLOMERATION|DE COMMUNES?|URBAINE|AGGLOMERATION"
                         r"|COMMUNES|D AGGLO)\b|^CA |^CC |^CU |\bAGGLOMERATION$|\bAGGLO\b"
                         r"|\bETABLISSEMENT PUBLIC TERRITORIAL\b|^EPT\b|\bSIVOM\b|\bSIVU\b"
                         r"|SYNDICAT INTERCOMMUNAL"),
    ("departement", r"^DEPARTEMENT\b|CONSEIL DEPARTEMENTAL|CONSEIL GENERAL"
                    r"|COLLECTIVITE EUROPEENNE D ALSACE"),
    ("region", r"^REGION\b|CONSEIL REGIONAL|COLLECTIVITE TERRITORIALE DE (CORSE|GUYANE|MARTINIQUE)"),
    ("commune", r"^(COMMUNE|VILLE|MAIRIE)\b"),
]  # fmt: skip
DECP_CAT = {
    "Département": "departement", "Département outre-mer": "departement", "Région": "region",
    "État": "etat", "Établissement hospitalier": "sante", "Commune": "commune",
    "Groupement de communes": "intercommunalite",
}  # fmt: skip


def _upper_plain(s: str) -> str:
    return re.sub(r"[^A-Z0-9]+", " ", selection.plain(s).upper()).strip()


def categorie(siren: str, nom: str, decp_cat: str | None, ref: Reference) -> str:
    if siren in ref.commune_by_siren:
        return "commune"
    if siren in ref.epcis:
        return "metropole" if "METROPOLE" in _upper_plain(nom) else "intercommunalite"
    p = _upper_plain(nom)
    for cat, rx in KEYWORDS:
        if re.search(rx, p):
            return cat
    if decp_cat and DECP_CAT.get(decp_cat):
        return DECP_CAT[decp_cat]
    return "etat" if siren.startswith("1") else "autre"


def _num(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if v != v else v


def _jour(x: Any) -> str:
    """A published day, or "" when it is none a contract can have: a well-formed date from 1990
    to next year (the DECP hold « 0029-12-22 » for a 2021 contract, 2026-10-31)."""
    d = str(x or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        return ""
    return d if 1990 <= int(d[:4]) <= dt.date.today().year + 1 else ""


def _days(a: str, b: str) -> int:
    return (dt.date.fromisoformat(b[:10]) - dt.date.fromisoformat(a[:10])).days


@dataclass
class Reference:
    """The communes of France (communes.py) and what they give."""

    communes: dict[str, dict[str, Any]]
    epcis: dict[str, str]
    departements: dict[str, str]
    commune_by_siren: dict[str, str] = field(default_factory=dict)
    by_name: dict[tuple[str, str], str | None] = field(default_factory=dict)
    pop_by_siren: dict[str, int] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> Reference:
        d = json.loads(path.read_text(encoding="utf-8"))
        ref = cls(d["communes"], d["epcis"], d["departements"])
        for code, c in ref.communes.items():
            if c.get("siren"):
                ref.commune_by_siren[c["siren"]] = code
            k = (c["dep"], selection.norm(c["nom"]))
            # homonyms in a département: no match by name
            ref.by_name[k] = None if k in ref.by_name else c.get("siren")
            ref.pop_by_siren[c.get("siren") or ""] = c["pop"]
            if c.get("epci"):
                ref.pop_by_siren[c["epci"]] = ref.pop_by_siren.get(c["epci"], 0) + c["pop"]
        return ref

    def commune_of_place(self, cp: str, ville: str) -> str | None:
        """A notice's address (postal code, town) to its commune: by name in the
        département (boamp_lieux.py)."""
        if not cp or not ville:
            return None
        dep = cp[:3] if cp.startswith("97") else cp[:2]
        v = re.sub(r"\b\d+(er|e)?\b", "", ville)
        v = re.sub(r"[^a-z0-9]+", " ", selection.plain(v)).replace(" st ", " saint ").strip()
        first = v.split(" ")[0] if v else ""
        city = {"paris": "75056", "lyon": "69123", "marseille": "13055"}
        if first in city and dep in ("75", "69", "13"):
            return city[first]
        for code, c in self.communes.items():
            if c["dep"] == dep and re.sub(r"[^a-z0-9]+", " ", selection.plain(c["nom"])) == v:
                return code
        return None


def _buyer_name(names: Counter[str], siren: str, ref: Reference) -> str:
    if siren in ref.commune_by_siren:
        nom = ref.communes[ref.commune_by_siren[siren]]["nom"]
        return f"Commune d'{nom}" if nom[:1] in "AEIOUYÉÈÎ" else f"Commune de {nom}"
    if siren in ref.epcis:
        return ref.epcis[siren]
    nom = names.most_common(1)[0][0] if names else siren
    return re.sub(r"\s*\(.*\)\s*$", "", nom).strip() or nom


def sans_doublons(contrats: Any) -> list[dict[str, Any]]:
    """The contracts the registre shows: none on a CPV alone, none excluded by a reader, one
    of each set published twice (rules/registre_selection.yaml doublons_decp, exclus)."""
    r = selection.rules()
    ex = r["exclus"]
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for c in contrats:
        if c.get("chemin") in ex["chemins"] or c["uid"] in ex["uids"]:
            continue
        m0 = c["lignes"][0]
        key = ((c.get("acheteur_id") or "")[:9], m0.get("dateNotification"),
               _num(m0.get("montant")), _fold(c.get("objet")))  # fmt: skip
        groups[key].append(c)
    out = []
    for cs in groups.values():
        cs.sort(key=lambda c: (-len(c["lignes"]), -len(c.get("objet") or ""), c["uid"]))
        out.append(cs[0])
    return sorted(out, key=lambda c: c["uid"])


def assembler(root: Path, today: str | None = None) -> dict[str, Any]:
    """The national registre from <root>/national/: {evenements, affaires, entreprises,
    communes, ACHETEURS, EPCIS, DEP, LOTS, LOTS_GROUPES, sources}."""
    nat = root / "national"
    ref = Reference.load(nat / "communes.json")
    sir = (
        json.loads((nat / "sirene.json").read_text("utf-8"))
        if (nat / "sirene.json").is_file()
        else {}
    )
    unites: dict[str, dict[str, Any]] = sir.get("unites", {})
    contrats = sans_doublons(decp.load(nat / "decp.jsonl.gz"))
    notices = list(boamp.load(nat / "boamp.jsonl.gz")) if (nat / "boamp.jsonl.gz").is_file() else []
    sources = {
        k: json.loads((nat / f"{k}.json").read_text("utf-8"))
        for k in ("decp", "boamp")
        if (nat / f"{k}.json").is_file()
    }
    rules = selection.rules()
    ev: list[dict[str, Any]] = []
    affaires: dict[str, dict[str, Any]] = {}
    buyer_names: dict[str, Counter[str]] = defaultdict(Counter)
    buyer_cat: dict[str, Counter[str]] = defaultdict(Counter)
    buyer_seat: dict[str, Counter[str]] = defaultdict(Counter)
    buyer_dep: dict[str, Counter[str]] = defaultdict(Counter)

    # --- contracts and their modifications --------------------------------------------
    for c in contrats:
        uid = c["uid"]
        siren = (c.get("acheteur_id") or "")[:9]
        insee = ref.commune_by_siren.get(siren) or c.get("acheteur_commune_code")
        insee = ARR.get(insee or "", insee)
        dep = c.get("acheteur_departement_code") or (ref.communes.get(insee or "") or {}).get("dep")
        disp = selection.dispositif(c.get("objet"))
        buyer_names[siren][c.get("acheteur_nom") or ""] += 1
        if c.get("acheteur_categorie"):
            buyer_cat[siren][c["acheteur_categorie"]] += 1
        if insee:
            buyer_seat[siren][insee] += 1
        if dep:
            buyer_dep[siren][dep] += 1
        affaires[uid] = {
            "id": uid,
            "kind": "contrat",
            "titre": selection.texte(c.get("objet"), 160),
            "insee": insee,
            "dep": dep,
            "acheteur": re.sub(r"\s*\(.*\)\s*$", "", c.get("acheteur_nom") or ""),
            "acheteur_siren": siren,
            "acheteur_communal": siren in ref.commune_by_siren,
            "dispositif": disp,
            "techniques": c.get("techniques") or "",
            "chemin": c.get("chemin"),
            "events": [],
        }
        prev = None
        prev_tit: set[str] = set()
        for m in c["lignes"]:
            n = int(m["modification_id"])
            ids = {re.sub(r"\s", "", str(t)) for t in m.get("titulaires") or []}
            tit = sorted({t[:9] for t in ids if SIREN_OR_SIRET.fullmatch(t)})
            changes = []
            if prev is not None:
                if _num(m.get("montant")) != _num(prev.get("montant")):

                    def fe(v: float | None) -> str:
                        return f"{v:,.0f}".replace(",", " ") if v is not None else "?"

                    changes.append(
                        f"montant {fe(_num(prev.get('montant')))} → {fe(_num(m.get('montant')))} €"
                    )
                if _num(m.get("dureeMois")) != _num(prev.get("dureeMois")):
                    a, b = _num(prev.get("dureeMois")) or 0, _num(m.get("dureeMois")) or 0
                    changes.append(f"durée {int(a)} → {int(b)} mois")
                if set(tit) != prev_tit:
                    changes.append("titulaires")
            src = m.get("sourceFile")
            e = {
                "id": f"{uid}~{n}",
                "t": "attribution" if n == 0 else "modification",
                "date": _jour(m.get("dateNotification")),
                "insee": insee,
                "dep": dep,
                "affaire": uid,
                "entreprises": tit,
                "montant": _num(m.get("montant")),
                "duree": _num(m.get("dureeMois")),
                "modif_n": n,
                "changements": changes,
                "objet": selection.texte(c.get("objet")),
                "ref": f"DECP {uid}" + (f", modification {n}" if n else ""),
                "url": src if isinstance(src, str) and src.startswith("http") else DECP_PAGE,
                "dispositif": disp,
                "estimation": False,
                "origine": "decp",
            }
            o = c.get("offres")
            if n == 0 and o is not None and 0 < o < 100:
                e["offres"] = int(o)
            ev.append(e)
            affaires[uid]["events"].append(e["id"])
            prev, prev_tit = m, set(tit)

    # --- notices ------------------------------------------------------------------------
    by_uid_first = {e["affaire"]: e for e in ev if e["t"] == "attribution"}
    name_to_siren: dict[str, str] = {}
    for s, names in buyer_names.items():
        for nm in names:
            name_to_siren.setdefault(selection.norm(nm), s)
    commune_name_of = {
        s: selection.norm(ref.communes[k]["nom"]) for s, k in ref.commune_by_siren.items()
    }
    li = rules["liens"]
    by_buyer: dict[str, list[str]] = defaultdict(list)
    for u, a in affaires.items():
        by_buyer[a["acheteur_siren"]].append(u)
    first_of: dict[str, str] = {}
    resultats: dict[str, dict[str, Any]] = {}
    for n in sorted(notices, key=lambda x: x["date"]):
        sirens = [s[:9] for s in n["sirets"]]
        named = name_to_siren.get(selection.norm(n["acheteur"]))
        if not named and not sirens:
            dep0 = (n["departements"] or [""])[0]
            named = ref.by_name.get((dep0, selection.norm(n["acheteur"])))
        siren = named if named in sirens else (sirens[0] if sirens else named)
        # a SIRET of another commune than the one the notice names (Gonesse): the name wins
        if sirens and named and siren != named:
            com = commune_name_of.get(siren)
            if com and com not in selection.norm(n["acheteur"]):
                siren = named
        insee = ref.commune_by_siren.get(siren or "")
        dep = insee[:2] if insee else (n["departements"] or [None])[0]
        lieu = ref.commune_of_place(n["lieu"].get("cp", ""), n["lieu"].get("ville", ""))
        aff = None
        if siren and n["nature"] in ("avis", "resultat"):
            before, after = (
                (li["resultat_avant_jours"], li["resultat_apres_jours"])
                if n["nature"] == "resultat"
                else (li["avant_jours"], li["apres_jours"])
            )
            best = (0.0, "")
            for u in by_buyer.get(siren, []):
                c0 = by_uid_first.get(u)
                if not c0 or not c0["date"]:
                    continue
                d = _days(n["date"], c0["date"])
                if not -before <= d <= after:
                    continue
                j = selection.jaccard(n["objet"], affaires[u]["titre"])
                if j >= li["jaccard"] and (j, u) > best:
                    best = (j, u)
            aff = best[1] or None
        if aff is None:
            aff = next((first_of[x] for x in n["avis_lies"] if x in first_of), None)
        if aff is None and n.get("cameras") and siren:
            cand = [
                u for u in by_buyer.get(siren, [])
                if (c0 := by_uid_first.get(u)) and c0["date"]
                and 0 <= _days(n["date"], c0["date"]) <= li["cameras_jours"]
                and n["cameras"] in [int(x) for x in CAM_IN_OBJET.findall(c0["objet"] or "")]
            ]  # fmt: skip
            if len(cand) == 1:
                aff = cand[0]
        aff = aff or f"avis-{n['idweb']}"
        first_of[n["idweb"]] = aff
        e = {
            "id": n["idweb"],
            "t": n["nature"],
            "date": n["date"],
            "insee": insee,
            "dep": dep,
            "affaire": aff,
            "entreprises": [],
            "acheteur": n["acheteur"],
            "acheteur_siren": siren,
            "cameras": n.get("cameras"),
            "objet": n["objet"],
            "ref": f"BOAMP {n['idweb']}",
            "url": n.get("url"),
            "dispositif": None,
            "origine": "boamp",
        }
        if lieu:
            e["lieu_insee"] = lieu
        ev.append(e)
        resultats[n["idweb"]] = n["resultat"]
        if aff not in affaires:
            affaires[aff] = {"id": aff, "kind": "contrat_non_retrouve", "insee": insee, "dep": dep,
                             "acheteur_siren": siren, "events": []}  # fmt: skip
        affaires[aff]["events"].append(e["id"])

    evd = {e["id"]: e for e in ev}
    for a in affaires.values():
        es = sorted((evd[i] for i in a["events"]), key=lambda e: e["date"] or "")
        a["events"] = [e["id"] for e in es]
        a["debut"], a["fin"] = es[0]["date"], es[-1]["date"]
        a["entreprises"] = sorted({s for e in es for s in e.get("entreprises") or []})
        if a["kind"] == "contrat_non_retrouve":
            a["titre"] = es[0].get("objet") or es[0].get("ref")
    _quality(ev, affaires, evd, resultats, ref)
    _probables(affaires, evd, resultats, unites)
    lots, groupes = _lots(ev, affaires)

    # --- dictionaries -------------------------------------------------------------------
    sirens = {s for e in ev for s in e.get("entreprises") or []}
    entreprises = {}
    for s in sorted(sirens):
        u = unites.get(s)
        if u is None or u.get("introuvable"):
            # not checked in SIRENE: maybe a natural person, so never named nor given a page
            entreprises[s] = {"siren": s, "nom": None, "entrepreneur_individuel": True,
                              "verifie_sirene": False}  # fmt: skip
        else:
            entreprises[s] = {"siren": s, "nom": None if u["ei"] else u.get("nom"),
                              "entrepreneur_individuel": bool(u["ei"]), "naf": u.get("naf"),
                              "verifie_sirene": True}  # fmt: skip
    buyers = {a["acheteur_siren"] for a in affaires.values() if a.get("acheteur_siren")}
    buyers |= {e["acheteur_siren"] for e in ev if e.get("acheteur_siren")}
    acheteurs = {}
    for s in sorted(b for b in buyers if b):
        nom = _buyer_name(buyer_names.get(s, Counter()), s, ref)
        cat = categorie(
            s,
            nom,
            (buyer_cat.get(s) or Counter()).most_common(1)[0][0] if buyer_cat.get(s) else None,
            ref,
        )
        seat = ref.commune_by_siren.get(s) or (
            buyer_seat[s].most_common(1)[0][0] if buyer_seat.get(s) else None
        )
        depc = buyer_dep.get(s)
        acheteurs[s] = {
            "nom": nom,
            "categorie": cat,
            "dep": (ref.communes.get(seat or "") or {}).get("dep")
            or (depc.most_common(1)[0][0] if depc else None),
            "insee_siege": seat if seat in ref.communes else None,
        }
    communes = {
        k: {kk: c.get(kk) for kk in ("nom", "dep", "pop", "epci")} for k, c in ref.communes.items()
    }
    return {
        "evenements": ev,
        "affaires": affaires,
        "entreprises": entreprises,
        "communes": communes,
        "ACHETEURS": acheteurs,
        "EPCIS": dict(ref.epcis),
        "DEP": {k: {"nom": v} for k, v in ref.departements.items()},
        "LOTS": lots,
        "LOTS_GROUPES": groupes,
        "sources": sources,
        "sirene": {"version": sir.get("version"), "mode": sir.get("mode")},
    }


def _quality(
    ev: list[dict[str, Any]],
    affaires: dict[str, dict[str, Any]],
    evd: dict[str, dict[str, Any]],
    resultats: dict[str, dict[str, Any]],
    ref: Reference,
) -> None:
    """The amounts the totals leave out (rules/registre_selection.yaml § 3): a central
    purchasing body's, a mixed contract's, an amount to check, a national buyer's."""
    r = selection.rules()
    cen, mix, nat, av = r["centrales"], r["mixte"], r["national"], r["a_verifier"]
    first = {e["affaire"]: e for e in ev if e["t"] == "attribution"}
    by_amount: dict[float, list[dict[str, Any]]] = defaultdict(list)
    for e in first.values():
        if (e["montant"] or 0) >= av["meme_montant_min"]:
            by_amount[e["montant"]].append(e)
    groupes = set()
    for es in by_amount.values():
        for e in es:
            # a contract published without its notification day (54 of the DECP's rows on
            # 2026-10-31) is near no other
            if not e["date"]:
                continue
            near = {affaires[x["affaire"]]["acheteur_siren"] for x in es if x["date"]
                    and abs(_days(x["date"], e["date"])) <= av["meme_montant_jours"]}  # fmt: skip
            if len(near) >= av["meme_montant_acheteurs"]:
                groupes.add(e["affaire"])
    for u, e in first.items():
        a = affaires[u]
        ob = selection.plain(e["objet"])
        a["centrale_achat"] = a["acheteur_siren"] in cen["sirens"] or bool(
            re.search(cen["rx"], selection.plain(a["acheteur"]))
        )
        fam = (
            "autres"
            if re.search(mix["autres"], ob)
            else "surete"
            if re.search(mix["surete"], ob)
            else ""
        )
        a["mixte_famille"] = "" if a["centrale_achat"] else fam
        a["contrat_mixte"] = bool(a["mixte_famille"])
        a["acheteur_national"] = bool(re.search(nat["rx"], selection.plain(a["acheteur"])))
        pp = []
        if len(e["entreprises"]) >= 2:
            pp.append(f"accord-cadre à {len(e['entreprises'])} titulaires")
        if any((resultats.get(i) or {}).get("groupement") for i in a["events"]):
            pp.append("groupement de commandes ou coordonnateur dans l'avis BOAMP")
        if u in groupes:
            pp.append("même montant publié par plusieurs acheteurs le même mois")
        a["plafond_partage"] = "; ".join(pp)
        raisons = []
        mt = e["montant"] or 0
        if not a["centrale_achat"]:
            pop = ref.pop_by_siren.get(a["acheteur_siren"], 0)
            if pop and mt / pop > av["par_habitant"] and mt >= av["par_habitant_min"]:
                raisons.append(
                    f"{round(mt / pop):,} € par habitant de l'acheteur ({pop:,} habitants)".replace(
                        ",", " "
                    )
                )
            if mt > av["etude_min"] and re.search(av["etude_rx"], ob):
                raisons.append("mission d'études ou d'assistance à plus de 1 M€")
            for i in a["events"]:
                x = evd[i]
                res = resultats.get(i)
                if x["t"] not in ("avis", "resultat") or not res:
                    continue
                ve, ma = res.get("valeur_estimee"), res.get("montant_attribue")
                if ve and mt > av["estimee_x"] * ve and mt - ve > av["ecart_min"]:
                    raisons.append(
                        f"{mt / ve:.0f} fois la valeur estimée de l'avis {i} ({ve:,.0f} €)".replace(
                            ",", " "
                        )
                    )
                if ma and mt > av["attribue_x"] * ma and mt - ma > av["ecart_min"]:
                    raisons.append(
                        f"{mt / ma:.0f} fois le montant attribué publié par l'avis {i} ({ma:,.0f} €)".replace(
                            ",", " "
                        )
                    )
            if u in groupes:
                raisons.append(
                    "même montant publié par au moins 3 acheteurs le même mois (groupement de commandes ?)"
                )
        a["montant_a_verifier"] = "; ".join(dict.fromkeys(raisons))
        for i in a["events"]:
            x = evd[i]
            if x["t"] in ("attribution", "modification"):
                x["hors_totaux"] = (
                    "centrale" if a["centrale_achat"]
                    else "a_verifier" if raisons
                    else f"mixte_{a['mixte_famille']}" if a["contrat_mixte"]
                    else ""
                )  # fmt: skip
                x["national"] = a["acheteur_national"]


def _probables(
    affaires: dict[str, dict[str, Any]],
    evd: dict[str, dict[str, Any]],
    resultats: dict[str, dict[str, Any]],
    unites: dict[str, dict[str, Any]],
) -> None:
    """A call for tenders with no contract found, and the contract its buyer probably signed
    for it (rules/registre_selection.yaml `liens`): shown as such, never in a total."""
    li = selection.rules()["liens"]
    first = {}
    by_buyer: dict[str, list[str]] = defaultdict(list)
    for u, a in affaires.items():
        if a["kind"] != "contrat":
            continue
        e0 = next((evd[i] for i in a["events"] if evd[i]["t"] == "attribution"), None)
        if e0:
            first[u] = e0
            by_buyer[a["acheteur_siren"]].append(u)
    keys = {s: boamp.cle(u["nom"]) for s, u in unites.items() if u.get("nom")}
    for aid, a in affaires.items():
        if a["kind"] != "contrat_non_retrouve":
            continue
        es = [evd[i] for i in a["events"]]
        av = next((e for e in es if e["t"] == "avis"), es[0])
        s = av.get("acheteur_siren")
        if not s or av["date"] < li["probable_depuis"]:
            continue
        tit_s, tit_k = set(), set()
        for e in es:
            res = resultats.get(e["id"]) or {}
            tit_s |= set(res.get("titulaires") or [])
            tit_k |= set(res.get("cles") or [])
        best = []
        for u in by_buyer.get(s, []):
            ce = first[u]
            if not ce["date"] or not av["date"]:
                continue
            d = _days(av["date"], ce["date"])
            if not li["probable_min_jours"] <= d <= li["probable_max_jours"]:
                continue
            holder = bool(set(ce["entreprises"]) & tit_s) or any(
                keys.get(x) in tit_k for x in ce["entreprises"]
            )
            j = selection.jaccard(av["objet"], ce["objet"], selection.STOP_PROBABLE)
            if holder or j >= li["probable_jaccard"]:
                best.append((holder, j, -d, u))
        if best:
            holder, j, _, u = max(best)
            a["contrat_probable"] = u
            a["lien_probable"] = (
                "même titulaire dans l'avis de résultat" if holder
                else f"même acheteur, objet proche ({j:.2f}), signé {_days(av['date'], first[u]['date'])} jours après l'avis"
            )  # fmt: skip
            affaires[u].setdefault("avis_probables", []).append(aid)


LOT_RX = re.compile(r"\blot\s*(?:n\s*[°o]?\s*)?(\d{1,2})\b")


def _fold(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", selection.plain(s)).strip()


def _tokens(s: Any) -> set[str]:
    f = re.sub(r"\bvideo (protection|surveillance)", r"video\1", _fold(s))
    return {w for w in f.split() if len(w) >= 3 and not w.isdigit()}


def _similar(a: Any, b: Any) -> float:
    ta, tb = _tokens(a), _tokens(b)
    return round(len(ta & tb) / len(ta | tb), 2) if ta and tb else 0.0


def _lots(
    ev: list[dict[str, Any]], affaires: dict[str, dict[str, Any]]
) -> tuple[dict[str, str], dict[str, Any]]:
    """Lots of one tender and contracts published twice (faits.py § 2): {affaire: group},
    {group: {nature, membres: [{affaire, evenement, montant}, …], …}}."""
    r = selection.rules()["lots"]

    def near(a: float | None, b: float | None) -> bool:
        return (a is not None and b is not None and a > r["montant_min"] and b > r["montant_min"]
                and abs(a - b) / min(a, b) <= r["ecart_rel"])  # fmt: skip

    def suffixes_differ(a: str, b: str) -> bool:
        return (len(a) == len(b) and a[:-2] == b[:-2] and a[-2:] != b[-2:]
                and a[-2:].isdigit() and b[-2:].isdigit())  # fmt: skip

    by_key: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for e in ev:
        if e["t"] == "attribution" and e["entreprises"]:
            by_key[(e["insee"], affaires[e["affaire"]]["acheteur_siren"], e["date"])].append(e)
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for evs in by_key.values():
        for e in evs:
            parent.setdefault(e["id"], e["id"])
        for a, b in combinations(evs, 2):
            same = sorted(a["entreprises"]) == sorted(b["entreprises"])
            if same or (
                set(a["entreprises"]) & set(b["entreprises"]) and near(a["montant"], b["montant"])
            ):
                parent[find(a["id"])] = find(b["id"])
    comps: dict[str, list[dict[str, Any]]] = defaultdict(list)
    byid = {e["id"]: e for e in ev}
    for x in parent:
        comps[find(x)].append(byid[x])
    groups: dict[str, Any] = {}
    lot_of: dict[str, str] = {}
    for members in sorted((v for v in comps.values() if len(v) > 1),
                          key=lambda v: (v[0]["insee"] or "", v[0]["date"])):  # fmt: skip
        members.sort(key=lambda e: e["affaire"])
        e0 = members[0]
        stem = f"G{e0['insee']}-{e0['date']}"
        gid = f"{stem}-{sum(1 for g in groups if g.startswith(stem + '-')) + 1}"
        info = []
        for e in members:
            ident = e["affaire"].rsplit("_", 1)[0]
            id_marche = ident[14:]
            m = LOT_RX.findall(_fold(e["objet"]))
            info.append({"affaire": e["affaire"], "evenement": e["id"], "montant": e["montant"],
                         "entreprises": e["entreprises"], "id_marche": id_marche,
                         "base": re.sub(r"(?:00)+$", "", id_marche),
                         "lot": int(m[0]) if m else None, "objet": e["objet"]})  # fmt: skip
        doublons = []
        for a, b in combinations(info, 2):
            lots_differ = (
                a["lot"] is not None and b["lot"] is not None and a["lot"] != b["lot"]
            ) or suffixes_differ(a["id_marche"], b["id_marche"])
            if not lots_differ and (near(a["montant"], b["montant"]) or a["base"] == b["base"]):
                doublons.append([a["affaire"], b["affaire"]])
        rep = {i["affaire"]: i["affaire"] for i in info}
        for a, b in doublons:
            ra, rb = rep[a], rep[b]
            for k, v in rep.items():
                if v == rb:
                    rep[k] = ra
        n_distinct = len(set(rep.values()))
        nature = "lots" if not doublons else ("doublon" if n_distinct == 1 else "lots et doublons")
        groups[gid] = {
            "insee": e0["insee"],
            "acheteur_siren": affaires[e0["affaire"]]["acheteur_siren"],
            "date": e0["date"],
            "entreprises": sorted({s for i in info for s in i["entreprises"]}),
            "nature": nature,
            "membres": [
                {k: i[k] for k in ("affaire", "evenement", "montant", "entreprises", "lot")}
                for i in info
            ],
            "somme": round(sum(i["montant"] or 0 for i in info), 2),
            "doublons": doublons,
            "origine": "national",
        }
        for i in info:
            lot_of[i["affaire"]] = gid
    return lot_of, groups
