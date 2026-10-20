"""Phase D2 over HTTP: the "Compléter" answers (shape, direction, operator), the direction
preview, the "who films" list, and the OSM tags every contribution now keeps."""

import uuid

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from test_api_app import TODAY, headers, verify

from lacarte import participation
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


def answer(client, cam, build_id, kind, who="ana", uid=None, **fields):
    uid = uid or str(uuid.uuid4())
    body = {
        "kind": kind,
        "uuid": uid,
        "camera": cam.camera_id,
        "build_id": build_id,
        "day": TODAY,
        "duration_ms": 3000,
        "on_site": True,
        **fields,
    }
    return uid, client.post("/api/contributions", json=body, headers=headers(who))


def row(pg_dsn, uid):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute(
            "SELECT kind, answer, direction_deg, operator_name, osm_tags, payload"
            " FROM contributions WHERE uuid = %s",
            (uid,),
        ).fetchone()


@pytest.fixture(scope="module")
def some_camera(pg_dsn, pg_loaded):
    """An outdoor camera of unknown operator or private, with its served tags."""
    with psycopg.connect(pg_dsn) as conn:
        cid, tags = conn.execute(
            "SELECT camera_id, tags FROM cameras WHERE NOT indoor"
            " AND operator_class <> 'public' ORDER BY camera_id LIMIT 1"
        ).fetchone()
        return live.camera(conn, cid), tags


def test_each_answer_is_stored_with_the_served_tags(client, some_camera, build_id, pg_dsn):
    cam, tags = some_camera
    assert isinstance(tags, dict) and tags  # the export carries the OSM tags
    u1, r1 = answer(client, cam, build_id, "shape", answer="dome")
    u2, r2 = answer(client, cam, build_id, "direction", direction=123)
    u3, r3 = answer(client, cam, build_id, "direction", answer="not_visible")
    u4, r4 = answer(client, cam, build_id, "operator", answer="household")
    for r in (r1, r2, r3, r4):
        assert r.status_code == 200, r.text
    assert row(pg_dsn, u1)[:4] == ("shape", "dome", None, None)
    kind, ans, deg, _, kept, payload = row(pg_dsn, u2)
    assert (kind, ans, deg) == ("direction", None, 123)
    assert kept == tags
    # /revue draws the proposed field beside the one the map showed.
    assert payload["bands"]["features"] and payload["old_bands"]["features"]
    assert payload["kind_served"] == cam.kind
    assert row(pg_dsn, u3)[1:3] == ("not_visible", None)
    assert row(pg_dsn, u4)[1] == "household"
    # D1 kinds keep the tags too, from now on.
    u5, r5 = verify(client, cam, build_id)
    assert r5.status_code == 200 and row(pg_dsn, u5)[4] == tags


@pytest.mark.parametrize(
    "fields",
    [
        {"kind": "shape", "answer": "fisheye"},
        {"kind": "direction"},  # neither a bearing nor "Je ne vois pas"
        {"kind": "direction", "direction": 360},
        {"kind": "direction", "direction": 12, "answer": "not_visible"},
        {"kind": "operator", "answer": "household", "operator_name": "Franprix"},
        {"kind": "operator", "answer": "neighbour"},
    ],
)
def test_malformed_answers_are_refused(client, some_camera, build_id, fields):
    cam, _ = some_camera
    _, r = answer(client, cam, build_id, **fields)
    assert r.status_code == 422


def test_the_database_refuses_what_the_api_would(pg_dsn, pg_loaded, some_camera):
    """Migration 006's checks, as the API role would meet them: one answer per kind, a
    bearing in 0-359, a name only after public or business, tags on every new row."""
    cam, tags = some_camera
    ana = sessions.account_id("ana", pg_dsn)
    base = (
        "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
        " build_id, author_id, day, answer, direction_deg, operator_name, geom,"
        " payload, body_sha256, osm_tags) VALUES (%s, %s, %s, 'n', 1, 1, 'b', %s,"
        " current_date, %s, %s, %s, ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', %s)"
    )
    good = [("shape", "multi", None, None), ("direction", None, 359, None),
            ("direction", "not_visible", None, None), ("operator", "business", None, "Darty"),
            ("operator", "unknown", None, None)]  # fmt: skip
    bad = [("shape", None, None, None), ("direction", None, None, None),
           ("direction", None, 360, None), ("direction", "not_visible", 10, None),
           ("operator", "household", None, "Darty"), ("verify", "present", 10, None),
           ("move", "dome", None, None)]  # fmt: skip
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        for kind, ans, deg, name in good:
            conn.execute(base, (str(uuid.uuid4()), kind, cam.camera_id, ana, ans, deg, name,
                                psycopg.types.json.Jsonb(tags)))  # fmt: skip
        for kind, ans, deg, name in bad:
            with pytest.raises(psycopg.errors.CheckViolation):
                conn.execute(base, (str(uuid.uuid4()), kind, cam.camera_id, ana, ans, deg, name,
                                    psycopg.types.json.Jsonb(tags)))  # fmt: skip
        with pytest.raises(psycopg.errors.CheckViolation):  # no tags on a new row
            conn.execute(base, (str(uuid.uuid4()), "shape", cam.camera_id, ana, "dome", None, None,
                                None))  # fmt: skip
        conn.execute("TRUNCATE contributions CASCADE")


