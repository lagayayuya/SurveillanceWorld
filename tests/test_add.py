"""Phase "Ajouter": a camera the map does not have.

- the `apply` rules on synthetic rows (rules/contributions.yaml add, duplicate);
- the La Défense pipeline with the adds of tests/fixtures/contrib-ci.jsonl:
    add00001  an add alone, on a facade
    add00002  an add answered dome, 158 degrees (towards rue Le Tintoret), public
    add00003  an add 3.2 m from an OSM camera mapped since (n1925222797): conflict
  (a rejected add is not exported: tested on the database's export below);
- migration 007's checks as the API role meets them, and the export's SQL;
- the API: an add, its duplicates list, answers and opinions on it, the review.
"""

import json
import subprocess
import uuid

import geopandas as gpd
import pandas as pd
import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from test_api_app import TODAY, headers
from test_db import acct, ensure_sql, other_database, sql

from lacarte import apply, contrib, db, participation, tiles
from lacarte.api import app as api
from lacarte.api import live

A1, A2, A3 = "cadd000010000", "cadd000020000", "cadd000030000"
DUPLICATE_OF = "n1925222797"


def U(s: str) -> str:
    return f"00000000-0000-4000-8000-{s:0>12}"


def add(uid="01", rank=1, x=0.0, y=0.0, month="2026-10", near=()):
    u = U(uid)
    return apply.Contribution(u, "add", apply.added_id(u), None, month, rank, x=x, y=y,
                              placement="facade", near=tuple(near))  # fmt: skip


def on(a, uid, kind, rank, answer=None, **kw):
    return apply.Contribution(U(uid), kind, a.camera_id, None, a.month, rank, answer, **kw)


def osm(xy):
    return apply.Osm(1, {"man_made": "surveillance"}, xy, "dome")


# --- rules --------------------------------------------------------------------------------


def test_the_id_comes_from_the_uuid_and_is_none_of_osm_s():
    u = str(uuid.uuid4())
    cid = participation.added_id(u)
    assert cid == "c" + u.replace("-", "")[:12] and participation.is_added(cid)
    for osm_id in ("n123", "w4", "r9", "c123", "cADD000010000", "c0000000000000"):
        assert not participation.is_added(osm_id), osm_id
    # Feature ids: exact in JavaScript, above every OSM id * 3 + 2 (ids ~ 1.4e10 today).
    top = tiles.numeric_id("cffffffffffff")
    assert top < 2**53 and tiles.numeric_id("c000000000000") == 2**52
    assert tiles.numeric_id("r999999999999") < 2**52


def test_added_cameras_come_after_the_osm_ones_in_the_compact_numbers():
    ids = ["n5", "c00000000000a", "w2", "n10"]
    assert tiles.compact_ids(ids) == {"n10": 0, "n5": 1, "w2": 2, "c00000000000a": 3}
    assert tiles.compact_ids(["n5", "w2"]) == {"n5": 0, "w2": 1}


def test_an_add_alone_creates_a_seen_camera():
    a = add(x=10.0, y=20.0)
    outcome, states = apply.settle([a], {"n1": osm((100.0, 100.0))})
    assert outcome == {a.uuid: {"result": "applied"}}
    s = states[a.camera_id]
    assert (s.added, s.added_month, s.seen_month, s.position) == ((10.0, 20.0), "2026-10",
                                                                  "2026-10", None)  # fmt: skip


def test_answers_on_an_add_apply_without_any_osm_version():
    a = add()
    rows = [a, on(a, "21", "shape", 2, "dome"), on(a, "22", "direction", 3, direction=85,
            x=0.0, y=0.0), on(a, "23", "operator", 4, "public")]  # fmt: skip
    outcome, states = apply.settle(rows, {})
    assert {o["result"] for o in outcome.values()} == {"applied"}
    s = states[a.camera_id]
    assert (s.kind, s.direction, s.operator) == ("dome", 85, ("public", None))


def test_an_osm_camera_mapped_beside_it_since_is_a_duplicate_conflict():
    a = add(x=0.0, y=0.0)
    rows = [a, on(a, "21", "shape", 2, "dome")]
    outcome, states = apply.settle(rows, {"n7": osm((3.0, 1.0)), "n8": osm((30.0, 0.0))})
    assert outcome == {a.uuid: {"result": "conflict", "reason": "duplicate", "near": ["n7"]}}
    assert states == {}  # no camera; its answer waits for the review (no outcome)


