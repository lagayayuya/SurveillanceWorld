"""Sign in with OpenStreetMap over HTTP (migration 015, lacarte.api.osm), against a fake OSM
on 127.0.0.1 (tests/fakeosm.py; never openstreetmap.org): the authorization request, the
callback's token exchange, id_token checks and revocation, the sign-up, linking and
unlinking, `then`, replays and expiry, and what each route asks of the caller."""

import base64
import hashlib
import logging
import re
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import fakeosm
import psycopg
import pytest
import sessions
from argon2 import PasswordHasher
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sessions import ORIGIN

from lacarte.api import app as api
from lacarte.api import auth, osm

JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
SUB = 4242


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


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture(autouse=True)
def on(monkeypatch, client, fake, pg_dsn):
    """OSM sign-in on, against the fake; fresh flows and sign-ups on a fake clock; argon2 at
    a test cost; no cookie kept; the fake's accounts gone."""
    fake.reset()
    monkeypatch.setattr(api.settings, "osm_url", fake.url)
    monkeypatch.setattr(api.settings, "osm_client_id", fakeosm.CLIENT_ID)
    monkeypatch.setattr(api.settings, "osm_client_secret", fakeosm.CLIENT_SECRET)
    monkeypatch.setattr(api.settings, "cookie_secure", False)
    monkeypatch.setattr(api.settings, "osm_write_server", "")  # publishing: test_osm_publish
    clock = Clock()
    monkeypatch.setattr(osm, "flows", osm.Waiting(clock=clock))
    monkeypatch.setattr(osm, "signups", osm.Waiting(clock=clock))
    monkeypatch.setattr(osm, "_jwks", {})
    monkeypatch.setattr(auth, "hasher", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
    monkeypatch.setattr(auth, "_dummy", None)
    client.cookies.clear()
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE osm_id IS NOT NULL OR pseudonym ~* '^(osm|fict)'"
                     " OR pseudonym IN ('lin', 'max')")  # fmt: skip
    yield clock
    client.cookies.clear()


def make(dsn, name, *, password=True, osm_id=None, disabled=False) -> str:
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE lower(pseudonym) = lower(%s)", (name,))
        return conn.execute(
            "INSERT INTO accounts (pseudonym, password_hash, created_month, osm_id, osm_server,"
            " disabled) VALUES (%s, %s, date_trunc('month', current_date), %s, %s, %s)"
            " RETURNING id::text",
            (name, auth.hash_password("a fictitious password") if password else None, osm_id,
             "dev" if osm_id else None, disabled),
        ).fetchone()[0]  # fmt: skip


def session_of(dsn, aid) -> str:
    with psycopg.connect(dsn, autocommit=True) as conn:
        return auth.open_session(conn, aid, auth.date.today())


def signins(dsn) -> int:
    """The `signin` counter over every hour (migration 021): a session opened, counted."""
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT coalesce(sum(n), 0) FROM site_counters_hour"
                            " WHERE counter = 'signin'").fetchone()[0]  # fmt: skip


def cookie(r, name) -> str | None:
    m = re.search(rf"(?:^|, ){re.escape(name)}=([^;]*)", r.headers.get("set-cookie", ""))
    return m.group(1) if m else None


def only_flow_cleared(r) -> bool:
    """The callback sets no cookie but the flow cookie's clearing (no session, no sign-up)."""
    return set(set_cookies(r)) <= {"osm-flow"} and cookie(r, "osm-flow") in (None, '""')


def set_cookies(r) -> dict[str, str]:
    """name -> the whole Set-Cookie line, for each cookie the response sets."""
    return {h.split("=", 1)[0]: h for h in r.headers.get_list("set-cookie")}


def location(r) -> str:
    assert r.status_code == 302, (r.status_code, r.text)
    return r.headers["location"]


def query(url: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def go_to_osm(client, then="/?ui=punk", path="/api/osm/login", headers=None):
    return client.get(path, params={"then": then} if then is not None else None,
                      headers=headers)  # fmt: skip


def back(client, grant, **params):
    params = params or {"code": grant["code"], "state": grant["state"]}
    return client.get("/api/osm/callback", params=params)


def sign_in(client, fake, sub=SUB, name="Fictitious Mapper", then="/?ui=punk",
            path="/api/osm/login", headers=None):  # fmt: skip
    grant = fake.authorize(location(go_to_osm(client, then, path, headers)), sub, name)
    return back(client, grant)


def signed(token: str) -> dict:
    return {"Cookie": f"session={token}", **JSON}


def signup_headers(key: str) -> dict:
    return {"Cookie": f"osm-signup={key}", **JSON}


def accounts_with(dsn, sub):
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT pseudonym, password_hash IS NULL FROM accounts"
                            " WHERE osm_id = %s", (sub,)).fetchall()  # fmt: skip