def test_the_direction_preview_draws_the_aimed_field(client, some_camera):
    cam, _ = some_camera
    r = client.post(
        "/api/preview", json={"camera": cam.camera_id, "direction": 90}, headers=headers()
    )
    assert r.status_code == 200, r.text
    east = r.json()["bands"]["features"]
    r = client.post(
        "/api/preview", json={"camera": cam.camera_id, "direction": 270}, headers=headers()
    )
    west = r.json()["bands"]["features"]
    assert east and west and east != west
    # The shape just answered changes the optics drawn.
    r = client.post(
        "/api/preview",
        json={"camera": cam.camera_id, "direction": 90, "kind": "panorama"},
        headers=headers(),
    )
    assert r.status_code == 200 and r.json()["bands"]["features"] != east
    # Without a direction a move still needs its point.
    r = client.post("/api/preview", json={"camera": cam.camera_id, "placement": "free"},
                    headers=headers())  # fmt: skip
    assert r.status_code == 422


def test_the_operator_list_is_short_alphabetical_and_of_the_class(client, some_camera, pg_dsn):
    cam, _ = some_camera
    q = participation.questions()["operator"]
    listed = participation.listed_operators()
    for cls, wanted in (("public", "public"), ("business", "private")):
        r = client.post("/api/operators", json={"camera": cam.camera_id, "class": cls},
                        headers=headers())  # fmt: skip
        assert r.status_code == 200, r.text
        names = r.json()["names"]
        assert len(names) <= q["list_max"]
        assert names == sorted(names, key=lambda n: (participation.fold(n), n))
        with psycopg.connect(pg_dsn) as conn:
            town = conn.execute(
                "SELECT town_operator FROM cameras WHERE camera_id = %s", (cam.camera_id,)
            ).fetchone()[0]
        for n in names:
            assert listed.get(n) == wanted or (cls == "public" and n == town)
        if cls == "public" and town:
            assert town in names
    assert "Particulier" not in listed  # never offered: it is the third answer
    r = client.post("/api/operators", json={"camera": cam.camera_id, "class": "household"},
                    headers=headers())  # fmt: skip
    assert r.status_code == 422


def test_a_name_must_come_from_the_offered_list(client, some_camera, build_id):
    cam, _ = some_camera
    names = client.post(
        "/api/operators", json={"camera": cam.camera_id, "class": "public"}, headers=headers()
    ).json()["names"]
    if names:
        _, r = answer(client, cam, build_id, "operator", answer="public", operator_name=names[0])
        assert r.status_code == 200, r.text
    _, r = answer(client, cam, build_id, "operator", answer="public", operator_name="Mon voisin")
    assert r.status_code == 422


def test_review_compares_answers_between_accounts(client, some_camera, build_id):
    cam, _ = some_camera
    within = participation.rules()["confirm"]["direction_within_deg"]
    sent = [
        answer(client, cam, build_id, "direction", direction=350),
        answer(client, cam, build_id, "direction", who="bob", direction=(350 + within) % 360),
        answer(client, cam, build_id, "direction", who="rev", direction=(350 + within + 1) % 360),
        answer(client, cam, build_id, "shape", answer="dome"),
        answer(client, cam, build_id, "shape", who="bob", answer="unknown"),  # says nothing
    ]
    assert all(r.status_code == 200 for _, r in sent), [r.text for _, r in sent]
    u1, u2, u_blank = sent[0][0], sent[3][0], sent[4][0]
    rows = {
        r["uuid"]: r
        for r in client.get("/api/review/contributions", headers=headers("rev")).json()[
            "contributions"
        ]
    }
    assert (rows[u1]["agree"], rows[u1]["disagree"]) == (1, 1)  # across north
    assert (rows[u2]["agree"], rows[u2]["disagree"]) == (0, 0)
    # "Je ne sais pas" waits for no decision: out of the review's list and of the queue.
    assert u_blank not in rows
    queue = client.get("/api/review/queue", headers=headers("rev")).json()
    [item] = [i for i in queue["items"] if i["camera"] == cam.camera_id]
    assert sorted(p["kind"] for p in item["pieces"]) == ["direction"] * 3 + ["shape"]
    assert u_blank not in {p["uuid"] for p in item["pieces"]}
    # Seconded on site: ana's by bob, bob's by ana and rev, rev's by bob: three accounts.
    assert item["confirmed"] == 3
