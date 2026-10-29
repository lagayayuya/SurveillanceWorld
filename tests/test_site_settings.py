"""The site's settings: PUBLISHER_IDENTITY read by the API at start; contributions and
sign-ups open or closed read from the database (site_settings, migration 020, cached a few
seconds; CONTRIBUTIONS_OPEN in the environment ignored). GET /api/config, and contributions
closed — the routes of CLOSED_ROUTES answer 403 closed, signed in or not; every other route
answers as before; sign-ups closed — those of SIGNUP_ROUTES answer 403 signups_closed.
Fictitious accounts in the throwaway database."""

import base64
import logging

import psycopg
import pytest
import sessions
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sessions import ORIGIN

from lacarte.api import app as api

JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
CLOSED_ERROR = {"error": "closed"}
# The launch contract's list (« Closed contributions »).
LISTED = {
    ("POST", "/api/contributions"), ("POST", "/api/contributions/withdraw"),
    ("POST", "/api/operators"), ("POST", "/api/preview"), ("POST", "/api/modify/preview"),
    ("GET", "/api/osm/login"), ("POST", "/api/osm/link"), ("GET", "/api/osm/signup"),
    ("POST", "/api/osm/signup"),
    # Lot R1b: the register's « Signaler une erreur ».
    ("POST", "/api/registre/signalement"),
}  # fmt: skip


def routes():
    for r in api.app.routes:
        if isinstance(r, APIRoute):
            for method in sorted(r.methods):
                yield method, r.path


OTHERS = sorted(set(routes()) - LISTED)


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app, follow_redirects=False) as c:
        yield c


def switch(dsn, key: str, value: bool) -> None:
    """As an administrator's « Réglages » does: the row, then this process's copy forgotten."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = %s WHERE key = %s", (value, key))
    api.switches.forget()


@pytest.fixture
def closed(client, pg_dsn):
    switch(pg_dsn, "contributions_open", False)
    client.cookies.clear()
    yield
    switch(pg_dsn, "contributions_open", True)
    client.cookies.clear()


@pytest.fixture
def no_signups(client, pg_dsn):
    switch(pg_dsn, "signups_open", False)
    yield
    switch(pg_dsn, "signups_open", True)


def settings(monkeypatch, caplog, **env):
    for k in ("CONTRIBUTIONS_OPEN", "PUBLISHER_IDENTITY"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        return api.Settings()


def said(caplog, about: str) -> list[str]:
    """The log's lines about one setting (the OSM ones speak of their own)."""
    return [r.getMessage() for r in caplog.records if about in r.getMessage()]


# --- reading the settings ----------------------------------------------------------------


@pytest.mark.parametrize("value", [None, "", "yes", "no", "maybe"])
def test_contributions_open_in_the_environment_is_ignored_and_said_once(monkeypatch, caplog,
                                                                         value):  # fmt: skip
    env = {} if value is None else {"CONTRIBUTIONS_OPEN": value}
    s = settings(monkeypatch, caplog, **env)
    assert not hasattr(s, "contributions_open")
    expected = [] if value is None else [
        "CONTRIBUTIONS_OPEN ignored: contributions open or close in /revue"]  # fmt: skip
    assert said(caplog, "CONTRIBUTIONS_OPEN") == expected
    assert value is None or f"={value}" not in caplog.text


def test_a_change_in_the_database_is_read_within_the_delay(client, pg_dsn, monkeypatch):
    """Another process's change (or one by hand): seen once the copy is SWITCHES_TTL_S old,
    without a restart."""
    clock = [100.0]
    monkeypatch.setattr(api.switches, "clock", lambda: clock[0])
    api.switches.forget()
    assert client.get("/api/config").json()["contributions"] is True
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = false WHERE key = 'contributions_open'")
    try:
        clock[0] += api.SWITCHES_TTL_S - 0.1
        assert client.get("/api/config").json()["contributions"] is True
        r = client.post("/api/preview", json={}, headers=sessions.headers("ana"))
        assert r.json() != CLOSED_ERROR
        clock[0] += 0.1
        assert client.get("/api/config").json()["contributions"] is False
        r = client.post("/api/preview", json={}, headers=sessions.headers("ana"))
        assert (r.status_code, r.json()) == (403, CLOSED_ERROR)
    finally:
        switch(pg_dsn, "contributions_open", True)


