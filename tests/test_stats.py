"""The site's counters (migration 021, lot 4 and its « go »): POST /api/hit, anonymous,
behind the Origin and JSON guard; an hour, a name, a number; robots and the hour's cap add
nothing; a session opened adds a `signin`, a refused sign-in nothing. Fictitious counts in
the throwaway database."""

import logging
from datetime import UTC, date, datetime

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from sessions import ORIGIN
from test_accounts_db import at
from test_db import sql

from lacarte.api import app as api
from lacarte.api import stats

JSON = {"Origin": ORIGIN, "Content-Type": "application/json"}
FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
SAFARI = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
          " (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")  # fmt: skip
DAY = date(2026, 10, 16)


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def empty(pg_dsn, client, monkeypatch):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE site_counters_hour, site_counters, site_counters_month")
    monkeypatch.setattr(stats, "utc_now", lambda: datetime(2026, 10, 16, 12, 34, 56, 789,
                                                           tzinfo=UTC))  # fmt: skip


def counts(dsn, counters=("map", "welcome")) -> dict[tuple[str, str], int]:
    """The hourly counters, by the hour's start in UTC (ISO, `Z`-less) and name."""
    with psycopg.connect(dsn) as conn:
        rows = conn.execute("SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI'),"
                            " counter, n FROM site_counters_hour WHERE counter = ANY(%s)",
                            (list(counters),)).fetchall()  # fmt: skip
    return {(d, c): n for d, c, n in rows}


NOON = "2026-10-16T12:00"  # the hour of `empty`'s clock, in UTC


def hit(client, event="map", ua=FIREFOX, headers=None):
    h = {**JSON, **({"User-Agent": ua} if ua is not None else {}), **(headers or {})}
    return client.post("/api/hit", json={"event": event}, headers=h)


# --- POST /api/hit ---------------------------------------------------------------------


def test_a_hit_adds_one_to_its_counter_of_the_day(client, pg_dsn):
    for event, ua in (("map", FIREFOX), ("map", SAFARI), ("welcome", SAFARI)):
        r = hit(client, event, ua)
        assert r.status_code == 204 and r.content == b""
    assert counts(pg_dsn) == {(NOON, "map"): 2, (NOON, "welcome"): 1}


def test_it_needs_no_session_and_sets_no_cookie(client, pg_dsn):
    client.cookies.clear()
    r = hit(client)
    assert r.status_code == 204 and "set-cookie" not in r.headers
    assert counts(pg_dsn) == {(NOON, "map"): 1}


def test_a_hit_counts_on_its_hour_and_the_paris_day_is_paris_s(client, pg_dsn, monkeypatch):
    """The hour is stored as its start (UTC); 22:30 UTC on the 16th is 00:30 on the 17th in
    Paris (summer time, UTC+2); 23:30 UTC on 31 December is already New Year's Day there
    (UTC+1)."""
    for now, day in ((datetime(2026, 10, 16, 22, 30, tzinfo=UTC), "2026-10-17"),
                     (datetime(2026, 10, 16, 21, 59, tzinfo=UTC), "2026-10-16"),
                     (datetime(2026, 10, 16, 21, 1, tzinfo=UTC), "2026-10-16"),
                     (datetime(2026, 12, 31, 23, 30, tzinfo=UTC), "2027-01-01")):  # fmt: skip
        monkeypatch.setattr(stats, "utc_now", lambda now=now: now)
        assert stats.paris_day() == date.fromisoformat(day)
        assert hit(client).status_code == 204
    assert counts(pg_dsn) == {("2026-10-16T22:00", "map"): 1, ("2026-10-16T21:00", "map"): 2,
                              ("2026-12-31T23:00", "map"): 1}  # fmt: skip


