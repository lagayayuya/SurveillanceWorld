"""The prefectoral acts: the reader on the Rhône's, the Moselle's and La Réunion's templates
(Attrap's texts recorded from the server, cleaned), the threshold, and the collection
through Attrap that never asks a host behind an anti-robot check."""

from __future__ import annotations

import datetime as dt
import json
import re

from collecte_fake import (  # noqa: F401
    ATTRAP,  # noqa: E402
    COMMUNES,
    FIX,
    KINDS,
    communes,
    ctx_for,
    raa,
)

import lacarte_registre as registre
from lacarte_collecte import parse_raa, seuil


# --- the reader, on each template --------------------------------------------------------------
def test_the_rhone_s_national_ids_and_its_counts():
    d = raa("pref69")
    acts = {
        a.acte: a for a in parse_raa.lire(d["content"], communes("69"), KINDS, dt.date(2026, 7, 3))
    }
    assert set(acts) == {"69-2026-06-30-00021", "69-2026-06-30-00013", "69-2026-07-02-00001"}
    mions = acts["69-2026-06-30-00021"]
    assert (mions.type, mions.gabarit, mions.insee) == ("videoprotection", "identifiants", "69133")
    assert mions.champs["n_total"] == 154 and mions.champs["n_voie_publique"] == 125
    drone = acts["69-2026-07-02-00001"]
    assert drone.type == "drone" and drone.champs["dates"] == ["2026-07-02"]
    assert drone.champs["horaires"] == ["11h00-15h00"]
    # its article 1 as written (who flies, why, where), up to article 2
    assert drone.champs["article_1"].startswith("Article 1")
    assert "Article 2" not in drone.champs["article_1"]
    # a model named without a number: no number (an absent number is better than a wrong one)
    assert drone.champs["n_cameras_drone"] is None


def test_the_moselle_s_headings_dates_without_a_year_and_its_page_foot():
    d = raa("pref57")
    [a] = [x for x in parse_raa.lire(d["content"], communes("57"), KINDS, dt.date(2026, 7, 8))
           if x.type == "drone"]  # fmt: skip
    # the blind reading of the PDF (2026-10-31): 2026-07-09 to 07-19, 18h00-03h00, 2, Metz
    assert (a.acte, a.gabarit, a.insee, a.date_acte) == ("371", "en-tete", "57463", "2026-07-08")
    assert a.champs["dates"][0] == "2026-07-09" and a.champs["dates"][-1] == "2026-07-19"
    # the prefecture's opening hours, « de 8h30 à 12h00 », are not flight hours
    assert a.champs["horaires"] == ["18h00-03h00"]
    assert a.champs["n_cameras_drone"] == 2


def test_an_overseas_single_act_pdf():
    d = raa("pref974")
    [a] = parse_raa.lire(d["content"], communes("974"), KINDS, dt.date(2026, 9, 29))
    assert (a.acte, a.type, a.insee) == ("2026-1714", "drone", "97407")
    # « le 30 septembre 2026 … et le 1° octobre 2026 » (the OCR's « 1° » for « 1er »)
    assert a.champs["dates"] == ["2026-09-30", "2026-10-01"]
    assert a.champs["n_cameras_drone"] == 2  # « est de deux (2) caméras »


def test_no_natural_person_in_what_the_reader_keeps():
    for name, dep in (("pref69", "69"), ("pref57", "57"), ("pref974", "974")):
        for a in parse_raa.lire(raa(name)["content"], communes(dep), KINDS, dt.date(2026, 7, 1)):
            text = json.dumps(a.as_dict(), ensure_ascii=False)
            assert not re.search(r"\b(?:M\.|Mme|Monsieur|Madame)\s+[A-Z]", text)
    assert parse_raa.mask("demande de Mme Jeanne Exemple, gérante") == "demande de […] , gérante"


