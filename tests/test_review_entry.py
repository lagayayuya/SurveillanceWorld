"""The privileged entry of /revue (lot 2 « Administrer », plan-revue §5): a reviewer or an
administrator signs in by POST /api/review/session, never by /api/session; the session is
marked privileged for review.privileged_hours (in memory); POST /api/review/reauth marks it
for review.reauth_minutes; three refusals in a row write one journal line. Fictitious
accounts in the throwaway database, argon2 at a test cost."""

import re

import psycopg
import pytest
import sessions
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sessions import ORIGIN

from lacarte import participation
from lacarte.api import app as api
from lacarte.api import auth

PASSWORD = "a fictitious review password"
JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
CREDENTIALS = (401, {"error": "credentials"})
PRIVILEGED = (401, {"error": "privileged"})


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


class Clock:
    def __init__(self):
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self):
        return self.now

    async def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


@pytest.fixture(autouse=True)
def clock(monkeypatch, client, pg_dsn):
    monkeypatch.setattr(auth, "hasher", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
    monkeypatch.setattr(auth, "_dummy", None)
    c = Clock()
    monkeypatch.setattr(auth, "throttle", auth.Throttle(clock=c))
    monkeypatch.setattr(auth, "sleep", c.sleep)
    for marks in ("privileged", "reauthed"):
        monkeypatch.setattr(auth, marks, auth.Marks(clock=c))
    api._refusals.clear()
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM admin_log")
    client.cookies.clear()
    yield c
    client.cookies.clear()


def make(dsn, name, role, password=PASSWORD) -> str:
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE lower(pseudonym) = lower(%s)", (name,))
        return conn.execute(
            "INSERT INTO accounts (pseudonym, password_hash, role, created_month)"
            " VALUES (%s, %s, %s, date_trunc('month', current_date)) RETURNING id::text",
            (name, password and auth.hash_password(password), role),
        ).fetchone()[0]


def enter(client, name, password=PASSWORD, path="/api/review/session"):
    return client.post(path, json={"pseudonym": name, "password": password}, headers=JSON)


def token_of(r) -> str:
    return re.search(r"session=([^;]*)", r.headers["set-cookie"]).group(1)


def signed(token: str) -> dict:
    return {"Cookie": f"session={token}", **JSON}


def answer(r) -> tuple:
    return r.status_code, r.json()


def journal(dsn) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT actor_id, actor, action, target_account::text, target_name, target, detail,"
            " day = current_date FROM admin_log ORDER BY seq"
        ).fetchall()


@pytest.mark.parametrize("role", ["reviewer", "admin"])
def test_a_privileged_account_enters_by_the_review_entry_only(client, pg_dsn, clock, role):
    aid = make(pg_dsn, "rina", role)
    # The map's form refuses it as it refuses a wrong password, after the same delay.
    assert answer(enter(client, "rina", path="/api/session")) == CREDENTIALS
    assert answer(enter(client, "rina", "wrong", path="/api/session")) == CREDENTIALS
    assert clock.slept == [1.0]
    clock.now += 60
    r = enter(client, "RINA")
    assert r.status_code == 204, r.text
    raw = r.headers["set-cookie"]
    assert raw.startswith("session=") and "HttpOnly" in raw and "SameSite=strict" in raw
    token = token_of(r)
    client.cookies.clear()
    me = client.get("/api/review/me", headers=signed(token))
    assert answer(me) == (200, {"pseudonym": "rina", "role": role, "reauth": False})
    assert client.get("/api/review/queue", headers=signed(token)).status_code == 200
    assert client.get("/api/me", headers=signed(token)).json()["reviewer"] is True
    assert auth.privileged.entries[auth.digest(token)][0] == aid


@pytest.mark.parametrize("case", ["contributor", "wrong", "unknown", "no_password", "disabled"])
def test_everything_else_is_the_same_refusal(client, pg_dsn, clock, case):
    role = "contributor" if case == "contributor" else "admin"
    aid = make(pg_dsn, "rina", role, password=None if case == "no_password" else PASSWORD)
    if case == "disabled":
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (aid,))
    name = "nobody-here" if case == "unknown" else "rina"
    r = enter(client, name, "wrong" if case == "wrong" else PASSWORD)
    assert answer(r) == CREDENTIALS and "set-cookie" not in r.headers
    assert enter(client, name).status_code == (204 if case == "wrong" else 401)


