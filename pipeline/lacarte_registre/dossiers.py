"""The documents of one project tied into a dossier (lot R5 « les données », section 3):
a grant, the notices, the contract and its modifications, the commune's prefectoral
authorisation, the cameras mapped afterwards. The rules are rules/registre_dossiers.yaml;
each link has a level (« sur », « suggere ») and its reason in words.

The input is plain: an affaire is {id, acheteur_siren, insee, communal, natures, cameras,
contrat: {date, montant} | None, avis: [{id, date, nature, objet, valeur_estimee, cite}],
titre}; a grant {id, date, annee, siren, insee, base, montant}; an act {id, date, insee,
sous_type, titre, cameras}. explorer.py builds them from the assembled registre.

What does not tie is said too: a grant without a contract found, a contract without a
notice, a call for tenders without an award.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml

from lacarte_registre import selection
from lacarte_registre.natures import fold

SUR, SUGGERE = "sur", "suggere"


def rules(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s[:10])


def _days(a: str, b: str) -> int:
    return (_d(b) - _d(a)).days


def _ratio(num: float | None, den: float | None) -> float | None:
    return round(num / den, 2) if num and den else None


def _within(x: float | None, bounds: list[float]) -> bool:
    return x is not None and bounds[0] <= x <= bounds[1]


def _lien(de: str, vers: str, kind: str, sure: bool, regle: str, why: list[str]) -> dict[str, Any]:
    return {"de": de, "vers": vers, "type": kind, "niveau": SUR if sure else SUGGERE,
            "regle": regle, "raison": " ; ".join(why)}  # fmt: skip


# --- the notice and its contract ------------------------------------------------------------
def lien_avis(avis: dict[str, Any], aff: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any]:
    """The level of a notice's link to its affaire's contract."""
    r = conf["avis_contrat"]
    c = aff["contrat"]
    j = round(selection.jaccard(avis.get("objet"), aff.get("titre")), 2)
    ratio = _ratio(c.get("montant"), avis.get("valeur_estimee"))
    days = _days(avis["date"], c["date"])
    why = [f"même acheteur, contrat notifié {days} jours après l'avis"]
    if avis.get("cite"):
        why.append("l'avis d'attribution cite l'avis de marché")
    why.append(f"objets proches (Jaccard {j})")
    if ratio is not None:
        why.append(f"montant du contrat / valeur estimée = {ratio}")
    sure = avis.get("cite") or (
        j >= r["jaccard_sur"] and (ratio is None or _within(ratio, r["ratio_sur"]))
    )
    return _lien(avis["id"], aff["id"], "avis", bool(sure), r["id"], why)


# --- a grant and the contract it paid ---------------------------------------------------------
def _grant_window(g: dict[str, Any], r: dict[str, Any]) -> tuple[dt.date, dt.date]:
    if g.get("annee"):
        y = int(g["annee"])
        return (dt.date(y, 1, 1) - dt.timedelta(r["avant_jours"]),
                dt.date(y, 12, 31) + dt.timedelta(r["apres_jours"]))  # fmt: skip
    d = _d(g["date"])
    return d - dt.timedelta(r["avant_jours"]), d + dt.timedelta(r["apres_jours"])


def lien_subvention(
    g: dict[str, Any], affaires: Iterable[dict[str, Any]], conf: dict[str, Any]
) -> dict[str, Any] | None:
    """The contract a grant most likely paid among the buyer's affaires, or None."""
    r = conf["subvention"]
    lo, hi = _grant_window(g, r)
    cands = []
    for a in affaires:
        c = a.get("contrat")
        if not c or not c.get("date") or not lo <= _d(c["date"]) <= hi:
            continue
        if not set(a.get("natures") or ()) & set(r["natures"]):
            continue
        cands.append((a, _ratio(c.get("montant"), g.get("base"))))
    if not cands:
        return None
    coherent = [x for x in cands if _within(x[1], r["ratio"])]

    def gap(x: tuple[dict[str, Any], float | None]) -> float:
        return abs(1 - x[1]) if x[1] is not None else 9e9

    a, ratio = min(coherent or cands, key=gap)
    sure = len(cands) == 1 and _within(ratio, r["ratio_sur"])
    why = [
        "même bénéficiaire et acheteur",
        f"contrat notifié le {a['contrat']['date']}, dans la fenêtre de la subvention",
        "nature compatible (" + ", ".join(sorted(set(a["natures"]) & set(r["natures"]))) + ")",
    ]
    if ratio is not None:
        why.append(f"montant du contrat / coût subventionnable = {ratio}")
    if len(cands) > 1:
        why.append(f"{len(cands) - 1} autre(s) contrat(s) possible(s)")
    alone = len(cands) == 1 and (ratio is None or _within(ratio, r["ratio_seul"]))
    if not (sure or coherent or alone):
        return None
    return _lien(g["id"], a["id"], "subvention", sure, r["id"], why)


# --- the commune's authorisation ---------------------------------------------------------------
def _nom(s: str | None) -> str:
    """A commune's name as titles write it: folded, hyphens and apostrophes as spaces,
    « st » and « ste » as « saint » and « sainte »."""
    s = re.sub(r"[-'’]", " ", fold(s))
    s = re.sub(r"\bste\b", "sainte", re.sub(r"\bst\b", "saint", s))
    return re.sub(r"\s+", " ", s).strip()


