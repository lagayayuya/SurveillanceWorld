"""What is kept and for how long, applied by the API every Paris day (the « go » of 17/10,
migration 023): the journal 12 months, the counters' hours 7 days, their days 13 whole
months (rules/stats.yaml). The work is the database's, lacarte_retention(), which the
API's role may run (SECURITY DEFINER) though it may neither delete a journal line nor fold
a counter itself.

A thread in the API's process (no timer of the system, no root step): one run
retention_thread.first_pass_s after the start, then a look every check_minutes, and a run
when the Paris day changed since the last one. A run tries a transaction-level advisory
lock first (released when its transaction ends, « Advisory Lock Functions », PostgreSQL
docs): another API running it, nothing (busy). RETENTION_THREAD=off leaves the thread out
(the tests, tests/apiserver.py's benches). Logged at WARNING when it did something (the
API's journal level), at INFO otherwise; counts only.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from datetime import date

from lacarte.api import stats

log = logging.getLogger("lacarte.api")

# pg_try_advisory_xact_lock's key, the one lacarte_retention_at() waits on (migration 023):
# b"lcRetain" read as a big-endian integer; any constant other than sync.LOCK would do.
LOCK = 7810176774488287598


def once(connect: Callable) -> dict:
    """One run on a connection of its own (`connect()`: autocommit, closed after), in one
    transaction under the lock — on an autocommit connection, transaction() runs BEGIN on
    entry and COMMIT on exit (psycopg 3 docs, « Transactions management »): {ran, journal,
    hours, days}; busy: ran False."""
    with connect() as conn, conn.transaction():
        if not conn.execute("SELECT pg_try_advisory_xact_lock(%s)", (LOCK,)).fetchone()[0]:
            log.info("retention: busy")
            return {"ran": False, "journal": 0, "hours": 0, "days": 0}
        journal, hours, days = conn.execute(
            "SELECT journal, hours, days FROM lacarte_retention()"
        ).fetchone()
    did = journal or hours or days
    log.log(logging.WARNING if did else logging.INFO,
            "retention: %d journal lines deleted, %d counter hours and %d counter days folded",
            journal, hours, days)  # fmt: skip
    return {"ran": True, "journal": journal, "hours": hours, "days": days}


class Daily:
    """`run()` once, then again whenever the Paris day (stats.paris_day) is not the one of
    the last run that finished; a run that fails is tried again at the next look."""

    def __init__(self, run: Callable[[], dict]) -> None:
        self.run = run
        self.last: date | None = None

    def __call__(self) -> dict | None:
        today = stats.paris_day()
        if today == self.last:
            return None
        out = self.run()
        self.last = today  # busy: another API ran it today
        return out


class Job:
    """The API's thread: Daily(run) after first_s, then every every_s, until stop()."""

    def __init__(self, run: Callable[[], dict], every_s: float, first_s: float) -> None:
        self.daily, self.every_s, self.first_s = Daily(run), every_s, first_s
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self.loop, name="retention", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def loop(self) -> None:
        wait = self.first_s
        while not self.stopping.wait(wait):
            try:
                self.daily()
            except Exception as exc:  # noqa: BLE001 — the class only, as the API logs
                log.error("retention run failed: %s", type(exc).__name__)
            wait = self.every_s

    def stop(self, timeout: float = 30.0) -> None:
        self.stopping.set()
        if self.thread.is_alive():
            self.thread.join(timeout)
