"""« Modifier » (DECISIONS 2026-10-08; migration 012) over HTTP: one send gathers the
camera's changed pieces — its move and its answers — as contributions of their kinds
sharing a batch; idempotent; one decision and one withdrawal for the whole send; its field
in /revue and on the sheet; the export and the build's `apply` stage read the pieces as
they read « Déplacer » and « Compléter »: a validated send wins over the OSM version it saw
and becomes a conflict when the node changes since (the « Corriger » rules of 2026-10-05).
"""

import json
import uuid

import numpy as np
import psycopg
import pytest
import sessions
import shapely
from fastapi.testclient import TestClient
from pydantic import TypeAdapter
from test_api_app import ORIGIN, TODAY, headers, inside_point, near_wall  # noqa: F401

from lacarte import apply, camerafield, contrib, direction, regions
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
def tube(pg_dsn, pg_loaded):
    """An outdoor OSM camera a send can turn: a kind under the direction rule once it is a
    tube, its served tags."""
    with psycopg.connect(pg_dsn) as conn:
        cid, tags = conn.execute(
            "SELECT camera_id, tags FROM cameras WHERE NOT indoor AND osm_type IS NOT NULL"
            " AND tags ? 'camera:type' ORDER BY camera_id LIMIT 1"
        ).fetchone()
        return live.camera(conn, cid), tags


def offset(cam, dx, dy):
    return live.to_lonlat(cam.x + dx, cam.y + dy)


def piece(client, cam, build_id, batch, kind, who="ana", uid=None, **fields):
    uid = uid or str(uuid.uuid4())
    body = {
        "kind": kind, "uuid": uid, "camera": cam.camera_id, "build_id": build_id,
        "day": TODAY, "duration_ms": 9000, "on_site": True, "batch": batch, **fields,
    }  # fmt: skip
    return uid, client.post("/api/contributions", json=body, headers=headers(who))


def send(client, cam, build_id, batch=None, who="ana"):
    """A whole send: moved 4 m east (free), a tube, turned to 90° from where the move puts
    it, at the first floor, slightly down, a business. The uuids by kind."""
    batch = batch or str(uuid.uuid4())
    lon, lat = offset(cam, 4, 0)
    pv = client.post(
        "/api/modify/preview",
        json={"camera": cam.camera_id, "lon": lon, "lat": lat, "placement": "free"},
        headers=headers(who),
    ).json()
    out = {}
    for kind, fields in (
        ("move", {"lon": lon, "lat": lat, "placement": "free"}),
        ("shape", {"answer": "bullet"}),
        ("direction", {"direction": 90, "aim_kind": "fixed", "from_lon": pv["position"][0],
                       "from_lat": pv["position"][1]}),
        ("height", {"answer": "first", "aim_kind": "fixed", "aim_direction": 90}),
        ("tilt", {"answer": "slight", "aim_kind": "fixed", "aim_direction": 90,
                  "aim_height": "first"}),
        ("operator", {"answer": "business"}),
    ):  # fmt: skip
        uid, r = piece(client, cam, build_id, batch, kind, who=who, **fields)
        assert r.status_code == 200, (kind, r.text)
        out[kind] = uid
    return batch, out


def rows(pg_dsn, batch):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute(
            "SELECT kind, status, ST_X(geom), ST_Y(geom) FROM contributions"
            " WHERE batch = %s ORDER BY kind",
            (batch,),
        ).fetchall()


def decide(client, uid, decision):
    return client.post(
        "/api/review/decide", json={"uuid": uid, "decision": decision}, headers=headers("rev")
    )


def test_a_send_is_its_pieces_sharing_a_batch(client, tube, build_id, pg_dsn):
    cam, _ = tube
    batch, ids = send(client, cam, build_id)
    got = rows(pg_dsn, batch)
    assert [k for k, *_ in got] == sorted(ids)
    assert {s for _, s, *_ in got} == {"pending"}
    # The direction is aimed from where the move put the camera, not the served position.
    by = {k: (x, y) for k, _, x, y in got}
    assert abs(by["direction"][0] - by["move"][0]) < 0.01
    assert abs(by["direction"][1] - by["move"][1]) < 0.01
    assert abs(by["move"][0] - cam.x - 4) < 0.5


