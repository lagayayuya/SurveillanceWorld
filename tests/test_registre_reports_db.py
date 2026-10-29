"""The register's reports in the database (migration 026, « Signaler une erreur »): what a
report keeps (nothing about its sender), its checks, what the API's role may do with it, and
the retention — a contact erased at the latest 90 days after the day received, a refused
report deleted 12 months after its decision, an accepted one kept (rules/stats.yaml).
Fictitious rows in the throwaway database."""

from datetime import date

import psycopg
import pytest
from test_accounts_db import at
from test_db import sql

from lacarte import db, regions
from lacarte.api import stats

MIGRATION = db.MIGRATIONS / "026_registre_reports.sql"
TODAY = date(2026, 10, 29)
# Every column a report has: what it is about and what it says, the day, the decision. No
# address, no user agent, no account of the sender, no time of day.
COLUMNS = {
    "id": "uuid", "evenement": "text", "affaire": "text", "category": "text",
    "correction": "text", "source": "text", "contact": "text", "received_on": "date",
    "state": "text", "decided_on": "date", "decided_by_id": "uuid", "decided_by": "text",
    "field": "text", "value": "jsonb", "reason": "text",
}  # fmt: skip


@pytest.fixture(autouse=True)
def empty(pg_dsn, pg_loaded):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM registre_reports")


def insert(dsn, **row) -> str:
    row = {"evenement": "e1~0", "affaire": "e1", "category": "montant",
           "correction": "12 000 €", **row}  # fmt: skip
    cols = ", ".join(row)
    with psycopg.connect(dsn, autocommit=True) as conn:
        return conn.execute(f"INSERT INTO registre_reports ({cols}) VALUES"
                            f" ({', '.join(['%s'] * len(row))}) RETURNING id::text",
                            list(row.values())).fetchone()[0]  # fmt: skip


def run_at(dsn, today: date) -> tuple[int, int]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        return conn.execute("SELECT contacts, reports FROM lacarte_retention_at(%s)",
                            (today,)).fetchone()  # fmt: skip


def test_a_report_keeps_nothing_about_its_sender(pg_dsn):
    rows = sql(pg_dsn, "SELECT column_name, data_type FROM information_schema.columns"
                       " WHERE table_name = 'registre_reports'")  # fmt: skip
    types = {"uuid": "uuid", "text": "text", "date": "date", "jsonb": "jsonb"}
    assert {c: types.get(t, t) for c, t in rows} == COLUMNS


@pytest.mark.parametrize(("row", "check"), [
    ({"category": "prix"}, "registre_reports_category"),
    ({"evenement": "e 1"}, "registre_reports_evenement"),
    ({"affaire": "a/b"}, "registre_reports_affaire"),
    ({"correction": ""}, "registre_reports_correction"),
    ({"correction": "x" * 1001}, "registre_reports_correction"),
    ({"source": "http://example.org/x"}, "registre_reports_source"),
    ({"source": "https://example.org/a b"}, "registre_reports_source"),
    ({"contact": "x" * 201}, "registre_reports_contact_length"),
    ({"state": "refused"}, "registre_reports_decision"),
    ({"state": "refused", "decided_on": "2026-10-29", "decided_by": "rvw",
      "contact": "lecteur"}, "registre_reports_contact"),
    ({"state": "accepted", "decided_on": "2026-10-29", "decided_by": "rvw"},
     "registre_reports_applied"),
    ({"state": "refused", "decided_on": "2026-10-29", "decided_by": "rvw", "field": "date",
      "value": '"2021-01-01"', "reason": "r"}, "registre_reports_applied"),
    ({"state": "accepted", "decided_on": "2026-10-29", "decided_by": "rvw", "field": "prix",
      "value": "1", "reason": "r"}, "registre_reports_field"),
])  # fmt: skip
def test_the_checks(pg_dsn, row, check):
    with pytest.raises(psycopg.errors.CheckViolation) as err:
        insert(pg_dsn, **row)
    assert err.value.diag.constraint_name == check


def test_a_decided_report_is_accepted_with_its_field_value_and_reason(pg_dsn):
    insert(pg_dsn, state="accepted", decided_on="2026-10-29", decided_by="rvw",
           field="montant", value="12000", reason="Le BOAMP donne 12 000 €.",
           source="https://www.boamp.fr/avis/detail/21-16838")  # fmt: skip
    assert sql(pg_dsn, "SELECT state, field, value::text FROM registre_reports") == [
        ["accepted", "montant", "12000"]]  # fmt: skip


