"""Accounts over HTTP (migration 014): signing in and out, the session cookie, what each
route asks of the caller, the per-pseudonym delay, the password change and the deletion.
Fictitious accounts in the throwaway database; argon2 at a test cost except where the
production parameters are checked."""

import re
import uuid
from datetime import date, timedelta

import psycopg
import pytest
import sessions
from argon2 import PasswordHasher
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sessions import ORIGIN

from lacarte.api import app as api
from lacarte.api import auth

PASSWORD = "correct horse battery"  # fictitious, throwaway database only
PRODUCTION_HASHER = auth.hasher  # before the tests swap in a cheaper one
JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


class Clock:
    """The throttle's clock and the login's sleep, without waiting."""

    def __init__(self):
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self):
        return self.now

    async def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


@pytest.fixture(autouse=True)
def cheap(monkeypatch, client):
    """argon2 at a test cost, a fresh throttle on a fake clock, no cookie kept."""
    monkeypatch.setattr(auth, "hasher", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
    monkeypatch.setattr(auth, "_dummy", None)
    clock = Clock()
    monkeypatch.setattr(auth, "throttle", auth.Throttle(clock=clock))
    monkeypatch.setattr(auth, "sleep", clock.sleep)
    client.cookies.clear()
    yield clock
    client.cookies.clear()


def make(dsn, name, password=PASSWORD, *, role="contributor", disabled=False, placeholder=False):
    """A fictitious account with a real (test-cost) hash; returns its id."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE lower(pseudonym) = lower(%s)", (name,))
        return conn.execute(
            "INSERT INTO accounts (pseudonym, password_hash, role, created_month, disabled)"
            " VALUES (%s, %s, %s, date_trunc('month', current_date), %s) RETURNING id::text",
            (name, None if placeholder else auth.hash_password(password), role, disabled),
        ).fetchone()[0]


def login(client, name, password=PASSWORD, **headers):
    return client.post("/api/session", json={"pseudonym": name, "password": password},
                       headers={**JSON, **headers})  # fmt: skip


def cookie_of(r) -> str:
    return re.search(r"session=([^;]*)", r.headers["set-cookie"]).group(1)


def signed(token: str, **extra) -> dict:
    return {"Cookie": f"session={token}", **JSON, **extra}


# --- routes ------------------------------------------------------------------------------

PUBLIC = {("GET", "/api/proposals"), ("GET", "/api/config"), ("POST", "/api/session"),
          ("DELETE", "/api/session"), ("POST", "/api/review/session"),
          ("POST", "/api/hit"), ("GET", "/api/history")}  # fmt: skip
PRIVILEGED = {"error": "privileged"}


def routes():
    for r in api.app.routes:
        if isinstance(r, APIRoute):
            for method in sorted(r.methods):
                yield method, r.path


def test_no_route_carries_an_id_in_its_path():
    """Caddy logs the URI of a failed proxied request: ids travel in the body or the query."""
    paths = [p for _, p in routes()]
    assert paths and not [p for p in paths if "{" in p]


# Sign in with OpenStreetMap's routes: test_osm_api (they answer 503 while it is off).
NOT_OSM = sorted(r for r in routes() if not r[1].startswith("/api/osm/"))


@pytest.mark.parametrize(("method", "path"), NOT_OSM)
def test_every_route_says_what_it_asks(client, pg_dsn, method, path):
    """Without a session: 401 session, but the proposals and signing in or out; a review
    route (lot 2) without a privileged session, a contributor's included: 401 privileged;
    an administrator's privileged session (reauthenticated) gets past every check."""
    body = {} if method in ("POST", "PUT") else None
    anonymous = client.request(method, path, json=body, headers=JSON)
    if (method, path) in PUBLIC:
        assert anonymous.status_code != 401 or path.endswith("/session"), anonymous.text
        return
    review = path.startswith("/api/review/")
    expected = (401, PRIVILEGED if review else {"error": "session"})
    assert (anonymous.status_code, anonymous.json()) == expected
    contributor = client.request(method, path, json=body, headers=sessions.headers("ana"))
    if review:
        assert (contributor.status_code, contributor.json()) == (401, PRIVILEGED)
        reviewer = client.request(method, path, json=body, headers=sessions.headers("rev"))
        assert reviewer.status_code not in (401, 403), reviewer.text
    else:
        assert contributor.status_code not in (401, 403), contributor.text


def test_proposals_answer_without_a_session_and_say_nothing_of_anyone(client):
    r = client.get("/api/proposals?bbox=2.2,48.8,2.3,48.9")
    assert r.status_code == 200
    assert all("m" not in f["properties"] for f in r.json()["features"])


def test_x_author_names_no_one(client):
    r = client.get("/api/me", headers={"X-Author": "rev"})
    assert (r.status_code, r.json()) == (401, {"error": "session"})


# --- signing in and out --------------------------------------------------------------------


def test_signing_in_sets_the_session_cookie_and_signing_out_clears_it(client, pg_dsn):
    make(pg_dsn, "lin")
    r = login(client, "LIN")  # a pseudonym has no case
    assert r.status_code == 204, r.text
    raw = r.headers["set-cookie"]
    attrs = {a.strip().split("=")[0].lower() for a in raw.split(";")[1:]}
    assert raw.startswith("session=") and attrs == {"httponly", "max-age", "path", "samesite"}
    assert "Max-Age=2592000" in raw and "Path=/" in raw and "SameSite=strict" in raw
    token = cookie_of(r)
    assert len(token) == 43  # 32 bytes, urlsafe base64
    with psycopg.connect(pg_dsn) as conn:
        stored = conn.execute(
            "SELECT token_sha256, expires_on FROM sessions s JOIN accounts a"
            " ON a.id = s.account_id WHERE a.pseudonym = 'lin'"
        ).fetchall()
    assert stored == [(auth.digest(token), date.today() + timedelta(days=30))]  # only the hash
    client.cookies.clear()
    me = client.get("/api/me", headers=signed(token)).json()
    assert (me["pseudonym"], me["author"], me["role"]) == ("lin", "lin", "contributor")
    out = client.delete("/api/session", headers=signed(token))
    assert out.status_code == 204 and "Max-Age=0" in out.headers["set-cookie"]
    assert client.get("/api/me", headers=signed(token)).status_code == 401
    assert client.delete("/api/session", headers={"Origin": ORIGIN}).status_code == 204


def test_the_production_cookie_is_host_only_and_secure(client, pg_dsn, monkeypatch):
    make(pg_dsn, "lin")
    monkeypatch.setattr(api.settings, "cookie_secure", True)
    r = login(client, "lin")
    raw = r.headers["set-cookie"]
    assert raw.startswith("__Host-session=") and "; Secure" in raw and "HttpOnly" in raw
    assert "Domain" not in raw and "Path=/" in raw and "SameSite=strict" in raw
    cleared = client.delete("/api/session", headers={"Origin": ORIGIN}).headers["set-cookie"]
    assert cleared.startswith("__Host-session=") and "; Secure" in cleared
    client.cookies.clear()
    token = cookie_of(r)
    assert client.get("/api/me", headers={"Cookie": f"__Host-session={token}"}).status_code == 200
    assert client.get("/api/me", headers={"Cookie": f"session={token}"}).status_code == 401


def test_signing_in_needs_our_origin(client, pg_dsn):
    make(pg_dsn, "lin")
    r = login(client, "lin", Origin="https://elsewhere.test")
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    assert client.delete("/api/session").status_code == 403


@pytest.mark.parametrize("case", ["unknown", "wrong", "placeholder", "osm", "disabled"])
def test_every_refusal_is_the_same_and_checks_a_hash(client, pg_dsn, monkeypatch, case):
    """`osm`: an account that signs in with OpenStreetMap and has no password (015)."""
    aid = make(pg_dsn, "lin", placeholder=case in ("placeholder", "osm"),
               disabled=case == "disabled")  # fmt: skip
    if case == "osm":
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("UPDATE accounts SET osm_id = 1501, osm_server = 'dev' WHERE id = %s",
                         (aid,))  # fmt: skip
    checked = []
    inner = auth.hasher

    class Counting:
        def hash(self, password):
            return inner.hash(password)

        def verify(self, stored, password):
            checked.append(stored)
            return inner.verify(stored, password)

    monkeypatch.setattr(auth, "hasher", Counting())
    name, password = {"unknown": ("nobody", PASSWORD), "wrong": ("lin", "not the password")}.get(
        case, ("lin", PASSWORD))  # fmt: skip
    r = login(client, name, password)
    assert (r.status_code, r.json()) == (401, {"error": "credentials"})
    assert "set-cookie" not in r.headers and len(checked) == 1


def test_an_expired_session_or_a_disabled_account_is_no_session(client, pg_dsn):
    aid = make(pg_dsn, "lin")
    token = cookie_of(login(client, "lin"))
    client.cookies.clear()
    assert client.get("/api/me", headers=signed(token)).status_code == 200
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE sessions SET expires_on = current_date WHERE account_id = %s", (aid,))
        assert client.get("/api/me", headers=signed(token)).status_code == 401
        conn.execute("UPDATE sessions SET expires_on = current_date + 1 WHERE account_id = %s",
                     (aid,))  # fmt: skip
        conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (aid,))
        assert client.get("/api/me", headers=signed(token)).status_code == 401
        # A sign-in purges the expired sessions of every account.
        conn.execute("UPDATE sessions SET expires_on = current_date WHERE account_id = %s", (aid,))
    make(pg_dsn, "max")
    login(client, "max")
    with psycopg.connect(pg_dsn) as conn:
        assert conn.execute("SELECT count(*) FROM sessions WHERE expires_on <= current_date"
                            ).fetchone()[0] == 0  # fmt: skip


