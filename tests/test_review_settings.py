"""« Réglages » (lot 2 « Administrer »): an administrator reads the site's switches and the
deploy's read-only lines, changes a switch after the password again (taking effect at once,
journalled), and only an administrator, reauthenticated, exports the CSV. Fictitious
accounts in the throwaway database."""

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient

from lacarte.api import app as api

# Each switch at its default (migration 022: writing to the live server off).
DEFAULTS = "UPDATE site_settings SET value = (key <> 'osm_write_live'), changed_on = NULL"
KEYS = {"contributions_open", "signups_open", "osm_sync", "osm_write_live", "publisher", "osm"}


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def opened(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM admin_log")
        conn.execute(
            "UPDATE site_settings SET value = (key <> 'osm_write_live'), changed_on = NULL"
        )
    api.switches.forget()
    yield
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute(
            "UPDATE site_settings SET value = (key <> 'osm_write_live'), changed_on = NULL"
        )
    api.switches.forget()


def get(client, who="rev"):
    return client.get("/api/review/settings", headers=sessions.headers(who))


def put(client, key, value, who="rev"):
    return client.post("/api/review/settings", json={"key": key, "value": value},
                       headers=sessions.headers(who))  # fmt: skip


def lines(dsn):
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT actor, action, target, detail FROM admin_log"
                            " ORDER BY seq").fetchall()  # fmt: skip


def test_the_settings_say_the_switches_and_the_deploy_s_lines(client, monkeypatch):
    monkeypatch.setattr(api.settings, "publisher", "Camille Exemple")
    r = get(client)
    assert r.status_code == 200 and set(r.json()) == KEYS
    s = r.json()
    assert (s["contributions_open"], s["signups_open"], s["publisher"]) == (
        True, True, "Camille Exemple")  # fmt: skip
    assert (s["osm_sync"], s["osm_write_live"]) == (True, False)
    server = api.publish_server()
    assert s["osm"] == {"login_server": api.settings.osm_login_server,
                        "write_offered": server is not None,
                        "write_server": server.name if server else None,
                        "live_client": api.live_write_server() is not None}  # fmt: skip


def test_a_switch_changes_at_once_after_the_password_and_is_journalled(client, pg_dsn):
    sessions.token("rev")
    sessions.mark("rev", reauth=False)
    try:
        r = put(client, "contributions_open", False)
        assert (r.status_code, r.json()) == (403, {"error": "reauth"})
    finally:
        sessions.mark("rev")
    r = put(client, "contributions_open", False)
    assert r.status_code == 200 and r.json()["contributions_open"] is False
    assert client.get("/api/config").json()["contributions"] is False  # no wait, no restart
    r = client.post("/api/preview", json={}, headers=sessions.headers("ana"))
    assert (r.status_code, r.json()) == (403, {"error": "closed"})
    put(client, "contributions_open", False)  # no change: no line
    put(client, "signups_open", False)
    assert get(client).json()["signups_open"] is False
    put(client, "contributions_open", True)
    with psycopg.connect(pg_dsn) as conn:
        days = conn.execute("SELECT key, changed_on = current_date FROM site_settings"
                            " WHERE changed_on IS NOT NULL ORDER BY key").fetchall()  # fmt: skip
    assert days == [("contributions_open", True), ("signups_open", True)]
    assert lines(pg_dsn) == [("rev", "setting", "contributions_open", {"value": False}),
                             ("rev", "setting", "signups_open", {"value": False}),
                             ("rev", "setting", "contributions_open", {"value": True})]  # fmt: skip
    assert put(client, "publisher", True).status_code == 422  # the deploy's, not a switch


def test_administrators_only(client):
    for who, expected in (("ana", (401, {"error": "privileged"})),
                          ("rvw", (403, {"error": "admin"}))):  # fmt: skip
        assert (get(client, who).status_code, get(client, who).json()) == expected
        r = put(client, "signups_open", False, who=who)
        assert (r.status_code, r.json()) == expected


def test_the_csv_is_the_administrator_s_after_the_password_and_journalled(client, pg_dsn):
    path = "/api/review/export.csv"
    r = client.get(path, headers=sessions.headers("rvw"))
    assert (r.status_code, r.json()) == (403, {"error": "admin"})
    sessions.token("rev")
    sessions.mark("rev", reauth=False)
    try:
        r = client.get(path, headers=sessions.headers("rev"))
        assert (r.status_code, r.json()) == (403, {"error": "reauth"})
    finally:
        sessions.mark("rev")
    r = client.get(path, headers=sessions.headers("rev"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    [(actor, action, target, detail)] = lines(pg_dsn)
    assert (actor, action, target, set(detail)) == ("rev", "export_csv", None, {"rows"})


LIVE = {"osm_live_write_url": "https://osm.test", "osm_live_write_client_id": "fake-id",
        "osm_live_write_client_secret": "fake-secret"}  # fmt: skip


def test_the_osm_switches_suspend_the_job_and_move_writing_to_live(client, pg_dsn, monkeypatch):
    """Migration 022: osm_sync and osm_write_live, journalled like the others. Writing to the
    live server needs its client: refused without (409 no_live_client), nothing changed;
    with it, the write server is the live one at once (signing in on the test server here:
    offered, as the preview)."""
    s = api.settings
    monkeypatch.setattr(s, "osm_login_server", "dev")
    monkeypatch.setattr(s, "osm_token_key", bytes(range(32)))
    for k in LIVE:
        monkeypatch.setattr(s, k, "")
    assert get(client).json()["osm"]["live_client"] is False
    r = put(client, "osm_write_live", True)
    assert (r.status_code, r.json()) == (409, {"error": "no_live_client"})
    assert put(client, "osm_write_live", False).status_code == 200  # turning off: always
    for k, v in LIVE.items():
        monkeypatch.setattr(s, k, v)
    r = put(client, "osm_write_live", True)
    assert r.status_code == 200 and r.json()["osm_write_live"] is True
    assert r.json()["osm"] == {"login_server": "dev", "write_offered": True,
                               "write_server": "live", "live_client": True}  # fmt: skip
    assert api.write_server().name == "live" and api.write_server().url == "https://osm.test"
    r = put(client, "osm_sync", False)
    assert r.status_code == 200 and r.json()["osm_sync"] is False
    assert lines(pg_dsn) == [("rev", "setting", "osm_write_live", {"value": True}),
                             ("rev", "setting", "osm_sync", {"value": False})]  # fmt: skip
