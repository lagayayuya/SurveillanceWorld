"""The cameras a territory's acts authorise (cameras.py, rules/registre_cameras.yaml)."""

from __future__ import annotations

import lacarte_registre as registre
from lacarte_registre import cameras

R = registre.RULES


def test_the_holder_is_read_on_article_1_s_subject_then_the_visas_then_the_title():
    def who(a1="", pour="", titre=""):
        return cameras.titulaire({"article_1": a1, "titulaire_extrait": pour}, titre, R)

    assert who("Article 1er - La commune de Gévezé est autorisée à mettre en œuvre") == "mairie"
    assert who("Article 1er - [...], gérant de la société dénommée SARL X, est autorisé") == (
        "commerces"
    )
    assert who(pour="pour l'établissement « CENTRE HOSPITALIER DE MARENNES »") == "autres"
    assert who(titre="A2025-0220, MAIRIE DE SAHURS, perimetre, 76113 SAHURS") == "mairie"
    # a shop « sur la commune de » is no town hall, a signing mayor no holder
    assert who(pour="pour l'établissement PICARD situé sur la commune de La Rochelle") != "mairie"
    assert who("Article 1er - Le maire de X est chargé de l'exécution du présent arrêté") is None


def test_a_dossier_counts_its_latest_act_by_holder_and_kind():
    base = {"t": "arrete", "sous_type": "autorisation"}
    evs = [
        {**base, "id": "a", "dossier": "2020/1", "date": "2024-01-01", "cameras": 4,
         "cameras_int": 4, "titulaire": "commerces"},
        {**base, "id": "b", "dossier": "2020/1", "date": "2025-06-01", "cameras": 6,
         "cameras_int": 4, "cameras_ext": 2, "titulaire": "commerces",
         "sous_type": "renouvellement"},
        {**base, "id": "c", "dossier": None, "date": "2025-02-01", "cameras": 12,
         "cameras_vp": 12, "titulaire": "mairie"},
        {**base, "id": "d", "dossier": "2021/9", "date": "2025-03-01", "cameras": None},
        {**base, "id": "e", "dossier": "2019/3", "date": "2025-04-01", "cameras": 5,
         "sous_type": "abrogation"},
        {**base, "id": "f", "dossier": "2022/4", "date": "2024-05-01", "cameras": 3},
        {"t": "arrete_drone", "id": "g", "cameras": 2},
    ]  # fmt: skip
    out = cameras.autorisees([*evs, evs[0]])  # an act listed twice counts once
    assert (out["mairie"], out["commerces"], out["autres"], out["non_classees"]) == (12, 6, None, 3)
    assert (out["interieures"], out["exterieures"], out["voie_publique"]) == (4, 2, 12)
    assert (out["dossiers"], out["dossiers_non_lus"], out["sans_dossier"]) == (4, 1, 1)
    assert out["periode"] == {"debut": "2024-05-01", "fin": "2025-06-01"}
    assert cameras.autorisees([])["mairie"] is None  # nothing read: null, never 0
