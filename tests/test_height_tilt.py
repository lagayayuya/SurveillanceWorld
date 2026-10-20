"""Phase D3 in the database and over HTTP: the height and tilt answers (migration 011, as
the API role), the field stored for /revue (blind zone), a tilt the build leaves validated
for want of a height (settle keeps its rank), and the review's lists and statistics."""

import json
import subprocess
import uuid

import psycopg
import pytest
import sessions
import shapely
from fastapi.testclient import TestClient
from pyproj import Transformer
from shapely.geometry import shape
from test_api_app import TODAY, headers
from test_db import acct, ensure, ensure_sql, other_database, sql

from lacarte import db, regions
from lacarte.api import app as api
from lacarte.api import live

# --- migration 011, as the API role ----------------------------------------------------------


@pytest.fixture(scope="module")
def as_api(pg_dsn, pg_loaded):
    """A database migrated as bootstrap.sh sets it up (default privileges to the API role)."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS d3_checks")
    sql(pg_dsn, "CREATE DATABASE d3_checks")
    other = other_database(pg_dsn, "d3_checks")
    sql(other, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api')"
               " THEN CREATE ROLE preview_api; END IF; END $$")  # fmt: skip
    sql(other, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO preview_api")
    db.migrate(other)
    sql(other, "GRANT INSERT ON contributions TO preview_api")
    return other


def _insert(dsn, kind, answer, direction="NULL", tags="'{}'", role=True):
    a = f"'{answer}'" if answer is not None else "NULL"
    sql(
        dsn,
        ensure_sql("ana")
        + ("SET ROLE preview_api; " if role else "")
        + "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
        " build_id, author_id, day, geom, payload, body_sha256, osm_tags, answer,"
        f" direction_deg) VALUES ('{uuid.uuid4()}', '{kind}', 'n1', 'n', 1, 1, 'b', {acct('ana')},"
        " '2026-10-04', ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x',"
        f" {tags}, {a}, {direction})",
    )


def test_011_checks_as_the_api_role(as_api):
    """011's checks as 017 left them: no `pole` any more (the API stores it as `first`)."""
    for kind, answer in [("height", "ground"), ("height", "first"), ("height", "upper"),
                         ("height", "unknown"), ("tilt", "horizon"),
                         ("tilt", "slight"), ("tilt", "steep"), ("tilt", "unknown"),
                         ("shape", "dome"), ("operator", "public")]:  # fmt: skip
        _insert(as_api, kind, answer)
    refused = [
        ("height", None, "NULL"),  # no answer
        ("height", "3", "NULL"),  # metres, not a class
        ("height", "slight", "NULL"),  # another question's class
        ("height", "pole", "NULL"),  # 017: the classique's, stored as `first`
        ("tilt", "25", "NULL"),  # degrees, not a class
        ("tilt", "first", "NULL"),
        ("tilt", "slight", "25"),  # a bearing on a tilt
        ("verify", "first", "NULL"),
        ("lens", "slight", "NULL"),  # not a kind
    ]
    for kind, answer, direction in refused:
        with pytest.raises(subprocess.CalledProcessError) as e:
            _insert(as_api, kind, answer, direction)
        assert "violates" in e.value.stderr, (kind, answer)
    with pytest.raises(subprocess.CalledProcessError) as e:  # the 006 trigger: tags required
        _insert(as_api, "tilt", "slight", tags="NULL")
    assert "tags" in e.value.stderr
    sql(as_api, "TRUNCATE contributions CASCADE")


def _seq(dsn, uid):
    return sql(dsn, f"SELECT status, decision_seq, apply_detail FROM contributions"
                    f" WHERE uuid = '{uid}'")[0]  # fmt: skip