def test_a_send_is_idempotent_and_one_author_s_on_one_camera(client, tube, build_id, pg_dsn):
    cam, _ = tube
    batch = str(uuid.uuid4())
    uid, r1 = piece(client, cam, build_id, batch, "shape", answer="dome")
    _, r2 = piece(client, cam, build_id, batch, "shape", uid=uid, answer="dome")
    assert r1.status_code == 200 and r2.status_code == 200 and r2.json()["new"] is False
    # One piece per kind; another author or another camera cannot join the send.
    assert piece(client, cam, build_id, batch, "shape", answer="ptz")[1].status_code == 409
    assert piece(client, cam, build_id, batch, "height", who="bob",
                 answer="first")[1].status_code == 409  # fmt: skip
    # Only the kinds a send gathers; an aim origin only within a send.
    assert piece(client, cam, build_id, batch, "verify", answer="present")[1].status_code == 422
    lon, lat = offset(cam, 1, 0)
    _, r = piece(client, cam, build_id, None, "direction", direction=10, from_lon=lon,
                 from_lat=lat)  # fmt: skip
    assert r.status_code == 422
    assert len(rows(pg_dsn, batch)) == 1


def test_a_body_without_a_batch_keeps_the_digest_it_had():
    """A phone's contribution queued before « Modifier » and sent after it: the same body
    (digests computed by the code of f718357, the release before)."""
    frozen = {
        "2da0eeb80a87e1f08626b42936b47a670f4a09568db8e086d431630e9be2b2c3": {
            "kind": "verify", "uuid": "11111111-1111-4111-8111-111111111111", "camera": "n1",
            "build_id": "b", "day": "2026-10-08", "duration_ms": 10, "on_site": None,
            "answer": "present"},
        "94cc598fb252d73ccf880a7873723954ffcd522a522827afbb166c6ef9d85865": {
            "kind": "direction", "uuid": "11111111-1111-4111-8111-111111111112",
            "camera": "n1", "build_id": "b", "day": "2026-10-08", "duration_ms": 10,
            "on_site": True, "direction": 120},
    }  # fmt: skip
    for digest, body in frozen.items():
        assert api.body_digest(TypeAdapter(api.ContributionIn).validate_python(body)) == digest


def test_one_decision_for_the_whole_send(client, tube, build_id, pg_dsn):
    cam, _ = tube
    batch, ids = send(client, cam, build_id)
    r = decide(client, ids["height"], "validated")
    assert r.status_code == 200 and sorted(r.json()["decided"]) == sorted(ids.values())
    assert {s for _, s, *_ in rows(pg_dsn, batch)} == {"validated"}
    # Changed by the send's own id: rejected whole.
    assert decide(client, batch, "rejected").json()["status"] == "rejected"
    assert {s for _, s, *_ in rows(pg_dsn, batch)} == {"rejected"}
    assert decide(client, batch, "rejected").status_code == 409  # not a change


def test_the_author_withdraws_the_whole_send(client, tube, build_id, pg_dsn):
    cam, _ = tube
    batch, ids = send(client, cam, build_id)
    r = client.post("/api/contributions/withdraw", json={"uuid": ids["move"]}, headers=headers())
    assert r.status_code == 200 and len(r.json()["withdrawn"]) == 5
    assert {s for _, s, *_ in rows(pg_dsn, batch)} == {"withdrawn"}
    # Again, by the send's id: idempotent; another account does not know it.
    again = client.post("/api/contributions/withdraw", json={"uuid": batch}, headers=headers())
    assert again.status_code == 200
    other = client.post("/api/contributions/withdraw", json={"uuid": batch},
                        headers=headers("bob"))  # fmt: skip
    assert other.status_code == 404