def test_cameras_seen_at_receipt_or_kept_by_the_review_are_told_apart():
    a = add(x=0.0, y=0.0, near=["n7"])
    outcome, states = apply.settle([a], {"n7": osm((3.0, 1.0))})
    assert outcome == {a.uuid: {"result": "applied", "accepted": ["n7"]}}
    assert a.camera_id in states


def test_answers_whose_add_is_not_exported_get_no_outcome():
    a = add()
    outcome, states = apply.settle([on(a, "21", "shape", 2, "dome")], {})
    assert outcome == {} and states == {}


def test_a_later_move_places_it_and_a_later_not_found_marks_it_gone():
    a = add(x=0.0, y=0.0)
    m = on(a, "31", "move", 2, x=4.0, y=0.0, placement="free")
    outcome, states = apply.settle([a, m], {})
    assert outcome[m.uuid] == {"result": "applied"} and outcome[a.uuid]["result"] == "applied"
    assert states[a.camera_id].position == (4.0, 0.0)
    gone = on(a, "41", "verify", 3, "not_found")
    _, states = apply.settle([a, m, gone], {})
    assert states[a.camera_id].gone_month == "2026-10"


def test_the_file_checks_an_add_s_id_and_its_lack_of_version(tmp_path):
    good = {"uuid": "add00001-0000-4000-8000-000000000001", "kind": "add", "rank": 1,
            "camera_id": "cadd000010000", "month": "2026-10", "x": 1.0, "y": 2.0}  # fmt: skip
    path = tmp_path / "ci.jsonl"
    for bad in ({**good, "camera_id": "cadd000010001"}, {**good, "osm_version": 1},
                {k: v for k, v in good.items() if k != "x"}):  # fmt: skip
        path.write_text(json.dumps(bad) + "\n")
        with pytest.raises(ValueError):
            apply.read(path)
    path.write_text(json.dumps(good) + "\n")
    assert apply.read(path)[0].camera_id == "cadd000010000"
    # The export's own check: no OSM key on an added camera, all of them on the others.
    assert contrib.parse(['{"region": "ci"}', json.dumps(good)])[1] == [good]


# --- the La Défense pipeline ----------------------------------------------------------------


@pytest.fixture(scope="module")
def built(ci_contrib_pipeline):
    b = ci_contrib_pipeline.build_dir
    cams = gpd.read_parquet(b / apply.CAMERAS).set_index("camera_id")
    feats = {}
    for line in (b / "tiles_src" / "cameras.geojsonl").read_text().splitlines():
        f = json.loads(line)
        feats[f["properties"]["id"]] = f
    return ci_contrib_pipeline, cams, feats


def _fixture(uid):
    path = apply.regions.ROOT / "tests" / "fixtures" / "contrib-ci.jsonl"
    return next(json.loads(x) for x in path.read_text().splitlines() if uid in x)


def test_an_applied_add_is_a_default_camera_at_its_exact_position(built):
    _, cams, feats = built
    c = cams.loc[A1]
    row = _fixture("add00001")
    assert (c.geometry.x, c.geometry.y) == (row["x"], row["y"])
    assert (c.kind, c.kind_certainty, c.operator_class, list(c.directions)) == (
        "unknown", "default", "unknown", [])  # fmt: skip
    assert (c.position_source, c.position_certainty, c.added_month, c.seen_month) == (
        "contribution", "identified", "2026-10", "2026-10")  # fmt: skip
    assert c.tags == "{}" and c.osm_version is pd.NA or pd.isna(c.osm_version)
    assert str(cams.osm_version.dtype) == "Int64"
    assert cams.osm_version.notna().sum() == len(cams) - 2
    p = feats[A1]["properties"]
    assert (p["am"], p["vm"], p["pm"]) == ("2026-10", "2026-10", "2026-10")
    assert feats[A1]["id"] == 2**52 + 0xADD000010000


def test_its_answers_set_kind_direction_and_operator(built):
    _, cams, _ = built
    c = cams.loc[A2]
    assert (c.kind, list(c.directions), c.operator_class) == ("dome", [158.0], "public")
    assert c.direction_certainty == "estimated" and c.kind_certainty == "estimated"


