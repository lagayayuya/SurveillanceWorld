"""What a contract buys, read from its objet and CPV (natures.py, lot R5 section 2). The
objets are real ones from the DECP samples read by hand on 2026-11-05."""

from __future__ import annotations

import pytest

import lacarte_registre as registre
from lacarte_registre import natures

R = natures.load(registre.RULES / "registre_natures.yaml")


@pytest.mark.parametrize(
    ("objet", "cpv", "attendu"),
    [
        ("INSTALLATI° MAINTENANCE D’1 SYSTEME VIDEOPROTECT°", "32323500",
         ["fourniture_installation", "maintenance"]),
        # « des installations » is what is maintained, not an installation bought
        ("Maintenance des installations de détection intrusion, de vidéoprotection et de "
         "contrôle d’accès - Indre (36)", "35120000", ["maintenance"]),
        # advice absorbs the supply it is about
        ("ASSISTANCE AU MAITRE D’OUVRAGE POUR L’INSTALLATION DE NOUVELLES CAMERAS DE "
         "VIDÉOPROTECTION", "71300000", ["conseil_amo"]),
        # « étude » inside an installation's tasks is not advice
        ("la fourniture et le raccordement de 27 caméras - des prestations d’étude, d’essai et "
         "de mise en service", "32323500", ["fourniture_installation"]),
        # the « salle du conseil » is a room
        ("Réaménagement des salles des mariages et du conseil de l’Hôtel de Ville", "45262700",
         ["travaux_genie_civil"]),
        ("FOURNITURE, INTEGRATION ET INTERFACAGE DE CAPTEURS LAPI (Lecteurs Automatisés de "
         "Plaques Minéralogiques)", "51314000", ["fourniture_installation", "lecture_plaques"]),
        ("AMENAGEMENT DU CSU", "35120000", ["travaux_genie_civil", "centre_supervision"]),
        ("EXTENSION ET REPRISE PARTIELLE DU RÉSEAU DE VIDEO PROTECTION ET DÉPLOIEMENT DE FIBRE "
         "OPTIQUE", "45314000", ["fourniture_installation", "reseau_fibre"]),
    ],
)  # fmt: skip
def test_natures_from_the_objet(objet, cpv, attendu):
    assert natures.classer(objet, [cpv], R)["natures"] == attendu


def test_the_cpv_only_when_the_objet_names_no_action():
    r = natures.classer("VIDEOPROTECTION", ["45233292"], R)
    # the longest prefix wins: 4523329 (security devices' installation), not 452 (works)
    assert r["natures"] == ["fourniture_installation"]
    assert r["raisons"]["fourniture_installation"]["par"] == "cpv"
    r = natures.classer("Maintenance du dispositif de vidéoprotection urbaine", ["32323500"], R)
    assert r["natures"] == ["maintenance"]


def test_a_watching_service_takes_nothing_from_its_cpv():
    r = natures.classer(
        "GESTION DE TÉLÉSURVEILLANCE DANS LES BÂTIMENTS COMMUNAUX DE GENNEVILLIERS",
        ["32323500"],
        R,
    )
    assert r["natures"] == ["autre"]


def test_every_nature_says_its_rule_and_what_matched():
    r = natures.classer("Acquisition de 8 caméras dédiées aux dépôts sauvages", ["35125300"], R)
    assert r["raisons"]["fourniture_installation"] == {
        "regle": "rule:registre_natures@1:fourniture_installation",
        "par": "mots",
        "valeur": "acquisition",
    }


def test_a_company_role_per_buyer():
    roles = natures.roles_entreprise(
        [
            ("216901231", ["fourniture_installation", "maintenance"]),
            ("216901231", ["maintenance"]),
            ("200046977", ["conseil_amo", "centre_supervision"]),
        ],
        R,
    )
    assert roles["216901231"] == {"entretient": 2, "installe": 1}
    assert roles["200046977"] == {"conseille": 1}
