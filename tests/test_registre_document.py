"""A document's record (document/<affaire>.json) on the frozen extract (tests/fixtures/registre):
its place among the register's documents is the build's (parcours.py) — the previous contract,
the next call for tenders, the company's contracts and buyers, the contract that followed a call
or a subsidy — and the page reads it. One record per kind of the view: a contract, a call for
tenders without a contract, a subsidy, a decree without a commune."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte_registre import construire, fermetures, importer, regles
from lacarte_registre.parcours import add_months, months

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
SERFIM = "431903954"
# Mions' two contracts with Serfim T.I.C. (the first one's year reviewed: 2020 → 2021)
MIONS_2021 = "216902833000132020_32323500"
MIONS_2025 = "21690283300013202520240600_32323500"
AO_2026 = "avis-26-71981"  # Mions' call for tenders of July 2026, no contract yet
AO_2020 = "avis-20-142345"  # Mions' call of November 2020 and its result, no contract found
SUBSIDY = "detr-69-2024-3"  # a State grant (DETR) listed by the préfecture du Rhône
NO_COMMUNE = "75-2025-06-19-00003"  # a drone decree of the police prefecture, no commune


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root, sans_corrections=True)
    return root / "site"


def doc(site: Path, affaire: str) -> dict:
    return json.loads((site / "document" / f"{affaire}.json").read_text(encoding="utf-8"))


def test_the_second_contract_follows_the_first(built):
    f = doc(built, MIONS_2025)
    assert f["affaire"]["kind"] == "contrat"
    p = f["parcours"]
    assert p["precedent"] == {
        "affaire": MIONS_2021,
        "date": "2021-02-05",  # the reviewed date, marked « date à vérifier »
        "date_a_verifier": True,
        "entreprises": [SERFIM],
        "montant": 200_000,
    }
    assert f["entreprises"][SERFIM]["nom"] == "SERFIM T.I.C."
    # its next call for tenders: Mions' notice of July 2026, still without a contract
    assert p["suivant"] == {"affaire": AO_2026, "date": "2026-07-21"}
    # a copy counted once, every buyer once (comptes.entreprises)
    assert p["entreprises"] == {SERFIM: {"contrats": 64, "collectivites": 44}}
    # the extract publishes no duration: no end is computed
    assert p["fin_prevue"] is None
    assert p["contrat"] is None
    kinds = [e["t"] for e in f["evenements"] if e["affaire"] == MIONS_2025]
    assert sorted(kinds) == ["attribution", "avis", "modification"]


def test_the_first_contract_has_no_previous_and_its_next_call_is_the_seconds(built):
    p = doc(built, MIONS_2021)["parcours"]
    assert p["precedent"] is None
    assert p["suivant"] == {"affaire": MIONS_2025, "date": "2024-06-27"}


def test_a_call_for_tenders_without_a_contract(built):
    recent = doc(built, AO_2026)
    assert recent["affaire"]["kind"] == "contrat_non_retrouve"
    # published within 18 months of the register's update: its contract may still come
    assert recent["parcours"]["contrat"] == "attendu"
    old = doc(built, AO_2020)
    assert old["parcours"]["contrat"] == "non_retrouve"
    assert sorted(e["t"] for e in old["evenements"]) == ["avis", "resultat"]
    assert old["parcours"]["precedent"] is None and old["parcours"]["suivant"] is None


def test_a_subsidy(built):
    f = doc(built, SUBSIDY)
    assert f["affaire"]["kind"] == "subvention"
    [e] = f["evenements"]
    assert (e["t"], e["montant"], e["date_annee"]) == ("subvention_etat", 118_750, True)
    assert f["parcours"]["contrat"] == "non_designe"


def test_a_decree_without_a_commune(built):
    f = doc(built, NO_COMMUNE)
    [e] = f["evenements"]
    assert e["t"] == "arrete_drone" and not e.get("insee")
    assert "commune_introuvable" in e["non_lu"]
    assert f["communes"] == {}
    assert f["parcours"] == {
        "fin_prevue": None,
        "precedent": None,
        "suivant": None,
        "entreprises": {},
        "contrat": None,
    }


def test_a_decree_with_a_commune_names_it(built):
    # the page opens it in its commune's Autorisations, at its dossier
    f = doc(built, "69-20083300")
    assert {e["insee"] for e in f["evenements"]} == {"69283"}
    assert "69283" in f["communes"]


def test_months_and_dates():
    assert add_months("2025-01-30", 36) == "2028-01-30"
    assert add_months("2025-11-15", 3) == "2026-02-15"
    assert add_months("2028-01-30", -24) == "2026-01-30"
    assert (months("36"), months(36.0), months(None), months(""), months("0")) == (
        36,
        36,
        None,
        None,
        None,
    )


# --- synthetic cases (made up for these tests, not data of the register) ----------------------


def _ev(i: str, t: str, affaire: str, date: str, **kw) -> dict:
    return {"id": i, "t": t, "affaire": affaire, "date": date, "insee": "99001", "dep": "99", **kw}


def _context(affaires: dict, events: list[dict], lots=None, groupes=None) -> fermetures.Context:
    p = regles.Pilote(
        reg={
            "affaires": affaires,
            "evenements": events,
            "communes": {"99001": {"nom": "Synthétique", "dep": "99"}},
            "entreprises": {"111111111": {"nom": "ENTREPRISE A"}},
        },
        globals={"LOTS": lots or {}, "LOTS_GROUPES": groupes or {}},
    )
    reg = regles.appliquer(p, {})
    cov = {"maj": "2026-10-24", "departements": {}, "defaut": {}, "sources": []}
    return fermetures.Context(reg, cov, ["99"])


def _contract(aid: str, date: str, **kw) -> tuple[dict, dict]:
    a = {"id": aid, "kind": "contrat", "insee": "99001", "acheteur_siren": "200000001"}
    e = _ev(f"{aid}~0", "attribution", aid, date, entreprises=["111111111"], montant=10, **kw)
    return a, e


def test_synthetic_end_next_call_window_copies_and_lots():
    a1, e1 = _contract("c1", "2018-03-01", dispositif="videoprotection", duree="24")
    a2, e2 = _contract("c2", "2022-01-10", dispositif="videoprotection", duree="36")
    mod = _ev("c2~1", "modification", "c2", "2023-01-01", duree="48", entreprises=[])
    a2["events"] = [e2["id"], mod["id"]]
    # a copy of the first contract, published twice: never the previous one
    ac, ec = _contract("c1bis", "2019-01-01", dispositif="videoprotection")
    # a contract for another device: neither previous nor next
    ad, ed = _contract("c3", "2021-01-01", dispositif="lapi")
    # calls for tenders without contract: one too early for c2 (more than 24 months before its
    # end), one in the window
    early = {"id": "ao1", "kind": "contrat_non_retrouve", "insee": "99001", "events": ["n1"]}
    late = {"id": "ao2", "kind": "contrat_non_retrouve", "insee": "99001", "events": ["n2"]}
    n1 = _ev("n1", "avis", "ao1", "2023-06-01", acheteur_siren="200000001")
    n2 = _ev("n2", "avis", "ao2", "2025-06-01", acheteur_siren="200000001")
    for a, e in ((a1, e1), (ac, ec), (ad, ed)):
        a["events"] = [e["id"]]
    ctx = _context(
        {x["id"]: x for x in (a1, a2, ac, ad, early, late)},
        [e1, e2, mod, ec, ed, n1, n2],
        lots={"c1": "g", "c1bis": "g"},
        groupes={"g": {"nature": "doublon", "membres": [{"affaire": "c1"}, {"affaire": "c1bis"}]}},
    )
    p = fermetures.document_file(ctx, "c2")["parcours"]
    # the last modification's duration: 2022-01-10 + 48 months
    assert p["fin_prevue"] == {"date": "2026-01-10", "signature": "2022-01-10", "mois": 48}
    assert p["precedent"]["affaire"] == "c1"
    # the window opens 24 months before the end (2024-01-10): the 2023 call is not the next one
    assert p["suivant"] == {"affaire": "ao2", "date": "2025-06-01"}
    assert p["entreprises"] == {"111111111": {"contrats": 3, "collectivites": 1}}


def test_synthetic_probable_contract_is_in_the_record():
    a1, e1 = _contract("c1", "2025-03-01", dispositif="videoprotection")
    a1["events"] = [e1["id"]]
    ao = {
        "id": "ao",
        "kind": "contrat_non_retrouve",
        "insee": "99001",
        "events": ["n"],
        "contrat_probable": "c1",
    }
    n = _ev("n", "avis", "ao", "2024-11-01", acheteur_siren="200000001")
    ctx = _context({"c1": a1, "ao": ao}, [e1, n])
    f = fermetures.document_file(ctx, "ao")
    assert f["parcours"]["contrat"] == "probable"
    # the probable contract comes with the record: its date, company and amount are shown
    assert "c1" in f["affaires"]
    assert e1["id"] in {e["id"] for e in f["evenements"]}
    assert f["entreprises"]["111111111"]["nom"] == "ENTREPRISE A"
