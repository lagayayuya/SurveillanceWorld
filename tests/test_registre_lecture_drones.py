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


def test_a_drone_act_s_sector_is_placed_by_arrondissement_place_commune_or_departement():
    """rule:registre_drones@1:secteur, on the police prefecture family's own words."""
    import lacarte_registre as registre
    from lacarte_registre.lecture_drones import situer

    noms = {"paris": "75056", "saint-denis": "93066", "pantin": "93055"}
    r = registre.RULES
    assert situer("dans certains secteurs du 19ème arrondissement de Paris", noms, r) == {
        "secteur_niveau": "arrondissement", "secteur_insee": ["75119"],
        "secteur": "Paris 19e"}  # fmt: skip
    stade = situer("au match de football précité au Parc des Princes le 27 septembre", noms, r)
    assert stade == {"secteur_niveau": "lieu", "secteur_lieu": "Parc des Princes",
                     "secteur": "Parc des Princes"}  # fmt: skip
    # the place, never the event: no person served (Ju, 2026-11-09)
    concert = situer("en Seine-Saint-Denis à l'occasion des concerts de Jeanne DUPONT au "
                     "Stade de France", noms, r)  # fmt: skip
    assert concert["secteur"] == "Stade de France" and "DUPONT" not in str(concert)
    assert situer("l'autorisation porte sur la mise en place", noms, r)["secteur_niveau"] != "lieu"
    libelles = {"93066": "Saint-Denis", "93055": "Pantin"}
    assert situer("sur les communes de Saint-Denis et Pantin (93)", noms, r, None, libelles) == {
        "secteur_niveau": "commune", "secteur_insee": ["93055", "93066"],
        "secteur": "Pantin, Saint-Denis"}  # fmt: skip
    assert situer("dans le département de la Seine-Saint-Denis", noms, r) == {
        "secteur_niveau": "departement"}  # fmt: skip
    assert situer("à l'occasion de l'événement susvisé", noms, r) == {"secteur_niveau": "non_lu"}
    assert situer(None, noms, r) == {"secteur_niveau": "non_lu"}


def test_a_place_the_text_layer_broke_is_no_place_its_commune_instead():
    import lacarte_registre as registre
    from lacarte_registre.lecture_drones import situer

    noms, lib, r = {"paris": "75056"}, {"75056": "Paris"}, registre.RULES
    assert situer("à la Cathédrale Notr e-Dame de Paris le 8", noms, r, None, lib) == {
        "secteur_niveau": "commune", "secteur_insee": ["75056"], "secteur": "Paris"}  # fmt: skip
    assert situer("au Stade de2024-01014 2 France", noms, r)["secteur_niveau"] != "lieu"
    hippo = situer("à l'Hippodrome de Paris -Longchamp le 5", noms, r)
    assert hippo["secteur_lieu"] == "Hippodrome de Paris-Longchamp"


def test_a_list_of_arrondissements_and_the_communes_beside_them():
    """75-2024-08-16-00012 (B, 2026-11-10): « à Paris 18 ème et 19 ème ainsi que sur les
    communes de Saint-Denis et Pantin (93) » was read « Paris 18e » alone."""
    import lacarte_registre as registre
    from lacarte_registre.lecture_drones import situer

    noms = {"paris": "75056", "saint-denis": "93066", "pantin": "93055"}
    libelles = {"75056": "Paris", "93066": "Saint-Denis", "93055": "Pantin"}
    r = registre.RULES
    words = ("à Paris 18 ème et 19 ème ainsi que sur les communes de Saint-Denis et Pantin (93) "
             "dans le cadre des compétitions sportives")  # fmt: skip
    assert situer(words, noms, r, "paris", libelles) == {
        "secteur_niveau": "arrondissement",
        "secteur_insee": ["75118", "75119", "93055", "93066"],
        "secteur": "Paris 18e, 19e, Pantin, Saint-Denis"}  # fmt: skip
    assert situer("dans les 18e et 19e arrondissements de Paris", noms, r)["secteur_insee"] == [
        "75118", "75119"]  # fmt: skip


def test_a_shared_drone_act_s_copies_take_their_original_s_place():
    """B (2026-11-10): 75-2025-10-23-00040 placed in Aubervilliers' file, its raw words in
    Pantin's; each copy of an act of several communes now says what its original says."""
    from lacarte_registre.lecture_drones import aux_copies

    o = {"id": "a", "t": "arrete_drone", "insee": "93001", "secteur_niveau": "commune",
         "secteur_insee": ["93001", "93055"], "secteur": "Aubervilliers, Pantin"}  # fmt: skip
    copy = {"id": "a", "t": "arrete_drone", "insee": "93055", "insee0": "93001",
            "secteur": "le 24 octobre 2025 à Aubervilliers et Pantin (93)"}  # fmt: skip
    by_insee = {"93001": [o], "93055": [copy]}
    assert aux_copies(by_insee, {"a": o}) == 1
    assert {k: copy.get(k) for k in ("secteur", "secteur_niveau", "secteur_insee")} == {
        "secteur": "Aubervilliers, Pantin", "secteur_niveau": "commune",
        "secteur_insee": ["93001", "93055"]}  # fmt: skip
    assert copy["insee"] == "93055" and aux_copies(by_insee, {"a": o}) == 0