def test_a_withdrawn_send_takes_no_piece_sent_after(client, tube, build_id, pg_dsn):
    """The phone sends a send's pieces one at a time: one withdrawn on the server while
    others still wait on the phone must not come back piece by piece."""
    cam, _ = tube
    batch = str(uuid.uuid4())
    shape, r = piece(client, cam, build_id, batch, "shape", answer="bullet")
    assert r.status_code == 200, r.text
    w = client.post("/api/contributions/withdraw", json={"uuid": batch}, headers=headers())
    assert w.status_code == 200 and w.json()["status"] == "withdrawn"
    _, late = piece(client, cam, build_id, batch, "height", answer="first")
    assert late.status_code == 409 and late.json()["error"] == "batch_closed"
    assert [(k, s) for k, s, *_ in rows(pg_dsn, batch)] == [("shape", "withdrawn")]
    # The same piece sent again (its response lost): still the idempotent answer.
    _, again = piece(client, cam, build_id, batch, "shape", uid=shape, answer="bullet")
    assert again.status_code == 200 and again.json() == {
        "uuid": shape, "status": "withdrawn", "new": False}  # fmt: skip
    # Another account's piece on that id: still not theirs to join.
    _, other = piece(client, cam, build_id, batch, "tilt", who="bob", answer="slight")
    assert other.status_code == 409 and other.json()["error"] == "batch_taken"


def test_its_field_on_the_sheet_and_in_the_review(client, tube, build_id, pg_dsn):
    cam, _ = tube
    cam_lon, cam_lat = live.to_lonlat(cam.x, cam.y)
    batch, ids = send(client, cam, build_id)
    one = client.get(f"/api/proposals?camera={cam.camera_id}", headers=headers("bob")).json()
    move = next(f for f in one["features"] if f["properties"]["u"] == ids["move"])
    assert move["properties"]["b"] == batch
    window = client.get(f"/api/review/camera?camera={cam.camera_id}", headers=headers("rev"))
    field = window.json()["batches"][batch]
    assert field["bands"]["features"] and field["old_bands"]["features"]
    # The sheet draws the send's whole field: the one the review sees.
    assert move["properties"]["bands"] == field["bands"]
    queue = client.get("/api/review/queue", headers=headers("rev")).json()
    assert queue["summary"]["pending"] == 1  # one decision waits, not six
    item = next(i for i in queue["items"] if i["camera"] == cam.camera_id)
    assert [p["kind"] for p in item["pieces"]] == [
        "move", "shape", "direction", "height", "tilt", "operator"]  # fmt: skip
    assert {p["batch"] for p in item["pieces"]} == {batch}
    assert item["pieces"][0]["move_m"] == pytest.approx(4, abs=0.5)
    assert item["pieces"][0]["before"] == pytest.approx([cam_lon, cam_lat], abs=1e-6)


def test_its_field_leaves_out_unknown_answers(client, tube, build_id, pg_dsn):
    """« Je ne sais pas » for the shape, the height and the tilt (a crafted send: the editor
    sends none) is no class of the rules: the send's field is drawn without them, never a
    500 on the sheet or in the review."""
    cam, _ = tube
    batch = str(uuid.uuid4())
    lon, lat = offset(cam, 3, 0)
    move, r = piece(client, cam, build_id, batch, "move", lon=lon, lat=lat, placement="free")
    assert r.status_code == 200, r.text
    for kind in ("shape", "height", "tilt"):
        _, r = piece(client, cam, build_id, batch, kind, answer="unknown")
        assert r.status_code == 200, (kind, r.text)
    _, r = piece(client, cam, build_id, batch, "direction", answer="not_visible")
    assert r.status_code == 200, r.text
    window = client.get(f"/api/review/camera?camera={cam.camera_id}", headers=headers("rev"))
    assert window.status_code == 200, window.text
    assert window.json()["batches"][batch]["bands"]["features"]
    one = client.get(f"/api/proposals?camera={cam.camera_id}", headers=headers("bob"))
    assert one.status_code == 200, one.text
    props = next(f["properties"] for f in one.json()["features"] if f["properties"]["u"] == move)
    assert props["bands"] == window.json()["batches"][batch]["bands"]