def test_added_cameras_have_fields_and_enter_the_streets(built):
    region, _, _ = built
    b = region.build_dir
    bands = gpd.read_parquet(b / "bands.parquet")
    for cid in (A1, A2):
        assert (bands.camera_id == cid).any(), cid
    # The oriented one draws a sector, not a full circle.
    sector = bands[(bands.camera_id == A2) & (bands.level == "detection")].geometry.area.max()
    circle = bands[(bands.camera_id == A1) & (bands.level == "detection")].geometry.area.max()
    assert sector < circle
    portions = gpd.read_parquet(b / "street_portions.parquet")
    listed = {c.split(":")[0] for cams in portions.cameras for c in cams}
    assert A1 in listed or A2 in listed


def test_a_duplicate_add_leaves_no_camera(built):
    _, cams, feats = built
    assert A3 not in cams.index and A3 not in feats and DUPLICATE_OF in cams.index


def test_adds_renumber_no_osm_camera(built, ci_pipeline):
    _, _, feats = built
    before = {}
    for line in (ci_pipeline.build_dir / "tiles_src" / "cameras.geojsonl").read_text().splitlines():
        p = json.loads(line)["properties"]
        before[p["id"]] = p["n"]
    assert all(feats[c]["properties"]["n"] == n for c, n in before.items())
    assert {feats[c]["properties"]["n"] for c in (A1, A2)} == {len(before), len(before) + 1}


def test_the_database_export_has_no_osm_element_for_an_added_camera(built, tmp_path, pg_dsn):
    region, _, _ = built
    db.export(region, tmp_path, workers=2)
    rows = {r.split("\t")[0]: r.split("\t") for r in _gunzip(tmp_path / "cameras.tsv.gz")}
    assert rows[A1][1:4] == ["\\N", "\\N", "\\N"]
    meta = (tmp_path / "meta.tsv").read_text().rstrip("\n").split("\t")
    assert json.loads(meta[4]) == apply.add_template()
    # It loads: migration 007's checks on the served snapshot accept it.
    sql(pg_dsn, "DROP DATABASE IF EXISTS add_load")
    sql(pg_dsn, "CREATE DATABASE add_load")
    other = other_database(pg_dsn, "add_load")
    db.migrate(other)
    db.load(tmp_path, other)
    assert sql(other, f"SELECT osm_type IS NULL, tags::text FROM cameras WHERE camera_id = '{A1}'"
               ) == [["t", "{}"]]  # fmt: skip


def _gunzip(path):
    import gzip

    with gzip.open(path, "rt") as f:
        return f.read().splitlines()


# --- migration 007 and the export --------------------------------------------------------------

COLS = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
        " geom, payload, body_sha256, osm_tags, target, answer, status")  # fmt: skip


def _insert(dsn, uid, kind, camera, osm=("NULL", "NULL", "NULL"), tags="{}", target=None,
            answer=None, status="pending", role=True, x=0, y=0):  # fmt: skip
    t = f"'{target}'" if target else "NULL"
    a = f"'{answer}'" if answer else "NULL"
    sql(
        dsn,
        ensure_sql("ana")
        + ("SET ROLE preview_api; " if role else "")
        + f"INSERT INTO contributions ({COLS}) VALUES ('{uid}', '{kind}', '{camera}',"
        f" {osm[0]}, {osm[1]}, {osm[2]}, 'b', {acct('ana')}, '2026-10-01',"
        f" ST_SetSRID(ST_MakePoint({x}, {y}), 2154), '{{}}', 'x', '{tags}', {t}, {a}, '{status}')",
    )