def test_settle_moves_a_tilt_back_to_validated_without_renumbering_it(pg_dsn, pg_loaded, tmp_path):
    """A tilt applied by one build and left validated by the next (no height any more: the
    height answer was rejected) keeps its decision_seq: settle is no review decision."""
    sql(pg_dsn, "TRUNCATE contributions CASCADE")
    tilt, other = str(uuid.uuid4()), str(uuid.uuid4())
    ensure(pg_dsn, "ana", "rev")
    for uid, kind, answer in ((other, "height", "first"), (tilt, "tilt", "slight")):
        sql(pg_dsn, "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id,"
                    " osm_version, build_id, author_id, day, geom, payload,"
                    " body_sha256, osm_tags, answer) VALUES"
                    f" ('{uid}', '{kind}', 'n1', 'n', 1, 1, 'b', {acct('ana')}, '2026-10-04',"
                    " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}',"
                    f" '{answer}')")  # fmt: skip
        sql(pg_dsn, "UPDATE contributions SET status = 'validated',"
                    f" decided_by_id = {acct('rev')}, decided_on = '2026-10-04'"
                    f" WHERE uuid = '{uid}'")  # fmt: skip
    seq = _seq(pg_dsn, tilt)[1]
    assert seq == "2"
    sql(pg_dsn, f"UPDATE contributions SET status = 'applied' WHERE uuid = '{tilt}'")
    build = sql(pg_dsn, "SELECT build_id FROM meta")[0][0]
    doc = {
        "build_id": build,
        "contributions": [
            {"uuid": tilt, "result": "validated", "reason": "no_height", "osm_version": 1}
        ],
    }
    (tmp_path / "contrib_outcome.json").write_text(json.dumps(doc))
    subprocess.run([str(regions.ROOT / "db" / "settle.sh"), str(tmp_path), pg_dsn],
                   check=True, capture_output=True, text=True)  # fmt: skip
    status, after, detail = _seq(pg_dsn, tilt)
    assert (status, after) == ("validated", seq)
    assert json.loads(detail) == {"result": "validated", "reason": "no_height", "osm_version": 1}
    # A review decision still numbers: rejected, then validated again.
    for status in ("rejected", "validated"):
        sql(pg_dsn, f"UPDATE contributions SET status = '{status}' WHERE uuid = '{tilt}'")
    assert _seq(pg_dsn, tilt)[1] == "4"
    sql(pg_dsn, "TRUNCATE contributions CASCADE")


# --- over HTTP ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture
def fresh(pg_dsn, client):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
    api.limits.hits.clear()


@pytest.fixture(scope="module")
def cams(pg_dsn, pg_loaded):
    """CI cameras: a tube with an OSM height and no tilt, one with both, a dome whose height
    is by default; and the build id."""
    with psycopg.connect(pg_dsn) as conn:

        def first(where):
            cid = conn.execute(f"SELECT camera_id FROM cameras WHERE {where}"
                               " ORDER BY camera_id LIMIT 1").fetchone()[0]  # fmt: skip
            return live.camera(conn, cid)

        return {
            "tube": first(
                "kind = 'fixed' AND height_certainty = 'estimated' AND tilt_deg IS NULL"
                " AND cardinality(directions) = 1 AND height_m >= 3"
            ),
            "tilted": first("height_certainty = 'estimated' AND tilt_deg IS NOT NULL"),
            "dome": first("kind = 'dome' AND height_certainty = 'default'"),
            "build": conn.execute("SELECT build_id FROM meta").fetchone()[0],
        }


def post(client, cams, cam, kind, who="ana", **fields):
    uid = str(uuid.uuid4())
    body = {"kind": kind, "uuid": uid, "camera": cam.camera_id, "build_id": cams["build"],
            "day": TODAY, "duration_ms": 2000, "on_site": True, **fields}  # fmt: skip
    r = client.post("/api/contributions", json=body, headers=headers(who))
    return uid, r


def payload(pg_dsn, uid):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute("SELECT answer, payload FROM contributions WHERE uuid = %s",
                            (uid,)).fetchone()  # fmt: skip


TO_M = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


def near_area(fc, cam, within=3.0) -> float:
    """Area of a stored field within `within` metres of the camera (m2)."""
    geoms = [shapely.ops.transform(TO_M.transform, shape(f["geometry"])) for f in fc["features"]]
    disk = shapely.Point(cam.x, cam.y).buffer(within)
    return shapely.union_all(geoms).intersection(disk).area


