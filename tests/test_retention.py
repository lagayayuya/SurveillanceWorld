"""What is kept and for how long (migration 023, rules/stats.yaml): lacarte_retention(),
run by the deploy (db/retention.sql) and every Paris day by the API's thread
(lacarte.api.retention), folds the counters' old hours into Paris days and old days into
months, and deletes the journal's lines older than 12 months; run twice, the second does
nothing. The API's role may run it, not do any of it itself. Fictitious rows in the
throwaway database."""

import logging
import re
import subprocess
import threading
from datetime import UTC, date, datetime

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from test_accounts_db import at
from test_db import sql

from lacarte import db, regions
from lacarte.api import app as api
from lacarte.api import retention, stats

MIGRATION = db.MIGRATIONS / "023_retention.sql"
TODAY = date(2026, 10, 17)  # a Saturday in Paris, summer time (UTC+2) until the 25th


@pytest.fixture(autouse=True)
def empty(pg_dsn, pg_loaded):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE site_counters_hour, site_counters, site_counters_month")
        conn.execute("DELETE FROM admin_log")


def run_at(dsn, today: date) -> tuple[int, int, int]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        return conn.execute("SELECT journal, hours, days FROM lacarte_retention_at(%s)",
                            (today,)).fetchone()  # fmt: skip


def rows(dsn, table: str) -> list[tuple]:
    key = {"site_counters_hour": "at", "site_counters": "day", "site_counters_month": "month"}
    with psycopg.connect(dsn) as conn:
        conn.execute("SET TIME ZONE 'UTC'")
        return conn.execute(f"SELECT {key[table]}::text, counter, n FROM {table}"
                            " ORDER BY 1, 2").fetchall()  # fmt: skip


def test_hours_older_than_seven_paris_days_go_into_their_paris_day_once(pg_dsn):
    """Kept: today (the 17th) and the 7 Paris days before (the 10th on). 22:30 UTC on the
    9th is 00:30 on the 10th in Paris: kept; 21:00 UTC on the 9th is 23:00 there: folded,
    into the 9th, added to what the day already held."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO site_counters_hour VALUES ('2026-10-09 22:00+00', 'map', 5),"
            " ('2026-10-09 21:00+00', 'map', 3), ('2026-10-09 06:00+00', 'map', 2),"
            " ('2026-10-09 06:00+00', 'signin', 1), ('2026-10-01 10:00+00', 'welcome', 4),"
            " ('2026-10-17 08:00+00', 'map', 9)")  # fmt: skip
        conn.execute("INSERT INTO site_counters VALUES ('2026-10-09', 'map', 100)")
    assert run_at(pg_dsn, TODAY) == (0, 4, 0)
    assert run_at(pg_dsn, TODAY) == (0, 0, 0)  # nothing left to fold
    assert rows(pg_dsn, "site_counters_hour") == [
        ("2026-10-09 22:00:00+00", "map", 5), ("2026-10-17 08:00:00+00", "map", 9)]  # fmt: skip
    assert rows(pg_dsn, "site_counters") == [
        ("2026-10-01", "welcome", 4), ("2026-10-09", "map", 105),
        ("2026-10-09", "signin", 1)]  # fmt: skip


def test_days_older_than_13_whole_months_go_into_their_month_once(pg_dsn):
    """The cut: the first of the month 13 months before the current one (2025-09-01 on
    2026-10-17); a month's total already there is added to."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO site_counters VALUES ('2025-08-31', 'map', 10), ('2025-08-01', 'map', 5),"
            " ('2025-08-31', 'welcome', 2), ('2025-09-01', 'map', 7), ('2026-10-17', 'map', 1)"
        )
        conn.execute("INSERT INTO site_counters_month VALUES ('2025-08-01', 'map', 100)")
    assert run_at(pg_dsn, TODAY) == (0, 0, 3)
    assert run_at(pg_dsn, TODAY) == (0, 0, 0)
    assert rows(pg_dsn, "site_counters") == [("2025-09-01", "map", 7), ("2026-10-17", "map", 1)]
    assert rows(pg_dsn, "site_counters_month") == [("2025-08-01", "map", 115),
                                                   ("2025-08-01", "welcome", 2)]  # fmt: skip


def test_the_journal_keeps_12_months(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO admin_log (day, actor, action) VALUES ('2025-10-16', 'a', 'cut'),"
                     " ('2025-10-17', 'b', 'cut'), ('2026-10-17', 'c', 'cut')")  # fmt: skip
    assert run_at(pg_dsn, TODAY) == (1, 0, 0)
    assert run_at(pg_dsn, TODAY) == (0, 0, 0)
    assert sql(pg_dsn, "SELECT string_agg(actor, ',' ORDER BY actor) FROM admin_log") == [["b,c"]]


