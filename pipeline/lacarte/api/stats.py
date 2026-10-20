"""The site's counters (migration 021) and /revue's « Statistiques » (lot 4, plan-revue
§6 bis, and the « go » of 17/10): rules/stats.yaml.

A counter is the start of an hour, a name and a number, nothing else: POST /api/hit adds
one to `map` or `welcome` unless the request's User-Agent names a robot (read for that
test, never kept nor logged) or the hour's cap is reached; the API adds one to `signin`
when it opens a session (app.open_session). Older hours are folded into Paris days, older
days into months (lacarte_retention(), migration 023)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import yaml

from lacarte import regions

PARIS = ZoneInfo("Europe/Paris")
COUNTERS = ("map", "welcome", "signin")
PAGE_COUNTERS = ("map", "welcome")  # what POST /api/hit accepts: never `signin`


def rules() -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / "stats.yaml").read_text())


def utc_now() -> datetime:
    return datetime.now(UTC)


def paris_day() -> date:
    """The day in Paris now: the counters' day, whatever the server's time zone."""
    return utc_now().astimezone(PARIS).date()


def is_bot(user_agent: str | None, conf: dict) -> bool:
    """Whether a hit with this User-Agent is left out: none (count_without_user_agent), or
    one holding a substring of `bots` (any case)."""
    if not user_agent:
        return not conf["count_without_user_agent"]
    ua = user_agent.lower()
    return any(b in ua for b in conf["bots"])


def this_hour() -> datetime:
    """The start of the current hour, in UTC: Paris's offsets are whole hours, so a Paris
    hour starts on a UTC hour (site_counters_hour's CHECK)."""
    return utc_now().replace(minute=0, second=0, microsecond=0)


HIT_SQL = """
INSERT INTO site_counters_hour AS s (at, counter, n) VALUES (%s, %s, 1)
ON CONFLICT (at, counter) DO UPDATE SET n = s.n + 1 WHERE s.n < %s
"""


def hit(conn, counter: str, cap: int, at: datetime | None = None) -> bool:
    """One more on `counter` for the hour (`at`, the current one by default), unless it
    reached `cap`; whether it was counted."""
    return conn.execute(HIT_SQL, (at or this_hour(), counter, cap)).rowcount == 1


# --- /revue « Statistiques » --------------------------------------------------------------
#
# One block per question (plan-revue §6 bis), each with its count `n`, `need` (the
# thresholds of rules/stats.yaml under the measures' keys) and `enough`: whether every
# measure reaches its need. Counts have no threshold (lot M, 2026-10-17: an
# administrators' screen of totals shows them from the first one, `need` empty, always
# enough); only the computed values do — the queue's median wait (`n`, `n_weeks`), the
# contributors' top-three share, the share published on OSM —, and `enough` speaks of
# them only: the page shows them all the same, said to rest on few figures. Test
# accounts are left out everywhere; a « Modifier » send (its pieces share a batch) counts
# once; the queue counts decidable contributions only (no opinion, no « Je ne sais pas »).

ACCEPTED = ("validated", "applied", "superseded")
# A send: its batch, or the contribution itself.
SEND = "coalesce(c.batch, c.uuid)::text"
NOT_TEST = "NOT coalesce(a.test, false)"
FROM = "FROM contributions c LEFT JOIN accounts a ON a.id = c.author_id"


def block(enough_on: dict[str, int], need: dict[str, int], **data) -> dict:
    return {"enough": all(enough_on[k] >= v for k, v in need.items()), **enough_on,
            "need": need, **data}  # fmt: skip


def days_back(today: date, n: int) -> list[date]:
    """The `n` days up to today, oldest first."""
    return [date.fromordinal(today.toordinal() - i) for i in range(n - 1, -1, -1)]


def monday(d: date) -> date:
    return date.fromordinal(d.toordinal() - d.weekday())


def month_of(d: date) -> str:
    return d.strftime("%Y-%m")


# --- the site's use: hours, days, weeks, months (the « go » of 17/10) ---------------------
#
# Each block: `rows`, oldest first, zero-filled over its whole window (24 hours, 30 days,
# the Mondays of 13 months, 13 months); counted visits and sessions, never people.
# `contributions`: the sends received that day (a « Modifier » counts once, opinions and
# « Je ne sais pas » included, a withdrawn one too: it was received), dated by their first
# piece; `decisions`: the decidable sends decided that day (decided_on; a withdrawal is not
# a decision). Test accounts left out of both.


def zero() -> dict[str, int]:
    return dict.fromkeys(COUNTERS, 0)


def counter_days(conn, first: date, last: date) -> dict[date, dict[str, int]]:
    """The counters of each Paris day from `first` to `last`: its day row (folded), plus
    its hours not folded yet (migration 023 folds the hours of a day 7 days on): the same
    whether the retention ran or not, since a folded hour is deleted in the same
    statement."""
    out: dict[date, dict[str, int]] = {}
    for d, counter, n in conn.execute(
        "SELECT d, counter, sum(n) FROM (SELECT day AS d, counter, n FROM site_counters"
        " UNION ALL SELECT (at AT TIME ZONE 'Europe/Paris')::date, counter, n"
        " FROM site_counters_hour) t WHERE d BETWEEN %s AND %s GROUP BY 1, 2",
        (first, last),
    ):
        out.setdefault(d, zero())[counter] = int(n)
    return out


def activity(conn, first: date, last: date, decidable: str) -> tuple[dict, dict]:
    """(sends received, sends decided) by Paris day from `first` to `last`."""
    received: dict[date, int] = {}
    for (d,) in conn.execute(
        f"SELECT min(c.day) {FROM} WHERE {NOT_TEST} GROUP BY {SEND}"
        " HAVING min(c.day) BETWEEN %s AND %s", (first, last)):  # fmt: skip
        received[d] = received.get(d, 0) + 1
    decided: dict[date, int] = {}
    for d, _ in conn.execute(
        f"SELECT DISTINCT c.decided_on, {SEND} {FROM} WHERE {decidable}"
        f" AND c.status <> 'withdrawn' AND c.decided_on BETWEEN %s AND %s AND {NOT_TEST}",
        (first, last),
    ).fetchall():
        decided[d] = decided.get(d, 0) + 1
    return received, decided


def hours(conn, now: datetime, today: date, keep_days: int) -> dict:
    """The last 24 hours (the current one included), each with `ref`: the mean of the same
    Paris hour over the 7 days before, counted over the days whose hour was counted (since
    the first hour counted, not yet folded: today and the `keep_days` before are kept);
    null with none. On the night summer time ends, Paris's 02:00 holds two hours (both
    summed into it); on the night it starts there is no 02:00 (that day is left out)."""
    hour = timedelta(hours=1)
    shown = [now - hour * i for i in range(23, -1, -1)]
    since = now - timedelta(days=8, hours=2)
    by_at: dict[datetime, dict[str, int]] = {}
    for at, counter, n in conn.execute(
        "SELECT at, counter, n FROM site_counters_hour WHERE at >= %s AND at <= %s",
        (since, now),
    ):
        by_at.setdefault(at.astimezone(UTC), zero())[counter] = n
    first = conn.execute("SELECT min(at) FROM site_counters_hour").fetchone()[0]
    cut = date.fromordinal(today.toordinal() - keep_days)
    slots: dict[tuple[date, int], list[datetime]] = {}
    t = since
    while t <= now:
        local = t.astimezone(PARIS)
        slots.setdefault((local.date(), local.hour), []).append(t)
        t += hour
    rows = []
    for at in shown:
        local = at.astimezone(PARIS)
        seen = []
        for k in range(1, 8):
            slot = (date.fromordinal(local.date().toordinal() - k), local.hour)
            ts = slots.get(slot)
            if not ts or first is None or min(ts) < first or slot[0] < cut:
                continue
            day = zero()
            for t in ts:
                for c, n in by_at.get(t, {}).items():
                    day[c] += n
            seen.append(day)
        ref = ({c: round(sum(d[c] for d in seen) / len(seen), 2) for c in COUNTERS}
               if seen else None)  # fmt: skip
        rows.append({"at": local.isoformat(), **by_at.get(at, zero()), "ref": ref})
    return block({"n": sum(r["map"] for r in rows)}, {}, rows=rows)


def days(conn, today: date, conf: dict, decidable: str) -> dict:
    """The last `window_days` Paris days, today included (its hours counted already)."""
    window = days_back(today, conf["window_days"])
    counts = counter_days(conn, window[0], today)
    received, decided = activity(conn, window[0], today, decidable)
    rows = [{"day": d.isoformat(), **counts.get(d, zero()), "contributions": received.get(d, 0),
             "decisions": decided.get(d, 0)} for d in window]  # fmt: skip
    return block({"n": sum(r["map"] for r in rows)}, {}, rows=rows)


def months_back(today: date, n: int) -> list[date]:
    """The first days of the `n` months up to today's, oldest first."""
    k = today.year * 12 + today.month - 1
    return [date((k - i) // 12, (k - i) % 12 + 1, 1) for i in range(n - 1, -1, -1)]


def weeks(conn, today: date, conf: dict, decidable: str) -> dict:
    """The weeks (from Monday) of the last `months` months: from the Monday of the week of
    its first day (kept: days are kept the 13 whole months before the current one) to this
    week, the days' figures added up."""
    first = monday(months_back(today, conf["months"])[0])
    counts = counter_days(conn, first, today)
    received, decided = activity(conn, first, today, decidable)
    rows = []
    w = first
    while w <= today:
        span = [date.fromordinal(w.toordinal() + i) for i in range(7)]
        row = {"week": w.isoformat(), **zero(), "contributions": 0, "decisions": 0}
        for d in span:
            for c, n in counts.get(d, {}).items():
                row[c] += n
            row["contributions"] += received.get(d, 0)
            row["decisions"] += decided.get(d, 0)
        rows.append(row)
        w = date.fromordinal(w.toordinal() + 7)
    return block({"n": sum(r["map"] for r in rows)}, {}, rows=rows)


def months(conn, today: date, conf: dict) -> dict:
    """Sign-ups by month over the last `months` months (accounts.created_month: the only
    date an account keeps), test accounts and unclaimed placeholders left out."""
    window = months_back(today, conf["months"])
    got = dict(conn.execute(
        "SELECT created_month, count(*) FROM accounts WHERE NOT test"
        " AND (password_hash IS NOT NULL OR osm_id IS NOT NULL) AND created_month >= %s"
        " GROUP BY 1", (window[0],)).fetchall())  # fmt: skip
    rows = [{"month": m.strftime("%Y-%m"), "signups": got.get(m, 0)} for m in window]
    return block({"n": sum(r["signups"] for r in rows)}, {}, rows=rows)


def sends(conn, decidable: str) -> dict[str, dict]:
    """Every decidable send not withdrawn, of no test account: its day (the earliest of its
    pieces), when it was decided (the latest decision, once every piece has one), whether a
    piece waits now."""
    out: dict[str, dict] = {}
    for key, day, decided, status in conn.execute(
        f"SELECT {SEND}, c.day, c.decided_on, c.status {FROM}"
        f" WHERE {decidable} AND c.status <> 'withdrawn' AND {NOT_TEST}"
    ):
        s = out.setdefault(key, {"day": day, "decided": [], "waiting": False})
        s["day"] = min(s["day"], day)
        s["decided"].append(decided)
        s["waiting"] |= status == "pending"
    for s in out.values():
        s["decided"] = None if None in s["decided"] else max(s["decided"])
    return out


def queue(conn, today: date, conf: dict, decidable: str) -> dict:
    """« La file grossit-elle ? »: sends in and decided a week (weeks from Monday), how many
    waited each day (made by then, not decided by then), what waits now, the oldest, and
    the median wait of the sends decided over the window."""
    all_ = list(sends(conn, decidable).values())
    window = days_back(today, conf["window_days"])
    weeks = []
    w = monday(window[0])
    while w <= today:
        end = date.fromordinal(w.toordinal() + 6)
        weeks.append({"week": w.isoformat(),
                      "in": sum(w <= s["day"] <= end for s in all_),
                      "decided": sum(s["decided"] is not None and w <= s["decided"] <= end
                                     for s in all_)})  # fmt: skip
        w = date.fromordinal(w.toordinal() + 7)
    pending_by_day = [{"day": d.isoformat(), "n": sum(
        s["day"] <= d and (s["decided"] is None or s["decided"] > d) for s in all_)}
        for d in window]  # fmt: skip
    waiting = [s["day"] for s in all_ if s["waiting"]]
    waits = sorted((s["decided"] - s["day"]).days for s in all_
                   if s["decided"] is not None and window[0] <= s["decided"] <= today)  # fmt: skip
    first = min((s["day"] for s in all_), default=None)
    measures = {"n": len(all_), "n_weeks": (today - first).days // 7 if first else 0}
    return block(measures, {"n": conf["contributions"], "n_weeks": conf["weeks"]},
                 weekly=weeks, pending_by_day=pending_by_day, pending_now=len(waiting),
                 oldest_days=(today - min(waiting)).days if waiting else None,
                 median_wait_days=median(waits))  # fmt: skip


def median(values: list[int]) -> float | None:
    if not values:
        return None
    mid = len(values) // 2
    return float(values[mid]) if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def contributors(conn, today: date, conf: dict, decidable: str) -> dict:
    """« Qui contribue ? »: accounts active a month (any contribution not withdrawn) and new
    ones (their first contribution that month), over the last 13 months; over the window,
    the share of accepted sends made by its three first accounts and its top by accepted
    sends (made in the window, accepted since)."""
    rows = conn.execute(
        f"SELECT c.author_id::text, c.day, {SEND}, c.status = ANY(%s) AND {decidable} {FROM}"
        f" WHERE c.author_id IS NOT NULL AND c.status <> 'withdrawn' AND {NOT_TEST}",
        (list(ACCEPTED),),
    ).fetchall()
    first_month: dict[str, str] = {}
    active: dict[str, set[str]] = {}
    for author, day, _, _ in rows:
        m = month_of(day)
        active.setdefault(m, set()).add(author)
        first_month[author] = min(first_month.get(author, m), m)
    months = sorted(active)[-13:]
    if months:
        months = [m for m in month_range(months[0], month_of(today))][-13:]
    monthly = [{"month": m, "active": len(active.get(m, ())),
                "new": sum(f == m for f in first_month.values())} for m in months]  # fmt: skip
    since = days_back(today, conf["window_days"])[0]
    recent = [r for r in rows if since <= r[1] <= today]
    accepted: dict[str, set[str]] = {}
    for author, _, send, ok in recent:
        if ok:
            accepted.setdefault(author, set()).add(send)
    ranked = sorted(((len(s), a) for a, s in accepted.items()), key=lambda t: (-t[0], t[1]))
    names = dict(conn.execute("SELECT id::text, pseudonym FROM accounts WHERE id::text = ANY(%s)",
                              ([a for _, a in ranked[: conf["top"]]],)).fetchall())  # fmt: skip
    top = [{"id": a, "pseudonym": names.get(a), "accepted": n} for n, a in ranked[: conf["top"]]]
    total = sum(n for n, _ in ranked)
    share = round(sum(n for n, _ in ranked[:3]) / total, 3) if total else None
    measures = {"n": len({r[0] for r in recent})}
    return block(measures, {"n": conf["active"]}, monthly=monthly, top3_share=share, top=top)


def month_range(first: str, last: str) -> list[str]:
    y, m = map(int, first.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def osm(conn, conf: dict, decidable: str, server: str | None) -> dict:
    """« Quelle part part sur OSM ? »: the accepted sends, and among them those published on
    the server writing is offered on (the live one when none is), in conflict there, being
    sent, uncertain (a sending the job could not match, migration 022), and those that stay
    on Surveillance World. A send takes its pieces' furthest state: conflict, then
    uncertain, then sending, then published."""
    on = server or "live"
    states: dict[str, set[str]] = {}
    for send, state in conn.execute(
        f"SELECT {SEND}, p.state {FROM} LEFT JOIN osm_publications p ON p.uuid = c.uuid"
        f" AND p.server = %s WHERE c.status = ANY(%s) AND {decidable} AND {NOT_TEST}",
        (on, list(ACCEPTED)),
    ):
        states.setdefault(send, set()).add(state)
    counts = dict.fromkeys(("published", "conflict", "sending", "uncertain"), 0)
    for got in states.values():
        for state in ("conflict", "uncertain", "sending", "published"):
            if state in got:
                counts[state] += 1
                break
    accepted = len(states)
    return block({"n": accepted}, {"n": conf["accepted"]}, offered=server is not None,
                 server=on, accepted=accepted, **counts,
                 stays=accepted - sum(counts.values()))  # fmt: skip


def hidden(conn) -> dict:
    """« Retraits »: the cameras hidden now, by the month they were hidden."""
    monthly = [{"month": m, "n": n} for m, n in conn.execute(
        "SELECT to_char(added_on, 'YYYY-MM'), count(*) FROM hidden_cameras GROUP BY 1"
        " ORDER BY 1")]  # fmt: skip
    return block({"n": sum(r["n"] for r in monthly)}, {}, monthly=monthly)


def review_stats(conn, decidable: str, server: str | None) -> dict:
    """GET /api/review/stats, now: `decidable`, the review's SQL condition (app.DECIDABLE);
    `server`, the OSM server writing is offered on, None when it is not."""
    every = rules()
    conf = every["blocks"]
    now = this_hour()
    today = now.astimezone(PARIS).date()
    return {
        "today": today.isoformat(),
        "hours": hours(conn, now, today, every["hour_retention_days"]),
        "days": days(conn, today, conf["days"], decidable),
        "weeks": weeks(conn, today, conf["weeks"], decidable),
        "months": months(conn, today, conf["months"]),
        "queue": queue(conn, today, conf["queue"], decidable),
        "contributors": contributors(conn, today, conf["contributors"], decidable),
        "osm": osm(conn, conf["osm"], decidable, server),
        "hidden": hidden(conn),
    }
