"""Accounts, passwords and sessions (migration 014).

A session is a cookie holding 32 random bytes (urlsafe base64); the database keeps only
their SHA-256 and the day they expire (30 days, no sliding renewal). Passwords are argon2id
PHC strings from argon2-cffi's PasswordHasher() with its defaults (read in argon2-cffi
25.1.0: time_cost 3, memory_cost 65536 KiB, parallelism 4, hash_len 32, salt_len 16, type
ID); at most two hashes are computed at once (each takes 64 MiB; the service has
MemoryMax=768M). A sign-in for an unknown pseudonym, a placeholder, an account without a
password (an OpenStreetMap one, migration 015) or a disabled account is checked against a
dummy hash, so that every failure takes as long and says the same.

Failed sign-ins slow down per pseudonym (Throttle), in memory only, never by address.
Light on purpose: imported by the API (only its dependency group is installed on the
server) and by the accounts CLI.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import secrets
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

PSEUDONYM_RE = re.compile(r"[A-Za-z0-9._-]{2,32}")  # accounts.pseudonym's CHECK
PASSWORD_MIN = 12  # characters, for a new password (/api/me/password, the CLI)
PASSWORD_MAX = 1024  # longer is refused before any hashing
SESSION_DAYS = 30
TOKEN_BYTES = 32

hasher = PasswordHasher()
CONCURRENT_HASHES = 2  # argon2 computations at once (the API also waits before a thread)
_slots = threading.BoundedSemaphore(CONCURRENT_HASHES)
_dummy: str | None = None
_dummy_lock = threading.Lock()


def hash_password(password: str) -> str:
    with _slots:
        return hasher.hash(password)


def dummy_hash() -> str:
    """A hash of nothing anyone knows, with the hasher's parameters: what an unknown
    pseudonym is checked against (computed once)."""
    global _dummy
    with _dummy_lock:
        if _dummy is None:
            _dummy = hash_password(secrets.token_urlsafe(24))
        return _dummy


def verify(stored: str | None, password: str) -> bool:
    """Whether `password` matches `stored`; with no hash (unknown pseudonym, placeholder),
    the dummy one is checked all the same and False returned."""
    target = stored or dummy_hash()
    with _slots:
        try:
            ok = hasher.verify(target, password)
        except (VerificationError, InvalidHashError):
            ok = False
    return ok and stored is not None


@dataclass(frozen=True)
class Account:
    id: str
    pseudonym: str
    role: str
    created_month: date
    leaderboard: bool
    test: bool
    osm: bool = False  # linked to an OpenStreetMap user (migration 015)
    password: bool = True  # has a password (an OSM account may have none)
    # Its pseudonym shown in the public history of the cameras it surveyed (migration 024:
    # the person's choice, off by default).
    history_pseudonym: bool = False

    @property
    def reviewer(self) -> bool:
        """May review (migration 020: a reviewer, or an administrator, who also may)."""
        return self.role in PRIVILEGED

    @property
    def admin(self) -> bool:
        return self.role == "admin"


PRIVILEGED = ("reviewer", "admin")  # the roles /revue opens to (migration 020)


ACCOUNT_COLUMNS = (
    "a.id::text, a.pseudonym, a.role, a.created_month, a.leaderboard, a.test,"
    " a.osm_id IS NOT NULL, a.password_hash IS NOT NULL, a.history_pseudonym"
)
# Not a placeholder (migration 015): a password or an OpenStreetMap user. A placeholder is a
# name the contributions held before accounts, which nobody has claimed yet.
CLAIMED = "(a.password_hash IS NOT NULL OR a.osm_id IS NOT NULL)"


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def digest(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def open_session(conn, account_id: str, today: date) -> str:
    """A new session for the account (the expired ones of every account purged first);
    returns the cookie's token."""
    conn.execute("DELETE FROM sessions WHERE expires_on <= %s", (today,))
    token = new_token()
    conn.execute(
        "INSERT INTO sessions (token_sha256, account_id, expires_on) VALUES (%s, %s, %s)",
        (digest(token), account_id, today + timedelta(days=SESSION_DAYS)),
    )
    return token


def session_account(conn, token: str, today: date) -> Account | None:
    """The account of a valid session: not expired, the account neither disabled nor a
    placeholder."""
    row = conn.execute(
        f"SELECT {ACCOUNT_COLUMNS} FROM sessions s JOIN accounts a ON a.id = s.account_id"
        f" WHERE s.token_sha256 = %s AND s.expires_on > %s AND NOT a.disabled AND {CLAIMED}",
        (digest(token), today),
    ).fetchone()
    return Account(*row) if row else None


