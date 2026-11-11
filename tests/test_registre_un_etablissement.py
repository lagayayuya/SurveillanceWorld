"""rule:collecte_seuils@1:commune_par_regle: a camera act's commune is served only when the act
is one establishment's (2026-11-10: bundles under one number, acts of several communes and
« habilitations » were placed in their first commune)."""

from __future__ import annotations

import json

import yaml

import lacarte_registre as registre
from lacarte_registre import collecte


def test_a_bundle_a_list_of_communes_or_an_habilitation_is_placed_in_none(tmp_path):
    (tmp_path / "national").mkdir()
    communes = {
        "59350": {"nom": "Lille", "dep": "59"},
        "59392": {"nom": "Maubeuge", "dep": "59"},
        "59599": {"nom": "Tourcoing", "dep": "59"},
        "31555": {"nom": "Toulouse", "dep": "31"},
    }
    (tmp_path / "national" / "communes.json").write_text(json.dumps({"communes": communes}))
    conf = yaml.safe_load((registre.RULES / "collecte_seuils.yaml").read_text("utf-8"))
    seul = collecte._un_etablissement(tmp_path, conf["commune_par_regle"])
    one = {"departement": "59", "titre": "Arrêté portant autorisation … pour le magasin X à Lille"}
    assert seul(one)
    for titre, dep in (
        ("Arrêté n° VPA / 2026 / 290 à 299 portant autorisation d'un système", "31"),
        ("31 arrêtés d'autorisation de VIDEOPROTECTION", "33"),
        ("Arrêtés portant autorisation … (Commission du 15 octobre 2024)", "33"),
        ("… POUR LES ÉTABLISSEMENTS FRANCE TRAVAIL DE MAUBEUGE, LILLE, TOURCOING", "59"),
        ("Arrêté portant habilitation vidéoprotection … Centre pénitentiaire", "83"),
        ("Arrêté portant composition de la commission départementale", "33"),
    ):
        assert not seul({"departement": dep, "titre": titre}), titre


def test_the_rule_s_placement_is_served_at_48_of_50_and_paris_takes_its_own_acts():
    """Ju (2026-11-11): the rule's placement is served only when a fresh drawing of 50 gave 48
    or more (the second gave 49); the 75, of one commune, places its acts in 75056."""
    conf = yaml.safe_load((registre.RULES / "collecte_seuils.yaml").read_text("utf-8"))
    par = conf["commune_par_regle"]
    vp = par["types"]["videoprotection"]
    assert par["publie"] is (vp["mesures"] == 50 and vp["justes"] >= 48)
    assert par["publie"] is True
    assert par["departement_une_commune"]["75"]["insee"] == "75056"
    cov = yaml.safe_load((registre.RULES / "registre_couverture.yaml").read_text("utf-8"))
    assert "75" in cov["actes_commune"]["departements_une_commune"]
