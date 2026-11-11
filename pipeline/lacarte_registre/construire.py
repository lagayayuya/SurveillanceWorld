"""`lacarte-registre construire`: the registre's site files from the imported pilot.

First the corrections accepted in /revue, exported from the database (exporter.py: over ssh,
DEPLOY_TARGET by default, or --dsn) into data/registre/corrections.yaml: a build never reads
an export older than the database's last decision (owner's answer on lot R1b). Without the
database it stops, unless --sans-corrections: then it ignores any older export and its mark
(data/registre/construction.json, not served) says so, and `lacarte-registre verifier`, which
the deploy runs, refuses to send it.

Reads data/registre/pilote/ (importer.py) and, when collected, data/registre/national/
(`lacarte-registre collecter`: the DECP, the BOAMP, SIRENE and the communes of France,
assembled by national.py and merged with the pilot by fusion.py: a document in both is the
national one), rules/registre_corrections.yaml then that export,
and rules/registre_couverture.yaml; flags every document (regles.py), measures the coverage
(couverture.py) and writes each page's file (fermetures.py) and the commune maps' layers into
data/registre/site/, served
at /data/registre/. It holds the machine's lock (lacarte.lock), as `lacarte build` does, and
writes in a temporary folder renamed at the end: an interrupted run leaves the previous
site as it was.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any

import yaml

import lacarte_registre as registre
from lacarte import lock
from lacarte_registre import (
    apercu,
    collecte,
    comptes,
    couverture,
    departements,
    exporter,
    fermetures,
    fusion,
    geo,
    lecture_drones,
    national,
    natures,
    recherche,
    regles,
    sortie,
    textes,
)

MARK = "construction.json"


class NoDatabase(Exception):
    """construire asked without a way to the database's corrections."""