def login_account(conn, pseudonym: str) -> tuple[str | None, str | None, str | None]:
    """(id, hash, role) of the account that may sign in under this pseudonym (any case);
    (None, None, None) for an unknown or disabled one, (id, None, role) for one without a
    password (a placeholder, or an OpenStreetMap account that never set one): no password
    matches."""
    if not PSEUDONYM_RE.fullmatch(pseudonym):
        return None, None, None
    row = conn.execute(
        "SELECT id::text, password_hash, disabled, role FROM accounts"
        " WHERE lower(pseudonym) = lower(%s)",
        (pseudonym,),
    ).fetchone()
    if row is None or row[2]:
        return None, None, None
    return row[0], row[1], row[3]


class Throttle:
    """Failed sign-ins per pseudonym (lowercased, known or not): after n failures in a row
    an attempt waits min(cap, first * 2^(n-1)) seconds from the last failure before it is
    checked — 1, 2, 4 … 30 s —, and a success forgets them. In memory only (lost at a
    restart), never an address; at most `size` pseudonyms, the oldest forgotten first. No
    lockout and no global limit (the user's decision). The API checks one attempt at a
    time per pseudonym (app.py throttled), so parallel guesses wait their turn."""

    def __init__(self, first: float = 1.0, cap: float = 30.0, size: int = 10_000,
                 clock: Callable[[], float] = time.monotonic) -> None:  # fmt: skip
        self.first, self.cap, self.size, self.clock = first, cap, size, clock
        self.entries: OrderedDict[str, tuple[int, float]] = OrderedDict()
        self.lock = threading.Lock()

    def wait(self, key: str) -> float:
        """Seconds this attempt waits before it is checked."""
        with self.lock:
            entry = self.entries.get(key)
            if entry is None:
                return 0.0
            return min(self.cap, max(0.0, entry[1] - self.clock()))

    def failed(self, key: str) -> float:
        """A failure: returns the delay the next attempt will wait."""
        with self.lock:
            n = self.entries.pop(key, (0, 0.0))[0] + 1
            delay = min(self.cap, self.first * 2 ** min(n - 1, 32))
            self.entries[key] = (n, self.clock() + delay)
            while len(self.entries) > self.size:
                self.entries.popitem(last=False)
            return delay

    def succeeded(self, key: str) -> None:
        with self.lock:
            self.entries.pop(key, None)

    def clear(self) -> None:
        with self.lock:
            self.entries.clear()


throttle = Throttle()
# How a waiting attempt sleeps: the tests replace it (and the throttle's clock).
sleep: Callable[[float], object] = asyncio.sleep


class Marks:
    """What a session may do beyond its account's ordinary rights (lot 2 « Administrer »):
    the token's digest -> (account id, until), in memory only (one API process; a restart
    forgets them all: sign in again). Nothing here is written anywhere."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.entries: dict[bytes, tuple[str, float]] = {}
        self.lock = threading.Lock()

    def put(self, token_digest: bytes, account_id: str, seconds: float) -> None:
        with self.lock:
            self.entries[token_digest] = (account_id, self.clock() + seconds)

    def has(self, token_digest: bytes) -> bool:
        with self.lock:
            entry = self.entries.get(token_digest)
            if entry is None:
                return False
            if entry[1] <= self.clock():
                del self.entries[token_digest]
                return False
            return True

    def drop(self, token_digest: bytes) -> None:
        with self.lock:
            self.entries.pop(token_digest, None)

    def drop_account(self, account_id: str) -> None:
        with self.lock:
            for key in [k for k, (a, _) in self.entries.items() if a == account_id]:
                del self.entries[key]

    def clear(self) -> None:
        with self.lock:
            self.entries.clear()


# A session opened by the privileged entry (POST /api/review/session): /revue's routes.
privileged = Marks()
# The password given again (POST /api/review/reauth): the destructive administrator routes.
reauthed = Marks()


def forget_marks(token_digest: bytes | None = None, account_id: str | None = None) -> None:
    """A session's marks, or every session's of an account, gone from both."""
    for marks in (privileged, reauthed):
        if token_digest is not None:
            marks.drop(token_digest)
        if account_id is not None:
            marks.drop_account(account_id)