def test_the_preview_places_and_draws_as_the_send_would(client, tube, build_id):
    cam, _ = tube
    lon, lat = offset(cam, 3, 0)
    body = {"camera": cam.camera_id, "lon": lon, "lat": lat, "placement": "free",
            "shape": "bullet", "direction": 90}  # fmt: skip
    r = client.post("/api/modify/preview", json=body, headers=headers())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["bands"]["features"] and abs(out["move_m"] - 3) < 0.05
    # No move: the camera where it is, answers only.
    r2 = client.post("/api/modify/preview", json={"camera": cam.camera_id, "height": "upper"},
                     headers=headers())  # fmt: skip
    assert r2.status_code == 200 and "position" not in r2.json()
    far = offset(cam, 80, 0)
    r3 = client.post("/api/modify/preview", json={**body, "lon": far[0], "lat": far[1]},
                     headers=headers())  # fmt: skip
    assert r3.status_code == 422 and r3.json()["error"] == "too_far"


def exported(pg_dsn, tmp_path, monkeypatch) -> list:
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    contrib.export(dsn=pg_dsn)
    return apply.read(tmp_path / "ci.jsonl")


def test_a_validated_send_replays_and_conflicts_when_osm_changes_since(
    client, tube, build_id, pg_dsn, tmp_path, monkeypatch
):
    """The simulated OSM conflict: the send is validated on the node's version v; the
    extract then says v + 1. Changing a tag the answers read (camera:type) puts every piece
    in conflict; changing another tag puts the move in conflict (the version rule) while the
    answers still apply (rules/contributions.yaml fine_conflict)."""
    cam, tags = tube
    batch, ids = send(client, cam, build_id)
    decide(client, batch, "validated")
    contribs = exported(pg_dsn, tmp_path, monkeypatch)
    assert sorted(c.uuid for c in contribs) == sorted(ids.values())
    assert {c.osm_version for c in contribs} == {cam.osm_version}
    gx, gy = cam.x, cam.y
    same = {cam.camera_id: apply.Osm(cam.osm_version, tags, (gx, gy), cam.kind)}
    outcome, states = apply.settle(contribs, same)
    assert {o["result"] for o in outcome.values()} == {"applied"}, outcome
    st = states[cam.camera_id]
    assert st.kind == "fixed" and st.direction == 90 and st.height == "first"
    assert st.operator == ("business", None)
    assert st.tilt == ("slight" if "fixed" in apply.participation.tilt_kinds() else None)
    assert abs(st.position[0] - gx - 4) < 0.5
    assert "fixed" in direction.kinds()
    # The node retyped in OSM since: the move (any version) and the pieces that read
    # camera:type (shape, direction, tilt) are conflicts for the review; the height and who
    # films read other tags and still apply.
    retyped = {**tags, "camera:type": "panning"}
    v2 = {cam.camera_id: apply.Osm(cam.osm_version + 1, retyped, (gx, gy), "ptz")}
    outcome, _ = apply.settle(contribs, v2)
    results = {k: outcome[ids[k]]["result"] for k in ids}
    assert results == {
        "move": "conflict",
        "shape": "conflict",
        "direction": "conflict",
        "tilt": "conflict",
        "height": "applied",
        "operator": "applied",
    }, outcome
    assert outcome[ids["move"]]["reason"] == "osm_version"
    assert outcome[ids["shape"]]["reason"] == "osm_tags"
    # Another tag only: the move conflicts, the answers apply.
    other = {**tags, "survey:date": "2026-10-08"}
    v2 = {cam.camera_id: apply.Osm(cam.osm_version + 1, other, (gx, gy), cam.kind)}
    outcome, _ = apply.settle(contribs, v2)
    assert outcome[ids["move"]] == {"result": "conflict", "reason": "osm_version"}
    assert outcome[ids["shape"]]["result"] == "applied"
    assert outcome[ids["operator"]]["result"] == "applied"
    # Revalidated by the review, a send in conflict replays on the version the deploy found.
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute(
            "UPDATE contributions SET status = 'conflict', apply_detail = %s WHERE batch = %s",
            (json.dumps({"reason": "osm_version", "osm_version": cam.osm_version + 1}), batch),
        )
    assert decide(client, ids["shape"], "validated").json()["decided"] == sorted(ids.values())
    contribs = exported(pg_dsn, tmp_path, monkeypatch)
    assert {c.osm_version for c in contribs} == {cam.osm_version + 1}
    outcome, _ = apply.settle(contribs, v2)
    assert {o["result"] for o in outcome.values()} == {"applied"}, outcome