# --- off, routes, what each one asks ------------------------------------------------------


def osm_routes():
    return sorted((m, r.path) for r in api.app.routes if isinstance(r, APIRoute)
                  and r.path.startswith("/api/osm/") for m in r.methods)  # fmt: skip


SESSION = {("POST", "/api/osm/link"), ("POST", "/api/osm/unlink"), ("GET", "/api/osm/sync"),
           ("POST", "/api/osm/sync")}  # fmt: skip
# The synchronisation's routes answer whatever sign-in is (tests/test_osm_publish_api.py).
SYNC = {("GET", "/api/osm/sync"), ("POST", "/api/osm/sync")}
ROUTES = {("GET", "/api/osm/status"), ("GET", "/api/osm/login"), ("GET", "/api/osm/callback"),
          ("GET", "/api/osm/signup"), ("POST", "/api/osm/signup"), *SESSION}  # fmt: skip


WRITE_OFF = {"write": False, "write_server": None, "write_url": None}


def test_these_are_all_the_osm_routes():
    assert set(osm_routes()) == ROUTES


@pytest.mark.parametrize(("method", "path"), sorted(ROUTES))
def test_every_osm_route_says_what_it_asks(client, method, path):
    """Without a session: 401 session on linking and unlinking only; the others are how
    one signs in (a sign-up asks for its own cookie: 401 signup_expired)."""
    r = client.request(method, path, json={} if method == "POST" else None, headers=JSON)
    if (method, path) in SESSION:
        assert (r.status_code, r.json()) == (401, {"error": "session"})
    else:
        assert r.status_code != 401 or r.json() == {"error": "signup_expired"}, r.text
        assert r.status_code < 500


@pytest.mark.parametrize(("method", "path"), sorted(ROUTES - {("GET", "/api/osm/status")} - SYNC))
def test_off_without_a_client_id_or_secret(client, monkeypatch, method, path, pg_dsn):
    """Not configured: 503 osm_unavailable (signed in, past the session check), and the
    status says no sign-in; no error at start."""
    monkeypatch.setattr(api.settings, "osm_client_secret", "")
    assert client.get("/api/osm/status").json() == {"login": False, "server": "dev", **WRITE_OFF}
    body = ({"pseudonym": "fict", "password": "x", "uuids": [], "comment": "x"}
            if method == "POST" else None)  # fmt: skip
    r = client.request(method, path, json=body, headers=sessions.headers("ana"))
    assert (r.status_code, r.json()) == (503, {"error": "osm_unavailable"})
    monkeypatch.setattr(api.settings, "osm_client_secret", fakeosm.CLIENT_SECRET)
    monkeypatch.setattr(api.settings, "osm_client_id", "")
    assert client.get("/api/osm/status").json() == {"login": False, "server": "dev", **WRITE_OFF}


def test_on_with_both(client):
    assert client.get("/api/osm/status").json() == {"login": True, "server": "dev", **WRITE_OFF}


def test_writes_keep_the_origin_check(client, pg_dsn):
    token = session_of(pg_dsn, make(pg_dsn, "lin"))
    for path in ("/api/osm/signup", "/api/osm/unlink"):
        r = client.post(path, json={}, headers={**signed(token), "Origin": "https://evil.test"})
        assert (r.status_code, r.json()) == (403, {"error": "origin"})


# --- the authorization request ------------------------------------------------------------


def test_login_sends_the_browser_to_osm_with_pkce_state_and_nonce(client, fake):
    r = go_to_osm(client)
    url = location(r)
    assert url.startswith(fake.url + "/oauth2/authorize?")
    assert r.headers["cache-control"] == "no-store"
    q = query(url)
    assert set(q) == {"response_type", "client_id", "redirect_uri", "scope", "state", "nonce",
                      "code_challenge", "code_challenge_method"}  # fmt: skip
    assert (q["response_type"], q["client_id"], q["scope"], q["code_challenge_method"]) == (
        "code", fakeosm.CLIENT_ID, "openid", "S256")  # fmt: skip
    assert q["redirect_uri"] == ORIGIN + "/api/osm/callback"
    flow = osm.flows.get(q["state"])
    assert flow.kind == "login" and flow.nonce == q["nonce"] and flow.account is None
    digest = hashlib.sha256(flow.verifier.encode()).digest()
    assert q["code_challenge"] == base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    assert 43 <= len(flow.verifier) <= 128 and len(q["state"]) >= 43
    other = query(location(go_to_osm(client)))
    assert other["state"] != q["state"] and other["nonce"] != q["nonce"]
    assert other["code_challenge"] != q["code_challenge"]