# --- the threshold ------------------------------------------------------------------------------
def test_a_wrong_number_is_never_published(tmp_path):
    acts = [
        {"id": "69-1", "type": "videoprotection", "insee": "69133", "commune": "Mions",
         "champs": {"n_total": 12}},
        {"id": "69-2", "type": "videoprotection", "insee": "69133", "commune": "Mions",
         "champs": {"n_total": None}},
    ]  # fmt: skip
    head = "acte,dispositif,sous_type,commune,insee,n_total,lisible,source\n"
    (tmp_path / "69-videoprotection.csv").write_text(
        head + "69-1,videoprotection,autorisation,Mions,69133,12,oui,pdf\n"
        "69-2,videoprotection,autorisation,Mions,69133,,oui,pdf\n", "utf-8")  # fmt: skip
    m = seuil.mesurer(acts, tmp_path, registre.RULES)["69-videoprotection"]
    assert (m["mesures"], m["justes"], m["nombres_faux"], m["publie"]) == (2, 2, 0, True)
    acts[0]["champs"]["n_total"] = 13
    m = seuil.mesurer(acts, tmp_path, registre.RULES)["69-videoprotection"]
    assert (m["justes"], m["nombres_faux"], m["publie"]) == (1, 1, False)
    # an absent number is not right, but it is not wrong either
    v = seuil.juger(acts[1], {"dispositif": "videoprotection", "insee": "69133", "n_total": "7"})
    assert (v["juste"], v["nombre_faux"]) == (False, False)


def test_the_draw_is_the_same_for_the_same_acts():
    one_act = {"departement": "69", "type": "drone", "recueil_nom": "r", "url": "u",
               "recueil_date": "2025-01-01", "texte": "attrap"}  # fmt: skip
    acts = [{"id": f"69-{i:03d}", **one_act} for i in range(80)]
    one, two = (
        seuil.tirer(acts, "69", "drone", 30),
        seuil.tirer(list(reversed(acts)), "69", "drone", 30),
    )
    assert len(one) == 30 and one == two
    assert len(seuil.tirer(acts[:12], "69", "drone", 30)) == 12


def test_a_summary_s_leaders_do_not_hold_the_reader():
    """An Orne recueil (2026-11-07): « Arrêté portant… » followed by a long run of dots held
    the headings' regexes for hours (every split of the run tried), the GIL with them, and
    every server run was killed at 6 h. The run is cut to one character: read at once, the
    numbers unchanged."""
    import time

    # « … » is three dots once accents are stripped (NFKD): a summary's leaders
    text = (
        "Sommaire\nArrêté portant " + "…" * 260 + " 12\n"
        "Arrêté " + "…" * 260 + " 14\n"
        "Arrêté n° 2026-41 portant interdiction " + "-/" * 100 + "\n"
        "Arrêté préfectoral n° 61-2026-03-27-002 du 27 mars 2026 portant autorisation\n"
        "Article 1 : La captation est autorisée.\n"
    )  # fmt: skip
    t0 = time.perf_counter()
    found = parse_raa.heads(text)
    assert time.perf_counter() - t0 < 2.0
    assert [n for _, n in found] == [None, "2026-41", "61-2026-03-27-002"]