def test_an_hour_is_stored_on_the_hour_whatever_the_session_s_zone(pg_dsn, client):
    """The CHECK truncates in UTC (date_trunc's third argument), not in the session's
    TimeZone: in a zone half an hour off UTC, a UTC hour is still on the hour."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("SET TIME ZONE 'Asia/Kolkata'")
        conn.execute("INSERT INTO site_counters_hour VALUES ('2026-10-16 12:00+00', 'map', 1)")
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("INSERT INTO site_counters_hour VALUES ('2026-10-16 12:30+00',"
                         " 'map', 1)")  # fmt: skip


@pytest.mark.parametrize("ua", [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0 A",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " HeadlessChrome/129.0.0.0 Safari/537.36",
    "curl/8.7.1",
    "python-requests/2.32.3",
    "",
])  # fmt: skip
def test_a_robot_adds_nothing_and_is_answered_the_same(client, pg_dsn, ua):
    assert hit(client, ua=ua).status_code == 204
    assert counts(pg_dsn) == {}


def test_without_a_user_agent_nothing_is_counted(client, pg_dsn):
    r = client.post("/api/hit", json={"event": "map"},
                    headers={**JSON, "User-Agent": ""})  # fmt: skip
    assert r.status_code == 204 and counts(pg_dsn) == {}


def test_the_user_agent_is_neither_kept_nor_logged(client, pg_dsn, caplog):
    marker = "Mozilla/5.0 Fictitious-Marker-7d1e (X11; Linux) Firefox/131.0"
    with caplog.at_level(logging.DEBUG):
        hit(client, ua=marker)
        hit(client, ua="Fictitious-Marker-7d1e Googlebot/2.1")
    assert "7d1e" not in caplog.text
    with psycopg.connect(pg_dsn) as conn:
        dumped = conn.execute("SELECT string_agg(t::text, ' ') FROM site_counters_hour t"
                              ).fetchone()  # fmt: skip
    assert "7d1e" not in (dumped[0] or "")


def test_the_cap_stops_a_counter_not_the_other_and_not_the_next_hour(client, pg_dsn, monkeypatch):
    conf = {**stats.rules(), "hourly_cap": 3}
    monkeypatch.setattr(stats, "rules", lambda: conf)
    for _ in range(5):
        assert hit(client).status_code == 204
    assert hit(client, "welcome").status_code == 204
    monkeypatch.setattr(stats, "utc_now", lambda: datetime(2026, 10, 16, 13, 0, tzinfo=UTC))
    assert hit(client).status_code == 204
    assert counts(pg_dsn) == {(NOON, "map"): 3, (NOON, "welcome"): 1,
                              ("2026-10-16T13:00", "map"): 1}  # fmt: skip


@pytest.mark.parametrize(("headers", "status", "error"), [
    ({"Origin": "https://evil.test"}, 403, "origin"),
    ({"Origin": ""}, 403, "origin"),
    ({"Content-Type": "text/plain"}, 415, "content_type"),
])  # fmt: skip
def test_another_origin_or_a_form_is_refused(client, pg_dsn, headers, status, error):
    r = hit(client, headers=headers)
    assert (r.status_code, r.json()) == (status, {"error": error})
    assert counts(pg_dsn) == {}


@pytest.mark.parametrize("body", [{"event": "visit"}, {}, {"event": ["map"]},
                                  {"event": "signin"}])  # fmt: skip
def test_the_page_has_only_its_two_counters(client, pg_dsn, body):
    """`signin` is the API's own: the page cannot add one."""
    r = client.post("/api/hit", json=body, headers={**JSON, "User-Agent": FIREFOX})
    assert r.status_code == 422 and counts(pg_dsn, stats.COUNTERS) == {}


