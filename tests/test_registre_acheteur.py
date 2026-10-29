"""A buyer's file (fermetures.acheteur_file) on the frozen extract (tests/fixtures/registre):
what its page reads beside its documents — the linked buyer and its contracts, its commune's
page, a central purchasing body — decided by the build, never by the page."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte_registre import construire, importer

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
SYTRAL, SYTRAL_MOBILITES = "256900994", "200096386"
MIONS_BUYER, MIONS = "216902833", "69283"
CANUT = "924435951"  # Centrale d'Achat du Numérique et des Télécoms


@pytest.fixture(scope="module")
def site(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root)
    return root / "site"


def read(site: Path, siren: str) -> dict:
    return json.loads((site / "acheteur" / f"{siren}.json").read_text(encoding="utf-8"))


def contracts(f: dict, siren: str) -> list[dict]:
    ids = set(f["stats" if f["acheteur"]["siren"] == siren else "stats_lie"]["contrats"])
    return [e for e in f["evenements"] if e["id"] in ids]


def test_the_sytral_signed_7_contracts_with_5_companies(site):
    f = read(site, SYTRAL)
    a = f["acheteur"]
    assert a["nom_court"] == "Sytral (transports lyonnais)"
    assert (a["categorie"], a["dep_nom"], a["page_commune"]) == ("transports", "Rhône", None)
    cs = contracts(f, SYTRAL)
    assert len(cs) == f["stats"]["n"] == 7
    assert len({s for e in cs for s in e["entreprises"]}) == len(f["stats"]["ents"]) == 5
    assert [e["date"][:4] for e in sorted(cs, key=lambda e: e["date"])][::6] == ["2018", "2021"]


def test_its_total_adds_the_counted_contracts_only(site):
    f = read(site, SYTRAL)
    cs = contracts(f, SYTRAL)
    # the line D's contract is mixed (other works than video): signed, not counted
    out = [e for e in cs if not e["compte"]]
    assert [e.get("hors_totaux") for e in out] == ["mixte_surete"]
    total = sum(e["montant"] for e in cs if e["compte"])
    assert round(total, 2) == round(f["stats"]["montant"], 2) == 8_238_031.59


def test_its_linked_buyer_and_its_contracts_are_in_its_file(site):
    f = read(site, SYTRAL)
    assert f["acheteur"]["lie"] == SYTRAL_MOBILITES
    assert f["acheteurs"][SYTRAL_MOBILITES]["nom"] == "Sytral Mobilités"
    lies = contracts(f, SYTRAL_MOBILITES)
    assert len(lies) == f["stats_lie"]["n"] == 4
    assert sorted(e["date"][:4] for e in lies)[::3] == ["2023", "2026"]
    # each of its contracts with its affaire and its companies' names
    assert all(e["affaire"] in f["affaires"] for e in lies)
    assert {s for e in lies for s in e["entreprises"]} <= set(f["entreprises"])
    # and the other way round
    back = read(site, SYTRAL_MOBILITES)
    assert back["acheteur"]["lie"] == SYTRAL
    assert back["stats_lie"]["n"] == 7


def test_its_lead_and_its_seat(site):
    f = read(site, SYTRAL)
    assert f["acheteur"]["lead"]["sujet"] == "L'autorité des transports lyonnais"
    assert f["communes"]["69123"]["nom"] == "Lyon"


def test_a_buyer_without_a_link_has_none(site):
    f = read(site, MIONS_BUYER)
    assert (f["acheteur"]["lie"], f["stats_lie"], f["acheteur"]["lead"]) == (None, None, None)


def test_a_commune_buyer_s_page_is_its_commune_s(site):
    assert read(site, MIONS_BUYER)["acheteur"]["page_commune"] == MIONS
    for p in (site / "acheteur").glob("*.json"):
        a = json.loads(p.read_text(encoding="utf-8"))["acheteur"]
        if a.get("categorie") != "commune":
            assert a["page_commune"] is None
        elif a["page_commune"]:
            assert a["page_commune"] == a["insee_siege"]
            assert (site / "commune" / f"{a['page_commune']}.json").is_file()


def test_a_central_purchasing_body(site):
    f = read(site, CANUT)
    assert f["acheteur"]["centrale"] is True
    assert all(not e["compte"] for e in contracts(f, CANUT))
    assert read(site, SYTRAL)["acheteur"]["centrale"] is False
