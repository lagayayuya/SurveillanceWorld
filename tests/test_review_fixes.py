"""Corrections after the D3 iPhone tests, over HTTP: the field of a pending add follows its
open answers (sector, blind zone; a withdrawn or rejected answer recomputes it), and the
review can change a decision (validated <-> rejected, applied -> rejected, a conflict
either way, nothing else), each change numbered by the database (migration 011)."""

import uuid

import psycopg
import pytest
import sessions
import shapely
from fastapi.testclient import TestClient
from pyproj import Transformer
from shapely.geometry import shape
from test_api_app import TODAY, headers

from lacarte import participation
from lacarte.api import app as api
from lacarte.api import live

TO_M = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


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


# In the open, south of the fixture's add00001 facade: no building within the field's first
# metres, so the blind zone shows.
SPOT = live.to_lonlat(644329.8662116162, 6866484.319232392 - 12.0)


def send(client, build_id, kind, who="ana", **fields):
    uid = str(uuid.uuid4())
    body = {"kind": kind, "uuid": uid, "build_id": build_id, "day": TODAY,
            "duration_ms": 2000, "on_site": True, **fields}  # fmt: skip
    r = client.post("/api/contributions", json=body, headers=headers(who))
    assert r.status_code == 200, r.text
    return uid


def add_with_answers(client, build_id):
    add = send(client, build_id, "add", lon=SPOT[0], lat=SPOT[1], placement="free")
    cam = participation.added_id(add)
    ids = {
        "shape": send(client, build_id, "shape", camera=cam, answer="bullet"),
        "direction": send(client, build_id, "direction", camera=cam, direction=90),
        "height": send(client, build_id, "height", camera=cam, answer="upper"),
        "tilt": send(
            client,
            build_id,
            "tilt",
            camera=cam,
            answer="slight",
            aim_kind="fixed",
            aim_direction=90,
            aim_height="upper",
        ),  # fmt: skip
    }
    return add, cam, ids


def field(client, cam, who="ana"):
    r = client.get(f"/api/proposals?camera={cam}", headers=headers(who))
    assert r.status_code == 200, r.text
    feats = r.json()["features"]
    add = next(f for f in feats if f["properties"]["k"] == "add")
    lon, lat = add["geometry"]["coordinates"]
    x, y = TO_M.transform(lon, lat)
    geoms = [shapely.ops.transform(TO_M.transform, shape(f["geometry"]))
             for f in add["properties"]["bands"]["features"]]  # fmt: skip
    return shapely.Point(x, y), shapely.union_all(geoms)


def test_a_pending_add_draws_the_field_its_answers_give(client, build_id):
    _, cam, ids = add_with_answers(client, build_id)
    origin, f = field(client, cam)
    # Aimed east (90 degrees): nothing filmed west of it; at 8 m, a little down: a blind zone.
    west = shapely.box(origin.x - 200, origin.y - 200, origin.x - 1, origin.y + 200)
    assert f.area > 0 and f.intersection(west).area < 0.01 * f.area
    assert f.distance(origin) > 3.0
    # The tilt withdrawn by its author: no blind zone any more, still a sector.
    r = client.post("/api/contributions/withdraw", json={"uuid": ids["tilt"]},
                    headers=headers("ana"))  # fmt: skip
    assert r.status_code == 200, r.text
    origin, f = field(client, cam)
    assert f.distance(origin) < 1.0 and f.intersection(west).area < 0.01 * f.area
    # The direction rejected by the review: the full circle of a camera without direction.
    r = client.post("/api/review/decide", json={"uuid": ids["direction"], "decision": "rejected"},
                    headers=headers("rev"))  # fmt: skip
    assert r.status_code == 200, r.text
    origin, f = field(client, cam)
    assert f.intersection(west).area > 0.1 * f.area


def test_the_review_window_of_an_add_has_its_proposed_field(client, build_id):
    _, cam, _ = add_with_answers(client, build_id)
    w = client.get(f"/api/review/camera?camera={cam}", headers=headers("rev")).json()
    assert w["proposed"]["features"]
    _, f = field(client, cam)
    got = shapely.union_all([shapely.ops.transform(TO_M.transform, shape(g["geometry"]))
                             for g in w["proposed"]["features"]])  # fmt: skip
    assert abs(got.area - f.area) < 1.0


def test_an_add_s_answers_come_with_its_camera_not_with_the_view(client, build_id):
    """Its sheet lists them from /api/proposals?camera=; the view's list, fetched on every
    pan of the map, does not read them (one query per pending add)."""
    _, cam, _ = add_with_answers(client, build_id)
    one = client.get(f"/api/proposals?camera={cam}", headers=headers("bob")).json()
    add = next(f["properties"] for f in one["features"] if f["properties"]["k"] == "add")
    assert add["ans"] == {"shape": "bullet", "direction": 90, "height": "upper", "tilt": "slight"}
    lon, lat = SPOT
    bbox = f"{lon - 0.001},{lat - 0.001},{lon + 0.001},{lat + 0.001}"
    view = client.get(f"/api/proposals?bbox={bbox}", headers=headers("bob")).json()
    seen = next(f["properties"] for f in view["features"] if f["properties"]["c"] == cam)
    assert seen["k"] == "add" and "ans" not in seen
    # An add nobody answered: read, nothing kept.
    other = live.to_lonlat(644329.8662116162 + 15.0, 6866484.319232392 - 12.0)
    bare = send(client, build_id, "add", lon=other[0], lat=other[1], placement="free")
    cam2 = participation.added_id(bare)
    one = client.get(f"/api/proposals?camera={cam2}", headers=headers("bob")).json()
    assert next(f["properties"] for f in one["features"])["ans"] == {}


def seq(pg_dsn, uid):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute(
            "SELECT status, decision_seq FROM contributions WHERE uuid = %s", (uid,)
        ).fetchone()


def decide(client, uid, decision):
    return client.post("/api/review/decide", json={"uuid": uid, "decision": decision},
                       headers=headers("rev"))  # fmt: skip


def test_a_decision_can_be_changed_and_each_change_is_numbered(client, build_id, pg_dsn):
    add = send(client, build_id, "add", lon=SPOT[0], lat=SPOT[1], placement="free")
    cam = participation.added_id(add)
    uid = send(client, build_id, "height", camera=cam, answer="first")
    numbers = []
    for decision in ("validated", "rejected", "validated", "rejected"):
        r = decide(client, uid, decision)
        assert r.status_code == 200, r.text
        status, n = seq(pg_dsn, uid)
        assert status == decision
        numbers.append(n)
    assert numbers == sorted(numbers) and len(set(numbers)) == 4
    # Applied by a build (the deploy writes it): only "rejected" is a change.
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'applied' WHERE uuid = %s", (uid,))
    assert decide(client, uid, "validated").status_code == 409
    r = decide(client, uid, "rejected")
    assert r.status_code == 200 and seq(pg_dsn, uid)[1] > numbers[-1]
    # Superseded or withdrawn: nothing to change.
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'superseded' WHERE uuid = %s", (uid,))
    assert decide(client, uid, "rejected").status_code == 409
    assert decide(client, uid, "validated").status_code == 409
    other = send(client, build_id, "tilt", camera=cam, answer="slight")
    client.post("/api/contributions/withdraw", json={"uuid": other}, headers=headers("ana"))
    assert decide(client, other, "validated").status_code == 409
    # A conflict either way, as before.
    third = send(client, build_id, "shape", camera=cam, answer="dome")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'conflict' WHERE uuid = %s", (third,))
    assert decide(client, third, "validated").status_code == 200
