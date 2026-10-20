"""« Mes caméras » (lot U, the account's screen): GET /api/me/contributions says where each
of the person's contributions stands (`state`), what became of it on OpenStreetMap (`osm`)
and how « Compte » names each camera (`cameras`: its kind for the collection); « Télécharger
mes données » says the same. Fictitious accounts and contributions in the throwaway
database."""

import json
import uuid

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from test_db import sql

from lacarte.api import app as api
from lacarte.api.app import collection_state

COLS = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
        " geom, payload, body_sha256, osm_tags, answer, status, on_site, target")  # fmt: skip


@pytest.mark.parametrize(("kind", "answer", "status", "published", "state"), [
    ("verify", "present", "pending", False, "pending"),
    ("move", None, "conflict", False, "pending"),
    ("move", None, "validated", False, "validated"),
    ("verify", "not_found", "superseded", False, "validated"),
    ("shape", "dome", "applied", False, "map"),
    ("direction", None, "applied", True, "osm"),
    ("add", None, "rejected", False, "refused"),
    ("verify", "present", "withdrawn", False, None),
    ("agree", None, "pending", False, None),
    ("verify", "unsure", "applied", False, None),
    ("shape", "unknown", "applied", False, None),
    ("direction", "not_visible", "validated", False, None),
])  # fmt: skip
def test_where_a_contribution_stands(kind, answer, status, published, state):
    assert collection_state(kind, answer, status, published) == state


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture
def mca(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM contributions WHERE body_sha256 = 'mine'")
        conn.execute("DELETE FROM accounts WHERE pseudonym = 'mca'")
    sessions.forget()
    return sessions.account_id("mca")


def built_camera(dsn) -> tuple[str, str]:
    """A camera of the loaded CI build with a known kind: its id and kind."""
    cam, kind = sql(dsn, "SELECT camera_id, kind FROM cameras WHERE kind = 'dome'"
                         " AND camera_id LIKE 'n%' ORDER BY camera_id LIMIT 1")[0]  # fmt: skip
    return cam, kind


def contribution(dsn, author_id, camera, *, kind="verify", answer="present", status="applied",
                 uid=None, target=None) -> str:  # fmt: skip
    uid = uid or str(uuid.uuid4())
    osm = (None, None, None) if camera.startswith("c") else ("n", int(camera[1:]), 3)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            f"INSERT INTO contributions ({COLS}) VALUES (%s, %s, %s, %s, %s, %s, 'b', %s,"
            " '2026-09-14', ST_SetSRID(ST_MakePoint(644000, 6866000), 2154), %s, 'mine',"
            " '{}', %s, %s, true, %s)",
            (uid, kind, camera, *osm, author_id, json.dumps({"placement": "free"}), answer,
             status, target),
        )  # fmt: skip
    return uid


def headers():
    return {"Cookie": f"session={sessions.token('mca')}"}


def test_states_publications_and_the_cameras_kinds(client, mca, pg_dsn):
    cam, kind = built_camera(pg_dsn)
    applied = contribution(pg_dsn, mca, cam)
    live = contribution(pg_dsn, mca, cam, kind="move", answer=None)
    dev = contribution(pg_dsn, mca, cam, kind="shape", answer="dome")
    waiting = contribution(pg_dsn, mca, cam, kind="verify", answer="not_found", status="pending")
    refused = contribution(pg_dsn, mca, cam, kind="move", answer=None, status="rejected")
    # An add no build has applied: its kind from its shape answer (rules/questions.yaml).
    add = str(uuid.uuid4())
    added = "c" + add.replace("-", "")[:12]
    contribution(pg_dsn, mca, added, kind="add", answer=None, status="validated", uid=add)
    contribution(pg_dsn, mca, added, kind="shape", answer="bullet", status="validated",
                 target=add)  # fmt: skip
    for uid, server in ((live, "live"), (dev, "dev")):
        sql(pg_dsn, f"INSERT INTO osm_publications (uuid, server, state, changeset, month)"
                    f" VALUES ('{uid}', '{server}', 'published', 9, '2026-10-01')")  # fmt: skip
    r = client.get("/api/me/contributions", headers=headers())
    assert r.status_code == 200, r.text
    data = r.json()
    by = {c["uuid"]: c for c in data["contributions"]}
    assert {u: by[u]["state"] for u in (applied, live, dev, waiting, refused, add)} == {
        applied: "map", live: "osm", dev: "map", waiting: "pending", refused: "refused",
        add: "validated"}  # fmt: skip
    # The test server's publication does not count while publishing is not offered there.
    assert by[live]["osm"] == {"server": "live", "state": "published", "month": "2026-10",
                               "changeset": 9}  # fmt: skip
    assert by[dev]["osm"] is None and by[applied]["on_site"] is True
    assert data["cameras"][cam]["kind"] == kind and data["cameras"][cam]["built"] is True
    assert data["cameras"][added]["kind"] == "fixed" and data["cameras"][added]["add"] is True
    # The same words in « Télécharger mes données ».
    export = client.get("/api/me/export", headers=headers()).json()
    states = {c["uuid"]: c["state"] for c in export["contributions"]}
    assert states == {u: c["state"] for u, c in by.items()}
    assert export["cameras"] == data["cameras"]


def test_list_and_export_agree_when_one_server_published_and_the_other_did_not(
    client, mca, pg_dsn, monkeypatch
):
    # The preview offers its test server: both count; live still sending, dev published.
    monkeypatch.setattr(api, "counted_servers", lambda: ["dev", "live"])
    cam, _ = built_camera(pg_dsn)
    uid = contribution(pg_dsn, mca, cam, kind="move", answer=None)
    for server, state in (("live", "sending"), ("dev", "published")):
        sql(pg_dsn, f"INSERT INTO osm_publications (uuid, server, state, changeset, month)"
                    f" VALUES ('{uid}', '{server}', '{state}', 9, '2026-10-01')")  # fmt: skip
    mine = client.get("/api/me/contributions", headers=headers()).json()["contributions"]
    export = client.get("/api/me/export", headers=headers()).json()["contributions"]
    assert [c["state"] for c in mine] == [c["state"] for c in export] == ["osm"]


def test_an_older_page_reads_the_same_keys(client, mca, pg_dsn):
    cam, _ = built_camera(pg_dsn)
    contribution(pg_dsn, mca, cam)
    c = client.get("/api/me/contributions", headers=headers()).json()["contributions"][0]
    assert {"uuid", "kind", "camera", "day", "status", "answer", "move_m", "apply_build",
            "direction", "operator_name", "batch", "commune", "operator_proposed", "lng",
            "lat", "agree", "disagree"} <= set(c)  # fmt: skip
