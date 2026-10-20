"""Publishing to OpenStreetMap (OSM lot 2, migration 016, lacarte.api.publish; the
synchronisation of 16/10, migration 022, lacarte.api.sync): choosing it (POST /api/osm/sync,
the write flow and its callback, the consent day), going back, the account deleted, what
GET /api/osm/sync says, and what the job's passes send — the answers' tags, the selection's
rules, the conflicts — against a fake OSM on 127.0.0.1 (tests/fakeosm.py; never
openstreetmap.org)."""

import base64
import csv
import io
import json
import logging
import xml.etree.ElementTree as ET
from datetime import date
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import fakeosm
import psycopg
import pytest
import sessions
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sessions import ORIGIN

from lacarte.api import app as api
from lacarte.api import auth, osm, publish, sync

JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
SUB = 4343
PASSWORD = "a fictitious password"
KEY = bytes(range(32))
THEN = "/?ui=punk&s=compte"


@pytest.fixture(scope="module")
def fake():
    f = fakeosm.FakeOsm()
    yield f
    f.close()


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app, follow_redirects=False) as c:
        yield c


def write_to(monkeypatch, url: str, server: str = "dev") -> None:
    s = api.settings
    monkeypatch.setattr(s, "osm_write_server", server)
    monkeypatch.setattr(s, "osm_write_url", url)
    monkeypatch.setattr(s, "osm_write_client_id", fakeosm.CLIENT_ID)
    monkeypatch.setattr(s, "osm_write_client_secret", fakeosm.CLIENT_SECRET)
    monkeypatch.setattr(s, "osm_token_key", KEY)


@pytest.fixture(autouse=True)
def on(monkeypatch, client, fake, pg_dsn):
    """Sign-in and publishing on, both on the fake as the test server; fresh flows; argon2
    at a test cost; no cookie kept; this file's accounts gone."""
    fake.reset()
    s = api.settings
    monkeypatch.setattr(s, "osm_url", fake.url)
    monkeypatch.setattr(s, "osm_client_id", fakeosm.CLIENT_ID)
    monkeypatch.setattr(s, "osm_client_secret", fakeosm.CLIENT_SECRET)
    monkeypatch.setattr(s, "osm_login_server", "dev")
    monkeypatch.setattr(s, "cookie_secure", False)
    write_to(monkeypatch, fake.url)
    monkeypatch.setattr(osm, "flows", osm.Waiting())
    monkeypatch.setattr(osm, "_jwks", {})
    monkeypatch.setattr(auth, "hasher", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
    monkeypatch.setattr(auth, "_dummy", None)
    monkeypatch.setattr(sync, "backoff", sync.Backoff())
    for k in ("osm_live_write_url", "osm_live_write_client_id", "osm_live_write_client_secret"):
        monkeypatch.setattr(s, k, "")
    auth.throttle.clear()
    client.cookies.clear()
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE pseudonym ~ '^pub'")
        conn.execute("UPDATE site_settings SET value = (key <> 'osm_write_live')")
    api.switches.forget()
    yield
    client.cookies.clear()


def make(dsn, name, *, password=True, osm_id=None, osm_server="dev", test=False) -> str:
    with psycopg.connect(dsn, autocommit=True) as conn:
        return conn.execute(
            "INSERT INTO accounts (pseudonym, password_hash, created_month, osm_id, osm_server,"
            " test) VALUES (%s, %s, date_trunc('month', current_date), %s, %s, %s)"
            " RETURNING id::text",
            (name, auth.hash_password(PASSWORD) if password else None, osm_id,
             osm_server if osm_id else None, test),
        ).fetchone()[0]  # fmt: skip


def session_of(dsn, aid) -> str:
    with psycopg.connect(dsn, autocommit=True) as conn:
        return auth.open_session(conn, aid, date.today())


def signed(token: str) -> dict:
    return {"Cookie": f"session={token}", **JSON}


def location(r) -> str:
    assert r.status_code == 302, (r.status_code, r.text)
    return r.headers["location"]


def query(url: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def enable(client, token, password=PASSWORD, then=THEN):
    """« Publier aussi sur OpenStreetMap en mon nom »."""
    return client.post("/api/osm/sync", json={"on": True, "password": password, "then": then},
                       headers=signed(token))  # fmt: skip


def stay(client, token):
    """« Rester sur Surveillance World »."""
    return client.post("/api/osm/sync", json={"on": False}, headers=signed(token))


def synced(client, token) -> dict:
    r = client.get("/api/osm/sync", headers=signed(token))
    assert r.status_code == 200, r.text
    return r.json()


def back(client, grant=None, **params):
    params = params or {"code": grant["code"], "state": grant["state"]}
    return client.get("/api/osm/callback", params=params)


def write_on(client, fake, token, sub=SUB, password=PASSWORD):
    """« Publier en mon nom sur OpenStreetMap », the person agrees on OSM's page."""
    r = enable(client, token, password)
    assert r.status_code == 200, r.text
    return back(client, fake.authorize(r.json()["url"], sub))


def stored(dsn, aid):
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT server, osm_uid, token, since_month, consent_day"
                            " FROM osm_write WHERE account_id = %s", (aid,)).fetchone()  # fmt: skip


def me(client, token) -> dict:
    return client.get("/api/me", headers=signed(token)).json()


# --- choosing to publish --------------------------------------------------------------------


def test_status_says_where_it_writes(client, fake):
    assert client.get("/api/osm/status").json() == {
        "login": True, "server": "dev", "write": True, "write_server": "dev",
        "write_url": fake.url}  # fmt: skip


def test_enable_starts_a_write_flow_on_the_write_server(client, fake, pg_dsn):
    aid = make(pg_dsn, "pub-a")
    r = enable(client, session_of(pg_dsn, aid))
    assert r.status_code == 200 and "osm-flow" in r.headers["set-cookie"]
    url = r.json()["url"]
    assert url.startswith(fake.url + "/oauth2/authorize?")
    q = query(url)
    assert q["scope"] == "openid write_api" and q["code_challenge_method"] == "S256"
    assert q["redirect_uri"] == ORIGIN + "/api/osm/callback"
    flow = osm.flows.get(q["state"])
    assert (flow.kind, flow.account, flow.server, flow.then) == ("write", aid, "dev", THEN)


def test_signing_in_asks_openid_only_and_publishing_openid_write_api(client, fake, pg_dsn):
    """Signing in and linking ask OSM for `openid` and nothing else (no right to write);
    only choosing to publish asks `write_api`, with `openid` (the id_token names the OSM
    user the token belongs to: enable_write refuses another one)."""
    assert (osm.SCOPE, publish.WRITE_SCOPE) == ("openid", "openid write_api")
    token = session_of(pg_dsn, make(pg_dsn, "pub-a"))
    urls = {
        "login": location(client.get("/api/osm/login")),
        "link": client.post("/api/osm/link", json={"password": PASSWORD},
                            headers=signed(token)).json()["url"],
        "write": enable(client, token).json()["url"],
    }  # fmt: skip
    scopes = {kind: parse_qs(urlsplit(url).query)["scope"] for kind, url in urls.items()}
    assert scopes == {"login": ["openid"], "link": ["openid"], "write": ["openid write_api"]}


def test_enable_asks_the_password_of_an_account_that_has_one(client, pg_dsn):
    token = session_of(pg_dsn, make(pg_dsn, "pub-a"))
    for password in ("not it", None):
        r = enable(client, token, password)
        assert (r.status_code, r.json()) == (401, {"error": "credentials"})
        assert "osm-flow" not in r.headers.get("set-cookie", "")
    only_osm = session_of(pg_dsn, make(pg_dsn, "pub-osm", password=False, osm_id=SUB))
    assert enable(client, only_osm, None).status_code == 200


def test_a_test_account_never_publishes(client, pg_dsn):
    token = session_of(pg_dsn, make(pg_dsn, "pub-test", test=True))
    r = enable(client, token)
    assert (r.status_code, r.json()) == (409, {"error": "test_account"})


def test_the_callback_keeps_the_token_sealed_and_does_not_revoke_it(client, fake, pg_dsn):
    aid = make(pg_dsn, "pub-a")
    token = session_of(pg_dsn, aid)
    assert me(client, token)["publish"] is False
    r = write_on(client, fake, token)
    assert location(r) == THEN + "&osm=write_on"
    assert "session=" not in r.headers.get("set-cookie", "")  # no new session
    assert fake.revoked == [] and len(fake.issued) == 1
    server, uid, sealed, since, consent = stored(pg_dsn, aid)
    assert (server, uid, since, consent) == ("dev", SUB, date.today().replace(day=1),
                                             date.today())  # fmt: skip
    assert fake.issued[0].encode() not in bytes(sealed)
    assert publish.unseal(KEY, aid, "dev", sealed) == fake.issued[0]
    assert me(client, token)["sync"] is True and me(client, token)["publish"] is True
    s = synced(client, token)
    assert (s["offered"], s["on"], s["since"], s["server"], s["last_error"]) == (
        True, True, date.today().strftime("%Y-%m"), "dev", None)  # fmt: skip


def test_without_write_api_the_token_is_revoked_and_nothing_kept(client, fake, pg_dsn):
    aid = make(pg_dsn, "pub-a")
    fake.token_scope = "openid"
    r = write_on(client, fake, session_of(pg_dsn, aid))
    assert location(r) == THEN + "&osm=write_failed&osm_why=droits"
    assert fake.revoked == fake.issued and len(fake.issued) == 1
    assert stored(pg_dsn, aid) is None


def test_a_token_the_database_could_not_keep_is_revoked(client, fake, pg_dsn, monkeypatch):
    """A valid write token never stays at OSM unknown to us."""
    from lacarte.api import app as api

    def down(*_args):
        raise psycopg.OperationalError("database down")

    aid = make(pg_dsn, "pub-a")
    monkeypatch.setattr(api, "keep_write", down)
    r = write_on(client, fake, session_of(pg_dsn, aid))
    assert location(r) == THEN + "&osm=write_failed&osm_why=compte"
    assert fake.revoked == fake.issued and len(fake.issued) == 1


def test_a_token_response_without_scope_is_judged_by_osm_s_permissions(client, fake, pg_dsn):
    """RFC 6749 §5.1: `scope` may be left out when it is what was asked; OSM's list of the
    token's permissions decides then."""
    aid = make(pg_dsn, "pub-a")
    fake.omit_scope = True
    r = write_on(client, fake, session_of(pg_dsn, aid))
    assert location(r) == THEN + "&osm=write_on"
    assert fake.revoked == [] and stored(pg_dsn, aid) is not None
    assert ("GET", "/api/0.6/permissions.json") in fake.requests


def test_a_token_osm_does_not_let_write_is_revoked_and_nothing_kept(client, fake, pg_dsn):
    """« Modify the map » unticked on OSM's page: the permissions lack allow_write_api."""
    aid = make(pg_dsn, "pub-a")
    fake.permissions = ["allow_read_prefs"]
    r = write_on(client, fake, session_of(pg_dsn, aid))
    assert location(r) == THEN + "&osm=write_failed&osm_why=droits"
    assert fake.revoked == fake.issued and len(fake.issued) == 1
    assert stored(pg_dsn, aid) is None


def test_osm_down_when_asked_the_rights_is_the_network_not_the_rights(client, fake, pg_dsn):
    """Review finding: a 5xx from /api/0.6/permissions is no answer about the rights."""
    aid = make(pg_dsn, "pub-a")
    fake.permissions_status = 503
    r = write_on(client, fake, session_of(pg_dsn, aid))
    assert location(r) == THEN + "&osm=write_failed&osm_why=reseau"
    assert fake.revoked == fake.issued and len(fake.issued) == 1
    assert stored(pg_dsn, aid) is None


def test_another_osm_user_than_the_linked_one_is_refused(client, fake, pg_dsn):
    """Linked to an OSM user on the write server: only that user publishes for it."""
    aid = make(pg_dsn, "pub-a", osm_id=SUB + 1)
    token = session_of(pg_dsn, aid)
    assert location(write_on(client, fake, token)) == THEN + "&osm=write_other"
    assert fake.revoked == fake.issued and stored(pg_dsn, aid) is None
    assert location(write_on(client, fake, token, sub=SUB + 1)).endswith("osm=write_on")
    assert stored(pg_dsn, aid)[1] == SUB + 1
    # Linked on the other server: its users are numbered apart, nothing to compare.
    other = make(pg_dsn, "pub-b", osm_id=SUB + 1, osm_server="live")
    assert location(write_on(client, fake, session_of(pg_dsn, other))).endswith("osm=write_on")
    assert stored(pg_dsn, other)[1] == SUB


def test_a_new_token_revokes_the_one_it_replaces(client, fake, pg_dsn):
    """Renewing a token she still has keeps her consent day and forgets the refusals;
    choosing again after OSM refused her token starts a new consent day."""
    aid = make(pg_dsn, "pub-a")
    token = session_of(pg_dsn, aid)
    write_on(client, fake, token)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE osm_write SET consent_day = '2026-10-02', last_error = 'blocked',"
                     " failures = 2 WHERE account_id = %s", (aid,))  # fmt: skip
    write_on(client, fake, token)
    first, second = fake.issued
    assert fake.revoked == [first]
    assert publish.unseal(KEY, aid, "dev", stored(pg_dsn, aid)[2]) == second
    assert stored(pg_dsn, aid)[4] == date(2026, 10, 2)
    assert synced(client, token)["last_error"] is None
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE osm_write SET token = NULL, last_error = 'revoked'"
                     " WHERE account_id = %s", (aid,))  # fmt: skip
    s = synced(client, token)
    assert (s["on"], s["since"], s["last_error"]) == (False, None, "revoked")
    assert me(client, token)["sync"] is False
    write_on(client, fake, token)
    assert stored(pg_dsn, aid)[4] == date.today() and synced(client, token)["on"] is True


