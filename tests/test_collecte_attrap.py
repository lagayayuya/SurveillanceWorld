"""The prefectoral acts' collection through Attrap (a fake API on 127.0.0.1, the texts
recorded from the server, cleaned): the acts kept, the official link checked once, and a host
behind an anti-robot check never asked; then the derived files and the coverage."""

from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import urllib.parse

from collecte_fake import ATTRAP, ctx_for, raa

import lacarte_registre as registre
from lacarte_collecte import arretes, sortie
from lacarte_collecte.etat import Store


def test_the_acts_through_attrap_and_never_a_challenge_host(collecte_server, tmp_path):
    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    for name in ("collecte_actes.yaml", "registre_effacements.yaml", "registre_sources.yaml"):
        (rules_dir / name).write_text((registre.RULES / name).read_text("utf-8"), "utf-8")
    base = collecte_server.base
    (rules_dir / "collecte_administrations.yaml").write_text(json.dumps({"administrations": {
        "pref69": {"nom": "Rhône", "code": "69", "genre": "departement", "attrap": "pref69",
                   "index": None, "defi": False, "parcours": False, "vague": 1, "actes_12_mois": 9},
        "pref974": {"nom": "La Réunion", "code": "974", "genre": "departement",
                    "attrap": "pref974", "index": None, "defi": True, "parcours": False,
                    "vague": 3, "actes_12_mois": 1},
    }}), "utf-8")  # fmt: skip
    ATTRAP["pref69"] = {**raa("pref69"), "url": f"{base}/pdf/RAA_69.pdf"}
    ATTRAP["pref974"] = {**raa("pref974"), "url": f"{base}/pdf/arrete_974.pdf", "content": ""}
    for d in ATTRAP.values():
        d["id"] = arretes.recueil_id(d["url"])
    try:
        ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 31), rules_dir)
        out = arretes.collect(ctx)
    finally:
        ATTRAP.update(pref69=raa("pref69"), pref974=raa("pref974"))
    assert out["administrations"] == {"pref69": "termine", "pref974": "termine"}
    recs = {r["administration"]: r for r in Store(tmp_path, "recueils").records()}
    assert recs["pref69"]["statut"] == "lu" and recs["pref69"]["lien"] == "ok"
    # its text missing behind an anti-robot host: « non lu », and its PDF never asked
    assert recs["pref974"]["statut"] == "non_lu" and "lien" not in recs["pref974"]
    assert not any("arrete_974" in a for a in collecte_server.asked)
    acts = {a["id"]: a for a in Store(tmp_path, "actes").records()}
    assert acts["69-2026-07-02-00001"]["departement"] == "69"
    assert acts["69-2026-07-02-00001"]["recueil"] == hashlib.sha256(
        urllib.parse.unquote(f"{base}/pdf/RAA_69.pdf").encode()).hexdigest()  # fmt: skip
    # then the derived files, with the coverage
    sortie.ecrire(ctx, "2026-10-31T00:00:00+00:00", out)
    with gzip.open(tmp_path / "sortie" / "arretes.jsonl.gz", "rt") as g:
        assert len(g.readlines()) == len(acts)
    cov = json.loads((tmp_path / "sortie" / "couverture.json").read_text("utf-8"))
    assert cov["administrations"]["pref69"]["dernier_recueil"] == "2026-07-03"
    assert cov["administrations"]["pref69"]["perime"] is True  # nothing since July
    assert "sans nouveau recueil" in (tmp_path / "sortie" / "rapport.txt").read_text("utf-8")


def test_the_recueil_id_is_the_sha256_of_the_decoded_address():
    # Attrap's id for a Bouches-du-Rhône recueil whose address has %20 (measured 2026-11-01)
    url = ("https://www.bouches-du-rhone.gouv.fr/contenu/telechargement/65285/455604/file/"
           "recueil-13-2026-273-recueil-des-actes-administratifs-special%20du%2008%20septembre"
           "%202026.pdf")  # fmt: skip
    assert arretes.recueil_id(url).startswith("d54740f49e84ce8d")
