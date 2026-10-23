"""« Multi-boules » over HTTP and in the database (migration 025, questions@6): the shape
answer `multidome` with its number of domes or none, what the API and the database refuse,
and what leaves for the build (db/export_contributions.sql)."""

import json
import uuid

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from test_api_app import TODAY, headers

from lacarte import apply, contrib, regions
from lacarte.api import app as api
from lacarte.api import live


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
def cam(pg_dsn, pg_loaded):
    with psycopg.connect(pg_dsn) as conn:
        cid = conn.execute(
            "SELECT camera_id FROM cameras WHERE NOT indoor AND osm_type = 'n'"
            " ORDER BY camera_id LIMIT 1"
        ).fetchone()[0]
        return live.camera(conn, cid)


def shape(client, cam, build_id, who="ana", **fields):
    uid = str(uuid.uuid4())
    body = {"kind": "shape", "uuid": uid, "camera": cam.camera_id, "build_id": build_id,
            "day": TODAY, "on_site": True, **fields}  # fmt: skip
    return uid, client.post("/api/contributions", json=body, headers=headers(who))


def stored(pg_dsn, uid):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute(
            "SELECT answer, dome_count FROM contributions WHERE uuid = %s", (uid,)
        ).fetchone()


def test_a_multidome_is_stored_with_its_number_or_none(client, cam, build_id, pg_dsn):
    three, r = shape(client, cam, build_id, answer="multidome", dome_count=3)
    assert r.status_code == 200, r.text
    assert stored(pg_dsn, three) == ("multidome", 3)
    unknown, r = shape(client, cam, build_id, who="bob", answer="multidome")
    assert r.status_code == 200, r.text
    assert stored(pg_dsn, unknown) == ("multidome", None)
    # The same body again is the same contribution (its digest unchanged by the field).
    again = client.post("/api/contributions", headers=headers("ana"), json={
        "kind": "shape", "uuid": three, "camera": cam.camera_id, "build_id": build_id,
        "day": TODAY, "on_site": True, "answer": "multidome", "dome_count": 3})  # fmt: skip
    assert again.status_code == 200 and again.json()["new"] is False
    # « Mes contributions » and /revue's rows say the number.
    mine = client.get("/api/me/contributions", headers=headers("ana")).json()["contributions"]
    assert [(c["answer"], c["dome_count"]) for c in mine] == [("multidome", 3)]
    with api.pool.connection() as conn:
        rows = {r["uuid"]: r for r in api.review_rows(conn)}
    assert rows[three]["dome_count"] == 3 and rows[unknown]["dome_count"] is None


@pytest.mark.parametrize(
    "fields",
    [
        {"answer": "dome", "dome_count": 3},  # a number only with « Multi-boules »
        {"answer": "unknown", "dome_count": 2},
        {"answer": "multidome", "dome_count": 1},  # questions@6 dome_count: 2 to 6
        {"answer": "multidome", "dome_count": 7},
        {"answer": "multidome", "dome_count": 2.5},
    ],
)
def test_a_number_out_of_place_or_bounds_is_refused(client, cam, build_id, fields):
    _, r = shape(client, cam, build_id, **fields)
    assert r.status_code == 422, r.text


def test_the_database_refuses_what_the_api_would(pg_dsn, cam):
    ana = sessions.account_id("ana", pg_dsn)
    insert = (
        "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
        " build_id, author_id, day, answer, dome_count, geom, payload, body_sha256, osm_tags)"
        " VALUES (%s, 'shape', %s, 'n', 1, 1, 'b', %s, current_date, %s, %s,"
        " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}')"
    )
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        for answer, count in (("multidome", 2), ("multidome", 6), ("multidome", None)):
            conn.execute(insert, (str(uuid.uuid4()), cam.camera_id, ana, answer, count))
        for answer, count in (("multidome", 1), ("multidome", 7), ("dome", 3)):
            with pytest.raises(psycopg.errors.CheckViolation):
                conn.execute(insert, (str(uuid.uuid4()), cam.camera_id, ana, answer, count))


def test_the_export_carries_the_number_to_the_build(client, cam, build_id, pg_dsn, tmp_path,
                                                    monkeypatch):  # fmt: skip
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    three, _ = shape(client, cam, build_id, answer="multidome", dome_count=3)
    unknown, _ = shape(client, cam, build_id, who="bob", answer="multidome")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'validated', decided_on = current_date")
    contrib.export(dsn=pg_dsn)
    rows = {r["uuid"]: r for r in map(json.loads, (tmp_path / "ci.jsonl").read_text().split())}
    assert rows[three]["dome_count"] == 3 and "dome_count" not in rows[unknown]
    read = {c.uuid: c for c in apply.read(tmp_path / "ci.jsonl")}
    assert (read[three].answer, read[three].dome_count) == ("multidome", 3)
    assert read[unknown].dome_count is None


def test_the_preview_draws_a_multidome_all_around(client, cam, build_id):
    """« Modifier »'s preview with « Multi-boules »: the full circle, a dome's reach."""
    r = client.post("/api/modify/preview", headers=headers("ana"),
                    json={"camera": cam.camera_id, "shape": "multidome"})  # fmt: skip
    assert r.status_code == 200, r.text
    with api.pool.connection() as conn:
        served = live.camera(conn, cam.camera_id)
        polys = live.buildings_near(conn, served.x, served.y, live.fetch_radius(served))
    want = api.shown(live.field(api.modified_camera(served, "multidome"), served.x, served.y,
                                polys))  # fmt: skip
    assert r.json()["bands"] == json.loads(json.dumps(want))
    assert api.modified_camera(served, "multidome").fov_deg == 360.0