def test_the_flows_wait_ten_minutes_once_and_a_thousand_at_most():
    clock = Clock()
    w = osm.Waiting(clock=clock)
    w.put("a", 1)
    clock.now += 599
    assert w.get("a") == 1 and w.take("a") == 1 and w.take("a") is None  # single use
    w.put("b", 2)
    clock.now += 600
    assert w.get("b") is None and w.take("b") is None  # expired
    small = osm.Waiting(size=3, clock=clock)
    for k in "wxyz":
        small.put(k, k)
    assert list(small.items) == ["x", "y", "z"]  # the oldest dropped
    assert (osm.TTL_S, osm.MAX_WAITING) == (600, 1000)


# --- `then`, where the person comes back --------------------------------------------------

EVIL = ["//evil.test", "https://evil.test/", "http:/evil.test", "/\\evil.test", "\\\\evil.test",
        "javascript:alert(1)", "evil.test", "/\t/evil.test", "/\n/evil.test", "/ /evil",
        "%2F%2Fevil.test", "%2f%5cevil.test", "/café", "", "/" + "a" * 2048]  # fmt: skip


@pytest.mark.parametrize("raw", EVIL)
def test_then_is_a_path_of_this_site_or_the_map(raw):
    assert osm.safe_then(raw) == osm.DEFAULT_THEN


@pytest.mark.parametrize("raw", ["/", "/?ui=punk", "/?ui=punk#map=16/48.89/2.24",
                                 "/revue?x=1&y=%2F%2Fevil", "/%2F%2Fevil.test",
                                 "/%5Cevil.test"])  # fmt: skip
def test_then_keeps_a_path_with_its_query_and_fragment(raw):
    """Percent-encoded slashes stay in the path: a browser does not decode them there."""
    assert osm.safe_then(raw) == raw


@pytest.mark.parametrize(("then", "status", "url"), [
    ("/?ui=punk", "signed", "/?ui=punk&osm=signed"),
    ("/", "failed", "/?osm=failed"),
    ("/?ui=punk#map=16/48.89/2.24", "signup", "/?ui=punk&osm=signup#map=16/48.89/2.24"),
    ("/a?osm=signed&b=1#x?y", "denied", "/a?b=1&osm=denied#x?y"),
])  # fmt: skip
def test_the_status_goes_in_the_query_before_the_fragment(then, status, url):
    assert osm.with_status(then, status) == url


@pytest.mark.parametrize("raw", ["//evil.test", "/\\evil.test", "https://evil.test",
                                 "%2F%2Fevil.test"])  # fmt: skip
def test_no_open_redirect_through_the_whole_flow(client, fake, raw):
    """Sent as the browser sends it (URL-encoded once by the client): the callback goes to
    the map, never elsewhere."""
    assert location(sign_in(client, fake, then=raw)) == "/?ui=punk&osm=signup"
    # Encoded once more by hand: `then` arrives as `%2F%2Fevil.test`, still refused.
    r = client.get("/api/osm/login?then=%252F%252Fevil.test")
    assert osm.flows.get(query(location(r))["state"]).then == osm.DEFAULT_THEN


def test_then_with_a_fragment_comes_back_whole(client, fake):
    then = "/?ui=punk&cam=n123#map=17/48.8924/2.2361"
    assert location(sign_in(client, fake, then=then)) == (
        "/?ui=punk&cam=n123&osm=signup#map=17/48.8924/2.2361")  # fmt: skip


# --- the callback: token, id_token, revocation --------------------------------------------


def test_a_first_sign_in_starts_a_sign_up_and_revokes_the_token(client, fake, pg_dsn):
    r = sign_in(client, fake, then="/?ui=punk#x")
    assert location(r) == "/?ui=punk&osm=signup#x"
    assert r.headers["cache-control"] == "no-store"
    # The exchange: client_secret_basic, the code, our redirect URI, the PKCE verifier.
    (form,) = fake.tokens
    assert form["grant_type"] == "authorization_code" and form["code_verifier"]
    assert form["redirect_uri"] == ORIGIN + "/api/osm/callback"
    assert form["authorization"].startswith("Basic ") and "client_secret" not in form
    assert fake.revoked == fake.issued and len(fake.revoked) == 1  # at once, nothing kept
    assert all(ua.startswith("SurveillanceWorld/") for ua in fake.user_agents)
    assert len(fake.user_agents) == 3  # token, keys, revoke
    assert accounts_with(pg_dsn, SUB) == [] and "session=" not in r.headers.get("set-cookie")
    line = set_cookies(r)["osm-signup"]  # and the flow cookie cleared
    attrs = {a.strip().split("=")[0].lower() for a in line.split(";")[1:]}
    assert line.startswith("osm-signup=") and attrs == {"httponly", "max-age", "path",
                                                        "samesite"}  # fmt: skip
    assert "Max-Age=600" in line and "Path=/" in line and "SameSite=lax" in line
    assert osm.flows.items == {}  # the flow is spent


