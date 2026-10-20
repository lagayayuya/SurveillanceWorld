"""« Télécharger mes données » (GET /api/me/export): the person's own data as a JSON
attachment — the account, its contributions, its points, its sessions —, nothing about
anyone else. Fictitious accounts and contributions in the throwaway database."""

import json
import uuid
from datetime import date

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from sessions import ORIGIN

from lacarte.api import app as api

JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
COLS = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
        " geom, payload, body_sha256, osm_tags, answer, status, decided_by_id,"
        " decided_on, on_site")  # fmt: skip


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture
def people(pg_dsn):
    """exa (contributor), exb (another one), exr (the reviewer who decided on exa's send)."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE pseudonym IN ('exa', 'exb', 'exr', 'ext')")
    sessions.forget()
    return {n: sessions.account_id(n, role="reviewer" if n == "exr" else None)
            for n in ("exa", "exb", "exr")}  # fmt: skip


def contribution(dsn, author_id, *, kind="verify", answer="present", status="pending",
                 decided_by=None, on_site=True) -> str:  # fmt: skip
    uid = str(uuid.uuid4())
    decided_on = "'2026-10-05'" if decided_by else "NULL"
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            f"INSERT INTO contributions ({COLS}) VALUES (%s, %s, 'n4242', 'n', 4242, 3, 'b',"
            " %s, '2026-10-02', ST_SetSRID(ST_MakePoint(644000, 6866000), 2154),"
            " %s, 'x', '{}', %s, %s, %s, " + decided_on + ", %s)",
            (uid, kind, author_id, json.dumps({"placement": "free", "bands": {"big": 1}}),
             answer, status, decided_by, on_site),
        )  # fmt: skip
    return uid


def export(client, who):
    r = client.get("/api/me/export", headers={"Cookie": f"session={sessions.token(who)}"})
    assert r.status_code == 200, r.text
    return r


def test_signed_out_it_is_refused(client):
    assert (client.get("/api/me/export").status_code,
            client.get("/api/me/export").json()) == (401, {"error": "session"})  # fmt: skip


def test_an_attachment_of_json(client, people):
    r = export(client, "exa")
    assert r.headers["content-disposition"] == (
        'attachment; filename="surveillance-world-mes-donnees.json"'
    )
    assert r.headers["content-type"].startswith("application/json")
    assert r.headers["cache-control"] == "no-store"
    assert set(r.json()) == {"exported_on", "account", "contributions", "cameras", "points",
                             "sessions", "journal"}  # fmt: skip


def test_the_account_its_contributions_points_and_sessions(client, people, pg_dsn):
    exa, exb, exr = people["exa"], people["exb"], people["exr"]
    mine = contribution(pg_dsn, exa, status="validated", decided_by=exr)
    waiting = contribution(pg_dsn, exa, kind="verify", answer="not_found", on_site=None)
    theirs = contribution(pg_dsn, exb)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET leaderboard = true, osm_id = 98765, osm_server = 'live'"
                     " WHERE id = %s", (exa,))  # fmt: skip
        conn.execute("INSERT INTO osm_write VALUES (%s, 'dev', 555, '\\x00', '2026-10-01')", (exa,))
        conn.execute("INSERT INTO osm_publications VALUES (%s, 'dev', 'published', NULL, 77,"
                     " '2026-10-01')", (mine,))  # fmt: skip
    sessions.forget()
    r = export(client, "exa")
    data = r.json()
    account = data["account"]
    assert account == {
        "pseudonym": "exa", "since": account["since"], "role": "contributor",
        "password": True, "osm": {"linked": True, "id": 98765, "server": "live"},
        "leaderboard": True, "history_pseudonym": False, "test": False,
        "publish": {"on": True, "server": "dev", "osm_id": 555, "since": "2026-10",
                    "consent_day": date.today().isoformat(), "last_error": None},
    }  # fmt: skip
    by = {c["uuid"]: c for c in data["contributions"]}
    assert set(by) == {mine, waiting}
    c = by[mine]
    assert (c["kind"], c["camera"], c["answer"], c["day"], c["status"], c["on_site"]) == (
        "verify",
        "n4242",
        "present",
        "2026-10-02",
        "validated",
        True,
    )
    assert "duration_ms" not in c and c["decided_on"] == "2026-10-05"
    assert c["details"] == {"placement": "free"}  # the server's bands left out
    assert c["osm"] == [{"server": "dev", "state": "published", "month": "2026-10",
                         "changeset": 77}]  # fmt: skip
    assert 2.2 < c["lng"] < 2.3 and 48.85 < c["lat"] < 48.95  # La Défense, in degrees
    assert by[waiting]["on_site"] is None and by[waiting]["osm"] == []
    assert data["points"]["by_month"] and data["points"]["pending"] >= 0
    assert data["sessions"]["count"] == 1 and len(data["sessions"]["expires_on"]) == 1
    # Nothing about anyone else: not the other contributor, not the reviewer.
    text = r.text
    for other in ("exb", "exr", theirs, exb, exr):
        assert other not in text, other
    assert "decided_by" not in text and "token" not in text and "password_hash" not in text


def test_an_account_without_anything_exports_empty_lists(client, people):
    data = export(client, "exb").json()
    assert data["contributions"] == []
    assert data["points"] == {"by_month": [], "pending": 0}
    assert data["account"]["osm"] == {"linked": False, "id": None, "server": None}
    assert data["account"]["publish"]["on"] is False


def test_a_test_account_exports_too(client, people, pg_dsn):
    aid = sessions.account_id("ext")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET test = true WHERE id = %s", (aid,))
    contribution(pg_dsn, aid)
    data = export(client, "ext").json()
    assert data["account"]["test"] is True and len(data["contributions"]) == 1


def test_the_journal_whole_where_one_acted_day_and_action_where_it_is_about_one(
    client, people, pg_dsn
):
    """Lot 2: a reviewer's own lines whole; a line about the person, its day and action
    only (never who acted); nobody else's."""
    exa, exr = people["exa"], people["exr"]
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM admin_log")
        conn.execute(
            "INSERT INTO admin_log (actor_id, actor, action, target_account, target_name,"
            " target, detail) VALUES (%s, 'exr', 'decide', %s, 'exa', 'u1',"
            " '{\"from\": \"pending\", \"to\": \"validated\"}'),"
            " (%s, 'exr', 'hide', NULL, NULL, 'n42', NULL),"
            " (NULL, '', 'signin_refused', %s, 'exr', NULL, NULL)",
            (exr, exa, exr, exr),
        )  # fmt: skip
    sessions.forget()
    about = export(client, "exa").json()["journal"]
    assert [set(e) for e in about] == [{"day", "action"}] and about[0]["action"] == "decide"
    acted = export(client, "exr").json()["journal"]
    assert [(e["action"], e.get("actor"), e.get("target")) for e in acted] == [
        ("decide", "exr", "u1"),
        ("hide", "exr", "n42"),
        ("signin_refused", None, None),  # about exr: who tried is nobody's to say
    ]
    assert acted[0]["detail"] == {"from": "pending", "to": "validated"}
    assert "target_name" not in acted[0] and "exa" not in json.dumps(acted)  # not exa's name
    assert "exr" not in json.dumps(about)
    assert export(client, "exb").json()["journal"] == []