def test_closed_contributions_do_not_close_it(client, pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = false WHERE key LIKE '%_open'")
    api.switches.forget()
    try:
        assert hit(client).status_code == 204
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("UPDATE site_settings SET value = true WHERE key LIKE '%_open'")
        api.switches.forget()
    assert counts(pg_dsn) == {(NOON, "map"): 1}


def test_the_api_role_may_add_an_hour_but_not_fold_nor_delete(pg_dsn, pg_loaded):
    """On a database set up as bootstrap.sh sets the server's (the API's role reading by
    default privileges), migrated to 021: an hour's counter added to, the three read,
    nothing folded nor deleted (lacarte_retention(), 023, does that as the owner)."""
    dsn = at(pg_dsn, "counters_021", "021")
    can = sql(dsn, "SELECT t, p, has_table_privilege('preview_api', t, p) FROM"
                   " (VALUES ('site_counters_hour'), ('site_counters'),"
                   " ('site_counters_month')) a(t),"
                   " (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) b(p)")  # fmt: skip
    assert {(t, p): v == "t" for t, p, v in can} == {
        ("site_counters_hour", "SELECT"): True,
        ("site_counters_hour", "INSERT"): True,
        ("site_counters_hour", "UPDATE"): False,  # its number only, below
        ("site_counters_hour", "DELETE"): False,
        ("site_counters", "SELECT"): True,
        ("site_counters", "INSERT"): False,
        ("site_counters", "UPDATE"): False,
        ("site_counters", "DELETE"): False,
        ("site_counters_month", "SELECT"): True,
        ("site_counters_month", "INSERT"): False,
        ("site_counters_month", "UPDATE"): False,
        ("site_counters_month", "DELETE"): False,
    }
    columns = sql(dsn, "SELECT table_name, column_name FROM information_schema.column_privileges"
                       " WHERE grantee = 'preview_api' AND table_name LIKE 'site_counters%'"
                       " AND privilege_type = 'UPDATE'")  # fmt: skip
    assert columns == [["site_counters_hour", "n"]]


# --- `signin`: a session opened, counted by the API ----------------------------------------

PASSWORD = "a fictitious password for the counters"


@pytest.fixture
def cheap(monkeypatch, pg_dsn):
    """argon2 at a test cost, no delay between attempts; `sc-pass` a contributor and
    `sc-rev` an administrator, both with PASSWORD."""
    from argon2 import PasswordHasher

    from lacarte.api import auth

    monkeypatch.setattr(auth, "hasher", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
    monkeypatch.setattr(auth, "_dummy", None)
    monkeypatch.setattr(auth, "throttle", auth.Throttle(first=0.0, cap=0.0))
    stored = auth.hash_password(PASSWORD)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        for name, role in (("sc-pass", "contributor"), ("sc-rev", "admin")):
            conn.execute("INSERT INTO accounts (pseudonym, password_hash, role, created_month)"
                         " VALUES (%s, %s, %s, '2026-10-01') ON CONFLICT ((lower(pseudonym)))"
                         " DO UPDATE SET password_hash = EXCLUDED.password_hash, role ="
                         " EXCLUDED.role", (name, stored, role))  # fmt: skip
    api._refusals.clear()
    yield
    api._refusals.clear()


def signins(dsn) -> dict[tuple[str, str], int]:
    return counts(dsn, ("signin",))


@pytest.mark.parametrize(("path", "who"), [("/api/session", "sc-pass"),
                                           ("/api/review/session", "sc-rev")])  # fmt: skip
def test_a_session_opened_counts_one_signin_a_refusal_none(client, pg_dsn, cheap, path, who):
    """A wrong password, a privileged account at the ordinary entry, a contributor at the
    privileged one: refused, nothing counted. The right one: one, on the hour."""
    client.cookies.clear()
    other = {"sc-pass": "sc-rev", "sc-rev": "sc-pass"}[who]
    for name, password in ((who, "not the password"), (other, PASSWORD)):
        r = client.post(path, json={"pseudonym": name, "password": password}, headers=JSON)
        assert (r.status_code, r.json()) == (401, {"error": "credentials"})
    assert signins(pg_dsn) == {}
    r = client.post(path, json={"pseudonym": who, "password": PASSWORD}, headers=JSON)
    assert r.status_code == 204, r.text
    client.cookies.clear()
    assert signins(pg_dsn) == {(NOON, "signin"): 1}
    assert counts(pg_dsn) == {}  # the page's counters untouched


def test_signins_are_capped_but_the_session_still_opens(client, pg_dsn, cheap, monkeypatch):
    conf = {**stats.rules(), "hourly_cap": 1}
    monkeypatch.setattr(stats, "rules", lambda: conf)
    for _ in range(2):
        r = client.post("/api/session", json={"pseudonym": "sc-pass", "password": PASSWORD},
                        headers=JSON)  # fmt: skip
        assert r.status_code == 204 and "session=" in r.headers["set-cookie"]
    client.cookies.clear()
    assert signins(pg_dsn) == {(NOON, "signin"): 1}


def test_every_bot_pattern_is_lower_case_and_no_browser_matches():
    conf = stats.rules()
    assert all(b == b.lower() and b for b in conf["bots"])
    assert not stats.is_bot(FIREFOX, conf) and not stats.is_bot(SAFARI, conf)
    chrome_android = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML,"
                      " like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36")  # fmt: skip
    assert not stats.is_bot(chrome_android, conf)


# --- GET /api/review/stats -------------------------------------------------------------

TODAY = date(2026, 10, 16)  # the clock of `empty`: 12:34 UTC, the same day in Paris
BLOCK_KEYS = {
    "hours": {"enough", "n", "need", "rows"},
    "days": {"enough", "n", "need", "rows"},
    "weeks": {"enough", "n", "need", "rows"},
    "months": {"enough", "n", "need", "rows"},
    "queue": {"enough", "n", "n_weeks", "need", "weekly", "pending_by_day", "pending_now",
              "oldest_days", "median_wait_days"},
    "contributors": {"enough", "n", "need", "monthly", "top3_share", "top"},
    "osm": {"enough", "n", "need", "offered", "server", "accepted", "published", "conflict",
            "sending", "uncertain", "stays"},
    "hidden": {"enough", "n", "need", "monthly"},
}  # fmt: skip


def ago(days: int) -> date:
    return date.fromordinal(TODAY.toordinal() - days)


@pytest.fixture
def world(pg_dsn, client):
    """No contribution, no hidden camera, no counter; st1..st6 contributors, stt a test
    account."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions, hidden_cameras CASCADE")
        conn.execute("DELETE FROM accounts WHERE pseudonym LIKE 'st_'")
    ids = {n: sessions.account_id(n, pg_dsn) for n in ("st1", "st2", "st3", "st4", "st5",
                                                         "st6", "stt")}  # fmt: skip
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET test = true WHERE pseudonym = 'stt'")
    return ids


def put(dsn, author, day, *, kind="verify", answer="present", status="pending",
        decided=None, batch=None, target=None) -> str:  # fmt: skip
    """A contribution as the API stores it (on n1), decided on `decided` when given."""
    import uuid

    uid = str(uuid.uuid4())
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
            " build_id, author_id, day, geom, payload, body_sha256, osm_tags, answer, status,"
            " decided_on, batch, target) VALUES (%s, %s, 'n1', 'n', 1, 1, 'b', %s, %s,"
            " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', %s, %s, %s, %s, %s)",
            (uid, kind, author, day, answer, status, decided, batch, target),
        )  # fmt: skip
    return uid


def get_stats(client) -> dict:
    r = client.get("/api/review/stats", headers=sessions.headers("rev"))
    assert r.status_code == 200, r.text
    return r.json()


def test_only_an_administrator_reads_them(client):
    assert client.get("/api/review/stats").json() == {"error": "privileged"}
    r = client.get("/api/review/stats", headers=sessions.headers("ana"))
    assert (r.status_code, r.json()) == (401, {"error": "privileged"})
    r = client.get("/api/review/stats", headers=sessions.headers("rvw"))
    assert (r.status_code, r.json()) == (403, {"error": "admin"})


COUNTS = {"hours", "days", "weeks", "months", "hidden"}
COMPUTED = set(BLOCK_KEYS) - COUNTS


def test_with_nothing_yet_counts_have_no_threshold_computed_values_do(client, world):
    """Lot M (2026-10-17): the counts are shown from the first one (no need, always
    enough); only the median wait and the shares keep a threshold."""
    s = get_stats(client)
    assert s["today"] == "2026-10-16"
    assert {k: set(v) for k, v in s.items() if k != "today"} == BLOCK_KEYS
    conf = stats.rules()["blocks"]
    for name in COUNTS:
        assert (s[name]["need"], s[name]["enough"]) == ({}, True), name
    assert s["queue"]["need"] == {"n": conf["queue"]["contributions"],
                                  "n_weeks": conf["queue"]["weeks"]}  # fmt: skip
    assert s["contributors"]["need"] == {"n": conf["contributors"]["active"]}
    assert s["osm"]["need"] == {"n": conf["osm"]["accepted"]}
    for name in COMPUTED:
        assert s[name]["enough"] is False and s[name]["n"] == 0, name
    for name in COUNTS - {"months"}:  # the tests' own accounts sign up this month
        assert s[name]["n"] == 0, name
    # Every window whole, zero-filled; no reference without a counted hour.
    assert len(s["hours"]["rows"]) == 24 and len(s["days"]["rows"]) == 30
    assert len(s["months"]["rows"]) == 13 and s["months"]["rows"][-1]["month"] == "2026-10"
    assert s["hours"]["rows"][-1] == {"at": "2026-10-16T14:00:00+02:00", "map": 0, "welcome": 0,
                                      "signin": 0, "ref": None}  # fmt: skip
    assert s["hours"]["rows"][0]["at"] == "2026-10-15T15:00:00+02:00"
    assert s["days"]["rows"][-1] == {"day": "2026-10-16", "map": 0, "welcome": 0, "signin": 0,
                                     "contributions": 0, "decisions": 0}  # fmt: skip
    weeks = s["weeks"]["rows"]
    assert (weeks[0]["week"], weeks[-1]["week"]) == ("2025-09-29", "2026-10-12")
    assert len(weeks) == 55 and all(w["map"] == 0 for w in weeks)
    assert s["queue"]["pending_now"] == 0
    assert s["queue"]["oldest_days"] is None and s["queue"]["median_wait_days"] is None
    assert len(s["queue"]["pending_by_day"]) == conf["queue"]["window_days"]
    assert s["contributors"]["top"] == [] and s["contributors"]["top3_share"] is None
    assert (s["osm"]["offered"], s["osm"]["server"]) == (False, "live")


def put_hours(dsn, *rows) -> None:
    """(UTC timestamp text, counter, n) rows of site_counters_hour."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        for at_, counter, n in rows:
            conn.execute("INSERT INTO site_counters_hour VALUES (%s, %s, %s)", (at_, counter, n))


def freeze(monkeypatch, *args) -> None:
    monkeypatch.setattr(stats, "utc_now", lambda: datetime(*args, tzinfo=UTC))


def test_hours_say_the_last_24_and_the_same_hour_over_the_week_before(client, world, pg_dsn):
    """Now 12:34 UTC (14:34 in Paris). The first hour ever counted on the 8th: the 7 days
    before today (the 9th to the 15th) are all counted, the 9th with nothing at 14:00 —
    its mean is over 7 days. An older row (the 8th) is past the kept week: not in it."""
    put_hours(pg_dsn, ("2026-10-08 00:00+00", "map", 1), ("2026-10-08 12:00+00", "map", 50),
              *[(f"2026-10-{d} 12:00+00", "map", 6) for d in range(10, 16)],
              ("2026-10-15 12:00+00", "signin", 7), ("2026-10-16 12:00+00", "map", 3),
              ("2026-10-16 12:00+00", "welcome", 2), ("2026-10-15 13:00+00", "map", 1),
              ("2026-10-15 12:00+00", "welcome", 70))  # fmt: skip
    h = get_stats(client)["hours"]
    rows = h["rows"]
    assert rows[-1] == {
        "at": "2026-10-16T14:00:00+02:00",
        "map": 3,
        "welcome": 2,
        "signin": 0,
        "ref": {"map": round(36 / 7, 2), "welcome": 10.0, "signin": 1.0},
    }
    assert rows[0]["at"] == "2026-10-15T15:00:00+02:00" and rows[0]["map"] == 1
    # 15:00 the day before: the 8th to the 14th; the 8th is past the kept week (the cut is
    # the 9th), so six days, none with a count.
    assert rows[0]["ref"] == {"map": 0.0, "welcome": 0.0, "signin": 0.0}
    assert (h["n"], h["enough"]) == (4, True)


def test_without_an_hour_counted_before_there_is_no_reference(client, world, pg_dsn):
    put_hours(pg_dsn, ("2026-10-16 12:00+00", "map", 3))
    rows = get_stats(client)["hours"]["rows"]
    assert all(r["ref"] is None for r in rows)
    assert rows[-1]["map"] == 3


def test_the_night_summer_time_ends_has_two_two_o_clocks(client, world, pg_dsn, monkeypatch):
    """25 October 2026: 02:00 summer time (00:00 UTC), then 02:00 winter time (01:00 UTC).
    Both are shown, each with the mean of 02:00 over the 7 days before."""
    freeze(monkeypatch, 2026, 10, 25, 3, 30)  # 04:30 in Paris, winter time
    put_hours(pg_dsn, ("2026-10-17 00:00+00", "map", 1), ("2026-10-24 00:00+00", "map", 7),
              ("2026-10-25 00:00+00", "map", 2), ("2026-10-25 01:00+00", "map", 5))  # fmt: skip
    s = get_stats(client)
    assert s["today"] == "2026-10-25"
    rows = {r["at"]: r for r in s["hours"]["rows"]}
    summer, winter = rows["2026-10-25T02:00:00+02:00"], rows["2026-10-25T02:00:00+01:00"]
    assert (summer["map"], winter["map"]) == (2, 5)
    assert summer["ref"]["map"] == winter["ref"]["map"] == 1.0  # (7 + 0 * 6) / 7
    assert s["hours"]["rows"][-1]["at"] == "2026-10-25T04:00:00+01:00"


def test_the_night_summer_time_starts_has_no_two_o_clock(client, world, pg_dsn, monkeypatch):
    """29 March 2026 has no 02:00: on the 30th, 02:00's mean is over the six days that had
    one."""
    freeze(monkeypatch, 2026, 3, 30, 0, 30)  # 02:30 in Paris, summer time
    put_hours(pg_dsn, ("2026-03-20 00:00+00", "map", 1), ("2026-03-28 01:00+00", "map", 6))
    rows = get_stats(client)["hours"]["rows"]
    assert rows[-1]["at"] == "2026-03-30T02:00:00+02:00"
    assert rows[-1]["ref"]["map"] == 1.0
    assert not [r for r in rows if r["at"].startswith("2026-03-29T02")]


def test_days_add_their_hours_to_what_is_folded_and_count_sends_and_decisions(
    client, world, pg_dsn
):
    """A folded day and the hours not folded yet of others, today's included; sends
    received (a « Modifier » once, an opinion and a withdrawn one too, a test account's
    not) and decided (by decided_on; a withdrawal is no decision)."""
    import uuid

    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO site_counters VALUES (%s, 'map', 40), (%s, 'signin', 2)",
                     (ago(20), ago(20)))  # fmt: skip
    # 21:30 UTC on the 12th is the 12th in Paris; 22:00 UTC is already the 13th.
    put_hours(
        pg_dsn,
        ("2026-10-12 21:00+00", "map", 3),
        ("2026-10-12 22:00+00", "map", 4),
        ("2026-10-16 08:00+00", "welcome", 5),
        ("2026-10-16 09:00+00", "signin", 1),
    )
    st1, stt = world["st1"], world["stt"]
    batch = str(uuid.uuid4())
    first = put(pg_dsn, st1, ago(2), status="validated", decided=ago(1))
    put(pg_dsn, st1, ago(2), kind="shape", answer="dome", batch=batch, status="rejected",
        decided=TODAY)  # fmt: skip
    put(pg_dsn, st1, ago(2), kind="height", answer="first", batch=batch, status="rejected",
        decided=TODAY)  # fmt: skip
    put(pg_dsn, st1, ago(1), kind="agree", answer=None, target=first)
    put(pg_dsn, st1, ago(1), status="withdrawn", decided=ago(1))
    put(pg_dsn, stt, ago(1), status="validated", decided=TODAY)
    d = {r["day"]: r for r in get_stats(client)["days"]["rows"]}
    assert d[ago(20).isoformat()] == {
        "day": ago(20).isoformat(),
        "map": 40,
        "welcome": 0,
        "signin": 2,
        "contributions": 0,
        "decisions": 0,
    }
    assert (d["2026-10-12"]["map"], d["2026-10-13"]["map"]) == (3, 4)
    today = d["2026-10-16"]
    assert (today["welcome"], today["signin"], today["decisions"]) == (5, 1, 1)
    assert (d[ago(2).isoformat()]["contributions"], d[ago(1).isoformat()]["contributions"]) == (
        2, 2)  # fmt: skip
    assert d[ago(1).isoformat()]["decisions"] == 1
    w = {r["week"]: r for r in get_stats(client)["weeks"]["rows"]}
    assert w["2026-10-12"] == {
        "week": "2026-10-12",
        "map": 7,
        "welcome": 5,
        "signin": 1,
        "contributions": 4,
        "decisions": 2,
    }
    assert w["2026-09-21"]["map"] == 40 and w["2026-09-21"]["signin"] == 2