def test_headings_without_a_number_and_the_verb_that_is_not_one():
    """The Bouches-du-Rhône's and the Alpes-Maritimes' recueils (measured 2026-11-01): « Arrêté
    autorisant… » without « n° », a summary repeating it, « ARRETE » opening the dispositif."""
    text = (
        "RECUEIL DES ACTES ADMINISTRATIFS SPECIAL\nSommaire\n"
        "Arrêté autorisant la captation d'images au moyen de caméras installées sur des aéronefs\n"
        "\f\nArrêté autorisant la captation et la transmission d'images au moyen de caméras\n"
        "installées sur des aéronefs le dimanche 1er novembre 2026\n"
        "Vu le décret n° 2004-374 du 29 avril 2004 ;\n"
        "ARRETE\nArticle 1 : La captation d'images au moyen de quatre caméras installées sur des "
        "aéronefs est autorisée à Aubagne le 1er novembre 2026 de 6h00 à 23h59.\n"
        "Article 2 : Le présent arrêté peut faire l'objet d'un recours.\n"
        "ARRÊTÉ PORTANT OUVERTURE D'UNE ENQUÊTE PUBLIQUE\nARRÊTE\n"
        "Article 1 : L'enquête est ouverte.\n"
    )
    com = parse_raa.Communes({"13005": {"nom": "Aubagne", "dep": "13"}}, {"13"})
    pieces = parse_raa.split_acts(text)
    assert [p.gabarit for p in pieces] == ["en-tete", "en-tete"]  # the summary's line dropped
    [a] = parse_raa.lire(text, com, KINDS, dt.date(2026, 10, 31))
    assert (a.type, a.insee, a.date_acte) == ("drone", "13005", "2026-10-31")  # not 2004
    assert a.champs["dates"] == ["2026-11-01"] and a.champs["n_cameras_drone"] == 4


def test_the_verb_before_a_page_foot_is_not_a_heading():
    """The Préfecture de police's acts published alone (2026-00550, measured 2026-11-09): its
    « ARRÊTE : » falls at a page's end, the next page's foot « N° 2026-00550 3 » before
    article 1; read as a heading, the act was cut there and lost its title."""
    text = (
        "PREFECTURE DE POLICE\nCABINET DU PRÉFET\nArrêté n°2026-00550\n"
        "autorisant la captation, l'enregistrement et la transmission d'images au moyen de "
        "caméras \ninstallées sur des aéronefs à Paris le samedi 9 mai 2026\n"
        "Le préfet de police,\nVu le code de la sécurité intérieure ;\n"
        "Considérant la manifestation prévue le 9 mai 2026 ;\nARRETE\xa0:\n"
        "N°\xa02026-00550 3\nArticle 1er – La captation, l'enregistrement et la transmission "
        "d'images par la direction de l'ordre public et de la circulation sont autorisés à "
        "Paris le 9 mai 2026 de 10h00 à 20h00.\nArticle 2 – Le présent arrêté est publié.\n"
    )
    assert [n for _, n in parse_raa.heads(text)] == ["2026-00550"]
    com = parse_raa.Communes({"75056": {"nom": "Paris", "dep": "75"}}, {"75"})
    [a] = parse_raa.lire(text, com, KINDS, dt.date(2026, 5, 8))
    assert (a.acte, a.type) == ("2026-00550", "drone")
    assert a.titre.startswith("Arrêté n°2026-00550 autorisant la captation")


def test_a_helicopter_s_captation_is_an_aerial_act_with_its_aircraft_s_words():
    """2026-01165 (measured 2026-11-09): « caméras installées sur deux hélicoptères », no
    « aéronef » in its title; collected with the drones' type, told apart at the build."""
    text = (
        "Arrêté n°2026-01165\nautorisant la captation, l'enregistrement et la transmission "
        "d'images au moyen de caméras installées sur deux hélicoptères du 25 au 26 septembre "
        "2026\nVu la demande visant à transmettre des images au moyen de deux caméras "
        "installées chacune sur les deux hélicoptères mobilisés ;\nARRÊTE :\nArticle 1er – La "
        "captation est autorisée à Paris du 25 au 26 septembre 2026.\nArticle 2 – Publié.\n"
    )
    [a] = parse_raa.lire(text, parse_raa.Communes({}, set()), KINDS, dt.date(2026, 9, 18))
    assert a.type == "drone" and "helicopteres mobilises" in a.champs["aeronef_extrait"]
    out = parse_raa.lire(
        "Arrêté n° 12 autorisant le survol de Lyon par hélicoptère pour des travaux\nARRÊTE :\n"
        "Article 1er – Le survol est autorisé.\n",
        parse_raa.Communes({}, set()), KINDS, dt.date(2026, 9, 18),
    )  # fmt: skip
    assert out == []  # an overflight allowed films nothing


