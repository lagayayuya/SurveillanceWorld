"""Participation API over HTTP (FastAPI TestClient) on the La Défense database."""

import io
import json
import logging
import math
import re
import subprocess
import sys
import uuid
from csv import DictReader
from datetime import date

import psycopg
import pytest
import sessions
import shapely
from fastapi.testclient import TestClient
from sessions import ORIGIN, headers  # noqa: F401 (the other API tests import them here)
from shapely import Point

from lacarte import participation
from lacarte.api import app as api
from lacarte.api import live

TODAY = date.today().isoformat()


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
def near_wall(pg_dsn, pg_loaded):
    """An outdoor camera, and a point 2 m off the facade nearest to it."""
    with psycopg.connect(pg_dsn) as conn:
        ids = [
            r[0]
            for r in conn.execute(
                "SELECT camera_id FROM cameras WHERE NOT indoor ORDER BY camera_id"
            )
        ]
        for cid in ids:
            cam = live.camera(conn, cid)
            polys = live.buildings_near(conn, cam.x, cam.y, 30)
            if not polys:
                continue
            pt = Point(cam.x, cam.y)
            host = min(polys, key=lambda p: p.boundary.distance(pt))
            if host.contains(pt) or not 3 < host.boundary.distance(pt) < 30:
                continue
            n = shapely.ops.nearest_points(host.boundary, pt)[0]
            d = host.boundary.distance(pt)
            x, y = n.x + (pt.x - n.x) * 2 / d, n.y + (pt.y - n.y) * 2 / d
            return cam, live.TO_LL.transform(x, y)
    raise AssertionError("no camera near a facade in the fixture")


@pytest.fixture(scope="module")
def inside_point(near_wall, pg_dsn):
    """A point 2 m inside the footprint whose facade near_wall's point faces."""
    cam, to = near_wall
    x, y = live.to_metres(*to)
    with psycopg.connect(pg_dsn) as conn:
        polys = live.buildings_near(conn, x, y, 10)
    pt = Point(x, y)
    host = min(polys, key=lambda p: p.boundary.distance(pt))
    n = shapely.ops.nearest_points(host.boundary, pt)[0]
    d = host.boundary.distance(pt)
    inside = (n.x - (pt.x - n.x) * 2 / d, n.y - (pt.y - n.y) * 2 / d)
    assert host.contains(Point(inside))
    return live.TO_LL.transform(*inside)


def lonlat(cam):
    return live.TO_LL.transform(cam.x, cam.y)


def verify(client, cam, build_id, who="ana", answer="present", uid=None, **extra):
    uid = uid or str(uuid.uuid4())
    body = {
        "kind": "verify",
        "camera": cam.camera_id,
        "build_id": build_id,
        "day": TODAY,
        "duration_ms": 1200,
        "on_site": True,
        "answer": answer,
        **extra,
    }
    return uid, client.post("/api/contributions", json={**body, "uuid": uid}, headers=headers(who))


def move(client, cam, build_id, to, who="ana", placement="facade", uid=None, legacy=None):
    """A move; `legacy` replaces `placement` by release 1's fields (snap, under_arcade)."""
    uid = uid or str(uuid.uuid4())
    body = {
        "kind": "move",
        "camera": cam.camera_id,
        "build_id": build_id,
        "day": TODAY,
        "duration_ms": 8000,
        "on_site": None,
        "lon": to[0],
        "lat": to[1],
        **(legacy if legacy is not None else {"placement": placement}),
    }
    return uid, client.post("/api/contributions", json={**body, "uuid": uid}, headers=headers(who))


# --- guards ------------------------------------------------------------------------------


@pytest.mark.parametrize(("path", "error"), [("/api/me/contributions", "session"),
                                             ("/api/review/queue", "privileged")])  # fmt: skip
def test_nothing_answers_without_a_session_and_x_author_is_no_one(client, path, error):
    """Who writes is the session's account: an X-Author header (Caddy strips it anyway)
    names no one (tests/test_accounts_api.py: every route's requirement)."""
    r = client.get(path, headers={"X-Author": "rev"})
    assert r.status_code == 401 and r.json() == {"error": error}


