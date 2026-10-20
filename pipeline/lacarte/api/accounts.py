"""Accounts, by hand: the owner creates them (the first administrator, migration 020),
resets a password, changes a role (recovery: an administrator who lost their access),
disables, enables, deletes and lists them; /revue's « Comptes » does the rest. On the
server, as the deploy user (the tables' owner), from the API release, whose venv has only
the API's dependencies:

    cd /srv/preview/api/current
    PYTHONPATH=pipeline .venv/bin/python -m lacarte.api.accounts list

Locally: `lacarte accounts …` (the same commands). The database: --dsn, else DB_DSN, else
`dbname=preview` (the server's, over the local socket as the deploy user).

A password never travels in the command line (shell history, `ps`): it is asked twice
without echo, or drawn with --generate and printed once. Resetting, disabling and deleting
revoke the account's sessions. Deleting keeps the contributions, without author. Deleting
and resetting a password also end publishing to OpenStreetMap (migration 016): the write
token is deleted here, not revoked at OSM (the CLI holds neither the key nor the client:
the token stays valid at OSM until the person revokes it in her OSM settings).
"""

from __future__ import annotations

import argparse
import getpass
import os
import secrets
import sys
from datetime import date

import psycopg

from lacarte.api import auth

GENERATED_BYTES = 18  # 24 urlsafe characters


def connect(dsn: str):
    return psycopg.connect(dsn, autocommit=True)


def new_password(generate: bool) -> str:
    """Drawn and printed once, or typed twice without echo (at least PASSWORD_MIN)."""
    if generate:
        password = secrets.token_urlsafe(GENERATED_BYTES)
        print(f"password (shown once): {password}")
        return password
    first = getpass.getpass("new password: ")
    if len(first) < auth.PASSWORD_MIN:
        raise SystemExit(f"refused: at least {auth.PASSWORD_MIN} characters")
    if len(first) > auth.PASSWORD_MAX:
        raise SystemExit(f"refused: at most {auth.PASSWORD_MAX} characters")
    if getpass.getpass("again: ") != first:
        raise SystemExit("refused: the two passwords differ")
    return first


def find(conn, pseudonym: str):
    """(id, pseudonym, claimed) of the account, any case; exits when there is none. Claimed:
    not a placeholder (migration 015: a password or an OpenStreetMap user)."""
    row = conn.execute(
        f"SELECT a.id::text, a.pseudonym, {auth.CLAIMED} FROM accounts a"
        " WHERE lower(a.pseudonym) = lower(%s)",
        (pseudonym,),
    ).fetchone()
    if row is None:
        raise SystemExit(f"no account {pseudonym}")
    return row


def revoke(conn, account_id: str) -> int:
    return conn.execute("DELETE FROM sessions WHERE account_id = %s", (account_id,)).rowcount


WRITE_OFF = "; OSM publishing off (token deleted here, not revoked at OSM)"


def drop_write(conn, account_id: str) -> str:
    """The account's OSM write token deleted (migration 016): WRITE_OFF when there was one."""
    done = conn.execute("DELETE FROM osm_write WHERE account_id = %s", (account_id,)).rowcount
    return WRITE_OFF if done else ""


def create(conn, pseudonym: str, role: str, generate: bool) -> None:
    if not auth.PSEUDONYM_RE.fullmatch(pseudonym):
        raise SystemExit("refused: a pseudonym is 2 to 32 of A-Z a-z 0-9 . _ -")
    row = conn.execute(
        f"SELECT a.id::text, a.pseudonym, {auth.CLAIMED} FROM accounts a"
        " WHERE lower(a.pseudonym) = lower(%s)",
        (pseudonym,),
    ).fetchone()
    # Claimed: a password, or an OpenStreetMap account (015) whose person chose the name.
    if row is not None and row[2]:
        raise SystemExit(f"refused: the account {row[1]} exists (reset-password changes it)")
    password_hash = auth.hash_password(new_password(generate))
    if row is None:
        conn.execute(
            "INSERT INTO accounts (pseudonym, password_hash, role, created_month)"
            " VALUES (%s, %s, %s, %s)",
            (pseudonym, password_hash, role, date.today().replace(day=1)),
        )
        print(f"created {pseudonym} ({role})")
        return
    # A placeholder (migration 014: a name contributions held): claimed, its contributions
    # and test flag kept, its spelling the one it had.
    conn.execute(
        "UPDATE accounts SET password_hash = %s, role = %s, disabled = false WHERE id = %s",
        (password_hash, role, row[0]),
    )
    n = conn.execute("SELECT count(*) FROM contributions WHERE author_id = %s",
                     (row[0],)).fetchone()[0]  # fmt: skip
    print(f"claimed {row[1]} ({role}): {n} contribution(s) already its own")


