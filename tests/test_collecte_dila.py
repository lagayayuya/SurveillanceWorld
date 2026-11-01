"""The BOAMP from the DILA's archives, on a day of 2026 and a yearly file of 2024 recorded from the
server (cleaned: no natural person)."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from collecte_fake import COMMUNES, FIX, KINDS, communes, ctx_for, raa  # noqa: F401

from lacarte_collecte import dila
from lacarte_collecte.etat import Store


def test_a_day_of_the_dila_its_notices_cleaned_with_their_mention(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    f = ctx.fetcher("dila")
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, dila.Http(f), dt.date(2026, 10, 14), store)
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
    dila.collect_day(ctx, dila.Http(f), dt.date(2026, 10, 14), store)
    assert len(collecte_server.asked) - before == 1 and len(list(store.records())) == 2


def test_a_cut_day_resumes_where_it_stopped(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    ticks = iter(range(100))
    ctx.clock, ctx.deadline = (lambda: next(ticks)), 1  # out of time after the first notice
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, dila.Http(ctx.fetcher("dila")), dt.date(2026, 10, 14), store)
    assert st["statut"] == "en_cours" and len(st["lus"]) == 1
    ctx.deadline = float("inf")
    st = dila.collect_day(ctx, dila.Http(ctx.fetcher("dila")), dt.date(2026, 10, 14), store)
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


class FakeFtp:
    """An FTP connection over the recorded day: NLST, RETR, MDTM, as ftplib's."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.asked: list[str] = []

    def nlst(self, path: str) -> list[str]:

        self.asked.append(f"NLST {path}")
        local = self.root / path.removeprefix("/BOAMP/")
        if not local.is_dir():
            return []  # the DILA's server: an empty list, no 550
        return [f"{path}{p.name}" for p in sorted(local.iterdir())]

    def retrbinary(self, cmd: str, callback, blocksize: int = 8192) -> str:
        path = cmd.removeprefix("RETR ")
        self.asked.append(f"RETR {path}")
        data = (self.root / path.removeprefix("/BOAMP/")).read_bytes()
        for i in range(0, len(data), blocksize):
            callback(data[i : i + blocksize])
        return "226 Transfer complete"

    def sendcmd(self, cmd: str) -> str:
        return "213 20261014221500"


def test_the_history_over_one_ftps_connection_at_a_capped_rate(collecte_server, tmp_path):
    from lacarte_collecte import ftps

    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    ftp = FakeFtp(FIX / "dila")
    clock = {"t": 0.0}
    slept: list[float] = []

    def sleep(s: float) -> None:
        slept.append(s)
        clock["t"] += s

    canal = ftps.Ftps(ftp, "/BOAMP/", rate_kb=64, sleep=sleep, clock=lambda: clock["t"])
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, canal, dt.date(2026, 10, 14), store)
    assert st["termine"] and st["canal"] == "ftps"
    got = {n["idweb"]: n for n in store.records()}
    assert set(got) == {"26-98610", "26-98743"}
    # the mention cites the archive's public address, and says the channel
    m = got["26-98610"]["mention"]
    assert m["adresse"].endswith("/2026/10/14/26-98610.xml") and m["canal"] == "ftps"
    assert m["date_fichier"] == "20261014221500"
    # the rate: ~110 KB read at 64 KB/s take at least ~1.7 s of waiting, no request made
    assert sum(slept) >= 1.5 and not any("/2026/10/14/" in a for a in collecte_server.asked)
    # a folder FTPS lists empty is unknown to it (collect() asks HTTP then)
    assert canal.files("2026/10/13/") is None and canal.files("FluxHistorique/x/") is None