def test_a_refusal_or_an_error_on_osm_s_side(client, fake, pg_dsn):
    aid = make(pg_dsn, "pub-a")
    token = session_of(pg_dsn, aid)
    for error, status in (("access_denied", "denied"),
                          ("server_error", "write_failed&osm_why=refus_osm")):  # fmt: skip
        state = query(enable(client, token).json()["url"])["state"]
        assert location(back(client, error=error, state=state)) == THEN + f"&osm={status}"
    fake.tamper = lambda claims, header: claims.update(nonce="another")
    assert location(write_on(client, fake, token)).endswith("osm=write_failed&osm_why=id_token")
    assert fake.revoked == fake.issued and len(fake.issued) == 1
    assert stored(pg_dsn, aid) is None


def test_a_write_callback_in_another_browser_leads_nowhere(client, fake, pg_dsn):
    aid = make(pg_dsn, "pub-a")
    grant = fake.authorize(enable(client, session_of(pg_dsn, aid)).json()["url"])
    client.cookies.clear()
    assert location(back(client, grant)) == THEN + "&osm=write_failed&osm_why=navigateur"
    assert fake.tokens == [] and stored(pg_dsn, aid) is None


def test_an_account_disabled_meanwhile_keeps_no_token(client, fake, pg_dsn):
    aid = make(pg_dsn, "pub-a")
    r = enable(client, session_of(pg_dsn, aid))
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (aid,))
    back_to = location(back(client, fake.authorize(r.json()["url"], SUB)))
    assert back_to.endswith("write_failed&osm_why=compte")
    assert fake.revoked == fake.issued and stored(pg_dsn, aid) is None


# --- going back, deleting the account ------------------------------------------------------


def test_staying_on_surveillance_world_revokes_and_deletes(client, fake, pg_dsn):
    """Always possible: also while contributions are closed, or publishing is no longer
    offered (the token then deleted here, revoked by the server that issued it)."""
    aid = make(pg_dsn, "pub-a")
    token = session_of(pg_dsn, aid)
    write_on(client, fake, token)
    r = stay(client, token)
    assert r.status_code == 200 and (r.json()["on"], r.json()["since"]) == (False, None)
    assert fake.revoked == fake.issued and stored(pg_dsn, aid) is None
    assert me(client, token)["sync"] is False
    again = stay(client, token)
    assert again.status_code == 200 and len(fake.revoked) == 1
    write_on(client, fake, token)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = false WHERE key = 'contributions_open'")
    api.switches.forget()
    try:
        r = enable(client, token)
        assert (r.status_code, r.json()) == (403, {"error": "closed"})
        assert stay(client, token).status_code == 200 and stored(pg_dsn, aid) is None
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("UPDATE site_settings SET value = true WHERE key = 'contributions_open'")
        api.switches.forget()


def test_deleting_the_account_revokes_its_write_token(client, fake, pg_dsn):
    aid = make(pg_dsn, "pub-a")
    token = session_of(pg_dsn, aid)
    write_on(client, fake, token)
    r = client.post("/api/me/delete", json={"password": PASSWORD}, headers=signed(token))
    assert r.status_code == 204
    assert fake.revoked == fake.issued and stored(pg_dsn, aid) is None


def test_a_token_of_another_server_is_deleted_not_sent_there(client, fake, pg_dsn, monkeypatch,
                                                             caplog):  # fmt: skip
    """Written on the test server, the API now writing elsewhere: deleted here, never sent
    to a server it was not issued by (said by class)."""
    aid = make(pg_dsn, "pub-a")
    token = session_of(pg_dsn, aid)
    write_on(client, fake, token)
    other = fakeosm.FakeOsm()
    try:
        write_to(monkeypatch, other.url, "live")
        with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
            r = stay(client, token)
        assert r.status_code == 200 and stored(pg_dsn, aid) is None
        assert other.requests == [] and fake.revoked == []
        assert [m.getMessage() for m in caplog.records] == ["osm revoke skipped: server"]
    finally:
        other.close()


# --- off ----------------------------------------------------------------------------------


