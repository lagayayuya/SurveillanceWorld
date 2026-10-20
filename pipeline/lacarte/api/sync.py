"""The OpenStreetMap synchronisation's job (the owner's decision of 16/10,
migration 022, rules/publish.yaml sync).

It runs in the API's process (one uvicorn worker; no unit of its own): a thread started
with the app passes every sync.every_minutes, and once sync.first_pass_s after the start;
`lacarte osm sync --once` runs one pass by hand or in a test. A pass holds a PostgreSQL
advisory lock on its own connection, so two passes never run together, whichever process
starts them. A pass:

1. /revue's osm_sync off (suspended), or writing not offered: it stops, no call to OSM.
2. The `sending` rows (an upload without a clear answer) are reconciled with their
   changeset, read publicly: still open, they wait; closed with no change, they go (the
   contributions may leave again); closed with changes, OSM's content of it is read and our
   nodes found in it: published, else `uncertain`, never sent again.
3. For each account whose choice is on, on the server writing goes to, with a token, not
   disabled, not a test account, not blocked by OSM, under the day's cap and past its
   backoff: what may leave (publish.selection from her consent day); nothing, no call to
   OSM. Something: her token's permissions (empty, or 401: OSM refused it — the token is
   deleted, her choice is back to « Rester », said in « Compte »), then one changeset
   (publish.send: nodes read again, never overwritten, adds checked for a camera nearby).
4. A refusal is kept as a class (revoked, blocked, rate_limited, osm_down) with the
   refusals in a row; when to try again is kept here in memory (no time of day in the
   database): the backoff's step from the time of the refusal, and after a restart from
   the first time the account is seen again.

Logs: a pass's counts and classes (at WARNING when it sent, reconciled, skipped or met a
refusal, the API's journal level; at INFO otherwise), never a token, an account, a camera,
a node or a changeset id.
"""

from __future__ import annotations

import argparse
import json
import logging
import threading
import time
import urllib.error
from collections import Counter
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date

from lacarte.api import osm, publish

log = logging.getLogger("lacarte.api")

# pg_try_advisory_lock's key: one pass at a time, in the API or the CLI.
LOCK = 0x05A_4C41_4341_5254  # "lacart" in the low bytes, any constant would do
CREATED_WITHIN_M = 1.0  # a created node is ours when it stands where our add put it


@dataclass
class Config:
    """What a pass needs from the API: the tokens' key; the server writing goes to when it
    is offered, given /revue's osm_write_live (app.publish_server); a configured server by
    its name (app.server_named: reconciling a changeset, revoking a token); and how a
    token is revoked at OSM."""

    key: bytes | None
    offered: Callable[[bool], osm.Server | None]
    known: Callable[[str], osm.Server | None]
    revoke: Callable[[osm.Server, str], None] = osm.revoke


class Backoff:
    """When an account may be tried again after OSM refused it: in memory (a time of day
    is not stored), the backoff's step (rules/publish.yaml sync.backoff_minutes) from the
    refusal; seen again after a restart with refusals in a row, from that moment."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.until: dict[str, float] = {}
        self.lock = threading.Lock()

    @staticmethod
    def step(failures: int) -> float:
        steps = publish.rules()["sync"]["backoff_minutes"]
        return 60.0 * steps[min(failures, len(steps)) - 1]

    def waiting(self, account: str, failures: int) -> bool:
        with self.lock:
            if failures <= 0:
                self.until.pop(account, None)
                return False
            until = self.until.setdefault(account, self.clock() + self.step(failures))
            return self.clock() < until

    def failed(self, account: str, failures: int) -> None:
        with self.lock:
            self.until[account] = self.clock() + self.step(failures)

    def clear(self, account: str) -> None:
        with self.lock:
            self.until.pop(account, None)


backoff = Backoff()


@dataclass
class Summary:
    """A pass's counts: what the log line and `--once` say, never an id."""

    ran: bool = True
    state: str = "done"  # done | suspended | not_offered | busy
    server: str | None = None
    accounts: int = 0  # with something to send
    changesets: int = 0
    published: int = 0
    conflicts: int = 0
    reconciled: Counter = field(default_factory=Counter)  # waiting, cleared, published, uncertain
    skipped: Counter = field(default_factory=Counter)  # capped, backoff
    errors: Counter = field(default_factory=Counter)  # revoked, blocked, rate_limited, …

    def as_dict(self) -> dict:
        return {"ran": self.ran, "state": self.state, "server": self.server,
                "accounts": self.accounts, "changesets": self.changesets,
                "published": self.published, "conflicts": self.conflicts,
                "reconciled": dict(self.reconciled), "skipped": dict(self.skipped),
                "errors": dict(self.errors)}  # fmt: skip

    def line(self) -> str:
        def counts(c: Counter) -> str:
            return ",".join(f"{k}:{v}" for k, v in sorted(c.items())) or "-"

        return (f"osm sync pass: {self.state}, accounts {self.accounts}, changesets"
                f" {self.changesets}, published {self.published}, conflicts {self.conflicts},"
                f" reconciled {counts(self.reconciled)}, skipped {counts(self.skipped)},"
                f" errors {counts(self.errors)}")  # fmt: skip


