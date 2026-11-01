"""The BOAMP from the DILA's archives, on a day of 2026 and a yearly file of 2024 recorded from the
server (cleaned: no natural person)."""

from __future__ import annotations

import datetime as dt
import json

from collecte_fake import COMMUNES, FIX, KINDS, communes, ctx_for, raa  # noqa: F401

from lacarte_collecte import dila
from lacarte_collecte.etat import Store


def test_a_day_of_the_dila_its_notices_cleaned_with_their_mention(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    f = ctx.fetcher("dila")
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, f, dt.date(2026, 10, 14), store)
    assert st["termine"] is True and st["fichiers"] == 3
    got = {n["idweb"]: n for n in store.records()}
    # Vanves says video in its body only; the Euralille shuttle is not about video
    assert set(got) == {"26-98610", "26-98743"}
    vanves = got["26-98610"]
    assert vanves["departements"] == ["92"] and vanves["nature"] == "avis"
    assert vanves["mention"]["source"] == "DILA" and vanves["mention"]["fichier"] == "26-98610.xml"
    assert vanves["mention"]["adresse"].endswith("/dila/2026/10/14/26-98610.xml")
    assert vanves["mention"]["date_fichier"] == "Wed, 14 Oct 2026 22:15:00 GMT"
    text = json.dumps(list(got.values()), ensure_ascii=False)
    assert "@" not in text.replace("@type", "")
    # the same day again: nothing asked but the folder, no duplicate
    before = len(collecte_server.asked)
    dila.collect_day(ctx, f, dt.date(2026, 10, 14), store)
    assert len(collecte_server.asked) - before == 1 and len(list(store.records())) == 2


def test_a_cut_day_resumes_where_it_stopped(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    ticks = iter(range(100))
    ctx.clock, ctx.deadline = (lambda: next(ticks)), 1  # out of time after the first notice
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, ctx.fetcher("dila"), dt.date(2026, 10, 14), store)
    assert st["statut"] == "en_cours" and len(st["lus"]) == 1
    ctx.deadline = float("inf")
    st = dila.collect_day(ctx, ctx.fetcher("dila"), dt.date(2026, 10, 14), store)
    assert st["termine"] and len(st["lus"]) == 3 and len({n["id"] for n in store.records()}) == 2


def test_a_yearly_file_of_the_former_schema_read_then_deleted(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    store = Store(tmp_path, "avis")
    st = dila.collect_yearly(ctx, ctx.fetcher("dila"), 2024, store)
    assert st["termine"] and st["avis_video"] == 1
    [n] = store.records()
    assert n["idweb"] == "24-4689" and n["mention"]["fichier"].startswith("MAPA-AO.tar.gz/")
    assert not any((tmp_path / "tmp").iterdir())  # the archive is gone
    # 2024's day folders are read day by day, not as yearly files
    assert not any("/2024/01/" in a for a in collecte_server.asked)