def test_hours_older_than_a_week_are_folded_across_a_dst_change_into_paris_days(pg_dsn):
    """On 2026-11-02 (winter time since 25 October, UTC+1): kept from the 26th. 23:00 UTC
    on the 25th is midnight on the 26th in Paris (kept); 22:00 UTC is 23:00 on the 25th."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO site_counters_hour VALUES ('2026-10-25 23:00+00', 'map', 1),"
                     " ('2026-10-25 22:00+00', 'map', 2), ('2026-10-25 00:00+00', 'map', 4),"
                     " ('2026-10-25 01:00+00', 'map', 8)")  # fmt: skip
    assert run_at(pg_dsn, date(2026, 11, 2)) == (0, 3, 0)
    # 00:00 and 01:00 UTC on the 25th: 02:00 summer then 02:00 winter time, the same day.
    assert rows(pg_dsn, "site_counters") == [("2026-10-25", "map", 14)]


def test_lacarte_retention_is_today_in_paris(pg_dsn):
    """The function the API and the deploy call: today's Paris day, whatever the session's
    TimeZone."""
    paris = stats.utc_now().astimezone(stats.PARIS).date()
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO admin_log (day, actor, action) VALUES"
                     " (%s::date - interval '12 months' - interval '1 day', 'a', 'cut'),"
                     " (%s::date - interval '12 months', 'b', 'cut')", (paris, paris))  # fmt: skip
        conn.execute("SET TIME ZONE 'Pacific/Kiritimati'")  # UTC+14
        assert conn.execute("SELECT journal FROM lacarte_retention()").fetchone() == (1,)


def test_db_retention_sql_says_what_it_did_and_nothing_else(pg_dsn):
    def run() -> str:
        return subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", pg_dsn, "-f",
                               str(regions.ROOT / "db" / "retention.sql")],
                              check=True, capture_output=True, text=True).stdout  # fmt: skip

    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO site_counters_hour VALUES ('2020-01-01 10:00+00', 'map', 3)")
        conn.execute("INSERT INTO admin_log (day, actor, action) VALUES ('2020-01-01', 'a', 'cut')")
    said = ("journal lines older than 12 months deleted: 1\n"
            "counter hours older than 7 days folded into Paris days: 1\n"
            "counter days older than 13 months folded into monthly totals: 1\n")  # fmt: skip
    assert run() == said
    assert run() == ""
    assert rows(pg_dsn, "site_counters_month") == [("2020-01-01", "map", 3)]


def test_the_rules_and_the_function_say_the_same_durations():
    conf = stats.rules()
    text = MIGRATION.read_text()
    assert f"today - interval '{conf['hour_retention_days']} days'" in text
    assert f"- interval '{conf['retention_months']} months'" in text
    assert f"today - interval '{conf['journal_retention_months']} months'" in text
    words = (regions.ROOT / "db" / "retention.sql").read_text()
    assert f"older than {conf['journal_retention_months']} months deleted" in words
    assert f"older than {conf['hour_retention_days']} days folded" in words
    assert f"older than {conf['retention_months']} months folded" in words
    assert f"pg_advisory_xact_lock({retention.LOCK})" in text


def test_the_api_role_runs_it_and_nothing_more(pg_dsn, pg_loaded):
    """On a database set up as bootstrap.sh sets the server's, migrated to 023: SECURITY
    DEFINER with a fixed search_path; EXECUTE revoked from PUBLIC, granted to the API's
    role on lacarte_retention() only; the API's role still cannot delete a journal line
    nor fold a counter by hand."""
    dsn = at(pg_dsn, "retention_023", "023")
    assert sql(dsn, "SELECT proname, prosecdef, array_to_string(proconfig, ';') FROM pg_proc"
                    " WHERE proname LIKE 'lacarte_retention%' ORDER BY 1") == [
        ["lacarte_retention", "t", "search_path=pg_catalog, pg_temp"],
        ["lacarte_retention_at", "f", "search_path=pg_catalog, pg_temp"]]  # fmt: skip
    can = "SELECT has_function_privilege({!r}, {!r}, 'EXECUTE')"
    assert sql(dsn, can.format("preview_api", "lacarte_retention()")) == [["t"]]
    assert sql(dsn, can.format("preview_api", "lacarte_retention_at(date)")) == [["f"]]
    sql(dsn, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nobody_else')"
             " THEN CREATE ROLE nobody_else; END IF; END $$")  # fmt: skip
    assert sql(dsn, can.format("nobody_else", "lacarte_retention()")) == [["f"]]
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO admin_log (day, actor, action) VALUES ('2020-01-01', 'a', 'cut'),"
                     " (current_date, 'b', 'cut')")  # fmt: skip
        conn.execute("INSERT INTO site_counters_hour VALUES ('2020-01-01 10:00+00', 'map', 3)")
        conn.execute("SET ROLE preview_api")
        assert conn.execute("SELECT * FROM lacarte_retention()").fetchone() == (1, 1, 1)
        for statement in ("DELETE FROM admin_log", "DELETE FROM site_counters_hour",
                          "INSERT INTO site_counters VALUES ('2026-01-01', 'map', 1)",
                          "SELECT lacarte_retention_at('2030-01-01')"):  # fmt: skip
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(statement)
        conn.execute("RESET ROLE")
        assert conn.execute("SELECT count(*) FROM admin_log").fetchone() == (1,)


# --- the API's thread ----------------------------------------------------------------------


def connect(dsn):
    return lambda: psycopg.connect(dsn, autocommit=True)


def test_a_run_logs_counts_at_warning_only_when_it_did_something(pg_dsn, caplog):
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        assert retention.once(connect(pg_dsn)) == {"ran": True, "journal": 0, "hours": 0,
                                                   "days": 0, "contacts": 0,
                                                   "reports": 0}  # fmt: skip
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("INSERT INTO site_counters_hour VALUES ('2020-01-01 10:00+00',"
                         " 'map', 3)")  # fmt: skip
        assert retention.once(connect(pg_dsn))["hours"] == 1
    quiet, busy = [r for r in caplog.records if r.getMessage().startswith("retention")]
    assert quiet.levelno == logging.INFO and busy.levelno == logging.WARNING
    assert busy.getMessage() == ("retention: 0 journal lines deleted, 1 counter hours and"
                                 " 1 counter days folded, 0 report contacts erased, 0 refused"
                                 " reports deleted")  # fmt: skip


def test_while_another_api_runs_it_a_run_does_nothing(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as other, other.transaction():
        assert other.execute("SELECT pg_try_advisory_xact_lock(%s)",
                             (retention.LOCK,)).fetchone() == (True,)  # fmt: skip
        assert retention.once(connect(pg_dsn)) == {"ran": False, "journal": 0, "hours": 0,
                                                   "days": 0, "contacts": 0,
                                                   "reports": 0}  # fmt: skip
    # The lock went with the other's transaction.
    assert retention.once(connect(pg_dsn))["ran"] is True


def test_the_thread_runs_once_a_paris_day(monkeypatch):
    now = [datetime(2026, 10, 17, 21, 0, tzinfo=UTC)]  # 23:00 in Paris
    monkeypatch.setattr(stats, "utc_now", lambda: now[0])
    runs = []
    daily = retention.Daily(lambda: runs.append(now[0]) or {"ran": True})
    daily()
    now[0] = datetime(2026, 10, 17, 21, 59, tzinfo=UTC)
    assert daily() is None
    now[0] = datetime(2026, 10, 17, 22, 5, tzinfo=UTC)  # 00:05 on the 18th in Paris
    daily()
    assert daily() is None
    assert runs == [datetime(2026, 10, 17, 21, 0, tzinfo=UTC),
                    datetime(2026, 10, 17, 22, 5, tzinfo=UTC)]  # fmt: skip


def test_a_failed_run_is_tried_again_at_the_next_look(monkeypatch):
    monkeypatch.setattr(stats, "utc_now", lambda: datetime(2026, 10, 17, 12, tzinfo=UTC))
    calls = []

    def run():
        calls.append(1)
        if len(calls) == 1:
            raise psycopg.OperationalError("down")
        return {"ran": True}

    daily = retention.Daily(run)
    with pytest.raises(psycopg.OperationalError):
        daily()
    daily()
    assert daily() is None and len(calls) == 2


def test_the_api_starts_its_thread_and_stops_it(pg_dsn, monkeypatch):
    """RETENTION_THREAD unset (production): the lifespan starts the thread, which runs
    after first_pass_s, and stops it on shutdown."""
    rules = stats.rules()
    rules["retention_thread"]["first_pass_s"] = 0.05
    monkeypatch.setattr(stats, "rules", lambda: rules)
    monkeypatch.delenv("RETENTION_THREAD")
    sessions.configure(pg_dsn)
    ran = threading.Event()
    monkeypatch.setattr(api, "retention_once", lambda: ran.set() or {})
    with TestClient(api.app):
        assert [t for t in threading.enumerate() if t.name == "retention"]
        assert ran.wait(5)
    assert not [t for t in threading.enumerate() if t.name == "retention"]


def test_the_benches_server_leaves_it_out():
    text = (regions.ROOT / "tests" / "apiserver.py").read_text()
    assert re.search(r'os\.environ\.setdefault\("RETENTION_THREAD", "off"\)', text)