# --- the delay -----------------------------------------------------------------------------


def test_failures_double_the_delay_per_pseudonym_and_a_success_resets_it(client, pg_dsn, cheap):
    make(pg_dsn, "lin")
    for _ in range(7):
        assert login(client, "lin", "wrong password").status_code == 401
    # Each attempt waited for the delay the failures before it set: 1, 2, 4 ... 30 s.
    assert cheap.slept == [1, 2, 4, 8, 16, 30]
    assert login(client, "Lin").status_code == 204  # waits 30 s more, then resets
    assert cheap.slept[-1] == 30
    cheap.slept.clear()
    assert login(client, "lin", "wrong password").status_code == 401
    assert cheap.slept == []  # the first failure after a success is answered at once
    login(client, "other", "x")  # another pseudonym (unknown): its own delay
    login(client, "other", "x")
    assert cheap.slept == [1]


def test_the_delay_is_over_when_its_time_has_passed(client, pg_dsn, cheap):
    make(pg_dsn, "lin")
    login(client, "lin", "wrong password")
    cheap.now += 5  # the person came back later
    assert login(client, "lin").status_code == 204 and cheap.slept == []


def test_the_throttle_table_is_bounded_and_keeps_no_address():
    t = auth.Throttle(size=3, clock=lambda: 0.0)
    for name in ("a1", "a2", "a3", "a4"):
        t.failed(name)
    assert list(t.entries) == ["a2", "a3", "a4"]  # the oldest out
    assert t.wait("a1") == 0 and t.wait("a4") == 1
    assert all(isinstance(k, str) and isinstance(v, tuple) for k, v in t.entries.items())


