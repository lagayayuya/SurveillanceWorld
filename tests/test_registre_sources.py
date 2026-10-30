"""The national sources read (lot R3 § 2): the BOAMP's notices without any natural person, their
results and places; SIRENE's units, a sole trader never named; the DECP's selection rules on
rows of their own (the extract's equivalence with the pilot is test_registre_national.py)."""

from __future__ import annotations

import json
from pathlib import Path

from lacarte_registre import boamp, selection, sirene

NATIONAL = Path(__file__).parent / "fixtures" / "registre" / "national"
MIONS_SIRET, SERFIM = "21690283300005", "431903954"


def records() -> list[dict]:
    return json.loads((NATIONAL / "boamp-api.json").read_text(encoding="utf-8"))["results"]


def test_no_natural_person_is_kept_from_a_notice():
    kept = [json.dumps(boamp.clean(r), ensure_ascii=False) for r in records()]
    text = "\n".join(kept)
    for gone in ("Jean Exemple", "jean.exemple@example.org", "06 12 34 56 78", "Jeanne Exemple",
                 "Mme Exemple"):  # fmt: skip
        assert gone not in text, gone
    # a holder's or an organisation's name stays only as its fingerprint
    assert "SERFIM" not in text and boamp.cle("SERFIM T.I.C.") in text
    # the buyer, a legal person, as the notice names it
    assert "Commune de Mions" in text


def test_a_notice_read():
    a, r, eforms, thermal = (boamp.notice(boamp.clean(x)) for x in records())
    assert a["nature"] == "avis" and a["cameras"] == 12
    assert a["sirets"] == [MIONS_SIRET]  # the phone number is not a SIRET
    assert a["cpv"] == ["32323500"]
    assert a["lieu"] == {"cp": "69780", "ville": "MIONS"}
    assert r["nature"] == "resultat" and r["avis_lies"] == ["20-142345"]
    assert r["resultat"]["titulaires"] == [SERFIM]
    assert r["resultat"]["montant_attribue"] == 215000.0
    assert r["resultat"]["cles"] == [boamp.cle("SERFIM T.I.C.")]
    assert not r["resultat"]["groupement"]
    # eForms: a natural person's name and address are dropped, its id is no SIREN
    assert eforms["resultat"]["titulaires"] == []
    assert eforms["lieu"]["cp"] == "69205"
    # thermal cameras for firefighters: not video surveillance
    assert thermal is None


def test_a_holder_s_name_fingerprint_ignores_its_legal_form():
    assert boamp.cle("SAS Serfim T.I.C.") == boamp.cle("SERFIM T.I.C.")
    assert boamp.cle("Serfim") != boamp.cle("Serfim T.I.C.")


def test_sirene_names_a_legal_person_never_a_sole_trader():
    pm = sirene.from_api({"results": [{"siren": SERFIM, "nature_juridique": "5710",
                                       "nom_raison_sociale": "SERFIM T.I.C.",
                                       "categorie_entreprise": "PME", "etat_administratif": "A",
                                       "activite_principale": "42.22Z"}]}, SERFIM)  # fmt: skip
    assert pm == {"nature": "5710", "categorie": "PME", "naf": "42.22Z", "actif": True,
                  "ei": False, "nom": "SERFIM T.I.C."}  # fmt: skip
    ei = sirene.from_api({"results": [{"siren": "123456782", "nature_juridique": "1000",
                                       "nom_complet": "JEANNE EXEMPLE"}]}, "123456782")  # fmt: skip
    assert ei["ei"] is True and "nom" not in ei
    # a unit without a legal category (known from the RNE alone: the API names it by its
    # person's name), or one the source says is a sole trader, is never named either
    rne = sirene.from_api(
        {"results": [{"siren": "123456782", "nature_juridique": None, "nom_complet": "J. X"}]},
        "123456782",
    )
    assert rne["ei"] is True and rne["nature_inconnue"] is True and "nom" not in rne
    dit = sirene.from_api({"results": [{"siren": "123456782", "nature_juridique": "5499",
                                        "nom_complet": "JEANNE EXEMPLE",
                                        "complements": {"est_entrepreneur_individuel": True}}]},
                          "123456782")  # fmt: skip
    assert dit["ei"] is True and "nom" not in dit
    assert sirene.from_api({"results": []}, "123456782") == {"introuvable": True}


def test_the_selection_rules_on_rows_of_their_own():
    rows = [
        # strong words, whatever the CPV
        {"uid": "a", "objet": "Extension de la vidéoprotection urbaine", "codeCPV": "45000000"},
        # a core CPV and a video word
        {"uid": "b", "objet": "Caméras du parking", "codeCPV": "32323500-8"},
        # a broad CPV needs a weak word
        {"uid": "c", "objet": "Alarme intrusion", "codeCPV": "45312200"},
        {"uid": "d", "objet": "Caméras et contrôle d'accès", "codeCPV": "45312200"},
        # a noise word drops a contract kept on a CPV
        {"uid": "e", "objet": "Caméras thermiques", "codeCPV": "32323500"},
        # but not one kept on strong words
        {"uid": "f", "objet": "Vidéosurveillance et détection incendie", "codeCPV": "35120000"},
        # a drone for the police
        {"uid": "g", "objet": "Drone", "codeCPV": "35613000", "acheteur_nom": "Police nationale"},
        # speed cameras are excluded
        {"uid": "h", "objet": "Caméras de contrôle", "codeCPV": "34971000"},
        # a modification row without objet keeps its contract's path
        {"uid": "a", "objet": None, "codeCPV": None},
    ]
    assert selection.select(rows) == {
        "a": "mot_fort", "b": "cpv_coeur+mot", "d": "cpv_large+mot_faible", "f": "mot_fort",
        "g": "drone",
    }  # fmt: skip
    assert selection.dispositif("Centre de supervision urbain") == "csu"
    assert selection.dispositif("Drones de surveillance") == "drones"
    assert selection.dispositif("Drones pour filmer le festival") == "videoprotection"
    assert selection.dispositif("Lecture automatique des plaques") == "lapi"