@pytest.mark.parametrize("key", ["signups_open", "contributions_open"])
def test_with_sign_ups_closed_a_first_sign_in_comes_back_closed(client, fake, pg_dsn, key):
    """Lot 2's open question: the page learns it from the callback, not from a 403 on
    /api/osm/signup later; no sign-up waits, the token is revoked as always. An account
    already there still signs in (sign-ups closed only). A flow started while open and
    finished after closing (contributions closed refuse /api/osm/login itself) likewise."""
    started = location(go_to_osm(client))
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = false WHERE key = %s", (key,))
    api.switches.forget()
    try:
        r = back(client, fake.authorize(started, SUB, "Fictitious Mapper"))
        assert location(r) == "/?ui=punk&osm=signups_closed"
        assert only_flow_cleared(r) and osm.signups.items == {}
        assert fake.revoked == fake.issued and accounts_with(pg_dsn, SUB) == []
        make(pg_dsn, "osmthere", osm_id=SUB + 1)
        if key == "signups_open":
            r = sign_in(client, fake, sub=SUB + 1)
            assert location(r) == "/?ui=punk&osm=signed" and "session=" in r.headers["set-cookie"]
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("UPDATE site_settings SET value = true WHERE key = %s", (key,))
        api.switches.forget()


def test_the_production_signup_cookie_is_host_only_and_secure(client, fake, monkeypatch):
    monkeypatch.setattr(api.settings, "cookie_secure", True)
    started = go_to_osm(client)
    flow = set_cookies(started)["__Host-osm-flow"]
    assert "; Secure" in flow and "HttpOnly" in flow and "SameSite=lax" in flow
    # The test client keeps no Secure cookie over http: the browser's, sent by hand.
    secret = flow.split(";")[0].split("=", 1)[1]
    grant = fake.authorize(location(started), SUB, "Fictitious Mapper")
    r = client.get("/api/osm/callback", params={"code": grant["code"], "state": grant["state"]},
                   headers={"Cookie": f"__Host-osm-flow={secret}"})  # fmt: skip
    line = set_cookies(r)["__Host-osm-signup"]
    assert line.startswith("__Host-osm-signup=") and "; Secure" in line and "HttpOnly" in line
    assert "Domain" not in line and "Path=/" in line and "SameSite=lax" in line


def test_the_sign_up_offers_a_free_pseudonym_then_creates_the_account(client, fake, pg_dsn):
    make(pg_dsn, "Fictitious_Mapper", password=False)  # a placeholder holds the name
    before = signins(pg_dsn)
    key = cookie(sign_in(client, fake, name="Fictitious Mapper!"), "osm-signup")
    assert signins(pg_dsn) == before  # no session yet: the person chooses a pseudonym
    offer = client.get("/api/osm/signup", headers=signup_headers(key))
    assert offer.json() == {"suggestion": "Fictitious_Mapper_2",
                            "osm_name": "Fictitious Mapper!"}  # fmt: skip
    r = client.post("/api/osm/signup", json={"pseudonym": "fict-mapper"},
                    headers=signup_headers(key))  # fmt: skip
    assert r.status_code == 204, r.text
    lines = set_cookies(r)
    assert "Max-Age=0" in lines["osm-signup"]  # the sign-up cookie cleared
    session = lines["session"]
    assert "SameSite=strict" in session and "HttpOnly" in session and "Max-Age=2592000" in session
    token = cookie(r, "session")
    assert signins(pg_dsn) == before + 1  # the account made, its session opened
    me = client.get("/api/me", headers=signed(token)).json()
    assert (me["pseudonym"], me["osm"], me["password"], me["role"]) == (
        "fict-mapper", True, False, "contributor")  # fmt: skip
    assert accounts_with(pg_dsn, SUB) == [("fict-mapper", True)]
    # Single use: the same cookie again is over.
    again = client.post("/api/osm/signup", json={"pseudonym": "fict-other"},
                        headers=signup_headers(key))  # fmt: skip
    assert (again.status_code, again.json()) == (401, {"error": "signup_expired"})
    assert client.get("/api/osm/signup", headers=signup_headers(key)).status_code == 401


