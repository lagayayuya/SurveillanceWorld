"""« Signaler une erreur » over HTTP (lot R1b, lacarte.api.registre, migration 026): a reader
reports an error in a register document, without an account; the contributions' protections
(the Origin and JSON guard, the rate limit, a declared robot refused, contributions closed)
apply; nothing about the sender is kept, signed in or not. Fictitious reports in the
throwaway database."""

import logging
from datetime import date

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from sessions import ORIGIN

from lacarte import participation
from lacarte.api import app as api

JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
URL = "/api/registre/signalement"
DOC, AFFAIRE = "216902833000132020_32323500~0", "216902833000132020_32323500"
REPORT = {"evenement": DOC, "affaire": AFFAIRE, "category": "date",
          "correction": "Attribué le 5 février 2021,\r\nselon l'avis de résultat.",
          "source": "https://www.boamp.fr/pages/avis/?q=idweb:21-16838",
          "contact": "  lecteur@example.org "}  # fmt: skip


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh(pg_dsn, client):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM registre_reports")
    api.limits.hits.clear()
    client.cookies.clear()


def send(client, body=None, headers=None, **changes):
    return client.post(URL, json={**(body or REPORT), **changes}, headers=headers or JSON)


def stored(dsn) -> list[dict]:
    with psycopg.connect(dsn) as conn:
        cur = conn.execute("SELECT * FROM registre_reports ORDER BY correction")
        names = [d.name for d in cur.description]
        return [dict(zip(names, row, strict=True)) for row in cur.fetchall()]


def test_a_report_is_received_pending_with_the_day_only(client, pg_dsn):
    r = send(client)
    assert (r.status_code, r.json()) == (201, {"ok": True})
    [row] = stored(pg_dsn)
    assert row.pop("id")
    assert row == {
        "evenement": DOC, "affaire": AFFAIRE, "category": "date",
        "correction": "Attribué le 5 février 2021,\nselon l'avis de résultat.",
        "source": REPORT["source"], "contact": "lecteur@example.org",
        "received_on": date.today(), "state": "pending", "decided_on": None,
        "decided_by_id": None, "decided_by": None, "field": None, "value": None,
        "reason": None,
    }  # fmt: skip


def test_signed_in_nothing_of_the_account_is_kept(client, pg_dsn):
    """Signed in, the report is the same: no column can hold who sent it."""
    r = send(client, headers=sessions.headers("ana"), source=None, contact="")
    assert r.status_code == 201, r.text
    [row] = stored(pg_dsn)
    aid = sessions.account_id("ana")
    assert aid not in {str(v) for v in row.values()}
    assert "ana" not in {str(v) for v in row.values()}
    assert (row["source"], row["contact"]) == (None, None)


def test_the_source_and_the_contact_are_optional(client, pg_dsn):
    body = {k: v for k, v in REPORT.items() if k not in ("source", "contact")}
    assert send(client, body).status_code == 201
    assert send(client, body, correction="Autre", source="  ", contact=None).status_code == 201
    assert [(r["source"], r["contact"]) for r in stored(pg_dsn)] == [(None, None)] * 2


@pytest.mark.parametrize(("changes", "field"), [
    ({"evenement": "x y"}, "evenement"),
    ({"evenement": ""}, "evenement"),
    ({"evenement": "a" * 81}, "evenement"),
    ({"affaire": "../a"}, "affaire"),
    ({"category": "prix"}, "category"),
    ({"correction": " \n\t "}, "correction"),
    ({"correction": "x" * 1001}, "correction"),
    ({"correction": 12}, "correction"),
    ({"source": "http://www.boamp.fr/x"}, "source"),
    ({"source": "javascript:alert(1)"}, "source"),
    ({"source": "https://a b.fr/"}, "source"),
    ({"source": "https://user@evil.example/"}, "source"),
    ({"source": "https://example.org/" + "a" * 490}, "source"),
    ({"contact": "x" * 201}, "contact"),
])  # fmt: skip
def test_anything_else_is_refused_by_its_field(client, pg_dsn, changes, field):
    r = send(client, **changes)
    assert (r.status_code, r.json()) == (422, {"error": "invalid", "fields": [field]})
    assert stored(pg_dsn) == []


def test_a_missing_field_is_named(client):
    body = {k: v for k, v in REPORT.items() if k != "category"}
    assert send(client, body).json() == {"error": "invalid", "fields": ["category"]}


def test_control_characters_become_spaces_lines_stay_in_the_correction_only(client, pg_dsn):
    send(client, correction="a\u0000b\nc​d", contact="x\ny")
    [row] = stored(pg_dsn)
    assert (row["correction"], row["contact"]) == ("a b\nc d", "x y")


def test_the_rate_one_bucket_for_readers_not_signed_in_one_per_account(client, pg_dsn):
    per_minute = participation.rules()["limits"]["reports_per_minute"]
    for i in range(per_minute):
        assert send(client, correction=f"n{i:03d}").status_code == 201
    r = send(client, correction="one too many")
    assert (r.status_code, r.json()) == (429, {"error": "rate"})
    # Signed in: the account's own bucket.
    assert send(client, headers=sessions.headers("ana"), correction="ana's").status_code == 201
    assert len(stored(pg_dsn)) == per_minute + 1


@pytest.mark.parametrize("agent", ["Googlebot/2.1 (+http://www.google.com/bot.html)",
                                   "Mozilla/5.0 (compatible; bingbot/2.0)", "HeadlessChrome",
                                   ""])  # fmt: skip
def test_a_declared_robot_is_refused(client, pg_dsn, agent):
    r = send(client, headers={**JSON, "User-Agent": agent})
    assert (r.status_code, r.json()) == (403, {"error": "robot"})
    assert stored(pg_dsn) == []


def test_closed_contributions_close_it(client, pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = false WHERE key = 'contributions_open'")
    api.switches.forget()
    try:
        r = send(client)
        assert (r.status_code, r.json()) == (403, {"error": "closed"})
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("UPDATE site_settings SET value = true WHERE key = 'contributions_open'")
        api.switches.forget()
    assert stored(pg_dsn) == []
    assert ("POST", URL) in api.CLOSED_ROUTES


def test_another_origin_or_not_json_is_refused(client, pg_dsn):
    r = send(client, headers={**JSON, "Origin": "https://elsewhere.example"})
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    r = send(client, headers={"Content-Type": "application/json"})
    assert (r.status_code, r.json()) == (403, {"error": "origin"})
    r = client.post(URL, content="evenement=x", headers={**JSON, "Content-Type": "text/plain"})
    assert (r.status_code, r.json()) == (415, {"error": "content_type"})
    assert stored(pg_dsn) == []


def test_nothing_of_a_report_or_its_sender_is_logged(client, caplog):
    with caplog.at_level(logging.DEBUG):
        assert send(client, headers={**JSON, "X-Forwarded-For": "192.0.2.7"}).status_code == 201
        send(client, headers={**JSON, "User-Agent": "Googlebot/2.1"})
        send(client, correction="")
    said = "\n".join(r.getMessage() for r in caplog.records)
    for secret in ("192.0.2.7", "testclient", "lecteur", DOC, "février", "Googlebot"):
        assert secret not in said
