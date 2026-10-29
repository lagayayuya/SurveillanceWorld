"""/revue « Registre » (lot R1b, lacarte.api.registre): a reviewer lists the reports waiting,
one row per reported document, and accepts one (the field and value the build applies, and
why) or refuses it; either erases the reader's contact and is journalled; rate-limited as
every review decision; reviewers and administrators only. Fictitious reports in the
throwaway database."""

from datetime import date, timedelta

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient

from lacarte import participation
from lacarte.api import app as api

URL = "/api/review/registre"
DOC, AFFAIRE = "216902833000132020_32323500~0", "216902833000132020_32323500"
OTHER, OTHER_AFFAIRE = "e2~1", "e2"
TODAY = date.today()


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh(pg_dsn, client):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM registre_reports")
        conn.execute("DELETE FROM admin_log")
    api.limits.hits.clear()
    client.cookies.clear()


def insert(dsn, evenement=DOC, affaire=AFFAIRE, days=0, **row) -> str:
    row = {"evenement": evenement, "affaire": affaire, "category": "montant",
           "correction": "Le montant est de 12 000 €.", "contact": "lecteur@example.org",
           "received_on": TODAY - timedelta(days=days), **row}  # fmt: skip
    with psycopg.connect(dsn, autocommit=True) as conn:
        return conn.execute(f"INSERT INTO registre_reports ({', '.join(row)}) VALUES"
                            f" ({', '.join(['%s'] * len(row))}) RETURNING id::text",
                            list(row.values())).fetchone()[0]  # fmt: skip


def row(dsn, rid) -> dict:
    with psycopg.connect(dsn) as conn:
        cur = conn.execute("SELECT * FROM registre_reports WHERE id = %s", (rid,))
        names = [d.name for d in cur.description]
        found = cur.fetchone()
        return dict(zip(names, found, strict=True)) if found else {}


def journal(dsn) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT actor, action, target, detail FROM admin_log"
                            " ORDER BY seq").fetchall()  # fmt: skip


def decide(client, who="rvw", **body):
    return client.post(URL, json=body, headers=sessions.headers(who))


def test_the_list_one_row_per_document_the_oldest_first(client, pg_dsn):
    a = insert(pg_dsn, days=3, category="date", correction="Attribué en 2021",
               source="https://www.boamp.fr/x")  # fmt: skip
    b = insert(pg_dsn, days=1, contact=None)
    c = insert(pg_dsn, OTHER, OTHER_AFFAIRE, days=2, category="autre", correction="?")
    insert(pg_dsn, OTHER, OTHER_AFFAIRE, days=9, state="refused", decided_on=TODAY,
           decided_by="rvw", contact=None)  # fmt: skip
    r = client.get(URL, headers=sessions.headers("rvw"))
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["pending"] == 3
    assert got["fields"] == ["montant", "date", "entreprises", "insee", "beneficiaire",
                             "cameras", "affaire"]  # fmt: skip
    assert [(d["evenement"], d["affaire"], d["age_days"]) for d in got["documents"]] == [
        (DOC, AFFAIRE, 3), (OTHER, OTHER_AFFAIRE, 2)]  # fmt: skip
    first = got["documents"][0]["reports"]
    assert [x["id"] for x in first] == [a, b]
    assert first[0] == {"id": a, "category": "date", "correction": "Attribué en 2021",
                        "source": "https://www.boamp.fr/x", "contact": "lecteur@example.org",
                        "received_on": (TODAY - timedelta(days=3)).isoformat(),
                        "age_days": 3}  # fmt: skip
    assert first[1]["contact"] is None and first[1]["source"] is None
    assert [x["id"] for x in got["documents"][1]["reports"]] == [c]


def test_nothing_waits(client):
    r = client.get(URL, headers=sessions.headers("rev"))
    assert r.json()["pending"] == 0 and r.json()["documents"] == []


@pytest.mark.parametrize("who", [None, "ana"])
def test_reviewers_and_administrators_only(client, pg_dsn, who):
    rid = insert(pg_dsn)
    hdrs = sessions.headers(who) if who else {"Origin": sessions.ORIGIN,
                                              "Content-Type": "application/json"}  # fmt: skip
    r = client.get(URL, headers=hdrs)
    assert (r.status_code, r.json()) == (401, {"error": "privileged"})
    r = client.post(URL, json={"id": rid, "decision": "refuse"}, headers=hdrs)
    assert (r.status_code, r.json()) == (401, {"error": "privileged"})
    assert row(pg_dsn, rid)["state"] == "pending"


def test_accept_keeps_the_field_the_value_and_the_reason_erases_the_contact(client, pg_dsn):
    rid = insert(pg_dsn, category="date", correction="Attribué le 5 février 2021, pas 2020")
    r = decide(client, id=rid, decision="accept", field="date", value="2021-02-05",
               reason="BOAMP, avis de résultat 21-16838")  # fmt: skip
    assert (r.status_code, r.json()) == (200, {"id": rid, "state": "accepted", "field": "date",
                                               "value": "2021-02-05"})  # fmt: skip
    got = row(pg_dsn, rid)
    assert (got["state"], got["decided_on"], got["decided_by"], got["field"], got["value"],
            got["reason"], got["contact"]) == (
        "accepted", TODAY, "rvw", "date", "2021-02-05", "BOAMP, avis de résultat 21-16838",
        None)  # fmt: skip
    assert got["decided_by_id"] is not None
    # The journal: the document and the field, never the reader's text.
    assert journal(pg_dsn) == [("rvw", "registre_accept", DOC, {"report": rid,
                                                                "field": "date"})]  # fmt: skip
    assert client.get(URL, headers=sessions.headers("rvw")).json()["pending"] == 0


