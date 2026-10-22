"""One build, gate or deploy at a time on this machine, whatever the session or worktree.

`lacarte build`, the local gate (web/scripts/gate.sh) and deploy/deploy.sh take one lock: a
directory outside every repository (LACARTE_LOCK, by default
~/.local/state/la-carte/build.lock), made with mkdir, atomic on every file system (macOS
has no flock(1)). It holds owner.json: the session, the command, the process, the
directory and the time. Taken, the command stops at once and says by whom and since when;
it never waits. A holder's children pass (LACARTE_LOCK_TOKEN, exported by the holder).
A lock whose process is gone is said abandoned and stays until lifted by hand:

    uv run python -m lacarte.lock status
    uv run python -m lacarte.lock break        (make unlock; only a dead holder's lock)

The shell side:
    token="$(uv run --quiet python -m lacarte.lock acquire --pid $$ --what "gate")" || exit 3
    export LACARTE_LOCK_TOKEN="$token"
    trap 'uv run --quiet python -m lacarte.lock release --token "$token"' EXIT
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import secrets
import shutil
import socket
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

TOKEN_ENV = "LACARTE_LOCK_TOKEN"
OWNER = "owner.json"
# A lock directory without its owner file (killed between the two writes) is abandoned
# after this long.
HALF_MADE_S = 60


def path() -> Path:
    default = Path.home() / ".local" / "state" / "la-carte" / "build.lock"
    return Path(os.environ.get("LACARTE_LOCK") or default)


def session() -> str:
    for key in ("LACARTE_SESSION", "CLAUDE_CODE_SESSION_ID"):
        if os.environ.get(key):
            return f"{key}={os.environ[key]}"
    return f"terminal {os.environ.get('TERM_SESSION_ID') or os.environ.get('TTY') or '?'}"


def owner() -> dict | None:
    """The holder, None when free; {} while the lock is being taken or half made."""
    lock = path()
    if not lock.is_dir():
        return None
    try:
        return json.loads((lock / OWNER).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def alive(info: dict) -> bool:
    """Its process still runs. The lock is this machine's (its host is only told: macOS
    renames the host with the network)."""
    if not info:
        try:
            return time.time() - path().stat().st_mtime < HALF_MADE_S
        except FileNotFoundError:
            return False
    try:
        os.kill(int(info["pid"]), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def describe(info: dict) -> str:
    if not info:
        return f"{path()} (being taken, or left half made)"
    return (
        f"{info.get('what')} — {info.get('session')}, pid {info.get('pid')} on "
        f"{info.get('host')}, in {info.get('cwd')}, since {info.get('since')}"
    )


class Busy(Exception):
    pass


def acquire(what: str, pid: int | None = None) -> str | None:
    """Take the lock for `what` held by process `pid` (this one by default); its token, or
    None when a holder's child (its token in the environment). Busy when taken."""
    held = owner()
    mine = os.environ.get(TOKEN_ENV)
    if mine and held and held.get("token") == mine:
        return None
    lock = path()
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock.mkdir()
    except FileExistsError:
        held = owner() or {}
        if alive(held):
            raise Busy(
                f"lock taken: {describe(held)}.\n"
                f"Nothing started. Wait for it to end (uv run python -m lacarte.lock status)."
            ) from None
        raise Busy(
            f"lock abandoned (its process is gone): {describe(held)}.\n"
            f"Nothing started. Check that nothing of it still runs, then lift it: make unlock"
        ) from None
    token = secrets.token_hex(8)
    info = {
        "what": what,
        "session": session(),
        "pid": pid or os.getpid(),
        "host": socket.gethostname(),
        "cwd": os.getcwd(),
        "since": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "token": token,
    }
    tmp = lock / f".{OWNER}.{token}"
    tmp.write_text(json.dumps(info, indent=1))
    tmp.replace(lock / OWNER)
    return token


def release(token: str | None) -> bool:
    """Lift the lock if `token` holds it (no token: nothing, a holder's child)."""
    held = owner()
    if not token or not held or held.get("token") != token:
        return False
    shutil.rmtree(path(), ignore_errors=True)
    return True


def lift_abandoned() -> str:
    """`break`: lift a lock whose holder is gone; refuse a living one."""
    held = owner()
    if held is None:
        return "free: nothing to lift"
    if alive(held):
        raise Busy(
            f"lock held by a running process, not lifted: {describe(held)}.\n"
            f"If that process is not the holder (its number reused), remove {path()} by hand."
        )
    shutil.rmtree(path(), ignore_errors=True)
    return f"lifted the abandoned lock: {describe(held)}"


@contextlib.contextmanager
def held(what: str):
    """The lock around a block of this process (lacarte build); its token in the
    environment meanwhile, for the processes it starts (a region built in parts)."""
    token = acquire(what)
    before = os.environ.get(TOKEN_ENV)
    if token:
        os.environ[TOKEN_ENV] = token
    try:
        yield
    finally:
        if token:
            if before is None:
                os.environ.pop(TOKEN_ENV, None)
            else:
                os.environ[TOKEN_ENV] = before
        release(token)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m lacarte.lock")
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("acquire", help="take the lock; prints its token")
    a.add_argument("--what", required=True, help="the command, shown to whoever finds it taken")
    a.add_argument("--pid", type=int, help="the holding process (the calling shell's $$)")
    r = sub.add_parser("release", help="lift the lock this token holds")
    r.add_argument("--token", default="")
    sub.add_parser("status", help="who holds the lock")
    sub.add_parser("break", help="lift an abandoned lock (its process gone)")
    args = parser.parse_args(argv)
    try:
        if args.cmd == "acquire":
            print(acquire(args.what, args.pid) or "")
        elif args.cmd == "release":
            release(args.token)
        elif args.cmd == "status":
            held_by = owner()
            if held_by is None:
                print(f"free ({path()})")
            else:
                state = "held" if alive(held_by) else "ABANDONED (make unlock)"
                print(f"{state}: {describe(held_by)}")
        else:
            print(lift_abandoned())
    except Busy as e:
        print(e, file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
