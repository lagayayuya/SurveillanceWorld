"""A département's file (fermetures.departement_file) on the frozen extract
(tests/fixtures/registre): its figures only, who sells and who buys in it with the amounts
the build counts (`compte`), its documents per year, and the collection of its decrees."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte_registre import construire, importer

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
SERFIM = "431903954"
METROPOLE_LYON = "200046977"
PREFECTURE_REGION = "176900009"  # 14 contracts in the Rhône, none counted


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root, sans_corrections=True)
    return root / "site"


def read(site: Path, rel: str) -> dict:
    return json.loads((site / rel).read_text(encoding="utf-8"))


def rhone_contracts(site: Path) -> list[dict]:
    events = read(site, "recherche.json")["evenements"]
    return [e for e in events if e["dep"] == "69" and e["t"] == "attribution"]


def test_the_file_holds_figures_not_documents(built):
    f = read(built, "departement/69.json")
    assert f["v"] == 2
    assert not {"evenements", "affaires", "lots"} & set(f)
    assert f["departement"] == {"code": "69", "nom": "Rhône"}
    assert f["maj"] == read(built, "couverture.json")["maj"]
    # every commune named: those with a document, and a commune buyer's seat
    s = f["stats"]
    assert set(s["communes"]) <= set(f["communes"])
    for b in s["acheteurs"]:
        a = f["acheteurs"][b["siren"]]
        if a.get("categorie") == "commune":
            assert a["insee_siege"] in f["communes"]
    assert {o["siren"] for o in s["vendeurs"]} == set(f["entreprises"])


def test_the_rhone_238_contracts_194_counted_for_108_7_million(built):
    s = read(built, "departement/69.json")["stats"]
    assert s["depStats"]["con"] == 238
    assert round(s["depStats"]["montant"]) == 108_674_707
    contracts = rhone_contracts(built)
    assert (len(contracts), sum(e["compte"] for e in contracts)) == (238, 194)
    # each signed contract once (6 copies out) under its buyer; the buyers add up to the total
    buyers = s["acheteurs"]
    assert sum(o["n"] for o in buyers) == 238 - 6
    assert round(sum(o["montant"] for o in buyers)) == 108_674_707
    assert sum(o["n"] - o["hors_totaux"] for o in buyers) == 194
    # by count, then amount
    assert [o["n"] for o in buyers] == sorted((o["n"] for o in buyers), reverse=True)


def test_who_sells_in_the_rhone(built):
    sellers = read(built, "departement/69.json")["stats"]["vendeurs"]
    [serfim] = [o for o in sellers if o["siren"] == SERFIM]
    assert (serfim["n"], round(serfim["montant"]), serfim["hors_totaux"]) == (48, 29_273_608, 1)
    assert sellers[0]["siren"] == SERFIM
    # a company counts each contract it holds, alone or with others; a copy never
    for o in sellers:
        mine = [e for e in rhone_contracts(built) if o["siren"] in (e.get("entreprises") or [])]
        mine = [e for e in mine if not e["copie"]]
        assert o["n"] == len(mine)
        assert o["montant"] == pytest.approx(sum(e["montant"] or 0 for e in mine if e["compte"]))


def test_a_buyer_whose_contracts_are_all_out_of_the_totals_adds_nothing(built):
    buyers = read(built, "departement/69.json")["stats"]["acheteurs"]
    [pref] = [o for o in buyers if o["siren"] == PREFECTURE_REGION]
    assert (pref["n"], pref["montant"], pref["hors_totaux"]) == (14, 0, 14)


def test_the_intercommunalities_count_each_document_once(built):
    s = read(built, "departement/69.json")["stats"]
    lyon = s["epcis"][METROPOLE_LYON]
    assert lyon["nom"] == "Métropole de Lyon"
    assert len(lyon["communes"]) == 34
    assert lyon["uniq"] == {"docs": 219, "con": 196, "cam": 10, "dr": 3, "arr": 13}
    assert lyon["acheteur"] is True
    assert sum(len(x["communes"]) for x in s["epcis"].values()) == len(s["communes"])
    # a shared decree is in several communes, once in its intercommunality
    assert sum(s["communes"][k]["docs"] for k in lyon["communes"]) > lyon["uniq"]["docs"]


def test_the_documents_per_year(built):
    s = read(built, "departement/69.json")["stats"]
    years = s["annees"]
    total = {k: sum(y[k] for y in years.values()) for k in ("con", "cam", "dr")}
    assert total == {"con": 238, "cam": s["depStats"]["cam"], "dr": s["depStats"]["dr"]}
    assert (years["2018"]["con"], years["2025"]["con"], years["2026"]["con"]) == (3, 33, 29)
    # the camera authorisations only, never a drone act among them
    assert (years["2026"]["cam"], years["2026"]["dr"]) == (8, 3)
    assert years["2017"]["ao"] == 1


def test_a_departement_not_collected_says_so(built):
    f = read(built, "departement/93.json")
    assert f["couverture"] == {"etat": "non_collecte"}
    assert f["stats"]["depStats"]["con"] == 3
    paris = read(built, "departement/75.json")
    assert paris["couverture"]["etat"] == "impossible"
    assert paris["couverture"]["raison"] == "defi_anti_robot"
    assert paris["couverture"]["documents_demandes"] is True
    # Paris: one drone act without a commune, no commune row, no money
    s = paris["stats"]
    assert (s["depStats"]["docs"], s["depStats"]["sansCommune"], s["communes"]) == (1, 1, {})
    assert (s["vendeurs"], s["acheteurs"]) == ([], [])
