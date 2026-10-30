"""SIRENE (INSEE): what the registre may say of the companies and buyers it meets.

Only the SIRENs the registre meets are kept (the DECP's holders and buyers, the BOAMP's
holders): their legal category (`nature`, catégorie juridique), their size (`categorie`:
PME, ETI, GE), their activity (NAF), whether they are active, and a name for a legal person
only. A sole trader (nature 1000, a natural person) is never named: `ei` true, no name,
and the build masks its SIREN everywhere (regles.masquer_ei).

Where (rules/registre_sources.yaml `sources.sirene`): the monthly stock of legal units
(Parquet, ~714 MB), downloaded and read by batches of rows when its host's robots.txt allows
it; else the API Recherche d'entreprises, one request per SIREN not yet known: its answers
are kept (brut/sirene/unites.jsonl) and the next collections ask only for the new SIRENs.

Out: <root>/national/sirene.json {"version": …, "unites": {siren: {nature, categorie, naf,
actif, ei, nom?}}}.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from lacarte_registre import fetch

SOURCE = "sirene"
COLUMNS = (
    "siren",
    "categorieJuridiqueUniteLegale",
    "categorieEntreprise",
    "denominationUniteLegale",
    "activitePrincipaleUniteLegale",
    "etatAdministratifUniteLegale",
)


def unite(
    nature: Any, categorie: Any, naf: Any, actif: bool, nom: Any, ei_dit: bool = False
) -> dict[str, Any]:
    """A unit as the registre keeps it. Named only when its legal category says a legal person:
    a category 1xxx (1000: entrepreneur individuel, a natural person), one the source says is a
    sole trader (`ei_dit`), or no category at all (the API gives units known from the RNE alone
    so, a person's name as their name) is a possible natural person, never named."""
    nature = str(nature or "")
    ei = not nature or nature.startswith("1") or ei_dit
    out = {"nature": nature or None, "categorie": categorie or None, "naf": naf or None,
           "actif": actif, "ei": ei}  # fmt: skip
    if not nature:
        out["nature_inconnue"] = True
    if not ei and nom:
        out["nom"] = str(nom)
    return out


def from_stock(path: Path, sirens: set[str]) -> Iterator[tuple[str, dict[str, Any]]]:
    import pyarrow.parquet as pq

    pf = pq.ParquetFile(path)
    cols = [c for c in COLUMNS if c in pf.schema_arrow.names]
    for b in pf.iter_batches(batch_size=200_000, columns=cols):
        for r in b.to_pylist():
            s = str(r.get("siren") or "")
            if s in sirens:
                yield (
                    s,
                    unite(
                        r.get("categorieJuridiqueUniteLegale"),
                        r.get("categorieEntreprise"),
                        r.get("activitePrincipaleUniteLegale"),
                        r.get("etatAdministratifUniteLegale") == "A",
                        r.get("denominationUniteLegale"),
                    ),
                )


def from_api(answer: dict[str, Any], siren: str) -> dict[str, Any] | None:
    """The API Recherche d'entreprises' answer to `?q=<siren>`: that unit, or None."""
    for x in answer.get("results") or []:
        if x.get("siren") == siren:
            return unite(
                x.get("nature_juridique"),
                x.get("categorie_entreprise"),
                x.get("activite_principale"),
                x.get("etat_administratif") == "A",
                x.get("nom_raison_sociale") or x.get("nom_complet"),
                bool((x.get("complements") or {}).get("est_entrepreneur_individuel")),
            )
    return {"introuvable": True}


def _kept(f: fetch.Fetcher) -> dict[str, dict[str, Any]]:
    path = f.dir / "unites.jsonl"
    out: dict[str, dict[str, Any]] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                out[r["siren"]] = r["unite"]
    return out


def _stock_resource(f: fetch.Fetcher) -> dict[str, Any] | None:
    src = f.conf["sources"][SOURCE]
    page = f.get_json(src["dataset"], cache=False)
    for r in page.get("data") or page.get("resources") or []:
        if r.get("format") == "parquet" and (r.get("title") or "").startswith(src["title_prefix"]):
            return {"url": r["url"], "modifie": (r.get("last_modified") or "")[:10]}
    return None


def collect(f: fetch.Fetcher, out_dir: Path, sirens: Iterable[str]) -> dict[str, Any]:
    wanted = {s for s in sirens if len(s) == 9 and s.isdigit()}
    kept = _kept(f)
    mode, version = "api", None
    res = _stock_resource(f)
    if res and f.allowed(res["url"])[0]:
        mode, version = "stock", res["modifie"]
        dest = f.dir / "StockUniteLegale.parquet"
        f.download(res["url"], dest)
        kept = dict(from_stock(dest, wanted))
    else:
        if res:
            f.save_state(note_stock=f"{res['url']} : {f.allowed(res['url'])[1]}")
        api = f.conf["sources"][SOURCE]["api"]
        todo = sorted(wanted - set(kept))
        with (f.dir / "unites.jsonl").open("a", encoding="utf-8") as out:
            for i, s in enumerate(todo):
                u = from_api(f.get_json(api, {"q": s}, cache=False), s)
                kept[s] = u
                out.write(json.dumps({"siren": s, "unite": u}, ensure_ascii=False) + "\n")
                out.flush()
                if i % 50 == 0:
                    f.save_state(statut="en_cours", curseur={"faits": i, "restant": len(todo) - i})
    unites = {s: kept[s] for s in sorted(wanted) if s in kept}
    out = out_dir / "sirene.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(".sirene.json.tmp")
    tmp.write_text(json.dumps({"version": version, "mode": mode, "unites": unites},
                              ensure_ascii=False), "utf-8")  # fmt: skip
    tmp.replace(out)
    return {"source": SOURCE, "mode": mode, "version": version, "unites": len(unites),
            "sans_reponse": len(wanted) - len(unites), "requetes": f.requests}  # fmt: skip
