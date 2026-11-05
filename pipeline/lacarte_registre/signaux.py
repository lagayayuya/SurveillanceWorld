"""Facts worth a second look across France (lot R5 « les données », section 5): a single
offer, modifications over 15 %, a procedure without publicity, amounts grouped just under a
threshold, a contract notified soon after its notice, a grant without a contract found. The
rules are rules/registre_signaux.yaml. Exploration only: nothing here is served.

Each finding is {signal, id, fait, regle, document, a_verifier}: the fact in neutral words,
the rule that found it, the document that shows it, and the ordinary reasons that produce
it which apply here. The input is plain, built by explorer.py: a contract {id, acheteur,
acheteur_nom, date, montant, offres, accord_cadre (the framework itself), subsequent (a
contract under a framework), natures, avenant: {ecart_pct, ambigu}, procedure, avis_jours,
avis_sur, avec_avis, titre, document}; a grant {id, beneficiaire, date, montant, base,
programme, document}.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

TRAVAUX = "travaux_genie_civil"


def rules(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def seuil(kind: str, date: str | None, travaux: bool, conf: dict[str, Any]) -> float | None:
    """The threshold `kind` in force on `date` (the last step not after it)."""
    if not date:
        return None
    col = "travaux" if travaux else "fournitures_services"
    steps = [s for s in conf["seuils"][kind] if s["depuis"] <= date[:10]]
    return steps[-1][col] if steps else None


def _euros(v: float | None) -> str:
    return f"{round(v):,} €".replace(",", " ") if v is not None else "montant non publié"


def _hit(signal: str, c: dict[str, Any], fait: str, conf: dict[str, Any],
         a_verifier: list[str] | None = None) -> dict[str, Any]:  # fmt: skip
    return {
        "signal": signal,
        "id": c["id"],
        "acheteur": c.get("acheteur_nom") or c.get("acheteur"),
        "date": c.get("date"),
        "montant": c.get("montant"),
        "titre": c.get("titre"),
        "fait": fait,
        "regle": conf["signaux"][signal]["id"],
        "document": c.get("document"),
        "a_verifier": a_verifier or [],
    }


def _maintenance(c: dict[str, Any]) -> bool:
    return "maintenance" in (c.get("natures") or [])


# --- one contract at a time ----------------------------------------------------------------------
def offre_unique(c: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any] | None:
    if c.get("offres") != 1:
        return None
    fp = conf["signaux"]["offre_unique"]["faux_positifs"]
    why = ([fp[0]] if c.get("subsequent") else []) + ([fp[1]] if _maintenance(c) else [])
    fait = f"Contrat de {_euros(c.get('montant'))} attribué sur une seule offre reçue."
    return _hit("offre_unique", c, fait, conf, why)


def avenant(c: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any] | None:
    a = c.get("avenant") or {}
    pct = a.get("ecart_pct")
    if pct is None or a.get("ambigu") or pct <= conf["signaux"]["avenant"]["seuil_pct"]:
        return None
    fp = conf["signaux"]["avenant"]["faux_positifs"]
    fait = (f"Montant porté de {_euros(a.get('initial'))} à {_euros(a.get('final'))} par "
            f"{a.get('n')} modification(s), soit +{pct} %.")  # fmt: skip
    return _hit("avenant", c, fait, conf, [fp[1]] if c.get("accord_cadre") else [])


def sans_publicite(c: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any] | None:
    p = c.get("procedure")
    r = conf["signaux"]["sans_publicite"]
    if not p or not any(re.search(w, p, re.I) for w in r["procedures"]):
        return None
    why = []
    low = seuil("dispense", c.get("date"), TRAVAUX in (c.get("natures") or []), conf)
    if c.get("montant") is not None and low and c["montant"] < low:
        why.append(r["faux_positifs"][3])
    return _hit("sans_publicite", c, f"Procédure déclarée : « {p} ».", conf, why)


def delai_court(c: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any] | None:
    d = c.get("avis_jours")
    r = conf["signaux"]["delai_court"]
    if d is None or d < 0:
        return None
    high = seuil("formalise", c.get("date"), TRAVAUX in (c.get("natures") or []), conf)
    formal = bool(high and (c.get("montant") or 0) >= high)
    if d >= (r["min_jours_formalise"] if formal else r["min_jours"]):
        return None
    fait = f"Contrat notifié {d} jours après la publication de son avis d'appel à la concurrence."
    why = [r["faux_positifs"][1]] if c.get("subsequent") else []
    if not c.get("avis_sur"):
        why.insert(0, r["faux_positifs"][0])
    return _hit("delai_court", c, fait, conf, why)


def sans_avis(c: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any] | None:
    if c.get("avis_jours") is not None or c.get("avec_avis"):
        return None
    s = seuil("publicite", c.get("date"), TRAVAUX in (c.get("natures") or []), conf)
    if not s or (c.get("montant") or 0) < s:
        return None
    fp = conf["signaux"]["sans_avis_publicite"]["faux_positifs"]
    fait = (f"Contrat de {_euros(c['montant'])}, au-dessus du seuil de publicité "
            f"({_euros(s)}), sans avis trouvé au BOAMP.")  # fmt: skip
    return _hit("sans_avis_publicite", c, fait, conf, [fp[1]] if c.get("subsequent") else [])


# --- patterns of one buyer -----------------------------------------------------------------------
def sous_seuil(contrats: list[dict[str, Any]], conf: dict[str, Any]) -> list[dict[str, Any]]:
    """A buyer's year with at least `min_contrats` amounts within the band under a
    threshold and more under than over it: each of those contracts is a finding."""
    r = conf["signaux"]["sous_seuil"]
    band = r["bande_pct"] / 100
    groups: dict[tuple[str, str, str], dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: {"sous": [], "sur": []}
    )
    for c in contrats:
        m, date = c.get("montant"), c.get("date")
        if not m or not date or not c.get("acheteur"):
            continue
        for kind in r["seuils"]:
            s = seuil(kind, date, TRAVAUX in (c.get("natures") or []), conf)
            if not s:
                continue
            key = (c["acheteur"], date[:4], kind)
            if s * (1 - band) <= m < s:
                groups[key]["sous"].append({**c, "_seuil": s})
            elif s <= m < s * (1 + band):
                groups[key]["sur"].append(c)
    out = []
    for (_, year, kind), g in sorted(groups.items()):
        if len(g["sous"]) < r["min_contrats"] or len(g["sous"]) <= len(g["sur"]):
            continue
        for c in g["sous"]:
            fait = (f"{len(g['sous'])} contrats de cet acheteur en {year} entre "
                    f"{_euros(c['_seuil'] * (1 - band))} et {_euros(c['_seuil'])} (seuil de "
                    f"{'publicité' if kind == 'publicite' else 'procédure formalisée'}) ; "
                    f"{len(g['sur'])} juste au-dessus.")  # fmt: skip
            out.append(_hit("sous_seuil", c, fait, conf, [r["faux_positifs"][0]]))
    return out


def subvention_sans_contrat(g: dict[str, Any], conf: dict[str, Any]) -> dict[str, Any]:
    c = {**g, "acheteur_nom": g.get("beneficiaire"), "titre": g.get("programme")}
    prog = g.get("programme") or "programme non dit"
    fait = (f"Subvention de {_euros(g.get('montant'))} ({prog}) sans contrat du bénéficiaire "
            "trouvé dans la fenêtre de la règle.")  # fmt: skip
    fp = conf["signaux"]["subvention_sans_contrat"]["faux_positifs"]
    why = [fp[0]] if (g.get("base") or 0) < 40000 else []
    return _hit("subvention_sans_contrat", c, fait, conf, why)


def trouver(contrats: list[dict[str, Any]], subventions: list[dict[str, Any]],
            conf: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:  # fmt: skip
    """{signal: findings}, each signal's findings in date order."""
    out: dict[str, list[dict[str, Any]]] = {k: [] for k in conf["signaux"]}
    for c in contrats:
        for f in (offre_unique, avenant, sans_publicite, delai_court, sans_avis):
            if hit := f(c, conf):
                out[hit["signal"]].append(hit)
    out["sous_seuil"] = sous_seuil(contrats, conf)
    out["subvention_sans_contrat"] = [subvention_sans_contrat(g, conf) for g in subventions]
    for v in out.values():
        v.sort(key=lambda h: (h.get("date") or "", h["id"]))
    return out