@pytest.fixture(scope="module")
def as_api(pg_dsn, pg_loaded):
    """A database migrated as bootstrap.sh sets it up (default privileges to the API role)."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS add_checks")
    sql(pg_dsn, "CREATE DATABASE add_checks")
    other = other_database(pg_dsn, "add_checks")
    sql(other, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api')"
               " THEN CREATE ROLE preview_api; END IF; END $$")  # fmt: skip
    sql(other, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO preview_api")
    db.migrate(other)
    sql(other, "GRANT INSERT ON contributions TO preview_api")
    return other


def test_007_checks_as_the_api_role(as_api):
    dsn = as_api
    a = "add00001-0000-4000-8000-000000000001"
    _insert(dsn, a, "add", "cadd000010000")  # accepted
    refused = [
        ("add00002-0000-4000-8000-000000000002", "add", "cadd000010000", {}),  # id not its own
        (
            "add00003-0000-4000-8000-000000000003",
            "add",
            "cadd000030000",
            {"osm": ("'n'", "1", "1")},
        ),  # an OSM element  # fmt: skip
        (
            "add00004-0000-4000-8000-000000000004",
            "add",
            "cadd000040000",
            {"tags": '{"man_made": "surveillance"}'},
        ),
        ("add00005-0000-4000-8000-000000000005", "add", "cadd000050000", {"target": a}),
        (str(uuid.uuid4()), "shape", "cadd000010000", {"answer": "dome"}),  # no target
        (
            str(uuid.uuid4()),
            "shape",
            "n1",
            {"answer": "dome", "target": a, "osm": ("'n'", "1", "1")},
        ),  # fmt: skip
        (
            str(uuid.uuid4()),
            "shape",
            "cadd000010000",
            {"answer": "dome", "osm": ("'n'", "1", "1"), "target": a},
        ),  # fmt: skip
    ]
    for uid, kind, cam, kw in refused:
        with pytest.raises(subprocess.CalledProcessError) as e:
            _insert(dsn, uid, kind, cam, **kw)
        err = e.value.stderr  # a check, or the insert trigger (it runs before the checks)
        assert "violates" in err or "points at its add" in err, (kind, kw)
    # Same id twice: the unique index.
    with pytest.raises(subprocess.CalledProcessError) as e:
        _insert(dsn, "add00001-0000-4000-8000-0000000000ff", "add", "cadd000010000")
    assert "duplicate key" in e.value.stderr
    # A contribution on an added camera points at that camera's add, not another row.
    other = str(uuid.uuid4())
    _insert(dsn, other, "shape", "cadd000010000", answer="dome", target=a)
    with pytest.raises(subprocess.CalledProcessError) as e:
        _insert(dsn, str(uuid.uuid4()), "operator", "cadd000010000", answer="public", target=other)
    assert "points at its add" in e.value.stderr
    _insert(dsn, str(uuid.uuid4()), "agree", "cadd000010000", target=a)  # an opinion on it
    # The served snapshot: an added camera without OSM element, an OSM camera with one.
    with pytest.raises(subprocess.CalledProcessError):
        sql(dsn, "INSERT INTO cameras (camera_id, osm_type, osm_id, osm_version, geom, indoor,"
                 " kind, kind_certainty, mount_group, directions, direction_certainty, fov_deg,"
                 " range_m, height_m, height_certainty, geom_certainty, optics_certainty)"
                 " VALUES ('n5', NULL, NULL, NULL, ST_SetSRID(ST_MakePoint(0, 0), 2154), false,"
                 " 'x', 'x', 'x', '{}', 'x', 1, 1, 1, 'x', 'x', 'x')")  # fmt: skip
    sql(dsn, "TRUNCATE contributions CASCADE")


def _export(dsn) -> list[dict]:
    out = subprocess.run(["psql", "-X", "-A", "-t", "-q", dsn], input=contrib.SQL.read_text(),
                         capture_output=True, text=True, check=True).stdout  # fmt: skip
    return contrib.parse([x for x in out.splitlines() if x.strip()])[1]


def test_the_export_carries_validated_adds_and_their_answers_only(as_api):
    dsn = as_api
    sql(dsn, "DELETE FROM meta; INSERT INTO meta VALUES (true, 'b', 'ci',"
             " ST_MakeEnvelope(0, 0, 1, 1, 4326))")  # fmt: skip
    keep, gone, wait = (f"add0000{i}-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))
    for uid, status in ((keep, "validated"), (gone, "rejected"), (wait, "pending")):
        _insert(
            dsn,
            uid,
            "add",
            participation.added_id(uid),
            status=status,
            role=False,
            x=644000,
            y=6866000,
        )
        _insert(
            dsn,
            str(uuid.uuid4()),
            "shape",
            participation.added_id(uid),
            answer="dome",
            target=uid,
            status="validated",
            role=False,
        )
    sql(dsn, f"UPDATE contributions SET payload = '{{\"near\": [\"n7\", \"cadd000020000\"]}}',"
             f" apply_detail = '{{\"accepted\": [\"n9\"]}}' WHERE uuid = '{keep}'")  # fmt: skip
    sql(dsn, f"UPDATE contributions SET on_site = true WHERE uuid = '{keep}'")
    rows = _export(dsn)
    assert [r.get("on_site") for r in rows if r["kind"] == "shape"] == [None]  # unknown: none
    assert sorted((r["kind"], r["camera_id"]) for r in rows) == [
        ("add", "cadd000010000"), ("shape", "cadd000010000")]  # fmt: skip
    a = next(r for r in rows if r["kind"] == "add")
    assert a["near"] == ["n7", "n9"] and (a["x"], a["y"]) == (644000, 6866000)
    assert a["on_site"] is True
    assert not {"osm_type", "osm_version", "tags"} & set(a)
    sql(dsn, "TRUNCATE contributions CASCADE")


# --- the API ---------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh(request, pg_dsn):
    if "client" in request.fixturenames:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("TRUNCATE contributions CASCADE")
        api.limits.hits.clear()


@pytest.fixture(scope="module")
def build_id(pg_dsn, pg_loaded):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute("SELECT build_id FROM meta").fetchone()[0]


@pytest.fixture(scope="module")
def facade_point(pg_dsn, pg_loaded):
    """1 m off a facade, more than 20 m from every camera (the fixture's add00001 area)."""
    return live.to_lonlat(644329.8662116162 + 0.7, 6866484.319232392 + 0.7)


def post_add(client, build_id, at, who="ana", uid=None, placement="facade"):
    uid = uid or str(uuid.uuid4())
    body = {"kind": "add", "uuid": uid, "build_id": build_id, "day": TODAY, "duration_ms": 9000,
            "on_site": True, "lon": at[0], "lat": at[1], "placement": placement}  # fmt: skip
    return uid, client.post("/api/contributions", json=body, headers=headers(who))


def post(client, cam, build_id, kind, who="ana", **fields):
    uid = str(uuid.uuid4())
    body = {"kind": kind, "uuid": uid, "camera": cam, "build_id": build_id, "day": TODAY,
            "duration_ms": 2000, "on_site": True, **fields}  # fmt: skip
    return uid, client.post("/api/contributions", json=body, headers=headers(who))


def test_an_add_is_placed_by_the_server_and_idempotent(client, build_id, facade_point, pg_dsn):
    uid, r = post_add(client, build_id, facade_point)
    assert r.status_code == 200 and r.json()["new"]
    with psycopg.connect(pg_dsn) as conn:
        cam, osm_type, tags, payload = conn.execute(
            "SELECT camera_id, osm_type, osm_tags, payload FROM contributions WHERE uuid = %s",
            (uid,)).fetchone()  # fmt: skip
    assert cam == participation.added_id(uid) and osm_type is None and tags == {}
    assert payload["pulled"] and payload["facade_m"] == 0.5 and payload["near"] == []
    assert payload["bands"]["features"] and payload["placement"] == "facade"
    _, again = post_add(client, build_id, facade_point, uid=uid)
    assert again.status_code == 200 and not again.json()["new"]
    _, other = post_add(client, build_id, (facade_point[0] + 1e-5, facade_point[1]), uid=uid)
    assert other.status_code == 409


def test_an_add_outside_the_region_is_refused(client, build_id):
    _, r = post_add(client, build_id, (5.0, 45.0))
    assert r.status_code == 422 and r.json()["error"] == "outside_region"


def test_cameras_within_the_duplicate_distance_are_kept_at_receipt(client, build_id, pg_dsn):
    with psycopg.connect(pg_dsn) as conn:
        x, y = conn.execute("SELECT ST_X(geom), ST_Y(geom) FROM cameras WHERE camera_id = %s",
                            (DUPLICATE_OF,)).fetchone()  # fmt: skip
    uid, r = post_add(client, build_id, live.to_lonlat(x + 3.0, y + 1.0), placement="free")
    assert r.status_code == 200
    with psycopg.connect(pg_dsn) as conn:
        near = conn.execute("SELECT payload->'near' FROM contributions WHERE uuid = %s",
                            (uid,)).fetchone()[0]  # fmt: skip
    assert DUPLICATE_OF in near


def test_facades_and_preview_by_point(client, facade_point):
    lon, lat = facade_point
    f = client.post("/api/facades", json={"lon": lon, "lat": lat}, headers=headers()).json()
    assert f["polygons"] and abs(f["frame"]["lon0"] - lon) < 1e-6
    body = {"add": True, "lon": lon, "lat": lat, "placement": "facade"}
    p = client.post("/api/preview", json=body, headers=headers()).json()
    assert p["pulled"] and p["bands"]["features"]
    bad = client.post("/api/preview", json={"add": True, "camera": "n1", "lon": lon, "lat": lat,
                                            "placement": "free"}, headers=headers())  # fmt: skip
    assert bad.status_code == 422


def test_an_add_not_sent_yet_previews_and_lists_from_where_it_will_be(
    client, build_id, facade_point
):
    """Phase "Retours terrain": the add leaves with its answers, so the direction preview and
    the "who films" list are asked by point, where the server will place it — the same field
    and list as for the add once stored there."""
    lon, lat = facade_point
    where = {"lon": lon, "lat": lat, "placement": "facade"}

    def aimed(body):
        r = client.post("/api/preview", json=body, headers=headers())
        assert r.status_code == 200
        return r.json()["bands"]["features"]

    draft = {d: aimed({**where, "add": True, "direction": d, "kind": "dome"})
             for d in (0, 90, 180, 270)}  # fmt: skip
    assert any(draft.values())  # a facade hides some directions, not all
    by_point = client.post("/api/operators", json={**where, "class": "public"}, headers=headers())
    assert by_point.status_code == 200
    uid, _ = post_add(client, build_id, facade_point)
    cid = participation.added_id(uid)
    for d, bands in draft.items():
        assert aimed({"camera": cid, "direction": d, "kind": "dome"}) == bands, d
    stored = client.post("/api/operators", json={"camera": cid, "class": "public"},
                         headers=headers())  # fmt: skip
    assert by_point.json()["names"] == stored.json()["names"]
    half = client.post("/api/operators", json={"lon": lon, "lat": lat, "class": "public"},
                       headers=headers())  # fmt: skip
    assert half.status_code == 422


def test_answers_and_opinions_on_a_pending_add(client, build_id, facade_point, pg_dsn):
    uid, _ = post_add(client, build_id, facade_point)
    cid = participation.added_id(uid)
    s, r = post(client, cid, build_id, "shape", answer="dome")
    assert r.status_code == 200
    d, r = post(client, cid, build_id, "direction", direction=90, aim_kind="dome")
    assert r.status_code == 200
    o, r = post(client, cid, build_id, "operator", answer="public")
    assert r.status_code == 200
    with psycopg.connect(pg_dsn) as conn:
        got = conn.execute("SELECT kind, target::text, osm_type FROM contributions"
                           " WHERE uuid = ANY(%s)", ([s, d, o],)).fetchall()  # fmt: skip
    assert {(t, osm) for _, t, osm in got} == {(uid, None)}
    _, r = post(
        client, cid, build_id, "move", lon=facade_point[0], lat=facade_point[1], placement="free"
    )
    assert r.status_code == 422 and r.json()["error"] == "add_pending"
    _, r = post(client, cid, build_id, "agree", who="bob", target=uid)
    assert r.status_code == 200
    _, r = post(client, cid, build_id, "agree", target=uid)  # its own author
    assert r.status_code == 422


def test_proposals_show_an_add_to_everyone_without_its_author(client, build_id, facade_point):
    uid, _ = post_add(client, build_id, facade_point)
    lon, lat = facade_point
    bbox = f"{lon - 0.001},{lat - 0.001},{lon + 0.001},{lat + 0.001}"
    for who, mine in (("ana", True), ("bob", False)):
        feats = client.get(f"/api/proposals?bbox={bbox}", headers=headers(who)).json()["features"]
        p = next(f["properties"] for f in feats if f["properties"]["u"] == uid)
        assert (p["k"], p["c"], p["m"]) == ("add", participation.added_id(uid), mine)
        assert "ana" not in json.dumps(p)


def test_rejecting_an_add_rejects_what_was_said_of_it(client, build_id, facade_point, pg_dsn):
    uid, _ = post_add(client, build_id, facade_point)
    s, _ = post(client, participation.added_id(uid), build_id, "shape", answer="dome")
    r = client.post(
        "/api/review/decide", json={"uuid": uid, "decision": "rejected"}, headers=headers("rev")
    )
    assert r.status_code == 200
    with psycopg.connect(pg_dsn) as conn:
        assert conn.execute("SELECT status FROM contributions WHERE uuid = %s",
                            (s,)).fetchone()[0] == "rejected"  # fmt: skip
    # A rejected add is no camera any more.
    _, r = post(client, participation.added_id(uid), build_id, "shape", answer="ptz")
    assert r.status_code == 404


def test_validating_an_add_validates_its_authors_answers_with_it(client, build_id,
                                                                facade_point, pg_dsn):  # fmt: skip
    uid, _ = post_add(client, build_id, facade_point)
    cid = participation.added_id(uid)
    s, _ = post(client, cid, build_id, "shape", answer="dome")
    blank, _ = post(client, cid, build_id, "operator", answer="unknown")
    other, _ = post(client, cid, build_id, "direction", who="bob", direction=90, aim_kind="dome")
    r = client.post(
        "/api/review/decide", json={"uuid": uid, "decision": "validated"}, headers=headers("rev")
    )
    assert r.status_code == 200 and r.json()["decided"] == sorted([uid, s])
    with psycopg.connect(pg_dsn) as conn:
        got = dict(conn.execute("SELECT uuid::text, status FROM contributions WHERE uuid ="
                                " ANY(%s::uuid[])", ([s, blank, other],)).fetchall())  # fmt: skip
    # Another account's answer waits for its own decision; « Je ne sais pas » decides nothing.
    assert got == {s: "validated", blank: "pending", other: "pending"}
    # « Annuler » puts both back.
    r = client.post("/api/review/undo", json={"uuids": [uid, s]}, headers=headers("rev"))
    assert r.status_code == 200 and sorted(r.json()["undone"]) == sorted([uid, s])


def test_review_lists_the_cameras_near_an_add_and_its_answers(client, build_id, pg_dsn):
    with psycopg.connect(pg_dsn) as conn:
        x, y = conn.execute("SELECT ST_X(geom), ST_Y(geom) FROM cameras WHERE camera_id = %s",
                            (DUPLICATE_OF,)).fetchone()  # fmt: skip
    uid, _ = post_add(client, build_id, live.to_lonlat(x + 3.0, y + 1.0), placement="free")
    post(client, participation.added_id(uid), build_id, "shape", answer="unknown")
    post(client, participation.added_id(uid), build_id, "operator", answer="public")
    rows = client.get("/api/review/contributions?kind=add", headers=headers("rev")).json()
    near = rows["contributions"][0]["near"]
    assert near[0]["camera"] == DUPLICATE_OF and 3.0 <= near[0]["m"] <= 3.3
    # In the queue: the add and its answered question wait, « Je ne sais pas » does not;
    # its label takes the answer (who films), no kind from an unknown shape.
    queue = client.get("/api/review/queue", headers=headers("rev")).json()
    [item] = queue["items"]
    assert item["camera"] == participation.added_id(uid) and item["on_site"] is True
    assert sorted(p["kind"] for p in item["pieces"]) == ["add", "operator"]
    label = item["label"]
    assert (label["add"], label["built"], label["kind"], label["operator_class"]) == (
        True, False, None, "public")  # fmt: skip


# --- "sur place" only when it is true (rules/contributions.yaml on_site) --------------------


def test_on_site_bits_follow_the_contributions_of_each_month():
    a = add(x=0.0, y=0.0)
    a_on = apply.Contribution(**{**a.__dict__, "on_site": True})
    _, states = apply.settle([a_on], {})
    bits = states[a.camera_id].on_site
    assert bits == apply.ON_SITE["added"] | apply.ON_SITE["seen"] | apply.SEEN_BY_ADD
    # Not on site: no word, and the sighting still only the add's.
    _, states = apply.settle([a, on(a, "21", "shape", 2, "dome")], {})
    assert states[a.camera_id].on_site == apply.SEEN_BY_ADD
    # A later "elle est là" the same month is a sighting of its own; one on site suffices.
    seen = apply.Contribution(**{**on(a, "51", "verify", 3, "present").__dict__, "on_site": True})
    _, states = apply.settle([a, seen], {})
    assert states[a.camera_id].on_site == apply.ON_SITE["seen"]


def test_tiles_say_which_months_were_on_site(built):
    _, _, feats = built
    os_ = {cid: feats[cid]["properties"].get("os") for cid in feats}
    on = apply.ON_SITE
    assert os_["n1925222790"] == on["position"] | on["seen"]  # a1, a move on site
    assert os_["n1923568277"] == on["gone"]  # d2, "introuvable" on site
    assert os_[A1] == on["added"] | on["seen"] | apply.SEEN_BY_ADD
    assert os_[A2] == apply.SEEN_BY_ADD  # added, answered, none on site
    assert os_["n1925180657"] is None  # "elle est là" without on_site
