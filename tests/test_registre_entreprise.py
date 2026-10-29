"""A company's page (entreprise/<siren>.json, « page »: lacarte_registre/entreprise.py) on the
frozen extract (tests/fixtures/registre), and its running rule on synthetic contracts."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte_registre import construire, entreprise, importer
from lacarte_registre.regles import Pilote, Registre

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
SERFIM = "431903954"
CRAPONNE, ROISSY, COLOMBES = "69069", "77390", "92025"
SAINT_CYR, VENISSIEUX = "69191", "69259"


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root)
    return root / "site"


def read(site: Path, rel: str) -> dict:
    return json.loads((site / rel).read_text(encoding="utf-8"))


def test_serfim_page_64_contracts_each_with_its_end(built):
    f = read(built, f"entreprise/{SERFIM}.json")
    p = f["page"]
    assert (f["stats"]["n"], f["stats"]["copies"]) == (64, 1)
    # one end per contract, the doublon's copy not among them
    assert set(p["fins"]) == set(f["stats"]["contrats"])
    copy = next(e for e in f["evenements"] if e["t"] == "attribution" and e["copie"])
    assert copy["id"] not in p["fins"]
    # the extract publishes no duration: no end, nothing said to run (not zero: unknown)
    assert p["sans_fin"] == 64 and p["en_cours"] == []
    assert p["maj"] == read(built, "index.json")["maj"]
    assert p["modifications"] == 1
    # a reviewed date is the start (Mions' contract of 2020, read 2021)
    assert p["fins"]["216902833000132020_32323500~0"]["debut"] == "2021-02-05"


def test_serfim_what_stands_out_facts_only(built):
    f = read(built, f"entreprise/{SERFIM}.json")
    x = f["page"]["faits"]
    ev = {e["id"]: e for e in f["evenements"]}
    first = x["identiques"][0]
    assert first["montant"] == 800_000
    assert [ev[i]["insee"] for i in first["contrats"]] == [CRAPONNE, ROISSY, COLOMBES]
    assert len(x["identiques"]) == 2
    # every amount of a fact is a counted one
    assert all(ev[i]["compte"] for g in x["identiques"] for i in g["contrats"])
    near = x["rapproche"]
    assert (near["montant"], near["jours"]) == (450_000, 15)
    assert sorted(ev[i]["insee"] for i in near["contrats"]) == [SAINT_CYR, VENISSIEUX]
    # no number of offers in the extract: no such fact
    assert x["offres"] is None
    assert f["page"]["lieux"] == {"surtout": True, "regions": ["69", "idf"]}
    # no affaire of the extract gives a category: nothing said of what it does
    assert f["page"]["activite"] is None


def test_a_sole_trader_is_never_named(built):
    for path in (built / "entreprise").glob("*.json"):
        f = json.loads(path.read_text(encoding="utf-8"))
        for x in [f["entreprise"], *f["entreprises"].values()]:
            assert not (x.get("entrepreneur_individuel") and x.get("nom")), path.name


def _reg(events: list[dict], affaires: dict[str, dict]) -> Registre:
    """SYNTHETIC: a register of made-up contracts, not data of the extract."""
    for e in events:
        e.setdefault("compte", e["t"] == "attribution")
        e.setdefault("copie", False)
    return Registre(
        pilote=Pilote(reg={}, globals={}),
        evenements=events,
        by_id={e["id"]: e for e in events},
        affaires=affaires,
        communes={},
    )


def test_running_today_is_the_start_plus_the_last_modified_duration():
    # SYNTHETIC contracts (made up for the rule, not in any source)
    ev = [
        # 24 months from 2024-01-15: ended 2026-01-15, before the build's date
        {"id": "a~0", "t": "attribution", "date": "2024-01-15", "affaire": "a", "duree": 24},
        # the same, prolonged by a modification to 36 months: ends 2027-01-15
        {"id": "b~0", "t": "attribution", "date": "2024-01-15", "affaire": "b", "duree": 24},
        {"id": "b~1", "t": "modification", "date": "2025-03-01", "affaire": "b", "duree": 30},
        {"id": "b~2", "t": "modification", "date": "2025-09-01", "affaire": "b", "duree": "36"},
        {"id": "b~3", "t": "modification", "date": "2026-01-01", "affaire": "b"},
        # signed 2023-12, read 2025-02 by a review: 24 months from the reviewed date
        {
            "id": "c~0",
            "t": "attribution",
            "date": "2023-12-01",
            "date_lue": "2025-02-01",
            "affaire": "c",
            "duree": 24,
        },
        # no duration published: no end, not running
        {"id": "d~0", "t": "attribution", "date": "2026-06-01", "affaire": "d"},
    ]
    aff = {a: {"events": [e["id"] for e in ev if e["affaire"] == a]} for a in "abcd"}
    reg = _reg(ev, aff)
    stats = {"contrats": ["a~0", "b~0", "c~0", "d~0"], "clientes": []}
    p = entreprise.page(reg, stats, "2026-10-24", {})
    assert p["fins"]["a~0"] == {"debut": "2024-01-15", "duree": 24, "fin": "2026-01-15"}
    assert p["fins"]["b~0"]["fin"] == "2027-01-15"
    assert p["fins"]["c~0"]["fin"] == "2027-02-01"
    assert p["fins"]["d~0"]["fin"] is None
    assert p["en_cours"] == ["b~0", "c~0"]
    assert (p["sans_fin"], p["modifications"]) == (1, 3)
    # the end on the build's date itself is not after it
    assert entreprise.page(reg, stats, "2027-01-15", {})["en_cours"] == ["c~0"]


def test_single_offer_and_where_its_buyers_are():
    # SYNTHETIC contracts (made up for the rule, not in any source)
    ev = [
        {"id": f"x{i}~0", "t": "attribution", "date": "2025-01-01", "affaire": f"x{i}", "offres": o}
        for i, o in enumerate([1, 1, 3, None, "2"])
    ]
    reg = _reg(ev, {e["affaire"]: {"events": [e["id"]]} for e in ev})
    assert entreprise.faits(reg, ev)["offres"] == {"une_offre": 2, "renseignes": 4}
    deps = {"a": "69", "b": "69", "c": "93", "d": "13"}
    assert entreprise.lieux(list(deps), deps) == {"surtout": True, "regions": ["69", "idf"]}
    deps = {"a": "69", "b": "13", "c": "93", "d": "01"}
    assert entreprise.lieux(list(deps), deps)["surtout"] is False
    # all in one: that one, not « surtout »
    deps = {"a": "77", "b": "93"}
    assert entreprise.lieux(list(deps), deps) == {"surtout": False, "regions": ["idf"]}