def switches(conn) -> tuple[bool, bool]:
    """(osm_sync, osm_write_live) as the database has them now (migration 022's defaults
    for a missing row)."""
    rows = conn.execute("SELECT key, value FROM site_settings"
                        " WHERE key IN ('osm_sync', 'osm_write_live')").fetchall()  # fmt: skip
    read = dict(rows)
    return read.get("osm_sync", True), read.get("osm_write_live", False)


def once(connect: Callable, config: Config, today: date | None = None) -> dict:
    """One pass, on a connection of its own (`connect()`: autocommit, closed after), under
    the advisory lock; another pass under way: nothing (busy)."""
    with connect() as conn:
        if not conn.execute("SELECT pg_try_advisory_lock(%s)", (LOCK,)).fetchone()[0]:
            summary = Summary(ran=False, state="busy")
        else:
            try:
                summary = run(conn, config, today or date.today())
            finally:
                conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK,))
    # The API's unit logs from WARNING up (uvicorn --log-level warning, no logging config of
    # ours): a pass that did or met something is said there; a pass with nothing to do, at
    # INFO, stays out of the journal (every 15 minutes).
    busy = (summary.changesets or summary.published or summary.conflicts
            or summary.reconciled or summary.errors or summary.skipped)  # fmt: skip
    log.log(logging.WARNING if busy else logging.INFO, "%s", summary.line())
    return summary.as_dict()


def run(conn, config: Config, today: date) -> Summary:
    summary = Summary()
    on, live = switches(conn)
    if not on:
        summary.state = "suspended"
        return summary
    server = config.offered(live) if config.key is not None else None
    if server is None:
        summary.state = "not_offered"
        return summary
    summary.server = server.name
    reconcile(conn, config, summary)
    rows = conn.execute(
        "SELECT w.account_id::text, w.token, w.consent_day, w.failures, w.sent_day, w.sent_n"
        " FROM osm_write w JOIN accounts a ON a.id = w.account_id"
        " WHERE w.server = %s AND w.token IS NOT NULL AND NOT a.disabled AND NOT a.test"
        " AND coalesce(w.last_error, '') <> 'blocked' ORDER BY w.account_id",
        (server.name,),
    ).fetchall()
    cap = publish.rules()["sync"]["max_changesets_per_day"]
    for account, sealed, consent, failures, sent_day, sent_n in rows:
        if sent_day == today and sent_n >= cap:
            summary.skipped["capped"] += 1
            continue
        if backoff.waiting(account, failures):
            summary.skipped["backoff"] += 1
            continue
        one(conn, config, server, today, summary, account, bytes(sealed), consent, failures)
    return summary


@contextmanager
def reused(conn):
    """publish.send's `connect`: the pass's own connection, kept open."""
    yield conn


def chosen(items: list[publish.Item]) -> list[publish.Item]:
    """The cameras of this pass: the oldest observation first, at most max_cameras."""
    items = sorted(items, key=lambda i: (min(c.day for c in i.contributions), i.camera))
    return items[: publish.rules()["max_cameras"]["value"]]


