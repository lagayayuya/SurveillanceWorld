"""construire with the national collection (lacarte_collecte's derived files, made here from the
recorded fixtures): the DILA's notices with their mention, the DGCL's subsidies in place of the
pilot's years they publish, the acts published only above their threshold, the others listed
« non lu », an erased notice nowhere, and Attrap named in no file the site serves."""

from __future__ import annotations

import datetime as dt
import gzip
import json
import shutil
from pathlib import Path

import pytest
from collecte_fake import COMMUNES, FIX

import lacarte_registre as registre
from lacarte_collecte import dgcl, dila, parse_raa
from lacarte_registre import construire, decp, importer

PILOT = Path(__file__).parent / "fixtures" / "registre"
NATIONAL = PILOT / "national"
KINDS = parse_raa.types(registre.RULES / "collecte_actes.yaml")


def _gz(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as g:
        for x in items:
            g.write(json.dumps(x, ensure_ascii=False) + "\n")


def acts_of(name: str, admin: str, dep: str) -> list[dict]:
    d = json.loads((FIX / "attrap" / f"raa_{name}.json").read_text("utf-8"))
    com = parse_raa.Communes(COMMUNES["communes"], {dep})
    out = []
    for a in parse_raa.lire(d["content"], com, KINDS, dt.date.fromisoformat(d["date"])):
        out.append(
            {
                **a.as_dict(),
                "id": f"{admin}:{d['id'][:12]}:{a.acte}",
                "lecteur": 1,
                "administration": admin,
                "departement": dep,
                "recueil": d["id"],
                "recueil_nom": d["name"],
                "recueil_date": d["date"],
                "url": d["url"],
                "texte": "attrap",
            }
        )
    return out


@pytest.fixture
def built(tmp_path) -> tuple[Path, dict]:
    nat = tmp_path / "national"
    nat.mkdir()
    with gzip.open(NATIONAL / "decp-rhone.jsonl.gz", "rt") as g:
        rows = [json.loads(x) for x in g]
    decp.write(nat / "decp.jsonl.gz", decp.contracts(rows))
    com = json.loads((NATIONAL / "communes.json").read_text("utf-8"))
    com["communes"].update(
        {
            k: {"nom": v["nom"], "dep": v["dep"], "pop": 1000, "epci": None, "siren": None}
            for k, v in COMMUNES["communes"].items()
            if v["dep"] in ("57", "974")
        }
    )
    (nat / "communes.json").write_text(json.dumps(com), "utf-8")
    col = tmp_path / "collecte"
    day = FIX / "dila" / "2026" / "10" / "14"
    notices = [
        n
        for f in sorted(day.glob("*.xml"))
        if (n := dila.notice(f.read_bytes(), {"source": "DILA", "fichier": f.name}))
    ]
    _gz(col / "avis.jsonl.gz", notices)
    lines = json.loads((FIX / "dgcl" / "lignes-2025.json").read_text("utf-8"))
    mention = {"source": "DGCL", "fichier": "2025.csv"}
    subs = [
        dgcl.event(r, 2025, "https://www.data.gouv.fr/datasets/x", mention)
        for r in lines
        if dgcl.is_video(r["intitule"])
    ]
    _gz(col / "subventions_etat.jsonl.gz", subs)
    acts = acts_of("pref57", "pref57", "57") + acts_of("pref974", "pref974", "974")
    _gz(col / "arretes.jsonl.gz", acts)
    admins = {
        "pref57": {
            "nom": "Moselle",
            "code": "57",
            "genre": "departement",
            "statut": "termine",
            "lu_jusqu_au": "2026-10-31",
            "dernier_recueil": "2026-10-30",
            "perime": False,
        },
        "pref974": {
            "nom": "La Réunion",
            "code": "974",
            "genre": "departement",
            "statut": "termine",
            "lu_jusqu_au": "2026-10-31",
            "dernier_recueil": "2026-10-30",
            "perime": False,
        },
    }
    (col / "couverture.json").write_text(
        json.dumps(
            {
                "le": "2026-11-01",
                "administrations": admins,
                "dgcl": {"derniere_annee_publiee": 2025},
            }
        ),
        "utf-8",
    )
    # the Moselle's drones measured field by field (the server's mesures.json): all published
    pub = {"justes": 1, "mesures": 1, "taux": 1.0, "nombres_faux": 0, "publie": True}
    (col / "mesures.json").write_text(
        json.dumps(
            {"57-drone": {g: pub for g in ("commune", "nombre", "dates", "horaires", "perimetre")}}
        ),
        "utf-8",
    )
    rules = tmp_path / "rules"
    shutil.copytree(registre.RULES, rules)
    (rules / "registre_effacements.yaml").write_text(
        "version: 1\nid: x\nrationale: test\navis:\n  - {idweb: '26-98743', le: '2026-11-01'}\n",
        "utf-8",
    )
    importer.run(PILOT, tmp_path)
    summary = construire.run(tmp_path, rules, accepted=False)
    return tmp_path, summary


def _site(root: Path) -> list[Path]:
    return [p for p in (root / "site").rglob("*") if p.is_file()]


def test_the_collection_in_the_built_registre(built):
    root, summary = built
    assert summary["collecte"]["arretes"] == 2 and summary["collecte"]["arretes_publies"] == 1
    docs = {}
    for p in (root / "site" / "document").glob("*.json"):
        d = json.loads(p.read_text("utf-8"))
        for e in d.get("evenements", []):
            docs[e["id"]] = e
    # the Vanves notice from the DILA's archive, with the DILA's mention
    vanves = docs.get("26-98610")
    assert vanves and vanves["mention"]["source"] == "DILA"
    # an erased notice is nowhere
    assert not any("26-98743" in p.read_text("utf-8") for p in _site(root) if p.suffix == ".json")
    # the Moselle's drone act, measured right: published with its fields
    m371 = next(e for e in docs.values() if e["id"].endswith(":371"))
    assert m371["periode"] == "2026-07-09 au 2026-07-19" and m371["cameras"] == 2
    assert "sous_le_seuil" not in m371
    # La Réunion's, not measured: listed, nothing read
    reunion = next(e for e in docs.values() if e["id"].endswith(":2026-1714"))
    assert reunion["non_lu"] == ["sous_le_seuil"] and reunion["cameras"] is None
    assert reunion["date"] == "2026-09-29"  # its recueil's day, nothing read from its text
    cov = json.loads((root / "site" / "couverture.json").read_text("utf-8"))
    assert cov["departements"]["57"]["etat"] == "collecte"
    assert "drone" not in cov["departements"]["57"]["sous_le_seuil"]
    assert cov["departements"]["974"]["sous_le_seuil"][:2] == ["videoprotection", "drone"]
    assert cov["non_lus"]["sous_le_seuil"] == 1
    # the DGCL: all of France, the year in progress not yet published
    [dgcl] = [s for s in cov["sources"] if s["id"] == "subventions_etat_dgcl"]
    assert (dgcl["perimetre"], dgcl["pas_encore_publie"]) == ("france", 2026)
    assert {"familles": ["avis", "subventions"], "zone": "france"} in cov["resume"]
    # the départements the collection read are collected: their acts are not « hors collecte »
    assert m371["provenance"] == "collecte" and reunion["provenance"] == "collecte"
    # the DGCL's grants, the pilot's for the years the DGCL publishes replaced
    assert summary["collecte"]["subventions_dgcl"] > 0
    assert summary["collecte"]["subventions_pilote_remplacees"] > 0


def test_attrap_is_named_in_no_file_the_site_serves(built):
    root, _ = built
    for p in _site(root):
        if p.suffix in (".json", ".html", ".txt", ".svg"):
            assert "attrap" not in p.read_text("utf-8", "replace").lower(), p


def test_a_decree_published_by_both_paris_prefectures_is_served_once():
    from lacarte_registre import collecte

    pp = {
        "id": "ppparis:aa:2026-01495",
        "administration": "ppparis",
        "type": "drone",
        "titre": "Arrêté n°2026-01495 autorisant la captation",
    }
    paris = {
        "id": "75-2026-10-30-00007",
        "administration": "pref75",
        "type": "drone",
        "titre": "Arrêté n° 2026 - 01495 autorisant la captation",
    }
    other = {**pp, "id": "ppparis:bb:2026-01496", "titre": "Arrêté n°2026-01496"}
    assert [a["id"] for a in collecte.uniques([pp, paris, other])] == [
        "75-2026-10-30-00007",
        "ppparis:bb:2026-01496",
    ]


def test_the_prefecture_of_paris_titles_without_n_and_the_padding():
    """« Arrêté 2026-01518 du 03 novembre 2026 » (no « n° ») is the Préfecture de police's
    2026-01518, served in production twice before; « 2024-0067 » is « 2024-00067 »."""
    from lacarte_registre import collecte

    pp = {
        "id": "ppparis:88445d1be87c:2026-01518",
        "acte": "2026-01518",
        "administration": "ppparis",
        "type": "drone",
        "titre": "Arrêté n°2026-01518 autorisant la captation, l'enregistrement",
    }
    paris = {
        "id": "75-2026-11-03-00006",
        "acte": "75-2026-11-03-00006",
        "administration": "pref75",
        "type": "drone",
        "titre": "Arrêté 2026-01518 du 03 novembre 2026 autorisant la captation",
    }
    glued = {**pp, "id": "ppparis:cc:2024-0067", "acte": "2024-0067", "titre": "Arrêté"}
    padded = {**paris, "id": "75-2024-01-01-00001", "titre": "Arrété n°2024-00067autorisant"}
    assert [a["id"] for a in collecte.uniques([pp, paris, glued, padded])] == [
        "75-2024-01-01-00001",
        "75-2026-11-03-00006",
    ]


def test_an_act_naming_several_departements_is_in_each():
    """2026-01510 « à Paris, en Seine-Saint-Denis et dans le Val-de-Marne »: Paris's commune,
    and the 93's and 94's lists; an act « dans le département des Hauts-de-Seine » the reader
    put in Paris is the 92's alone."""
    from lacarte_registre import collecte

    admins = collecte._admins(registre.RULES)
    names = collecte.noms_departements(admins)
    codes = {
        collecte.parse_raa_key(a["nom"]): a["code"]
        for a in admins.values()
        if a["genre"] in ("departement", "outre-mer")
    }
    a = {
        "id": "75-2026-11-02-00011",
        "acte": "75-2026-11-02-00011",
        "type": "drone",
        "titre": "Arrêté n°2026-01510 autorisant la captation, l'enregistrement et la "
        "transmission d'images au moyen de caméras installées sur des aéronefs à Paris, en "
        "Seine-Saint-Denis et dans le Val-de-Marne le mardi",
        "insee": "75056",
        "commune": "Paris",
        "recueil_date": "2026-11-03",
        "recueil_nom": "recueil",
        "url": "https://example.org/r.pdf",
    }
    deps = collecte.departements_vises(a, names, codes)
    assert deps == ["75", "93", "94"]
    e = collecte.act_event(a, admins["pref75"], {"commune"}, None, None, deps)
    assert (e["insee"], e["dep"], e["departements"]) == ("75056", "75", ["75", "93", "94"])
    hds = {**a, "titre": "Arrêté … aéronefs le vendredi 24 mai 2024 dans le département des "
           "Hauts-de-Seine"}  # fmt: skip
    deps = collecte.departements_vises(hds, names, codes)
    e = collecte.act_event(hds, admins["pref75"], {"commune"}, None, None, deps)
    assert (deps, e["insee"], e["dep"], "departements" in e) == (["92"], None, "92", False)
    # a « Marne » is not the Val-de-Marne's
    assert collecte.departements_vises({**a, "titre": "aéronefs dans la Marne"}, names, codes) == [
        "51"
    ]
