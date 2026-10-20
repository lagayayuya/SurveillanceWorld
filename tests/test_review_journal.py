"""The journal (migration 020, lot 2 « Administrer »): every decision a reviewer takes in
/revue — decide, a send at once, an add's answers rejected with it, undo, « Valider ce qui
est fait sur place » — writes one line per contribution it changed; GET /api/review/log
reads it, for administrators only, newest first, 100 a page. Fictitious accounts and
contributions in the throwaway database."""

import re
import uuid

import psycopg
import pytest
import test_add
import test_review_cameras as review
from test_add import post, post_add
from test_api_app import headers

from lacarte import participation
from lacarte.api import app as api

# Fixtures of the review's tests: the client, the database emptied before each test, a
# camera near a facade, the build, a point where an add may be placed.
client, fresh, near_wall, build_id = review.client, review.fresh, review.near_wall, review.build_id
facade_point = test_add.facade_point
decide, undo = review.decide, review.undo


@pytest.fixture(autouse=True)
def empty_journal(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM admin_log")


def lines(dsn) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT actor, action, target_name, target, detail,"
            " target_account = (SELECT id FROM accounts WHERE pseudonym = target_name),"
            " actor_id = (SELECT id FROM accounts WHERE pseudonym = actor)"
            " FROM admin_log ORDER BY seq"
        ).fetchall()


def line(action, author, uid, frm, to, cam) -> tuple:
    return ("rev", action, author, uid, {"from": frm, "to": to, "camera": cam}, True, True)


def test_each_decision_is_one_line_per_contribution(client, near_wall, build_id, pg_dsn,
                                                    facade_point):  # fmt: skip
    cam = near_wall[0].camera_id
    one, _ = post(client, cam, build_id, "verify", answer="present")
    decide(client, one)
    decide(client, one, "rejected")  # « Changer la décision »
    batch = str(uuid.uuid4())
    shape, _ = post(client, cam, build_id, "shape", who="bob", answer="bullet", batch=batch)
    aim, _ = post(client, cam, build_id, "direction", who="bob", direction=90, batch=batch)
    decide(client, batch)  # the send, by its id
    assert undo(client, aim).status_code == 200
    add, _ = post_add(client, build_id, facade_point)
    added = participation.added_id(add)
    answer, _ = post(client, added, build_id, "shape", who="bob", answer="dome")
    decide(client, add, "rejected")  # its answers leave with it
    pieces = sorted([shape, aim])
    assert lines(pg_dsn) == [
        line("decide", "ana", one, "pending", "validated", cam),
        line("decide", "ana", one, "validated", "rejected", cam),
        *[line("decide", "bob", u, "pending", "validated", cam) for u in pieces],
        *[line("undo", "bob", u, "validated", "pending", cam) for u in pieces],
        line("decide", "ana", add, "pending", "rejected", added),
        line("decide", "bob", answer, "pending", "rejected", added),
    ]


def test_on_site_validation_is_journalled_as_such(client, near_wall, build_id, pg_dsn):
    cam = near_wall[0].camera_id
    on, _ = post(client, cam, build_id, "verify", answer="present")
    r = client.post("/api/review/decide-on-site", json={"camera": cam}, headers=headers("rev"))
    assert r.json()["validated"] == [on]
    assert lines(pg_dsn) == [line("on_site", "ana", on, "pending", "validated", cam)]


def test_a_refused_decision_writes_nothing(client, near_wall, build_id, pg_dsn):
    cam = near_wall[0].camera_id
    one, _ = post(client, cam, build_id, "verify", answer="present")
    r = client.post("/api/review/decide", json={"uuid": one, "decision": "rejected"},
                    headers=headers("ana"))  # fmt: skip
    assert r.status_code == 401
    decide(client, one, "rejected")
    r = client.post("/api/review/decide", json={"uuid": one, "decision": "rejected"},
                    headers=headers("rev"))  # fmt: skip
    assert r.status_code == 409  # not a change
    assert len(lines(pg_dsn)) == 1


def log(client, who="rev", **query):
    return client.get("/api/review/log", params=query, headers=headers(who))


def entries(client, **query) -> list[dict]:
    r = log(client, **query)
    assert r.status_code == 200, r.text
    return r.json()["entries"]


def account(dsn, name):
    import sessions

    sessions.account_id(name, dsn)  # made as needed (`rev`: an administrator)
    with psycopg.connect(dsn) as conn:
        row = conn.execute("SELECT id::text, pseudonym, role, created_month, leaderboard, test"
                           " FROM accounts WHERE pseudonym = %s", (name,)).fetchone()  # fmt: skip
    return api.Account(*row)


