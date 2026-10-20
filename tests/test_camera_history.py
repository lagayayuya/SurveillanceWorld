"""A camera's public history (GET /api/history?camera=<id>, lot U) and the person's choice
to show her pseudonym there (PUT /api/me/history-pseudonym, migration 024): accepted
contributions only, by the month, « par un contributeur » unless the author chose
otherwise, never a test account's, never a hidden camera's, OpenStreetMap's live server
only. Fictitious accounts and contributions in the throwaway database."""

import json
import uuid

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from sessions import ORIGIN
from test_accounts_db import at
from test_db import sql

from lacarte.api import app as api

JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
COLS = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
        " geom, payload, body_sha256, osm_tags, answer, status, on_site, direction_deg,"
        " target")  # fmt: skip
CAM = "n4310"


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture
def people(pg_dsn):
    """hia and hib (contributors), hit (a test account)."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM contributions WHERE camera_id LIKE 'n43%%'"
                     " OR body_sha256 = 'history'")  # fmt: skip
        conn.execute("DELETE FROM hidden_cameras WHERE camera_id LIKE 'n43%%'")
        conn.execute("DELETE FROM accounts WHERE pseudonym IN ('hia', 'hib', 'hit')")
    sessions.forget()
    ids = {n: sessions.account_id(n) for n in ("hia", "hib", "hit")}
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET test = true WHERE id = %s", (ids["hit"],))
    return ids


def contribution(dsn, author_id, *, kind="verify", answer="present", status="applied",
                 camera=CAM, day="2026-09-14", on_site=True, direction=None,
                 uid=None) -> str:  # fmt: skip
    uid = uid or str(uuid.uuid4())
    added = camera.startswith("c")
    osm = (None, None, None) if added else ("n", int(camera[1:]), 3)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            f"INSERT INTO contributions ({COLS}) VALUES (%s, %s, %s, %s, %s, %s, 'b', %s, %s,"
            " ST_SetSRID(ST_MakePoint(644000, 6866000), 2154), %s, 'history', '{}', %s, %s,"
            " %s, %s, NULL)",
            (uid, kind, camera, *osm, author_id, day,
             json.dumps({"placement": "free"}), answer, status, on_site, direction),
        )  # fmt: skip
    return uid


def history(client, camera=CAM):
    r = client.get(f"/api/history?camera={camera}")
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "no-store"
    return r.json()["history"]


def opt(client, who, on):
    r = client.put("/api/me/history-pseudonym", json={"on": on},
                   headers={**JSON, "Cookie": f"session={sessions.token(who)}"})  # fmt: skip
    assert r.status_code == 204, r.text


def test_only_what_the_review_accepted(client, people, pg_dsn):
    a = people["hia"]
    for status in ("validated", "applied", "superseded"):
        contribution(pg_dsn, a, kind="move", answer=None, status=status)
    for status in ("pending", "rejected", "withdrawn", "conflict"):
        contribution(pg_dsn, a, kind="verify", answer="not_found", status=status)
    assert [h["what"] for h in history(client)] == ["moved"]  # three alike: one line


def test_each_kind_of_change_in_its_own_word(client, people, pg_dsn):
    a = people["hia"]
    days = iter(f"2026-{m:02d}-03" for m in range(9, 1, -1))
    contribution(pg_dsn, a, answer="present", day=next(days))
    contribution(pg_dsn, a, answer="not_found", day=next(days), on_site=False)
    contribution(pg_dsn, a, kind="move", answer=None, day=next(days))
    contribution(pg_dsn, a, kind="shape", answer="dome", day=next(days))
    contribution(pg_dsn, a, kind="direction", answer=None, direction=120, day=next(days))
    contribution(pg_dsn, a, kind="height", answer="first", day=next(days))
    contribution(pg_dsn, a, kind="tilt", answer="slight", day=next(days))
    contribution(pg_dsn, a, kind="operator", answer="public", day=next(days))
    # Nothing said: « Je ne sais pas », « Je ne vois pas », « ne sait pas ».
    contribution(pg_dsn, a, kind="shape", answer="unknown")
    contribution(pg_dsn, a, kind="direction", answer="not_visible")
    contribution(pg_dsn, a, answer="unsure")
    got = history(client)
    assert [(h["what"], h["month"], h["on_site"]) for h in got] == [
        ("seen", "2026-09", True), ("gone", "2026-08", False), ("moved", "2026-07", True),
        ("shape", "2026-06", True), ("direction", "2026-05", True),
        ("height", "2026-04", True), ("tilt", "2026-03", True),
        ("operator", "2026-02", True)]  # fmt: skip


def test_the_month_never_the_day_nor_a_uuid(client, people, pg_dsn):
    uid = contribution(pg_dsn, people["hia"], day="2026-09-14")
    r = client.get(f"/api/history?camera={CAM}")
    assert r.json() == {
        "camera": CAM,
        "history": [{"what": "seen", "month": "2026-09", "on_site": True, "by": None, "osm": None}],
    }
    assert "14" not in r.text.replace(CAM, "") and uid not in r.text


def test_an_opinion_is_no_change(client, people, pg_dsn):
    move = contribution(pg_dsn, people["hia"], kind="move", answer=None, status="pending")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute(
            f"INSERT INTO contributions ({COLS}) VALUES (%s, 'agree', %s, 'n', 4310, 3, 'b',"
            " %s, '2026-09-20', ST_SetSRID(ST_MakePoint(644000, 6866000), 2154), '{}',"
            " 'history', '{}', NULL, 'validated', true, NULL, %s)",
            (str(uuid.uuid4()), CAM, people["hib"], move),
        )  # fmt: skip
    assert history(client) == []


def test_a_test_accounts_contributions_never(client, people, pg_dsn):
    contribution(pg_dsn, people["hit"])
    contribution(pg_dsn, people["hia"], kind="move", answer=None)
    assert [h["what"] for h in history(client)] == ["moved"]


def test_a_hidden_camera_has_none(client, people, pg_dsn):
    contribution(pg_dsn, people["hia"], camera="n4311")
    assert len(history(client, "n4311")) == 1
    sql(pg_dsn, "INSERT INTO hidden_cameras (camera_id) VALUES ('n4311')")
    assert history(client, "n4311") == []


def test_an_odd_id_is_refused_an_unknown_one_is_empty(client, people):
    assert client.get("/api/history?camera=x1").status_code == 422
    assert client.get("/api/history?camera=n0").status_code == 422
    assert history(client, "n999999999") == []
    assert history(client, "c0123456789ab") == []


def test_the_pseudonym_only_when_chosen_at_once_both_ways(client, people, pg_dsn):
    contribution(pg_dsn, people["hia"], day="2026-09-10")
    contribution(pg_dsn, people["hib"], kind="move", answer=None, day="2026-08-10")
    assert [h["by"] for h in history(client)] == [None, None]
    opt(client, "hia", True)
    assert [h["by"] for h in history(client)] == ["hia", None]
    me = client.get("/api/me", headers={"Cookie": f"session={sessions.token('hia')}"}).json()
    assert me["history_pseudonym"] is True
    opt(client, "hia", False)
    assert [h["by"] for h in history(client)] == [None, None]
    assert client.put("/api/me/history-pseudonym", json={"on": True},
                      headers=JSON).status_code == 401  # fmt: skip


def test_off_by_default(client, people):
    me = client.get("/api/me", headers={"Cookie": f"session={sessions.token('hib')}"}).json()
    assert me["history_pseudonym"] is False


def test_a_deleted_a_disabled_or_a_placeholder_account_is_anonymous(client, people, pg_dsn):
    opt(client, "hia", True)
    opt(client, "hib", True)
    contribution(pg_dsn, people["hia"], day="2026-09-10")
    contribution(pg_dsn, people["hib"], kind="move", answer=None, day="2026-08-10")
    assert [h["by"] for h in history(client)] == ["hia", "hib"]
    sql(pg_dsn, f"UPDATE accounts SET disabled = true WHERE id = '{people['hib']}'")
    assert [h["by"] for h in history(client)] == ["hia", None]
    sql(pg_dsn, f"UPDATE accounts SET password_hash = NULL WHERE id = '{people['hia']}'")
    assert [h["by"] for h in history(client)] == [None, None]
    sql(pg_dsn, f"DELETE FROM accounts WHERE id = '{people['hia']}'")
    got = history(client)
    assert [(h["what"], h["by"]) for h in got] == [("seen", None), ("moved", None)]


def test_osm_live_publications_link_the_nodes_history(client, people, pg_dsn):
    a = people["hia"]
    live = contribution(pg_dsn, a, day="2026-09-10")
    dev = contribution(pg_dsn, a, kind="move", answer=None, day="2026-08-10")
    sending = contribution(pg_dsn, a, kind="shape", answer="dome", day="2026-07-10")
    for uid, server, state in ((live, "live", "published"), (dev, "dev", "published"),
                               (sending, "live", "sending")):  # fmt: skip
        sql(pg_dsn, f"INSERT INTO osm_publications (uuid, server, state, month) VALUES"
                    f" ('{uid}', '{server}', '{state}', '2026-10-01')")  # fmt: skip
    got = history(client)
    assert [h["osm"] for h in got] == [
        "https://www.openstreetmap.org/node/4310/history",
        None,
        None,
    ]
    # An added camera: the node made for it on the live server, not the test server's.
    add = str(uuid.uuid4())
    cam = "c" + add.replace("-", "")[:12]
    contribution(pg_dsn, a, kind="add", answer=None, camera=cam, uid=add)
    sql(pg_dsn, f"INSERT INTO osm_nodes VALUES ('dev', '{cam}', 111, 1), ('live', '{cam}', 222, 1)")
    sql(pg_dsn, f"INSERT INTO osm_publications (uuid, server, state, month) VALUES"
                f" ('{add}', 'dev', 'published', '2026-10-01')")  # fmt: skip
    assert history(client, cam) == [
        {"what": "added", "month": "2026-09", "on_site": True, "by": None, "osm": None}
    ]
    sql(pg_dsn, f"INSERT INTO osm_publications (uuid, server, state, month) VALUES"
                f" ('{add}', 'live', 'published', '2026-10-01')")  # fmt: skip
    assert history(client, cam)[0]["osm"] == "https://www.openstreetmap.org/node/222/history"
    sql(pg_dsn, f"DELETE FROM osm_nodes WHERE camera_id = '{cam}'")


def test_024_lets_the_api_role_set_the_choice_and_nothing_more(pg_dsn, pg_loaded):
    dsn = at(pg_dsn, "history_024", "024")
    updatable = sql(dsn, "SELECT column_name FROM information_schema.column_privileges"
                         " WHERE grantee = 'preview_api' AND privilege_type = 'UPDATE'"
                         " AND table_name = 'accounts' ORDER BY 1")  # fmt: skip
    assert ["history_pseudonym"] in updatable
    sql(dsn, "INSERT INTO accounts (pseudonym, created_month) VALUES ('hx', '2026-10-01')")
    assert sql(dsn, "SELECT history_pseudonym FROM accounts") == [["f"]]
    sql(dsn, "SET ROLE preview_api; UPDATE accounts SET history_pseudonym = true")
    assert sql(dsn, "SELECT history_pseudonym FROM accounts") == [["t"]]
