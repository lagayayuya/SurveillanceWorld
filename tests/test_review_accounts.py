"""« Comptes » and « Fiche utilisateur » (lot 2 « Administrer »): the administrator's routes
on accounts — list, sheet, role, disable / enable, cut, reset, delete, export, suspend —,
who may call them (an administrator; the destructive ones within the reauthentication),
what each changes and the journal line each writes. Fictitious accounts and contributions
in the throwaway database."""

import json
import uuid

import psycopg
import pytest
import sessions
import test_add
import test_review_cameras as review
from test_add import post, post_add
from test_api_app import headers

from lacarte import participation
from lacarte.api import app as api
from lacarte.api import auth

client, fresh, near_wall, build_id = review.client, review.fresh, review.near_wall, review.build_id
facade_point = test_add.facade_point
PEOPLE = ("acc-a", "acc-b", "acc-r", "acc-t", "acc-o")


@pytest.fixture(autouse=True)
def people(pg_dsn, fresh):
    """acc-a and acc-b (contributors), acc-r (a reviewer), acc-t (a test account), acc-o (an
    OSM account without a password); the journal empty."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM admin_log")
        conn.execute("DELETE FROM accounts WHERE pseudonym = ANY(%s)", (list(PEOPLE),))
    sessions.forget()
    ids = {n: sessions.account_id(n, role="reviewer" if n == "acc-r" else None) for n in PEOPLE}
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET test = true WHERE id = %s", (ids["acc-t"],))
        conn.execute("UPDATE accounts SET password_hash = NULL, osm_id = 4040, osm_server ="
                     " 'dev' WHERE id = %s", (ids["acc-o"],))  # fmt: skip
    yield ids
    sessions.forget()


GETS = {
    "/api/review/accounts",
    "/api/review/account",
    "/api/review/account/export",
    "/api/review/queue",
}


def call(client, path, body=None, who="rev"):
    """A GET with `body` as its query, or a POST with it as JSON, as `who`."""
    if path in GETS:
        return client.get(path, params=body, headers=headers(who))
    return client.post(path, json=body, headers=headers(who))


def answer(r):
    return r.status_code, r.json()


def lines(dsn) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT actor, action, target_name, target, detail FROM admin_log"
                            " ORDER BY seq").fetchall()  # fmt: skip


def account(dsn, aid) -> tuple | None:
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT role, disabled, password_hash, osm_id,"
            " (SELECT count(*) FROM sessions WHERE account_id = a.id) FROM accounts a"
            " WHERE id = %s", (aid,)).fetchone()  # fmt: skip


# --- who may ------------------------------------------------------------------------------

READS = [("/api/review/accounts", None), ("/api/review/account", "id")]
WRITES = ["role", "state", "cut", "reset", "delete", "suspend"]


def test_administrators_only_and_their_destructive_actions_after_the_password(client, people):
    aid = people["acc-a"]
    bodies = {"role": {"id": aid, "role": "reviewer"}, "state": {"id": aid, "disabled": True},
              "delete": {"id": aid, "pseudonym": "acc-a"}}  # fmt: skip
    for who, expected in (("ana", (401, {"error": "privileged"})),
                          ("rvw", (403, {"error": "admin"}))):  # fmt: skip
        assert answer(call(client, "/api/review/accounts", who=who)) == expected
        assert answer(call(client, "/api/review/account", {"id": aid}, who=who)) == expected
        for w in WRITES:
            r = call(client, f"/api/review/account/{w}", bodies.get(w, {"id": aid}), who=who)
            assert answer(r) == expected, w
        r = call(client, "/api/review/account/export", {"id": aid}, who=who)
        assert answer(r) == expected
    sessions.token("rev")
    sessions.mark("rev", reauth=False)
    try:
        assert call(client, "/api/review/accounts").status_code == 200  # reading needs none
        for w in WRITES:
            r = call(client, f"/api/review/account/{w}", bodies.get(w, {"id": aid}))
            assert answer(r) == (403, {"error": "reauth"}), w
        r = call(client, "/api/review/account/export", {"id": aid})
        assert answer(r) == (403, {"error": "reauth"})
    finally:
        sessions.mark("rev")
    assert account(api.settings.dsn, aid)[:2] == ("contributor", False)


# --- reading ------------------------------------------------------------------------------


def test_the_list_says_the_team_and_the_latest_contributors(client, people, near_wall,
                                                            build_id, monkeypatch):  # fmt: skip
    cam = near_wall[0].camera_id
    one, _ = post(client, cam, build_id, "verify", who="acc-b", answer="present")
    review.decide(client, one)
    batch = str(uuid.uuid4())
    post(client, cam, build_id, "shape", who="acc-b", answer="bullet", batch=batch)
    post(client, cam, build_id, "direction", who="acc-b", direction=90, batch=batch)
    post(client, cam, build_id, "verify", who="acc-a", answer="present")
    got = call(client, "/api/review/accounts", {"q": "ACC-"}).json()
    assert [r["pseudonym"] for r in got["team"]] == ["acc-r"]
    rows = {r["pseudonym"]: r for r in got["accounts"]}
    assert list(rows)[:2] in (["acc-a", "acc-b"], ["acc-b", "acc-a"])  # same day: by name
    assert set(rows) == {"acc-a", "acc-b", "acc-t", "acc-o"}
    assert rows["acc-b"] == {"id": people["acc-b"], "pseudonym": "acc-b", "role": "contributor",
                             "state": "active", "test": False, "accepted": 1, "pending": 1,
                             "rejected": 0, "last_day": rows["acc-b"]["last_day"]}  # fmt: skip
    assert rows["acc-b"]["last_day"] and rows["acc-t"]["last_day"] is None
    assert rows["acc-t"]["test"] and rows["acc-o"]["state"] == "active"
    everyone = call(client, "/api/review/accounts").json()
    assert {"rev", "rvw"} <= {r["pseudonym"] for r in everyone["team"]}
    assert everyone["team"][0]["role"] == "admin"  # administrators first
    monkeypatch.setattr(api, "ACCOUNTS_SHOWN", 1)
    assert len(call(client, "/api/review/accounts", {"q": "acc"}).json()["accounts"]) == 1
    assert call(client, "/api/review/accounts", {"q": "%"}).json() == {"team": [], "accounts": []}


def test_the_sheet_says_what_an_administrator_needs_and_nothing_more(
    client, people, pg_dsn, near_wall, build_id
):
    cam = near_wall[0].camera_id
    one, _ = post(client, cam, build_id, "verify", who="acc-o", answer="present")
    sessions.token("acc-o")
    sheet = call(client, "/api/review/account", {"id": people["acc-o"]}).json()
    assert set(sheet) == {
        "id",
        "pseudonym",
        "role",
        "state",
        "test",
        "accepted",
        "pending",
        "rejected",
        "last_day",
        "since",
        "osm",
        "publish",
        "sync",
        "sessions",
        "by_status",
        "contributions",
        "publications",
        "protected",
        "self",
    }
    assert (sheet["osm"], sheet["publish"], sheet["sessions"]) == (True, False, 1)
    assert sheet["sync"] == {"on": False, "server": None, "since": None, "last_error": None}
    assert sheet["by_status"] == {"pending": 1} and not sheet["protected"] and not sheet["self"]
    [c] = sheet["contributions"]
    assert (c["uuid"], c["camera"], c["kind"], c["status"]) == (one, cam, "verify", "pending")
    assert c["label"]["built"] and set(c["label"]) >= {"kind", "street", "commune"}
    assert "4040" not in json.dumps(sheet)  # never the OSM id
    mine = call(client, "/api/review/account", {"id": sessions.account_id("rev")}).json()
    assert mine["self"] and mine["role"] == "admin"
    assert answer(call(client, "/api/review/account", {"id": str(uuid.uuid4())})) == (
        404, {"error": "unknown_account"})  # fmt: skip
    assert call(client, "/api/review/account", {"id": "x"}).status_code == 422


def test_the_last_administrator_is_protected(client, people, pg_dsn):
    rev = sessions.account_id("rev")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        others = conn.execute("UPDATE accounts SET role = 'reviewer' WHERE role = 'admin'"
                              " AND id <> %s RETURNING id::text", (rev,)).fetchall()  # fmt: skip
        try:
            assert api.last_admin(conn, rev) is True
            assert call(client, "/api/review/account", {"id": rev}).json()["protected"]
            conn.execute("UPDATE accounts SET role = 'admin' WHERE id = %s", (people["acc-r"],))
            assert api.last_admin(conn, rev) is False
            conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (people["acc-r"],))
            assert api.last_admin(conn, rev) is True  # a disabled one cannot act
        finally:
            for (o,) in others:
                conn.execute("UPDATE accounts SET role = 'admin' WHERE id = %s", (o,))


def test_the_last_administrator_cannot_delete_themselves(client, pg_dsn):
    rev = sessions.account_id("rev")
    password = "only admin left"  # fictitious, throwaway database only
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        others = conn.execute("UPDATE accounts SET role = 'reviewer' WHERE role = 'admin'"
                              " AND id <> %s RETURNING id::text", (rev,)).fetchall()  # fmt: skip
        conn.execute("UPDATE accounts SET password_hash = %s WHERE id = %s",
                     (auth.hash_password(password), rev))  # fmt: skip
        try:
            r = call(client, "/api/me/delete", {"password": password})
            assert answer(r) == (409, {"error": "last_admin"})
            assert account(pg_dsn, rev) is not None
        finally:
            conn.execute("UPDATE accounts SET password_hash = %s WHERE id = %s",
                         (sessions.NO_LOGIN, rev))  # fmt: skip
            for (o,) in others:
                conn.execute("UPDATE accounts SET role = 'admin' WHERE id = %s", (o,))


# --- changing -----------------------------------------------------------------------------


def test_a_role(client, people, pg_dsn):
    aid, rid = people["acc-a"], people["acc-r"]
    r = call(client, "/api/review/account/role", {"id": aid, "role": "reviewer"})
    assert r.status_code == 200 and r.json()["role"] == "reviewer"
    assert account(pg_dsn, aid)[0] == "reviewer"
    # A demoted reviewer leaves /revue at once.
    sessions.token("acc-r")
    assert call(client, "/api/review/queue", who="acc-r").status_code == 200
    call(client, "/api/review/account/role", {"id": rid, "role": "contributor"})
    assert call(client, "/api/review/queue", who="acc-r").status_code == 401
    call(client, "/api/review/account/role", {"id": rid, "role": "contributor"})  # no change
    refusals = [
        ({"id": people["acc-o"], "role": "admin"}, (422, {"error": "needs_password"})),
        ({"id": sessions.account_id("rev"), "role": "contributor"}, (409, {"error": "self"})),
        ({"id": aid, "role": "owner"}, (422, {"error": "invalid", "fields": ["role"]})),
    ]
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        pla = conn.execute("INSERT INTO accounts (pseudonym, created_month) VALUES"
                           " ('acc-p', '2026-10-01') RETURNING id::text").fetchone()[0]  # fmt: skip
    refusals.append(({"id": pla, "role": "reviewer"}, (409, {"error": "placeholder"})))
    try:
        for body, expected in refusals:
            assert answer(call(client, "/api/review/account/role", body)) == expected, body
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM accounts WHERE id = %s", (pla,))
    assert lines(pg_dsn) == [
        ("rev", "role", "acc-a", None, {"from": "contributor", "to": "reviewer"}),
        ("rev", "role", "acc-r", None, {"from": "reviewer", "to": "contributor"}),
    ]


def test_disable_and_enable(client, people, pg_dsn):
    bid = people["acc-b"]
    sessions.token("acc-b")
    r = call(client, "/api/review/account/state", {"id": bid, "disabled": True})
    assert r.status_code == 200 and r.json()["state"] == "disabled"
    assert account(pg_dsn, bid)[1:] == (True, sessions.NO_LOGIN, None, 0)
    assert client.get("/api/me", headers=headers("acc-b")).status_code == 401
    r = call(client, "/api/review/account/state", {"id": bid, "disabled": False})
    assert r.json()["state"] == "active"
    r = call(client, "/api/review/account/state",
             {"id": sessions.account_id("rev"), "disabled": True})  # fmt: skip
    assert answer(r) == (409, {"error": "self"})
    assert lines(pg_dsn) == [("rev", "disable", "acc-b", None, {"sessions": 1}),
                             ("rev", "enable", "acc-b", None, None)]  # fmt: skip


def test_cut(client, people, pg_dsn):
    sessions.token("acc-r")
    digest = auth.digest(sessions.token("acc-r"))
    assert auth.privileged.has(digest)
    assert answer(call(client, "/api/review/account/cut", {"id": people["acc-r"]})) == (
        200, {"sessions": 1})  # fmt: skip
    assert not auth.privileged.has(digest) and not auth.reauthed.has(digest)
    assert account(pg_dsn, people["acc-r"])[4] == 0
    assert lines(pg_dsn) == [("rev", "cut", "acc-r", None, {"sessions": 1})]


def test_reset(client, people, pg_dsn):
    oid = people["acc-o"]
    sessions.token("acc-o")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_write VALUES (%s, 'dev', 7, '\\x00', '2026-10-01')", (oid,))
    r = call(client, "/api/review/account/reset", {"id": oid})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    password = r.json()["password"]
    assert set(r.json()) == {"password"} and len(password) == 24
    _, _, stored, osm_id, n = account(pg_dsn, oid)
    assert auth.verify(stored, password) and osm_id is None and n == 0
    with psycopg.connect(pg_dsn) as conn:
        assert conn.execute("SELECT count(*) FROM osm_write WHERE account_id = %s",
                            (oid,)).fetchone()[0] == 0  # fmt: skip
    assert lines(pg_dsn) == [("rev", "reset", "acc-o", None, {
        "sessions": 1, "osm_unlinked": True, "publishing_ended": True})]  # fmt: skip
    with psycopg.connect(pg_dsn) as conn:
        assert password not in json.dumps(conn.execute("SELECT * FROM admin_log").fetchall(),
                                          default=str)  # fmt: skip
    r = call(client, "/api/review/account/reset", {"id": sessions.account_id("rev")})
    assert answer(r) == (409, {"error": "self"})


def test_delete(client, people, pg_dsn, near_wall, build_id):
    aid = people["acc-a"]
    one, _ = post(client, near_wall[0].camera_id, build_id, "verify", who="acc-a",
                  answer="present")  # fmt: skip
    body = {"id": aid, "pseudonym": "ACC-A"}
    assert answer(call(client, "/api/review/account/delete", body)) == (
        400, {"error": "confirmation"})  # fmt: skip
    test = {"id": people["acc-t"], "pseudonym": "acc-t"}
    assert answer(call(client, "/api/review/account/delete", test)) == (
        409, {"error": "test_account"})  # fmt: skip
    r = call(client, "/api/review/account/delete", {"id": aid, "pseudonym": "acc-a"})
    assert r.status_code == 204
    assert account(pg_dsn, aid) is None
    with psycopg.connect(pg_dsn) as conn:
        assert conn.execute("SELECT author_id FROM contributions WHERE uuid = %s",
                            (one,)).fetchone() == (None,)  # fmt: skip
        kept = conn.execute("SELECT target_account, target_name FROM admin_log").fetchall()
    assert kept == [(None, "acc-a")]  # the journal keeps the pseudonym, not the account
    assert lines(pg_dsn) == [("rev", "delete", "acc-a", None, {"contributions": 1})]


def test_export_is_the_person_s_own(client, people, pg_dsn, near_wall, build_id):
    post(client, near_wall[0].camera_id, build_id, "verify", who="acc-b", answer="present")
    own = client.get("/api/me/export", headers=headers("acc-b"))
    r = call(client, "/api/review/account/export", {"id": people["acc-b"]})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert 'filename="surveillance-world-donnees-acc-b.json"' in r.headers["content-disposition"]
    assert r.json() == own.json()
    assert lines(pg_dsn) == [("rev", "export_account", "acc-b", None, None)]


def test_suspend_rejects_what_waits_and_each_rejection_undoes(client, people, pg_dsn, near_wall,
                                                              build_id, facade_point):  # fmt: skip
    cam = near_wall[0].camera_id
    waiting, _ = post(client, cam, build_id, "verify", who="acc-b", answer="present")
    kept, _ = post(client, cam, build_id, "direction", who="acc-b", direction=10)
    review.decide(client, kept)  # validated before: stays
    blank, _ = post(client, cam, build_id, "shape", who="acc-b", answer="unknown")  # waits not
    add, _ = post_add(client, build_id, facade_point, who="acc-b")
    added = participation.added_id(add)
    other, _ = post(client, added, build_id, "shape", who="acc-a", answer="dome")
    sessions.token("acc-b")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM admin_log")
    r = call(client, "/api/review/account/suspend", {"id": people["acc-b"]})
    assert answer(r) == (200, {"rejected": 3})
    with psycopg.connect(pg_dsn) as conn:
        status = dict(conn.execute("SELECT uuid::text, status FROM contributions").fetchall())
    assert [status[u] for u in (waiting, kept, blank, add, other)] == [
        "rejected", "validated", "pending", "rejected", "rejected"]  # fmt: skip
    assert account(pg_dsn, people["acc-b"])[1] is True
    assert account(pg_dsn, people["acc-b"])[4] == 0
    assert lines(pg_dsn) == [("rev", "suspend", "acc-b", None, {
        "rejected": sorted([waiting, add, other]), "sessions": 1})]  # fmt: skip
    assert review.undo(client, waiting).json() == {"undone": [waiting]}
    r = call(client, "/api/review/account/suspend", {"id": sessions.account_id("rev")})
    assert answer(r) == (409, {"error": "self"})
