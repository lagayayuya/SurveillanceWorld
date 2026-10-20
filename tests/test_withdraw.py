"""Phase "Retours terrain": an author withdraws their own pending contribution (migration
008, POST /api/contributions/withdraw). The trigger itself, as the API role, is in
test_db.py (test_008_...)."""

import csv
import io
import uuid

import psycopg
import pytest
import sessions
import test_api_app
from fastapi.testclient import TestClient
from test_add import post, post_add
from test_api_app import TODAY, headers, lonlat

from lacarte import participation
from lacarte.api import app as api
from lacarte.api import live

near_wall = test_api_app.near_wall  # the camera near a facade, a fixture


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh(pg_dsn, client):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
    api.limits.hits.clear()


@pytest.fixture(scope="module")
def build_id(pg_dsn, pg_loaded):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute("SELECT build_id FROM meta").fetchone()[0]


@pytest.fixture(scope="module")
def facade_point(pg_dsn, pg_loaded):
    """1 m off a facade, more than 20 m from every camera (as in test_add)."""
    return live.to_lonlat(644329.8662116162 + 0.7, 6866484.319232392 + 0.7)


def withdraw(client, uid, who="ana"):
    return client.post("/api/contributions/withdraw", json={"uuid": uid}, headers=headers(who))


def status(dsn, uid):
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT status, (SELECT pseudonym FROM accounts WHERE id = decided_by_id)"
            " FROM contributions WHERE uuid = %s",
            (uid,),
        ).fetchone()


def review_uuids(client, **query):
    rows = client.get("/api/review/contributions", params=query, headers=headers("rev")).json()
    return {r["uuid"] for r in rows["contributions"]}


def test_the_author_withdraws_a_pending_move_and_it_leaves_every_list(
    client, near_wall, build_id, pg_dsn
):
    cam, to = near_wall
    body = {"kind": "move", "camera": cam.camera_id, "build_id": build_id, "day": TODAY,
            "duration_ms": 8000, "on_site": None, "lon": to[0], "lat": to[1],
            "placement": "free", "uuid": str(uuid.uuid4())}  # fmt: skip
    uid = body["uuid"]
    assert client.post("/api/contributions", json=body, headers=headers()).status_code == 200
    r = withdraw(client, uid)
    assert r.status_code == 200 and r.json() == {"uuid": uid, "status": "withdrawn",
                                                 "withdrawn": []}  # fmt: skip
    assert status(pg_dsn, uid) == ("withdrawn", "ana")
    # Withdrawing again, or the send queue sending it again: nothing changes.
    assert withdraw(client, uid).json()["status"] == "withdrawn"
    again = client.post("/api/contributions", json=body, headers=headers())
    assert again.status_code == 200 and again.json() == {"uuid": uid, "status": "withdrawn",
                                                         "new": False}  # fmt: skip
    lon, lat = lonlat(cam)
    bbox = f"{lon - 0.001},{lat - 0.001},{lon + 0.001},{lat + 0.001}"
    feats = client.get(f"/api/proposals?bbox={bbox}", headers=headers("bob")).json()["features"]
    assert uid not in {f["properties"]["u"] for f in feats}
    assert uid not in review_uuids(client)
    assert uid in review_uuids(client, status="withdrawn")
    queue = client.get("/api/review/queue", params={"filter": "all"}, headers=headers("rev"))
    assert queue.json()["items"] == [] and queue.json()["summary"]["pending"] == 0
    csv_rows = list(csv.DictReader(io.StringIO(
        client.get("/api/review/export.csv", headers=headers("rev")).text)))  # fmt: skip
    assert [(c["uuid"], c["status"]) for c in csv_rows] == [(uid, "withdrawn")]
    mine = client.get("/api/me/contributions", headers=headers()).json()["contributions"]
    assert [c["status"] for c in mine] == ["withdrawn"]
    # The review cannot decide it any more.
    r = client.post("/api/review/decide", json={"uuid": uid, "decision": "validated"},
                    headers=headers("rev"))  # fmt: skip
    assert r.status_code == 409 and r.json()["error"] == "withdrawn"