def test_a_single_act_whose_title_comes_before_its_heading():
    """2025-00732 (measured 2026-11-10): the text layer put « autorisant la captation… sur
    des aéronefs » above « Arrêté n°2025-00732 », whose next line is its day."""
    text = (
        "PREFECTURE DE POLICE\nautorisant la captation, l'enregistrement et la transmission "
        "d'images au moyen de caméras installées sur des aéronefs à l'occasion d'une "
        "manifestation à Paris\nVu le décret n° 2004-374 du 29 avril 2004 ;\n"
        "Arrêté n°2025-00732\n\nle jeudi 12 juin 2025\n\nLe préfet de police,\n"
        "Vu le code de la sécurité intérieure ;\nARRÊTE :\nArticle 1er – La captation, "
        "l'enregistrement et la transmission d'images par la direction de l'ordre public et de "
        "la circulation sont autorisés à Paris le 12 juin 2025.\nArticle 2 – Publié.\n"
    )
    [a] = parse_raa.lire(text, parse_raa.Communes({}, set()), KINDS, dt.date(2025, 6, 10))
    assert (a.acte, a.type) == ("2025-00732", "drone")
    assert a.titre.startswith("Arrêté n°2025-00732 autorisant la captation")


def test_reader_10_reads_the_elided_labelled_and_ocr_forms_and_never_sums_a_part():
    """Measured 2026-11-10 on three drawings: « 12 caméras intérieures et 4 extérieures », the
    Bas-Rhin's labels with « O » for 0, the Gironde's « caméra(s) », the OCR's « caméres »;
    a kind named without a readable number gives no total."""

    def cams(t):
        return parse_raa.cams_vp(parse_raa.strip("ARRÊTE : Article 1er - " + t), "autorisation")

    assert (
        cams("Ce dispositif qui comprend 12 caméras intérieures et 4 extérieures.")["n_total"] == 16
    )
    lab = cams("Nombre de caméras intérieures : 4Nombre de caméras extérieures : ONombre de "
               "caméras filmant la voie publique : Oenregistrement : oui")  # fmt: skip
    assert (lab["n_interieur"], lab["n_exterieur"], lab["n_voie_publique"], lab["n_total"]) == (
        4, 0, 0, 4)  # fmt: skip
    assert cams("pour 5 caméra(s) intérieure(s) et 2 caméra(s) extérieure(s).")["n_total"] == 7
    assert cams("composé de 10 caméras intérieures et de 5 caméres extérieures.")["n_total"] == 15
    assert cams("composé de 3 caméras intérieures et de G caméras extérieures.")["n_total"] is None


def test_reader_10_keeps_a_camera_act_s_holder_words_and_its_file_number():
    text = (
        "Arrêté CAB/SPAS/VIDÉO/25-214 portant autorisation d'un système de vidéoprotection "
        "(dossier n°20250384)\nVU la demande présentée par M. Jean Dupont, agissant en sa qualité "
        "de gérante de la société dénommée S.A.R.L. LA LICORNE, au sein de l'établissement situé "
        "14 rue de Mayence - 44000 NANTES ;\nARRÊTE :\nArticle 1er - M. Jean Dupont est "
        "autorisé à mettre en œuvre un système comportant un total de 3 caméras.\n"
    )
    [a] = parse_raa.lire(text, parse_raa.Communes({}, set()), KINDS, dt.date(2025, 1, 1))
    assert a.champs["dossier"] == "20250384"
    assert "société dénommée" in a.champs["titulaire_extrait"]
    assert "Dupont" not in a.champs["article_1"]  # a name after a civility masked


def test_a_reference_without_insee_is_compared_by_the_commune_s_name():
    read = {"type": "videoprotection", "insee": "69383", "commune": "Lyon",
            "champs": {"n_total": 4}}  # fmt: skip
    ref = {"dispositif": "videoprotection", "commune": "Lyon 3ème", "n_total": "4"}
    assert seuil.juger(read, ref)["juste"]
    assert not seuil.juger(read, {**ref, "commune": "Villeurbanne"})["juste"]


