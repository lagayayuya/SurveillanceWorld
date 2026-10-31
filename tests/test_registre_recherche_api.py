"""The register's national search (lot R3, GET /api/registre/recherche, migration 027): the
extract built, its search rows loaded as the deploy loads them, then asked over HTTP. The
counts of each filter without its own filter, the sorts, the pages, the names served with
their references, the parameters refused, the time it takes and nothing logged."""

from __future__ import annotations

import contextlib
import inspect
import json
import logging
import statistics
import threading
import time
from pathlib import Path

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from registre_docs import documents

from lacarte.api import app as api
from lacarte.api import registre
from lacarte_registre import construire, importer, recherche

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
URL = "/api/registre/recherche"
MIONS = "69283"


@pytest.fixture(scope="module")
def site(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root, sans_corrections=True)
    return root / "site"


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn, site):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        n = recherche.charger(conn, site.parent / "recherche.tsv.gz")
    assert n == len(documents(site))
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


def ask(client, **params) -> dict:
    r = client.get(URL, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_every_document_is_searchable_and_counted(client, site):
    docs = documents(site)
    got = ask(client)
    assert got["total"] == len(docs)
    assert sum(got["facettes"]["t"].values()) == len(docs)
    assert len(got["evenements"]) == 20 and got["page"] == 1


def test_words_find_a_commune_without_its_accents_and_case(client):
    got = ask(client, q="MIONS")
    assert got["total"] > 0
    for e in got["evenements"]:
        about = e["insee"] == MIONS or MIONS in (e.get("partage") or [])
        assert about or "mions" in json.dumps(e).lower(), e["id"]
    # the start of a word is enough, as the register's search box always allowed
    assert ask(client, q="mion")["total"] == got["total"]
    assert ask(client, q="vidéoprotection mions")["total"] <= got["total"]


def test_each_filter_is_counted_without_its_own(client):
    every = ask(client)
    con = ask(client, t="con")
    # the kinds' counts leave the kind filter out: the same as with no filter
    assert con["facettes"]["t"] == every["facettes"]["t"]
    assert con["total"] == every["facettes"]["t"]["con"]
    assert con["par_type"] == {"con": con["total"]}
    # the départements' counts apply the kind filter
    assert sum(con["facettes"]["d"].values()) <= con["total"]
    assert con["facettes"]["d"]["69"] <= every["facettes"]["d"]["69"]
    both = ask(client, t="con", d="69")
    assert both["total"] == con["facettes"]["d"]["69"]
    assert both["facettes"]["t"]["con"] == both["total"]


def test_the_sorts_and_the_pages(client):
    by_amount = ask(client, tri="montant", n=50)["evenements"]
    ranks = [e.get("montant") or 0 for e in by_amount if e.get("compte")]
    assert ranks == sorted(ranks, reverse=True) and ranks[0] > 1_000_000
    by_date = ask(client, n=50)["evenements"]
    dates = [e["date"] for e in by_date if not e.get("date_annee")]
    assert dates == sorted(dates, reverse=True)
    oldest = [e["date"] for e in ask(client, n=50, ordre="asc")["evenements"]
              if not e.get("date_annee")]  # fmt: skip
    assert oldest == sorted(oldest) and oldest[0] < dates[-1]
    # a decree's second sort is its cameras (the list of decrees)
    cams = [e.get("cameras") for e in ask(client, t="aut", tri="montant", n=30)["evenements"]]
    known = [c for c in cams if c is not None]
    assert known and known == sorted(known, reverse=True) and cams[: len(known)] == known
    first, second = ask(client, n=10), ask(client, n=10, page=2)
    assert not {e["id"] for e in first["evenements"]} & {e["id"] for e in second["evenements"]}


def test_the_names_come_with_their_references(client, site):
    got = ask(client, q="serfim", t="con", n=5)
    assert got["evenements"]
    for e in got["evenements"]:
        for s in e["entreprises"]:
            entry = got["dico"]["entreprises"][s]
            if s != "ei":
                assert entry["ref"] == f"entreprise/{s}"
                assert (
                    site / f"{entry['ref'].replace('entreprise/', 'entreprise/')}.json"
                ).is_file()
        if e.get("acheteur_ref"):
            assert (site / f"{e['acheteur_ref']}.json").is_file()


@pytest.mark.parametrize(
    "params",
    [{"t": "xyz"}, {"d": "999"}, {"p": "drone"}, {"y": "18"}, {"tri": "pertinence"},
     {"ordre": "haut"}, {"page": "0"}, {"n": "501"}],
)  # fmt: skip
def test_a_parameter_out_of_its_values_is_refused(client, params):
    r = client.get(URL, params=params)
    assert r.status_code == 422
    assert r.json()["error"] == "invalid"


def test_nothing_of_a_request_is_logged(client, caplog):
    caplog.set_level(logging.DEBUG)
    ask(client, q="cherchezmoi", d="69")
    # the test's own HTTP client logs its request; the API, nothing
    server = [r for r in caplog.records if not r.name.startswith("httpx")]
    assert not [r for r in server if "cherchezmoi" in r.getMessage()]
    assert not [r for r in server if r.name.startswith(("lacarte", "uvicorn"))]


def test_its_time_on_the_extract(client):
    times = []
    for q in ("", "mions", "video", "serfim", "lyon"):
        for t in ("", "con", "aut"):
            t0 = time.perf_counter()
            ask(client, q=q, t=t, tri="montant")
            times.append(time.perf_counter() - t0)
    median = statistics.median(times)
    print(f"\nsearch on the extract: median {median * 1000:.1f} ms, max {max(times) * 1000:.1f} ms")
    assert median < 0.5


# --- bounded without telling readers apart (DECISIONS 2026-10-31) ---------------------------


class Counting:
    """A pool connection that counts the statements it runs."""

    def __init__(self, conn, box):
        self.conn, self.box = conn, box

    def execute(self, *a, **k):
        self.box[0] += 1
        return self.conn.execute(*a, **k)

    def __getattr__(self, name):
        return getattr(self.conn, name)


@pytest.fixture
def statements(client, monkeypatch):
    """The SQL statements the API runs, counted in a one-item list; no answer kept before."""
    box = [0]
    real = api.pool.connection

    @contextlib.contextmanager
    def counted(*a, **k):
        with real(*a, **k) as conn:
            yield Counting(conn, box)

    monkeypatch.setattr(api.pool, "connection", counted)
    api.registre_bounds.cache.clear()
    return box


def queries(client, box, **params) -> int:
    box[0] = 0
    ask(client, **params)
    return box[0]


def test_a_kept_answer_runs_no_query(client, statements):
    first = client.get(URL, params={"q": "MIONS", "t": "con,aut"})
    assert statements[0] >= 6
    # the same question, however written: no query at all, the same bytes
    statements[0] = 0
    again = client.get(URL, params={"q": "mions", "t": "aut,con,aut"})
    assert statements[0] == 0 and again.content == first.content
    assert queries(client, statements, q="mions!", t="aut,con") == 0
    # another page, another question
    assert queries(client, statements, q="mions", t="con,aut", page=2) >= 6


def test_a_new_load_is_never_served_the_old_answers(client, statements, pg_dsn, site,
                                                    monkeypatch):  # fmt: skip
    monkeypatch.setattr(registre, "VERSION_TTL_S", 0.0)  # the version read at each search
    assert queries(client, statements, q="video") >= 6
    assert queries(client, statements, q="video") == 1  # the version only
    # reloaded in place, in one transaction (recherche.charger, the tests' load)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        before = registre.table_version(conn)
        recherche.charger(conn, site.parent / "recherche.tsv.gz")
        after = registre.table_version(conn)
    assert before[0] == after[0] and before[1] != after[1]
    assert queries(client, statements, q="video") >= 7
    # a new table swapped in, as db/load_registre.sh does at a deploy
    cols = ", ".join(recherche.COLUMNS)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("CREATE TABLE registre_recherche_new (LIKE registre_recherche INCLUDING ALL)")
        conn.execute(f"INSERT INTO registre_recherche_new ({cols}) SELECT {cols}"
                     " FROM registre_recherche")  # fmt: skip
        with conn.transaction():
            conn.execute("ALTER TABLE registre_recherche RENAME TO registre_recherche_prev")
            conn.execute("ALTER TABLE registre_recherche_new RENAME TO registre_recherche")
        conn.execute("DROP TABLE registre_recherche_prev")
        swapped = registre.table_version(conn)
    assert swapped[0] != after[0]
    assert queries(client, statements, q="video") >= 7


def test_kept_answers_are_bounded_in_number_bytes_and_time():
    now = [0.0]
    cache = registre.Cache(entries=2, max_bytes=10, ttl=60, clock=lambda: now[0])
    cache.put(("a",), b"1234")
    cache.put(("b",), b"1234")
    assert cache.get(("a",)) == b"1234"  # a used last: b goes first
    cache.put(("c",), b"12")
    assert cache.get(("b",)) is None and cache.get(("a",)) and cache.get(("c",))
    cache.put(("d",), b"123456789")  # over 10 bytes with the others: they go
    assert list(cache.items) == [("d",)] and cache.size == 9
    cache.put(("e",), b"x" * 11)  # larger than the whole cache: never kept
    assert cache.get(("e",)) is None
    now[0] = 60.0
    assert cache.get(("d",)) is None and cache.size == 0


def test_too_many_searches_at_once_answer_503(client, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(registre, "VERSION_TTL_S", 1e9)
    slots = api.registre_bounds.slots
    api.registre_bounds.cache.clear()
    kept = ask(client, q="serfim")
    monkeypatch.setattr(slots, "running", slots.max_running)
    monkeypatch.setattr(slots, "waiting", slots.max_waiting)
    r = client.get(URL, params={"q": "lyon"})
    assert r.status_code == 503
    assert r.json() == {"error": "busy"} and r.headers["retry-after"] == "2"
    # a kept answer needs no slot
    assert ask(client, q="serfim") == kept
    # a search waits for a slot, wait_s at most, then 503
    monkeypatch.setattr(slots, "waiting", 0)
    monkeypatch.setattr(slots, "wait_s", 0.2)
    t0 = time.perf_counter()
    assert client.get(URL, params={"q": "lyon"}).status_code == 503
    assert time.perf_counter() - t0 >= 0.2
    # a slot freed while it waits: it runs
    threading.Timer(0.05, slots.leave).start()
    assert client.get(URL, params={"q": "lyon"}).status_code == 200
    assert slots.running == slots.max_running - 1 and slots.waiting == 0
    server = [r for r in caplog.records if not r.name.startswith("httpx")]
    assert not [r for r in server if "lyon" in r.getMessage() or r.levelno >= logging.WARNING]


@pytest.mark.parametrize(
    "params, field",
    [({"q": "a" * 201}, "q"), ({"t": "con," * 101}, "t"), ({"d": "69," * 134}, "d"),
     ({"page": "41", "n": "500"}, "page"), ({"page": "1001"}, "page"), ({"n": "0"}, "n"),
     ({"page": "1e9"}, "page"), ({"n": "-1"}, "n")],
)  # fmt: skip
def test_a_question_is_bounded(client, params, field):
    r = client.get(URL, params=params)
    assert r.status_code == 422
    assert r.json() == {"error": "invalid", "fields": [field]}


def test_the_longest_reads_the_register_makes_are_answered(client):
    # the CSV: 40 pages of 500; a list's « Voir plus »: 1000 pages of 20
    assert client.get(URL, params={"page": 40, "n": 500}).status_code == 200
    assert client.get(URL, params={"page": 1000, "n": 20}).status_code == 200
    longest = {"q": "a" * 200, "d": ",".join(["69"] * 133)}
    assert client.get(URL, params=longest).status_code == 200
    assert ask(client, t="con,con")["total"] == ask(client, t="con")["total"]


def test_no_address_anywhere(client, caplog):
    caplog.set_level(logging.DEBUG)
    address = "198.51.100.7"
    other = TestClient(api.app, client=(address, 4242))  # no `with`: the same pool
    r = other.get(URL, params={"q": "mions"}, headers={"x-forwarded-for": "203.0.113.9"})
    assert r.status_code == 200
    bounds = api.registre_bounds
    kept = repr(list(bounds.cache.items)) + repr(vars(bounds.slots)) + repr(bounds.version.value)
    assert address not in kept and "203.0.113.9" not in kept
    assert not [r for r in caplog.records if address in r.getMessage()]
    # the search reads no request at all: its parameters are the question's only
    route = next(r for r in api.app.routes if getattr(r, "path", "") == URL)
    params = inspect.signature(route.endpoint).parameters
    assert set(params) == {"q", "t", "d", "p", "y", "tri", "ordre", "page", "n"}
    source = Path(registre.__file__).read_text().lower()
    assert ".client" not in source and "forwarded" not in source and "real-ip" not in source