@pytest.mark.parametrize(("raw", "shown"), [
    (None, None),
    ("", None),
    ("   ", None),
    ("  Camille Exemple  ", "Camille Exemple"),
    ("Camille\tExemple\n1 rue Fictive\r\n75000 Paris", "Camille Exemple 1 rue Fictive 75000 Paris"),
    ("Camille\u202eelpmexE", "Camille elpmexE"),  # a direction override: a space
    ("Camille\u200bExemple\x7f", "Camille Exemple"),  # zero width, delete
    ("<b>Camille</b> & co", "<b>Camille</b> & co"),  # plain text: kept as typed, never markup
    ("x" * api.PUBLISHER_MAX, "x" * api.PUBLISHER_MAX),
])  # fmt: skip
def test_the_publisher_is_plain_text_on_one_line(monkeypatch, caplog, raw, shown):
    env = {} if raw is None else {"PUBLISHER_IDENTITY": raw}
    assert settings(monkeypatch, caplog, **env).publisher == shown
    assert said(caplog, "publisher") == []


def test_a_publisher_too_long_is_not_shown_and_said_without_its_value(monkeypatch, caplog):
    raw = "Camille " + "x" * api.PUBLISHER_MAX
    assert settings(monkeypatch, caplog, PUBLISHER_IDENTITY=raw).publisher is None
    assert said(caplog, "publisher") == [
        f"publisher identity not shown: longer than {api.PUBLISHER_MAX} characters"
    ]
    assert "Camille" not in caplog.text


# --- GET /api/config ---------------------------------------------------------------------


def test_config_needs_no_session_and_says_the_five(client, monkeypatch):
    monkeypatch.setattr(api.settings, "publisher", None)
    r = client.get("/api/config")
    assert r.status_code == 200
    assert set(r.json()) == {"contributions", "signups", "publish", "sync", "publisher"}
    assert r.json()["contributions"] is True and r.json()["publisher"] is None
    assert r.json()["signups"] is True
    assert "set-cookie" not in r.headers


def test_config_shows_the_publisher_when_set(client, monkeypatch):
    monkeypatch.setattr(api.settings, "publisher", "Camille Exemple")
    assert client.get("/api/config").json()["publisher"] == "Camille Exemple"


def test_config_says_closed_and_offers_no_publishing_then(client, closed):
    """Closed: nothing to choose (`publish`); the synchronisation's setting stays offered
    (`sync`, whatever writing is), so that a person can always stop it."""
    assert client.get("/api/config").json() == {
        "contributions": False, "signups": False, "publish": False,
        "sync": api.publish_server() is not None, "publisher": api.settings.publisher}  # fmt: skip


# --- sign-ups closed -----------------------------------------------------------------------


def test_sign_ups_closed_refuse_a_new_osm_account_only(client, no_signups):
    config = client.get("/api/config").json()
    assert (config["contributions"], config["signups"]) == (True, False)
    for method in ("GET", "POST"):
        r = client.request(method, "/api/osm/signup", json={} if method == "POST" else None,
                           headers=JSON)  # fmt: skip
        assert (r.status_code, r.json()) == (403, {"error": "signups_closed"}), method
    # Everything else answers as before: signing in, contributing.
    assert client.get("/api/osm/status").status_code == 200
    r = client.post("/api/preview", json={}, headers=sessions.headers("ana"))
    assert r.status_code == 422


def test_the_signup_routes_are_the_listed_ones():
    assert {("GET", "/api/osm/signup"), ("POST", "/api/osm/signup")} == api.SIGNUP_ROUTES


# --- contributions closed ----------------------------------------------------------------


def test_the_closed_routes_are_the_listed_ones_and_all_exist():
    assert api.CLOSED_ROUTES == LISTED
    assert set(routes()) >= LISTED


@pytest.mark.parametrize(("method", "path"), sorted(LISTED))
def test_a_listed_route_answers_closed_signed_in_or_not(client, closed, method, path):
    body = {} if method == "POST" else None
    for headers in (JSON, sessions.headers("ana"), sessions.headers("rev")):
        r = client.request(method, path, json=body, headers=headers)
        assert (r.status_code, r.json()) == (403, CLOSED_ERROR), (headers, r.text)


def test_a_head_on_a_listed_get_answers_closed(client, closed):
    r = client.head("/api/osm/login")
    assert r.status_code == 403


def test_open_the_listed_routes_answer_as_before(client):
    for method, path in sorted(LISTED):
        body = {} if method == "POST" else None
        r = client.request(method, path, json=body, headers=JSON)
        assert not is_closed(r), (method, path)


def is_closed(r) -> bool:
    return (r.status_code == 403 and r.headers.get("content-type") == "application/json"
            and r.json() == CLOSED_ERROR)  # fmt: skip