def test_an_acts_article_1_as_written_from_arrete_to_article_2():
    t = (
        "Vu le code ; Considérant que la manifestation… ARRÊTE\nArticle  1er – La captation "
        "est autorisée au profit de la direction  de la police nationale,\nau titre du 2° de "
        "l'article L. 242-5.\nArticle 2 – Le nombre maximal de caméras est fixé à deux."
    )
    a = parse_raa.article_1(t)
    assert a == (
        "Article 1er – La captation est autorisée au profit de la direction de la police "
        "nationale, au titre du 2° de l'article L. 242-5."
    )
    assert parse_raa.article_1("Vu le code. Article premier : X. Art. 2 : Y.") == (
        "Article premier : X."
    )
    assert parse_raa.article_1("Aucun article ici.") == ""


def test_the_act_s_day_written_in_figures_in_its_heading():
    # Hauts-de-Seine: the recueil of 24 January 2025 carries an act of 12 September 2024
    fallback = dt.date(2025, 1, 24)
    head = (
        "Arrêté CAB/DS/BPS n° 2024.885 du 12/09/2024 modifiant l'exploitation d'un "
        "système de vidéoprotection délivré à la commune de Rueil-Malmaison"
    )
    assert parse_raa.act_date(head, fallback) == dt.date(2024, 9, 12)
    # the first day written wins, whichever its form; a visa's is never read
    late = dt.date(2025, 6, 1)
    assert parse_raa.act_date("Arrêté du 3 mars 2025 (modifié le 05/04/2025)", late) == (
        dt.date(2025, 3, 3)
    )
    assert parse_raa.act_date("Arrêté n° 2024.1 Vu le décret du 29/04/2004", fallback) == fallback
    assert parse_raa.act_date("Arrêté du 31/02/2024", fallback) == fallback
    # a recueil is often dated a few days before its acts; a year later is a misprint
    assert parse_raa.act_date("Arrêté du 11 mars 2075 ; du 11/03/2025", dt.date(2025, 3, 11)) == (
        dt.date(2025, 3, 11)
    )
    assert parse_raa.act_date("Arrêté du 18/09/2025", dt.date(2025, 9, 17)) == dt.date(2025, 9, 18)


def test_an_aerial_act_that_films_nothing_for_the_state_is_no_drone_act():
    op = "article 1er : la captation est autorisee au moyen de cameras installees sur des aeronefs"
    kept = [
        "Arrêté autorisant la captation, l'enregistrement et la transmission d'images au moyen de "
        "caméras installées sur des aéronefs à l'occasion du concert et du feu d'artifice",
        "AP Drones DIPN76 LE HAVRE JNA 18 septembre 2025",
        "Arrêté portant autorisation de captation d'images par aéronefs et interdiction de survol",
    ]
    for t in kept:
        assert parse_raa.classify(t, op, KINDS) == "drone", t
    gone = [
        "Arrêté portant interdiction temporaire de survol du Centre Pénitentiaire des Baumettes à "
        "Marseille par des aéronefs télé-pilotés (drones)",
        "Arrêté portant interdiction de survol, de captation, d'enregistrement et de transmission "
        "d'images au moyen d'aéronefs sans équipage à bord sur la commune de Sens",
        "Arrêté autorisant le brouillage des aéronefs circulant sans personne à bord",
        "Arrêté autorisant les services de la police nationale à utiliser des dispositifs destinés "
        "à rendre inopérant l'équipement radioélectrique d'aéronefs",
        "Arrêté n°2026-01215 autorisant un spectacle aérien public d'aéronefs sans équipage à bord",
        "Arrêté préfectoral portant interdiction temporaire et d'évolution des aéronefs",
        "20260824 AP InterdictionSurvolDrone AerodromeAuxerreBranche",
    ]
    for t in gone:
        assert parse_raa.classify(t, op, KINDS) is None, t


