"""The fields already collected and not yet used, read by rules, no model (lot R5 « les
données », section 1): each source's records as flat rows, the share of rows where a field
is filled, by year and by département, and the aberrant values (rules/registre_champs.yaml).

Sources, as collected (nothing here asks the network):
- contracts: <root>/national/decp.jsonl.gz (decp.py): offers received, duration, CPV,
  framework agreement, amounts of the initial contract and of its modifications;
- notices: <root>/collecte/avis.jsonl.gz (the DILA's archives, boamp.notice): estimated value,
  awarded amount and date, holders;
- companies: <root>/national/sirene.json (sirene.py): NAF, category, active, sole trader;
- grants: <root>/collecte/subventions_etat.jsonl.gz (dgcl.py): eligible cost, rate, grant.

A field the source does not carry (a DECP procedure, a notice's lots or criteria, a company's
creation date) is not here: champs.md says which and what reading them would take.
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import yaml

Row = dict[str, Any]


def rules(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as g:
        for line in g:
            yield json.loads(line)


def _num(x: Any) -> float | None:
    try:
        return None if x is None or x == "" else float(x)
    except (TypeError, ValueError):
        return None


def _day(x: Any) -> str | None:
    s = str(x or "")[:10]
    try:
        dt.date.fromisoformat(s)
    except ValueError:
        return None
    return s


# --- what a value is worth (rules/registre_champs.yaml) ------------------------------------
def montant_ok(v: float | None, conf: dict[str, Any]) -> float | None:
    """The amount, or None when it is a placeholder (at or under `min_exclu`)."""
    return None if v is None or v <= conf["montant"]["min_exclu"] else v


def offres_ok(v: Any, conf: dict[str, Any]) -> int | None:
    n = _num(v)
    r = conf["offres"]
    return int(n) if n is not None and r["min"] <= n <= r["max"] else None


def duree_ok(v: Any, conf: dict[str, Any]) -> float | None:
    n = _num(v)
    r = conf["duree_mois"]
    return n if n is not None and r["min"] <= n <= r["max"] else None


def date_ok(v: Any, conf: dict[str, Any], today: str) -> str | None:
    d = _day(v)
    return d if d and conf["date"]["min"] <= d <= today else None


def avenant(lignes: list[dict[str, Any]], conf: dict[str, Any]) -> dict[str, Any] | None:
    """A contract's modifications read against its initial amount: {n, initial, final,
    ecart_pct, ambigu}; None without a modification. `final` is the last modification's
    amount when every one is at or above the initial amount (a total that grows); otherwise
    the reading is ambiguous (a decrease, or a delta written instead of a total) and gives
    no gap."""
    mods = sorted(lignes, key=lambda x: int(x.get("modification_id") or 0))
    if len(mods) < 2:
        return None
    first = montant_ok(_num(mods[0].get("montant")), conf)
    later = [montant_ok(_num(m.get("montant")), conf) for m in mods[1:]]
    later = [v for v in later if v is not None]
    out = {"n": len(mods) - 1, "initial": first, "final": None, "ecart_pct": None, "ambigu": False}
    if first is None or not later:
        return out
    if any(v < first for v in later):
        out["ambigu"] = True
        return out
    out["final"] = later[-1]
    out["ecart_pct"] = round((later[-1] / first - 1) * 100, 1)
    return out


# --- each source as rows ------------------------------------------------------------------
def contrats(records: Iterable[dict[str, Any]], conf: dict[str, Any], today: str) -> list[Row]:
    out = []
    for c in records:
        lignes = c.get("lignes") or []
        first = min(lignes, key=lambda x: int(x.get("modification_id") or 0)) if lignes else {}
        day = date_ok(first.get("dateNotification"), conf, today)
        tech = (c.get("techniques") or "").lower()
        out.append({
            "id": c["uid"],
            "annee": day[:4] if day else None,
            "dep": c.get("acheteur_departement_code"),
            "date": day,
            "offres": offres_ok(c.get("offres"), conf),
            "duree": duree_ok(first.get("dureeMois"), conf),
            "cpv": c.get("codeCPV") or None,
            # a framework agreement says so in its technique, or a subsequent contract names one
            "accord_cadre": True if "accord-cadre" in tech or c.get("idAccordCadre") else (
                False if tech else None),
            "montant": montant_ok(_num(first.get("montant")), conf),
            "titulaires": len(first.get("titulaires") or []) or None,
            "avenant": avenant(lignes, conf),
            "_brut": {"offres": c.get("offres"), "duree": first.get("dureeMois"),
                      "montant": first.get("montant"), "date": first.get("dateNotification")},
        })  # fmt: skip
    return out


def avis(records: Iterable[dict[str, Any]], conf: dict[str, Any], today: str) -> list[Row]:
    out = []
    for a in records:
        r = a.get("resultat") or {}
        day = date_ok(a.get("date"), conf, today)
        att = date_ok(r.get("date_attribution"), conf, today)
        if att and day and att > day:
            att = None
        out.append({
            "id": a["idweb"],
            "nature": a.get("nature"),
            "annee": day[:4] if day else None,
            "dep": (a.get("departements") or [None])[0],
            "date": day,
            "valeur_estimee": montant_ok(_num(r.get("valeur_estimee")), conf),
            "montant_attribue": montant_ok(_num(r.get("montant_attribue")), conf),
            "date_attribution": att,
            "titulaires": len(r.get("titulaires") or []) or len(r.get("cles") or []) or None,
            "lieu": (a.get("lieu") or {}).get("cp") or None,
            "cpv": (a.get("cpv") or [None])[0],
            "_brut": {"valeur_estimee": r.get("valeur_estimee"),
                      "montant_attribue": r.get("montant_attribue"),
                      "date_attribution": r.get("date_attribution")},
        })  # fmt: skip
    return out


def entreprises(unites: dict[str, dict[str, Any]]) -> list[Row]:
    out = []
    for siren, u in unites.items():
        out.append(
            {
                "id": siren,
                "annee": None,
                "dep": None,
                "trouve": not u.get("introuvable"),
                "naf": u.get("naf"),
                "categorie": u.get("categorie"),
                "actif": u.get("actif"),
                "ei": u.get("ei"),
            }
        )
    return out


def subventions(records: Iterable[dict[str, Any]], conf: dict[str, Any]) -> list[Row]:
    out = []
    for s in records:
        taux = _num(s.get("taux"))
        out.append(
            {
                "id": s["id"],
                "annee": str(s.get("date") or "")[:4] or None,
                "dep": s.get("dep"),
                "base": montant_ok(_num(s.get("base")), conf),
                "taux": taux,
                "montant": montant_ok(_num(s.get("montant")), conf),
                "programme": s.get("programme"),
                "taux_au_dela": taux is not None and taux > conf["taux"]["max"],
            }
        )
    return out


def charger(root: Path, conf: dict[str, Any], today: str) -> dict[str, list[Row]]:
    sirene = json.loads((root / "national" / "sirene.json").read_text(encoding="utf-8"))
    return {
        "contrats": contrats(_jsonl(root / "national" / "decp.jsonl.gz"), conf, today),
        "avis": avis(_jsonl(root / "collecte" / "avis.jsonl.gz"), conf, today),
        "entreprises": entreprises(sirene["unites"]),
        "subventions": subventions(_jsonl(root / "collecte" / "subventions_etat.jsonl.gz"), conf),
    }


# --- fill rates and aberrations -----------------------------------------------------------
def remplissage(rows: list[Row], fields: Iterable[str]) -> dict[str, Any]:
    """{field: {n, rempli, taux, annee: {y: taux}, dep: {d: taux}}}: a field is filled when
    its read value is not None (an aberrant value read as absent is not filled)."""
    out = {}
    for f in fields:
        tot, by_y, by_d = Counter(), defaultdict(Counter), defaultdict(Counter)
        for r in rows:
            ok = r.get(f) is not None
            tot[ok] += 1
            by_y[r.get("annee") or "?"][ok] += 1
            by_d[r.get("dep") or "?"][ok] += 1

        def rate(c: Counter) -> float:
            return round(c[True] / (c[True] + c[False]), 3) if c else 0.0

        out[f] = {
            "n": tot[True] + tot[False],
            "rempli": tot[True],
            "taux": rate(tot),
            "annee": {k: rate(v) for k, v in sorted(by_y.items())},
            "dep": {k: rate(v) for k, v in sorted(by_d.items())},
        }
    return out


def aberrations(rows: list[Row], conf: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """The raw values a rule set aside or flagged, by field: {field: [{id, brut, regle,
    action}]}."""
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    m = conf["montant"]

    def add(f: str, r: Row, brut: Any, rule: str, action: str) -> None:
        out[f].append({"id": r["id"], "brut": brut, "regle": conf[rule]["id"], "action": action})

    for r in rows:
        brut = r.get("_brut") or {}
        for f in ("montant", "valeur_estimee", "montant_attribue"):
            v = _num(brut.get(f))
            if v is not None and v <= m["min_exclu"]:
                add(f, r, v, "montant", m["action_min"])
            elif v is not None and v > m["max_signale"]:
                add(f, r, v, "montant", m["action_max"])
        for f, rule in (("offres", "offres"), ("duree", "duree_mois")):
            if brut.get(f) is not None and r.get(f) is None:
                add(f, r, brut[f], rule, conf[rule]["action"])
        for f in ("date", "date_attribution"):
            if brut.get(f) and r.get(f) is None:
                add(f, r, brut[f], "date", conf["date"]["action"])
        if r.get("taux_au_dela"):
            add("taux", r, r["taux"], "taux", conf["taux"]["action"])
    return dict(out)


def sans_brut(rows: list[Row]) -> list[Row]:
    return [{k: v for k, v in r.items() if k != "_brut"} for r in rows]
