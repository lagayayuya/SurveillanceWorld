"""The documents of one project tied into a dossier (dossiers.py, lot R5 section 3). The
titles and amounts are real ones from the 50 dossiers read by hand on 2026-11-05."""

from __future__ import annotations

import pytest

import lacarte_registre as registre
from lacarte_registre import dossiers

CONF = dossiers.rules(registre.RULES / "registre_dossiers.yaml")


def _aff(id_="u1", date="2020-07-15", montant=81843.0, **kw):
    return {
        "id": id_,
        "acheteur_siren": "217702778",
        "insee": "77277",
        "communal": True,
        "natures": ["fourniture_installation"],
        "cameras": None,
        "titre": "Fourniture et mise en œuvre de matériels de vidéoprotection urbaine",
        "contrat": {"id": f"{id_}~0", "date": date, "montant": montant},
        "avis": [],
        **kw,
    }


def test_a_grant_and_the_one_contract_of_its_cost_are_sure():
    g = {"id": "dgcl-2020-17951", "annee": "2020", "date": "2020-12-31", "base": 81843.0}
    link = dossiers.lien_subvention(g, [_aff()], CONF)
    assert (link["niveau"], link["vers"]) == ("sur", "u1")
    assert "coût subventionnable = 1.0" in link["raison"]


def test_a_grant_never_pays_a_contract_far_from_its_cost():
    # a police uniforms contract at 0.04 of the grant's eligible cost (Choisy-le-Roi)
    g = {"id": "CP2022-128/EX064110", "annee": None, "date": "2022-05-20", "base": 1638927.0}
    assert dossiers.lien_subvention(g, [_aff(date="2022-03-24", montant=70000.0)], CONF) is None
    # a framework's ceiling at 2.24 times the cost, the buyer's only contract: a suggestion
    g = {"id": "dgcl-2025-8461", "annee": "2025", "date": "2025-12-31", "base": 196340.0}
    link = dossiers.lien_subvention(g, [_aff(date="2026-03-19", montant=440271.7)], CONF)
    assert link["niveau"] == "suggere"


def test_maintenance_alone_is_not_what_a_grant_pays():
    g = {"id": "g", "annee": "2020", "date": "2020-12-31", "base": 81843.0}
    assert dossiers.lien_subvention(g, [_aff(natures=["maintenance"])], CONF) is None


@pytest.mark.parametrize(
    ("titre", "nom", "communal"),
    [
        ("PREF/CABINET/BPA 2021-098 DU 05 MARS 2021 MAIRIE D'ANNEMASSE", "Annemasse", True),
        ("ARRÊTÉ PORTANT MODIFICATION D'UN SYSTÈME DE VIDÉOPROTECTION - MAIRIE D'ARLES.odt",
         "Arles", True),
        ("Arrêté n° DS-2024/ 2496 portant autorisation d'installation d'un système de "
         "vidéoprotection au bénéfice de la commune de Renaison", "Renaison", True),
        # a place, not the holder
        ("ARRÊTÉ PREFECTORAL portant autorisation d'installation d'un système de "
         "Vidéoprotection Commune de SANARY-SUR-MER (Supermarché Casino)", "Sanary-sur-Mer",
         False),
        ("ARRÊTÉ PRÉFECTORAL portant modification d'installation d'un système de "
         "Vidéoprotection Commune de BRIGNOLES (Territoire communal)", "Brignoles", True),
        ("TABAC DE LA MAIRIE -ALES signedFL", "Alès", False),
        # an event's system
        ("Arrêté portant autorisation d'exploitation d'un système de videoprotection pour la "
         "ville de Lyon pour la FETE DES LUMIERES 2024.odt", "Lyon", False),
    ],
)  # fmt: skip
def test_the_commune_own_act(titre, nom, communal):
    act = {"id": "a", "sous_type": "autorisation", "titre": titre}
    assert dossiers.arrete_communal(act, nom, CONF) is communal


def test_the_act_nearest_after_the_contract_within_two_years():
    acts = [
        {"id": "before", "date": "2019-12-01", "cameras": None},
        {"id": "after", "date": "2021-01-10", "cameras": None},
        {"id": "late", "date": "2023-01-10", "cameras": None},
    ]
    link = dossiers.lien_arrete(_aff(), acts, CONF)
    assert (link["de"], link["niveau"]) == ("after", "suggere")
    # the same number of cameras makes it sure
    link = dossiers.lien_arrete(_aff(cameras=18), [{**acts[1], "cameras": 18}], CONF)
    assert link["niveau"] == "sur"


def test_cameras_mapped_after_the_act():
    dates = ["2020-01-01", "2021-03-01", "2022-12-31", None, "2024-01-01"]
    assert dossiers.cameras_apres(dates, "2021-01-10", CONF) == 2


def test_what_does_not_tie_is_listed():
    notice = {"id": "26-1", "date": "2026-01-01", "nature": "avis", "objet": "x"}
    alone = _aff("u2", contrat=None, avis=[notice])
    g = {"id": "g9", "annee": "2025", "date": "2025-12-31", "siren": "000000000", "base": 1.0}
    res = dossiers.assembler([_aff(), alone], [g], [], {}, {}, CONF)
    assert res["sans_lien"] == {
        "subvention_sans_contrat": ["g9"],
        "contrat_sans_avis": ["u1"],
        "avis_sans_attribution": ["u2"],
    }