def test_an_ordinary_session_of_a_reviewer_opens_nothing_of_the_review(client, pg_dsn):
    """A session opened otherwise (signing in with OSM gives an ordinary one): contributor
    rights only — no review route, no conflict on the map, `reviewer` false."""
    aid = make(pg_dsn, "rina", "admin")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        token = auth.open_session(conn, aid, auth.date.today())
    for path in ("/api/review/me", "/api/review/queue", "/api/review/camera?camera=n1"):
        assert answer(client.get(path, headers=signed(token))) == PRIVILEGED, path
    r = client.post("/api/review/decide", json={"uuid": "x", "decision": "validated"},
                    headers=signed(token))  # fmt: skip
    assert answer(r) == PRIVILEGED
    me = client.get("/api/me", headers=signed(token)).json()
    assert (me["reviewer"], me["role"]) == (False, "admin")


def test_the_mark_lasts_its_hours_and_goes_with_the_role(client, pg_dsn, clock):
    hours = participation.rules()["review"]["privileged_hours"]
    aid = make(pg_dsn, "rina", "reviewer")
    token = token_of(enter(client, "rina"))
    client.cookies.clear()
    clock.now += hours * 3600 - 1
    assert client.get("/api/review/me", headers=signed(token)).status_code == 200
    clock.now += 1
    assert answer(client.get("/api/review/me", headers=signed(token))) == PRIVILEGED
    # The session itself stays an ordinary one.
    assert client.get("/api/me", headers=signed(token)).json()["reviewer"] is False
    token = token_of(enter(client, "rina"))
    client.cookies.clear()
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET role = 'contributor' WHERE id = %s", (aid,))
    assert answer(client.get("/api/review/me", headers=signed(token))) == PRIVILEGED
    assert not auth.privileged.entries  # dropped, not only refused
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET role = 'reviewer' WHERE id = %s", (aid,))
    assert answer(client.get("/api/review/me", headers=signed(token))) == PRIVILEGED


def test_signing_out_drops_the_marks(client, pg_dsn):
    make(pg_dsn, "rina", "admin")
    token = token_of(enter(client, "rina"))
    client.cookies.clear()
    r = client.post("/api/review/reauth", json={"password": PASSWORD}, headers=signed(token))
    assert r.status_code == 204, r.text
    assert client.delete("/api/session", headers=signed(token)).status_code == 204
    assert not auth.privileged.entries and not auth.reauthed.entries


def test_the_reauthentication_holds_its_minutes(client, pg_dsn, clock):
    minutes = participation.rules()["review"]["reauth_minutes"]
    make(pg_dsn, "rina", "admin")
    token = token_of(enter(client, "rina"))
    client.cookies.clear()
    reauth = {"password": "wrong"}
    r = client.post("/api/review/reauth", json=reauth, headers=signed(token))
    assert answer(r) == CREDENTIALS
    clock.now += 60
    r = client.post("/api/review/reauth", json={"password": PASSWORD}, headers=signed(token))
    assert r.status_code == 204
    assert client.get("/api/review/me", headers=signed(token)).json()["reauth"] is True
    clock.now += minutes * 60
    assert client.get("/api/review/me", headers=signed(token)).json()["reauth"] is False
    # Not for an ordinary session.
    assert answer(client.post("/api/review/reauth", json={"password": PASSWORD},
                              headers=sessions.headers("ana"))) == PRIVILEGED  # fmt: skip


def test_three_refusals_in_a_row_write_one_journal_line(client, pg_dsn, clock):
    aid = make(pg_dsn, "rina", "reviewer")
    make(pg_dsn, "cora", "contributor")
    for _ in range(4):
        enter(client, "rina", "wrong")
        enter(client, "cora", "wrong")  # a contributor: never in the journal
        enter(client, "nobody-here", "wrong")  # nor an unknown pseudonym
        clock.now += 60
    line = (None, "", "signin_refused", aid, "rina", None, None, True)
    assert journal(pg_dsn) == [line]
    assert enter(client, "rina").status_code == 204  # a success starts the count again
    client.cookies.clear()
    for _ in range(2):
        enter(client, "rina", "wrong")
        clock.now += 60
    assert journal(pg_dsn) == [line]
    token = token_of(enter(client, "rina"))
    client.cookies.clear()
    for _ in range(3):  # the reauthentication counts too
        client.post("/api/review/reauth", json={"password": "wrong"}, headers=signed(token))
        clock.now += 60
    assert journal(pg_dsn) == [line, line]
