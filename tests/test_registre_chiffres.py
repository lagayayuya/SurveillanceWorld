"""The figures of a commune, a territory and a company (chiffres.py, lot R5 section 4)."""

from __future__ import annotations

import lacarte_registre as registre
from lacarte_registre import chiffres

CONF = chiffres.rules(registre.RULES / "registre_chiffres.yaml")


def test_strata_cut_the_large_cities_at_200000():
    assert chiffres.strate(None, CONF) is None
    assert chiffres.strate(499, CONF) == 0
    assert chiffres.strate(49229, CONF) == 6  # Saint-Priest
    assert CONF["strates"]["libelles"][chiffres.strate(519127, CONF)].startswith("200 000")


def test_a_region_code_is_not_a_departement():
    cov = {"administrations": {
        "pref75": {"code": "75", "statut": "termine"},
        "ppparis": {"code": "75", "statut": "termine"},
        "region-75": {"code": "75", "statut": "pas_encore_lu"},
        "pref86": {"code": "86", "statut": "en_cours"},
        "pref87": {"code": "87", "statut": "pas_encore_lu"},
    }}  # fmt: skip
    assert chiffres.etats_actes(cov) == {"75": "lu", "86": "partiel", "87": "non_lu"}


def test_a_flight_period_counts_each_day_once():
    assert chiffres.jours(["2025-12-05 au 2025-12-08", "2025-12-08"]) == {
        "2025-12-05", "2025-12-06", "2025-12-07", "2025-12-08"}  # fmt: skip


def test_the_motive_most_specific_first():
    t = "Arrêté autorisant … aux fins de prévenir les rodéos urbains lors de la fête"
    assert chiffres.motif(t, CONF) == "rodeos"
    assert chiffres.motif("AP 20261012 drones-manif- lycéennes", CONF) == "manifestation"
    assert chiffres.motif("arrêté … article 3 - périmètre en annexe", CONF) == "autre"


def test_flights_within_the_last_twelve_months():
    acts = [
        {"dates": ["2025-11-05"], "texte": "match"},  # the window's first day is out
        {"dates": ["2025-11-06", "2026-01-01"], "texte": "match"},
        {"dates": ["2026-01-01"], "texte": "stupéfiants"},
    ]
    v = chiffres.vols(acts, "2026-11-05", CONF)
    assert v["jours"] == 2 and v["motif"] == "evenement"


def test_an_abrogation_ends_a_system_and_an_unread_act_is_said():
    acts = [
        {"id": "a", "dossier": "1", "date": "2024-01-01", "sous_type": "autorisation",
         "titulaire": "commerces", "cameras": 4},
        {"id": "b", "dossier": "1", "date": "2025-01-01", "sous_type": "abrogation",
         "titulaire": "commerces", "cameras": None},
        {"id": "c", "dossier": "2", "date": "2025-01-01", "sous_type": "autorisation",
         "titulaire": "mairie", "cameras": 30},
        {"id": "d", "dossier": "3", "date": "2025-01-01", "sous_type": "autorisation",
         "titulaire": None, "cameras": None},
    ]  # fmt: skip
    au = chiffres.autorisees(acts)
    assert (au["mairie"], au["commerces"], au["dossiers"], au["non_lus"]) == (30, 0, 2, 1)


def test_a_share_needs_three_contracts():
    assert chiffres.offre_unique([{"offres": 1}, {"offres": 2}], CONF)["v"] is None
    assert chiffres.offre_unique([{"offres": 1}, {"offres": 2}, {"offres": None},
                                  {"offres": 1}], CONF)["v"] == 0.667  # fmt: skip


def _commune(nom, dep, pop):
    return {"nom": nom, "dep": dep, "pop": pop, "epci": None, "siren": None}


def test_a_departement_not_read_is_never_zero():
    noms = {"1": _commune("A", "69", 1000), "2": _commune("B", "13", 1000)}
    contrats = [{"id": "c", "insee": "1", "communal": True, "compte": True,
                 "date": "2020-01-01", "montant": 10000.0, "offres": None}]  # fmt: skip
    rows = chiffres.communes(noms, contrats, [], [], [], {}, {"69": "lu"}, "2026-11-05", CONF)
    assert rows["2"]["jours_vol"] == {"v": None, "etat": "non_lu", "motif": None, "motifs": {}}
    assert rows["1"]["jours_vol"]["v"] == 0
    # the contracts are national: B has 0, and is ranked
    assert rows["2"]["montant"]["v"] == 0 and rows["2"]["montant"]["rang"] == 2
    assert rows["1"]["euros_hab"]["v"] == 10.0 and rows["1"]["euros_hab"]["rang"] == 1
    # a share of nothing is not ranked
    assert "rang" not in rows["1"]["offre_unique"]


def test_a_companys_partners_are_not_its_competitors():
    def c(i, buyer, ents, nat="maintenance"):
        return {
            "id": i,
            "acheteur": buyer,
            "dep": "69",
            "compte": True,
            "date": "2022-01-01",
            "montant": 100.0,
            "offres": 1,
            "entreprises": ents,
            "natures": [nat],
        }

    rows = [c("1", "B1", ["X", "P"]), c("2", "B1", ["Y"]), c("3", "B2", ["Z"]),
            c("4", "B3", ["W"], "drones")]  # fmt: skip
    e = chiffres.entreprises(rows, CONF)
    x = e["X"]
    assert x["partenaires"] == {"P": 1}
    assert x["memes_clients"] == {"Y": 1}
    assert x["memes_natures_departements"] == {"Y": 1, "Z": 1}
    assert x["clients"] == ["B1"] and x["montant"] == 100