def test_production_passwords_are_argon2id_with_the_library_defaults():
    """argon2-cffi's PasswordHasher() defaults (read in argon2-cffi 25.1.0): argon2id,
    t=3, m=64 MiB, p=4; at most two computations at once."""
    h = PRODUCTION_HASHER
    assert (h.time_cost, h.memory_cost, h.parallelism, h.hash_len, h.salt_len) == (
        3, 65536, 4, 32, 16)  # fmt: skip
    assert h.hash("a fictitious password").startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    assert auth._slots._value == 2


# --- the person's own account --------------------------------------------------------------


def test_the_leaderboard_flag_is_the_person_s(client, pg_dsn):
    make(pg_dsn, "lin")
    token = cookie_of(login(client, "lin"))
    client.cookies.clear()
    assert client.get("/api/me", headers=signed(token)).json()["leaderboard"] is False
    r = client.put("/api/me/leaderboard", json={"on": True}, headers=signed(token))
    assert r.status_code == 204
    assert client.get("/api/me", headers=signed(token)).json()["leaderboard"] is True


def test_changing_the_password_revokes_the_other_sessions(client, pg_dsn):
    make(pg_dsn, "lin")
    phone = cookie_of(login(client, "lin"))
    laptop = cookie_of(login(client, "lin"))
    client.cookies.clear()
    new = "another long password"
    short = client.post("/api/me/password", json={"current": PASSWORD, "new": "short"},
                        headers=signed(phone))  # fmt: skip
    assert (short.status_code, short.json()) == (400, {"error": "password_short"})
    wrong = client.post("/api/me/password", json={"current": "nope nope nope", "new": new},
                        headers=signed(phone))  # fmt: skip
    assert (wrong.status_code, wrong.json()) == (401, {"error": "credentials"})
    ok = client.post("/api/me/password", json={"current": PASSWORD, "new": new},
                     headers=signed(phone))  # fmt: skip
    assert ok.status_code == 204
    assert client.get("/api/me", headers=signed(phone)).status_code == 200  # this one stays
    assert client.get("/api/me", headers=signed(laptop)).status_code == 401
    assert login(client, "lin").status_code == 401
    assert login(client, "lin", new).status_code == 204