def test_the_add_preview_draws_its_answers(client, tube):
    """The punk add (DECISIONS 2026-10-08, one component with « Modifier »): a new camera
    placed free at a point, drawn with the answers given so far, as its pending field
    (answered_add) will be once it leaves with them."""
    cam, _ = tube
    lon, lat = offset(cam, 6, 0)
    bare = client.post("/api/modify/preview", json={"add": True, "lon": lon, "lat": lat},
                       headers=headers())  # fmt: skip
    assert bare.status_code == 200, bare.text
    body = {"add": True, "lon": lon, "lat": lat, "shape": "bullet", "direction": 90,
            "height": "first", "tilt": "slight"}  # fmt: skip
    aimed = client.post("/api/modify/preview", json=body, headers=headers())
    assert aimed.status_code == 200, aimed.text
    a, b = bare.json(), aimed.json()
    assert a["bands"]["features"] and b["bands"]["features"]
    assert a["bands"] != b["bands"] and b["position"] == a["position"]
    assert b["pulled"] is False  # placing is always free: no magnet
    # A camera or an add, never both, never neither.
    both = client.post("/api/modify/preview", json={**body, "camera": cam.camera_id},
                       headers=headers())  # fmt: skip
    assert both.status_code == 422
    nowhere = client.post("/api/modify/preview", json={"add": True}, headers=headers())
    assert nowhere.status_code == 422


def test_a_small_dome_s_tilt_changes_its_preview(client, tube):
    """Questions@5: the add's preview of a small dome reads its tilt as a tube's
    (modified_camera, tilt.kinds): with a height, « un peu vers le bas » leaves a blind zone
    at its foot; without the tilt the same dome films from where it stands."""
    cam, _ = tube
    lon, lat = offset(cam, 6, 0)
    body = {"add": True, "lon": lon, "lat": lat, "shape": "dome", "direction": 90,
            "height": "first"}  # fmt: skip
    flat = client.post("/api/modify/preview", json=body, headers=headers()).json()
    tilted = client.post("/api/modify/preview", json={**body, "tilt": "slight"},
                         headers=headers()).json()  # fmt: skip

    def nearest(pv: dict) -> float:
        origin = shapely.Point(live.to_metres(*pv["position"]))
        polys = [shapely.transform(shapely.geometry.shape(f["geometry"]),
                                   lambda c: np.column_stack(live.TO_M.transform(*c.T)))
                 for f in pv["bands"]["features"]]  # fmt: skip
        return min(g.distance(origin) for g in polys)

    assert flat["bands"]["features"] and tilted["bands"]["features"]
    assert flat["position"] == tilted["position"]
    assert nearest(flat) < 0.6  # the bands start at the camera (its snap, half a metre)
    assert nearest(tilted) > 2.0  # 2.27 m for the widest dome lens at 4 m and 25 degrees


def host_of(pg_dsn, lon, lat):
    x, y = live.to_metres(lon, lat)
    with psycopg.connect(pg_dsn) as conn:
        polys = live.buildings_near(conn, x, y, 10)
    return next(p for p in polys if p.contains(shapely.Point(x, y)))


