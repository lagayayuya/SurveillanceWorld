"""The texts' repairs at the build (rules/registre_textes.yaml): an apostrophe or an « œ »
its publisher turned into « ? », mended; any other « ? » kept."""

from __future__ import annotations

import pytest

import lacarte_registre as registre
from lacarte_registre import textes

RULES = textes.regles(registre.RULES)


@pytest.mark.parametrize(
    ("raw", "fixed"),
    [
        ("Lecture Automatisée des Plaques d?Immatriculation (LAPI)",
         "Lecture Automatisée des Plaques d'Immatriculation (LAPI)"),
        ("la captation, l?enregistrement et la transmission d?images",
         "la captation, l'enregistrement et la transmission d'images"),
        ("TRAVAUX D?INSTALLATION OU D?EXTENSION", "TRAVAUX D'INSTALLATION OU D'EXTENSION"),
        ("à l?hôtel IBIS, Saint-Cyr-l?Ecole", "à l'hôtel IBIS, Saint-Cyr-l'Ecole"),
        ("jusqu?au 31 mars", "jusqu'au 31 mars"),
        ("mise en ?uvre d?un système", "mise en œuvre d'un système"),
        ("METTRE EN ?UVRE", "METTRE EN ŒUVRE"),
    ],
)  # fmt: skip
def test_an_apostrophe_turned_into_a_question_mark_is_put_back(raw, fixed):
    assert textes.reparer(raw, RULES) == fixed


@pytest.mark.parametrize(
    "raw",
    ["ARRÊTÉ n°BSIPA2026 ?2, 20% portant", "Arrêté n?_202,-GQI6S+", "Pourquoi ?", "SMCAFE ? Lyon",
     "camping Le P?Tit Bois", "Arrêté CAB/DS/BPS N° 2024. 5?3du 14 juin"],
)  # fmt: skip
def test_any_other_question_mark_is_kept(raw):
    assert textes.reparer(raw, RULES) == raw


def test_the_records_are_mended_in_place_and_counted():
    recs = [{"titre": "autorisation d?un système", "objet": "x"}, {"objet": "rien"},
            {"objet": "mise en ?uvre", "titre": "l?emploi"}]  # fmt: skip
    assert textes.appliquer(recs, RULES) == 2
    assert recs[0]["titre"] == "autorisation d'un système" and recs[2]["titre"] == "l'emploi"


def test_a_person_a_title_names_is_masked_the_event_and_place_kept():
    """rule:registre_textes@1:personnes (Ju, 2026-11-09): no natural person served."""
    import lacarte_registre as registre
    from lacarte_registre import textes

    rules = textes.personnes(registre.RULES)
    recs = [
        {"titre": "Arrêté … à l'occasion des concerts de Jeanne DUPONT au Stade de France"},
        {"titre": "Arrêté … lors de la visite du Pape Pierre II à Paris"},
        {"titre": "Arrêté … à l'occasion de la manifestation du 1er mai", "objet": None},
    ]
    assert textes.masquer(recs, rules) == 2
    assert recs[0]["titre"] == "Arrêté … à l'occasion des concerts de […] au Stade de France"
    assert recs[1]["titre"] == "Arrêté … lors de la visite du Pape à Paris"
    assert recs[2]["titre"].endswith("manifestation du 1er mai")