@pytest.mark.usefixtures("fresh")
def test_a_tilt_stores_the_field_it_gives(client, cams, pg_dsn):
    tube = cams["tube"]
    uid, r = post(client, cams, tube, "tilt", answer="steep")
    assert r.status_code == 200, r.text
    answer, p = payload(pg_dsn, uid)
    assert answer == "steep" and p["kind_served"] == "fixed"

    # At 3 m a steep tilt mostly caps the reach on the ground (camerafield.mount: its
    # blind zone is a few decimetres with a wide lens; see the 8 m case below).
    def reach(fc):
        return max(f["properties"]["r"] for f in fc["features"])

    assert reach(p["bands"]) < 0.5 * reach(p["old_bands"])


@pytest.mark.usefixtures("fresh")
def test_a_tilt_without_any_height_stores_no_field(client, cams, pg_dsn):
    dome = cams["dome"]  # height by default: the tilt alone changes nothing
    uid, r = post(client, cams, dome, "tilt", answer="slight", aim_kind="fixed")
    assert r.status_code == 200, r.text
    _, p = payload(pg_dsn, uid)
    assert p["no_effect"] == "no_height" and "bands" not in p
    # With the height answered on the same screen (and the shape before): a blind zone
    # under it, at 8 m.
    uid, r = post(client, cams, dome, "tilt", answer="steep", aim_kind="fixed",
                  aim_direction=90, aim_height="upper")  # fmt: skip
    assert r.status_code == 200, r.text
    _, p = payload(pg_dsn, uid)
    assert (p["aim_kind"], p["aim_direction"], p["aim_height"]) == ("fixed", 90, "upper")
    before, after = near_area(p["old_bands"], dome), near_area(p["bands"], dome)
    assert before > 1.0 and after < 0.5 * before


@pytest.mark.usefixtures("fresh")
def test_a_height_stores_a_field_only_when_a_tilt_makes_it_count(client, cams, pg_dsn):
    uid, r = post(client, cams, cams["tilted"], "height", answer="upper")
    assert r.status_code == 200, r.text
    _, p = payload(pg_dsn, uid)
    assert p["bands"]["features"] and p["old_bands"]["features"]
    uid, r = post(client, cams, cams["tube"], "height", answer="first")
    _, p = payload(pg_dsn, uid)
    assert p["no_effect"] == "no_tilt" and "bands" not in p
    uid, r = post(client, cams, cams["tube"], "height", answer="unknown")
    assert r.status_code == 200
    _, p = payload(pg_dsn, uid)
    assert "bands" not in p and "no_effect" not in p


@pytest.mark.usefixtures("fresh")
@pytest.mark.parametrize("fields", [
    {"kind": "height", "answer": "3"}, {"kind": "height", "answer": "steep"},
    {"kind": "tilt", "answer": "25"}, {"kind": "tilt", "answer": "slight", "aim_height": "x"},
    {"kind": "tilt", "answer": "slight", "aim_direction": 360},
    {"kind": "height", "answer": "first", "aim_kind": "bullet"},
])  # fmt: skip
def test_malformed_height_and_tilt_answers_are_refused(client, cams, fields):
    _, r = post(client, cams, cams["tube"], **fields)
    assert r.status_code == 422, (fields, r.text)


@pytest.mark.usefixtures("fresh")
def test_review_leaves_blank_answers_out_and_sees_agreement_by_class(client, cams):
    tube = cams["tube"]
    post(client, cams, tube, "tilt", answer="slight", who="ana")
    post(client, cams, tube, "tilt", answer="slight", who="bob")
    post(client, cams, tube, "tilt", answer="unknown", who="cid")
    post(client, cams, tube, "height", answer="unknown", who="ana")
    queue = client.get("/api/review/queue", headers=headers("rev")).json()
    [item] = [i for i in queue["items"] if i["camera"] == tube.camera_id]
    assert [p["answer"] for p in item["pieces"]] == ["slight", "slight"]
    assert item["confirmed"] == 2  # the same class from two accounts, on site
    # "Je ne sais pas" waits for no decision: out of the camera's list.
    rows = client.get("/api/review/contributions", headers=headers("rev")).json()
    assert sorted(r["answer"] for r in rows["contributions"]) == ["slight", "slight"]
    w = client.get(f"/api/review/camera?camera={tube.camera_id}", headers=headers("rev")).json()
    assert w["served"]["tilt"] is None and w["served"]["height_certainty"] == "estimated"
