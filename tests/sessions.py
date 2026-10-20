"""Accounts and sessions for the API tests (migration 014): fictitious accounts in the
throwaway database, a session row written directly (no argon2, no sign-in), and the
headers a signed-in page sends. `rev` is an administrator, `rvw` a reviewer (migration
020); every other name a contributor. A reviewer's or an administrator's session is marked
as the privileged entry marks it (and its password as given again): what /revue's routes
ask (lot 2); test_review_entry.py goes through the entry itself."""

from __future__ import annotations

from datetime import date

import psycopg

from lacarte.api import app as api
from lacarte.api import auth

ORIGIN = "https://preview.test"
ROLES = {"rev": "admin", "rvw": "reviewer"}
REVIEWERS = set(ROLES)
NO_LOGIN = "test-account-without-password"  # not an argon2 hash: never signs in

_dsn: str | None = None
_tokens: dict[tuple[str, str], str] = {}


def configure(dsn: str) -> None:
    """The API on the test database, writes from ORIGIN, the local cookie (no Secure)."""
    global _dsn
    _dsn = dsn
    api.settings.dsn, api.settings.origin = dsn, ORIGIN
    api.settings.cookie_secure = False
    auth.throttle.clear()


def account_id(name: str, dsn: str | None = None, role: str | None = None, conn=None) -> str:
    """The account `name` (created as needed), its id; on `conn` when given (its
    `info.dsn` has no password: a new connection from it fails where one is needed)."""
    role = role or ROLES.get(name, "contributor")
    if conn is not None:
        return _account_id(conn, name, role)
    with psycopg.connect(dsn or _dsn, autocommit=True) as c:
        return _account_id(c, name, role)


def _account_id(conn, name: str, role: str) -> str:
    return conn.execute(
        "INSERT INTO accounts (pseudonym, password_hash, role, created_month)"
        " VALUES (%s, %s, %s, date_trunc('month', current_date))"
        " ON CONFLICT ((lower(pseudonym))) DO UPDATE SET password_hash ="
        " coalesce(accounts.password_hash, EXCLUDED.password_hash)"
        " RETURNING id::text",
        (name, NO_LOGIN, role),
    ).fetchone()[0]


def token(who: str) -> str:
    """A session of `who`, opened once per database (forget() after deleting sessions); a
    reviewer's or an administrator's marked privileged and reauthenticated."""
    key = (_dsn, who)
    if key not in _tokens:
        aid = account_id(who)
        with psycopg.connect(_dsn, autocommit=True) as conn:
            _tokens[key] = auth.open_session(conn, aid, date.today())
            role = conn.execute("SELECT role FROM accounts WHERE id = %s", (aid,)).fetchone()[0]
        if role in auth.PRIVILEGED:
            mark(who, aid)
    return _tokens[key]


def mark(who: str, aid: str | None = None, privileged: bool = True, reauth: bool = True) -> None:
    """`who`'s session marked (or not) as the privileged entry and the reauthentication
    mark it."""
    aid = aid or account_id(who)
    digest = auth.digest(_tokens[(_dsn, who)])
    for marks, on, seconds in ((auth.privileged, privileged, 8 * 3600),
                               (auth.reauthed, reauth, 600)):  # fmt: skip
        if on:
            marks.put(digest, aid, seconds)
        else:
            marks.drop(digest)


def forget() -> None:
    _tokens.clear()


def headers(who: str = "ana", **extra) -> dict:
    """What a page signed in as `who` sends on a write (and harmlessly on a read)."""
    return {"Cookie": f"session={token(who)}", "Origin": ORIGIN,
            "Content-Type": "application/json", **extra}  # fmt: skip