def test_only_its_author_and_only_while_pending(client, near_wall, build_id, pg_dsn):
    cam, _ = near_wall
    uid, _ = post(client, cam.camera_id, build_id, "verify", answer="present")
    r = withdraw(client, uid, who="bob")
    assert r.status_code == 404 and status(pg_dsn, uid) == ("pending", None)
    client.post("/api/review/decide", json={"uuid": uid, "decision": "validated"},
                headers=headers("rev"))  # fmt: skip
    r = withdraw(client, uid)
    assert r.status_code == 409 and r.json()["error"] == "not_pending"
    assert withdraw(client, str(uuid.uuid4())).status_code == 404


def test_an_add_takes_its_author_s_pending_answers_not_the_others(
    client, build_id, facade_point, pg_dsn
):
    uid, _ = post_add(client, build_id, facade_point)
    cid = participation.added_id(uid)
    shape, _ = post(client, cid, build_id, "shape", answer="dome")
    bob_says, _ = post(client, cid, build_id, "operator", who="bob", answer="public")
    bob_agrees, _ = post(client, cid, build_id, "agree", who="bob", target=uid)
    r = withdraw(client, uid)
    assert r.status_code == 200 and r.json()["withdrawn"] == [shape]
    assert status(pg_dsn, shape) == ("withdrawn", "ana")
    assert status(pg_dsn, bob_says) == ("pending", None)
    assert status(pg_dsn, bob_agrees) == ("pending", None)
    # A withdrawn add is no camera any more, nor a proposal, nor a duplicate candidate.
    _, r = post(client, cid, build_id, "shape", who="bob", answer="ptz")
    assert r.status_code == 404
    lon, lat = facade_point
    bbox = f"{lon - 0.001},{lat - 0.001},{lon + 0.001},{lat + 0.001}"
    feats = client.get(f"/api/proposals?bbox={bbox}", headers=headers("bob")).json()["features"]
    assert uid not in {f["properties"]["u"] for f in feats}
    other, _ = post_add(client, build_id, facade_point, who="bob")
    with psycopg.connect(pg_dsn) as conn:
        near = conn.execute("SELECT payload->'near' FROM contributions WHERE uuid = %s",
                            (other,)).fetchone()[0]  # fmt: skip
    assert cid not in near


def test_a_withdrawn_opinion_no_longer_counts_and_may_be_given_again(client, near_wall, build_id):
    cam, _ = near_wall
    proposal, _ = post(client, cam.camera_id, build_id, "verify", answer="not_found")
    first, r = post(client, cam.camera_id, build_id, "agree", who="bob", target=proposal)
    assert r.status_code == 200

    def seen_by_bob():
        q = f"/api/proposals?camera={cam.camera_id}"
        feats = client.get(q, headers=headers("bob")).json()["features"]
        p = next(f["properties"] for f in feats if f["properties"]["u"] == proposal)
        return p["n"], p["o"]

    assert seen_by_bob() == (1, "agree")
    assert withdraw(client, first, who="bob").status_code == 200
    assert seen_by_bob() == (0, None)
    _, r = post(client, cam.camera_id, build_id, "disagree", who="bob", target=proposal)
    assert r.status_code == 200 and seen_by_bob() == (0, "disagree")


def test_withdrawing_has_its_own_rate_limit(client, near_wall, build_id, monkeypatch):
    """An author who has just used up the writes of the minute (an add and its answers count
    four) can still take a contribution back: withdrawing has its own bucket."""
    cam, _ = near_wall
    uid, _ = post(client, cam.camera_id, build_id, "verify", answer="present")
    per_minute = api.participation.rules()["limits"]["writes_per_minute"]
    for _ in range(per_minute):
        api.limits.allow(sessions.account_id("ana"), "write", per_minute)
    _, refused = post(client, cam.camera_id, build_id, "verify", answer="unsure")
    assert refused.status_code == 429
    assert withdraw(client, uid).status_code == 200
