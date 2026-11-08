"""The motive of a drone act by the measured rules (rules/registre_motifs.yaml): the purposes
of L. 242-5 and closing phrases are not a motive, a class not measured is never served, and
the model's reading comes first. The acts below are invented, in the words the acts use."""

from __future__ import annotations

import pytest

import lacarte_registre as registre
from lacarte_registre import collecte, motifs

R = registre.RULES
A1 = (
    "Article 1er : La captation, l'enregistrement et la transmission d'images par la "
    "direction interdépartementale de la police nationale sont autorisées au titre de la "
    "prévention des atteintes à la sécurité des personnes et des biens, de la sécurité des "
    "rassemblements de personnes et de la régulation des flux de transport"
)


@pytest.mark.parametrize(
    ("titre", "article_1", "classe"),
    [
        ("Arrêté autorisant … à l'occasion d'une manifestation à Rennes le samedi 3 octobre",
         A1, "manifestation"),
        ("Arrêté drones mobilisation lycéenne", A1, "manifestation"),
        ("Arrêté … à l'occasion du match de football entre le FC Metz et le LOSC", A1, "sport"),
        ("Arrêté … dans le cadre de la lutte contre le trafic de stupéfiants", A1, "stupefiants"),
        ("Arrêté … à l'occasion du festival de musique de Belfort", A1, "concert_fete"),
        ("Arrêté … à l'occasion de la cérémonie du 11 novembre", A1, "commemoration"),
        # the purposes alone, as most articles 1 give them: no motive
        ("Arrêté autorisant la captation d'images au moyen de caméras sur des aéronefs", A1, None),
        # the purpose 1° of L. 242-5 names drugs: a purpose, not an anti-drug operation
        ("Arrêté autorisant la captation …", A1 + ", dans des lieux particulièrement exposés à "
         "des risques d'agression, de vol ou de trafic d'armes, d'êtres humains ou de "
         "stupéfiants", None),
        # a closing article's « à l'issue de la manifestation » is any event
        ("Arrêté autorisant la captation …", A1 + ". Article 5 : le registre est transmis à "
         "l'issue de la manifestation.", None),
        # a street, a shop, a service: not a stadium's match, not a border
        ("Arrêté … périmètre : rue du stade, supermarché Match", A1, None),
        ("Arrêté … par la direction de la police aux frontières", A1, None),
        # a demonstration followed by a concert is a mixed motive: not read
        ("Arrêté … à l'occasion de la manifestation suivie du concert", A1, None),
        ("Arrêté … sécurisation des fêtes juives", A1, None),
    ],
)  # fmt: skip
def test_a_drone_acts_class(titre, article_1, classe):
    assert motifs.classe(titre, article_1, R) == classe


def test_a_class_not_measured_is_never_served():
    a = {"type": "drone", "titre": "Arrêté … contre le franchissement irrégulier de la "
         "frontière par des migrants", "champs": {"article_1": A1}}  # fmt: skip
    assert motifs.classe(a["titre"], A1, R) == "frontiere"  # read, 11 acts: not measured
    assert motifs.motif(a, R) is None
    a["titre"] = "Arrêté … à l'occasion du concert de l'artiste au stade"
    assert motifs.motif(a, R) == {"categorie": "concert_fete", "libelle": None,
                                  "origine": "regles"}  # fmt: skip


def test_every_served_class_passed_its_measure_and_the_interface_names_it():
    import json

    import yaml

    conf = yaml.safe_load((R / motifs.FILE).read_text("utf-8"))
    names = yaml.safe_load((R / "collecte_champs.yaml").read_text("utf-8"))["motifs"]
    fr = json.loads((registre.RULES.parent / "web/src/locales/fr.json").read_text("utf-8"))
    for c in conf["classes"]:
        assert c["id"] in names  # the model's closed list
        assert f"registre.carte.motif_{c['id']}" in fr
        if c["publie"]:
            right, n = map(int, c["mesure"].split()[0].split("/"))
            assert n == 50 and right >= 48  # 95 % or more (Ju, 2026-11-08)


def test_an_act_event_carries_the_rules_motive_unless_the_model_read_one():
    act = {"id": "pref57:0123456789ab:12", "type": "drone", "sous_type": None,
           "titre": "Arrêté … à l'occasion du match de football de Ligue 1", "acte": "12",
           "champs": {"article_1": A1}, "administration": "pref57", "recueil": "r",
           "recueil_nom": "Recueil spécial", "recueil_date": "2026-10-02", "url": "u",
           "gabarit": "numero", "commune": None, "insee": None}  # fmt: skip
    admin = {"code": "57", "genre": "departement", "nom": "Moselle"}
    e = collecte.act_event(act, admin, set(), None, None)
    assert e["motif"] == {"categorie": "sport", "libelle": None, "origine": "regles"}
    final = {"champs": {}, "nouveaux": {"motif": "manifestation", "motif_libelle": "grève"}}
    e = collecte.act_event(act, admin, {"motif", "motif_libelle"}, final, None)
    assert e["motif"] == {"categorie": "manifestation", "libelle": "grève", "origine": "modele"}
