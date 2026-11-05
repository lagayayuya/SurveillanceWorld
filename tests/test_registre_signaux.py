"""Facts worth a second look (signaux.py, lot R5 section 5): each finding is a fact, its rule
and its document, with the ordinary reasons that produce it."""

from __future__ import annotations

import lacarte_registre as registre
from lacarte_registre import signaux

CONF = signaux.rules(registre.RULES / "registre_signaux.yaml")


def _c(id_="c1", **kw):
    return {"id": id_, "acheteur": "B", "acheteur_nom": "COMMUNE DE B", "date": "2024-06-01",
            "montant": 100000.0, "natures": ["fourniture_installation"], **kw}  # fmt: skip


def test_the_threshold_in_force_on_the_day():
    assert signaux.seuil("dispense", "2019-12-31", False, CONF) == 25000
    assert signaux.seuil("dispense", "2020-01-01", False, CONF) == 40000
    assert signaux.seuil("formalise", "2024-03-01", True, CONF) == 5538000
    assert signaux.seuil("formalise", "2017-06-01", False, CONF) is None
    # décret 2025-1386: works 100 000 € from 1 January 2026, supplies 60 000 € from 1 April
    assert signaux.seuil("dispense", "2026-01-01", True, CONF) == 100000
    assert signaux.seuil("dispense", "2026-03-31", False, CONF) == 40000
    assert signaux.seuil("dispense", "2026-04-01", False, CONF) == 60000
    assert signaux.seuil("formalise", "2026-06-01", False, CONF) == 216000


def test_a_single_offer_says_the_framework_it_follows():
    assert signaux.offre_unique(_c(offres=2), CONF) is None
    hit = signaux.offre_unique(_c(offres=1, subsequent=True), CONF)
    assert hit["fait"] == "Contrat de 100 000 € attribué sur une seule offre reçue."
    assert hit["a_verifier"] and "subséquent" in hit["a_verifier"][0]
    # the framework itself awarded on one offer is no subsequent contract
    assert signaux.offre_unique(_c(offres=1, accord_cadre=True), CONF)["a_verifier"] == []


def test_a_modification_over_15_percent_and_not_a_decrease():
    up = {"n": 1, "initial": 800000, "final": 2004253, "ecart_pct": 150.5, "ambigu": False}
    assert "+150.5 %" in signaux.avenant(_c(avenant=up), CONF)["fait"]
    assert signaux.avenant(_c(avenant={**up, "ecart_pct": 15.0}), CONF) is None
    assert signaux.avenant(_c(avenant={**up, "ambigu": True}), CONF) is None


def test_a_procedure_without_publicity_under_the_dispense_is_said():
    hit = signaux.sans_publicite(
        _c(procedure="Marché passé sans publicité ni mise en concurrence préalable",
           montant=30000.0), CONF)  # fmt: skip
    assert hit and "seuil de dispense" in hit["a_verifier"][0]
    assert signaux.sans_publicite(_c(procedure="Appel d'offres ouvert"), CONF) is None


def test_amounts_grouped_under_a_threshold():
    # three contracts of one buyer in 2024 just under 90 000 €, none just over
    cs = [_c(f"c{i}", montant=m) for i, m in enumerate([82000.0, 85000.0, 89000.0, 120000.0])]
    hits = signaux.sous_seuil(cs, CONF)
    assert [h["id"] for h in hits] == ["c0", "c1", "c2"]
    # as many just over: no pattern
    cs.append(_c("c9", montant=91000.0))
    cs.append(_c("c8", montant=95000.0))
    cs.append(_c("c7", montant=98000.0))
    assert signaux.sous_seuil(cs, CONF) == []


def test_a_short_delay_depends_on_the_procedure():
    assert signaux.delai_court(_c(avis_jours=10, avis_sur=True), CONF)
    assert signaux.delai_court(_c(avis_jours=20, avis_sur=True), CONF) is None
    # over the formal threshold, 30 days
    assert signaux.delai_court(_c(avis_jours=20, montant=300000.0, avis_sur=True), CONF)
    # a suggested link says the notice may be another lot's
    hit = signaux.delai_court(_c(avis_jours=3, avis_sur=False), CONF)
    assert "lien « suggéré »" in hit["a_verifier"][0]


def test_over_the_publicity_threshold_without_a_notice():
    assert signaux.sans_avis(_c(montant=120000.0), CONF)
    assert signaux.sans_avis(_c(montant=80000.0), CONF) is None
    assert signaux.sans_avis(_c(montant=120000.0, avec_avis=True), CONF) is None
    # works of 95 000 €: a notice was due in 2025, not under the 2026 dispense
    works = {"montant": 95000.0, "natures": ["travaux_genie_civil"]}
    assert signaux.sans_avis(_c(date="2025-06-01", **works), CONF)
    assert signaux.sans_avis(_c(date="2026-06-01", **works), CONF) is None


def test_a_small_grant_says_the_decp_publication_threshold_of_its_year():
    g = {"id": "g", "beneficiaire": "B", "date": "2019-12-31", "montant": 9000.0,
         "base": 30000.0, "programme": "DETR"}  # fmt: skip
    assert signaux.subvention_sans_contrat(g, CONF)["a_verifier"] == []
    assert signaux.subvention_sans_contrat({**g, "date": "2022-12-31"}, CONF)["a_verifier"]