def test_writes_need_our_origin_and_json(client, near_wall, build_id):
    cam, _ = near_wall
    body = {"camera": cam.camera_id, "lon": 2.24, "lat": 48.89, "placement": "facade"}
    h = headers()
    assert (
        client.post(
            "/api/preview", json=body, headers={**h, "Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    del h["Origin"]
    assert client.post("/api/preview", json=body, headers=h).status_code == 403
    r = client.post(
        "/api/preview",
        content="camera=x",
        headers=headers(**{"Content-Type": "application/x-www-form-urlencoded"}),
    )
    assert r.status_code == 415


def test_review_is_for_the_review_account_only(client):
    assert client.get("/api/review/queue", headers=headers("ana")).status_code == 401
    assert client.get("/api/review/queue", headers=headers("rev")).status_code == 200


# --- preview -----------------------------------------------------------------------------


def test_preview_at_the_served_position_draws_the_shown_bands(client, near_wall):
    cam, _ = near_wall
    lon, lat = lonlat(cam)
    r = client.post(
        "/api/preview",
        json={"camera": cam.camera_id, "lon": lon, "lat": lat, "placement": "free"},
        headers=headers(),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["move_m"] == 0 and out["pulled"] is False
    feats = out["bands"]["features"]
    assert feats and {f["properties"]["b"] for f in feats} <= {1, 2}
    assert {f["properties"]["lv"] for f in feats} <= {1, 2, 3}


def test_preview_with_the_magnet_lands_half_a_metre_off_the_facade(client, near_wall):
    cam, (lon, lat) = near_wall
    body = {"camera": cam.camera_id, "lon": lon, "lat": lat}
    facade = {**body, "placement": "facade"}
    pulled = client.post("/api/preview", json=facade, headers=headers()).json()
    assert pulled["pulled"] is True and pulled["facade_m"] == pytest.approx(0.5, abs=0.01)
    assert len(pulled["facade"]) == 2
    assert pulled["inside_footprint"] is False
    free = client.post("/api/preview", json={**body, "placement": "free"}, headers=headers()).json()
    assert free["pulled"] is False and free["facade_m"] == pytest.approx(2.0, abs=0.01)
    assert free["inside_footprint"] is False


def test_preview_refuses_far_moves_and_points_outside_the_region(client, near_wall):
    cam, _ = near_wall
    lon, lat = lonlat(cam)
    far = client.post(
        "/api/preview",
        json={"camera": cam.camera_id, "lon": lon + 0.001, "lat": lat, "placement": "facade"},
        headers=headers(),
    )
    assert far.status_code == 422 and far.json()["error"] == "too_far"  # ~73 m east
    out = client.post(
        "/api/preview",
        json={"camera": cam.camera_id, "lon": 5.0, "lat": 45.0, "placement": "facade"},
        headers=headers(),
    )
    assert out.status_code == 422 and out.json()["error"] == "outside_region"
    unknown = client.post(
        "/api/preview",
        json={"camera": "n0", "lon": lon, "lat": lat, "placement": "facade"},
        headers=headers(),
    )
    assert unknown.status_code == 404


# --- contributions -----------------------------------------------------------------------


def test_a_contribution_is_idempotent(client, near_wall, build_id):
    cam, _ = near_wall
    uid, first = verify(client, cam, build_id)
    assert first.status_code == 200 and first.json() == {
        "uuid": uid,
        "status": "pending",
        "new": True,
    }
    _, again = verify(client, cam, build_id, uid=uid)
    assert again.json() == {"uuid": uid, "status": "pending", "new": False}
    _, changed = verify(client, cam, build_id, uid=uid, answer="unsure")
    assert changed.status_code == 409
    _, other = verify(client, cam, build_id, who="bob", uid=uid)
    assert other.status_code == 409


def test_only_v4_uuids_are_accepted(client, near_wall, build_id):
    cam, _ = near_wall
    for bad in (str(uuid.uuid1()), "not-a-uuid"):
        _, r = verify(client, cam, build_id, uid=bad)
        assert r.status_code == 422, bad


def opinion(client, cam, build_id, target, who="bob", kind="agree"):
    uid = str(uuid.uuid4())
    body = {"kind": kind, "camera": cam.camera_id, "build_id": build_id, "day": TODAY,
            "duration_ms": 900, "on_site": None, "target": target, "uuid": uid}  # fmt: skip
    return uid, client.post("/api/contributions", json=body, headers=headers(who))


def review_row(client, uid):
    rows = client.get("/api/review/contributions", headers=headers("rev")).json()
    return next(r for r in rows["contributions"] if r["uuid"] == uid)


def test_review_mode_counts_agreement_and_only_the_review_account_decides(
    client, near_wall, build_id
):
    cam, _ = near_wall
    a, r1 = verify(client, cam, build_id, who="ana", answer="not_found")
    _, r2 = verify(client, cam, build_id, who="bob", answer="not_found")
    _, r3 = verify(client, cam, build_id, who="cy", answer="present")
    assert [r.json()["status"] for r in (r1, r2, r3)] == ["pending"] * 3
    row = review_row(client, a)
    assert (row["agree"], row["disagree"], row["decided_by"]) == (1, 1, None)
    decide = {"uuid": a, "decision": "validated"}
    assert client.post("/api/review/decide", json=decide, headers=headers("ana")).status_code == 401
    r = client.post("/api/review/decide", json=decide, headers=headers("rev"))
    # The answer lists every contribution the decision took (its own here).
    assert r.status_code == 200 and r.json() == {"uuid": a, "status": "validated", "decided": [a]}
    row = review_row(client, a)
    assert (row["status"], row["decided_by"], row["decided_on"]) == ("validated", "rev", TODAY)
    mine = client.get("/api/me/contributions", headers=headers("ana")).json()["contributions"]
    assert [c["status"] for c in mine] == ["validated"]
    # The profile (25b) reads where it stands and what the others said, as /revue counts it.
    assert (mine[0]["agree"], mine[0]["disagree"]) == (1, 1)
    assert mine[0]["lng"] is not None and mine[0]["lat"] is not None and "commune" in mine[0]
    rejected = {"uuid": a, "decision": "rejected"}
    assert (
        client.post("/api/review/decide", json=rejected, headers=headers("rev")).status_code == 200
    )
    assert review_row(client, a)["status"] == "rejected"


def test_peer_mode_validates_on_another_author_s_agreement(
    client, near_wall, build_id, monkeypatch
):
    rules = {**participation.rules(), "validation": "peer"}
    monkeypatch.setattr(participation, "rules", lambda: rules)
    cam, to = near_wall
    verify(client, cam, build_id, who="ana")
    _, r = verify(client, cam, build_id, who="bob")
    assert r.json()["status"] == "validated"
    m1, r1 = move(client, cam, build_id, to, who="ana")
    assert r1.json()["status"] == "pending"
    _, r2 = opinion(client, cam, build_id, m1, who="cy")
    assert r2.status_code == 200
    assert review_row(client, m1)["status"] == "validated"


def test_opinions_are_about_another_author_s_proposal(client, near_wall, build_id):
    cam, to = near_wall
    m1, _ = move(client, cam, build_id, to, who="ana")
    present, _ = verify(client, cam, build_id, who="ana", answer="present")
    _, ok = opinion(client, cam, build_id, m1, who="bob", kind="agree")
    _, no = opinion(client, cam, build_id, m1, who="cy", kind="disagree")
    assert ok.status_code == no.status_code == 200 and ok.json()["status"] == "pending"
    row = review_row(client, m1)
    assert (row["agree"], row["disagree"]) == (1, 1)
    assert opinion(client, cam, build_id, m1, who="ana")[1].json()["error"] == "own_proposal"
    assert opinion(client, cam, build_id, present)[1].json()["error"] == "not_a_proposal"
    assert opinion(client, cam, build_id, str(uuid.uuid4()))[1].status_code == 404
    rows = client.get("/api/review/contributions", headers=headers("rev")).json()
    assert {c["kind"] for c in rows["contributions"]} == {"move", "verify"}  # counts, not rows
    op_uuid = opinion(client, cam, build_id, m1, who="dee")[0]
    decide = {"uuid": op_uuid, "decision": "validated"}
    r = client.post("/api/review/decide", json=decide, headers=headers("rev"))
    assert r.json()["error"] == "not_decidable"


def test_me_says_the_role_and_the_validation_mode(client):
    assert client.get("/api/me", headers=headers("rev")).json() == {
        "author": "rev", "pseudonym": "rev", "reviewer": True, "role": "admin",
        "since": date.today().strftime("%Y-%m"), "leaderboard": False,
        "history_pseudonym": False, "validation": "review", "osm": False, "password": True,
        "sync": False, "publish": False}  # fmt: skip
    me = client.get("/api/me", headers=headers("ana")).json()
    assert (me["reviewer"], me["role"]) == (False, "contributor")


def test_a_move_stores_the_computed_field(client, near_wall, build_id, pg_dsn):
    cam, to = near_wall
    uid, r = move(client, cam, build_id, to, who="ana")
    assert r.status_code == 200 and r.json()["status"] == "pending"
    with psycopg.connect(pg_dsn) as conn:
        p, day = conn.execute(
            "SELECT payload, day FROM contributions WHERE uuid = %s", (uid,)
        ).fetchone()
    assert p["pulled"] is True and p["facade_m"] == pytest.approx(0.5, abs=0.01)
    assert p["bands"]["features"] and p["old"] == list(live.to_lonlat(cam.x, cam.y))
    assert str(day) == TODAY


def payload_of(pg_dsn, uid):
    with psycopg.connect(pg_dsn) as conn:
        row = conn.execute("SELECT payload FROM contributions WHERE uuid = %s", (uid,))
        return row.fetchone()[0]


def test_a_free_move_in_a_footprint_is_found_inside_and_kept_there(
    client, near_wall, inside_point, build_id, pg_dsn
):
    """An awning or an arcade: the tester chose "Libre" and put the camera in a footprint."""
    cam, _ = near_wall
    uid, r = move(client, cam, build_id, inside_point, placement="free")
    assert r.status_code == 200
    p = payload_of(pg_dsn, uid)
    assert p["placement"] == "free" and p["pulled"] is False and p["inside_footprint"] is True
    assert p["position"] == list(live.to_lonlat(*live.to_metres(*inside_point)))
    assert "under_arcade" not in p and "mount_observed" not in p


@pytest.mark.parametrize(
    ("legacy", "placement", "pulled"),
    [({"snap": True}, "facade", True), ({"snap": False}, "free", False),
     ({"snap": True, "under_arcade": True, "mount_observed": "pole"}, "free", False)],
)  # fmt: skip
def test_release_1_bodies_still_queued_on_phones_are_read(
    client, near_wall, build_id, pg_dsn, legacy, placement, pulled
):
    cam, to = near_wall
    uid, r = move(client, cam, build_id, to, legacy=legacy)
    assert r.status_code == 200, r.text
    p = payload_of(pg_dsn, uid)
    assert (p["placement"], p["pulled"]) == (placement, pulled)
    for key in ("under_arcade", "mount_observed"):
        assert p.get(key) == legacy.get(key)


def test_a_move_without_placement_is_refused(client, near_wall, build_id):
    cam, to = near_wall
    _, r = move(client, cam, build_id, to, legacy={})
    assert r.status_code == 422


@pytest.mark.parametrize("table", ["contributions", "accounts", "sessions", "cameras",
                                   "admin_log", "site_settings", "hidden_cameras",
                                   "site_counters", "site_counters_month",
                                   "site_counters_hour"])  # fmt: skip
def test_nothing_about_time_of_day_or_address_is_stored(pg_dsn, client, near_wall, build_id, table):
    """Contributions, and since migration 014 accounts and sessions: days and months only,
    no address, no user agent; nor the served cameras (019 adds their street, a way's
    name, not a person's address); nor the journal, the settings and the hidden cameras
    (020); nor the site's counters (021: a day or a month, a name, a number). The one
    exception: site_counters_hour's `at` (021, the « go » of 17/10), the start of an hour —
    a name and a number, no one's, held to the hour by its CHECK and kept 8 Paris days
    at most (lacarte_retention(), 023)."""
    cam, _ = near_wall
    verify(client, cam, build_id)
    with psycopg.connect(pg_dsn) as conn:
        types = dict(
            conn.execute(
                "SELECT column_name, data_type FROM information_schema.columns"
                " WHERE table_name = %s",
                (table,),
            ).fetchall()
        )
        on_the_hour = conn.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint"
            " WHERE conname = 'site_counters_hour_at'").fetchone()  # fmt: skip
    assert types
    types.pop("osm_timestamp", None)  # the OSM edit's date, not the contributor's
    if table == "site_counters_hour":
        assert types.pop("at") == "timestamp with time zone"
        assert "date_trunc('hour'" in on_the_hour[0] and "'UTC'" in on_the_hour[0]
        assert set(types) == {"counter", "n"}
    assert not {t for t in types.values() if "time" in t or t in ("inet", "cidr")}
    words = {w for c in types for w in c.split("_")}
    assert not words & {"ip", "address", "agent", "email", "mail", "time", "at"}


def test_the_gesture_s_duration_is_accepted_never_kept(client, near_wall, build_id, pg_dsn):
    """Migration 021: no column for it any more. An older phone's queued send still carries
    it: accepted, stored without it, and sent again it is the same body (200, not new);
    a send without it is accepted too."""
    cam, _ = near_wall
    uid, r = verify(client, cam, build_id)  # with duration_ms, as an older phone sends
    assert r.status_code == 200 and r.json()["new"] is True, r.text
    again = verify(client, cam, build_id, uid=uid)[1]
    assert again.status_code == 200 and again.json()["new"] is False, again.text
    body = {"kind": "verify", "camera": cam.camera_id, "build_id": build_id, "day": TODAY,
            "on_site": None, "answer": "present", "uuid": str(uuid.uuid4())}  # fmt: skip
    assert client.post("/api/contributions", json=body, headers=headers()).status_code == 200
    with psycopg.connect(pg_dsn) as conn:
        assert not conn.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name ="
            " 'contributions' AND column_name = 'duration_ms'"
        ).fetchone()


def test_a_body_with_the_duration_keeps_the_digest_it_had():
    """The digest of a send made before lot 4 (computed by that release's body_digest): the
    same today, so that its retry is not a 409 uuid_taken."""
    body = {"kind": "verify", "camera": "n1", "build_id": "b", "day": "2026-10-10",
            "duration_ms": 1200, "on_site": True, "answer": "present",
            "uuid": "00000000-0000-4000-8000-000000000021"}  # fmt: skip
    digest = api.body_digest(api.VerifyIn(**body))
    assert digest == "f787c51e0df7daa0a437dea154a93466f87f6462827aa32ffb29553e98d81d5e"


def test_writes_are_rate_limited_per_author(client, near_wall, build_id, monkeypatch):
    rules = {
        **participation.rules(),
        "limits": {"writes_per_minute": 2, "previews_per_minute": 600},
    }
    monkeypatch.setattr(participation, "rules", lambda: rules)
    cam, _ = near_wall
    codes = [verify(client, cam, build_id)[1].status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert verify(client, cam, build_id, who="bob")[1].status_code == 200


def test_proposals_are_shown_to_every_account_without_author(client, near_wall, build_id):
    cam, to = near_wall
    lon, lat = lonlat(cam)
    gone, _ = verify(client, cam, build_id, who="ana", answer="not_found")
    moved, _ = move(client, cam, build_id, to, who="ana")
    verify(client, cam, build_id, who="ana", answer="present")  # not a proposal
    opinion(client, cam, build_id, moved, who="bob", kind="agree")
    bbox = f"{lon - 0.002},{lat - 0.002},{lon + 0.002},{lat + 0.002}"
    seen_by_bob = client.get(f"/api/proposals?bbox={bbox}", headers=headers("bob")).json()
    props = {f["properties"]["u"]: f["properties"] for f in seen_by_bob["features"]}
    assert set(props) == {gone, moved}
    assert props[moved]["k"] == "move" and props[moved]["n"] == 1 and props[moved]["o"] == "agree"
    assert props[moved]["m"] is False and len(props[moved]["to"]) == 2 and props[moved]["mv"] > 0
    assert props[gone]["k"] == "not_found" and props[gone]["o"] is None
    for f in seen_by_bob["features"]:  # on the camera, where the map draws it
        assert f["geometry"]["coordinates"] == pytest.approx([lon, lat], abs=1e-6)
        assert "bands" not in f["properties"]
    body = json.dumps(seen_by_bob)
    assert "ana" not in body and "bob" not in body  # no author on the map
    seen_by_ana = client.get(f"/api/proposals?bbox={bbox}", headers=headers("ana")).json()
    assert all(f["properties"]["m"] for f in seen_by_ana["features"])
    one = client.get(f"/api/proposals?camera={cam.camera_id}", headers=headers("bob")).json()
    by_uuid = {f["properties"]["u"]: f["properties"] for f in one["features"]}
    fields = [by_uuid[moved].get("bands")]
    assert fields and fields[0]["features"]  # the proposed field, on selection only
    assert client.get("/api/proposals?bbox=0,0,10,10", headers=headers()).status_code == 422
    assert client.get("/api/proposals", headers=headers()).status_code == 422


def test_proposals_give_the_public_a_month_and_reviewers_the_day(client, near_wall, build_id):
    cam, to = near_wall
    lon, lat = lonlat(cam)
    moved, _ = move(client, cam, build_id, to, who="ana")
    bbox = f"{lon - 0.002},{lat - 0.002},{lon + 0.002},{lat + 0.002}"
    for path in (f"/api/proposals?bbox={bbox}", f"/api/proposals?camera={cam.camera_id}"):
        for who in (None, "bob", "ana", "rev"):
            body = client.get(path, headers=headers(who) if who else {}).json()
            props = {f["properties"]["u"]: f["properties"] for f in body["features"]}
            assert props[moved]["month"] == TODAY[:7] and "day" not in props[moved]
            assert not re.search(r"\d{4}-\d{2}-\d{2}", json.dumps(body)), (path, who)
    assert review_row(client, moved)["day"] == TODAY
    mine = client.get("/api/me/contributions", headers=headers("ana")).json()["contributions"]
    assert {c["uuid"]: c["day"] for c in mine}[moved] == TODAY


def test_a_rejected_proposal_leaves_the_map(client, near_wall, build_id):
    cam, _ = near_wall
    gone, _ = verify(client, cam, build_id, who="ana", answer="not_found")
    client.post("/api/review/decide", json={"uuid": gone, "decision": "rejected"},
                headers=headers("rev"))  # fmt: skip
    one = client.get(f"/api/proposals?camera={cam.camera_id}", headers=headers("bob")).json()
    assert one["features"] == []


def test_what_a_build_applied_leaves_the_map_and_shows_its_state(
    client, near_wall, build_id, pg_dsn
):
    """Migration 005: applied, superseded and conflict (written by the deploy, here as the
    owner) are no longer proposals; the review may reject an applied contribution and may
    revalidate a conflict, unless the element is gone."""
    cam, to = near_wall
    applied, _ = move(client, cam, build_id, to, who="ana")
    superseded, _ = move(client, cam, build_id, to, who="ana")
    conflict, _ = verify(client, cam, build_id, who="ana", answer="not_found")
    gone, _ = verify(client, cam, build_id, who="bob", answer="not_found")
    still, _ = move(client, cam, build_id, to, who="bob")
    for uid in (applied, superseded, conflict, gone, still):
        client.post("/api/review/decide", json={"uuid": uid, "decision": "validated"},
                    headers=headers("rev"))  # fmt: skip
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        for uid, status, detail in (
            (applied, "applied", {"osm_version": 1, "result": "applied"}),
            (superseded, "superseded", {"osm_version": 1, "result": "superseded"}),
            (conflict, "conflict", {"osm_version": 2, "reason": "osm_version"}),
            (gone, "conflict", {"reason": "osm_deleted"}),
        ):
            conn.execute("UPDATE contributions SET status = %s, apply_build = 'idf-b',"
                         " apply_detail = %s WHERE uuid = %s",
                         (status, json.dumps(detail), uid))  # fmt: skip
    one = client.get(f"/api/proposals?camera={cam.camera_id}", headers=headers("bob")).json()
    assert [f["properties"]["u"] for f in one["features"]] == [still]
    assert opinion(client, cam, build_id, applied, who="bob", kind="agree")[1].status_code == 422
    mine = client.get("/api/me/contributions", headers=headers("ana")).json()["contributions"]
    state = {c["uuid"]: (c["status"], c["apply_build"]) for c in mine}
    assert state[applied] == ("applied", "idf-b") and state[conflict] == ("conflict", "idf-b")
    lst = client.get("/api/review/contributions?status=conflict", headers=headers("rev")).json()
    assert {c["uuid"] for c in lst["contributions"]} == {conflict, gone}
    assert all(c["apply_detail"]["reason"] for c in lst["contributions"])
    q = f"/api/review/contributions?status=conflict&camera={cam.camera_id}"
    assert len(client.get(q, headers=headers("rev")).json()["contributions"]) == 2
    q = "/api/review/contributions?status=conflict&camera=n0"
    assert client.get(q, headers=headers("rev")).json()["contributions"] == []
    # A reviewer reads one camera's, never the whole list (the CSV's: an administrator's).
    q = f"/api/review/contributions?status=conflict&camera={cam.camera_id}"
    assert len(client.get(q, headers=headers("rvw")).json()["contributions"]) == 2
    whole = client.get("/api/review/contributions?status=conflict", headers=headers("rvw"))
    assert (whole.status_code, whole.json()) == (403, {"error": "admin"})

    def decide(uid, decision):
        return client.post("/api/review/decide", json={"uuid": uid, "decision": decision},
                           headers=headers("rev"))  # fmt: skip

    assert decide(applied, "rejected").json()["status"] == "rejected"  # the camera goes back
    assert decide(gone, "validated").json() == {"error": "element_gone"}
    assert decide(gone, "rejected").status_code == 200
    assert decide(conflict, "validated").status_code == 200  # accepts OSM version 2


def test_review_lists_counts_and_exports(client, near_wall, build_id):
    cam, to = near_wall
    move(client, cam, build_id, to)
    verify(client, cam, build_id, who="bob", answer="unsure")
    lst = client.get("/api/review/contributions?kind=move", headers=headers("rev")).json()
    assert [c["kind"] for c in lst["contributions"]] == ["move"] and lst["authors"] == [
        "ana",
        "bob",
    ]
    queue = client.get("/api/review/queue", headers=headers("rev")).json()
    assert queue["summary"]["pending"] == 2
    csv = client.get("/api/review/export.csv", headers=headers("rev"))
    lines = csv.text.strip().splitlines()
    assert lines[0].startswith("uuid,kind,camera") and len(lines) == 3
    rows = {r["kind"]: r for r in DictReader(io.StringIO(csv.text))}
    assert rows["move"]["pulled"] == "True" and rows["move"]["facade_m"]
    assert "duration_ms" not in rows["verify"]  # lot 4: no longer kept


def test_an_internal_error_logs_neither_values_nor_traceback(
    client, near_wall, monkeypatch, caplog
):
    secret = str(uuid.uuid4())

    def boom(*_a, **_k):
        raise RuntimeError(f"Key (uuid)=({secret}) already exists")

    monkeypatch.setattr(api, "get_camera", boom)
    cam, _ = near_wall
    with caplog.at_level(logging.DEBUG):
        r = client.post(
            "/api/preview",
            json={"camera": cam.camera_id, "lon": 2.24, "lat": 48.89, "placement": "facade"},
            headers=headers(),
        )
    assert r.status_code == 500 and r.json() == {"error": "internal"}
    assert secret not in caplog.text and "Traceback" not in caplog.text
    assert "unhandled RuntimeError on /api/preview" in caplog.text


def test_the_api_imports_no_heavy_library():
    code = (
        "import sys, lacarte.api.app; "
        "print(sorted({'geopandas', 'pandas', 'pyarrow', 'h3', 'osmium'} & set(sys.modules)))"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "[]"


def test_move_limit_is_the_rules_value():
    assert participation.rules()["move"]["max_m"] == 50 and math.isfinite(50)


def test_no_route_carries_a_contribution_id_in_its_path():
    """Caddy logs the URI of a failed proxied request: no uuid may be in it."""
    paths = [getattr(r, "path", "") for r in api.app.routes]
    assert paths and not [p for p in paths if "{" in p]


def test_facades_come_in_the_camera_s_plane_with_an_exact_enough_frame(client, near_wall, pg_dsn):
    """The phone's magnet works in metres relative to the camera: the polygons are the
    prepared buildings shifted, and the affine frame errs by less than a millimetre."""
    cam, _ = near_wall
    r = client.post("/api/facades", json={"camera": cam.camera_id}, headers=headers())
    assert r.status_code == 200, r.text
    out = r.json()
    with psycopg.connect(pg_dsn) as conn:
        polys = live.buildings_near(conn, cam.x, cam.y, 60)
    assert len(out["polygons"]) == len(polys) > 0
    for got, poly in zip(out["polygons"], polys, strict=True):
        ext = [(x + cam.x, y + cam.y) for x, y in got[0]]
        assert shapely.Polygon(ext).equals_exact(shapely.Polygon(poly.exterior), 1e-3)
    f = out["frame"]
    worst = 0.0
    for dx in (-60, -25, 0, 25, 60):
        for dy in (-60, -25, 0, 25, 60):
            lon, lat = live.TO_LL.transform(cam.x + dx, cam.y + dy)
            a, b = lon - f["lon0"], lat - f["lat0"]
            x = f["to_m"][0][0] * a + f["to_m"][0][1] * b
            y = f["to_m"][1][0] * a + f["to_m"][1][1] * b
            worst = max(worst, math.hypot(x - dx, y - dy))
    assert worst < 1e-3, worst
    assert (out["capture_m"], out["offset_m"]) == (3, 0.5)