@pytest.mark.parametrize("off", [
    {"osm_token_key": None}, {"osm_write_server": ""}, {"osm_write_client_secret": ""},
    {"osm_write_url": ""},
], ids=["no-key", "no-server", "no-client", "no-url"])  # fmt: skip
def test_writing_off_offers_nothing_and_asks_osm_nothing(client, fake, pg_dsn, monkeypatch, off):
    """Choosing to publish answers 503; GET says offered false with nothing; staying on
    Surveillance World still works; the job calls nobody."""
    for k, v in off.items():
        monkeypatch.setattr(api.settings, k, v)
    status = client.get("/api/osm/status").json()
    assert (status["write"], status["write_server"], status["write_url"]) == (False, None, None)
    assert client.get("/api/config").json()["sync"] is False
    token = session_of(pg_dsn, make(pg_dsn, "pub-a"))
    r = enable(client, token)
    assert (r.status_code, r.json()) == (503, {"error": "osm_unavailable"})
    s = synced(client, token)
    assert (s["offered"], s["on"], s["server"], s["url"], s["history"]) == (
        False, False, None, None, [])  # fmt: skip
    assert stay(client, token).status_code == 200
    assert me(client, token)["sync"] is False
    assert api.sync_once()["state"] == "not_offered"
    assert fake.requests == []


def test_the_manual_publication_s_routes_are_gone(client, pg_dsn):
    token = session_of(pg_dsn, make(pg_dsn, "pub-a"))
    gone = (("POST", "/api/osm/publish/enable"), ("POST", "/api/osm/publish/disable"),
            ("GET", "/api/osm/publish/pending"), ("POST", "/api/osm/publish"))  # fmt: skip
    for method, path in gone:
        r = client.request(method, path, json={}, headers=signed(token))
        assert r.status_code in (404, 405), path


def test_a_write_flow_s_callback_needs_publishing_on(client, fake, pg_dsn, monkeypatch):
    aid = make(pg_dsn, "pub-a")
    grant = fake.authorize(enable(client, session_of(pg_dsn, aid)).json()["url"])
    monkeypatch.setattr(api.settings, "osm_token_key", None)
    assert location(back(client, grant)) == THEN + "&osm=write_failed&osm_why=flux_serveur"
    assert fake.tokens == [] and stored(pg_dsn, aid) is None


def test_nothing_identifying_in_the_logs(client, fake, pg_dsn, caplog):
    aid = make(pg_dsn, "pub-a")
    token = session_of(pg_dsn, aid)
    fake.revoke_status = 503
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        write_on(client, fake, token)
        write_on(client, fake, token)  # revokes the first: refused by the fake
        stay(client, token)
    messages = [r.getMessage() for r in caplog.records]
    assert messages == ["osm revoke failed: HTTPError"] * 2
    for secret in (*fake.issued, str(SUB), aid, base64.b64encode(KEY).decode()):
        assert secret not in caplog.text


# --- what a pass sends (lacarte.api.sync over publish.send) ----------------------------------

DAY = date(2026, 10, 9)
AT = (2.2400, 48.8920)  # La Défense, in the CI build's region


def sent_at(item) -> tuple[float, float]:
    """Where an item's node goes, as the OsmChange writes it (publish.fmt: OSM keeps 7
    decimals): the position read back from the database (stored in Lambert-93, turned back
    into degrees) may differ beyond them with the PROJ version."""
    return (float(publish.fmt(item.lon)), float(publish.fmt(item.lat)))


CONSENT = date(2026, 10, 1)  # before every DAY of this file


@pytest.fixture
def clean(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
        conn.execute("DELETE FROM osm_nodes")
    yield
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
        conn.execute("DELETE FROM osm_nodes")


def enabled(dsn, fake, aid, server="dev", consent=CONSENT) -> str:
    """The account chose to publish on `server` on `consent`, with a token the fake issued
    with write_api: its session."""
    token = f"write-token-{uuid4().hex}"
    fake.issued.append(token)
    fake.granted[token] = "openid write_api"
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_write (account_id, server, osm_uid, token, since_month,"
                     " consent_day) VALUES (%s, %s, %s, %s, %s, %s)",
                     (aid, server, SUB, publish.seal(KEY, aid, server, token),
                      consent.replace(day=1), consent))  # fmt: skip
    return session_of(dsn, aid)


def put(dsn, author, kind, camera, *, answer=None, direction=None, name=None,
        status="applied", on_site=True, day=DAY, seq=None, osm=None, tags=None,
        target=None, at=AT, old=None, held=None, uid=None, chosen=True) -> str:  # fmt: skip
    """A contribution as the API and the review left it (written as the owner); `chosen`:
    received while its author had chosen to publish (sync_chosen)."""
    uid = uid or str(uuid4())
    if kind == "add":
        camera = "c" + uid.replace("-", "")[:12]
    osm_type, osm_id, version = osm or (None, None, None)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
            " build_id, author_id, day, on_site, answer, target, geom, payload,"
            " body_sha256, direction_deg, operator_name, osm_tags, status, decision_seq,"
            " apply_detail, sync_chosen) VALUES (%s, %s, %s, %s, %s, %s, 'b', %s, %s, %s, %s,"
            " %s, ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 2154), %s, 'x', %s,"
            " %s, %s, %s, %s, %s, %s)",
            (uid, kind, camera, osm_type, osm_id, version, author, day, on_site, answer, target,
             *at, json.dumps({"old": old} if old else {}), direction, name,
             json.dumps(tags or {}), status, seq,
             json.dumps({"osm_version": held}) if held else None, chosen),
        )  # fmt: skip
    return uid


def added(dsn, author, **kw) -> tuple[str, str]:
    """An add: (uuid, camera id)."""
    uid = put(dsn, author, "add", "", **kw)
    return uid, "c" + uid.replace("-", "")[:12]


def on_add(dsn, author, add, kind, **kw) -> str:
    """An answer on an added camera: it points at the add."""
    return put(dsn, author, kind, "c" + add.replace("-", "")[:12], target=add, **kw)


def osm_cameras(dsn, n=2) -> list[tuple]:
    """Node cameras of the CI build without a direction: (id, osm (type, id, version), tags,
    (lon, lat))."""
    with psycopg.connect(dsn) as conn:
        rows = conn.execute(
            "SELECT camera_id, osm_id, osm_version, tags, ST_X(ST_Transform(geom, 4326)),"
            " ST_Y(ST_Transform(geom, 4326)) FROM cameras WHERE osm_type = 'n'"
            " AND NOT tags ? 'camera:direction' AND NOT tags ? 'camera:type'"
            " ORDER BY camera_id LIMIT %s", (n,)).fetchall()  # fmt: skip
    return [(c, ("n", i, v), t, (x, y)) for c, i, v, t, x, y in rows]


def items(dsn, aid, server="dev") -> list[publish.Item]:
    """What may leave for the account, from its consent day (what a pass would send)."""
    with psycopg.connect(dsn) as conn:
        row = conn.execute("SELECT consent_day FROM osm_write WHERE account_id = %s",
                           (aid,)).fetchone()  # fmt: skip
        return publish.selection(conn, aid, server, row[0] if row else None)[0]


def listed(dsn, aid, server="dev") -> dict[str, list[str]]:
    """camera -> the uuids that may leave for it."""
    return {i.camera: [c.uuid for c in i.contributions] for i in items(dsn, aid, server)}


def tags_of(item: publish.Item) -> dict[str, str]:
    out = {}
    for c in item.contributions:
        out.update(c.tags)
    return out


def publications(dsn) -> dict[str, tuple]:
    with psycopg.connect(dsn) as conn:
        return {u: tuple(rest) for u, *rest in conn.execute(
            "SELECT uuid::text, server, state, reason, changeset"
            " FROM osm_publications")}  # fmt: skip


def nodes(dsn) -> dict[tuple[str, str], tuple[int, int]]:
    with psycopg.connect(dsn) as conn:
        return {(s, c): (n, v) for s, c, n, v in conn.execute("SELECT * FROM osm_nodes")}


def change(fake, cid) -> ET.Element:
    (body,) = fake.changesets[cid]["uploads"]
    return ET.fromstring(body)


def node_tags(element) -> dict:
    return {t.get("k"): t.get("v") for t in element.iter("tag")}


def sync_pass(fake, dsn) -> dict:
    """One pass of the job, said as the manual publication said it: the changeset it opened
    (None), its address, what it published (or found OSM had already) and its conflicts;
    with the pass's own counts (`pass`)."""
    before, opened = publications(dsn), set(fake.changesets)
    summary = api.sync_once()
    after = publications(dsn)
    now = {u: p for u, p in after.items() if before.get(u) != p}
    new = sorted(set(fake.changesets) - opened)
    cid = new[-1] if new else None
    return {
        "changeset": cid, "url": f"{fake.url}/changeset/{cid}" if cid else None,
        "published": sorted(u for u, p in now.items() if p[1] == "published"),
        "conflicts": sorted(({"uuid": u, "reason": p[2]} for u, p in now.items()
                             if p[1] == "conflict"), key=lambda c: c["uuid"]),
        "pass": summary,
    }  # fmt: skip