def reset_password(conn, pseudonym: str, generate: bool) -> None:
    account_id, name, _ = find(conn, pseudonym)
    password_hash = auth.hash_password(new_password(generate))
    # The OSM user linked goes too: whoever took the account over may have linked theirs
    # for a way back in; the person links hers again (with the new password).
    unlinked = conn.execute(
        "UPDATE accounts SET password_hash = %s, osm_id = NULL, osm_server = NULL"
        " WHERE id = %s RETURNING (SELECT osm_id IS NOT NULL FROM accounts WHERE id = %s)",
        (password_hash, account_id, account_id),
    ).fetchone()[0]
    osm = "; OpenStreetMap unlinked" if unlinked else ""
    # Publishing too: whoever took the account over may have enabled it with their OSM user.
    write = drop_write(conn, account_id)
    print(f"password of {name} reset; sessions revoked: {revoke(conn, account_id)}{osm}{write}")


ROLES = ("contributor", "reviewer", "admin")  # migration 020


def set_role(conn, pseudonym: str, role: str) -> None:
    """A role, for the first administrator or a recovery (/revue does the rest). A reviewer
    or an administrator signs in to /revue with a password: an account without one (a
    placeholder, an OpenStreetMap account) is refused. Its sessions are revoked: a session
    opened under the old role keeps nothing of it."""
    account_id, name, _ = find(conn, pseudonym)
    has_password = conn.execute("SELECT password_hash IS NOT NULL FROM accounts WHERE id = %s",
                                (account_id,)).fetchone()[0]  # fmt: skip
    if role != "contributor" and not has_password:
        raise SystemExit(f"refused: {name} has no password (a {role} signs in with one)")
    conn.execute("UPDATE accounts SET role = %s WHERE id = %s", (role, account_id))
    print(f"{name} is now {role}; sessions revoked: {revoke(conn, account_id)}")


def set_disabled(conn, pseudonym: str, disabled: bool) -> None:
    account_id, name, _ = find(conn, pseudonym)
    conn.execute("UPDATE accounts SET disabled = %s WHERE id = %s", (disabled, account_id))
    if disabled:
        print(f"{name} disabled; sessions revoked: {revoke(conn, account_id)}")
    else:
        print(f"{name} enabled")


def delete(conn, pseudonym: str) -> None:
    """A real account's contributions stay, without author. A test account's go with it:
    without their author nothing would mark them as test any more, and an accepted one
    would leave in the next build (the export leaves out test accounts only)."""
    account_id, name, _ = find(conn, pseudonym)
    test = conn.execute("SELECT test FROM accounts WHERE id = %s", (account_id,)).fetchone()[0]
    n = conn.execute("SELECT count(*) FROM contributions WHERE author_id = %s",
                     (account_id,)).fetchone()[0]  # fmt: skip
    fate = "deleted with it (a test account)" if test else "stay, without author"
    typed = input(f"delete {name} for good ({n} contribution(s) {fate})?"
                  " Type the pseudonym again: ")  # fmt: skip
    if typed != name:
        raise SystemExit("not deleted: the pseudonym typed differs")
    sessions = revoke(conn, account_id)
    write = drop_write(conn, account_id)  # the cascade would take it silently
    if test:
        # What others said about them (opinions, answers on a test add) is about test data
        # that never reaches the map, and cannot stand without its target: it goes too.
        on = conn.execute("DELETE FROM contributions WHERE target IN"
                          " (SELECT uuid FROM contributions WHERE author_id = %s)",
                          (account_id,)).rowcount  # fmt: skip
        conn.execute("DELETE FROM contributions WHERE author_id = %s", (account_id,))
        if on:
            print(f"{on} contribution(s) of others about them deleted too")
    conn.execute("DELETE FROM accounts WHERE id = %s", (account_id,))
    print(f"{name} deleted; sessions revoked: {sessions}; {n} contribution(s) {fate}{write}")