def test_the_next_sign_in_opens_a_session(client, fake, pg_dsn):
    """As POST /api/session sets it: the same cookie, Strict, 30 days."""
    make(pg_dsn, "fict-known", password=False, osm_id=SUB)
    before = signins(pg_dsn)
    r = sign_in(client, fake, then="/?ui=punk#m")
    assert location(r) == "/?ui=punk&osm=signed#m"
    assert signins(pg_dsn) == before + 1
    line = set_cookies(r)["session"]
    assert line.startswith("session=") and "SameSite=strict" in line and "HttpOnly" in line
    assert "Max-Age=2592000" in line and "Path=/" in line
    me = client.get("/api/me", headers=signed(cookie(r, "session"))).json()
    assert (me["pseudonym"], me["osm"], me["password"]) == ("fict-known", True, False)
    assert fake.revoked == fake.issued


def test_a_disabled_account_does_not_sign_in(client, fake, pg_dsn):
    make(pg_dsn, "fict-off", password=False, osm_id=SUB, disabled=True)
    before = signins(pg_dsn)
    r = sign_in(client, fake)
    assert location(r) == "/?ui=punk&osm=failed&osm_why=compte" and only_flow_cleared(r)
    assert signins(pg_dsn) == before


def test_a_state_is_used_once(client, fake):
    grant = fake.authorize(location(go_to_osm(client, "/x")))
    assert location(back(client, grant)) == "/x?osm=signup"
    replay = back(client, grant)
    assert location(replay) == "/?ui=punk&osm=failed&osm_why=flux_inconnu"
    assert only_flow_cleared(replay)
    assert len(fake.tokens) == 1  # the replay never reached OSM


@pytest.mark.parametrize("state", ["", "unknown", "x" * 200])
def test_an_unknown_state_fails(client, fake, state):
    r = back(client, None, code="c", state=state)
    assert location(r) == "/?ui=punk&osm=failed&osm_why=flux_inconnu" and fake.tokens == []


def test_a_flow_expires_after_ten_minutes(client, fake, on):
    grant = fake.authorize(location(go_to_osm(client, "/x")))
    on.now += 600
    assert location(back(client, grant)) == "/?ui=punk&osm=failed&osm_why=flux_inconnu"
    assert fake.tokens == []


def test_a_refusal_on_osm_s_page_is_denied_and_spends_the_flow(client, fake):
    grant = fake.authorize(location(go_to_osm(client, "/x#y")))
    r = back(client, None, error="access_denied", state=grant["state"])
    assert location(r) == "/x?osm=denied#y" and fake.tokens == []
    assert location(back(client, grant)) == "/?ui=punk&osm=failed&osm_why=flux_inconnu"
    other = fake.authorize(location(go_to_osm(client, "/x")))
    assert location(back(client, None, error="server_error", state=other["state"])) == (
        "/x?osm=failed&osm_why=refus_osm")  # fmt: skip


def test_a_wrong_client_secret_says_so_under_its_own_reason(client, fake, monkeypatch, caplog):
    # 2026-10-11: OSM's test server refused the deployed secret (401 invalid_client), the
    # page said only « n'a pas abouti » and the log « HTTPError »: the reason now tells
    # the client's credentials apart from a refused code, the log stays the class only.
    monkeypatch.setattr(api.settings, "osm_client_secret", "not-" + fakeosm.CLIENT_SECRET)
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        grant = fake.authorize(location(go_to_osm(client, "/x?debug=1")))
        assert location(back(client, grant)) == "/x?debug=1&osm=failed&osm_why=client_refuse"
    assert [r.getMessage() for r in caplog.records] == ["osm callback refused: HTTPError"]


def test_no_answer_from_osm_is_the_network(client, fake, monkeypatch, caplog):
    grant = fake.authorize(location(go_to_osm(client, "/x")))
    # The token endpoint on a port nothing listens on: connection refused.
    monkeypatch.setattr(api.settings, "osm_url", "http://127.0.0.1:9")
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        assert location(back(client, grant)) == "/x?osm=failed&osm_why=reseau"
    assert [r.getMessage() for r in caplog.records] == ["osm callback refused: URLError"]


def test_a_reason_replaces_an_earlier_one_and_keeps_the_fragment():
    assert osm.with_status("/x?osm=failed&osm_why=reseau&a=1#18/1/2", "signed") == (
        "/x?a=1&osm=signed#18/1/2")  # fmt: skip
    assert osm.with_status("/x?osm_whyever=1", "failed", osm.ID_TOKEN) == (
        "/x?osm_whyever=1&osm=failed&osm_why=id_token")  # fmt: skip


def test_a_refused_code_fails_and_logs_the_class_only(client, fake, caplog):
    fake.token_status = 500
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        grant = fake.authorize(location(go_to_osm(client, "/x")))
        assert location(back(client, grant)) == "/x?osm=failed&osm_why=echange_refuse"
    assert [r.getMessage() for r in caplog.records] == ["osm callback refused: HTTPError"]