def in_host_beyond_under_roof(pv: dict, host) -> float:
    """The area (m2) of the preview's bands inside `host` farther than under_roof_m from
    the camera: none, the host blocks again there (rules/contributions.yaml under_roof)."""
    to_m = lambda xy: live.TO_M.transform(xy[:, 0], xy[:, 1])  # noqa: E731
    bands = shapely.union_all([
        shapely.transform(shapely.geometry.shape(f["geometry"]),
                          lambda xy: shapely.get_coordinates(shapely.points(*to_m(xy))))
        for f in pv["bands"]["features"]
    ])  # fmt: skip
    disc = shapely.Point(live.to_metres(*pv["position"])).buffer(
        camerafield.under_roof_m() + 0.01, quad_segs=64
    )
    return bands.intersection(host).difference(disc).area


def test_placed_freely_inside_a_footprint_its_building_does_not_block_it(
    client,
    tube,
    build_id,
    pg_dsn,
    inside_point,  # noqa: F811
):
    """DECISIONS 2026-10-08 (« Placing a camera is always free… »): a camera placed inside
    a building's footprint is under a roof (an awning, a porch, a garage entrance); the
    server keeps the position, says inside_footprint, and that building does not cut the
    field: it starts where the camera was placed, as the build will draw it
    (camerafield.field). Checked for the add and for « Modifier » (preview, then its move)."""
    lon, lat = inside_point
    host = host_of(pg_dsn, lon, lat)
    # The add: its preview, then the stored add.
    pv = client.post("/api/modify/preview", json={"add": True, "lon": lon, "lat": lat},
                     headers=headers()).json()  # fmt: skip
    assert pv["inside_footprint"] is True and pv["pulled"] is False
    assert pv["bands"]["features"]
    assert in_host_beyond_under_roof(pv, host) < 0.01
    uid = str(uuid.uuid4())
    r = client.post("/api/contributions", headers=headers(), json={
        "kind": "add", "uuid": uid, "build_id": build_id, "day": TODAY, "duration_ms": 9000,
        "on_site": True, "lon": lon, "lat": lat, "placement": "free"})  # fmt: skip
    assert r.status_code == 200, r.text
    with psycopg.connect(pg_dsn) as conn:
        p = conn.execute("SELECT payload FROM contributions WHERE uuid = %s", (uid,)).fetchone()[0]
    assert p["inside_footprint"] is True and p["placement"] == "free"
    assert p["bands"]["features"] == pv["bands"]["features"]
    origin = shapely.Point(live.to_metres(*p["origin"]))
    assert host.contains(origin) and origin.distance(shapely.Point(live.to_metres(lon, lat))) < 0.02
    # « Modifier »: an OSM camera moved there, free.
    cam, _ = tube
    near = live.to_metres(lon, lat)
    with psycopg.connect(pg_dsn) as conn:
        ids = [r[0] for r in conn.execute("SELECT camera_id FROM cameras WHERE NOT indoor")]
        moved = next(c for c in (live.camera(conn, i) for i in ids)
                     if ((c.x - near[0]) ** 2 + (c.y - near[1]) ** 2) ** 0.5 < 40)  # fmt: skip
    body = {"camera": moved.camera_id, "lon": lon, "lat": lat, "placement": "free"}
    pv = client.post("/api/modify/preview", json=body, headers=headers()).json()
    assert pv["inside_footprint"] is True and pv["pulled"] is False
    assert pv["bands"]["features"]
    assert in_host_beyond_under_roof(pv, host) < 0.01
    batch = str(uuid.uuid4())
    uid, r = piece(client, moved, build_id, batch, "move", lon=lon, lat=lat, placement="free")
    assert r.status_code == 200, r.text
    with psycopg.connect(pg_dsn) as conn:
        p = conn.execute("SELECT payload FROM contributions WHERE uuid = %s", (uid,)).fetchone()[0]
    assert p["inside_footprint"] is True and p["bands"]["features"]
    origin = shapely.Point(live.to_metres(*p["origin"]))
    assert host.contains(origin) and origin.distance(shapely.Point(live.to_metres(lon, lat))) < 0.02