def put(dsn, name, day, camera, *, kind="verify", answer="present", batch=None,
        payload="{}", proposed=None, status="pending", target=None) -> str:  # fmt: skip
    """A contribution as the API stores it, of `name` (made as needed), on `day`."""
    import sessions

    uid = str(uuid.uuid4())
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
            " build_id, author_id, day, geom, payload, body_sha256, osm_tags, answer, status,"
            " batch, operator_proposed, target) VALUES (%s, %s, %s, 'n', 1, 1, 'b', %s, %s,"
            " ST_SetSRID(ST_MakePoint(0, 0), 2154), %s, 'x', '{}', %s, %s, %s, %s, %s)",
            (uid, kind, camera, sessions.account_id(name, dsn), day, payload, answer, status,
             batch, proposed, target),
        )  # fmt: skip
    return uid


D1, D2 = "2026-10-15", "2026-10-16"


@pytest.fixture
def feed(client, pg_dsn):
    """Two days of journal lines and sends: on the 16th two lines (hide, setting) and three
    sends (a « Modifier » of two pieces on n1, a verify on n1, a move on n2); on the 15th a
    refused sign-in and an opinion. Returns the uuids by name."""
    rev = account(pg_dsn, "rev")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        api.journal(conn, None, "signin_refused", name="p0")
        api.journal(conn, rev, "hide", target="n2", detail={"known": True})
        api.journal(conn, rev, "setting", target="signups_open", detail={"to": False})
        conn.execute("UPDATE admin_log SET day = CASE action WHEN 'signin_refused' THEN"
                     " %s::date ELSE %s::date END", (D1, D2))  # fmt: skip
    batch = str(uuid.uuid4())
    u = {"shape": put(pg_dsn, "ana", D2, "n1", kind="shape", answer="dome", batch=batch),
         "operator": put(pg_dsn, "ana", D2, "n1", kind="operator", answer="business",
                         batch=batch, proposed="Fictitious Shop"),
         "verify": put(pg_dsn, "bob", D2, "n1"),
         "move": put(pg_dsn, "ana", D2, "n2", kind="move", answer=None,
                     payload='{"move_m": 7.4}')}  # fmt: skip
    u["agree"] = put(pg_dsn, "bob", D1, "n1", kind="agree", answer=None, target=u["verify"])
    u["batch"] = batch
    return u


def expected_order(u) -> list[str]:
    n1 = sorted([f"c{u['batch']}", f"c{u['verify']}"])
    return ["j-setting", "j-hide", *n1, f"c{u['move']}", "j-signin_refused", f"c{u['agree']}"]


def named(e) -> str:
    return f"j-{e['action']}" if e["source"] == "journal" else e["key"]


def test_the_feed_is_by_day_journal_then_sends_by_camera_on_every_page(
    client, pg_dsn, feed, monkeypatch
):
    assert [named(e) for e in entries(client)] == expected_order(feed)
    for size in (1, 2, 3):
        monkeypatch.setattr(api, "LOG_PAGE", size)
        seen, before = [], None
        while True:
            r = log(client, **({"before": before} if before else {})).json()
            assert len(r["entries"]) <= size
            seen += [named(e) for e in r["entries"]]
            before = r["next"]
            if before is None:
                break
            assert re.fullmatch(r"[A-Za-z0-9_-]+", before)  # opaque, nothing to escape
        assert seen == expected_order(feed), size


