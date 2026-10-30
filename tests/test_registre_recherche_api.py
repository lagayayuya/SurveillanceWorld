"""The register's national search (lot R3, GET /api/registre/recherche, migration 027): the
extract built, its search rows loaded as the deploy loads them, then asked over HTTP. The
counts of each filter without its own filter, the sorts, the pages, the names served with
their references, the parameters refused, the time it takes and nothing logged."""

from __future__ import annotations

import json
import logging
import statistics
import time
from pathlib import Path

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from registre_docs import documents

from lacarte.api import app as api
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
