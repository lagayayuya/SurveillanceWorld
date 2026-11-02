"""lacarte_collecte's memory: a replay never duplicates, an erasure removes everywhere."""

from __future__ import annotations

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