def test_each_entry_says_who_what_on_which_camera(client, pg_dsn, feed):
    by = {named(e): e for e in entries(client)}
    keys = {"key", "day", "source", "actor", "actor_test", "action", "pieces", "camera",
            "label", "target_name", "target", "detail"}  # fmt: skip
    assert all(set(e) == keys for e in by.values())
    send = by[f"c{feed['batch']}"]
    assert (
        send["day"],
        send["source"],
        send["actor"],
        send["actor_test"],
        send["action"],
        send["camera"],
    ) == (D2, "contribution", "ana", False, "contribution", "n1")
    # Its pieces in the phone's order, the name proposed as typed (no choice made yet).
    assert send["pieces"] == [
        {"kind": "shape", "answer": "dome", "direction": None, "distance_m": None,
         "operator_name": None, "status": "pending"},
        {"kind": "operator", "answer": "business", "direction": None, "distance_m": None,
         "operator_name": "Fictitious Shop", "status": "pending"}]  # fmt: skip
    move = by[f"c{feed['move']}"]
    assert [p["distance_m"] for p in move["pieces"]] == [7]  # 7.4 m, to the metre
    assert by[f"c{feed['agree']}"]["pieces"][0]["kind"] == "agree"  # opinions are sends too
    with psycopg.connect(pg_dsn) as conn:
        want = api.labels(conn, ["n1", "n2"])
    assert send["label"] == want["n1"] and set(want["n1"]) == {
        "add",
        "built",
        "kind",
        "operator",
        "operator_class",
        "street",
        "commune",
    }
    hide = by["j-hide"]
    assert (hide["actor"], hide["camera"], hide["label"], hide["target"], hide["detail"]) == (
        "rev", "n2", want["n2"], "n2", {"known": True})  # fmt: skip
    assert by["j-setting"]["camera"] is None and by["j-setting"]["label"] is None
    refused = by["j-signin_refused"]
    assert (refused["actor"], refused["target_name"], refused["pieces"]) == (None, "p0", [])


def test_the_type_and_actor_filters(client, pg_dsn, feed, near_wall, build_id):
    cam = near_wall[0].camera_id
    one, _ = post(client, cam, build_id, "verify", answer="present")
    decide(client, one)
    assert {e["source"] for e in entries(client, type="contributions")} == {"contribution"}
    assert [e["action"] for e in entries(client, type="decisions")] == ["decide"]
    assert [e["action"] for e in entries(client, type="admin")] == ["setting", "hide",
                                                                    "signin_refused"]  # fmt: skip
    # `actor`: who acted in the journal, the author of a send; any case.
    assert [named(e) for e in entries(client, actor="BOB")] == [
        f"c{feed['verify']}", f"c{feed['agree']}"]  # fmt: skip
    assert [e["action"] for e in entries(client, actor="rev")] == ["decide", "setting", "hide"]
    assert entries(client, type="contributions", actor="rev") == []
    assert log(client, type="nothing").status_code == 422


def test_a_decision_finds_its_camera_by_the_contribution(client, pg_dsn, near_wall, build_id):
    cam = near_wall[0].camera_id
    one, _ = post(client, cam, build_id, "verify", answer="present")
    decide(client, one)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:  # a line without its camera
        conn.execute("UPDATE admin_log SET detail = detail - 'camera'")
        want = api.labels(conn, [cam])[cam]
    (line,) = entries(client, type="decisions")
    assert (line["actor"], line["target"], line["target_name"]) == ("rev", one, "ana")
    assert (line["camera"], line["label"]) == (cam, want)
    assert line["detail"] == {"from": "pending", "to": "validated"}
    assert want["built"] is True and want["street"]


def test_a_deleted_author_is_null_a_test_account_marked(client, pg_dsn):
    put(pg_dsn, "fict-gone", D2, "n5")
    put(pg_dsn, "fict-test", D2, "n6")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET test = true WHERE pseudonym = 'fict-test'")
        api.journal(conn, account(pg_dsn, "fict-test"), "cut", name="ana")
        api.journal(conn, account(pg_dsn, "fict-gone"), "cut", name="ana")
        conn.execute("DELETE FROM accounts WHERE pseudonym = 'fict-gone'")
    sends = {e["camera"]: e for e in entries(client, type="contributions")}
    assert (sends["n5"]["actor"], sends["n5"]["actor_test"]) == (None, False)
    assert (sends["n6"]["actor"], sends["n6"]["actor_test"]) == ("fict-test", True)
    lines = entries(client, type="admin")
    # The journal keeps the pseudonym of an account deleted since (migration 020).
    assert [(e["actor"], e["actor_test"]) for e in lines] == [("fict-gone", False),
                                                             ("fict-test", True)]  # fmt: skip


@pytest.mark.parametrize("before", ["x", "bm90IGpzb24", "WyIyMDI2LTEwLTE2IiwgMiwgMV0",
                                    "WyIyMDI2LTEwLTE2IiwwLCJhIl0"])  # fmt: skip
def test_a_cursor_not_ours_is_refused(client, before):
    r = log(client, before=before)
    assert (r.status_code, r.json()) == (422, {"error": "cursor"})


def test_only_administrators_read_it(client):
    assert (log(client, "rvw").status_code, log(client, "rvw").json()) == (403, {"error": "admin"})
    assert log(client, "ana").status_code == 401