def test_deleting_the_account_keeps_its_contributions_without_author(client, pg_dsn):
    aid = make(pg_dsn, "lin")
    token = cookie_of(login(client, "lin"))
    client.cookies.clear()
    with psycopg.connect(pg_dsn) as conn:
        cam, build = conn.execute(
            "SELECT camera_id, (SELECT build_id FROM meta) FROM cameras ORDER BY 1 LIMIT 1"
        ).fetchone()
    uid = str(uuid.uuid4())
    body = {"kind": "verify", "camera": cam, "build_id": build, "day": date.today().isoformat(),
            "duration_ms": 900, "on_site": True, "answer": "present", "uuid": uid}  # fmt: skip
    assert client.post("/api/contributions", json=body, headers=signed(token)).status_code == 200
    wrong = client.post("/api/me/delete", json={"password": "nope"}, headers=signed(token))
    assert (wrong.status_code, wrong.json()) == (401, {"error": "credentials"})
    r = client.post("/api/me/delete", json={"password": PASSWORD}, headers=signed(token))
    assert r.status_code == 204 and "Max-Age=0" in r.headers["set-cookie"]
    with psycopg.connect(pg_dsn) as conn:
        assert conn.execute("SELECT count(*) FROM accounts WHERE id = %s", (aid,)).fetchone() == (
            0,
        )
        assert conn.execute("SELECT count(*) FROM sessions WHERE account_id = %s",
                            (aid,)).fetchone() == (0,)  # fmt: skip
        assert conn.execute("SELECT author_id FROM contributions WHERE uuid = %s",
                            (uid,)).fetchone() == (None,)  # fmt: skip
        conn.execute("DELETE FROM contributions WHERE uuid = %s", (uid,))
        conn.commit()
    assert client.get("/api/me", headers=signed(token)).status_code == 401
    rows = client.get("/api/review/contributions", headers=sessions.headers("rev")).json()
    assert all(r["author"] != "lin" for r in rows["contributions"])


def test_parallel_guesses_wait_their_turn(cheap):
    """Ten guesses at once on one pseudonym are checked one after the other, each after
    the delay the failures before it set: not ten guesses for one delay."""
    import asyncio

    from lacarte.api import app as api

    checked = []

    def wrong():
        checked.append(cheap())
        return None

    async def burst():
        await asyncio.gather(*(api.throttled("lin", wrong) for _ in range(10)))

    asyncio.run(burst())
    assert cheap.slept == [1, 2, 4, 8, 16, 30, 30, 30, 30]
    assert checked == sorted(checked) and len(set(checked)) == 10
    assert api._attempts == {}  # nothing kept once the attempts are over


def test_a_test_account_is_not_deleted_from_the_page(client, pg_dsn):
    """Its contributions would lose what marks them as test: the owner deletes it with the
    CLI, which takes them with it (409, the account still there)."""
    aid = make(pg_dsn, "tia")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET test = true WHERE id = %s", (aid,))
    token = cookie_of(login(client, "tia"))
    client.cookies.clear()
    r = client.post("/api/me/delete", json={"password": PASSWORD}, headers=signed(token))
    assert (r.status_code, r.json()) == (409, {"error": "test_account"})
    with psycopg.connect(pg_dsn) as conn:
        assert conn.execute("SELECT count(*) FROM accounts WHERE id = %s", (aid,)).fetchone() == (
            1,
        )
