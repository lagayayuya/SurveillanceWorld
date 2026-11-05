"""The fields already collected, read by rules (champs.py, lot R5 section 1)."""

from __future__ import annotations

import lacarte_registre as registre
from lacarte_registre import champs

CONF = champs.rules(registre.RULES / "registre_champs.yaml")
TODAY = "2026-11-05"


def _contract(uid="u1", offres=3, lignes=None, techniques=None, accord=None):
    return {
        "uid": uid,
        "acheteur_departement_code": "69",
        "codeCPV": "32323500",
        "techniques": techniques,
        "idAccordCadre": accord,
        "offres": offres,
        "lignes": lignes
        or [
            {
                "modification_id": 0,
                "dateNotification": "2024-03-01",
                "montant": 100000,
                "dureeMois": 48,
                "titulaires": ["12345678900011"],
            }
        ],  # fmt: skip
    }


def test_placeholders_and_slips_read_as_absent():
    rows = champs.contrats(
        [
            _contract("a", offres=0),
            _contract("b", offres=126),
            _contract(
                "c",
                lignes=[
                    {
                        "modification_id": 0,
                        "dateNotification": "0004-01-22",
                        "montant": 1,
                        "dureeMois": 864,
                    }
                ],
            ),  # fmt: skip
        ],
        CONF,
        TODAY,
    )
    assert [r["offres"] for r in rows] == [None, None, 3]
    c = rows[2]
    assert (c["date"], c["annee"], c["montant"], c["duree"]) == (None, None, None, None)
    ab = champs.aberrations(rows, CONF)
    assert {x["id"] for x in ab["offres"]} == {"a", "b"}
    assert [x["brut"] for x in ab["date"]] == ["0004-01-22"]
    assert ab["montant"][0]["action"] == "ecarte"


def test_framework_agreement_from_its_technique_or_its_parent():
    rows = champs.contrats(
        [
            _contract("a", techniques="Accord-cadre"),
            _contract("b", accord="X1"),
            _contract("c", techniques="Sans objet"),
            _contract("d"),
        ],  # fmt: skip
        CONF,
        TODAY,
    )
    assert [r["accord_cadre"] for r in rows] == [True, True, False, None]


def test_an_amendment_gap_only_when_the_total_grows():
    grows = [
        {"modification_id": 0, "montant": 1045735.88},
        {"modification_id": 1, "montant": 1074490.28},
        {"modification_id": 2, "montant": 1384929.21},
    ]
    a = champs.avenant(grows, CONF)
    assert (a["n"], a["final"], a["ecart_pct"], a["ambigu"]) == (2, 1384929.21, 32.4, False)
    shrinks = [
        {"modification_id": 0, "montant": 500000},
        {"modification_id": 1, "montant": 164179.1},
    ]
    b = champs.avenant(shrinks, CONF)
    assert (b["ecart_pct"], b["ambigu"]) == (None, True)
    assert champs.avenant(grows[:1], CONF) is None


def test_an_award_date_after_its_notice_is_dropped():
    rows = champs.avis(
        [
            {
                "idweb": "19-3777",
                "date": "2019-01-12",
                "nature": "resultat",
                "departements": ["75"],
                "resultat": {"date_attribution": "2019-02-01", "valeur_estimee": 2822000000.0},
            }
        ],  # fmt: skip
        CONF,
        TODAY,
    )
    assert rows[0]["date_attribution"] is None
    ab = champs.aberrations(rows, CONF)
    assert ab["valeur_estimee"][0]["action"] == "signale"


def test_fill_rate_by_year_and_departement():
    rows = [
        {"annee": "2023", "dep": "69", "offres": 2},
        {"annee": "2023", "dep": "13", "offres": None},
        {"annee": "2024", "dep": "69", "offres": 5},
    ]
    r = champs.remplissage(rows, ["offres"])["offres"]
    assert (r["n"], r["rempli"], r["taux"]) == (3, 2, 0.667)
    assert r["annee"] == {"2023": 0.5, "2024": 1.0}
    assert r["dep"] == {"13": 0.0, "69": 1.0}


def test_a_grant_above_its_cost_is_flagged_not_dropped():
    rows = champs.subventions(
        [
            {
                "id": "g",
                "date": "2021-12-31",
                "dep": "11",
                "base": 15314,
                "taux": 206.76,
                "montant": 31663,
                "programme": "DETR",
            }
        ],  # fmt: skip
        CONF,
    )
    assert rows[0]["montant"] == 31663
    assert champs.aberrations(rows, CONF)["taux"][0]["action"] == "signale"