def wrong_key(claims, header):
    return fakeosm.new_key()  # the published kid, another key: a forged signature


def claim(**changes):
    def tamper(claims, header):
        for k, v in changes.items():
            if v is None:
                claims.pop(k, None)
            else:
                claims[k] = v

    return tamper


def hs256(claims, header):
    header["alg"] = "HS256"
    return "a shared secret an attacker would pick"


@pytest.mark.parametrize("tamper", [
    wrong_key, claim(aud="another-client"), claim(iss="https://evil.test"),
    claim(exp=1_000_000_000), claim(nonce="another-nonce"), claim(nonce=None), claim(exp=None),
    claim(sub="not-a-number"), claim(sub="0"), claim(sub=None), hs256,
], ids=["signature", "aud", "iss", "expired", "nonce", "no-nonce", "no-exp", "sub-text",
        "sub-zero", "no-sub", "hs256"])  # fmt: skip
def test_an_id_token_that_does_not_hold_fails_and_its_token_is_revoked(
    client, fake, pg_dsn, caplog, tamper
):
    fake.tamper = tamper
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        r = sign_in(client, fake, then="/x")
    assert location(r) == "/x?osm=failed&osm_why=id_token" and only_flow_cleared(r)
    assert fake.revoked == fake.issued and len(fake.revoked) == 1
    assert accounts_with(pg_dsn, SUB) == []
    (message,) = [r.getMessage() for r in caplog.records]
    assert re.fullmatch(r"osm callback refused: \w+", message), message


def test_the_keys_are_cached_and_fetched_again_once_for_an_unknown_kid(client, fake, pg_dsn):
    make(pg_dsn, "fict-known", password=False, osm_id=SUB)
    assert location(sign_in(client, fake)).endswith("osm=signed")
    assert location(sign_in(client, fake)).endswith("osm=signed")
    assert fake.jwks_fetches == 1  # cached (an hour)
    assert osm.jwks(osm.Server(fake.url, "", "", "")).jwk_set_cache.lifespan == 3600
    # OSM rotates its key: the new kid is unknown, the set is fetched again, once.
    fake.keys["k2"] = fakeosm.new_key()
    fake.published, fake.signing = ["k2"], "k2"
    assert location(sign_in(client, fake)).endswith("osm=signed")
    assert fake.jwks_fetches == 2
    # A kid OSM never published: one more fetch, then refused.
    fake.signing = "k9"
    assert location(sign_in(client, fake)).endswith("osm=failed&osm_why=id_token")
    assert fake.jwks_fetches == 3


def test_keys_without_alg_or_use_still_check_the_signature(client, fake, pg_dsn):
    """Whatever OSM's key set says of `alg` and `use` (both optional): RS256 from the RSA
    key, and a forged signature still refused."""
    fake.bare_keys = True
    assert "alg" not in fake.jwks()["keys"][0]
    make(pg_dsn, "fict-known", password=False, osm_id=SUB)
    assert location(sign_in(client, fake)).endswith("osm=signed")
    fake.tamper = wrong_key
    assert location(sign_in(client, fake)).endswith("osm=failed&osm_why=id_token")


def test_a_failed_revocation_does_not_stop_the_sign_in(client, fake, pg_dsn, caplog):
    make(pg_dsn, "fict-known", password=False, osm_id=SUB)
    fake.revoke_status = 503
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        assert location(sign_in(client, fake)).endswith("osm=signed")
    assert [r.getMessage() for r in caplog.records] == ["osm revoke failed: HTTPError"]


# --- the sign-up ----------------------------------------------------------------------------


@pytest.mark.parametrize(("name", "sub", "taken", "suggestion"), [
    ("Fictitious Mapper", 7, set(), "Fictitious_Mapper"),
    ("Jöhn Dœ (Paris)", 7, set(), "Jhn_D_Paris"),
    ("x" * 40, 7, set(), "x" * 32),
    ("x" * 40, 7, {"x" * 32}, "x" * 30 + "_2"),
    ("é", 1234567, set(), "osm_1234567"),
    ("", 1234567, set(), "osm_1234567"),
    ("map.per", 7, {"map.per", "map.per_2"}, "map.per_3"),
])  # fmt: skip
def test_the_suggestion_follows_the_pseudonym_rule(name, sub, taken, suggestion):
    got = osm.suggest(name, sub, lambda n: n.lower() in {t.lower() for t in taken})
    assert got == suggestion and auth.PSEUDONYM_RE.fullmatch(got)