def listing(conn) -> None:
    # osm: linked to an OpenStreetMap user (migration 015; never its id), `no password`
    # when that is the only way in.
    rows = conn.execute(
        "SELECT pseudonym, role, to_char(created_month, 'YYYY-MM'),"
        f" CASE WHEN NOT {auth.CLAIMED} THEN 'placeholder'"
        "      WHEN disabled THEN 'disabled' ELSE 'active' END,"
        " CASE WHEN osm_id IS NULL THEN '' WHEN password_hash IS NULL THEN 'no password'"
        "      ELSE 'linked' END,"
        " coalesce((SELECT server FROM osm_write WHERE account_id = a.id), '-'),"
        " CASE WHEN test THEN 'test' ELSE '' END, CASE WHEN leaderboard THEN 'shown' ELSE '' END,"
        " (SELECT count(*) FROM contributions WHERE author_id = a.id),"
        " (SELECT count(*) FROM sessions WHERE account_id = a.id)"
        " FROM accounts a ORDER BY lower(pseudonym)"
    ).fetchall()
    head = ("pseudonym", "role", "since", "state", "osm", "publish", "test", "leaderboard",
            "contributions", "sessions")  # fmt: skip
    table = [head, *[tuple(str(v) for v in r) for r in rows]]
    widths = [max(len(r[i]) for r in table) for i in range(len(head))]
    for r in table:
        print("  ".join(v.ljust(w) for v, w in zip(r, widths, strict=True)).rstrip())


def parser(prog: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=prog, description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    p.add_argument("--dsn", help="libpq connection string (default: DB_DSN, else dbname=preview)")
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("create", help="create an account, or claim a placeholder (a name"
                                      " the contributions held before accounts)")  # fmt: skip
    c.add_argument("pseudonym")
    who = c.add_mutually_exclusive_group()
    who.add_argument("--reviewer", action="store_true", help="decides in /revue")
    who.add_argument(
        "--admin",
        action="store_true",
        help="decides and administers in /revue (the first administrator)",
    )
    c.add_argument("--generate", action="store_true", help="draw a password, printed once")
    r = sub.add_parser("reset-password", help="a new password; the sessions are revoked")
    r.add_argument("pseudonym")
    r.add_argument("--generate", action="store_true", help="draw a password, printed once")
    o = sub.add_parser("role", help="change a role (a reviewer or an administrator needs a"
                                    " password); the sessions are revoked")  # fmt: skip
    o.add_argument("pseudonym")
    o.add_argument("role", choices=ROLES)
    for name, text in (("disable", "no sign-in any more; the sessions are revoked"),
                       ("enable", "may sign in again"),
                       ("delete", "the account and its sessions; its contributions"
                                  " stay, without author (type the pseudonym again)")):  # fmt: skip
        sub.add_parser(name, help=text).add_argument("pseudonym")
    sub.add_parser(
        "list",
        help="pseudonym, role, month, state, OSM link, where it publishes (dev|live|-), flags,"
        " counts (never a hash nor an OSM id)",
    )
    return p


def main(argv: list[str] | None = None, prog: str = "python -m lacarte.api.accounts") -> int:
    args = parser(prog).parse_args(argv)
    dsn = args.dsn or os.environ.get("DB_DSN") or "dbname=preview"
    with connect(dsn) as conn:
        if args.command == "create":
            role = "admin" if args.admin else "reviewer" if args.reviewer else "contributor"
            create(conn, args.pseudonym, role, args.generate)
        elif args.command == "role":
            set_role(conn, args.pseudonym, args.role)
        elif args.command == "reset-password":
            reset_password(conn, args.pseudonym, args.generate)
        elif args.command in ("disable", "enable"):
            set_disabled(conn, args.pseudonym, args.command == "disable")
        elif args.command == "delete":
            delete(conn, args.pseudonym)
        else:
            listing(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
