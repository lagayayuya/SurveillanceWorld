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