def one(conn, config: Config, server: osm.Server, today: date, summary: Summary,
        account: str, sealed: bytes, consent: date, failures: int) -> None:  # fmt: skip
    """One account's turn: what may leave, then her token, then one changeset."""
    items, _ = publish.selection(conn, account, server.name, consent)
    if not items:
        return
    summary.accounts += 1
    mine = "account_id = %s AND server = %s AND token = %s"
    who = (account, server.name, sealed)
    try:
        token = publish.unseal(config.key, account, server.name, sealed)
    except Exception as exc:  # noqa: BLE001
        # Another OSM_TOKEN_KEY than the one that sealed it (a deploy with a wrong key):
        # her choice and her token are kept untouched, for the right key to read again.
        log.warning("osm write token unreadable: %s", type(exc).__name__)
        summary.errors["unreadable"] += 1
        return
    stop = permitted(server, token)
    if stop is None:

        def hold(c, going: list[str]) -> bool:
            """Just before the upload, as at the pass's start: her choice still on with this
            token, the synchronisation not suspended nor moved to another server, and each
            contribution going still selected (not rejected, its camera not hidden, her
            account not disabled since the pass read them)."""
            if c.execute(f"SELECT 1 FROM osm_write WHERE {mine} FOR UPDATE",
                         who).fetchone() is None:  # fmt: skip
                return False
            on, live = switches(c)
            now = config.offered(live) if on else None
            if now is None or now.name != server.name:
                return False
            still, _ = publish.selection(c, account, server.name, consent)
            return set(going) <= {x.uuid for i in still for x in i.contributions}

        def opened(_changeset: int) -> None:
            summary.changesets += 1
            conn.execute(f"UPDATE osm_write SET sent_n = CASE WHEN sent_day = %s THEN"
                         f" sent_n + 1 ELSE 1 END, sent_day = %s WHERE {mine}",
                         (today, today, *who))  # fmt: skip

        try:
            out = publish.send(lambda: reused(conn), server, token, chosen(items), hold=hold,
                               opened=opened)  # fmt: skip
        except publish.Stop as exc:
            stop = exc.error
        else:
            summary.published += len(out["published"])
            summary.conflicts += len(out["conflicts"])
            conn.execute(f"UPDATE osm_write SET failures = 0, last_error = NULL WHERE {mine}",
                         who)  # fmt: skip
            backoff.clear(account)
            return
    if stop in ("changed", "off"):
        summary.errors[stop] += 1  # the next pass reads OSM again; or she stopped
        return
    if stop == "revoked":
        config.revoke(server, token)  # best effort: a token without the right to write
    refused(conn, mine, who, stop, failures, summary)
    if stop in ("rate_limited", "osm_down"):
        backoff.failed(account, failures + 1)


def permitted(server: osm.Server, token: str) -> str | None:
    """None when OSM still lets the token write (GET /api/0.6/permissions), else the
    refusal's class: revoked (401, or no allow_write_api: « If the API client is not
    authorized, an empty list of permissions will be returned », wiki « API v0.6 »),
    blocked (403), rate_limited (429), osm_down (anything else)."""
    try:
        granted = osm.permissions(server, token)
    except urllib.error.HTTPError as exc:
        return {401: "revoked", 403: "blocked", 429: "rate_limited"}.get(exc.code, "osm_down")
    except Exception:  # noqa: BLE001 — no answer, not JSON, not a list
        return "osm_down"
    return None if "allow_write_api" in granted else "revoked"


def refused(conn, mine: str, who: tuple, error: str, failures: int, summary: Summary) -> None:
    """OSM refused this account's pass: its class kept, one refusal more; revoked: the
    token deleted (her choice back to « Rester », said in « Compte »)."""
    summary.errors[error] += 1
    token = ", token = NULL" if error == "revoked" else ""
    conn.execute(f"UPDATE osm_write SET last_error = %s, failures = %s{token} WHERE {mine}",
                 (error, min(failures + 1, 32767), *who))  # fmt: skip


# --- reconciling what an upload left `sending` ---------------------------------------------


def reconcile(conn, config: Config, summary: Summary) -> None:
    """Each changeset with `sending` rows, on a server the API knows: read publicly, then
    waiting, cleared, published or uncertain."""
    pending = conn.execute("SELECT DISTINCT server, changeset FROM osm_publications"
                           " WHERE state = 'sending' ORDER BY 1, 2").fetchall()  # fmt: skip
    for server_name, changeset in pending:
        server = config.known(server_name)
        if server is None:
            continue
        try:
            body = publish.call(server.url, None, "GET", f"/changeset/{changeset}")
            info = publish.ET.fromstring(body).find("changeset")
            is_open = info.get("open") == "true"
            changes = int(info.get("changes_count", ""))
        except publish.Refused as exc:
            if exc.status == 404:  # unknown to OSM: nothing can say what became of it
                outcome(conn, server_name, changeset, "uncertain", summary)
            else:
                summary.reconciled["unread"] += 1
            continue
        except (publish.ET.ParseError, AttributeError, ValueError):
            summary.reconciled["unread"] += 1
            continue
        if is_open:
            summary.reconciled["waiting"] += 1
        elif changes == 0:  # nothing went: they may leave again
            n = conn.execute(
                "DELETE FROM osm_publications WHERE server = %s AND changeset = %s"
                " AND state = 'sending'", (server_name, changeset)).rowcount  # fmt: skip
            summary.reconciled["cleared"] += n
        else:
            matched(conn, server, changeset, summary)


def outcome(conn, server: str, changeset: int, state: str, summary: Summary,
            uuids: list[str] | None = None) -> None:  # fmt: skip
    n = conn.execute(
        "UPDATE osm_publications SET state = %s WHERE server = %s AND changeset = %s"
        " AND state = 'sending'" + (" AND uuid = ANY(%s::uuid[])" if uuids is not None else ""),
        (state, server, changeset, *([uuids] if uuids is not None else [])),
    ).rowcount
    summary.reconciled[state] += n