def forgive(dsn) -> None:
    """The refusals in a row and the day's changesets forgotten (here and in the job's
    memory): the next pass tries again."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE osm_write SET failures = 0, last_error = NULL, sent_n = 0")
    sync.backoff.until.clear()


COMMENT = " #SurveillanceWorld https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Surveillance_World"


def test_an_add_and_its_answers_go_as_one_new_node(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    token = enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    shape = on_add(pg_dsn, aid, add, "shape", answer="bullet")
    aim = on_add(pg_dsn, aid, add, "direction", direction=135)
    high = on_add(pg_dsn, aid, add, "height", answer="first")  # never leaves (publish.yaml v2)
    who = on_add(pg_dsn, aid, add, "operator", answer="business", name="Monoprix")
    tilt = on_add(pg_dsn, aid, add, "tilt", answer="steep")  # never leaves
    (item,) = items(pg_dsn, aid)
    assert (item.camera, item.node, item.action, sent_at(item)) == (cam, None, "create", AT)
    assert [c.uuid for c in item.contributions] == [add, shape, aim, who]
    assert (item.kind, item.operator) == ("fixed", "Monoprix")

    seen = []

    def before_upload(_body):  # the rows say `sending` before OSM sees the upload
        seen.append({u: s[1] for u, s in publications(pg_dsn).items()})

    fake.on_upload = before_upload
    out = sync_pass(fake, pg_dsn)
    cid = out["changeset"]
    assert (out["published"], out["conflicts"]) == (sorted([add, shape, aim, who]), [])
    assert seen == [dict.fromkeys([add, shape, aim, who], "sending")]
    assert fake.changesets[cid]["tags"] == {
        "source": "survey", "hashtags": "#SurveillanceWorld",
        "created_by": "Surveillance World dev",
        "description": "https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Surveillance_World",
        "comment": "Caméras de surveillance relevées sur place : 1 ajout, 1 forme, 1 direction,"
                   " 1 exploitant" + COMMENT}  # fmt: skip
    assert fake.changesets[cid]["open"] is False  # closed
    root = change(fake, cid)
    assert [b.tag for b in root] == ["create"] and root.get("generator") == "SurveillanceWorld/dev"
    (created,) = root.iter("node")
    assert (created.get("id"), created.get("changeset")) == ("-1", str(cid))
    assert (created.get("lon"), created.get("lat")) == ("2.2400000", "48.8920000")
    assert node_tags(created) == {
        "man_made": "surveillance", "surveillance:type": "camera", "surveillance": "outdoor",
        "camera:type": "fixed", "camera:direction": "135", "operator:type": "private",
        "operator": "Monoprix"}  # fmt: skip
    new_id = fake.next_node
    assert nodes(pg_dsn) == {("dev", cam): (new_id, 1)}
    assert {u: s[1:] for u, s in publications(pg_dsn).items()} == dict.fromkeys(
        [add, shape, aim, who], ("published", None, cid))  # fmt: skip
    assert items(pg_dsn, aid) == []
    assert tilt not in publications(pg_dsn) and high not in publications(pg_dsn)
    assert all(ua == "SurveillanceWorld/dev" for ua in fake.user_agents)
    history = {h["uuid"]: h for h in synced(client, token)["history"]}
    said = {u: (h["state"], h["changeset"], h["month"]) for u, h in history.items()}
    month = date.today().strftime("%Y-%m")
    assert said == dict.fromkeys([add, shape, aim, who], ("gone", cid, month))
    assert history[add]["label"]["add"] is True and history[add]["status"] == "applied"

    # A later answer: a real <modify> of the node we created, all its tags and its version.
    later = on_add(pg_dsn, aid, add, "verify", answer="present", day=date(2026, 10, 10))
    (item,) = items(pg_dsn, aid)
    assert (item.action, item.node, tags_of(item)) == ("modify", new_id,
                                                       {"check_date": "2026-10-10"})  # fmt: skip
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == [later]
    (modified,) = change(fake, out["changeset"]).iter("node")
    assert change(fake, out["changeset"])[0].tag == "modify"
    assert (modified.get("id"), modified.get("version")) == (str(new_id), "1")
    assert node_tags(modified) == {**fake.nodes[new_id]["tags"], "check_date": "2026-10-10"}
    assert len(node_tags(modified)) == 8
    assert nodes(pg_dsn) == {("dev", cam): (new_id, 2)}


def test_a_small_dome_s_tilt_never_leaves(client, fake, pg_dsn, clean):
    """Questions@5 asks a small dome's tilt; publish.yaml `answers` still sends no tilt
    (a class, not the measure camera:angle is): the dome leaves without camera:angle."""
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    shape = on_add(pg_dsn, aid, add, "shape", answer="dome")
    on_add(pg_dsn, aid, add, "height", answer="first")
    tilt = on_add(pg_dsn, aid, add, "tilt", answer="steep")
    assert listed(pg_dsn, aid) == {cam: [add, shape]}
    out = sync_pass(fake, pg_dsn)
    (created,) = change(fake, out["changeset"]).iter("node")
    assert node_tags(created)["camera:type"] == "dome"
    assert "camera:angle" not in node_tags(created) and tilt not in publications(pg_dsn)


def test_what_may_leave_and_what_never_does(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    other = make(pg_dsn, "pub-b")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    kept = on_add(pg_dsn, aid, add, "verify", answer="present")
    # Never: another status, not on site, no answer, what never leaves.
    for status in ("pending", "validated", "rejected", "withdrawn", "superseded", "conflict"):
        on_add(pg_dsn, aid, add, "shape", answer="dome", status=status, day=date(2026, 10, 10))
    on_add(pg_dsn, aid, add, "direction", direction=10, on_site=False)
    on_add(pg_dsn, aid, add, "direction", direction=20, on_site=None)
    on_add(pg_dsn, aid, add, "height", answer="first")
    on_add(pg_dsn, aid, add, "operator", answer="public")  # no name: nothing to send
    on_add(pg_dsn, aid, add, "tilt", answer="steep")
    on_add(pg_dsn, aid, add, "verify", answer="not_found", day=date(2026, 10, 1))
    on_add(pg_dsn, aid, add, "shape", answer="unknown", day=date(2026, 10, 11))
    on_add(pg_dsn, other, add, "direction", direction=30)  # someone else's
    assert listed(pg_dsn, aid) == {cam: [add, kept]}
    # A household answer, anyone's, not rejected nor withdrawn: nothing of the camera.
    house = on_add(pg_dsn, other, add, "operator", answer="household", status="pending")
    assert listed(pg_dsn, aid) == {}
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'rejected' WHERE uuid = %s", (house,))
    assert listed(pg_dsn, aid) == {cam: [add, kept]}


def test_only_what_a_build_applied_leaves(client, fake, pg_dsn, clean):
    """2026-10-11: an add the review accepted but no build applied has not been through the
    build's duplicate check: it leaves once the deploy made it `applied`."""
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid, status="validated")
    seen = on_add(pg_dsn, aid, add, "verify", answer="present", status="validated")
    assert listed(pg_dsn, aid) == {}
    assert sync_pass(fake, pg_dsn)["pass"]["accounts"] == 0 and fake.requests == []
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'applied' WHERE uuid = ANY(%s)",
                     ([add, seen],))  # fmt: skip
    assert listed(pg_dsn, aid) == {cam: [add, seen]}


def test_only_what_was_made_on_site_leaves(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    on_add(pg_dsn, aid, add, "direction", direction=10, on_site=False)
    on_add(pg_dsn, aid, add, "shape", answer="dome", on_site=None)
    added(pg_dsn, aid, on_site=False, at=(2.2410, 48.8925))
    assert listed(pg_dsn, aid) == {cam: [add]}
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == [add]
    (created,) = change(fake, out["changeset"]).iter("node")
    assert {"camera:direction", "camera:type"}.isdisjoint(node_tags(created))


def test_an_operator_name_proposed_leaves_only_as_typed(client, fake, pg_dsn, clean):
    """Migration 017: a typed name waits in operator_proposed; only the name the review
    kept as typed is sent, as operator= (rule exact: a name it chose from the list, or
    dropped, keeps the whole answer here)."""
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    who = on_add(pg_dsn, aid, add, "operator", answer="business")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET operator_proposed = 'Boulangerie Dupont'"
                     " WHERE uuid = %s", (who,))  # fmt: skip

    def tags() -> dict:
        (item,) = items(pg_dsn, aid)
        return tags_of(item)

    # Applied without a choice (validated by peers, say): the class only.
    assert tags()["operator:type"] == "private" and "operator" not in tags()
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET operator_choice = 'none' WHERE uuid = %s", (who,))
    assert "operator:type" not in tags()
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET operator_choice = 'proposed',"
                     " operator_name = operator_proposed WHERE uuid = %s", (who,))  # fmt: skip
    assert tags()["operator"] == "Boulangerie Dupont"