def test_reader_11_never_places_a_camera_act_in_its_authority_s_town():
    """A fresh drawing (2026-11-11, frozen from the Moselle's and the Pas-de-Calais's acts):
    the prefecture's page foot (« 57034 METZ CEDEX 1 ») read inside article 1 placed an act
    of Freyming-Merlebach in Metz; the act's commune is its request's visa, « situé … 57800
    Freyming-Merlebach », article 1 saying only « à l'adresse sus-indiquée »."""
    com = parse_raa.Communes(
        {
            "57463": {"nom": "Metz", "dep": "57"},
            "57240": {"nom": "Freyming-Merlebach", "dep": "57"},
            "57631": {"nom": "Sarreguemines", "dep": "57"},
        },
        {"57"},
    )
    text = (
        "Arrêté CAB/DS/PPA-VIDEO/25-451 portant autorisation de fonctionnement d'un système "
        "de vidéoprotection\nLe préfet de la Moselle\nChevalier de la Légion d'honneur\n"
        "VU le code de la sécurité intérieure, notamment ses articles L. 251-1 à L. 255-1, "
        "R. 251-1 à R. 254-2 ;\nVU l'arrêté ministériel du 3 août 2007 portant définition des "
        "normes techniques des systèmes de vidéosurveillance et ses annexes techniques ;\n"
        "VU la demande présentée par Mme Jeanne Dupont représentant "
        "l'établissement « Les Floralies » situé 238, avenue de l'Europe 57800 "
        "FREYMING-MERLEBACH ainsi que les pièces produites ;\nARRÊTE\nArticle 1 - Dispositif "
        "autorisé\nMme Jeanne Dupont est autorisée à exploiter à l'adresse sus-indiquée un "
        "système composé de 17 caméras extérieures,\n1/4 Préfecture de la Moselle - 9, place "
        "Jean-Marie Rausch - BP 71014 - 57034 METZ CEDEX 1 - Tél. : 03 87 34 87 34\n"
        "Article 2 - La sous-préfète de Sarreguemines est chargée de l'exécution.\n"
        "Fait à Metz, le 24 novembre 2025\n"
    )
    [a] = parse_raa.lire(text, com, KINDS, dt.date(2025, 11, 24))
    assert (a.commune, a.insee) == ("Freyming-Merlebach", "57240")


def test_reader_11_reads_a_title_s_commune_written_with_underscores():
    """The Pas-de-Calais's titles (« … vidéoprotection _ ST_Martin_Boulogne »), its address
    « 62020 ARRAS CEDEX 9 » and its name « Pas-de-Calais » (no act of Calais) inside article 1."""
    com = parse_raa.Communes(
        {
            "62041": {"nom": "Arras", "dep": "62"},
            "62193": {"nom": "Calais", "dep": "62"},
            "62758": {"nom": "Saint-Martin-Boulogne", "dep": "62"},
        },
        {"62"},
    )
    text = (
        "Arrêté CAB/VIDEO/24-14 portant autorisation d'installation d'un système de "
        "vidéoprotection _ ST_Martin_Boulogne\nLe préfet du Pas-de-Calais\nVU le code ;\n"
        "ARRÊTE :\n"
        "Article 1 : le système de vidéoprotection dont les caractéristiques suivent est "
        "autorisé : rue Ferdinand Buisson 62020 ARRAS CEDEX 9 - Tél : 03 21 21 20 00\n"
        "Article 2 - Le public est informé.\n"
    )
    [a] = parse_raa.lire(text, com, KINDS, dt.date(2024, 2, 2))
    assert a.commune == "Saint-Martin-Boulogne"
    # without its title's commune, the authority's address and name place it nowhere
    alone = text.replace("_ ST_Martin_Boulogne", "")
    [b] = parse_raa.lire(alone, com, KINDS, dt.date(2024, 2, 2))
    assert b.commune is None