def test_contacts_go_after_90_days_refused_reports_after_12_months(pg_dsn):
    """Received 2026-07-31 (90 days before the 29th of October): kept; the 30th: erased,
    pending or not. Refused on 2025-10-29: kept; the 28th: deleted. Accepted long ago:
    kept, it is the correction."""
    kept = insert(pg_dsn, contact="a", received_on="2026-07-31")
    gone = insert(pg_dsn, contact="b", received_on="2026-07-30")
    decided = {"decided_by": "rvw"}
    insert(pg_dsn, state="refused", decided_on="2025-10-29", **decided)
    insert(pg_dsn, state="refused", decided_on="2025-10-28", **decided)
    insert(pg_dsn, state="accepted", decided_on="2020-01-01", field="date",
           value='"2021-02-05"', reason="r", **decided)  # fmt: skip
    assert run_at(pg_dsn, TODAY) == (1, 1)
    assert run_at(pg_dsn, TODAY) == (0, 0)
    assert sql(pg_dsn, "SELECT id::text, contact FROM registre_reports WHERE state = 'pending'"
                       " ORDER BY contact NULLS LAST") == [[kept, "a"], [gone, ""]]  # fmt: skip
    assert sql(pg_dsn, "SELECT state, decided_on::text FROM registre_reports"
                       " WHERE state <> 'pending' ORDER BY 1, 2") == [
        ["accepted", "2020-01-01"], ["refused", "2025-10-29"]]  # fmt: skip


def test_the_rules_and_the_migration_say_the_same_durations():
    conf = stats.rules()
    text = MIGRATION.read_text()
    assert f"today - interval '{conf['report_contact_days']} days'" in text
    assert f"decided_on < today - interval '{conf['report_refused_months']} months'" in text
    words = (regions.ROOT / "db" / "retention.sql").read_text()
    assert f"older than {conf['report_contact_days']} days erased" in words
    assert f"refused more than {conf['report_refused_months']} months ago deleted" in words
    # 023's durations, carried over unchanged.
    assert f"today - interval '{conf['hour_retention_days']} days'" in text
    assert f"- interval '{conf['retention_months']} months'" in text
    assert f"today - interval '{conf['journal_retention_months']} months'" in text


def test_the_api_role_receives_lists_and_decides_never_deletes(pg_dsn, pg_loaded):
    """On a database set up as bootstrap.sh sets the server's, migrated to 026: the API's
    role inserts a report, reads it, writes a decision and erases a contact, never deletes
    one nor rewrites what the reader said; lacarte_retention() is still its to run, with
    023's rights."""
    dsn = at(pg_dsn, "reports_026", "026")
    can = "SELECT has_function_privilege({!r}, {!r}, 'EXECUTE')"
    assert sql(dsn, can.format("preview_api", "lacarte_retention()")) == [["t"]]
    assert sql(dsn, can.format("preview_api", "lacarte_retention_at(date)")) == [["f"]]
    assert sql(dsn, "SELECT proname, prosecdef, array_to_string(proconfig, ';') FROM pg_proc"
                    " WHERE proname LIKE 'lacarte_retention%' ORDER BY 1") == [
        ["lacarte_retention", "t", "search_path=pg_catalog, pg_temp"],
        ["lacarte_retention_at", "f", "search_path=pg_catalog, pg_temp"]]  # fmt: skip
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("SET ROLE preview_api")
        rid = conn.execute("INSERT INTO registre_reports (evenement, affaire, category,"
                           " correction, contact) VALUES ('e1~0', 'e1', 'date', 'x', 'c')"
                           " RETURNING id").fetchone()[0]  # fmt: skip
        conn.execute("UPDATE registre_reports SET state = 'refused', decided_on = current_date,"
                     " decided_by = 'rvw', contact = NULL WHERE id = %s", (rid,))  # fmt: skip
        for statement in ("DELETE FROM registre_reports",
                          "UPDATE registre_reports SET correction = 'y'",
                          "UPDATE registre_reports SET received_on = current_date"):  # fmt: skip
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(statement)
        assert conn.execute("SELECT * FROM lacarte_retention()").fetchone() == (0, 0, 0, 0, 0)
