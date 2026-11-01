"""The State's subsidies to the communes' video protection: the DGCL's national dataset
(« Projets financés par les dotations de soutien à l'investissement des collectivités
territoriales », data.gouv.fr, Licence Ouverte 2.0): DETR, DSIL, DPV and DSID, one CSV per
year since 2018, each line a project with its beneficiary's SIREN and INSEE code.

Read through data.gouv.fr's tabular API (rules/registre_sources.yaml `sources.dgcl`):
static.data.gouv.fr and files.data.gouv.fr are forbidden to robots by their robots.txt
(read on 2026-10-31), the tabular API serves the same rows. The rows whose title says
« vidéo » or « caméra » are asked, then kept when the title is about video surveillance
(`rules/registre_selection.yaml` `liens.video_notice`, or cameras); the number of cameras
only when the title gives it. The year in progress is not published by the DGCL (in July of
the next year): the coverage says « pas encore publié ».

Each subsidy becomes the pilot's event (`t` « subvention_etat »), dated by its year, its
commune by its INSEE code (an intercommunality: its SIREN, placed by construire).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from lacarte_collecte import parse_raa
from lacarte_collecte.contexte import Contexte
from lacarte_collecte.etat import Etat, Store
from lacarte_registre import selection

SOURCE = "dgcl"
CAMERAS = re.compile(parse_raa.NUMW + r"\s+(?:nouvelles?\s+|nouveaux\s+)?cameras?\b")
WORDS = re.compile(r"\bcam[eé]ras?\b|vid[eé]o\s*-?\s*(?:protection|surveillance)", re.I)


def plain(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def is_video(title: str) -> bool:
    t = plain(title or "")
    return bool(WORDS.search(t) or selection.video_notice(t))


def departement(code: Any, insee: Any = None) -> str | None:
    """The beneficiary's département: its commune's (the INSEE code) when it has one; else the
    DGCL's own code, « 011 » → « 11 », « 02A »/« 020A » → « 2A »; the DGCL files the Alsace's
    communes under « 067A » (Colmar, 68163, among them): without a commune that code says no
    département, rather than a wrong one."""
    insee = str(insee or "").strip().upper()
    if len(insee) == 5:
        return insee[:3] if insee.startswith("97") else insee[:2]
    c = str(code or "").strip().upper()
    if len(c) in (3, 4) and c.startswith("0"):
        c = c[1:]  # « 011 » → « 11 », « 020A » → « 20A »
    if c in ("2A", "20A", "2B", "20B"):
        return "2" + c[-1]
    return c if c.isdigit() and len(c) in (2, 3) else None


def event(row: dict[str, Any], year: int, dataset_url: str, mention: dict[str, str]) -> dict:
    title = re.sub(r"\s+", " ", str(row.get("intitule") or "")).strip()
    cams = [n for m in CAMERAS.finditer(plain(title).lower()) if (n := parse_raa.num(m.group(1)))]
    taux = row.get("taux")
    return {
        "id": f"dgcl-{year}-{row['__id']}",
        "t": "subvention_etat",
        "affaire": f"dgcl-{year}-{row['__id']}",
        "entreprises": [],
        "date": f"{year}-12-31",
        "date_annee": True,
        "insee": row.get("beneficiaire_code_insee") or None,
        "dep": departement(row.get("beneficiaire_dep"), row.get("beneficiaire_code_insee")),
        "beneficiaire": str(row.get("beneficiaire_nom") or "").strip(),
        "beneficiaire_siren": str(row.get("beneficiaire_siren") or "") or None,
        "type_beneficiaire": row.get("beneficiaire_type"),
        "montant": float(row["subvention"]) if row.get("subvention") is not None else None,
        "base": float(row["cout_ht"]) if row.get("cout_ht") is not None else None,
        "taux": round(float(taux) * 100, 2) if taux is not None else None,
        "cameras": float(max(cams)) if cams and 0 < max(cams) <= 2000 else None,
        "objet": selection.texte(title),
        "programme": row.get("dispositif"),
        "ref": f"DGCL, projets financés par les dotations d'investissement {year}",
        "url": dataset_url,
        "relu": False,
        "dispositif": "videoprotection",
        "mention": mention,
    }


def collect(ctx: Contexte) -> dict[str, Any]:
    f = ctx.fetcher(SOURCE)
    src = f.conf["sources"]["dgcl"]
    st = Etat(ctx.root, SOURCE)
    store = Store(ctx.root, "subventions_etat")
    ds = f.get_json(src["dataset"])
    page_url = ds.get("page") or src["dataset"]
    years: dict[int, dict[str, Any]] = {}
    for r in ds.get("resources") or []:
        m = re.search(r"(20\d\d)\.csv$", r.get("title") or "")
        if m and r.get("format") == "csv":
            years[int(m.group(1))] = r
    out: dict[str, Any] = {"source": SOURCE, "annees": {}}
    for year in sorted(years, reverse=True):
        res = years[year]
        done = st.get(str(year))
        # a file unchanged since it was read is not asked again
        if done.get("termine") and done.get("modifie") == res.get("last_modified"):
            out["annees"][year] = done.get("lignes")
            continue
        if ctx.out_of_time():
            break
        mention = {
            "source": "DGCL",
            "adresse": page_url,
            "fichier": res["title"],
            "date_fichier": (res.get("last_modified") or "")[:10],
            "licence": ds.get("license") or "",
        }
        rows: dict[int, dict[str, Any]] = {}
        for word in src["mots"]:
            page = 1
            while True:
                url = src["tabular"].format(resource=res["id"])
                params = {"intitule__contains": word, "page": page, "page_size": src["page_size"]}
                d = f.get_json(url, params, cache=False)
                for row in d.get("data") or []:
                    rows[row["__id"]] = row
                meta = d.get("meta") or {}
                if page * int(meta.get("page_size") or 1) >= int(meta.get("total") or 0):
                    break
                page += 1
        kept = [event(r, year, page_url, mention) for r in rows.values() if is_video(r["intitule"])]
        store.add(kept)
        st.save(
            str(year),
            termine=True,
            modifie=res.get("last_modified"),
            lignes=len(kept),
            demandees=len(rows),
        )
        out["annees"][year] = len(kept)
    published = max(years) if years else None
    st.save("", derniere_annee_publiee=published, annees=sorted(years))
    out["derniere_annee_publiee"] = published
    out["requetes"] = f.requests
    return out