def test_the_suggestion_is_free_without_case(client, fake, pg_dsn):
    make(pg_dsn, "FICT", password=True)
    key = cookie(sign_in(client, fake, name="fict"), "osm-signup")
    assert client.get("/api/osm/signup", headers=signup_headers(key)).json()["suggestion"] == (
        "fict_2")  # fmt: skip


@pytest.mark.parametrize(("pseudonym", "status", "error"), [
    ("a", 400, "pseudonym_invalid"), ("with space", 400, "pseudonym_invalid"),
    ("x" * 33, 400, "pseudonym_invalid"), ("Fict-Taken", 409, "pseudonym_taken"),
    ("fict-placeholder", 409, "pseudonym_taken"),
])  # fmt: skip
def test_a_refused_pseudonym_keeps_the_sign_up(client, fake, pg_dsn, pseudonym, status, error):
    make(pg_dsn, "fict-taken")
    make(pg_dsn, "fict-placeholder", password=False)
    key = cookie(sign_in(client, fake), "osm-signup")
    r = client.post("/api/osm/signup", json={"pseudonym": pseudonym},
                    headers=signup_headers(key))  # fmt: skip
    assert (r.status_code, r.json()) == (status, {"error": error})
    ok = client.post("/api/osm/signup", json={"pseudonym": "fict-free"},
                     headers=signup_headers(key))  # fmt: skip
    assert ok.status_code == 204 and accounts_with(pg_dsn, SUB) == [("fict-free", True)]


def test_the_osm_user_linked_meanwhile_ends_the_sign_up(client, fake, pg_dsn):
    key = cookie(sign_in(client, fake), "osm-signup")
    make(pg_dsn, "fict-first", osm_id=SUB)
    r = client.post("/api/osm/signup", json={"pseudonym": "fict-second"},
                    headers=signup_headers(key))  # fmt: skip
    assert (r.status_code, r.json()) == (409, {"error": "osm_taken"})
    again = client.post("/api/osm/signup", json={"pseudonym": "fict-third"},
                        headers=signup_headers(key))  # fmt: skip
    assert again.json() == {"error": "signup_expired"}


def test_a_sign_up_expires_after_ten_minutes(client, fake, on):
    key = cookie(sign_in(client, fake), "osm-signup")
    on.now += 600
    for r in (client.get("/api/osm/signup", headers=signup_headers(key)),
              client.post("/api/osm/signup", json={"pseudonym": "fict-late"},
                          headers=signup_headers(key))):  # fmt: skip
        assert (r.status_code, r.json()) == (401, {"error": "signup_expired"})
    no_cookie = client.post("/api/osm/signup", json={"pseudonym": "fict-late"}, headers=JSON)
    assert no_cookie.json() == {"error": "signup_expired"}


# --- linking and unlinking --------------------------------------------------------------------


PASSWORD = "a fictitious password"  # make()'s


def start_link(client, token, then="/x", password=PASSWORD):
    """« Relier à OpenStreetMap »: the password again; the answer carries OSM's URL."""
    return client.post("/api/osm/link", json={"password": password, "then": then},
                       headers=signed(token))  # fmt: skip


def link(client, fake, token, sub=SUB, then="/?ui=punk&s=compte"):
    r = start_link(client, token, then)
    assert r.status_code == 200, r.text
    return back(client, fake.authorize(r.json()["url"], sub, "Fictitious Mapper"))


def test_linking_an_account_with_a_password(client, fake, pg_dsn):
    aid = make(pg_dsn, "lin")
    token = session_of(pg_dsn, aid)
    r = start_link(client, token)
    assert "osm-flow" in set_cookies(r)
    flow = osm.flows.get(query(r.json()["url"])["state"])
    assert (flow.kind, flow.account) == ("link", aid)
    r = back(client, fake.authorize(r.json()["url"]))
    # No new session: the link is for the account that started it.
    assert location(r) == "/x?osm=linked" and only_flow_cleared(r)
    me = client.get("/api/me", headers=signed(token)).json()
    assert (me["osm"], me["password"]) == (True, True)
    assert fake.revoked == fake.issued
    assert location(link(client, fake, token)).endswith("osm=linked")  # again: still linked
    assert location(link(client, fake, token, sub=SUB + 1)).endswith("osm=link_other")
    assert accounts_with(pg_dsn, SUB) == [("lin", False)]


def test_an_osm_user_on_another_account_is_not_linked_again(client, fake, pg_dsn):
    make(pg_dsn, "fict-owner", password=False, osm_id=SUB)
    token = session_of(pg_dsn, make(pg_dsn, "lin"))
    assert location(link(client, fake, token)) == "/?ui=punk&s=compte&osm=link_taken"
    assert accounts_with(pg_dsn, SUB) == [("fict-owner", True)]