def test_days_count_the_window_s_loads_from_the_first(client, world, pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO site_counters VALUES (%s, 'map', 2)", (ago(3),))
        conn.execute("INSERT INTO site_counters VALUES (%s, 'map', 500)", (ago(40),))  # before
    d = get_stats(client)["days"]
    assert (d["enough"], d["n"]) == (True, 2)


def test_weeks_count_the_map_loads_from_the_first(client, world, pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO site_counters VALUES (%s, 'map', 1)", (ago(7),))
        conn.execute("INSERT INTO site_counters VALUES (%s, 'welcome', 1)", (ago(0),))
    w = get_stats(client)["weeks"]
    assert (w["enough"], w["n"]) == (True, 1)


def test_months_count_sign_ups_without_tests_nor_placeholders(client, world, pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE created_month IN ('2025-11-01', '2025-09-01')")
        conn.execute("INSERT INTO accounts (pseudonym, password_hash, created_month, test,"
                     " osm_id, osm_server) VALUES ('su1', 'x', '2025-11-01', false, NULL, NULL),"
                     " ('su2', NULL, '2025-11-01', false, 999001, 'dev'),"
                     " ('su3', 'x', '2025-11-01', true, NULL, NULL),"
                     " ('su4', NULL, '2025-11-01', false, NULL, NULL),"
                     " ('su5', 'x', '2025-09-01', false, NULL, NULL)")  # fmt: skip
    try:
        m = get_stats(client)["months"]
        rows = {r["month"]: r["signups"] for r in m["rows"]}
        assert list(rows)[0] == "2025-10" and list(rows)[-1] == "2026-10"
        assert rows["2025-11"] == 2 and "2025-09" not in rows  # 13 months: from October
        assert m["n"] == sum(rows.values())
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM accounts WHERE pseudonym LIKE 'su_'")


@pytest.mark.parametrize(("sends", "enough"), [(30, True), (29, False)])
def test_the_queue_needs_four_weeks_and_thirty_sends(client, world, pg_dsn, sends, enough):
    """`sends` decidable sends from 28 days ago (four weeks): a « Modifier » send of two
    pieces counts once; a test account's, an opinion, a « Je ne sais pas » and a withdrawn
    one count for nothing."""
    st1, st2, stt = world["st1"], world["st2"], world["stt"]
    import uuid

    batch = str(uuid.uuid4())
    first = put(pg_dsn, st1, ago(28), status="validated", decided=ago(26))  # waited 2 days
    put(pg_dsn, st1, ago(20), status="rejected", decided=ago(16))  # waited 4 days
    put(pg_dsn, st2, ago(10), kind="shape", answer="dome", batch=batch)
    put(pg_dsn, st2, ago(10), kind="height", answer="first", batch=batch)
    for i in range(sends - 3):
        put(pg_dsn, st2, ago(5 - i % 5))
    put(pg_dsn, stt, ago(3))
    put(pg_dsn, st2, ago(3), kind="agree", answer=None, target=first)
    put(pg_dsn, st2, ago(3), kind="shape", answer="unknown")
    put(pg_dsn, st2, ago(3), status="withdrawn")
    q = get_stats(client)["queue"]
    assert (q["enough"], q["n"], q["n_weeks"]) == (enough, sends, 4)
    assert q["pending_now"] == sends - 2 and q["oldest_days"] == 10
    assert q["median_wait_days"] == 3.0
    by_day = {d["day"]: d["n"] for d in q["pending_by_day"]}
    assert by_day[ago(29).isoformat()] == 0 and by_day[ago(28).isoformat()] == 1
    assert by_day[ago(26).isoformat()] == 0  # decided that day: no longer waiting
    assert by_day[ago(17).isoformat()] == 1 and by_day[ago(10).isoformat()] == 1
    assert by_day["2026-10-16"] == sends - 2
    weeks = {w["week"]: w for w in q["weekly"]}
    assert all(date.fromisoformat(w).weekday() == 0 for w in weeks)
    assert sum(w["in"] for w in weeks.values()) == sends
    assert sum(w["decided"] for w in weeks.values()) == 2
    assert weeks["2026-10-12"]["in"] == sum(ago(5 - i % 5) >= date(2026, 10, 12)
                                            for i in range(sends - 3))  # fmt: skip


@pytest.mark.parametrize(("accounts", "enough"), [(5, True), (4, False)])
def test_contributors_need_five_active_accounts(client, world, pg_dsn, accounts, enough):
    """Active over the last 30 days; the top by accepted sends made then (a test account,
    and an account active only before, are not in it)."""
    names = ["st1", "st2", "st3", "st4", "st5"][:accounts]
    accepted = {"st1": 4, "st2": 3, "st3": 2, "st4": 1, "st5": 0}
    for name in names:
        put(pg_dsn, world[name], ago(3))  # pending: active, not accepted
        for _ in range(accepted[name]):
            put(pg_dsn, world[name], ago(10), status="validated", decided=ago(8))
    put(pg_dsn, world["st6"], ago(45), status="validated", decided=ago(40))
    put(pg_dsn, world["stt"], ago(2), status="validated", decided=ago(1))
    c = get_stats(client)["contributors"]
    assert (c["enough"], c["n"]) == (enough, accounts)
    expected = [(n, accepted[n]) for n in names if accepted[n]]
    assert [(t["pseudonym"], t["accepted"]) for t in c["top"]] == expected
    assert c["top"][0]["id"] == world["st1"]
    total = sum(n for _, n in expected)
    assert c["top3_share"] == round(9 / total, 3)
    months = {m["month"]: m for m in c["monthly"]}
    assert months["2026-10"] == {"month": "2026-10", "active": accounts, "new": accounts}
    assert months["2026-09"] == {"month": "2026-09", "active": 1, "new": 1}  # st6


@pytest.mark.parametrize(("accepted", "enough"), [(20, True), (19, False)])
def test_osm_needs_twenty_accepted_sends_and_tells_where_they_went(
    client, world, pg_dsn, monkeypatch, accepted, enough
):
    uids = [put(pg_dsn, world["st1"], ago(9), status=s, decided=ago(8))
            for s in (["validated", "applied", "superseded"] * 7)[:accepted]]  # fmt: skip
    put(pg_dsn, world["st1"], ago(9), status="rejected", decided=ago(8))
    put(pg_dsn, world["stt"], ago(9), status="validated", decided=ago(8))
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        for uid, server, state, reason in ((uids[0], "live", "published", None),
                                           (uids[1], "live", "published", None),
                                           (uids[2], "live", "conflict", "osm_version"),
                                           (uids[3], "live", "sending", None),
                                           (uids[5], "live", "uncertain", None),
                                           (uids[4], "dev", "published", None)):  # fmt: skip
            conn.execute("INSERT INTO osm_publications (uuid, server, state, reason, month)"
                         " VALUES (%s, %s, %s, %s, '2026-10-01')",
                         (uid, server, state, reason))  # fmt: skip
    o = get_stats(client)["osm"]
    assert (o["enough"], o["n"], o["accepted"]) == (enough, accepted, accepted)
    assert (o["offered"], o["server"]) == (False, "live")
    assert (o["published"], o["conflict"], o["sending"], o["uncertain"]) == (2, 1, 1, 1)
    assert o["stays"] == accepted - 5
    # Offered on the test server (the preview): its publications are the ones counted.
    monkeypatch.setattr(api, "publish_server", lambda: type("S", (), {"name": "dev"})())
    o = get_stats(client)["osm"]
    assert (o["offered"], o["server"], o["published"], o["conflict"]) == (True, "dev", 1, 0)


def test_hidden_cameras_by_month(client, world, pg_dsn):
    assert get_stats(client)["hidden"]["n"] == 0
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO hidden_cameras (camera_id, added_on) VALUES ('n42',"
                     " '2026-09-03'), ('n43', '2026-10-01'), ('n44', '2026-10-05')")  # fmt: skip
    h = get_stats(client)["hidden"]
    assert (h["enough"], h["n"]) == (True, 3)
    assert h["monthly"] == [{"month": "2026-09", "n": 1}, {"month": "2026-10", "n": 2}]
