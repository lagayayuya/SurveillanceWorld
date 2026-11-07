"""lacarte_collecte's memory: a replay never duplicates, an erasure removes everywhere."""

from __future__ import annotations

from pathlib import Path

from lacarte_collecte.etat import Etat, Store


# --- the state and the records --------------------------------------------------------------------
def test_a_replay_never_makes_a_duplicate_and_an_erasure_removes_everywhere(tmp_path):
    s = Store(tmp_path, "avis")
    s.add([{"id": "26-1", "v": 1}, {"id": "26-2", "v": 1}])
    s.add([{"id": "26-1", "v": 2}])
    assert [(r["id"], r["v"]) for r in s.records()] == [("26-2", 1), ("26-1", 2)]
    assert s.forget({"26-1"}) == 1 and s.ids() == {"26-2"}
    e = Etat(tmp_path, "dila")
    e.save("jour-2026-10-14", lus=["a.xml"])
    e.save("jour-2026-10-14", termine=True)
    assert e.get("jour-2026-10-14")["lus"] == ["a.xml"] and e.all().keys() == {"jour-2026-10-14"}


def test_once_caught_up_only_the_night_s_run_works(tmp_path):
    import datetime as dt
    from zoneinfo import ZoneInfo

    from lacarte_collecte import cli
    from lacarte_collecte.contexte import Contexte

    Etat(tmp_path, "tourner").save(rattrapage_fini=True, derniere_complete="2026-11-01")
    ctx = Contexte(root=tmp_path, sortie=tmp_path / "sortie", rules_dir=tmp_path)
    noon = dt.datetime(2026, 11, 3, 13, 15, tzinfo=ZoneInfo("Europe/Paris"))
    # no request, no file: the day's run of a collection caught up ends at once
    assert cli.tourner(ctx, now=noon) == {"hors_nuit": "2026-11-03T13:15+01:00"}
    assert not (tmp_path / "sortie").exists()


def test_the_smallest_gap_is_between_two_starts_not_two_ends(tmp_path):
    from lacarte_collecte import sortie

    j = tmp_path / "brut" / "_journal"
    j.mkdir(parents=True)
    # a 6 s PDF started at 00:00:00, a 0.2 s request started at 00:00:10: ends 4.2 s apart
    (j / "requetes-2026-11.tsv").write_text(
        "2026-11-02T00:00:06.000+00:00\t192.0.2.7\thttps://a/x.pdf\t200\t6000\tpdf\n"
        "2026-11-02T00:00:10.200+00:00\t192.0.2.7\thttps://a/y\t200\t200\tliens\n",
        "utf-8",
    )
    got = sortie.journal(tmp_path, "2026-11-01")["adresses"]["192.0.2.7"]
    assert got["ecart_min_s"] == 10.0


def test_the_environment_file_is_read_as_systemd_reads_it(tmp_path, monkeypatch):
    from lacarte_collecte import cli

    f = tmp_path / "env"
    f.write_text("# c\nLACARTE_ROBOT_CONTACT= robot@example.org\nLACARTE_ANTHROPIC_KEY='k'\n")
    monkeypatch.delenv("LACARTE_ROBOT_CONTACT", raising=False)
    monkeypatch.delenv("LACARTE_ANTHROPIC_KEY", raising=False)
    cli.charger_env(str(f))
    import os

    assert os.environ["LACARTE_ROBOT_CONTACT"] == "robot@example.org"
    assert os.environ["LACARTE_ANTHROPIC_KEY"] == "k"


def test_a_source_past_its_deadline_does_not_hold_the_run_nor_calls_a_paused_model(
    tmp_path, monkeypatch
):
    import shutil
    import sys
    import threading
    import time
    import types

    from lacarte_collecte import cli
    from lacarte_collecte.contexte import Contexte

    rules = tmp_path / "rules"
    shutil.copytree(Path(__file__).parent.parent / "rules", rules)  # the pause is the repo's
    (tmp_path / "communes.json").write_text("{}", "utf-8")  # fresh: no request
    stop = threading.Event()
    stuck = types.ModuleType("stuck")
    stuck.collect = lambda ctx: stop.wait(30)  # a reading that never ends (until the test's end)
    monkeypatch.setitem(sys.modules, "stuck", stuck)
    monkeypatch.setitem(cli.SOURCES, "arretes", "stuck")
    monkeypatch.setattr(cli, "GRACE", 0.3)
    monkeypatch.setenv("LACARTE_ANTHROPIC_KEY", "x")
    called = []
    modele = types.ModuleType("lacarte_collecte.modele")
    modele.suivre = lambda ctx: called.append(1)
    monkeypatch.setitem(sys.modules, "lacarte_collecte.modele", modele)
    ctx = Contexte(
        root=tmp_path, sortie=tmp_path / "sortie", rules_dir=rules, deadline=time.monotonic() + 0.2
    )
    t0 = time.monotonic()
    try:
        cli.tourner(ctx, only="arretes")
    finally:
        stop.set()
    assert time.monotonic() - t0 < 5
    rep = (tmp_path / "sortie" / "rapport.json").read_text("utf-8")
    assert "depasse" in rep and "pile.txt" in rep
    assert not called  # paused: no request to the API, not even to follow the batches
