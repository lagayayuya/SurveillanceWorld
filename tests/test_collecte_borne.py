"""The guards added after ten server runs killed at 6 h (2026-11-05 to 11-08): a recueil's
reading bounded in a child process, the run's sign of life, a killed run at the top of the
next report, and the comparison of the acts cut before and after LEADERS."""

from __future__ import annotations

import datetime as dt
import json

import pytest
from collecte_fake import ctx_for, raa

from lacarte_collecte import arretes, borne, cli, parse_raa, sortie
from lacarte_collecte.cache import Cache
from lacarte_collecte.etat import Store


def test_a_reading_past_the_limit_is_killed_and_the_next_one_reads():
    lire = borne.Lecteur(0.5)
    try:
        with pytest.raises(borne.TropLong):
            lire(borne.dormir, 5.0)
        assert lire(borne.dormir, 0.01) == 0.01  # a new child
        with pytest.raises(RuntimeError, match="ZeroDivisionError"):
            lire(divmod, 1, 0)
        assert lire(borne.dormir, 0.0) == 0.0  # an error keeps the child
    finally:
        lire.fermer()


def test_the_limit_is_a_rule():
    import lacarte_registre as registre
    from lacarte_collecte.contexte import Contexte

    ctx = Contexte(root=None, sortie=None, rules_dir=registre.RULES)  # type: ignore[arg-type]
    assert ctx.lecteur().limite == 120.0


def _rec(d):
    return {k: d[k] for k in ("id", "date", "name", "url")} | {"administration": "pref69"}


def test_a_recueil_too_long_is_named_first_in_the_report_and_not_read_again(
    collecte_server, tmp_path, monkeypatch
):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 31))

    def never(*_a):
        raise borne.TropLong("plus de 120 s")

    monkeypatch.setattr(type(ctx), "lecteur", lambda self: never)
    d = raa("pref69")
    kinds = parse_raa.types(ctx.rules_dir / "collecte_actes.yaml")
    com = parse_raa.Communes({}, set())
    conf = arretes.administrations(ctx)["pref69"]
    rec = arretes.read_recueil(ctx, "pref69", conf, _rec(d), d["content"], kinds, com, "attrap")
    assert rec["statut"] == "trop_long" and rec["lecteur"] == parse_raa.VERSION
    assert arretes.is_read(rec)  # tried again by the next reader only
    Store(tmp_path, "recueils").add([rec])
    sortie.ecrire(ctx, "2026-11-08T00:00:00+00:00", {})
    first = (tmp_path / "sortie" / "rapport.txt").read_text("utf-8").splitlines()[0]
    assert first.startswith("TROP LONG") and d["name"] in first


def test_a_run_killed_before_its_report_heads_the_next_one(tmp_path):
    import lacarte_registre as registre
    from lacarte_collecte.contexte import Contexte

    ctx = Contexte(root=tmp_path, sortie=tmp_path / "sortie", rules_dir=registre.RULES)
    arretes.VIE.update(recueil={"id": "r1", "administration": "pref61", "date": "2026-03-27",
                                "url": "https://example.org/r1.pdf"},
                       depuis="2026-11-08T07:52:10+00:00")  # fmt: skip
    assert cli._precedent(ctx, "2026-11-08T06:25:00+00:00") is None  # the first run
    arretes.signe_de_vie(ctx)
    vie = json.loads((tmp_path / "sortie" / "en_cours.json").read_text("utf-8"))
    assert vie["administration"] == "pref61" and vie["heure"] and "lus" in vie
    # killed: no « fin »; the next run says it first
    before = cli._precedent(ctx, "2026-11-08T12:15:00+00:00")
    assert before["debut"] == "2026-11-08T06:25:00+00:00"
    assert before["dernier_signe"]["depuis"] == "2026-11-08T07:52:10+00:00"
    sortie.ecrire(ctx, "2026-11-08T12:15:00+00:00", {"precedent": before})
    first = (tmp_path / "sortie" / "rapport.txt").read_text("utf-8").splitlines()[0]
    assert first.startswith("PASSAGE PRÉCÉDENT INTERROMPU") and "pref61" in first


def test_the_comparison_reads_the_cache_and_writes_nothing(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 31))
    d = raa("pref69")
    Cache(tmp_path).put(_rec(d), d["content"])
    out = arretes.comparer(ctx)
    assert out["identiques"] == 1 and out["differents"] == 0
    assert not out["trop_longs_avant"] and not out["trop_longs_apres"]
    assert not (tmp_path / "sortie").exists()