def test_an_account_disabled_meanwhile_is_not_linked(client, fake, pg_dsn):
    aid = make(pg_dsn, "lin")
    token = session_of(pg_dsn, aid)
    r = start_link(client, token)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (aid,))
    assert location(back(client, fake.authorize(r.json()["url"]))) == "/x?osm=failed&osm_why=compte"
    assert accounts_with(pg_dsn, SUB) == []


def test_unlinking_needs_a_password_to_sign_in_with(client, pg_dsn):
    token = session_of(pg_dsn, make(pg_dsn, "lin", osm_id=SUB))
    r = client.post("/api/osm/unlink", json={}, headers=signed(token))
    assert r.status_code == 204
    assert client.get("/api/me", headers=signed(token)).json()["osm"] is False
    only_osm = session_of(pg_dsn, make(pg_dsn, "fict-osm", password=False, osm_id=SUB + 1))
    r = client.post("/api/osm/unlink", json={}, headers=signed(only_osm))
    assert (r.status_code, r.json()) == (409, {"error": "no_password"})
    assert accounts_with(pg_dsn, SUB + 1) == [("fict-osm", True)]


# --- the release, and what the API says of the person ------------------------------------------


def test_the_user_agent_names_the_release(tmp_path):
    module = tmp_path / "api" / "releases" / "20261010T120000Z" / "pipeline" / "lacarte" / "api"
    module.mkdir(parents=True)
    (tmp_path / "api" / "current").symlink_to(module.parents[2])
    linked = tmp_path / "api" / "current" / "pipeline" / "lacarte" / "api" / "osm.py"
    assert osm.release(linked) == "20261010T120000Z"
    assert osm.release(Path("/x/y/pipeline/lacarte/api/osm.py")) == "dev"
    assert osm.user_agent() == "SurveillanceWorld/dev"


def test_me_says_osm_and_password_only(client, pg_dsn):
    token = session_of(pg_dsn, make(pg_dsn, "lin"))
    me = client.get("/api/me", headers=signed(token)).json()
    assert (me["osm"], me["password"]) == (False, True)
    assert not [k for k in me if "osm" in k and k != "osm"]


def test_an_osm_account_without_password_deletes_itself_by_its_pseudonym(client, pg_dsn):
    """No password to ask: the pseudonym retyped exactly confirms « Supprimer mon compte »;
    anything else is refused and keeps the account."""
    aid = make(pg_dsn, "osmdel", password=False, osm_id=424242)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        token = auth.open_session(conn, aid, date.today())
    wrong = client.post("/api/me/delete", json={"pseudonym": "OSMDEL"}, headers=signed(token))
    assert (wrong.status_code, wrong.json()) == (400, {"error": "confirmation"})
    none = client.post("/api/me/delete", json={}, headers=signed(token))
    assert none.status_code == 400
    ok = client.post("/api/me/delete", json={"pseudonym": "osmdel"}, headers=signed(token))
    assert ok.status_code == 204
    with psycopg.connect(pg_dsn) as conn:
        assert conn.execute("SELECT count(*) FROM accounts WHERE id = %s", (aid,)).fetchone() == (
            0,
        )


def test_a_callback_opened_in_another_browser_leads_nowhere(client, fake, pg_dsn):
    """Login CSRF and forced linking: a callback URL handed to someone else (another cookie
    jar, without the flow cookie) is refused and spent, before the code is exchanged."""
    started = go_to_osm(client)
    assert "osm-flow" in set_cookies(started)
    grant = fake.authorize(location(started), SUB, "Attacker")
    client.cookies.clear()  # the victim's browser: no flow cookie
    r = back(client, grant)
    assert location(r) == "/?ui=punk&osm=failed&osm_why=navigateur" and only_flow_cleared(r)
    assert accounts_with(pg_dsn, SUB) == []
    # Spent: the attacker's own browser cannot use it either now.
    r2 = back(client, grant)
    assert location(r2) == "/?ui=punk&osm=failed&osm_why=flux_inconnu"


def test_linking_asks_the_password_again(client, pg_dsn):
    """A session alone (stolen) cannot attach another OSM user: the password is asked, a
    wrong one is refused with the sign-in's answer and starts no flow; an account without a
    password is an OSM account, linked already."""
    token = session_of(pg_dsn, make(pg_dsn, "lin"))
    r = start_link(client, token, password="not it")
    assert (r.status_code, r.json()) == (401, {"error": "credentials"})
    assert "osm-flow" not in set_cookies(r)
    only_osm = session_of(pg_dsn, make(pg_dsn, "fict-osm", password=False, osm_id=SUB + 2))
    r = start_link(client, only_osm)
    assert (r.status_code, r.json()) == (409, {"error": "no_password"})