@pytest.mark.parametrize(("method", "path"), OTHERS)
def test_every_other_route_still_answers_closed(client, closed, method, path):
    """The review, the session, /api/me, the export and the deletion among them: never
    closed, and the reviewer gets past every session and role check (an empty body: no
    route here changes anything with it)."""
    body = {} if method in ("POST", "PUT") else None
    for who in ("ana", "rev"):
        r = client.request(method, path, json=body, headers=sessions.headers(who))
        assert not is_closed(r), (who, r.text)
        if who == "rev":
            assert r.status_code not in (401, 403), (r.status_code, r.text)
        if (method, path) == ("DELETE", "/api/session"):
            sessions.forget()  # signed out: the next request opens another session


def test_closed_a_password_account_signs_in_and_reaches_the_review(client, closed, pg_dsn):
    from argon2 import PasswordHasher

    from lacarte.api import auth

    hashed = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash("a fictitious one")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE pseudonym = 'revclosed'")
        conn.execute("INSERT INTO accounts (pseudonym, password_hash, role, created_month)"
                     " VALUES ('revclosed', %s, 'reviewer', date_trunc('month', current_date))",
                     (hashed,))  # fmt: skip
    auth.throttle.clear()
    login = {"pseudonym": "revclosed", "password": "a fictitious one"}
    r = client.post("/api/review/session", json=login, headers=JSON)
    assert r.status_code == 204, r.text
    assert client.get("/api/me").json()["reviewer"] is True
    assert client.get("/api/review/queue").status_code == 200
    assert client.delete("/api/session", headers={"Origin": ORIGIN}).status_code == 204


def test_closed_the_osm_status_offers_neither_sign_in_nor_publishing(client, closed):
    s = client.get("/api/osm/status").json()
    assert (s["login"], s["write"]) == (False, False)


# --- publishing offered ------------------------------------------------------------------


def servers(monkeypatch, login: str, write: str) -> None:
    """People sign in on `login`, publishing is set up on `write` (the deploy's write
    server, as write_server() finds it: the live one is /revue's switch in fact)."""
    s = api.settings
    monkeypatch.setattr(s, "osm_login_server", login)
    monkeypatch.setattr(s, "osm_write_server", write)
    monkeypatch.setattr(s, "osm_write_url", "https://osm.test")
    monkeypatch.setattr(s, "osm_write_client_id", "fake-id")
    monkeypatch.setattr(s, "osm_write_client_secret", "fake-secret")
    monkeypatch.setattr(s, "osm_token_key", bytes(range(32)))


@pytest.mark.parametrize(("login", "write", "offered"), [
    ("dev", "dev", True),  # the preview
    ("dev", "live", True),
    ("live", "live", True),  # the live server, approved
    ("live", "dev", False),  # the public site while writing goes to the test server
])  # fmt: skip
def test_publishing_is_offered_on_the_live_server_or_while_signing_in_on_the_test_one(
    client, monkeypatch, login, write, offered
):
    servers(monkeypatch, login, write)
    config = client.get("/api/config").json()
    assert (config["publish"], config["sync"]) == (offered, offered)
    assert client.get("/api/osm/status").json()["write"] is offered
    # A person who chose to publish there (an osm_write row): /api/me says so only when offered.
    aid = sessions.account_id("ana")
    with psycopg.connect(api.settings.dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_write VALUES (%s, %s, 1, '\\x00', '2026-10-01')"
                     " ON CONFLICT (account_id) DO UPDATE SET server = EXCLUDED.server",
                     (aid, write))  # fmt: skip
    try:
        me = client.get("/api/me", headers=sessions.headers("ana")).json()
        assert (me["sync"], me["publish"]) == (offered, offered)
    finally:
        with psycopg.connect(api.settings.dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM osm_write WHERE account_id = %s", (aid,))
    r = client.post("/api/osm/sync", json={"on": True}, headers=sessions.headers("ana"))
    refused = r.status_code == 503 and r.json() == {"error": "osm_unavailable"}
    assert refused is not offered, (r.status_code, r.text)
    assert client.get("/api/osm/sync", headers=sessions.headers("ana")).json()["offered"] is offered


def test_osm_write_server_live_is_no_write_server(monkeypatch, caplog):
    """The live server is /revue's switch (migration 022), not the environment's."""
    key = base64.b64encode(bytes(range(32))).decode()
    env = {"OSM_LOGIN_SERVER": "live", "OSM_WRITE_SERVER": "live", "OSM_TOKEN_KEY": key,
           "OSM_LIVE_CLIENT_ID": "fake-id", "OSM_LIVE_CLIENT_SECRET": "fake-secret"}  # fmt: skip
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("OSM_WRITE_LIVE_APPROVED", raising=False)
    s = settings(monkeypatch, caplog)
    assert (s.osm_login_server, s.osm_write_server) == ("live", "")
