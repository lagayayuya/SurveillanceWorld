"""« Retraits » (lot 2 « Administrer »): an administrator hides a camera by its id and shows
it again (after the password); the list says whether each has left the served map, which
db/settle.sh records from the build's hidden-applied.txt. Fictitious data in the throwaway
database."""

import subprocess

import psycopg
import pytest
import sessions
import test_review_cameras as review
from test_api_app import headers

from lacarte import regions

client, fresh, near_wall, build_id = review.client, review.fresh, review.near_wall, review.build_id
SETTLE = regions.ROOT / "db" / "settle.sh"
UNKNOWN = "n999999999"


@pytest.fixture(autouse=True)
def nothing_hidden(pg_dsn, fresh):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM hidden_cameras")
        conn.execute("DELETE FROM admin_log")
    yield
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM hidden_cameras")


def hide(client, camera, on=True, who="rev"):
    return client.post("/api/review/hidden", json={"camera": camera, "hide": on},
                       headers=headers(who))  # fmt: skip


def listed(client, who="rev"):
    r = client.get("/api/review/hidden", headers=headers(who))
    assert r.status_code == 200, r.text
    return r.json()


def lines(dsn):
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT actor, action, target, detail FROM admin_log"
                            " ORDER BY seq").fetchall()  # fmt: skip


def test_hide_list_and_show_again(client, near_wall, pg_dsn):
    cam = near_wall[0].camera_id
    r = hide(client, cam)
    assert (r.status_code, r.json()) == (200, {"camera": cam, "hidden": True, "known": True,
                                               "changed": True})  # fmt: skip
    assert hide(client, cam).json()["changed"] is False  # already: nothing new
    assert hide(client, UNKNOWN).json() == {"camera": UNKNOWN, "hidden": True, "known": False,
                                            "changed": True}  # fmt: skip
    rows = {r["camera"]: r for r in listed(client)}
    assert set(rows) == {cam, UNKNOWN}
    assert rows[cam]["applied_build"] is None and rows[cam]["added_on"]
    assert rows[cam]["label"]["built"] and rows[cam]["label"]["commune"]
    assert rows[UNKNOWN]["label"] is None
    # Showing one again asks the password again.
    sessions.token("rev")
    sessions.mark("rev", reauth=False)
    try:
        assert (hide(client, cam, False).status_code, hide(client, cam, False).json()) == (
            403, {"error": "reauth"})  # fmt: skip
    finally:
        sessions.mark("rev")
    assert hide(client, cam, False).json()["hidden"] is False
    assert (hide(client, cam, False).status_code, hide(client, cam, False).json()) == (
        404, {"error": "not_hidden"})  # fmt: skip
    assert [r["camera"] for r in listed(client)] == [UNKNOWN]
    assert lines(pg_dsn) == [("rev", "hide", cam, {"known": True}),
                             ("rev", "hide", UNKNOWN, {"known": False}),
                             ("rev", "unhide", cam, {"known": True})]  # fmt: skip


@pytest.mark.parametrize("bad", ["", "x1", "n0", "N12", "c123", "n1 OR 1=1", "n" + "1" * 20])
def test_anything_but_a_camera_id_is_refused(client, bad):
    r = hide(client, bad)
    assert r.status_code == 422


def test_administrators_only(client, near_wall):
    cam = near_wall[0].camera_id
    for who, expected in (("ana", (401, {"error": "privileged"})),
                          ("rvw", (403, {"error": "admin"}))):  # fmt: skip
        r = client.get("/api/review/hidden", headers=headers(who))
        assert (r.status_code, r.json()) == expected
        r = hide(client, cam, who=who)
        assert (r.status_code, r.json()) == expected


def test_the_queue_says_a_camera_is_hidden(client, near_wall, build_id):
    cam = near_wall[0].camera_id
    review.post(client, cam, build_id, "verify", answer="present")
    assert review.items(client)[cam]["hidden"] is False
    hide(client, cam)
    assert review.items(client)[cam]["hidden"] is True


def test_settle_records_the_build_that_left_them_out(client, near_wall, pg_dsn, tmp_path):
    cam = near_wall[0].camera_id
    for c in (cam, UNKNOWN):
        hide(client, c)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        build = conn.execute("SELECT build_id FROM meta").fetchone()[0]
        conn.execute("UPDATE hidden_cameras SET applied_build = 'older' WHERE camera_id = %s",
                     (UNKNOWN,))  # fmt: skip
    (tmp_path / "hidden-applied.txt").write_text(f"{UNKNOWN}\n{cam}\nn42\n")
    out = subprocess.run([str(SETTLE), str(tmp_path), pg_dsn], check=True, capture_output=True,
                         text=True).stdout  # fmt: skip
    assert "settled: no contribution in this build" in out
    assert "hidden cameras gone from the map: 1" in out
    rows = {r["camera"]: r["applied_build"] for r in listed(client)}
    assert rows == {cam: build, UNKNOWN: "older"}  # the first build that left it out stays
    (tmp_path / "hidden-applied.txt").write_text("")
    subprocess.run([str(SETTLE), str(tmp_path), pg_dsn], check=True, capture_output=True)