def test_only_the_latest_answer_per_question_counts(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    on_add(pg_dsn, aid, add, "shape", answer="dome", day=date(2026, 10, 1))
    newer = on_add(pg_dsn, aid, add, "shape", answer="bullet", day=date(2026, 10, 2))
    # The same day: the review's later decision wins.
    on_add(pg_dsn, aid, add, "operator", answer="business", seq=5)
    first = on_add(pg_dsn, aid, add, "operator", answer="public", name="Ville de Puteaux", seq=2)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET decision_seq = 9 WHERE uuid = %s", (first,))
    # A height never leaves (publish.yaml v2): no camera:mount, whatever the class.
    on_add(pg_dsn, aid, add, "height", answer="first", day=date(2026, 10, 1))
    on_add(pg_dsn, aid, add, "height", answer="upper", day=date(2026, 10, 3))
    on_add(pg_dsn, aid, add, "direction", direction=90, day=date(2026, 10, 1))
    on_add(pg_dsn, aid, add, "direction", direction=95, day=date(2026, 10, 2), on_site=False)
    # « Je ne sais pas » says nothing: the older real answer stays.
    on_add(pg_dsn, aid, add, "verify", answer="present", day=date(2026, 10, 1))
    (item,) = items(pg_dsn, aid)
    kinds = {c.kind: c.uuid for c in item.contributions}
    assert set(kinds) == {"add", "shape", "operator", "verify"}
    assert (kinds["shape"], kinds["operator"]) == (newer, first)
    tags = tags_of(item)
    assert (tags["camera:type"], tags["operator"]) == ("fixed", "Ville de Puteaux")
    assert "operator:type" not in tags and "camera:mount" not in tags


def test_someone_else_s_add_waits_for_its_node(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    other = make(pg_dsn, "pub-b")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, other)
    mine = on_add(pg_dsn, aid, add, "direction", direction=200)
    assert listed(pg_dsn, aid) == {}
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_nodes VALUES ('dev', %s, 777, 3)", (cam,))
    (item,) = items(pg_dsn, aid)
    assert (item.action, item.node, [c.uuid for c in item.contributions]) == ("modify", 777, [mine])
    assert items(pg_dsn, aid, "live") == []  # not created on the live server: nothing there


def test_osm_cameras_are_elsewhere_on_the_test_server_and_ways_never(client, fake, pg_dsn,
                                                                     clean):  # fmt: skip
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    ((cam, osm_ref, tags, at),) = osm_cameras(pg_dsn, 1)
    put(pg_dsn, aid, "shape", cam, answer="dome", osm=osm_ref, tags=tags, at=at)
    put(pg_dsn, aid, "verify", cam, answer="present", osm=osm_ref, tags=tags, at=at)
    put(pg_dsn, aid, "shape", "w42", answer="dome", osm=("w", 42, 1))
    with psycopg.connect(pg_dsn) as conn:
        assert publish.selection(conn, aid, "dev") == ([], 2)
        found, elsewhere = publish.selection(conn, aid, "live")
    assert ([i.camera for i in found], elsewhere) == ([cam], 0)


def test_a_hidden_camera_a_disabled_or_test_account_have_nothing(client, fake, pg_dsn, clean):
    """Lot 2: a camera an administrator hid leaves the selection as it leaves the map; a
    disabled (or suspended) account's selection is empty, a test account's too."""
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    seen = on_add(pg_dsn, aid, add, "verify", answer="present")
    assert listed(pg_dsn, aid) == {cam: [add, seen]}
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO hidden_cameras (camera_id) VALUES (%s)", (cam,))
        try:
            assert listed(pg_dsn, aid) == {}
        finally:
            conn.execute("DELETE FROM hidden_cameras WHERE camera_id = %s", (cam,))
        assert listed(pg_dsn, aid) == {cam: [add, seen]}
        conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (aid,))
        try:
            assert listed(pg_dsn, aid) == {}
        finally:
            conn.execute("UPDATE accounts SET disabled = false WHERE id = %s", (aid,))
    tester = make(pg_dsn, "pub-test", test=True)
    added(pg_dsn, tester, at=(2.2410, 48.8925))
    enabled(pg_dsn, fake, tester)
    assert listed(pg_dsn, tester) == {}


def test_only_what_was_observed_from_the_consent_day_leaves(client, fake, pg_dsn, clean):
    """Rule consent (migration 022): the consent day bounds the selection by the
    observation's day; the latest answer is taken first, so an older one does not leave in
    its place."""
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid, day=date(2026, 10, 9))
    seen = on_add(pg_dsn, aid, add, "verify", answer="present", day=date(2026, 10, 12))
    on_add(pg_dsn, aid, add, "shape", answer="dome", day=date(2026, 10, 9))
    on_add(pg_dsn, aid, add, "direction", direction=10, day=date(2026, 10, 12))
    on_add(pg_dsn, aid, add, "direction", direction=20, day=date(2026, 10, 11))

    def chosen(since):
        with psycopg.connect(pg_dsn) as conn:
            found, _ = publish.selection(conn, aid, "dev", since)
        return {i.camera: sorted(c.uuid for c in i.contributions) for i in found}

    assert set(chosen(None)[cam]) >= {add, seen}
    # From the 12th: the add is older, so nothing can be created; its answers wait for it.
    assert chosen(date(2026, 10, 12)) == {}
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_nodes VALUES ('dev', %s, 777, 1)", (cam,))
    (direction,) = [u for u in chosen(date(2026, 10, 12))[cam] if u != seen]
    assert set(chosen(date(2026, 10, 12))[cam]) == {seen, direction}
    assert chosen(date(2026, 10, 13)) == {}


def test_a_name_the_review_chose_or_dropped_never_leaves(client, fake, pg_dsn, clean):
    """Rule exact (the owner's condition 2): operator_choice listed or none keeps the
    contribution on Surveillance World, the class with it; proposed (kept as typed) leaves.
    GET /api/osm/sync says it: kept_edited."""
    aid = make(pg_dsn, "pub-a")
    token = enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    who = on_add(pg_dsn, aid, add, "operator", answer="business")
    for choice, name, leaves in (("listed", "Monoprix", False), ("none", None, False),
                                 ("proposed", "Chez Paul", True)):  # fmt: skip
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("UPDATE contributions SET operator_proposed = 'Chez Paul',"
                         " operator_choice = %s, operator_name = %s WHERE uuid = %s",
                         (choice, name, who))  # fmt: skip
        assert (who in listed(pg_dsn, aid)[cam]) is leaves, choice
        said = {h["uuid"]: h["state"] for h in synced(client, token)["history"]}
        assert said[who] == ("waiting" if leaves else "kept_edited"), choice


def test_an_osm_camera_near_an_add_stops_its_creation(client, fake, pg_dsn, clean):
    """Rule duplicate (the owner's condition 3): OSM read around the add before it is
    created; a camera within 5 m (not a guard) is a conflict osm_duplicate for the add and
    its answers, nothing created; one at 8 m, or a guard at 2 m, is no camera of it."""
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    aim = on_add(pg_dsn, aid, add, "direction", direction=90)
    north = 1 / 111_195  # a metre north, in degrees
    fake.node(1, AT[0], AT[1] + 8 * north, {"man_made": "surveillance"})
    fake.node(2, AT[0], AT[1] + 2 * north, {"man_made": "surveillance",
                                             "surveillance:type": "guard"})  # fmt: skip
    add2, _ = added(pg_dsn, aid, at=(2.2410, 48.8925))
    seen2 = on_add(pg_dsn, aid, add2, "verify", answer="present")
    fake.node(3, 2.2410, 48.8925 + 4 * north, {"man_made": "surveillance",
                                               "surveillance:type": "camera"})  # fmt: skip
    created = len(fake.nodes)
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == sorted([add, aim])
    assert out["conflicts"] == sorted([{"uuid": add2, "reason": "osm_duplicate"},
                                       {"uuid": seen2, "reason": "osm_duplicate"}],
                                      key=lambda c: c["uuid"])  # fmt: skip
    assert len(fake.nodes) == created + 1
    assert publications(pg_dsn)[add2] == ("dev", "conflict", "osm_duplicate", None)
    assert len(fake.maps) == 2  # one read around each add


def published_add(fake, pg_dsn, aid, **kw) -> tuple[str, str, int]:
    """An add of the person's, published by a pass: (add, camera, node id)."""
    add, cam = added(pg_dsn, aid, **kw)
    assert add in sync_pass(fake, pg_dsn)["published"]
    return add, cam, nodes(pg_dsn)[("dev", cam)][0]