def run(
    root: Path | None = None, rules: Path | None = None, accepted: bool = True
) -> dict[str, Any]:
    """Build <root>/site from <root>/pilote and, unless `accepted` is false, the corrections
    exported beside it; returns a summary of what was written."""
    root = root or registre.ROOT
    rules = rules or registre.RULES
    pilote = regles.charger(root / "pilote")
    nat = None
    if (root / "national" / "decp.jsonl.gz").is_file():
        # the national public procurement (lacarte-registre collecter), merged first
        nat = national.assembler(root, rules=rules)
        pilote, merged = fusion.fusionner(pilote, nat)
    col = collecte.couverture(root, rules)
    col_summary = None
    if col is not None:
        # the national collection (lacarte_collecte): the DGCL's subsidies and the acts
        pilote, col_summary = collecte.fusionner(pilote, root, rules)
        if nat:
            nat["sources"]["boamp"] = {"collecte_le": col["le"], "departements": None}
    export = root / exporter.FILE
    corr = regles.corrections(rules / "registre_corrections.yaml",
                              *([export] if accepted and export.is_file() else []))  # fmt: skip
    # the titles and objets their publishers garbled (rules/registre_textes.yaml), mended
    # before the corrections, which may set them again
    fix = textes.regles(rules)
    repaired = {
        "documents": textes.appliquer(pilote.reg["evenements"], fix),
        "affaires": textes.appliquer(list(pilote.reg["affaires"].values()), fix),
    }
    # a person a title or an objet names, masked (rule:registre_textes@1:personnes)
    who = textes.personnes(rules)
    repaired["personnes"] = textes.masquer(
        [*pilote.reg["evenements"], *pilote.reg["affaires"].values()], who
    )
    # what each contract and notice buys (rules/registre_natures.yaml): its objet (the
    # pilot's documents have none: their affaire's title), then its CPV codes
    rn = natures.load(rules / "registre_natures.yaml")
    titles = {k: a.get("titre") for k, a in pilote.reg["affaires"].items()}
    for e in pilote.reg["evenements"]:
        if e["t"] in natures.TYPES:
            text = e.get("objet") or titles.get(e.get("affaire") or "")
            e["natures"] = natures.classer(text, e.get("cpv") or [], rn)["natures"]
    # every document's département in the COG form, an unknown code dropped (departements.py)
    # the 101 départements of the régions' rule (registre_chiffres.yaml), the overseas
    # collectivities the commune references hold
    chiffres_conf = yaml.safe_load((rules / "registre_chiffres.yaml").read_text("utf-8"))
    officiels = {d for r in chiffres_conf["regions"].values() for d in r["deps"]}
    officiels |= {c.get("dep") for c in pilote.reg["communes"].values() if c.get("dep")}
    ref = root / "national" / "communes.json"  # the national reference, every commune of France
    if ref.is_file():
        officiels |= {
            c.get("dep") for c in json.loads(ref.read_text("utf-8"))["communes"].values()
        } - {None}
    deps_fixed = departements.normaliser(
        [*pilote.reg["evenements"], *pilote.reg["affaires"].values()], officiels
    )
    # the pilot's drone acts, read on their title alone (rules/registre_drones.yaml `aeronef`)
    for e in pilote.reg["evenements"]:
        if e["t"] == "arrete_drone" and "aeronef" not in e:
            e["aeronef"] = lecture_drones.aeronef([e.get("titre")], rules)
    reg = regles.appliquer(pilote, corr)
    # where a drone act flies, from its sector (rules/registre_drones.yaml `secteur`): the
    # communes of its département and of the police prefecture's, by their folded names
    noms: dict[str, dict[str, str]] = {}
    for k, c in reg.communes.items():
        noms.setdefault(c.get("dep") or "", {})[lecture_drones.plie(c.get("nom"))] = k
    pp = {n: k for d in ("75", "92", "93", "94") for n, k in noms.get(d, {}).items()}
    villes = {"75056": "paris", "69123": "lyon", "13055": "marseille"}
    libelles = {k: c.get("nom") for k, c in reg.communes.items() if c.get("nom")}
    for e in reg.evenements:
        if e["t"] == "arrete_drone":  # no sector read: « non_lu »
            here = (
                pp if e.get("dep") in ("75", "92", "93", "94") else noms.get(e.get("dep") or "", {})
            )
            # the act's words never served: the place alone (an event may name a person)
            words = e.pop("secteur", None)
            e.update(
                lecture_drones.situer(
                    words, here, rules, villes.get(e.get("insee") or ""), libelles
                )
            )
    # an act of several communes has a copy in each other's list (regles.appliquer, made
    # before): the copy takes its original's place, never its raw words (B, 2026-11-10:
    # 75-2025-10-23-00040 placed in Aubervilliers' file, raw in Pantin's)
    lecture_drones.aux_copies(reg.by_insee, reg.by_id)
    # what each act's and grant's `date` is (B, 2026-11-10), where the collection has not
    # said it: the pilot's acts are dated by their own day (their id's, « 69-2026-01-07-… »),
    # a dotation by its year (`date_annee`, 31 December), a region's grant by its vote (the
    # permanent commission's « délibération CP… » day)
    for e in [*reg.evenements, *(c for rows in reg.by_insee.values() for c in rows)]:
        if "date_est" in e or not e.get("date"):
            continue
        if e["t"].startswith("arrete"):
            e["date_est"] = "acte"
        elif e["t"].startswith("subvention"):
            e["date_est"] = "annee" if e.get("date_annee") else "vote"
    conf = couverture.rules(rules / "registre_couverture.yaml")
    # where each decree comes from (its own département's collection, a zone préfecture…)
    couverture.provenances(reg, conf, col)
    cov = couverture.build(reg, conf, nat["sources"] if nat else None, col)
    maps = sorted((root / "pilote" / "carte").glob("*.json"))
    contours = {m.stem: json.loads(m.read_text("utf-8")).get("contour") for m in maps}
    entiere = yaml.safe_load((rules / "registre_drones.yaml").read_text("utf-8"))
    # a grant's funder by its reference's prefix (rules/registre_couverture.yaml)
    funders = {s["ref_prefix"]: s["financeur_siren"] for s in conf["sources"]
               if s.get("financeur_siren")}  # fmt: skip
    ctx = fermetures.Context(
        reg, cov, couverture.pilot_departements(conf), frozenset(m.stem for m in maps),
        contours, entiere["commune_entiere"]["part"], funders,
    )  # fmt: skip
    summary: dict[str, Any] = {}

    def write(tmp: Path) -> None:
        def put(rel: str, data: dict[str, Any]) -> None:
            sortie.dump(tmp / rel, data)

        summary["fichiers"] = fermetures.write_all(ctx, tmp, put)
        # the records' preview images, drawn again only when what they show changed
        summary["apercus"] = apercu.write(ctx.apercus, tmp, root / "apercu-cache")
        # the tilted commune maps' layers, as imported (OpenStreetMap, ODbL)
        # its count said as the register says it (comptes.carte, the map's), one source per
        # figure; `n_couche` the points the layer draws (its own outline: Lyon 2 117 / 2 113)
        for path in maps:
            layer = json.loads(path.read_text("utf-8"))
            n = comptes.carte(reg, path.stem)
            if n is not None and layer.get("n") is not None:
                layer["n_couche"], layer["n"] = layer["n"], n
            put(f"carte/{path.name}", layer)
        summary["fichiers"]["carte"] = len(maps)
        # France's and its départements' outlines for the home's map (IGN, data/src): written
        # when the layers are on this machine
        outlines = geo.build(root, rules)
        if outlines:
            put("geo/departements.json", outlines)
        summary["fichiers"]["geo"] = int(outlines is not None)
        # each département's communes (the département's page, a commune's neighbours)
        n = 0
        for dep, f in geo.communes_par_departement(root, rules):
            put(f"geo/communes-{dep}.json", f)
            n += 1
        summary["fichiers"]["geo_communes"] = n

    sortie.replace_dir(root / "site", write)
    # the search's rows, for the database (migration 027), beside the site: not served
    recherche.write_tsv(root / "recherche.tsv.gz", recherche.rows(ctx))
    summary["documents"] = len(reg.evenements)
    # the buyers with a fiche that no source names (the DECP, the reference, SIRENE)
    summary["acheteurs_sans_nom"] = ctx.acheteurs_sans_nom()
    # the names served without a reference to a record, by type and reason (refs.py)
    summary["sans_reference"] = {
        f"{k}/{why}": n for (k, why), n in sorted(ctx.manquants.items()) if n
    }
    if nat:
        summary["fusion"] = merged
    if col_summary:
        summary["collecte"] = col_summary
    summary["textes_repares"] = repaired
    summary["departements"] = deps_fixed
    summary["non_lus"] = cov["non_lus"]
    summary["maj"] = cov["maj"]
    return summary


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(
    root: Path | None = None,
    *,
    dsn: str | None = None,
    ssh: str | None = None,
    sans_corrections: bool = False,
) -> dict[str, Any]:
    """The command, under the machine's lock: the database's accepted corrections exported
    (exporter.export), then the build, then its mark; `sans_corrections` builds without them."""
    root = root or registre.ROOT
    if not sans_corrections and not (dsn or ssh):
        raise NoDatabase(
            "construire exports the corrections accepted in /revue first: give --ssh HOST "
            "(or DEPLOY_TARGET) or --dsn DSN; --sans-corrections builds without them, and the "
            "deploy refuses such a build"
        )
    with lock.held("lacarte-registre construire"):
        export = None if sans_corrections else exporter.export(dsn, ssh, root)
        summary = run(root, accepted=export is not None)
        mark = {
            "corrections": "base" if export else "sans",
            "exportees": export["corrections"] if export else None,
            "le": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "index_sha256": _sha256(root / "site" / "index.json"),
            "recherche_sha256": _sha256(root / "recherche.tsv.gz"),
        }
        sortie.dump(root / MARK, mark)
        summary["corrections"] = mark
        return summary


def verifier(root: Path | None = None) -> str | None:
    """Why the built site may not be deployed (`lacarte-registre verifier`, deploy.sh), or
    None: built by construire with the database's corrections, and not since replaced."""
    root = root or registre.ROOT
    path = root / MARK
    if not path.is_file():
        return f"no {MARK}: build the register with `lacarte-registre construire`"
    mark = json.loads(path.read_text(encoding="utf-8"))
    if mark.get("corrections") != "base":
        return "built --sans-corrections: build it again with the database's corrections"
    index = root / "site" / "index.json"
    if not index.is_file() or _sha256(index) != mark.get("index_sha256"):
        return "the site is not the one the last construire built: build it again"
    rows = root / "recherche.tsv.gz"
    if not rows.is_file() or _sha256(rows) != mark.get("recherche_sha256"):
        return "the search's rows are not the last construire's: build it again"
    return None
