"""The names as the pages show them (rules/registre_noms.yaml): the recette's constats 26 and 29."""

from __future__ import annotations

import lacarte_registre as registre
from lacarte_registre import noms

R = registre.RULES


def test_sirene_s_capitals_keep_their_acronyms_and_get_their_accents():
    assert (
        noms.afficher("EDF BUSINESS SERVICES ET TRAVAUX", R) == "EDF Business Services et Travaux"
    )
    assert noms.afficher("SNEF", R) == "SNEF"
    assert noms.afficher("INEO PROVENCE ET COTE D'AZUR", R) == "Ineo Provence et Côte d'Azur"
    assert noms.afficher("EIFFAGE ENERGIE SYSTEMES - INFRA NORD", R) == (
        "Eiffage Énergie Systèmes - Infra Nord"
    )
    assert noms.afficher("SPIE CITYNETWORKS", R, "434085395") == "Spie CityNetworks"  # usual
    assert noms.afficher(None, R) is None


def test_the_dgcl_s_capitalised_words_get_their_small_words_back():
    assert noms.afficher("Commune De Coupvray", R) == "Commune de Coupvray"
    assert noms.afficher("Communaute D'agglomeration Du Grand Annecy", R) == (
        "Communauté d'agglomération du Grand Annecy"
    )
    assert noms.afficher("Commune De L'Isle-Adam", R) == "Commune de L'Isle-Adam"  # its name's


def test_a_renamed_buyer_is_one_buyer_under_two_numbers():
    ren = noms.renommages(R)
    assert ren["256900994"] is ren["200096386"]
    assert ren["256900994"]["nouveau"] == "200096386"
    assert ren["256900994"]["libelle"] == "Sytral (deux noms)"