def test_conflicts_on_our_own_node_by_version_and_by_value(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    token = enabled(pg_dsn, fake, aid)
    add, cam, node = published_add(fake, pg_dsn, aid)
    add2, cam2, node2 = published_add(fake, pg_dsn, aid, at=(2.2410, 48.8925))
    fake.edit(node, **{"camera:type": "dome", "check_date": "2026-10-20"})  # a mapper, since
    shape = on_add(pg_dsn, aid, add, "shape", answer="bullet")
    seen = on_add(pg_dsn, aid, add, "verify", answer="present")
    fake.nodes[node2]["tags"].update({"camera:type": "dome", "check_date": "2025-01-01"})
    shape2 = on_add(pg_dsn, aid, add2, "shape", answer="bullet")  # another value: osm_value
    seen2 = on_add(pg_dsn, aid, add2, "verify", answer="present")  # older check_date: sent
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == [seen2] and out["conflicts"] == sorted([
        {"uuid": shape, "reason": "osm_version"}, {"uuid": seen, "reason": "osm_version"},
        {"uuid": shape2, "reason": "osm_value"}], key=lambda c: c["uuid"])  # fmt: skip
    (sent,) = change(fake, out["changeset"]).iter("node")
    assert node_tags(sent)["check_date"] == "2026-10-09"
    assert node_tags(sent)["camera:type"] == "dome"  # never overwritten
    states = publications(pg_dsn)
    assert states[shape] == ("dev", "conflict", "osm_version", None)
    assert states[shape2] == ("dev", "conflict", "osm_value", None)
    assert states[seen2] == ("dev", "published", None, out["changeset"])
    assert items(pg_dsn, aid) == []  # a conflict goes to the review, never again
    said = {h["uuid"]: (h["state"], h["reason"]) for h in synced(client, token)["history"]}
    assert said[shape2] == ("conflict", "osm_value") and said[seen2] == ("gone", None)


def test_nothing_to_send_counts_as_published_without_a_changeset(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam, node = published_add(fake, pg_dsn, aid)
    fake.nodes[node]["tags"].update({"camera:type": "fixed", "check_date": "2026-10-30"})
    fake.nodes[node]["version"] = nodes(pg_dsn)[("dev", cam)][1]  # unchanged for us
    shape = on_add(pg_dsn, aid, add, "shape", answer="bullet")
    seen = on_add(pg_dsn, aid, add, "verify", answer="present")
    before = len(fake.changesets)
    out = sync_pass(fake, pg_dsn)
    assert (out["changeset"], out["published"], out["conflicts"]) == (None, sorted([shape, seen]),
                                                                      [])  # fmt: skip
    assert len(fake.changesets) == before
    assert {publications(pg_dsn)[u] for u in (shape, seen)} == {("dev", "published", None, None)}


def test_a_deleted_or_unknown_node_is_a_conflict(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, _, node = published_add(fake, pg_dsn, aid)
    add2, cam2, node2 = published_add(fake, pg_dsn, aid, at=(2.2410, 48.8925))
    fake.nodes[node]["deleted"] = True  # 410
    del fake.nodes[node2]  # 404
    on_add(pg_dsn, aid, add, "direction", direction=1)
    on_add(pg_dsn, aid, add2, "direction", direction=2)
    out = sync_pass(fake, pg_dsn)
    assert out["changeset"] is None and out["published"] == []
    assert {c["reason"] for c in out["conflicts"]} == {"osm_deleted"}


def test_an_upload_osm_refuses_writes_nothing(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, _, node = published_add(fake, pg_dsn, aid)
    fake.edit(node, note="x")
    stale = on_add(pg_dsn, aid, add, "direction", direction=1)  # a conflict, not written
    add2, _ = added(pg_dsn, aid, at=(2.2410, 48.8925))
    before = publications(pg_dsn)
    for status, error in ((409, "changed"), (413, "osm_down"), (429, "rate_limited")):
        fake.status["upload"] = status
        out = sync_pass(fake, pg_dsn)
        assert out["pass"]["errors"] == {error: 1}, status
        assert publications(pg_dsn) == before and stale not in before
        assert not fake.changesets[max(fake.changesets)]["open"]  # closed all the same
        forgive(pg_dsn)
    del fake.status["upload"]
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == [add2] and out["conflicts"] == [
        {"uuid": stale, "reason": "osm_version"}
    ]


def test_an_upload_without_answer_stays_sending_never_sent_again(client, fake, pg_dsn, clean,
                                                                 caplog):  # fmt: skip
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)

    def cut(_body):
        raise ConnectionResetError  # the fake closes the connection without an answer

    fake.on_upload = cut
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        out = sync_pass(fake, pg_dsn)
    assert out["pass"]["errors"] == {"osm_down": 1}
    assert publications(pg_dsn)[add][1] == "sending"
    assert items(pg_dsn, aid) == []
    assert "osm upload refused: no answer" in [m.getMessage() for m in caplog.records]


def test_an_upload_answered_5xx_stays_sending_never_sent_twice(client, fake, pg_dsn, clean):
    """A 5xx may come from a proxy after OSM committed: the add went, and a second <create>
    would be a second node on OSM; the next pass finds it in the changeset."""
    aid = make(pg_dsn, "pub-a")
    token = enabled(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    fake.after_upload = 504
    count = len(fake.nodes)
    out = sync_pass(fake, pg_dsn)
    assert out["pass"]["errors"] == {"osm_down": 1}
    assert len(fake.nodes) == count + 1  # it did go
    assert publications(pg_dsn)[add][1] == "sending"
    assert items(pg_dsn, aid) == []
    assert [h["state"] for h in synced(client, token)["history"]] == ["sending"]
    fake.after_upload = None
    forgive(pg_dsn)
    out = sync_pass(fake, pg_dsn)
    assert out["pass"]["reconciled"] == {"published": 1} and len(fake.nodes) == count + 1
    assert nodes(pg_dsn)[("dev", cam)][0] == fake.next_node


def test_a_token_revoked_on_osm_ends_publishing_and_says_it(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    token = enabled(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    fake.revoked.append(fake.issued[-1])  # the person revoked it in her OSM settings
    out = sync_pass(fake, pg_dsn)
    assert out["pass"]["errors"] == {"revoked": 1} and publications(pg_dsn) == {}
    assert stored(pg_dsn, aid)[2] is None
    s = synced(client, token)
    assert (s["on"], s["since"], s["last_error"], s["history"]) == (False, None, "revoked", [])
    assert me(client, token)["sync"] is False
    # Revoked between the changeset and the upload: the rows removed.
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM osm_write WHERE account_id = %s", (aid,))
    enabled(pg_dsn, fake, aid)
    fake.status["upload"] = 401
    assert sync_pass(fake, pg_dsn)["pass"]["errors"] == {"revoked": 1}
    assert stored(pg_dsn, aid)[2] is None and publications(pg_dsn) == {}


def test_what_her_history_says_while_her_choice_is_on(client, fake, pg_dsn, clean):
    """GET /api/osm/sync's history: what went (gone, its changeset and month), and what may
    still leave: waiting (pending: after the review; validated: after the next build;
    applied: at the next pass), kept_before (observed before her choice); never what
    cannot leave; months only."""
    aid = make(pg_dsn, "pub-a")
    token = enabled(pg_dsn, fake, aid, consent=date(2026, 10, 5))
    old, _ = added(pg_dsn, aid, day=date(2026, 10, 3))
    waiting = {s: added(pg_dsn, aid, status=s, at=(2.2400 + i / 1000, 48.8930))[0]
               for i, s in enumerate(("pending", "validated", "applied"))}  # fmt: skip
    added(pg_dsn, aid, on_site=False, at=(2.2450, 48.8930))  # never leaves: not listed
    added(pg_dsn, aid, status="rejected", at=(2.2460, 48.8930))  # rejected: not listed
    said = {h["uuid"]: h for h in synced(client, token)["history"]}
    assert {u: (h["state"], h["status"], h["month"]) for u, h in said.items()} == {
        old: ("kept_before", "applied", "2026-10"),
        **{u: ("waiting", s, "2026-10") for s, u in waiting.items()}}  # fmt: skip
    assert set(said[old]) == {"uuid", "camera", "label", "kind", "status", "state", "changeset",
                              "reason", "month"}  # fmt: skip
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == [waiting["applied"]]
    assert {h["uuid"]: h["state"] for h in synced(client, token)["history"]}[
        waiting["applied"]] == "gone"  # fmt: skip
    # Her choice off: what went stays said, nothing waits.
    stay(client, token)
    assert [h["uuid"] for h in synced(client, token)["history"]] == [waiting["applied"]]


def test_a_contribution_says_it_will_leave_for_osm(client, fake, pg_dsn, clean, monkeypatch):
    """POST /api/contributions: `osm: "will_publish"` when her choice is on and this
    contribution can leave there, once accepted; absent otherwise."""
    from lacarte.api import live as live_api

    aid = make(pg_dsn, "pub-a")
    with psycopg.connect(pg_dsn) as conn:
        build = conn.execute("SELECT build_id FROM meta").fetchone()[0]
    # 1 m off a facade, more than 20 m from every camera (tests/test_add.py's point).
    lon, lat = live_api.to_lonlat(644329.8662116162 + 0.7, 6866484.319232392 + 0.7)
    body = {"kind": "add", "build_id": build, "day": date.today().isoformat(), "on_site": True,
            "lon": lon, "lat": lat, "placement": "facade"}  # fmt: skip
    api.limits.hits.clear()

    def post(token, **changes):
        r = client.post("/api/contributions", json={**body, "uuid": str(uuid4()), **changes},
                        headers=signed(token))  # fmt: skip
        assert r.status_code == 200, r.text
        return r.json()

    plain = session_of(pg_dsn, aid)
    before = post(plain)
    assert "osm" not in before
    token = enabled(pg_dsn, fake, aid)
    # Sent the same day, before she chose: it says nothing, now or resent, and never leaves.
    assert "osm" not in client.post("/api/contributions", json={**body, "uuid": before["uuid"]},
                                    headers=signed(token)).json()  # fmt: skip
    assert post(token)["osm"] == "will_publish"
    assert "osm" not in post(token, on_site=False)
    assert "osm" not in post(token, day="2026-09-30")  # before her choice
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE osm_write SET last_error = 'blocked' WHERE account_id = %s", (aid,))
    assert "osm" not in post(token)
    monkeypatch.setattr(api.settings, "osm_write_server", "")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE osm_write SET last_error = NULL WHERE account_id = %s", (aid,))
    assert "osm" not in post(token)  # not offered


# --- the live server: OSM's cameras (the fake stands for it, switched on in /revue) -----------


def switch(dsn, live: bool) -> None:
    """/revue's osm_write_live (migration 022), seen at once."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = %s WHERE key = 'osm_write_live'", (live,))
    api.switches.forget()


def live_client(monkeypatch, url: str) -> None:
    """The live server's client, as Settings reads OSM_LIVE_* (the fake stands for it)."""
    s = api.settings
    monkeypatch.setattr(s, "osm_live_write_url", url)
    monkeypatch.setattr(s, "osm_live_write_client_id", fakeosm.CLIENT_ID)
    monkeypatch.setattr(s, "osm_live_write_client_secret", fakeosm.CLIENT_SECRET)


@pytest.fixture
def live(fake, monkeypatch, pg_dsn):
    """Writing switched to the (fake) live server in /revue."""
    live_client(monkeypatch, fake.url)
    switch(pg_dsn, True)
    yield
    switch(pg_dsn, False)


def mapped(fake, osm_ref, tags, at, **extra):
    """The OSM camera on the (fake) live server as the build saw it, maybe edited since."""
    fake.node(osm_ref[1], *at, {**tags, **extra}, version=osm_ref[2])


def test_an_osm_camera_is_modified_with_all_its_tags(client, fake, pg_dsn, clean, live):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid, "live")
    ((cam, ref, tags, at),) = osm_cameras(pg_dsn, 1)
    mapped(fake, ref, tags, at)
    to = (round(at[0] + 0.00002, 7), round(at[1] + 0.00001, 7))
    shape = put(pg_dsn, aid, "shape", cam, answer="multi", osm=ref, tags=tags, at=at)
    move = put(pg_dsn, aid, "move", cam, osm=ref, tags=tags, at=to, old=list(at))
    (item,) = items(pg_dsn, aid, "live")
    assert (item.action, item.node, sent_at(item)) == ("modify", ref[1], to)
    assert tags_of(item) == {"camera:type": "panorama"}
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == sorted([shape, move]) and out["conflicts"] == []
    (sent,) = change(fake, out["changeset"]).iter("node")
    assert (sent.get("id"), sent.get("version")) == (str(ref[1]), str(ref[2]))
    assert (float(sent.get("lon")), float(sent.get("lat"))) == to
    assert node_tags(sent) == {**tags, "camera:type": "panorama"}  # all of them, ours added
    assert nodes(pg_dsn) == {("live", cam): (ref[1], ref[2] + 1)}


def test_a_camera_on_a_way_is_never_moved(client, fake, pg_dsn, clean, live):
    """A camera mapped as a vertex of a way (a building's outline, a wall): moving the node
    would move the way, so its move is a conflict osm_way; its other answers still go."""
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid, "live")
    ((cam, ref, tags, at),) = osm_cameras(pg_dsn, 1)
    mapped(fake, ref, tags, at)
    fake.ways[ref[1]] = [77]
    to = (round(at[0] + 0.00002, 7), round(at[1] + 0.00001, 7))
    shape = put(pg_dsn, aid, "shape", cam, answer="multi", osm=ref, tags=tags, at=at)
    move = put(pg_dsn, aid, "move", cam, osm=ref, tags=tags, at=to, old=list(at))
    out = sync_pass(fake, pg_dsn)
    assert out["published"] == [shape]
    assert {c["uuid"]: c["reason"] for c in out["conflicts"]} == {move: "osm_way"}
    (sent,) = change(fake, out["changeset"]).iter("node")
    where = (float(sent.get("lon")), float(sent.get("lat")))
    assert where == pytest.approx(at, abs=1e-7)  # where it was


def test_an_osm_camera_s_conflicts_by_tags_version_and_value(client, fake, pg_dsn, clean, live):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid, "live")
    (cam, ref, tags, at), (cam2, ref2, tags2, at2) = osm_cameras(pg_dsn, 2)
    # Edited since the observation: a shape is held against camera:type & co (osm_tags), a
    # « toujours là » against the version (osm_version).
    mapped(fake, ref, tags, at, **{"camera:type": "dome"})
    fake.nodes[ref[1]]["version"] += 1
    shape = put(pg_dsn, aid, "shape", cam, answer="bullet", osm=ref, tags=tags, at=at)
    seen = put(pg_dsn, aid, "verify", cam, answer="present", osm=ref, tags=tags, at=at)
    # Public when observed, an unrelated edit since: the direction still goes (its keys did
    # not change); a business answer is never written over operator:type=public (osm_value).
    public = {**tags2, "operator:type": "public"}
    mapped(fake, ref2, public, at2, note="repeinte")
    fake.nodes[ref2[1]]["version"] += 1
    aim = put(pg_dsn, aid, "direction", cam2, direction=40, osm=ref2, tags=public, at=at2)
    who = put(pg_dsn, aid, "operator", cam2, answer="business", osm=ref2, tags=public, at=at2)
    out = sync_pass(fake, pg_dsn)
    assert {c["uuid"]: c["reason"] for c in out["conflicts"]} == {
        shape: "osm_tags", seen: "osm_version", who: "osm_value"}  # fmt: skip
    assert out["published"] == [aim]
    (sent,) = change(fake, out["changeset"]).iter("node")
    assert node_tags(sent) == {**public, "note": "repeinte", "camera:direction": "40"}


def test_our_own_last_version_is_accepted_and_a_revalidated_conflict_s_too(client, fake, pg_dsn,
                                                                          clean, live):  # fmt: skip
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid, "live")
    (cam, ref, tags, at), (cam2, ref2, tags2, at2) = osm_cameras(pg_dsn, 2)
    mapped(fake, ref, tags, at)
    shape = put(pg_dsn, aid, "shape", cam, answer="dome", osm=ref, tags=tags, at=at)
    assert sync_pass(fake, pg_dsn)["published"] == [shape]  # we are now the last version
    seen = put(pg_dsn, aid, "verify", cam, answer="present", osm=ref, tags=tags, at=at,
               day=date(2026, 10, 10))  # fmt: skip
    # The deploy settled a conflict on a newer version (apply_detail), the review accepted it.
    mapped(fake, ref2, tags2, at2)
    fake.nodes[ref2[1]]["version"] = ref2[2] + 2
    seen2 = put(pg_dsn, aid, "verify", cam2, answer="present", osm=ref2, tags=tags2, at=at2,
                held=ref2[2] + 2)  # fmt: skip
    out = sync_pass(fake, pg_dsn)
    assert out["conflicts"] == [] and out["published"] == sorted([seen, seen2])


def test_the_live_server_is_never_contacted_without_the_switch(client, fake, pg_dsn, clean,
                                                                monkeypatch):  # fmt: skip
    """The live client configured, /revue's osm_write_live off: a fake « live » server
    receives no request — not with a choice made there, not through choosing, not through
    a pass; writing goes to the test server. Switched on, the same settings write to it."""
    other = fakeosm.FakeOsm()
    try:
        live_client(monkeypatch, other.url)
        aid = make(pg_dsn, "pub-a")
        token = enabled(pg_dsn, other, aid, "live")
        ((cam, ref, tags, at),) = osm_cameras(pg_dsn, 1)
        mapped(other, ref, tags, at)
        shape = put(pg_dsn, aid, "shape", cam, answer="dome", osm=ref, tags=tags, at=at)
        assert enable(client, token).json()["url"].startswith(fake.url)  # the test server's
        assert synced(client, token)["on"] is False  # her choice is the live server's
        assert sync_pass(fake, pg_dsn)["pass"]["accounts"] == 0
        assert client.get("/api/osm/status").json()["write_server"] == "dev"
        assert other.requests == [] and publications(pg_dsn) == {}
        switch(pg_dsn, True)
        try:
            assert client.get("/api/osm/status").json()["write_server"] == "live"
            assert synced(client, token)["on"] is True
            assert sync_pass(other, pg_dsn)["published"] == [shape]
            assert other.requests != []
        finally:
            switch(pg_dsn, False)
    finally:
        other.close()


OSM_SETTINGS = ("osm_login_server", "osm_url", "osm_client_id", "osm_client_secret",
                "osm_write_server", "osm_write_url", "osm_write_client_id",
                "osm_write_client_secret", "osm_token_key", "osm_live_write_url",
                "osm_live_write_client_id", "osm_live_write_client_secret")  # fmt: skip


def public_site(monkeypatch, url: str, **changes: str | None) -> api.Settings:
    """The API's OSM settings as the public site's environment gives them (the fake stands
    for the live server, and for the test server too): signing in on the live server,
    writing to the test server unless /revue switches to the live one; `changes` (None:
    unset)."""
    env = {"OSM_LOGIN_SERVER": "live", "OSM_WRITE_SERVER": "dev", "OSM_LIVE_URL": url,
           "OSM_DEV_URL": url, "OSM_LIVE_CLIENT_ID": fakeosm.CLIENT_ID,
           "OSM_LIVE_CLIENT_SECRET": fakeosm.CLIENT_SECRET,
           "OSM_DEV_CLIENT_ID": fakeosm.CLIENT_ID, "OSM_DEV_CLIENT_SECRET": fakeosm.CLIENT_SECRET,
           "OSM_TOKEN_KEY": base64.b64encode(KEY).decode(), **changes}  # fmt: skip
    monkeypatch.delenv("OSM_WRITE_LIVE_APPROVED", raising=False)
    for k, v in env.items():
        if v is None:
            monkeypatch.delenv(k, raising=False)
        else:
            monkeypatch.setenv(k, v)
    s = api.Settings()
    for k in OSM_SETTINGS:
        monkeypatch.setattr(api.settings, k, getattr(s, k))
    return s


def test_the_public_site_publishes_on_the_live_server_once_switched(client, fake, pg_dsn, clean,
                                                                    monkeypatch):  # fmt: skip
    """The launch: OSM_LOGIN_SERVER=live, OSM_WRITE_SERVER=dev, nothing offered; /revue's
    osm_write_live on: offered, signing in still asks `openid` only, choosing asks `openid
    write_api`, the job reaches the (fake) live server with a check_date. Switched off
    again: nothing offered, choosing answers 503, the job asks nobody."""
    s = public_site(monkeypatch, fake.url)
    assert (s.osm_login_server, s.osm_write_server, s.osm_live_write_url) == (
        "live", "dev", fake.url)  # fmt: skip
    config = client.get("/api/config").json()
    assert (config["publish"], config["sync"]) == (False, False)
    switch(pg_dsn, True)
    try:
        config = client.get("/api/config").json()
        assert (config["publish"], config["sync"]) == (True, True)
        status = client.get("/api/osm/status").json()
        assert (status["server"], status["write"], status["write_server"]) == (
            "live", True, "live")  # fmt: skip
        assert query(location(client.get("/api/osm/login")))["scope"] == "openid"
        aid = make(pg_dsn, "pub-a")
        token = session_of(pg_dsn, aid)
        assert query(enable(client, token).json()["url"])["scope"] == "openid write_api"
        assert location(write_on(client, fake, token)) == THEN + "&osm=write_on"
        assert stored(pg_dsn, aid)[0] == "live"
        with psycopg.connect(pg_dsn, autocommit=True) as conn:  # observed before: it waits
            conn.execute("UPDATE osm_write SET consent_day = %s", (CONSENT,))

        ((cam, ref, tags, at),) = osm_cameras(pg_dsn, 1)
        tags = {k: v for k, v in tags.items() if k != "check_date"}
        mapped(fake, ref, tags, at)
        seen = put(pg_dsn, aid, "verify", cam, answer="present", osm=ref, tags=tags, at=at)
        add, new = added(pg_dsn, aid)
        aim = on_add(pg_dsn, aid, add, "direction", direction=200)
        assert listed(pg_dsn, aid, "live") == {cam: [seen], new: [add, aim]}
        out = sync_pass(fake, pg_dsn)
        assert out["published"] == sorted([seen, add, aim]) and out["conflicts"] == []
        sent = {b.tag: node_tags(next(b.iter("node"))) for b in change(fake, out["changeset"])}
        assert sent["modify"] == {**tags, "check_date": DAY.isoformat()}
        assert {u: p[:2] for u, p in publications(pg_dsn).items()} == dict.fromkeys(
            [seen, add, aim], ("live", "published"))  # fmt: skip
    finally:
        switch(pg_dsn, False)
    asked = len(fake.requests)
    assert client.get("/api/config").json()["sync"] is False
    assert client.get("/api/osm/status").json()["write"] is False
    on_add(pg_dsn, aid, add, "verify", answer="present", day=date(2026, 10, 10))
    r = enable(client, token)
    assert (r.status_code, r.json()) == (503, {"error": "osm_unavailable"})
    assert api.sync_once()["state"] == "not_offered"
    assert len(fake.requests) == asked and me(client, token)["sync"] is False
    assert query(location(client.get("/api/osm/login")))["scope"] == "openid"


def test_the_review_says_what_became_of_a_contribution_on_osm(client, fake, pg_dsn, clean):
    aid = make(pg_dsn, "pub-a")
    enabled(pg_dsn, fake, aid)
    add, cam, node = published_add(fake, pg_dsn, aid)
    fake.edit(node, note="x")
    aim = on_add(pg_dsn, aid, add, "direction", direction=7)
    sync_pass(fake, pg_dsn)
    never = on_add(pg_dsn, aid, add, "shape", answer="dome", on_site=False)
    waits = on_add(pg_dsn, aid, add, "verify", answer="present", status="pending")
    edited = on_add(pg_dsn, aid, add, "operator", answer="business", status="validated")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET operator_proposed = 'Chez Paul',"
                     " operator_choice = 'listed', operator_name = 'Monoprix' WHERE uuid = %s",
                     (edited,))  # fmt: skip
    rev = make(pg_dsn, "pub-rev")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET role = 'admin' WHERE id = %s", (rev,))
    reviewer = session_of(pg_dsn, rev)
    # As the privileged entry and the reauthentication mark it (lot 2: the CSV is the
    # administrator's).
    auth.privileged.put(auth.digest(reviewer), rev, 60)
    auth.reauthed.put(auth.digest(reviewer), rev, 60)
    rows = client.get("/api/review/camera", params={"camera": cam},
                      headers=signed(reviewer)).json()["contributions"]  # fmt: skip
    got = {r["uuid"]: r["destination"] for r in rows}
    month = date.today().strftime("%Y-%m")
    assert got[never] == {"where": "sw"}
    # Her synchronisation on (migration 022): what waits for the review leaves once accepted
    # and applied; what the review changed stays here.
    assert got[waits] == {"where": "osm", "server": "dev", "state": "waiting", "reason": None,
                          "changeset": None, "month": None}  # fmt: skip
    assert got[edited] == {"where": "sw", "state": "kept_edited"}
    assert got[add]["changeset"] > 0 and got[aim]["changeset"] is None
    assert {u: {k: v for k, v in got[u].items() if k != "changeset"} for u in (add, aim)} == {
        add: {"where": "osm", "server": "dev", "state": "published", "reason": None,
              "month": month},
        aim: {"where": "osm", "server": "dev", "state": "conflict", "reason": "osm_version",
              "month": month}}  # fmt: skip
    got = {u: {k: v for k, v in d.items() if k != "where"} for u, d in got.items()}
    lines = list(csv.DictReader(io.StringIO(
        client.get("/api/review/export.csv", headers=signed(reviewer)).text)))  # fmt: skip
    by = {r["uuid"]: r for r in lines}
    assert json.loads(by[aim]["osm_publish"]) == got[aim] and by[never]["osm_publish"] == ""
    assert list(lines[0])[-2:] == ["osm_publish", "test"]
    # The queue's « OSM » filter: the cameras with a publication in conflict or uncertain,
    # its pieces saying so; the summary counts them.
    queue = client.get("/api/review/queue", params={"filter": "osm"},
                       headers=signed(reviewer)).json()  # fmt: skip
    (item,) = queue["items"]
    assert item["camera"] == cam and queue["summary"]["counts"]["osm"] == 1
    trouble = {p["uuid"]: p["osm"] for p in item["pieces"]}
    assert trouble[aim] == {"state": "conflict", "reason": "osm_version", "server": "dev"}
    assert trouble[waits] is None  # pending: listed as always, nothing wrong on OSM
    # The account sheet: her synchronisation.
    sheet = client.get("/api/review/account", params={"id": aid},
                       headers=signed(reviewer)).json()  # fmt: skip
    assert sheet["sync"] == {"on": True, "server": "dev", "since": "2026-10", "last_error": None}
