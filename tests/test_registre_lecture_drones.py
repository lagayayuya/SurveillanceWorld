"""A drone act's article 1 read by rules (rules/registre_drones.yaml `texte`): the service,
the purposes of L. 242-5, the sector in the act's words; nothing cut is completed."""

from __future__ import annotations

import lacarte_registre as registre
from lacarte_registre import lecture_drones as ld

R = registre.RULES


def test_the_police_prefecture_s_article_reads_its_service_purposes_and_sector():
    a1 = ("Article 1er – La captation, l'enregistrement et la transmissio n d'images par la "
          "direction del'ordre public et de la circulation sont autorisés à Paris le 30 juin "
          "2026 à l'occasion de l'événement susvisé aux titres de : - la prévention des "
          "atteintes à la sécurité des personnes et des biens ; - la sécurité des "
          "rassemblements ; - la prévention d'actes de terrorisme ; - la régulation des flux "
          "de transport.")  # fmt: skip
    out = ld.lire(a1, R)
    assert out["service_id"] == "dopc" and out["service"].startswith("Direction de l'ordre")
    assert out["finalites"] == ["atteintes_personnes_biens", "rassemblements", "terrorisme",
                                "flux_transport"]  # fmt: skip
    assert out["secteur"] == "à Paris le 30 juin 2026 à l'occasion de l'événement susvisé"


def test_a_split_name_is_matched_a_cut_one_is_not_completed():
    split = ("La captation par la directionterritoriale de la sécurité de proximité de la sein "
             "e-saint-denis sont autorisés à Saint-Ouen-sur- Seine (93) au titre de la "
             "prévention des atteintes à la sécurité des personnes et des biens.")  # fmt: skip
    out = ld.lire(split, R)
    assert out["service_id"] == "dtsp93" and out["secteur"] == "à Saint-Ouen-sur-Seine (93)"
    cut = "Article 1er lation sont autorisés à Paris le 18 septembre 2025 aux titres de : - ;"
    assert "service" not in ld.lire(cut, R) and "finalites" not in ld.lire(cut, R)


def test_read_for_the_measured_family_only():
    a1 = ("par la gendarmerie nationale sont autorisés du samedi au dimanche au titre de "
          "secours aux personnes")  # fmt: skip
    assert ld.champs({"administration": "pref62", "champs": {"article_1": a1}}, R) == {}
    got = ld.champs({"administration": "pref94", "champs": {"article_1": a1}}, R)
    assert got["service_id"] == "gendarmerie" and got["finalites"] == ["secours"]