def test_reader_12_never_reads_a_departement_s_name_as_its_commune():
    """A fresh drawing (2026-11-11): a Besançon shop placed in the commune of Doubs, read in the
    letterhead « PRÉFET CABINETdu Doubs » the extraction glued (a page break inside article 1),
    where the authority's name is not blanked; Doubs is still read where it is one."""
    com = parse_raa.Communes(
        {"25056": {"nom": "Besançon", "dep": "25"}, "25204": {"nom": "Doubs", "dep": "25"}},
        {"25"},
    )
    text = (
        "Arrêté portant autorisation d'installation d'un système de vidéoprotection dans "
        "l'établissement ESPACE SOM\nLe préfet du Doubs\nVU le code de la sécurité intérieure, "
        "notamment ses articles L. 251-1 à L. 255-1, R. 251-1 à R. 254-2 ;\nVU l'arrêté "
        "ministériel du 3 août 2007 portant définition des normes techniques des systèmes de "
        "vidéosurveillance et ses annexes techniques ;\nVU l'avis de la commission "
        "départementale de vidéoprotection ;\nVU la demande présentée pour l'établissement "
        "ESPACE SOM situé 43 rue d'Arènes 25000 Besançon ;\nARRÊTE\nArticle 1 : "
        "l'établissement est autorisé à installer 3 caméras intérieures.\n2/3 PRÉFET "
        "CABINETdu Doubs Direction des sécurités\nArticle 2 : Le public est informé.\n"
    )
    [a] = parse_raa.lire(text, com, KINDS, dt.date(2026, 2, 9))
    assert a.commune == "Besançon"
    shop = text.replace("ESPACE SOM\nLe", "GIFI à DOUBS\nLe")
    [b] = parse_raa.lire(shop, com, KINDS, dt.date(2026, 2, 9))
    assert b.commune == "Doubs"


def test_reader_12_never_reads_a_street_s_commune():
    """« 1 route de Hoerdt 67550 Vendenheim »: the establishment is in Vendenheim, not in Hœrdt
    (the first drawing's « route de Clisson - 44115 Basse-Goulaine » the same)."""
    com = parse_raa.Communes(
        {
            "67506": {"nom": "Vendenheim", "dep": "67"},
            "67205": {"nom": "Hœrdt", "dep": "67"},
            "67482": {"nom": "Strasbourg", "dep": "67"},
        },
        {"67"},
    )
    text = (
        "ARRETE PREFECTORAL PORTANT AUTORISATION D'UN SYSTEME DE VIDEOPROTECTION\n"
        "VU le code de la sécurité intérieure ;\nVU la demande présentée concernant "
        "l'établissement Casse auto démolition situé 1 route de Hoerdt 67550 Vendenheim ;\n"
        "ARRÊTE\nArticle 1 : L'autorisation est accordée pour cinq ans, pour 4 caméras "
        "extérieures, au 1 route de Hoerdt 67550 Vendenheim.\n"
    )
    [a] = parse_raa.lire(text, com, KINDS, dt.date(2024, 5, 2))
    assert a.commune == "Vendenheim"
    elsewhere = text.replace("route de Hoerdt 67550 Vendenheim", "rue de Strasbourg 67720 Hoerdt")
    [b] = parse_raa.lire(elsewhere, com, KINDS, dt.date(2024, 5, 2))
    assert b.commune == "Hœrdt"


def test_reader_12_reads_oe_as_the_names_oe():
    """Hœnheim, Paimbœuf, Nœux-les-Mines: the texts write « oe », the names « œ »."""
    assert parse_raa.loose("Hœnheim") == parse_raa.loose("HOENHEIM") == "hoenheim"
    com = parse_raa.Communes({"44116": {"nom": "Paimbœuf", "dep": "44"}}, {"44"})
    assert com.first("situé rue Pierre Jubeau - 44560 PAIMBOEUF") == ("Paimbœuf", "44116")