def arrete_communal(act: dict[str, Any], nom: str | None, conf: dict[str, Any]) -> bool:
    """The act authorises the commune's own system: its title names the commune itself as
    the holder (« commune de Bonne », « mairie de Rumilly »), not as a place."""
    r = conf["arrete"]
    if act.get("sous_type") not in r["sous_types"] or not nom:
        return False
    titre = _nom(act.get("titre"))
    hit = re.search(r["titulaire"] + re.escape(_nom(nom)) + r"\b", titre)
    if hit is None or re.search(r["evenement"], titre):
        return False
    rest = titre[hit.end() :]
    return not rest.lstrip().startswith("(") or bool(re.match(r["parenthese_communale"], rest))


def lien_arrete(
    aff: dict[str, Any], acts: Iterable[dict[str, Any]], conf: dict[str, Any]
) -> dict[str, Any] | None:
    """The commune's authorisation nearest after the affaire's contract (or notice), within
    the window; acts must already be the commune's (arrete_communal)."""
    r = conf["arrete"]
    ref = (aff.get("contrat") or {}).get("date") or min(
        (v["date"] for v in aff.get("avis") or []), default=None
    )
    if not ref:
        return None
    best = None
    for act in acts:
        d = _days(ref, act["date"])
        if -r["avant_jours"] <= d <= r["apres_jours"]:
            key = (d < 0, abs(d))  # after the contract first, then the nearest
            if best is None or key < best[0]:
                best = (key, act, d)
    if best is None:
        return None
    _, act, d = best
    same = bool(aff.get("cameras")) and act.get("cameras") == aff.get("cameras")
    why = [
        "arrêté du système de la commune",
        f"{'après' if d >= 0 else 'avant'} le contrat ({abs(d)} jours)",
    ]
    if same:
        why.append(f"même nombre de caméras ({act['cameras']})")
    return _lien(act["id"], aff["id"], "arrete", same, r["id"], why)


def cameras_apres(dates: Iterable[str | None], depuis: str, conf: dict[str, Any]) -> int:
    """The cameras whose first mapping is within `apres_jours` after `depuis`."""
    n = conf["cameras"]["apres_jours"]
    return sum(1 for d in dates if d and 0 <= _days(depuis, d) <= n)


# --- the dossiers ----------------------------------------------------------------------------
def assembler(
    affaires: list[dict[str, Any]],
    subventions: list[dict[str, Any]],
    actes: list[dict[str, Any]],
    cameras: dict[str, list[str | None]],
    noms: dict[str, str],
    conf: dict[str, Any],
) -> dict[str, Any]:
    """{dossiers: [...], sans_lien: {subvention_sans_contrat, contrat_sans_avis,
    avis_sans_attribution}}; a dossier is an affaire with its links."""
    by_buyer: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for a in affaires:
        for k in {a.get("acheteur_siren"), a.get("insee") if a.get("communal") else None} - {None}:
            by_buyer[k].append(a)
    acts_by_insee: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for act in actes:
        if act.get("insee") and arrete_communal(act, noms.get(act["insee"]), conf):
            acts_by_insee[act["insee"]].append(act)
    liens: dict[str, list[dict[str, Any]]] = defaultdict(list)
    sans_contrat = []
    for g in subventions:
        pool = by_buyer.get(g.get("siren") or "") or by_buyer.get(g.get("insee") or "") or []
        link = lien_subvention(g, pool, conf)
        if link:
            liens[link["vers"]].append(link)
        else:
            sans_contrat.append(g["id"])
    dossiers = []
    sans_avis, sans_attribution = [], []
    for a in affaires:
        ls = list(liens.get(a["id"], []))
        if a.get("contrat"):
            ls += [lien_avis(v, a, conf) for v in a.get("avis") or [] if v["nature"] == "avis"]
            if not any(v["nature"] in ("avis", "resultat") for v in a.get("avis") or []):
                sans_avis.append(a["id"])
        elif any(v["nature"] == "avis" for v in a.get("avis") or []) and not any(
            v["nature"] == "resultat" for v in a.get("avis") or []
        ):
            sans_attribution.append(a["id"])
        installs = set(a.get("natures") or ()) & set(conf["arrete"]["natures"])
        if (
            a.get("communal")
            and installs
            and a.get("insee")
            and (link := lien_arrete(a, acts_by_insee.get(a["insee"], []), conf))
        ):
            ls.append(link)
            act = next(x for x in acts_by_insee[a["insee"]] if x["id"] == link["de"])
            a = {**a, "cameras_relevees_apres": cameras_apres(
                cameras.get(a["insee"], []), act["date"], conf)}  # fmt: skip
        if ls:
            dossiers.append({**a, "liens": ls})
    return {
        "dossiers": dossiers,
        "sans_lien": {
            "subvention_sans_contrat": sans_contrat,
            "contrat_sans_avis": sans_avis,
            "avis_sans_attribution": sans_attribution,
        },
    }
