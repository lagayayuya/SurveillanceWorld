"""The DGCL's subsidies through the tabular API, on lines recorded from the server."""

from __future__ import annotations

import datetime as dt

from collecte_fake import COMMUNES, FIX, KINDS, communes, ctx_for, raa  # noqa: F401

from lacarte_collecte import dgcl
from lacarte_collecte.etat import Store


def test_the_dgcl_s_video_lines_with_their_cameras(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 11, 1))
    out = dgcl.collect(ctx)
    subs = {s["beneficiaire"]: s for s in Store(tmp_path, "subventions_etat").records()}
    assert "CU GRAND BESANCON METROPOLE" not in subs  # « projet video pour sensibiliser… »
    assert "CENON" not in subs  # « atelier vidéo »
    assert subs["VESOUL"]["cameras"] == 3  # « trois nouvelles caméras »
    car = subs["CARCASSONNE"]
    assert (car["insee"], car["dep"], car["programme"], car["montant"]) == (
        "11069",
        "11",
        "DPV",
        54598,
    )
    assert car["mention"]["source"] == "DGCL" and car["date_annee"] is True
    assert out["derniere_annee_publiee"] == 2025
    # unchanged since read: not asked again
    before = len(collecte_server.asked)
    dgcl.collect(ctx)
    assert len(collecte_server.asked) - before == 1  # the dataset's page only


def test_a_grant_s_departement_is_its_commune_s():
    # Colmar (68163) filed by the DGCL under « 067A », the Collectivité européenne d'Alsace
    assert dgcl.departement("067A", "68163") == "68"
    assert dgcl.departement("067A", None) is None  # no commune: no département, not a wrong one
    assert [dgcl.departement(c) for c in ("011", "005", "020A", "02B", "971")] == [
        "11", "05", "2A", "2B", "971"]  # fmt: skip