def matched(conn, server: osm.Server, changeset: int, summary: Summary) -> None:
    """A closed changeset with changes: its content read; each camera's rows published when
    its node is in it (an OSM camera's or a node we made: modified by id; an add: created
    where it was put), else uncertain."""
    try:
        body = publish.call(server.url, None, "GET", f"/changeset/{changeset}/download")
        content = []
        for block in publish.ET.fromstring(body):
            for n in block.iter("node"):
                content.append((block.tag, int(n.get("id", "")), int(n.get("version", "")),
                                float(n.get("lon", "")), float(n.get("lat", "")),
                                {t.get("k"): t.get("v") for t in n.iter("tag")}))  # fmt: skip
    except (publish.Refused, publish.ET.ParseError, ValueError):
        summary.reconciled["unread"] += 1
        return
    rows = conn.execute(
        "SELECT p.uuid::text, c.camera_id, c.osm_type, c.osm_id, n.node_id,"
        " ST_X(ST_Transform(c.geom, 4326)), ST_Y(ST_Transform(c.geom, 4326))"
        " FROM osm_publications p JOIN contributions c ON c.uuid = p.uuid"
        " LEFT JOIN osm_nodes n ON n.server = p.server AND n.camera_id = c.camera_id"
        " WHERE p.server = %s AND p.changeset = %s AND p.state = 'sending'",
        (server.name, changeset),
    ).fetchall()
    cameras: dict[str, dict] = {}
    for uid, cam, osm_type, osm_id, node_id, lon, lat in rows:
        c = cameras.setdefault(cam, {"uuids": [], "node": osm_id if osm_type == "n" else node_id,
                                     "at": []})  # fmt: skip
        c["uuids"].append(uid)
        c["at"].append((lon, lat))
    for cam, c in sorted(cameras.items()):
        found = None
        for action, nid, version, lon, lat, tags in content:
            if c["node"] is not None:
                if action == "modify" and nid == c["node"]:
                    found = (nid, version)
            elif (
                action == "create"
                and tags.get("man_made") == "surveillance"
                and any(
                    publish.metres_between(x, y, lon, lat) <= CREATED_WITHIN_M for x, y in c["at"]
                )
            ):
                found = (nid, version)
        if found is None:
            outcome(conn, server.name, changeset, "uncertain", summary, c["uuids"])
            continue
        conn.execute(
            "INSERT INTO osm_nodes (server, camera_id, node_id, version) VALUES (%s, %s, %s, %s)"
            " ON CONFLICT (server, camera_id) DO UPDATE SET node_id = EXCLUDED.node_id,"
            " version = greatest(osm_nodes.version, EXCLUDED.version)",
            (server.name, cam, *found),
        )
        outcome(conn, server.name, changeset, "published", summary, c["uuids"])


# --- the thread, and the command ------------------------------------------------------------


class Job:
    """The API's thread: `run()` (one pass) after first_s, then every every_s, until
    stop(). A pass that fails is logged by its class; the next one comes all the same."""

    def __init__(self, run: Callable[[], dict], every_s: float, first_s: float) -> None:
        self.run, self.every_s, self.first_s = run, every_s, first_s
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self.loop, name="osm-sync", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def loop(self) -> None:
        wait = self.first_s
        while not self.stopping.wait(wait):
            try:
                self.run()
            except Exception as exc:  # noqa: BLE001 — the class only, as the API logs
                log.error("osm sync pass failed: %s", type(exc).__name__)
            wait = self.every_s

    def stop(self, timeout: float = 30.0) -> None:
        self.stopping.set()
        if self.thread.is_alive():
            self.thread.join(timeout)


def main(argv: list[str], prog: str = "lacarte osm") -> int:
    """`lacarte osm sync --once [--dsn DSN]`: one pass now, with the API's environment (its
    OSM clients, OSM_TOKEN_KEY, LACARTE_DSN or --dsn); prints the pass's counts."""
    parser = argparse.ArgumentParser(prog=prog)
    sub = parser.add_subparsers(dest="cmd", required=True)
    one_pass = sub.add_parser("sync", help="one pass of the OSM synchronisation")
    one_pass.add_argument("--once", action="store_true", required=True,
                          help="one pass now (the API's thread runs the others)")  # fmt: skip
    one_pass.add_argument("--dsn", help="libpq connection string (default: LACARTE_DSN)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    from lacarte.api import app as api  # the API's settings: its clients and key

    print(json.dumps(api.sync_once(args.dsn)))
    return 0