@pytest.mark.parametrize(("field", "value", "kept"), [
    ("montant", 12000.0, 12000),
    ("montant", 1234.5, 1234.5),
    ("entreprises", ["431903954", "256900994"], ["431903954", "256900994"]),
    ("insee", "69283", "69283"),
    ("beneficiaire", "  Commune  de Mions ", "Commune de Mions"),
    ("cameras", 12, 12),
    ("affaire", "216902833000132020_32323501", "216902833000132020_32323501"),
])  # fmt: skip
def test_each_field_its_value_normalised(client, pg_dsn, field, value, kept):
    rid = insert(pg_dsn)
    r = decide(client, id=rid, decision="accept", field=field, value=value, reason="Vérifié")
    assert r.status_code == 200, r.text
    assert r.json()["value"] == kept
    assert row(pg_dsn, rid)["value"] == kept


@pytest.mark.parametrize(("field", "value"), [
    ("montant", "12 000"), ("montant", -1), ("montant", True), ("date", "2021-02-30"),
    ("date", "05/02/2021"), ("entreprises", ["43190395"]), ("entreprises", "431903954"),
    ("insee", "6928"), ("cameras", 1.5), ("affaire", "a b"), ("beneficiaire", ""),
])  # fmt: skip
def test_a_value_that_does_not_fit_its_field_is_refused(client, pg_dsn, field, value):
    rid = insert(pg_dsn)
    r = decide(client, id=rid, decision="accept", field=field, value=value, reason="r")
    assert (r.status_code, r.json()) == (422, {"error": "value"})
    assert row(pg_dsn, rid)["state"] == "pending" and journal(pg_dsn) == []


def test_an_acceptance_names_what_it_lacks(client, pg_dsn):
    rid = insert(pg_dsn)
    r = decide(client, id=rid, decision="accept", field="montant", reason=" ")
    assert (r.status_code, r.json()) == (422, {"error": "invalid", "fields": ["value", "reason"]})
    r = decide(client, id=rid, decision="accept", field="prix", value=1, reason="r")
    assert (r.status_code, r.json()) == (422, {"error": "invalid", "fields": ["field"]})
    assert row(pg_dsn, rid)["state"] == "pending"


def test_refuse_erases_the_contact_and_keeps_no_value(client, pg_dsn):
    rid = insert(pg_dsn)
    r = decide(client, "rev", id=rid, decision="refuse", field="montant", value=1, reason="r")
    assert (r.status_code, r.json()) == (200, {"id": rid, "state": "refused"})
    got = row(pg_dsn, rid)
    assert (got["state"], got["decided_by"], got["field"], got["value"], got["reason"],
            got["contact"]) == ("refused", "rev", None, None, None, None)  # fmt: skip
    assert journal(pg_dsn) == [("rev", "registre_refuse", DOC, {"report": rid})]


def test_decided_once_unknown_or_malformed(client, pg_dsn):
    rid = insert(pg_dsn)
    assert decide(client, id=rid, decision="refuse").status_code == 200
    r = decide(client, id=rid, decision="accept", field="cameras", value=3, reason="r")
    assert (r.status_code, r.json()) == (409, {"error": "decided"})
    r = decide(client, id="7b0c5a4e-2f7e-4a0b-9d7e-0c5b8f9e1a2d", decision="refuse")
    assert (r.status_code, r.json()) == (404, {"error": "unknown_report"})
    r = decide(client, id="not-a-uuid", decision="refuse")
    assert (r.status_code, r.json()) == (422, {"error": "uuid"})
    assert len(journal(pg_dsn)) == 1


def test_decisions_share_the_review_bucket(client, pg_dsn, monkeypatch):
    rules = participation.rules()
    limited = {**rules, "limits": {**rules["limits"], "review_per_minute": 2}}
    monkeypatch.setattr(participation, "rules", lambda: limited)
    ids = [insert(pg_dsn, correction=f"n{i}") for i in range(3)]
    assert decide(client, id=ids[0], decision="refuse").status_code == 200
    assert decide(client, id=ids[1], decision="accept", field="cameras", value=4,
                  reason="r").status_code == 200  # fmt: skip
    r = decide(client, id=ids[2], decision="refuse")
    assert (r.status_code, r.json()) == (429, {"error": "rate"})
    assert row(pg_dsn, ids[2])["state"] == "pending"


def test_the_journal_files_them_under_decisions(client, pg_dsn):
    rid = insert(pg_dsn)
    decide(client, id=rid, decision="accept", field="montant", value=12000, reason="r")
    r = client.get("/api/review/log?type=decisions", headers=sessions.headers("rev"))
    [entry] = r.json()["entries"]
    assert (entry["action"], entry["target"], entry["camera"]) == ("registre_accept", DOC, None)
    r = client.get("/api/review/log?type=admin", headers=sessions.headers("rev"))
    assert r.json()["entries"] == []
