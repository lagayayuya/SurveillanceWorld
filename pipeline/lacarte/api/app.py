"""Participation API: live field preview, contributions, review, accounts.

    uvicorn lacarte.api.app:app --host 127.0.0.1 --port 8791 \
        --no-proxy-headers --no-access-log --no-server-header

Environment: LACARTE_DSN (libpq connection string; empty: the PG* environment),
ALLOWED_ORIGIN (https://<preview host>: the only Origin accepted on writes), SESSION_COOKIE
(`local` for the test servers on http://localhost: the cookie `session` without Secure;
anything else: `__Host-session`, Secure), OSM_LIVE_CLIENT_ID and OSM_LIVE_CLIENT_SECRET
(both set: sign in with OpenStreetMap, lacarte.api.osm; else /api/osm/* answer 503),
OSM_LIVE_URL (the tests' fake OSM; the live server by default); publishing to OSM (lacarte.api.
publish, the synchronisation's job lacarte.api.sync): OSM_WRITE_SERVER (dev, its only value),
OSM_DEV_CLIENT_ID and _SECRET, OSM_TOKEN_KEY (base64 of 32 bytes), OSM_DEV_URL; the live
server is /revue's switch osm_write_live (site_settings, migration 022) with the live client;
any of them missing or wrong, or people signing in on the live server while writing goes to
the test one: choosing to publish answers 503 and the job calls nobody; OSM_SYNC_THREAD=off
leaves the job's thread out, RETENTION_THREAD=off the retention's (lacarte.api.retention).
The site (GET /api/config): PUBLISHER_IDENTITY (plain text, shown when set); whether
contributions and sign-ups are open is the database's (site_settings, migration 020,
changed in /revue's « Réglages »; CONTRIBUTIONS_OPEN in the environment is ignored, said
once at start): closed, the routes of CLOSED_ROUTES answer 403
{"error": "closed"}, and with sign-ups closed those of SIGNUP_ROUTES 403 {"error":
"signups_closed"}.

Behind Caddy only, which drops every client-address header and any X-Author. Who writes
comes from the session cookie (lacarte.api.auth, migration 014); a request that needs one
and has none gets 401 {"error": "session"}. Nothing logged names a camera, a contribution,
an account or a position; journald stamps every line with the time.
"""

from __future__ import annotations

import asyncio
import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import math
import os
import re
import secrets
import threading
import time
import unicodedata
import uuid as uuidlib
from collections import defaultdict, deque
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool

from lacarte import buildings, direction, participation
from lacarte.api import auth, confirm, leaderboard, live, osm, publish, retention, stats, sync
from lacarte.api.auth import Account
from lacarte.regions import CAMERA_ID

log = logging.getLogger("lacarte.api")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
FIRST_DAY = date(2026, 9, 1)  # no contribution can predate the prototype
BBOX_MAX_DEG2 = 0.2  # a z13 view on a wide screen (about 30 x 20 km), with margin
BBOX_MAX_FEATURES = 5000
PUBLISHER_MAX = 200  # characters: a name and an address on one line


def publisher_identity(raw: str) -> str | None:
    """PUBLISHER_IDENTITY as the page shows it: plain text on one line (control and format
    characters become spaces, runs of spaces one), None when empty or longer than
    PUBLISHER_MAX (said in the log, never the value)."""
    text = "".join(" " if unicodedata.category(ch)[0] == "C" else ch for ch in raw)
    text = " ".join(text.split())
    if len(text) > PUBLISHER_MAX:
        log.warning("publisher identity not shown: longer than %d characters", PUBLISHER_MAX)
        return None
    return text or None


def secure_url(url: str) -> bool:
    """The client secret and the tokens travel to it: https, but for a fake OSM on this
    machine (tests)."""
    return url.startswith(("https://", "http://127.0.0.1", "http://localhost"))


class Settings:
    def __init__(self) -> None:
        self.dsn = os.environ.get("LACARTE_DSN", "")
        self.origin = os.environ.get("ALLOWED_ORIGIN", "")
        # Production: __Host-session, Secure. The local test servers (http://localhost,
        # where WebKit refuses a Secure cookie): `session` without Secure.
        self.cookie_secure = os.environ.get("SESSION_COOKIE", "") != "local"
        # Contributions open or closed: the database's since lot 2 (site_settings).
        if "CONTRIBUTIONS_OPEN" in os.environ:
            log.warning("CONTRIBUTIONS_OPEN ignored: contributions open or close in /revue")
        self.publisher = publisher_identity(os.environ.get("PUBLISHER_IDENTITY", ""))
        # Sign in with OpenStreetMap: on when both are set (deploy.sh writes them to
        # <DEPLOY_PATH>/api/osm.env, which the unit reads), off otherwise, without an error.
        # The server people sign in on: OSM's test server unless OSM_LOGIN_SERVER=live.
        self.osm_login_server = os.environ.get("OSM_LOGIN_SERVER", "dev")
        live = self.osm_login_server == "live"
        default = osm.LIVE_URL if live else osm.DEV_URL
        url_var = "OSM_LIVE_URL" if live else "OSM_DEV_URL"  # a fake OSM in tests
        self.osm_url = os.environ.get(url_var, default).rstrip("/")
        if not secure_url(self.osm_url):
            self.osm_url = ""
        pair = "OSM_LIVE" if live else "OSM_DEV"
        self.osm_client_id = os.environ.get(f"{pair}_CLIENT_ID", "")
        self.osm_client_secret = os.environ.get(f"{pair}_CLIENT_SECRET", "")
        if self.osm_login_server not in ("dev", "live"):
            self.osm_client_id = ""  # an unknown server: sign-in off
        self.write_settings()

    def write_settings(self) -> None:
        """Publishing (OSM lot 2, the synchronisation of 16/10): the deploy's write server is
        OSM's test server (OSM_WRITE_SERVER, `dev` only), with its client and OSM_TOKEN_KEY;
        otherwise off (osm_write_server empty), said once in the log by what is missing,
        never a value. Writing to the live server is /revue's switch osm_write_live
        (site_settings, migration 022), with the live client (OSM_LIVE_CLIENT_ID and
        _SECRET, OSM_LIVE_URL) read here: it replaces OSM_WRITE_LIVE_APPROVED, ignored."""
        server = os.environ.get("OSM_WRITE_SERVER", "dev")
        if "OSM_WRITE_LIVE_APPROVED" in os.environ:
            log.warning("OSM_WRITE_LIVE_APPROVED ignored: the live server is /revue's switch")
        url = os.environ.get("OSM_DEV_URL", osm.DEV_URL)
        self.osm_write_url = url.rstrip("/")
        self.osm_write_client_id = os.environ.get("OSM_DEV_CLIENT_ID", "")
        self.osm_write_client_secret = os.environ.get("OSM_DEV_CLIENT_SECRET", "")
        self.osm_token_key = publish.token_key(os.environ.get("OSM_TOKEN_KEY", ""))
        off = ("server" if server != "dev"
               else "url" if not secure_url(self.osm_write_url)
               else "client" if not (self.osm_write_client_id and self.osm_write_client_secret)
               else "key" if self.osm_token_key is None else "")  # fmt: skip
        self.osm_write_server = "" if off else server
        if off:
            log.warning("osm writing off: %s", off)
        live = os.environ.get("OSM_LIVE_URL", osm.LIVE_URL).rstrip("/")
        self.osm_live_write_url = live if secure_url(live) else ""
        self.osm_live_write_client_id = os.environ.get("OSM_LIVE_CLIENT_ID", "")
        self.osm_live_write_client_secret = os.environ.get("OSM_LIVE_CLIENT_SECRET", "")

    @property
    def cookie_name(self) -> str:
        return "__Host-session" if self.cookie_secure else "session"

    @property
    def signup_cookie_name(self) -> str:
        return "__Host-osm-signup" if self.cookie_secure else "osm-signup"

    @property
    def flow_cookie_name(self) -> str:
        return "__Host-osm-flow" if self.cookie_secure else "osm-flow"


class RateLimit:
    """Sliding one-minute window per account and bucket (one API process, in memory)."""

    def __init__(self) -> None:
        self.hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, author: str, bucket: str, per_minute: int) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[(author, bucket)]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= per_minute:
                return False
            q.append(now)
            return True


class SiteSwitches:
    """The site's switches (site_settings, migrations 020 and 022), read at most every
    SWITCHES_TTL_S seconds: an administrator's change takes effect within that delay (at
    once in this process, forget()). A key without its row counts as SWITCH_DEFAULTS says."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self.values: dict[str, bool] | None = None
        self.read_at = -math.inf
        self.lock = threading.Lock()

    def fresh(self) -> dict[str, bool] | None:
        with self.lock:
            if self.values is not None and self.clock() - self.read_at < SWITCHES_TTL_S:
                return self.values
        return None

    def get(self) -> dict[str, bool]:
        """The switches, read from the database when the copy is older than the delay."""
        values = self.fresh()
        if values is not None:
            return values
        with pool.connection() as conn:
            read = dict(conn.execute("SELECT key, value FROM site_settings").fetchall())
        values = {k: read.get(k, default) for k, default in SWITCH_DEFAULTS.items()}
        with self.lock:
            self.values, self.read_at = values, self.clock()
        return values

    def forget(self) -> None:
        with self.lock:
            self.values, self.read_at = None, -math.inf


# The site's switches (site_settings, migrations 020 and 022) and what a key without its row
# counts as: contributions and sign-ups open, the OSM synchronisation on, writing to OSM's
# live server off.
SWITCH_DEFAULTS = {"contributions_open": True, "signups_open": True, "osm_sync": True,
                   "osm_write_live": False}  # fmt: skip
SWITCHES = tuple(SWITCH_DEFAULTS)
SWITCHES_TTL_S = 5.0
settings = Settings()
switches = SiteSwitches()
limits = RateLimit()
pool: ConnectionPool | None = None


def sync_config() -> sync.Config:
    """What the OSM job needs of the API: the key, the offered write server, the servers
    tokens come from."""
    return sync.Config(key=settings.osm_token_key, offered=publish_server, known=server_named)


def sync_once(dsn: str | None = None) -> dict:
    """One pass of the OSM synchronisation (lacarte.api.sync), on a connection of its own
    (autocommit: its advisory lock is the session's): the thread's, and `lacarte osm sync
    --once`'s."""
    import psycopg

    return sync.once(lambda: psycopg.connect(settings.dsn if dsn is None else dsn,
                                             autocommit=True), sync_config())  # fmt: skip


def retention_once(dsn: str | None = None) -> dict:
    """One run of the retention (lacarte.api.retention, migration 023), on a connection of
    its own: the thread's."""
    import psycopg

    return retention.once(lambda: psycopg.connect(settings.dsn if dsn is None else dsn,
                                                  autocommit=True))  # fmt: skip


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = ConnectionPool(settings.dsn, min_size=1, max_size=4, open=True)
    # The hash an unknown pseudonym is checked against, made now: made at the first unknown
    # sign-in, it would make that one slower than a known pseudonym's.
    await run_in_threadpool(auth.dummy_hash)
    # The OSM synchronisation's thread (rules/publish.yaml sync); OSM_SYNC_THREAD=off leaves
    # it out (the tests; `make try`, where a pass is run by hand with `lacarte osm sync
    # --once`).
    job = None
    if os.environ.get("OSM_SYNC_THREAD", "") != "off":
        pace = publish.rules()["sync"]
        job = sync.Job(sync_once, 60.0 * pace["every_minutes"], float(pace["first_pass_s"]))
        job.start()
    # What is kept and for how long (migration 023, rules/stats.yaml): a run shortly after
    # the start, then at each new Paris day; RETENTION_THREAD=off leaves it out (the tests,
    # tests/apiserver.py's benches and `make try`).
    keep = None
    if os.environ.get("RETENTION_THREAD", "") != "off":
        pace = stats.rules()["retention_thread"]
        keep = retention.Job(retention_once, 60.0 * pace["check_minutes"],
                             float(pace["first_pass_s"]))  # fmt: skip
        keep.start()
    try:
        yield
    finally:
        for thread in (job, keep):
            if thread is not None:
                await run_in_threadpool(thread.stop)
        pool.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


# --- guards ------------------------------------------------------------------------------

# Contributions closed (site_settings contributions_open, /revue's « Réglages »): what writes
# to the map or opens an account answers 403 closed, signed in or not. Everything else
# works: the map's reads, signing in and out with a password, /api/me, the review, the
# person's export and deletion. Nothing is deleted.
CLOSED_ROUTES = {
    ("POST", "/api/contributions"), ("POST", "/api/contributions/withdraw"),
    ("POST", "/api/operators"), ("POST", "/api/preview"), ("POST", "/api/modify/preview"),
    ("GET", "/api/osm/login"), ("POST", "/api/osm/link"), ("GET", "/api/osm/signup"),
    ("POST", "/api/osm/signup"),
}  # fmt: skip
# Choosing to publish on OSM is closed too (POST /api/osm/sync on: true answers 403 closed
# itself): going back to « Rester sur Surveillance World » never is.
# Sign-ups closed (site_settings signups_open): a first sign-in with OpenStreetMap cannot
# make its account (403 signups_closed); every existing account still signs in.
SIGNUP_ROUTES = {("GET", "/api/osm/signup"), ("POST", "/api/osm/signup")}


async def site_switches() -> dict[str, bool]:
    return switches.fresh() or await run_in_threadpool(switches.get)


@app.middleware("http")
async def guard(request: Request, call_next):
    """On writes (signing in included), our own Origin and JSON (no cross-site request can
    write, even with the session cookie, which is SameSite=Strict besides); a DELETE has
    no body, hence no content type."""
    if request.method in WRITE_METHODS:
        if not settings.origin or request.headers.get("origin") != settings.origin:
            return JSONResponse({"error": "origin"}, status_code=403)
        ctype = request.headers.get("content-type", "").split(";")[0].strip()
        if request.method != "DELETE" and ctype != "application/json":
            return JSONResponse({"error": "content_type"}, status_code=415)
    method = "GET" if request.method == "HEAD" else request.method  # Starlette answers both
    route = (method, request.url.path)
    if route in CLOSED_ROUTES or route in SIGNUP_ROUTES:
        try:
            open_ = await site_switches()
        except Exception as exc:  # noqa: BLE001 — as below: the class only
            log.error("unhandled %s reading the site's settings", type(exc).__name__)
            return JSONResponse({"error": "internal"}, status_code=500)
        if not open_["contributions_open"] and route in CLOSED_ROUTES:
            return JSONResponse({"error": "closed"}, status_code=403)
        if not open_["signups_open"] and route in SIGNUP_ROUTES:
            return JSONResponse({"error": "signups_closed"}, status_code=403)
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001
        # Caught here, not by an exception handler: Starlette re-raises after its handler
        # and uvicorn would log the traceback, whose text may quote values (a psycopg
        # DETAIL names the key). Log the class and the route template only.
        route = request.scope.get("route")
        log.error("unhandled %s on %s", type(exc).__name__, getattr(route, "path", "?"))
        return JSONResponse({"error": "internal"}, status_code=500)


@app.exception_handler(RequestValidationError)
async def invalid(_request: Request, exc: RequestValidationError):
    fields = sorted({".".join(str(p) for p in e["loc"][1:]) for e in exc.errors()})
    return JSONResponse({"error": "invalid", "fields": fields}, status_code=422)


def session_token(request: Request) -> str | None:
    token = request.cookies.get(settings.cookie_name, "")
    return token if token and len(token) <= 64 else None


def visitor(request: Request) -> Account | None:
    """The session's account, or None (no cookie, unknown or expired session, account
    disabled since)."""
    token = session_token(request)
    if token is None:
        return None
    with pool.connection() as conn:
        return auth.session_account(conn, token, date.today())


def author(who: Annotated[Account | None, Depends(visitor)]) -> Account:
    if who is None:
        raise HTTPException(401, "session")
    return who


def is_privileged(request: Request, who: Account | None) -> bool:
    """A session opened by the privileged entry, its mark still on, of an account that may
    still review (a role taken back, a disabled account: the mark goes)."""
    token = session_token(request)
    if token is None or who is None:
        return False
    if not who.reviewer:
        auth.forget_marks(token_digest=auth.digest(token))
        return False
    return auth.privileged.has(auth.digest(token))


def staff(request: Request, who: Annotated[Account | None, Depends(visitor)]) -> Account:
    """Every /api/review/* route but the entry itself (lot 2): a reviewer's or an
    administrator's session opened by POST /api/review/session, within its hours. Anything
    else — no session, an ordinary one (OSM or /api/session), a contributor's, a mark
    expired or lost at a restart — 401 privileged: the page shows its sign-in."""
    if not is_privileged(request, who):
        raise HTTPException(401, "privileged")
    return who


def admin(who: Annotated[Account, Depends(staff)]) -> Account:
    """The administrator's routes: a reviewer gets 403 admin."""
    if not who.admin:
        raise HTTPException(403, "admin")
    return who


def reauthed(request: Request, who: Annotated[Account, Depends(admin)]) -> Account:
    """A destructive or wholesale administrator action: the password given again within
    review.reauth_minutes (POST /api/review/reauth), else 403 reauth."""
    if not auth.reauthed.has(auth.digest(session_token(request) or "")):
        raise HTTPException(403, "reauth")
    return who


def fail(status: int, error: str):
    raise HTTPException(status, error)


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


# --- the site ----------------------------------------------------------------------------


@app.get("/api/config")
def config():
    """What the page shows of the site, read at its start (no session, nothing personal):
    whether contributions are open, whether an OpenStreetMap account may sign up
    (`signups`: never while contributions are closed), whether publishing to OSM is
    offered (`publish`: and contributions open; `sync`: whatever they are), and the
    publisher's identity when set (plain text; null otherwise)."""
    open_ = switches.get()
    contributions = open_["contributions_open"]
    offered = publish_server() is not None
    return {"contributions": contributions,
            "signups": contributions and open_["signups_open"],
            "publish": contributions and offered,
            # The OSM synchronisation offered (« Compte » shows its setting): also while
            # contributions are closed, so that a person can always stop it.
            "sync": offered,
            "publisher": settings.publisher}  # fmt: skip


class HitIn(BaseModel):
    event: Literal[stats.PAGE_COUNTERS]


@app.post("/api/hit", status_code=204)
def site_hit(body: HitIn, request: Request) -> Response:
    """The site's counters (migration 021, lot 4): the page says the map was loaded once
    visible (`map`) or the welcome shown (`welcome`); `signin` is the API's own
    (open_session), refused here. Anonymous (no session read), never closed, behind the
    Origin and JSON guard as every write. One more on the current hour, unless the
    User-Agent names a robot (rules/stats.yaml bots: read here, never kept nor logged) or
    the hour's counter reached hourly_cap. Always 204: the page learns nothing and waits
    for nothing."""
    conf = stats.rules()
    if not stats.is_bot(request.headers.get("user-agent"), conf):
        with pool.connection() as conn:
            stats.hit(conn, body.event, conf["hourly_cap"])
    return Response(status_code=204)


def open_session(conn, account_id: str) -> str:
    """A session opened (auth.open_session) and counted (`signin`, migration 021: the hour,
    a number, nothing of whom), in the caller's transaction: a sign-in that fails after
    this rolls both back. Every place the API opens a session goes through here, once the
    password, the OpenStreetMap return or the privileged entry has succeeded; the tests'
    sessions (tests/sessions.py) and the accounts CLI call auth.open_session directly."""
    token = auth.open_session(conn, account_id, date.today())
    stats.hit(conn, "signin", stats.rules()["hourly_cap"])
    return token


# --- helpers -----------------------------------------------------------------------------


def meta(conn) -> tuple[str, tuple[float, float, float, float]]:
    row = conn.execute(
        "SELECT build_id, ST_XMin(bounds), ST_YMin(bounds), ST_XMax(bounds), ST_YMax(bounds)"
        " FROM meta"
    ).fetchone()
    if row is None:
        fail(503, "no_build")
    return row[0], tuple(row[1:])


def inside(bounds, lon: float, lat: float) -> bool:
    w, s, e, n = bounds
    return math.isfinite(lon) and math.isfinite(lat) and w <= lon <= e and s <= lat <= n


def requested_point(conn, cam: live.Camera, lon: float, lat: float) -> tuple[float, float]:
    """The requested point in metres, refused outside the region or beyond the move limit."""
    _, bounds = meta(conn)
    if not inside(bounds, lon, lat):
        fail(422, "outside_region")
    x, y = live.to_metres(lon, lat)
    if math.hypot(x - cam.x, y - cam.y) > participation.rules()["move"]["max_m"]:
        fail(422, "too_far")
    return x, y


def get_camera(conn, camera_id: str) -> live.Camera:
    """A camera of the served build, or an added camera no build has applied yet."""
    cam = live.camera(conn, camera_id)
    if cam is None and participation.is_added(camera_id):
        cam = pending_add(conn, camera_id)
    if cam is None:
        fail(404, "unknown_camera")
    return cam


def add_of(conn, camera_id: str) -> tuple[str, str, float, float] | None:
    """The add that created an added camera: its uuid, status and position (metres)."""
    return conn.execute(
        "SELECT uuid::text, status, ST_X(geom), ST_Y(geom) FROM contributions"
        " WHERE kind = 'add' AND camera_id = %s",
        (camera_id,),
    ).fetchone()


def pending_add(conn, camera_id: str) -> live.Camera | None:
    """An add not in the served build: the default camera at the add's position (what the
    next build draws until an answer is validated); none once the add is rejected."""
    row = add_of(conn, camera_id)
    template = live.add_template(conn)
    if row is None or row[1] in CLOSED or template is None:
        return None
    return live.added(template, camera_id, row[2], row[3])


def answered_add(conn, cam: live.Camera, add_uuid: str, add_author: str) -> live.Camera:
    """An add no build has applied, as its open answers make it (corrections after the D3
    iPhone tests): the add and its answers leave together, so its proposed field is the
    one they give — the shape's kind, the bearing (for a kind under the direction rule),
    the height and, on a tube with a height, the tilt — as `apply` would. Per question
    the answer kept is the validated one, else the latest day, else the add's author's,
    else the smallest uuid; withdrawn, rejected and "Je ne sais pas" answers are left out,
    so withdrawing or rejecting one changes the field at the next read (add_answers; an
    added camera's height is by default, so the tilt counts only with a height answered)."""
    kept = add_answers(conn, add_uuid, add_author)
    return modified_camera(
        cam, kept.get("shape"), kept.get("direction"), kept.get("height"), kept.get("tilt")
    )


def add_answers(conn, add_uuid: str, add_author: str) -> dict:
    """The answers an add no build has applied keeps, one per question: the validated one,
    else the latest day, else the add's author's, else the smallest uuid; withdrawn,
    rejected and "Je ne sais pas" answers left out. {kind: answer}: the direction in
    degrees, who films as [class, name or null]; with a « Multi-boules » shape that gives
    one, `dome_count` its number of domes. Its field (answered_add) and its sheet's list
    (DECISIONS 2026-10-08) read them."""
    rows = conn.execute(
        "SELECT kind, answer, direction_deg, operator_name, dome_count FROM contributions"
        " WHERE target = %s AND kind IN ('shape', 'direction', 'height', 'tilt', 'operator')"
        " AND status NOT IN ('rejected', 'withdrawn')"
        " AND coalesce(answer, '') NOT IN ('unknown', 'not_visible')"
        " ORDER BY kind, status = 'validated' DESC, day DESC, coalesce(author_id = %s, false)"
        " DESC, uuid",
        (add_uuid, add_author),
    ).fetchall()
    kept: dict = {}
    for kind, answer, deg, name, count in rows:
        value = deg if kind == "direction" else [answer, name] if kind == "operator" else answer
        if kind not in kept and kind == "shape" and count is not None:
            kept["dome_count"] = count
        kept.setdefault(kind, value)
    return kept


def answered_add_bands(conn, camera_id: str) -> dict | None:
    """The proposed field of an added camera no build has applied (answered_add), as a
    FeatureCollection of its shown bands; None for any other camera."""
    row = conn.execute(
        "SELECT uuid::text, author_id::text FROM contributions WHERE kind = 'add'"
        " AND camera_id = %s"
        " AND status NOT IN ('rejected', 'withdrawn')",
        (camera_id,),
    ).fetchone()
    if row is None or live.camera(conn, camera_id) is not None:
        return None
    cam = pending_add(conn, camera_id)
    if cam is None:
        return None
    new = answered_add(conn, cam, *row)
    polys = live.buildings_near(conn, cam.x, cam.y, live.fetch_radius(new))
    return {"type": "FeatureCollection",
            "features": live.shown_bands(live.field(new, cam.x, cam.y, polys))}  # fmt: skip


NEW_ADD = "c000000000000"  # the camera being placed, before its add has a uuid


def add_origin(conn, lon: float, lat: float, camera_id: str = NEW_ADD) -> live.Camera:
    """The default camera at a requested point of the region (an add has no move limit)."""
    _, bounds = meta(conn)
    if not inside(bounds, lon, lat):
        fail(422, "outside_region")
    template = live.add_template(conn)
    if template is None:
        fail(503, "add_unavailable")  # tables loaded before migration 007
    return live.added(template, camera_id, *live.to_metres(lon, lat))


def placed_add(conn, lon: float, lat: float, placement: str) -> live.Camera:
    """An add not sent yet (phase "Retours terrain": it leaves with its answers), where the
    server will place it when it arrives (the magnet if asked, as post_contribution does):
    the "Compléter" questions on it preview and list from there."""
    cam = add_origin(conn, lon, lat)
    polys = live.buildings_near(conn, cam.x, cam.y, live.fetch_radius(cam))
    placed = live.place(cam, cam.x, cam.y, magnet=placement == "facade", polys=polys)
    return live.added(live.add_template(conn), NEW_ADD, placed.x, placed.y)


def computed_move(conn, cam: live.Camera, lon, lat, placement: str) -> dict:
    """Position, facade and field of a moved camera, as the preview shows and as stored."""
    return computed_at(conn, cam, *requested_point(conn, cam, lon, lat), placement)


def computed_at(conn, cam: live.Camera, x: float, y: float, placement: str) -> dict:
    """Position, facade and field of a camera placed at (x, y) (metres), magnet if asked:
    a move (from the camera's served position) or an add (`cam` already at the point)."""
    polys = live.buildings_near(conn, x, y, live.fetch_radius(cam))
    placed = live.place(cam, x, y, magnet=placement == "facade", polys=polys)
    f = live.field(cam, placed.x, placed.y, polys)
    return {
        "position": live.to_lonlat(placed.x, placed.y),
        "pulled": placed.pulled,
        "facade": [live.to_lonlat(*c) for c in placed.facade.coords] if placed.facade else None,
        "facade_m": None if placed.facade_m is None else round(placed.facade_m, 2),
        "move_m": round(placed.move_m, 2),
        "inside_footprint": placed.inside_footprint,
        "origin": live.to_lonlat(f["x"], f["y"]) if f else None,
        "bands": {"type": "FeatureCollection", "features": live.shown_bands(f)},
        "_xy": (placed.x, placed.y),
    }


# --- preview -----------------------------------------------------------------------------


class Placement(BaseModel):
    """ "facade" (the magnet) or "free". Release 1 sent snap / under_arcade / mount_observed
    instead: phones may still hold such items in their queue, so they are read too."""

    placement: Literal["facade", "free"] | None = None
    snap: bool | None = None
    under_arcade: bool | None = None
    mount_observed: Literal["wall", "pole", "other"] | None = None

    @model_validator(mode="after")
    def _placement(self):
        if self.placement is None:
            if self.snap is None:
                raise ValueError("placement")
            self.placement = "facade" if self.snap and not self.under_arcade else "free"
        return self


# Kinds a shape answer may give (rules/questions.yaml shape.kinds): the direction preview
# draws the field of the shape just answered.
AimKind = Literal["dome", "fixed", "ptz", "panorama", "multidome"]


class PreviewIn(Placement):
    """A move (lon, lat, placement) or, with `direction`, the camera at its served position
    aimed that way (the "Compléter" direction question), drawn as `kind` if given; with
    `add` and no camera, a new camera placed there (phase "Ajouter"), aimed if `direction`
    is given (an add not sent yet: it leaves with its answers)."""

    camera: str | None = Field(default=None, max_length=32)
    add: bool = False
    lon: float | None = None
    lat: float | None = None
    direction: int | None = Field(default=None, ge=0, le=359)
    kind: AimKind | None = None

    @model_validator(mode="before")
    @classmethod
    def _aim_is_free(cls, data):
        if isinstance(data, dict) and data.get("direction") is not None:
            data = {"placement": "free", **data}
        return data

    @model_validator(mode="after")
    def _point(self):
        if (self.direction is None or self.add) and (self.lon is None or self.lat is None):
            raise ValueError("lon, lat")
        if self.add != (self.camera is None):
            raise ValueError("camera or add")
        return self


def aimed_field(
    conn, cam: live.Camera, direction: int, kind: str | None, at: tuple | None = None
) -> dict:
    """The camera's field at its served position (or `at`, metres: « Modifier » aims from
    where its move puts the camera) for one direction (a shape answer's kind if given):
    what the build would draw once the answer is applied."""
    aimed = live.aimed(cam, direction, kind)
    x, y = at or (cam.x, cam.y)
    polys = live.buildings_near(conn, x, y, live.fetch_radius(aimed))
    f = live.field(aimed, x, y, polys)
    return {"bands": {"type": "FeatureCollection", "features": live.shown_bands(f)}}


@app.post("/api/preview")
def preview(body: PreviewIn, who: Annotated[Account, Depends(author)]):
    if not limits.allow(who.id, "preview", participation.rules()["limits"]["previews_per_minute"]):
        fail(429, "rate")
    with pool.connection() as conn:
        if body.add and body.direction is not None:
            cam = placed_add(conn, body.lon, body.lat, body.placement)
            return {**aimed_field(conn, cam, body.direction, body.kind),
                    "build_id": meta(conn)[0]}  # fmt: skip
        if body.add:
            cam = add_origin(conn, body.lon, body.lat)
            out = computed_at(conn, cam, cam.x, cam.y, body.placement)
            out.pop("_xy")
            return {**out, "build_id": meta(conn)[0]}
        cam = get_camera(conn, body.camera)
        if body.direction is not None:
            out = aimed_field(conn, cam, body.direction, body.kind)
        else:
            out = computed_move(conn, cam, body.lon, body.lat, body.placement)
            out.pop("_xy")
        out["build_id"] = meta(conn)[0]
        return out


class OperatorsIn(BaseModel):
    """For a camera, or for an add not sent yet (lon, lat, placement: where the server will
    place it, as its answer will be checked once it arrives). With `class` (the classique),
    that class's offered names; without it (the punk editor, /revue), every name."""

    camera: str | None = Field(default=None, max_length=32)
    lon: float | None = None
    lat: float | None = None
    placement: Literal["facade", "free"] | None = None
    operator_class: Literal["public", "business"] | None = Field(default=None, alias="class")

    @model_validator(mode="after")
    def _one(self):
        if (self.camera is None) == (None in (self.lon, self.lat, self.placement)):
            raise ValueError("camera or lon, lat, placement")
        return self


def offered_operators(conn, cam: live.Camera, answer: str) -> list[str]:
    """The "who films" list after "Public" or "Commerce ou entreprise"
    (rules/questions.yaml operator): normalised names of that class carried by cameras
    within list_m, the nearest distinct ones, at most list_max with "Ville de <commune>"
    for Public, then sorted alphabetically (the order says nothing of frequency)."""
    q = participation.questions()["operator"]
    wanted = "public" if answer == "public" else "private"
    listed = participation.listed_operators()
    town = conn.execute(
        "SELECT town_operator FROM cameras WHERE camera_id = %s", (cam.camera_id,)
    ).fetchone()
    if town is None and cam.osm_type is None:
        # An add no build has applied: the town of the nearest camera within list_m.
        town = conn.execute(
            "SELECT town_operator FROM cameras"
            " WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%s, %s), 2154), %s)"
            " ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(%s, %s), 2154)) LIMIT 1",
            (cam.x, cam.y, q["list_m"], cam.x, cam.y),
        ).fetchone()
    names: list[str] = []
    if answer == "public" and town and town[0]:
        names.append(town[0])
    for (name,) in conn.execute(
        "SELECT operator_norm FROM cameras"
        " WHERE operator_norm IS NOT NULL"
        " AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%s, %s), 2154), %s)"
        " ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(%s, %s), 2154)), camera_id",
        (cam.x, cam.y, q["list_m"], cam.x, cam.y),
    ):
        if len(names) >= q["list_max"]:
            break
        if listed.get(name) == wanted and name not in names:
            names.append(name)
    return sorted(names, key=lambda n: (participation.fold(n), n))


def operator_allowed(conn, cam: live.Camera, answer: str, name: str) -> bool:
    """A name a contribution or the review may set after `answer` (public | business): a
    listed one of that class (participation.all_operators), or one the camera is offered
    ("Ville de <commune>" is often in no list)."""
    return {"name": name, "class": answer} in participation.all_operators() or (
        name in offered_operators(conn, cam, answer)
    )


@app.post("/api/operators")
def operators(body: OperatorsIn, who: Annotated[Account, Depends(author)]):
    """`{names}` with `class`; without: `{near, all}`, each `[{name, class}]` with class
    public | business — `near` both classes' offered names (offered_operators, list_max
    each), `all` every listed name; both sorted as `fold` sorts (lot of 2026-10-12)."""
    if not limits.allow(who.id, "preview", participation.rules()["limits"]["previews_per_minute"]):
        fail(429, "rate")
    with pool.connection() as conn:
        if body.camera is None:
            cam = placed_add(conn, body.lon, body.lat, body.placement)
        else:
            cam = get_camera(conn, body.camera)
        if body.operator_class is not None:
            return {"names": offered_operators(conn, cam, body.operator_class)}
        near = [{"name": n, "class": c} for c in ("public", "business")
                for n in offered_operators(conn, cam, c)]  # fmt: skip
    near.sort(key=lambda e: (participation.fold(e["name"]), e["name"], e["class"]))
    return {"near": near, "all": participation.all_operators()}


class FacadesIn(BaseModel):
    """Around a camera, or (phase "Ajouter") around a point: the frame's origin."""

    camera: str | None = Field(default=None, max_length=32)
    lon: float | None = None
    lat: float | None = None

    @model_validator(mode="after")
    def _one(self):
        if (self.camera is None) == (self.lon is None or self.lat is None):
            raise ValueError("camera or lon, lat")
        return self


@app.post("/api/facades")
def facades(body: FacadesIn, who: Annotated[Account, Depends(author)]):
    """The buildings around a camera, once per move mode: the phone pulls the pin onto a
    facade frame by frame with the server's rule (magnet.ts), in the same plane."""
    if not limits.allow(who.id, "preview", participation.rules()["limits"]["previews_per_minute"]):
        fail(429, "rate")
    radius = participation.rules()["magnet"]["facades_m"]
    with pool.connection() as conn:
        if body.camera is None:
            cam = add_origin(conn, body.lon, body.lat)
        else:
            cam = get_camera(conn, body.camera)
        polys = live.buildings_near(conn, cam.x, cam.y, radius)
    return {
        "frame": live.local_frame(cam),
        "capture_m": participation.rules()["magnet"]["capture_m"],
        "offset_m": buildings.SNAP_OFFSET_M,
        "polygons": live.local_polygons(cam, polys),
    }


# --- contributions -----------------------------------------------------------------------


class Base(BaseModel):
    # In the body, not the URL: Caddy logs the URI of a failed proxied request.
    uuid: str = Field(max_length=36)
    build_id: str = Field(max_length=64)
    day: date
    # The gesture's duration, no longer collected (migration 021): an older phone's queue
    # may still send it; accepted, never stored, and in the digest only when sent
    # (LATER_FIELDS), so that such a send sent again is still the same body.
    duration_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    on_site: bool | None = None
    # « Modifier » (migration 012): the send this contribution belongs to, a v4 uuid the
    # phone chose; its other pieces share it. Only on BATCH_KINDS.
    batch: str | None = Field(default=None, max_length=36)


class Common(Base):
    camera: str = Field(max_length=32)


class AddIn(Base, Placement):
    """ "Ajouter une caméra": the camera's id follows from the uuid (participation.added_id)."""

    kind: Literal["add"]
    lon: float
    lat: float


class VerifyIn(Common):
    kind: Literal["verify"]
    answer: Literal["present", "not_found", "unsure"]


class MoveIn(Common, Placement):
    kind: Literal["move"]
    lon: float
    lat: float


class OpinionIn(Common):
    """ "Je confirme" (agree) or "Ce n'est pas ça" (disagree) on another author's proposal."""

    kind: Literal["agree", "disagree"]
    target: str = Field(max_length=36)


class ShapeIn(Common):
    """ "À quoi ressemble-t-elle ?" (phase D2). « Multi-boules » (multidome, questions@6)
    with its number of domes (`dome_count`, rules/questions.yaml dome_count), or none for
    « Je ne sais pas »; a number with another answer, or out of the rule's bounds, is
    refused (422)."""

    kind: Literal["shape"]
    answer: Literal["dome", "bullet", "ptz", "multi", "multidome", "unknown"]
    dome_count: int | None = None

    @model_validator(mode="after")
    def _dome_count(self):
        if not participation.dome_count_ok(self.kind, self.answer, self.dome_count):
            raise ValueError("dome_count")
        return self


class DirectionIn(Common):
    """ "Qu'est-ce qu'elle regarde ?": a bearing, or "Je ne vois pas". `aim_kind`: the shape
    just answered, if any, to draw the stored field as the phone showed it. « Modifier »
    (a batch that also moves the camera): `from_lon`, `from_lat`, where the bearing was
    taken from, the position the server gave the move (the build checks a direction
    against where it was aimed from: rules/questions.yaml direction.moved_max_m)."""

    kind: Literal["direction"]
    direction: int | None = Field(default=None, ge=0, le=359)
    answer: Literal["not_visible"] | None = None
    aim_kind: AimKind | None = None
    from_lon: float | None = None
    from_lat: float | None = None

    @model_validator(mode="after")
    def _one(self):
        if (self.direction is None) == (self.answer is None):
            raise ValueError("direction or answer")
        if (self.from_lon is None) != (self.from_lat is None):
            raise ValueError("from_lon, from_lat")
        return self


class OperatorIn(Common):
    """ "Qui l'a installée, d'après vous ?": a class, and maybe a name from the list, or (the
    punk editor, lot of 2026-10-12) a name proposed, checked in post_contribution."""

    kind: Literal["operator"]
    answer: Literal["public", "business", "household", "unknown"]
    operator_name: str | None = Field(default=None, min_length=1, max_length=120)
    operator_proposed: str | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def _name(self):
        if self.operator_name is not None and self.answer not in ("public", "business"):
            raise ValueError("operator_name")
        return self


# rules/questions.yaml height; "pole" from the classique only, stored as height.legacy says.
HeightClass = Literal["ground", "first", "upper", "pole"]
TiltClass = Literal["horizon", "slight", "steep"]  # rules/questions.yaml tilt


class Journey(Common):
    """What the same journey answered before (phase D3), so that the stored field is the one
    the answers together would give: the shape's kind, the bearing, the height's class."""

    aim_kind: AimKind | None = None
    aim_direction: int | None = Field(default=None, ge=0, le=359)
    aim_height: HeightClass | None = None


class HeightIn(Journey):
    """ "À quelle hauteur est-elle ?" (phase D3): a class, or "Je ne sais pas"."""

    kind: Literal["height"]
    answer: HeightClass | Literal["unknown"]


class TiltIn(Journey):
    """ "Où pointe-t-elle ?" (phase D3, a tube): a class, or "Je ne sais pas"."""

    kind: Literal["tilt"]
    answer: TiltClass | Literal["unknown"]


ContributionIn = Annotated[
    VerifyIn | MoveIn | OpinionIn | ShapeIn | DirectionIn | OperatorIn | AddIn | HeightIn | TiltIn,
    Field(discriminator="kind"),
]


class ModifyPreviewIn(BaseModel):
    """« Modifier » before it is sent: the camera as the changes chosen so far make it — moved
    to (lon, lat) with its placement (the magnet for "facade", as a move is placed), its
    shape, direction, height and tilt — each optional. With `add` and no camera, the punk
    add before it leaves (DECISIONS 2026-10-08: adding and « Modifier » are one component):
    a new camera placed at (lon, lat), free, with the same answers."""

    camera: str | None = Field(default=None, max_length=32)
    add: bool = False
    lon: float | None = None
    lat: float | None = None
    placement: Literal["facade", "free"] | None = None
    shape: Literal["dome", "bullet", "ptz", "multi", "multidome"] | None = None
    direction: int | None = Field(default=None, ge=0, le=359)
    height: HeightClass | None = None
    tilt: TiltClass | None = None

    @model_validator(mode="after")
    def _move(self):
        if self.add and self.placement is None:
            self.placement = "free"
        if (self.lon is None) != (self.lat is None) or (
            (self.lon is None) != (self.placement is None)
        ):
            raise ValueError("lon, lat, placement")
        if self.add != (self.camera is None) or (self.add and self.lon is None):
            raise ValueError("camera, or add with lon, lat")
        return self


@app.post("/api/modify/preview")
def modify_preview(body: ModifyPreviewIn, who: Annotated[Account, Depends(author)]):
    """Its position (placed as a move is, from the served one: 50 m at most) and its field
    there, as the build would draw it once the send is validated (modified_camera)."""
    if not limits.allow(who.id, "preview", participation.rules()["limits"]["previews_per_minute"]):
        fail(429, "rate")
    with pool.connection() as conn:
        if body.add:
            # Placed as post_contribution places an add (computed_at), then answered.
            cam = add_origin(conn, body.lon, body.lat)
            moved = computed_at(conn, cam, cam.x, cam.y, body.placement)
            x, y = moved.pop("_xy")
            new = modified_camera(live.added(live.add_template(conn), NEW_ADD, x, y),
                                  body.shape, body.direction, body.height, body.tilt)  # fmt: skip
            polys = live.buildings_near(conn, x, y, live.fetch_radius(new))
            moved.pop("origin")
            return {**moved, "bands": shown(live.field(new, x, y, polys)),
                    "build_id": meta(conn)[0]}  # fmt: skip
        cam = get_camera(conn, body.camera)
        new = modified_camera(cam, body.shape, body.direction, body.height, body.tilt)
        out: dict = {}
        x, y = cam.x, cam.y
        if body.lon is not None:
            rx, ry = requested_point(conn, cam, body.lon, body.lat)
            polys = live.buildings_near(conn, rx, ry, live.fetch_radius(cam))
            placed = live.place(cam, rx, ry, magnet=body.placement == "facade", polys=polys)
            x, y = placed.x, placed.y
            out = {
                "position": live.to_lonlat(x, y),
                "pulled": placed.pulled,
                "facade": [live.to_lonlat(*c) for c in placed.facade.coords]
                if placed.facade
                else None,
                "facade_m": None if placed.facade_m is None else round(placed.facade_m, 2),
                "move_m": round(placed.move_m, 2),
                "inside_footprint": placed.inside_footprint,
            }
        polys = live.buildings_near(conn, x, y, live.fetch_radius(new))
        out["bands"] = shown(live.field(new, x, y, polys))
        out["build_id"] = meta(conn)[0]
    return out


def mounted_bands(conn, cam: live.Camera, body: HeightIn | TiltIn, payload: dict) -> None:
    """For /revue (phase D3): the field the answer would give with the journey's other
    answers (`bands`) beside the served one (`old_bands`), stored only when it can differ:
    a height on a camera with a tilt, a tilt with a height (served at least estimated, or
    answered on the same screen). Otherwise `no_effect` says why nothing was drawn."""
    q = participation.questions()
    if body.answer == "unknown":
        return
    height = tilt = None
    if body.kind == "height":
        height = q["height"]["classes"][body.answer]
        if cam.tilt_deg is None:
            payload["no_effect"] = "no_tilt"
            return
    else:
        tilt = q["tilt"]["classes"][body.answer]
        if body.aim_height is not None:
            height = q["height"]["classes"][body.aim_height]
        elif cam.height_certainty == "default":
            payload["no_effect"] = "no_height"
            return
    new = live.answered(cam, body.aim_kind, body.aim_direction, height, tilt)
    radius = max(live.fetch_radius(new), live.fetch_radius(cam))
    polys = live.buildings_near(conn, cam.x, cam.y, radius)
    payload["bands"] = {
        "type": "FeatureCollection",
        "features": live.shown_bands(live.field(new, cam.x, cam.y, polys)),
    }
    payload["old_bands"] = {
        "type": "FeatureCollection",
        "features": live.shown_bands(live.field(cam, cam.x, cam.y, polys)),
    }
    for key in ("aim_kind", "aim_direction", "aim_height"):
        if getattr(body, key) is not None:
            payload[key] = getattr(body, key)


def v4(value: str) -> str:
    try:
        u = uuidlib.UUID(value)
    except ValueError:
        fail(422, "uuid")
    if u.version != 4 or u.variant != uuidlib.RFC_4122:
        fail(422, "uuid_v4_only")
    return str(u)


# « Modifier » (migration 012): the kinds one send gathers.
BATCH_KINDS = ("move", "shape", "direction", "height", "tilt", "operator")
# Fields a body has only since « Modifier » (and the proposed operator name since the lot of
# 2026-10-12): left out of the digest when absent, so that a phone's contribution queued
# before this release and sent after it is still the same body. The gesture's duration
# (lot 4: no longer sent) likewise, the other way: a body that has it keeps its digest.
LATER_FIELDS = ("batch", "from_lon", "from_lat", "operator_proposed", "duration_ms", "dome_count")


def body_digest(body: BaseModel) -> str:
    dump = body.model_dump(mode="json")
    for key in LATER_FIELDS:
        if dump.get(key) is None:
            dump.pop(key, None)
    return hashlib.sha256(json.dumps(dump, sort_keys=True).encode()).hexdigest()


def check_batch(conn, batch: str, who: str, camera_id: str, kind: str) -> None:
    """One send is one author's on one camera, one piece per kind; its id names no
    contribution (the review and the withdrawal take either). A send withdrawn (any of
    its pieces) is closed: a piece still queued on the phone and sent after the withdrawal
    must not bring it back piece by piece."""
    rows = conn.execute(
        "SELECT author_id::text, camera_id, kind, status FROM contributions WHERE batch = %s",
        (batch,),
    ).fetchall()
    taken = conn.execute("SELECT 1 FROM contributions WHERE uuid = %s", (batch,)).fetchone()
    if taken or any(a != who or c != camera_id for a, c, *_ in rows):
        fail(409, "batch_taken")
    if any(s == "withdrawn" for *_, s in rows):
        fail(409, "batch_closed")
    if any(k == kind for _, _, k, _ in rows):
        fail(409, "batch_kind_taken")


def batch_of(conn, uid: str) -> str | None:
    """The batch a contribution belongs to, or `uid` itself when it is a batch's id."""
    row = conn.execute("SELECT batch::text FROM contributions WHERE uuid = %s", (uid,)).fetchone()
    if row is not None:
        return row[0]
    hit = conn.execute("SELECT 1 FROM contributions WHERE batch = %s LIMIT 1", (uid,)).fetchone()
    return uid if hit else None


def modified_camera(
    cam: live.Camera,
    shape: str | None = None,
    bearing: int | None = None,
    height: str | None = None,
    tilt: str | None = None,
) -> live.Camera:
    """The camera as « Modifier »'s answers make it, as `apply` would: the shape's kind, the
    bearing for a final kind under the direction rule, the height's class, the tilt's for
    a final kind that takes one with a height at least estimated (answered, or served)."""
    q = participation.questions()
    kind = q["shape"]["kinds"][shape] if shape else None
    final = kind or cam.kind
    if final not in direction.kinds():
        bearing = None
    height_m = q["height"]["classes"][height] if height else None
    tilt_deg = None
    has_height = height_m is not None or cam.height_certainty != "default"
    if tilt and final in participation.tilt_kinds() and has_height:
        tilt_deg = q["tilt"]["classes"][tilt]
    return live.answered(cam, kind, bearing, height_m, tilt_deg)


def shown(f: dict | None) -> dict:
    return {"type": "FeatureCollection", "features": live.shown_bands(f)}


def batch_field(conn, batch: str) -> dict | None:
    """A send of « Modifier » as it would change the map: the camera at its move's position
    with its answers (modified_camera), its field beside the served one; rejected and
    withdrawn pieces and "Je ne sais pas" answers left out, as add_answers leaves them (a
    class the rules do not have). None when nothing is left or the camera is not served."""
    rows = conn.execute(
        "SELECT camera_id, kind, answer, direction_deg, ST_X(geom), ST_Y(geom)"
        " FROM contributions WHERE batch = %s AND status NOT IN ('rejected', 'withdrawn')"
        " AND coalesce(answer, '') NOT IN ('unknown', 'not_visible')",
        (batch,),
    ).fetchall()
    cam = live.camera(conn, rows[0][0]) if rows else None
    if cam is None:
        return None
    by = {kind: (answer, deg, x, y) for _, kind, answer, deg, x, y in rows}
    x, y = by["move"][2:] if "move" in by else (cam.x, cam.y)
    new = modified_camera(
        cam,
        shape=by.get("shape", (None,))[0],
        bearing=by.get("direction", (None, None))[1],
        height=by.get("height", (None,))[0],
        tilt=by.get("tilt", (None,))[0],
    )
    radius = max(live.fetch_radius(new), live.fetch_radius(cam)) + math.hypot(x - cam.x, y - cam.y)
    polys = live.buildings_near(conn, cam.x, cam.y, radius)
    return {"bands": shown(live.field(new, x, y, polys)),
            "old_bands": shown(live.field(cam, cam.x, cam.y, polys))}  # fmt: skip


@app.post("/api/contributions")
def post_contribution(body: ContributionIn, who: Annotated[Account, Depends(author)]):
    """Idempotent on the uuid: the same uuid with the same body is a no-op (200), with
    another body or author a conflict (409). {uuid, status, new}, and `osm: "will_publish"`
    when it will leave for OSM in her name once accepted (will_publish)."""
    uid = v4(body.uuid)
    today = date.today()
    if not FIRST_DAY <= body.day <= today + timedelta(days=1):
        fail(422, "day")
    batch = v4(body.batch) if body.batch is not None else None
    if batch is not None and body.kind not in BATCH_KINDS:
        fail(422, "batch_kind")
    aimed_from = getattr(body, "from_lon", None) is not None
    if aimed_from and batch is None:
        fail(422, "from_without_batch")
    digest = body_digest(body)
    camera_id = participation.added_id(uid) if body.kind == "add" else body.camera
    with pool.connection() as conn, conn.transaction():
        # One camera at a time: its contributions' statuses are recomputed together.
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (camera_id,))
        old = conn.execute(
            "SELECT author_id::text, body_sha256, status FROM contributions WHERE uuid = %s",
            (uid,),
        ).fetchone()
        if old is not None:
            if old[0] != who.id or old[1] != digest:
                fail(409, "uuid_taken")
            out = {"uuid": uid, "status": old[2], "new": False}
            if will_publish(conn, who.id, uid):
                out["osm"] = "will_publish"
            return out
        rules = participation.rules()
        if not limits.allow(who.id, "write", rules["limits"]["writes_per_minute"]):
            fail(429, "rate")
        if batch is not None:
            check_batch(conn, batch, who.id, camera_id, body.kind)
        if body.kind == "add":
            if add_of(conn, camera_id) is not None:
                fail(409, "id_taken")  # 48 bits: another add's id, never merged
            cam = add_origin(conn, body.lon, body.lat, camera_id)
        else:
            cam = get_camera(conn, body.camera)
        served_build = meta(conn)[0]
        payload: dict = {}
        if served_build != body.build_id:
            payload["served_build"] = served_build
        # The camera's OSM tags as the served build has them, with its version (phase D2):
        # the build compares them with the extract's to tell a conflict. An added camera has
        # none ({}), and everything said of it points at its add (`target`).
        row = conn.execute(
            "SELECT tags FROM cameras WHERE camera_id = %s", (cam.camera_id,)
        ).fetchone()
        target = None
        if cam.osm_type is None:
            tags = {}
            if body.kind != "add":
                add = add_of(conn, cam.camera_id)
                target = add[0]
                if row is None and body.kind in ("verify", "move"):
                    fail(422, "add_pending")  # before a build: "Ce n'est pas ça"
        elif row is None or row[0] is None:
            fail(503, "tags_unavailable")  # tables loaded before migration 006
        else:
            tags = row[0]
        direction_deg = operator_name = proposed = None
        if body.kind == "add":
            moved = computed_at(conn, cam, cam.x, cam.y, body.placement)
            (x, y), answer = moved.pop("_xy"), None
            moved.pop("move_m")
            payload.update({
                "requested": [body.lon, body.lat],
                "placement": body.placement,
                # Cameras within duplicate_m the contributor could see ("Non, c'en est
                # une autre"): the build does not take them for this one (duplicate).
                "near": nearby_cameras(conn, x, y, camera_id),
                **moved,
            })  # fmt: skip
        elif body.kind in ("verify", "shape"):
            x, y, answer = cam.x, cam.y, body.answer
        elif body.kind == "direction":
            x, y, answer, direction_deg = cam.x, cam.y, body.answer, body.direction
            if aimed_from:
                # « Modifier »: aimed from where the same send moves the camera.
                x, y = requested_point(conn, cam, body.from_lon, body.from_lat)
                payload["from"] = [body.from_lon, body.from_lat]
            if direction_deg is not None:
                # For /revue: the proposed field beside the one the map showed.
                payload["bands"] = aimed_field(conn, cam, direction_deg, body.aim_kind, (x, y))[
                    "bands"
                ]
                polys = live.buildings_near(conn, cam.x, cam.y, live.fetch_radius(cam))
                payload["old_bands"] = {
                    "type": "FeatureCollection",
                    "features": live.shown_bands(live.field(cam, cam.x, cam.y, polys)),
                }
                if body.aim_kind:
                    payload["aim_kind"] = body.aim_kind
            payload["kind_served"] = cam.kind
        elif body.kind in ("height", "tilt"):
            x, y, answer = cam.x, cam.y, body.answer
            if body.kind == "height":
                answer = participation.height_class(answer)
            mounted_bands(conn, cam, body, payload)
            payload["kind_served"] = cam.kind
            if "aim_height" in payload:
                payload["aim_height"] = participation.height_class(payload["aim_height"])
        elif body.kind == "operator":
            x, y, answer, operator_name = cam.x, cam.y, body.answer, body.operator_name
            if operator_name is not None and not operator_allowed(conn, cam, answer, operator_name):
                fail(422, "operator_name")
            if body.operator_proposed is not None:
                operator_name, proposed = proposed_name(conn, cam, body)
        elif body.kind in ("agree", "disagree"):
            target = v4(body.target)
            x, y = opinion_target(conn, target, cam.camera_id, who.id)
            answer = None
        else:
            moved = computed_move(conn, cam, body.lon, body.lat, body.placement)
            (x, y), answer = moved.pop("_xy"), None
            payload.update({
                "old": live.to_lonlat(cam.x, cam.y),
                "requested": [body.lon, body.lat],
                "placement": body.placement,
                "mount_group": cam.mount_group,
                **moved,
            })  # fmt: skip
            # Release 1's fields, kept when a queued item still carries them.
            for legacy in ("under_arcade", "mount_observed"):
                if getattr(body, legacy) is not None:
                    payload[legacy] = getattr(body, legacy)
        conn.execute(
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
            " osm_timestamp, build_id, author_id, day, on_site, answer, target, geom,"
            " payload, body_sha256, direction_deg, operator_name, osm_tags, batch,"
            " operator_proposed, sync_chosen, dome_count) VALUES (%s, %s, %s, %s, %s, %s, %s,"
            " %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 2154), %s, %s, %s, %s,"
            " %s, %s, %s, %s, %s)",
            (uid, body.kind, camera_id, cam.osm_type, cam.osm_id, cam.osm_version,
             cam.osm_timestamp, body.build_id, who.id, body.day, body.on_site,
             answer, target, x, y, json.dumps(payload), digest, direction_deg, operator_name,
             json.dumps(tags), batch, proposed, sync_chosen(conn, who.id),
             getattr(body, "dome_count", None)),
        )  # fmt: skip
        recompute(conn, camera_id)
        status = conn.execute(
            "SELECT status FROM contributions WHERE uuid = %s", (uid,)
        ).fetchone()[0]
        out = {"uuid": uid, "status": status, "new": True}
        if will_publish(conn, who.id, uid):
            out["osm"] = "will_publish"
    return out


def sync_chosen(conn, account_id: str) -> bool:
    """Whether the author has chosen to publish, now, on the server writing is offered on
    (her token there): kept on the contribution received (migration 022 sync_chosen), only
    those leave."""
    server = publish_server()
    return server is not None and conn.execute(
        "SELECT EXISTS (SELECT FROM osm_write WHERE account_id = %s AND server = %s"
        " AND token IS NOT NULL)", (account_id, server.name)).fetchone()[0]  # fmt: skip


def will_publish(conn, account_id: str, uid: str) -> bool:
    """Whether this contribution, once accepted (and applied by a build), leaves for OSM
    in the person's name: her choice is on (a token, not blocked) on the offered write
    server, and the contribution can leave there (publish.says_something, made on site,
    received while her choice was on (sync_chosen) and observed from her consent day, not
    on a household's or hidden camera, not on an OSM camera when writing goes to the test
    server). The page says « sera publiée sur OSM en votre nom après relecture »."""
    server = publish_server()
    if server is None:
        return False
    row = conn.execute(
        "SELECT c.kind, c.answer, c.direction_deg, c.operator_name, c.operator_proposed,"
        " c.on_site IS TRUE AND c.sync_chosen AND c.day >= w.consent_day"
        " AND coalesce(c.osm_type, '') <> ALL(%s)"
        " AND c.camera_id NOT IN (SELECT camera_id FROM hidden_cameras)"
        " AND NOT EXISTS (SELECT FROM contributions h WHERE h.camera_id = c.camera_id"
        "   AND h.kind = 'operator' AND h.answer = 'household'"
        "   AND h.status NOT IN ('rejected', 'withdrawn'))"
        " FROM contributions c JOIN osm_write w ON w.account_id = c.author_id"
        " WHERE c.uuid = %s AND c.author_id = %s AND w.server = %s AND w.token IS NOT NULL"
        " AND coalesce(w.last_error, '') <> 'blocked'",
        (["w", "r"] if server.name == "live" else ["n", "w", "r"], uid, account_id, server.name),
    ).fetchone()
    return bool(row and row[5] and publish.says_something(*row[:5]))


def proposed_name(conn, cam: live.Camera, body: OperatorIn) -> tuple[str | None, str | None]:
    """(operator_name, operator_proposed) of a name the contributor typed: after public or
    business only, never with a listed name, a name by rules/questions.yaml
    operator.proposed — else 422 operator_proposed. Equal to a name of that class once
    folded (a listed one, or one the camera is offered): that name, nothing waiting."""
    if body.answer not in ("public", "business") or body.operator_name is not None:
        fail(422, "operator_proposed")
    name = participation.proposed_operator(body.operator_proposed)
    if name is None:
        fail(422, "operator_proposed")
    same = [e["name"] for e in participation.all_operators() if e["class"] == body.answer]
    for listed in [*same, *offered_operators(conn, cam, body.answer)]:
        if participation.fold(listed) == participation.fold(name):
            return listed, None
    return None, name


class WithdrawIn(BaseModel):
    uuid: str = Field(max_length=36)


@app.post("/api/contributions/withdraw")
def withdraw(body: WithdrawIn, who: Annotated[Account, Depends(author)]):
    """The author withdraws their own pending contribution (migration 008): the row stays,
    status withdrawn, decided_by the author. Idempotent: withdrawing again says withdrawn.
    An add takes with it the author's own pending answers on it; other accounts' answers
    stay (they leave only with their add). Another author's contribution is unknown here.
    A piece of a « Modifier » send, or the send's own id, withdraws the whole send: its
    pieces still pending (`withdrawn` lists the others)."""
    uid = v4(body.uuid)
    with pool.connection() as conn, conn.transaction():
        batch = batch_of(conn, uid)
        if batch is not None:
            return withdraw_batch(conn, uid, batch, who.id)
        row = conn.execute(
            "SELECT camera_id, author_id::text, status, kind FROM contributions WHERE uuid = %s",
            (uid,),
        ).fetchone()
        if row is None or row[1] != who.id:
            fail(404, "unknown_contribution")
        camera_id, _, status, kind = row
        if status == "withdrawn":
            return {"uuid": uid, "status": status, "withdrawn": []}
        if status != "pending":
            fail(409, "not_pending")
        # Its own bucket: having just sent many contributions (an add and its answers) must
        # not stop their author from taking one back (seen in the smoke test: 429).
        lim = participation.rules()["limits"]["writes_per_minute"]
        if not limits.allow(who.id, "withdraw", lim):
            fail(429, "rate")
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (camera_id,))
        done = [r[0] for r in conn.execute(
            "UPDATE contributions SET status = 'withdrawn', decided_by_id = %s, decided_on = %s"
            " WHERE (uuid = %s OR (%s AND target = %s AND author_id = %s))"
            " AND status = 'pending' RETURNING uuid::text",
            (who.id, date.today(), uid, kind == "add", uid, who.id),
        ).fetchall()]  # fmt: skip
    return {"uuid": uid, "status": "withdrawn", "withdrawn": sorted(u for u in done if u != uid)}


def withdraw_batch(conn, uid: str, batch: str, who: str) -> dict:  # who: the account id
    """withdraw() for a « Modifier » send: its pieces still pending, together; idempotent
    (all withdrawn already: withdrawn); refused when a piece was decided meanwhile."""
    rows = conn.execute(
        "SELECT uuid::text, camera_id, author_id::text, status FROM contributions WHERE batch = %s",
        (batch,),
    ).fetchall()
    if not rows or rows[0][2] != who:
        fail(404, "unknown_contribution")
    if all(r[3] == "withdrawn" for r in rows):
        return {"uuid": uid, "status": "withdrawn", "withdrawn": []}
    if any(r[3] not in ("pending", "withdrawn") for r in rows):
        fail(409, "not_pending")
    if not limits.allow(who, "withdraw", participation.rules()["limits"]["writes_per_minute"]):
        fail(429, "rate")
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (rows[0][1],))
    done = [r[0] for r in conn.execute(
        "UPDATE contributions SET status = 'withdrawn', decided_by_id = %s, decided_on = %s"
        " WHERE batch = %s AND status = 'pending' RETURNING uuid::text",
        (who, date.today(), batch),
    ).fetchall()]  # fmt: skip
    return {"uuid": uid, "status": "withdrawn", "withdrawn": sorted(u for u in done if u != uid)}


def nearby_cameras(conn, x: float, y: float, camera_id: str) -> list[str]:
    """Ids of the cameras within duplicate_m of (x, y): the served build's, and the adds no
    build has applied (not rejected), but `camera_id`."""
    near = participation.contributions()["duplicate"]["duplicate_m"]
    rows = conn.execute(
        "SELECT camera_id FROM cameras"
        " WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%s, %s), 2154), %s)"
        " UNION SELECT camera_id FROM contributions"
        " WHERE kind = 'add' AND status NOT IN ('rejected', 'withdrawn')"
        " AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(%s, %s), 2154), %s)",
        (x, y, near, x, y, near),
    ).fetchall()
    return sorted(r[0] for r in rows if r[0] != camera_id)


def opinion_target(conn, target: str, camera_id: str, who: str) -> tuple[float, float]:
    """The proposal an opinion is about: another author's move, "not found" or add on this
    camera, not rejected. Returns its position (the opinion's own)."""
    row = conn.execute(
        "SELECT camera_id, author_id::text, kind, answer, status, ST_X(geom), ST_Y(geom)"
        " FROM contributions WHERE uuid = %s",
        (target,),
    ).fetchone()
    if row is None:
        fail(404, "unknown_target")
    cam, by, kind, answer, status, x, y = row
    if cam != camera_id:
        fail(422, "camera_mismatch")
    if not confirm.is_proposal(confirm.Row(target, kind, by, status, answer=answer)):
        fail(422, "not_a_proposal")
    if status not in OPEN:
        fail(422, "target_closed")
    if by == who:
        fail(422, "own_proposal")
    return x, y


# Who made a contribution, for telling authors apart (confirm): its account, or for a
# deleted account the contribution itself (two deleted accounts are never one person).
AUTHOR_KEY = "coalesce(author_id::text, 'gone:' || uuid::text)"


def camera_rows(conn, camera_ids: list[str]) -> dict[str, list[confirm.Row]]:
    """Every contribution of these cameras, as confirm.Row, by camera."""
    out: dict[str, list[confirm.Row]] = defaultdict(list)
    if not camera_ids:
        return out
    for cam, *r in conn.execute(
        f"SELECT camera_id, uuid::text, kind, {AUTHOR_KEY}, status, answer, ST_X(geom),"
        " ST_Y(geom), target::text, decided_on IS NOT NULL, direction_deg, operator_name,"
        " on_site, coalesce((SELECT disabled FROM accounts WHERE id = author_id), false),"
        " dome_count FROM contributions WHERE camera_id = ANY(%s)",
        (list(camera_ids),),
    ):
        out[cam].append(confirm.Row(*r))
    return out


def agreement_counts(conn, camera_ids: list[str]) -> dict[str, tuple[int, int]]:
    """(agree, disagree) of every proposal and every answered D2 contribution of these
    cameras."""
    within = participation.rules()["confirm"]["move_within_m"]
    within_deg = participation.rules()["confirm"]["direction_within_deg"]
    out = {}
    for rows in camera_rows(conn, camera_ids).values():
        out.update(confirm.agreements(rows, within))
        out.update(confirm.d2_agreements(rows, within_deg))
    return out


def recompute(conn, camera_id: str) -> None:
    """`peer` mode only: validate what other authors agree with. In `review` mode (the
    default) statuses change by the review account's decisions alone."""
    if participation.rules()["validation"] != "peer":
        return
    rows = camera_rows(conn, [camera_id])[camera_id]
    within = participation.rules()["confirm"]["move_within_m"]
    new = confirm.statuses(rows, within)
    for r in rows:
        if r.uuid in new and new[r.uuid] != r.status:
            conn.execute(
                "UPDATE contributions SET status = %s WHERE uuid = %s", (new[r.uuid], r.uuid)
            )


PROPOSALS_SQL = """
SELECT c.uuid::text, c.camera_id, c.kind, c.answer, c.status, to_char(c.day, 'YYYY-MM'),
       c.author_id::text, coalesce(k.kind, 'unknown'),
       ST_X(ST_Transform(coalesce(k.geom, c.geom), 4326)),
       ST_Y(ST_Transform(coalesce(k.geom, c.geom), 4326)),
       c.payload->'position', (c.payload->>'move_m')::float, {bands}, c.on_site IS TRUE,
       c.batch::text
FROM contributions c LEFT JOIN cameras k ON k.camera_id = c.camera_id
WHERE (c.status IN ('pending', 'validated') OR ({conflicts} AND c.kind = 'add'
                                                AND c.status = 'conflict'))
  AND (c.kind IN ('move', 'add') OR (c.kind = 'verify' AND c.answer = 'not_found'))
  AND c.camera_id NOT IN (SELECT camera_id FROM hidden_cameras)
  AND {where}
ORDER BY c.day DESC, c.uuid
LIMIT %s
"""


@app.get("/api/proposals")
def proposals(
    request: Request,
    who: Annotated[Account | None, Depends(visitor)],
    bbox: Annotated[str | None, Query(max_length=100)] = None,
    camera: Annotated[str | None, Query(max_length=32)] = None,
):
    """Open proposals (pending or validated, not yet applied by a build) — moves, "not
    found" and adds — for everyone, signed in or not (no session: no `m`): by view
    (`bbox`, the map from z13) or for one camera (`camera`, with the proposed field's
    bands, drawn only while it is selected). Placed on the camera's current position,
    with the proposed one, the month (never the day: the reviewers' routes and the
    person's own list keep it), the agreement counts, whether the asker made it
    (`mine`) and their own opinion; never an author's name. An add is placed where it was
    added (`k` add, the camera `c` its id); for one camera only, with the answers it keeps
    (`ans`, add_answers: its sheet lists them). For one camera, a privileged session (a
    reviewer's or an administrator's, opened by /api/review/session) also gets an add in
    conflict (status `conflict`, reason duplicate: an OSM camera mapped beside it since),
    which no other session sees. Never a hidden camera's
    (migration 018): the build leaves it out, and so do its proposals."""
    if (bbox is None) == (camera is None):
        fail(422, "bbox_or_camera")
    if bbox is not None:
        try:
            w, s_, e, n = (float(v) for v in bbox.split(","))
        except ValueError:
            fail(422, "bbox")
        if not (w < e and s_ < n) or (e - w) * (n - s_) > BBOX_MAX_DEG2:
            fail(422, "bbox")
        where = ("coalesce(k.geom, c.geom) && ST_Transform(ST_MakeEnvelope(%s, %s, %s, %s,"
                 " 4326), 2154)")  # fmt: skip
        args: tuple = (w, s_, e, n)
        bands = "NULL"
    else:
        where, args, bands = "c.camera_id = %s", (camera,), "c.payload->'bands'"
    conflicts = camera is not None and is_privileged(request, who)
    with pool.connection() as conn:
        rows = conn.execute(
            PROPOSALS_SQL.format(where=where, bands=bands, conflicts=str(conflicts).lower()),
            (*args, BBOX_MAX_FEATURES),
        ).fetchall()
        # One camera: an add's field is the one its open answers give, not the default
        # camera's stored at receipt; a move of « Modifier » draws its whole send's field.
        # A pending add's answers too, as they make its field: its sheet lists them and
        # reads them here (a query per add, never on every pan of the map).
        answers: dict = {}
        if camera is not None:
            rows = [
                (*r[:12], answered_add_bands(conn, r[1]) or r[12], *r[13:]) if r[2] == "add"
                else (*r[:12], (batch_field(conn, r[14]) or {}).get("bands") or r[12], *r[13:])
                if r[14] else r
                for r in rows
            ]  # fmt: skip
            answers = {r[1]: add_answers(conn, r[0], r[6]) for r in rows if r[2] == "add"}
        cams = sorted({r[1] for r in rows})
        counts = agreement_counts(conn, cams)
        # The asker's own opinions: kind and uuid (to withdraw it).
        mine = {t: (k, u) for t, k, u in conn.execute(
            "SELECT target::text, kind, uuid::text FROM contributions"
            " WHERE author_id = %s AND target IS NOT NULL"
            " AND status NOT IN ('rejected', 'withdrawn') AND camera_id = ANY(%s)",
            (who.id, cams),
        ).fetchall()} if who is not None else {}  # fmt: skip
    features = []
    for row in rows:
        (uid, cam, kind, _answer, status, month, by, cam_kind, lon, lat, pos, move_m, bnds, on,
         batch) = row  # fmt: skip
        agree, disagree = counts.get(uid, (0, 0))
        props = {
            "u": uid, "c": cam, "k": kind if kind in ("move", "add") else "not_found",
            "ck": cam_kind, "s": status, "month": month, "n": agree, "d": disagree,
            "o": mine.get(uid, (None,))[0],
        }  # fmt: skip
        if who is not None:
            props["m"] = by is not None and by == who.id  # a visitor has nothing of their own
        if uid in mine:
            props["ou"] = mine[uid][1]
        if kind == "move" and pos:
            props["to"] = pos
            props["mv"] = move_m
        if bnds is not None:
            props["bands"] = bnds
        if status == "conflict":
            props["reason"] = "duplicate"
        if on:
            props["os"] = True  # made on site: "Ajoutée sur place"
        if batch:
            props["b"] = batch  # a piece of a « Modifier » send
        if kind == "add" and cam in answers:
            props["ans"] = answers[cam]  # {}: read, none kept
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
            "properties": props,
        })  # fmt: skip
    return {"type": "FeatureCollection", "features": features}


# --- a camera's public history (lot U, 2026-10-18) ------------------------------------------

# What changed, in the sheet's words (web/src/history.ts says them in French): a sighting
# (« Elle est là »), « introuvable », a move, an add and each « Compléter » / « Modifier »
# answer that says something.
HISTORY_WHAT = (
    "CASE WHEN c.kind = 'verify' AND c.answer = 'present' THEN 'seen'"
    " WHEN c.kind = 'verify' AND c.answer = 'not_found' THEN 'gone'"
    " WHEN c.kind = 'move' THEN 'moved' WHEN c.kind = 'add' THEN 'added'"
    " ELSE c.kind END"
)
# The author's pseudonym, only when she chose to show it (migration 024) and her account
# is a claimed one in use (auth.CLAIMED: not a placeholder; not disabled); a deleted
# account's rows have no author (014): NULL, said « par un contributeur ».
HISTORY_WHO = (
    "CASE WHEN a.history_pseudonym AND NOT a.disabled"
    " AND (a.password_hash IS NOT NULL OR a.osm_id IS NOT NULL) THEN a.pseudonym END"
)
# The OSM node a contribution was published on, on OSM's live server only (migration 016:
# osm_publications is per server; a dev server's node is a test object, never linked):
# the OSM camera's own node, or an added camera's node created there (osm_nodes).
HISTORY_NODE = (
    "CASE WHEN p.uuid IS NULL THEN NULL"
    " WHEN c.camera_id LIKE 'n%%' THEN substr(c.camera_id, 2)::bigint"
    " WHEN c.camera_id LIKE 'c%%' THEN (SELECT n.node_id FROM osm_nodes n"
    "  WHERE n.server = 'live' AND n.camera_id = c.camera_id) END"
)
HISTORY_SQL = f"""
SELECT {HISTORY_WHAT}, to_char(c.day, 'YYYY-MM'), c.on_site IS TRUE, {HISTORY_WHO},
       {HISTORY_NODE}
FROM contributions c
LEFT JOIN accounts a ON a.id = c.author_id
LEFT JOIN osm_publications p ON p.uuid = c.uuid AND p.server = 'live' AND p.state = 'published'
WHERE c.camera_id = %s
  AND c.status IN ('validated', 'applied', 'superseded')
  AND c.kind IN ('add', 'verify', 'move', 'shape', 'direction', 'height', 'tilt', 'operator')
  AND NOT (c.kind = 'verify' AND coalesce(c.answer, '') NOT IN ('present', 'not_found'))
  AND coalesce(c.answer, '') NOT IN ('unknown', 'not_visible')
  AND NOT coalesce(a.test, false)
  AND c.camera_id NOT IN (SELECT camera_id FROM hidden_cameras)
ORDER BY c.day DESC, c.decision_seq DESC NULLS LAST, c.uuid
LIMIT %s
"""
HISTORY_MAX = 50


@app.get("/api/history")
def camera_history(camera: Annotated[str, Query(max_length=32)]):
    """A camera's history on its public sheet (lot U; DECISIONS 2026-09-30 and 2026-10-13:
    no author on the map, months not days), the same for everyone, signed in or not: the
    contributions the review accepted — validated, applied by a build, or superseded by a
    newer accepted one (ACCEPTED: what the export replays and the leaderboard counts);
    never one pending, rejected, withdrawn or in conflict — that change something (an
    opinion, « Je ne sais pas » and « Je ne vois pas » do not), newest first. Each says what
    changed (`what`), the month of the observation (never the day), whether it was made on
    site, who (`by`: her pseudonym only when she chose to show it, migration 024; else
    null, « par un contributeur »), and for one published on OpenStreetMap's live server
    the node's history there (`osm`, already public at OSM; never a test server's). Never
    a test account's contribution (accounts.test), never a hidden camera's (018: an empty
    list, as for a camera nobody contributed to), never a uuid, a day or a reviewer. The
    choice is read at each request: `no-store`, so that showing or hiding one's pseudonym
    takes effect at the next opening of a sheet."""
    if not CAMERA_ID.fullmatch(camera):
        fail(422, "camera")
    with pool.connection() as conn:
        rows = conn.execute(HISTORY_SQL, (camera, HISTORY_MAX)).fetchall()
    entries: list[dict] = []
    for what, month, on_site, by, node in rows:
        entry = {"what": what, "month": month, "on_site": on_site, "by": by,
                 "osm": f"{osm.LIVE_URL}/node/{node}/history" if node else None}  # fmt: skip
        if entries and entries[-1] == entry:
            continue  # one line for the same change, month and author (a send's pieces)
        entries.append(entry)
    return JSONResponse({"camera": camera, "history": entries},
                        headers={"Cache-Control": "no-store"})  # fmt: skip


@app.get("/api/me")
def me(request: Request, who: Annotated[Account, Depends(author)]):
    """What the page needs to know of the account: its pseudonym (`author` kept for the
    existing client code), whether this session may review (`reviewer`: a reviewer's or an
    administrator's session opened by /api/review/session, lot 2), its role, the month it
    was created, whether it is shown in the leaderboard, how validation works, whether it
    is linked to OpenStreetMap, whether it has a password, and whether it publishes on the
    current write server."""
    server = publish_server()
    with pool.connection() as conn:
        publishes = server is not None and publishing(conn, who.id, server.name)
    return {
        "author": who.pseudonym,
        "pseudonym": who.pseudonym,
        "reviewer": is_privileged(request, who),
        "role": who.role,
        "since": who.created_month.strftime("%Y-%m"),
        "leaderboard": who.leaderboard,
        # Her pseudonym on the public history of the cameras she surveyed (migration 024).
        "history_pseudonym": who.history_pseudonym,
        "validation": participation.rules()["validation"],
        # Linked to an OpenStreetMap user, has a password (migration 015); nothing else
        # about OSM (its name is never stored).
        "osm": who.osm,
        "password": who.password,
        # Her OSM synchronisation on (migration 022: an osm_write row with a token on the
        # offered write server); `publish`, its former name, kept for the page until then.
        "sync": publishes,
        "publish": publishes,
    }


# An operator name proposed and not decided yet (migration 017), in SQL; {c}: the alias.
PROPOSED_WAITING = (
    "({c}operator_proposed IS NOT NULL AND {c}operator_choice IS NULL AND {c}status = 'pending')"
)


# « Mes caméras » (lot U, the account's screen): where each of the person's contributions
# stands, one word for her collection and its list — `pending` (« en attente »: the review
# has not decided, or must decide again, a conflict), `validated` (« validée »: accepted,
# not yet drawn by a build, or outranked by a newer accepted observation, superseded),
# `map` (« sur la carte »: applied by a build), `osm` (« publiée sur OSM »: applied and
# published there), `refused` (« refusée »); None for what is no camera's change — an
# opinion on another's proposal, « Je ne sais pas », « Je ne vois pas », « ne sait pas »
# — and for what she withdrew.
def collection_state(kind: str, answer: str | None, status: str, published: bool) -> str | None:
    blank = (kind == "verify" and answer not in ("present", "not_found")) or (
        kind in confirm.D2_KINDS and answer in confirm.NO_ANSWER
    )
    if kind in OPINIONS or blank or status == "withdrawn":
        return None
    if status == "rejected":
        return "refused"
    if status in ("pending", "conflict"):
        return "pending"
    if published:
        return "osm"
    return "map" if status == "applied" else "validated"


def counted_servers() -> list[str]:
    """The OSM servers whose publications « Mes caméras » counts: the live one, and the one
    publishing is offered on now (the preview's test server), as « Compte » shows it."""
    server = publish_server()
    return sorted({"live", *([server.name] if server else [])})


# A contribution's publication on a counted server (counted_servers, %s): a published one
# first, as the export counts it (any published row), then the live one.
MY_PUBLICATION = (
    "(SELECT json_build_object('server', p.server, 'state', p.state,"
    " 'month', to_char(p.month, 'YYYY-MM'), 'changeset', p.changeset)"
    " FROM osm_publications p WHERE p.uuid = c.uuid AND p.server = ANY(%s)"
    " ORDER BY p.state = 'published' DESC, p.server = 'live' DESC, p.month DESC LIMIT 1)"
)


@app.get("/api/me/contributions")
def my_contributions(who: Annotated[Account, Depends(author)]):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT c.uuid::text, c.kind, c.camera_id, c.day::text, c.status, c.answer,"
            " (c.payload->>'move_m')::float, c.apply_build, c.direction_deg, c.operator_name,"
            " c.batch::text, k.commune, c.dome_count,"
            f" {PROPOSED_WAITING.format(c='c.')},"
            " ST_X(ST_Transform(coalesce(k.geom, c.geom), 4326)),"
            " ST_Y(ST_Transform(coalesce(k.geom, c.geom), 4326)), c.on_site IS TRUE,"
            f" {MY_PUBLICATION}"
            " FROM contributions c LEFT JOIN cameras k ON k.camera_id = c.camera_id"
            " WHERE c.author_id = %s ORDER BY c.day DESC, c.uuid",
            (counted_servers(), who.id),
        ).fetchall()
        counts = agreement_counts(conn, sorted({r[2] for r in rows}))
        names = labels(conn, sorted({r[2] for r in rows}))
    # apply_build: the build that applied it, or found it in conflict or superseded; batch:
    # the « Modifier » send it is a piece of. For the profile (25b): the camera's commune
    # (none for an add not yet applied), where it stands (its own position, the camera's
    # once in the build), and the others' opinions on it (« Contestée »).
    # operator_proposed: a name typed and waiting for the review, never shown before it
    # accepts it (then in operator_name; nothing when refused).
    # « Mes caméras » (lot U): made on site, what became of it on OSM (`osm`: its
    # publication on the live server or the offered one, null when none), where it stands
    # (`state`, collection_state), and each camera's label as « Compte » names it
    # (`cameras`: its kind for the collection's pictograms, an add's from its shape answer).
    # dome_count: a « Multi-boules » answer's number of domes (null: none given).
    keys = ("uuid", "kind", "camera", "day", "status", "answer", "move_m", "apply_build",
            "direction", "operator_name", "batch", "commune", "dome_count",
            "operator_proposed", "lng", "lat", "on_site", "osm")  # fmt: skip
    mine = [dict(zip(keys, r, strict=True)) for r in rows]
    # As /revue counts them (confirm.py): other contributions and opinions; none for what
    # no one can agree with (an opinion itself).
    for c in mine:
        c["agree"], c["disagree"] = counts.get(c["uuid"], (None, None))
        c["state"] = collection_state(c["kind"], c["answer"], c["status"], published(c["osm"]))
    return {"author": who.pseudonym, "contributions": mine, "cameras": names}


def published(publication: dict | None) -> bool:
    return publication is not None and publication["state"] == "published"


# --- accounts (migration 014) -------------------------------------------------------------


class LoginIn(BaseModel):
    pseudonym: str = Field(max_length=64)
    password: str = Field(max_length=auth.PASSWORD_MAX)


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.cookie_name, token, max_age=auth.SESSION_DAYS * 86400, path="/",
        secure=settings.cookie_secure, httponly=True, samesite="strict",
    )  # fmt: skip


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/", secure=settings.cookie_secure,
                           httponly=True, samesite="strict")  # fmt: skip


def credentials_refused() -> JSONResponse:
    return JSONResponse({"error": "credentials"}, status_code=401)


# One attempt at a time per pseudonym: each waits for the delay its predecessors' failures
# set (parallel guesses no longer share one delay). And at most two password checks under
# way, taken before a worker thread is: a flood of sign-ins waits here, on the event loop,
# instead of holding every thread the other routes need.
_attempts: dict[str, list] = {}  # key -> [asyncio.Lock, attempts holding or waiting]
_checks = asyncio.Semaphore(auth.CONCURRENT_HASHES)


async def throttled(key: str, check):
    """`check()` (run in a thread: argon2 and the database block) after the pseudonym's
    delay; its falsy result counts as a failure, which lengthens the next delay."""
    entry = _attempts.setdefault(key, [asyncio.Lock(), 0])
    entry[1] += 1
    try:
        async with entry[0]:
            wait = auth.throttle.wait(key)
            if wait > 0:
                await auth.sleep(wait)
            async with _checks:
                result = await run_in_threadpool(check)
            if result:
                auth.throttle.succeeded(key)
            else:
                auth.throttle.failed(key)
            return result
    finally:
        entry[1] -= 1
        if entry[1] == 0:
            _attempts.pop(key, None)


def sign_in(pseudonym: str, password: str) -> str | None:
    """A new session's token, or None: unknown pseudonym, placeholder, disabled account or
    wrong password, each checked against a hash (auth.verify), none told apart; and since
    lot 2 a reviewer or an administrator, even with the right password: they sign in by
    the privileged entry (POST /api/review/session), behind /revue's own gate."""
    with pool.connection() as conn:
        account_id, stored, role = auth.login_account(conn, pseudonym)
    if not auth.verify(stored, password) or role in auth.PRIVILEGED:
        return None
    with pool.connection() as conn, conn.transaction():
        return open_session(conn, account_id)


@app.post("/api/session")
async def login(body: LoginIn):
    """Sign in: 204 and the session cookie, or 401 credentials after the pseudonym's delay
    (auth.Throttle)."""
    token = await throttled(body.pseudonym.lower(),
                            lambda: sign_in(body.pseudonym, body.password))  # fmt: skip
    if token is None:
        return credentials_refused()
    response = Response(status_code=204)
    set_session_cookie(response, token)
    return response


@app.delete("/api/session")
def logout(request: Request):
    """Sign out: the session is deleted, its privileged and reauthentication marks dropped,
    and the cookie cleared (also without a session)."""
    token = session_token(request)
    if token is not None:
        auth.forget_marks(token_digest=auth.digest(token))
        with pool.connection() as conn:
            conn.execute("DELETE FROM sessions WHERE token_sha256 = %s", (auth.digest(token),))
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


class LeaderboardIn(BaseModel):
    on: bool


@app.put("/api/me/leaderboard", status_code=204)
def my_leaderboard(body: LeaderboardIn, who: Annotated[Account, Depends(author)]):
    """Whether the person appears in the others' leaderboard (off by default)."""
    with pool.connection() as conn:
        conn.execute("UPDATE accounts SET leaderboard = %s WHERE id = %s", (body.on, who.id))
    return Response(status_code=204)


@app.put("/api/me/history-pseudonym", status_code=204)
def my_history_pseudonym(body: LeaderboardIn, who: Annotated[Account, Depends(author)]):
    """Whether the person's pseudonym is shown in the public history of the cameras she
    surveyed (migration 024; off by default, « par un contributeur »): read by GET
    /api/history at each request, so it takes effect at once, both ways."""
    with pool.connection() as conn:
        conn.execute("UPDATE accounts SET history_pseudonym = %s WHERE id = %s", (body.on, who.id))
    return Response(status_code=204)


def password_matches(account_id: str, password: str) -> bool:
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM accounts WHERE id = %s", (account_id,)
        ).fetchone()
    return auth.verify(row[0] if row else None, password)


class PasswordIn(BaseModel):
    current: str = Field(max_length=auth.PASSWORD_MAX)
    new: str = Field(max_length=auth.PASSWORD_MAX)


@app.post("/api/me/password")
async def my_password(body: PasswordIn, request: Request, who: Annotated[Account, Depends(author)]):
    """The person changes the password they were given: the current one checked (with the
    sign-in's delay), the new one at least PASSWORD_MIN characters; the account's other
    sessions are revoked, this one stays."""
    if len(body.new) < auth.PASSWORD_MIN:
        fail(400, "password_short")
    if not await throttled(who.pseudonym.lower(),
                           lambda: password_matches(who.id, body.current)):  # fmt: skip
        return credentials_refused()
    new_hash = await run_in_threadpool(auth.hash_password, body.new)
    keep = auth.digest(request.cookies.get(settings.cookie_name, ""))

    def store():
        with pool.connection() as conn, conn.transaction():
            conn.execute("UPDATE accounts SET password_hash = %s WHERE id = %s",
                         (new_hash, who.id))  # fmt: skip
            conn.execute("DELETE FROM sessions WHERE account_id = %s AND token_sha256 <> %s",
                         (who.id, keep))  # fmt: skip

    await run_in_threadpool(store)
    return Response(status_code=204)


class DeleteIn(BaseModel):
    """The password; an account without one (signed in with OpenStreetMap) retypes its
    pseudonym instead."""

    password: str | None = Field(default=None, max_length=auth.PASSWORD_MAX)
    pseudonym: str | None = Field(default=None, max_length=64)


@app.post("/api/me/delete")
async def delete_me(body: DeleteIn, who: Annotated[Account, Depends(author)]):
    """« Supprimer mon compte »: the password checked (with the sign-in's delay), then the
    account and its sessions deleted; its contributions stay, without author (migration
    014: ON DELETE SET NULL), and the cookie is cleared. Not a test account: its
    contributions would lose what marks them as test; the owner deletes it with the CLI,
    which takes them with it."""
    if who.test:
        return JSONResponse({"error": "test_account"}, status_code=409)
    if who.password:
        if body.password is None:
            return JSONResponse({"error": "confirmation"}, status_code=400)
        if not await throttled(
            who.pseudonym.lower(), lambda: password_matches(who.id, body.password or "")
        ):
            return credentials_refused()
    # No password (an OpenStreetMap account): the pseudonym retyped, exactly, confirms it —
    # the session alone (SameSite=Strict, our Origin) is who asks.
    elif body.pseudonym != who.pseudonym:
        return JSONResponse({"error": "confirmation"}, status_code=400)

    await run_in_threadpool(remove_self, who.id)
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


EXPORT_FILE = "surveillance-world-mes-donnees.json"
# What a contribution holds of the person's send, for « Télécharger mes données »: never who
# decided on it. Its payload without the fields the server drew (bands, old_bands).
EXPORT_SQL = """
SELECT c.uuid::text, c.kind, c.camera_id, c.answer, c.day::text, c.on_site,
       c.status, c.decided_on::text, ST_X(ST_Transform(c.geom, 4326)),
       ST_Y(ST_Transform(c.geom, 4326)), c.direction_deg, c.operator_name,
       c.operator_proposed, c.target::text, c.batch::text, c.build_id,
       c.payload - 'bands' - 'old_bands', c.dome_count,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('server', p.server, 'state', p.state,
                'month', to_char(p.month, 'YYYY-MM'), 'changeset', p.changeset)
                ORDER BY p.server), '[]')
        FROM osm_publications p WHERE p.uuid = c.uuid)
FROM contributions c WHERE c.author_id = %s ORDER BY c.day, c.uuid
"""
EXPORT_KEYS = ("uuid", "kind", "camera", "answer", "day", "on_site", "status",
               "decided_on", "lng", "lat", "direction", "operator_name", "operator_proposed",
               "target", "batch", "build", "details", "dome_count", "osm")  # fmt: skip


def my_points_by_month(conn, who: Account) -> dict:
    """The person's points as the leaderboard counts them (lacarte.api.leaderboard.awards):
    accepted ones by month of decision and kind, and those waiting for review."""
    months: dict[str, dict[str, int]] = defaultdict(
        lambda: dict.fromkeys(leaderboard.CATEGORIES, 0)
    )
    pending = 0
    for a in leaderboard.awards(leaderboard.load(conn)):
        if a.account != who.id:
            continue
        if a.accepted:
            months[a.month][a.category] += a.points
        else:
            pending += a.points
    return {"by_month": [{"month": m, **by, "total": sum(by.values())}
                         for m, by in sorted(months.items())],
            "pending": pending}  # fmt: skip


@app.get("/api/me/export")
def my_export(who: Annotated[Account, Depends(author)]):
    """« Télécharger mes données »: the person's own data, as a JSON attachment (export_data).
    A test account exports too."""
    with pool.connection() as conn:
        return export_response(export_data(conn, who), EXPORT_FILE)


def export_data(conn, who: Account) -> dict:
    """An account's own data: the account (pseudonym, month created, role, linked to OSM
    and its numeric id there, password or not, in the leaderboard or not, test account or
    not, publishing or not, where, since which day, its last refusal), its contributions
    (what each send held, what became of it on OSM, and where it stands as « Mes caméras »
    says it, with each camera's label), its points by month, its sessions
    (how many, until when), and since lot 2 its lines of the journal: where the person
    acted (a reviewer's or an administrator's own gestures), whole but the pseudonym of the
    account it was about (its target, an id, stays), the day and the action
    only where the journal is about her (never who acted). Nothing else about anyone else:
    no reviewer, no other account."""
    osm_id, osm_on = conn.execute(
        "SELECT osm_id, osm_server FROM accounts WHERE id = %s", (who.id,)
    ).fetchone()
    write = conn.execute(
        "SELECT server, osm_uid, to_char(since_month, 'YYYY-MM'), consent_day::text,"
        " token IS NOT NULL, last_error FROM osm_write WHERE account_id = %s",
        (who.id,),
    ).fetchone()
    rows = conn.execute(EXPORT_SQL, (who.id,)).fetchall()
    expires = [r[0].isoformat() for r in conn.execute(
        "SELECT expires_on FROM sessions WHERE account_id = %s ORDER BY expires_on",
        (who.id,))]  # fmt: skip
    points = my_points_by_month(conn, who)
    journal_rows = conn.execute(
        "SELECT seq, day::text, actor, action, target, detail, actor_id = %s"
        " FROM admin_log WHERE actor_id = %s OR target_account = %s ORDER BY seq",
        (who.id, who.id, who.id),
    ).fetchall()
    # Her own gestures without the pseudonym of whom they were about (another account's).
    keys = ("seq", "day", "actor", "action", "target", "detail")
    lines = [dict(zip(keys, r[:6], strict=True)) if r[6] else {"day": r[1], "action": r[3]}
             for r in journal_rows]  # fmt: skip
    # Where each contribution stands, the word « Mes caméras » shows (collection_state), from
    # its publications on the servers that section counts.
    servers = counted_servers()
    contributions = [dict(zip(EXPORT_KEYS, r, strict=True)) for r in rows]
    for c in contributions:
        gone = any(p["server"] in servers and published(p) for p in c["osm"])
        c["state"] = collection_state(c["kind"], c["answer"], c["status"], gone)
    data = {
        "exported_on": date.today().isoformat(),
        "account": {
            "pseudonym": who.pseudonym,
            "since": who.created_month.strftime("%Y-%m"),
            "role": who.role,
            "password": who.password,
            "osm": {"linked": osm_id is not None, "id": osm_id, "server": osm_on},
            "leaderboard": who.leaderboard,
            # Her pseudonym on the public history of the cameras she surveyed (024).
            "history_pseudonym": who.history_pseudonym,
            "test": who.test,
            # Her choice to publish on OSM (migrations 016, 022): on while OSM accepts her
            # token; the day she chose it (her consent), the last refusal's class.
            "publish": {
                "on": bool(write and write[4]),
                "server": write[0] if write else None,
                "osm_id": write[1] if write else None,
                "since": write[2] if write else None,
                "consent_day": write[3] if write else None,
                "last_error": write[5] if write else None,
            },  # fmt: skip
        },
        "contributions": contributions,
        # « Mes caméras »' labels (lot U), as GET /api/me/contributions gives them.
        "cameras": labels(conn, sorted({c["camera"] for c in contributions})),
        "points": points,
        "sessions": {"count": len(expires), "expires_on": expires},
        "journal": lines,
    }
    return data


def export_response(data: dict, filename: str) -> Response:
    body = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False)
    return Response(body, media_type="application/json", headers={
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
    })  # fmt: skip


Period = Annotated[str | None, Query(pattern=r"^(all|\d{4}-(0[1-9]|1[0-2]))$")]


@app.get("/api/me/score")
def my_score(who: Annotated[Account, Depends(author)], period: Period = None):
    """The person's points for a month (YYYY-MM, the current one by default) or `all`, by
    kind, with what waits for review (rules/leaderboard.yaml, lacarte.api.leaderboard)."""
    with pool.connection() as conn:
        return leaderboard.score(conn, who, period or leaderboard.this_month())


@app.get("/api/me/points")
def my_points(
    who: Annotated[Account, Depends(author)],
    uuid: Annotated[list[str], Query(max_length=50)] = [],  # noqa: B006 — FastAPI's default
):
    """The points these contributions of the caller's earn, by the leaderboard's own count
    (lacarte.api.leaderboard.sent): what the send's tickets show (8a)."""
    asked = [v4(u) for u in uuid]
    with pool.connection() as conn:
        return leaderboard.sent(conn, who, asked)


@app.get("/api/leaderboard")
def leaderboard_rows(
    who: Annotated[Account, Depends(author)],
    period: Period = None,
    kind: Literal[leaderboard.KINDS] = "total",
):
    """The top of the opted-in accounts for a period and a kind of points, with the
    caller's own row when it is outside (lacarte.api.leaderboard.board)."""
    with pool.connection() as conn:
        return leaderboard.board(conn, who, period or leaderboard.this_month(), kind)


# --- sign in with OpenStreetMap (migration 015, lacarte.api.osm) -------------------------


def osm_server() -> osm.Server | None:
    """The live server, when the API has its client id and secret (and its own origin, the
    redirect URI's); None: sign-in with OSM is off."""
    if not (settings.osm_client_id and settings.osm_client_secret and settings.origin):
        return None
    return osm.Server(settings.osm_url, settings.osm_client_id, settings.osm_client_secret,
                      settings.origin + "/api/osm/callback",
                      settings.osm_login_server)  # fmt: skip


def dev_write_server() -> osm.Server | None:
    """The deploy's write server (Settings.write_settings: OSM's test server), when its
    client, the key and the API's own origin (the redirect URI's) are there."""
    s = settings
    if not (s.osm_write_server and s.osm_write_url and s.osm_write_client_id
            and s.osm_write_client_secret and s.osm_token_key and s.origin):  # fmt: skip
        return None
    return osm.Server(s.osm_write_url, s.osm_write_client_id, s.osm_write_client_secret,
                      s.origin + "/api/osm/callback", s.osm_write_server)  # fmt: skip


def live_write_server() -> osm.Server | None:
    """OSM's live server to write to, when its client, the key and the API's origin are
    there (whether /revue switched writing to it is another matter: write_server)."""
    s = settings
    if not (s.osm_live_write_url and s.osm_live_write_client_id
            and s.osm_live_write_client_secret and s.osm_token_key and s.origin):  # fmt: skip
        return None
    return osm.Server(s.osm_live_write_url, s.osm_live_write_client_id,
                      s.osm_live_write_client_secret, s.origin + "/api/osm/callback",
                      "live")  # fmt: skip


def write_server(live: bool | None = None) -> osm.Server | None:
    """The server people publish on: the live one while /revue's osm_write_live is on
    (`live`, else the switch as read now), else the deploy's (the test server). None:
    writing is off (every /api/osm/sync route answers 503, the job does nothing)."""
    if live is None:
        live = switches.get()["osm_write_live"]
    return live_write_server() if live else dev_write_server()


def server_named(name: str) -> osm.Server | None:
    """The configured server a kept token was issued by (`dev` or `live`), whichever one
    writing goes to now: a token is revoked where it came from."""
    for server in (dev_write_server(), live_write_server()):
        if server is not None and server.name == name:
            return server
    return None


def publish_server(live: bool | None = None) -> osm.Server | None:
    """The write server when publishing is offered: the live one once /revue switched to
    it, or either while people sign in on OSM's test server (the preview). Signed in on the
    live server with the test server to write to: not offered (a public has nothing to
    publish on a test server); the code stays. None: the /api/osm/sync routes answer 503
    and the job calls nobody."""
    server = write_server(live)
    if server is None or not (server.name == "live" or settings.osm_login_server == "dev"):
        return None
    return server


def osm_unavailable() -> JSONResponse:
    return JSONResponse({"error": "osm_unavailable"}, status_code=503)


def go(url: str) -> RedirectResponse:
    """A 302 to a path of this site, never stored by a cache (it may carry a cookie)."""
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})


def set_signup_cookie(response: Response, key: str) -> None:
    """The waiting sign-up's key, 10 minutes. SameSite=Lax, not Strict: it is set on the
    callback, the end of a navigation that came from openstreetmap.org, and must reach GET
    and POST /api/osm/signup, which our own page sends once it has loaded; Lax reaches
    them as Strict would, and is also kept by a browser that counts the first requests of
    a page reached through a cross-site redirect as cross-site. It grants nothing a
    cross-site page could use: Lax is not sent on a cross-site POST, the POST checks our
    Origin (guard), and the GET answers only to the browser that holds it. HttpOnly;
    Secure and __Host- outside the local test servers, as the session cookie."""
    response.set_cookie(
        settings.signup_cookie_name, key, max_age=osm.TTL_S, path="/",
        secure=settings.cookie_secure, httponly=True, samesite="lax",
    )  # fmt: skip


def set_flow_cookie(response: Response, secret: str) -> None:
    """The browser that starts a sign-in or a link keeps its flow's secret, 10 minutes.
    SameSite=Lax: it must come back on the top-level navigation from openstreetmap.org to
    the callback (Lax is sent on a cross-site top-level GET; Strict is not)."""
    response.set_cookie(
        settings.flow_cookie_name, secret, max_age=osm.TTL_S, path="/",
        secure=settings.cookie_secure, httponly=True, samesite="lax",
    )  # fmt: skip


def clear_flow_cookie(response: Response) -> None:
    response.delete_cookie(settings.flow_cookie_name, path="/", secure=settings.cookie_secure,
                           httponly=True, samesite="lax")  # fmt: skip


def started(url_and_secret: tuple[str, str]) -> RedirectResponse:
    url, secret = url_and_secret
    response = go(url)
    set_flow_cookie(response, secret)
    return response


def clear_signup_cookie(response: Response) -> None:
    response.delete_cookie(settings.signup_cookie_name, path="/", secure=settings.cookie_secure,
                           httponly=True, samesite="lax")  # fmt: skip


@app.get("/api/osm/status")
def osm_status():
    """Whether « Entrer avec OpenStreetMap » is offered (no session needed), and whether
    publishing is (`write`), on which server, at which address (a changeset's link);
    neither while contributions are closed."""
    # `server`: « serveur de test OSM » is said on the key while it is the test server.
    contributions = switches.get()["contributions_open"]
    writer = publish_server() if contributions else None
    return {"login": contributions and osm_server() is not None,
            "server": settings.osm_login_server,
            "write": writer is not None, "write_server": writer.name if writer else None,
            "write_url": writer.url if writer else None}  # fmt: skip


@app.get("/api/osm/login")
def osm_login(then: str = ""):
    """To OSM's authorization page (scope openid, state, nonce, PKCE S256); back on the
    callback, then to `then` (a path of this site, else /?ui=punk)."""
    server = osm_server()
    if server is None:
        return osm_unavailable()
    return started(osm.start(server, "login", then))


class LinkIn(BaseModel):
    password: str = Field(max_length=auth.PASSWORD_MAX)
    then: str = Field(default="", max_length=osm.THEN_MAX)


@app.post("/api/osm/link")
async def osm_link(body: LinkIn, who: Annotated[Account, Depends(author)]):
    """Signed in, the password asked again (with the sign-in's delay): a session alone,
    stolen, must not attach its thief's OSM user for a way back in. Answers the URL of OSM's
    page, which the page opens, and sets the flow cookie; the OSM user is linked to this
    account on the callback. 409 no_password: an account without one is an OSM account,
    linked already."""
    server = osm_server()
    if server is None:
        return osm_unavailable()
    if not who.password:
        return JSONResponse({"error": "no_password"}, status_code=409)
    if not await throttled(who.pseudonym.lower(),
                           lambda: password_matches(who.id, body.password)):  # fmt: skip
        return credentials_refused()
    url, secret = osm.start(server, "link", body.then, who.id)
    response = JSONResponse({"url": url})
    set_flow_cookie(response, secret)
    return response


@app.get("/api/osm/callback")
def osm_callback(request: Request, state: str = "", code: str = "", error: str = ""):
    """The answer, its flow cookie cleared whatever happened."""
    response = callback_answer(request, state, code, error)
    clear_flow_cookie(response)
    return response


def callback_answer(request: Request, state: str, code: str, error: str) -> Response:
    """OSM sends the person back here (the flow is found by `state`, single use). A sign-in
    opens a session or starts a sign-up; a link links; a write keeps the token
    (enable_write). Always a 302 to the flow's `then` with osm=signed | signup | linked |
    link_taken | link_other | denied | failed, or for a write write_on | write_other |
    write_failed | denied. A first sign-in while sign-ups are closed (as GET /api/config's
    `signups` says: contributions and sign-ups both open) comes back with signups_closed
    at once, rather than meet a 403 on /api/osm/signup."""
    if osm_server() is None and write_server() is None:
        return osm_unavailable()
    flow = osm.flows.take(state) if 0 < len(state) <= 128 else None
    if flow is None:  # unknown, used, expired, or lost at a restart
        return go(osm.with_status(osm.DEFAULT_THEN, "failed", osm.FLOW_UNKNOWN))
    failed = "write_failed" if flow.kind == "write" else "failed"
    # A write on the write server it started on, a sign-in or a link on the login server.
    server = write_server() if flow.kind == "write" else osm_server()
    if server is None or (flow.kind == "write" and server.name != flow.server):
        return go(osm.with_status(flow.then, failed, osm.FLOW_SERVER))
    # Only in the browser that started it (its flow cookie): a callback URL opened
    # elsewhere is spent and refused, before the code is exchanged.
    held = request.cookies.get(settings.flow_cookie_name, "")
    if not (held and hmac.compare_digest(held, flow.browser)):
        return go(osm.with_status(flow.then, failed, osm.BROWSER))
    if error == "access_denied":  # the person said no on OSM's page
        return go(osm.with_status(flow.then, "denied"))
    if error or not code or len(code) > 1024:  # any other error is ours or OSM's
        return go(osm.with_status(flow.then, failed, osm.OSM_ERROR))
    if flow.kind == "write":
        return go(osm.with_status(flow.then, *enable_write(server, code, flow)))
    try:
        sub, osm_name = osm.complete(server, code, flow)
    except Exception as exc:  # noqa: BLE001
        log.warning("osm callback refused: %s", osm.cause(exc))
        why = exc.reason if isinstance(exc, osm.Refused) else osm.EXCHANGE_REFUSED
        return go(osm.with_status(flow.then, "failed", why))
    if flow.kind == "link":
        linked = link_osm(flow.account, sub, server.name)
        why = osm.ACCOUNT if linked == "failed" else None
        return go(osm.with_status(flow.then, linked, why))
    with pool.connection() as conn:
        row = conn.execute("SELECT id::text, disabled FROM accounts WHERE osm_id = %s"
                           " AND osm_server = %s", (sub, server.name)).fetchone()  # fmt: skip
    if row is None:  # a first visit: the person chooses a pseudonym (GET/POST signup)
        open_ = switches.get()
        if not (open_["contributions_open"] and open_["signups_open"]):
            return go(osm.with_status(flow.then, "signups_closed"))
        key = secrets.token_urlsafe(32)
        osm.signups.put(key, osm.Signup(sub, osm_name, flow.then))
        response = go(osm.with_status(flow.then, "signup"))
        set_signup_cookie(response, key)
        return response
    if row[1]:  # a disabled account
        return go(osm.with_status(flow.then, "failed", osm.ACCOUNT))
    with pool.connection() as conn, conn.transaction():
        token = open_session(conn, row[0])
    response = go(osm.with_status(flow.then, "signed"))
    set_session_cookie(response, token)  # as POST /api/session sets it
    return response


def link_osm(account_id: str | None, sub: int, server: str) -> str:
    """The OSM user `sub` linked to the account: linked (also when it already was),
    link_taken (another account has it), link_other (this one has another), failed (the
    account is gone, disabled, or a placeholder now)."""
    with pool.connection() as conn, conn.transaction():
        row = conn.execute(
            f"SELECT a.osm_id, a.disabled, a.osm_server FROM accounts a WHERE a.id = %s"
            f" AND {auth.CLAIMED}",
            (account_id,),
        ).fetchone()
        if row is None or row[1]:
            return "failed"
        if row[0] is not None:
            return "linked" if (row[0], row[2]) == (sub, server) else "link_other"
        if conn.execute("SELECT 1 FROM accounts WHERE osm_id = %s AND osm_server = %s",
                        (sub, server)).fetchone():  # fmt: skip
            return "link_taken"
        try:
            with conn.transaction():
                done = conn.execute("UPDATE accounts SET osm_id = %s, osm_server = %s"
                                    " WHERE id = %s AND osm_id IS NULL",
                                    (sub, server, account_id)).rowcount  # fmt: skip
        except pg_errors.UniqueViolation:  # linked elsewhere meanwhile
            return "link_taken"
    return "linked" if done else "link_other"


def waiting_signup(request: Request) -> tuple[str, osm.Signup] | None:
    key = request.cookies.get(settings.signup_cookie_name, "")
    signup = osm.signups.get(key) if 0 < len(key) <= 64 else None
    return (key, signup) if signup else None


def signup_expired() -> JSONResponse:
    return JSONResponse({"error": "signup_expired"}, status_code=401)


def pseudonym_taken(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM accounts WHERE lower(pseudonym) = lower(%s)",
                        (name,)).fetchone() is not None  # fmt: skip


@app.get("/api/osm/signup")
def osm_signup_offer(request: Request):
    """The waiting sign-up (its cookie): the suggested pseudonym, free now, and the OSM
    name it comes from."""
    if osm_server() is None:
        return osm_unavailable()
    waiting = waiting_signup(request)
    if waiting is None:
        return signup_expired()
    signup = waiting[1]
    with pool.connection() as conn:
        suggestion = osm.suggest(signup.osm_name, signup.sub, lambda n: pseudonym_taken(conn, n))
    return {"suggestion": suggestion, "osm_name": signup.osm_name}


class SignupIn(BaseModel):
    pseudonym: str = Field(max_length=64)


@app.post("/api/osm/signup")
def osm_signup(body: SignupIn, request: Request):
    """The account created with the pseudonym the person chose (no password, osm_id the OSM
    user), a session opened, the sign-up done; 409 when the pseudonym is someone's (try
    another) or the OSM user got linked meanwhile (the sign-up is over)."""
    server = osm_server()
    if server is None:
        return osm_unavailable()
    waiting = waiting_signup(request)
    if waiting is None:
        return signup_expired()
    key, signup = waiting
    if not auth.PSEUDONYM_RE.fullmatch(body.pseudonym):
        return JSONResponse({"error": "pseudonym_invalid"}, status_code=400)
    try:
        with pool.connection() as conn, conn.transaction():
            account_id = conn.execute(
                "INSERT INTO accounts (pseudonym, created_month, osm_id, osm_server)"
                " VALUES (%s, %s, %s, %s) RETURNING id::text",
                (body.pseudonym, date.today().replace(day=1), signup.sub, server.name),
            ).fetchone()[0]
            token = open_session(conn, account_id)
    except pg_errors.UniqueViolation as exc:
        if exc.diag.constraint_name == "accounts_osm_id_key":
            osm.signups.take(key)
            return JSONResponse({"error": "osm_taken"}, status_code=409)
        return JSONResponse({"error": "pseudonym_taken"}, status_code=409)
    osm.signups.take(key)
    response = Response(status_code=204)
    set_session_cookie(response, token)
    clear_signup_cookie(response)
    return response


@app.post("/api/osm/unlink")
def osm_unlink(who: Annotated[Account, Depends(author)]):
    """The OSM user unlinked, when the account has a password to sign in with; 409
    no_password otherwise (it would be locked out)."""
    if osm_server() is None:
        return osm_unavailable()
    with pool.connection() as conn:
        done = conn.execute("UPDATE accounts SET osm_id = NULL, osm_server = NULL WHERE id = %s"
                            " AND password_hash IS NOT NULL", (who.id,)).rowcount  # fmt: skip
    if not done:
        return JSONResponse({"error": "no_password"}, status_code=409)
    return Response(status_code=204)


# --- publish to OpenStreetMap (migration 016, lacarte.api.publish) -------------------------


def publishing(conn, account_id: str, server: str) -> bool:
    """Whether the account's choice to publish on `server` is on (an osm_write row there
    with a token: OSM did not refuse it)."""
    row = conn.execute("SELECT 1 FROM osm_write WHERE account_id = %s AND server = %s"
                       " AND token IS NOT NULL", (account_id, server)).fetchone()  # fmt: skip
    return row is not None


def revoke_sealed(account_id: str, server_name: str, sealed: bytes | None) -> None:
    """Best effort: a kept write token revoked at OSM, when the API still knows the server
    that issued it and can open it (else it stays valid at OSM until the person revokes it
    in her OSM settings: said by class in the log). None: OSM refused it already."""
    if sealed is None:
        return
    server = server_named(server_name)
    if server is None:
        log.warning("osm revoke skipped: %s", "server")
        return
    try:
        token = publish.unseal(settings.osm_token_key, account_id, server_name, sealed)
    except Exception as exc:  # noqa: BLE001
        log.warning("osm revoke skipped: %s", type(exc).__name__)
        return
    osm.revoke(server, token)


def drop_write(account_id: str) -> bool:
    """The account's write token deleted, then revoked at OSM (best effort): whether there
    was one."""
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM osm_write WHERE account_id = %s RETURNING server, token",
                           (account_id,)).fetchone()  # fmt: skip
    if row is not None:
        revoke_sealed(account_id, *row)
    return row is not None


def enable_write(server: osm.Server, code: str, flow: osm.Flow) -> tuple[str, str | None]:
    """A write flow's callback: the token kept, sealed (write_on), unless OSM did not grant
    write_api or the id_token does not hold (write_failed), the account is gone, disabled
    or a test account (write_failed), or it is linked to another OSM user on this server
    (write_other) — the token then revoked. A token it replaces is revoked. With the
    failure's reason (osm_why)."""
    try:
        sub, token = osm.complete_write(server, code, flow)
    except Exception as exc:  # noqa: BLE001
        log.warning("osm write callback refused: %s", osm.cause(exc))
        return "write_failed", exc.reason if isinstance(exc, osm.Refused) else osm.RIGHTS
    old = None
    try:
        status, old = keep_write(server, flow, sub, token)
    except Exception as exc:  # noqa: BLE001
        # The token is OSM's and valid: never left behind unknown to us.
        log.warning("osm write token not kept: %s", type(exc).__name__)
        status = "write_failed"
    if status != "write_on":
        osm.revoke(server, token)
    elif old is not None:
        revoke_sealed(flow.account, *old)
    return status, osm.ACCOUNT if status == "write_failed" else None


def keep_write(server: osm.Server, flow: osm.Flow, sub: int,
               token: str) -> tuple[str, tuple | None]:  # fmt: skip
    """enable_write's transaction: (status, the token it replaces)."""
    old = None
    with pool.connection() as conn, conn.transaction():
        row = conn.execute(
            f"SELECT a.osm_id, a.osm_server, a.disabled OR a.test OR NOT {auth.CLAIMED}"
            " FROM accounts a WHERE a.id = %s",
            (flow.account,),
        ).fetchone()
        if row is None or row[2]:
            status = "write_failed"
        elif row[1] == server.name and row[0] != sub:
            status = "write_other"
        else:
            old = conn.execute("SELECT server, token FROM osm_write WHERE account_id = %s",
                               (flow.account,)).fetchone()  # fmt: skip
            # A new choice (none, another server's, or one OSM refused the token of) starts
            # a new consent day; renewing a token she still has keeps hers (rules/
            # publish.yaml consent). The refusals are forgotten.
            conn.execute(
                "INSERT INTO osm_write (account_id, server, osm_uid, token, since_month,"
                " consent_day) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (account_id) DO"
                " UPDATE SET consent_day = CASE WHEN osm_write.server = EXCLUDED.server AND"
                " osm_write.token IS NOT NULL THEN osm_write.consent_day ELSE"
                " EXCLUDED.consent_day END, since_month = CASE WHEN osm_write.server ="
                " EXCLUDED.server AND osm_write.token IS NOT NULL THEN osm_write.since_month"
                " ELSE EXCLUDED.since_month END, sent_day = CASE WHEN osm_write.server ="
                " EXCLUDED.server THEN osm_write.sent_day END, sent_n = CASE WHEN"
                " osm_write.server = EXCLUDED.server THEN osm_write.sent_n ELSE 0 END,"
                " server = EXCLUDED.server, osm_uid = EXCLUDED.osm_uid, token = EXCLUDED.token,"
                " failures = 0, last_error = NULL",
                (flow.account, server.name, sub,
                 publish.seal(settings.osm_token_key, flow.account, server.name, token),
                 date.today().replace(day=1), date.today()),
            )  # fmt: skip
            status = "write_on"
    return status, old


class SyncIn(BaseModel):
    on: bool
    password: str | None = Field(default=None, max_length=auth.PASSWORD_MAX)
    then: str = Field(default="", max_length=osm.THEN_MAX)


def sync_state(conn, account_id: str, server: osm.Server | None) -> dict:
    """The person's choice on the offered write server: on (a token), since (the consent
    day's month), last_error (revoked when OSM refused the token: the choice is then off),
    and her consent day (internal)."""
    row = None
    if server is not None:
        row = conn.execute("SELECT token IS NOT NULL, consent_day, last_error FROM osm_write"
                           " WHERE account_id = %s AND server = %s",
                           (account_id, server.name)).fetchone()  # fmt: skip
    on = bool(row and row[0])
    return {"on": on, "since": row[1].strftime("%Y-%m") if on else None,
            "last_error": row[2] if row else None, "consent": row[1] if on else None}  # fmt: skip


def sync_answer(conn, who: Account) -> dict:
    """GET /api/osm/sync's answer (and POST's)."""
    server = publish_server()
    state = sync_state(conn, who.id, server)
    consent = state.pop("consent")
    history = publish.history(conn, who.id, server.name, consent) if server else []
    names = labels(conn, sorted({h["camera"] for h in history}))
    return {
        "offered": server is not None,
        "server": server.name if server else None,
        "url": server.url if server else None,
        "suspended": not switches.get()["osm_sync"],
        **state,
        "history": [{**h, "label": names[h["camera"]]} for h in history],
    }  # fmt: skip


@app.get("/api/osm/sync")
def osm_sync(who: Annotated[Account, Depends(author)]):
    """« Compte »'s OSM setting: whether publishing is offered (and on which server, at
    which address: a changeset's link is <url>/changeset/<n>), whether the team suspended
    the synchronisation, whether her choice is on and since which month, the class of the
    last refusal (revoked: she must authorise again; blocked: OSM blocked her account;
    rate_limited, osm_down: it will try again), and what became of her contributions there
    (publish.history). Never her OSM id, a token, a day."""
    with pool.connection() as conn:
        return sync_answer(conn, who)


def stopped_answer(who: Account) -> dict:
    """GET /api/osm/sync's answer, once « Rester » took effect (off the event loop)."""
    with pool.connection() as conn:
        return sync_answer(conn, who)


@app.post("/api/osm/sync")
async def osm_sync_set(body: SyncIn, who: Annotated[Account, Depends(author)]):
    """« Publier aussi sur OpenStreetMap en mon nom » (on: true): the choice is the consent
    (its day kept when the callback keeps the token); a pass through OSM with the scope
    openid write_api, on the write server; the password asked again when the account has
    one (a stolen session must not attach its thief's OSM user); never a test account;
    not while contributions are closed. Answers OSM's URL, which the page opens, and sets
    the flow cookie. « Rester sur Surveillance World » (on: false): the token revoked at
    OSM (best effort) and deleted, nothing more leaves; what was published stays. Always
    possible, offered or not, closed or not; answers as GET."""
    if not body.on:
        await run_in_threadpool(drop_write, who.id)
        return await run_in_threadpool(stopped_answer, who)
    server = publish_server()
    if server is None:
        return osm_unavailable()
    if who.test:
        return JSONResponse({"error": "test_account"}, status_code=409)
    if not (await site_switches())["contributions_open"]:
        return JSONResponse({"error": "closed"}, status_code=403)
    if who.password and not await throttled(
        who.pseudonym.lower(), lambda: password_matches(who.id, body.password or "")
    ):
        return credentials_refused()
    url, secret = osm.start(server, "write", body.then, who.id, publish.WRITE_SCOPE)
    response = JSONResponse({"url": url})
    set_flow_cookie(response, secret)
    return response


# --- the privileged entry (lot 2 « Administrer ») -----------------------------------------

# Refusals in a row at the privileged entry and the reauthentication, per existing reviewer
# or administrator account (in memory): the third writes one `signin_refused` line, none
# more until a success. Never by address, never for an unknown pseudonym.
REFUSALS_LOGGED = 3
_refusals: dict[str, int] = {}
_refusals_lock = threading.Lock()


def privileged_refused(account_id: str, pseudonym: str) -> None:
    with _refusals_lock:
        n = _refusals[account_id] = _refusals.get(account_id, 0) + 1
    if n == REFUSALS_LOGGED:
        with pool.connection() as conn:
            journal(conn, None, "signin_refused", account=account_id, name=pseudonym)


def privileged_accepted(account_id: str) -> None:
    with _refusals_lock:
        _refusals.pop(account_id, None)


def journal(conn, who: Account | None, action: str, *, account: str | None = None,
            name: str | None = None, target: str | None = None,
            detail: dict | None = None) -> None:  # fmt: skip
    """One line of the journal (migration 020): who acted (none: '' — a refused sign-in),
    the action, the account it was about and its pseudonym, the camera, contribution or
    setting, and a detail the API composes (statuses, counts, ids; never a person's text)."""
    conn.execute(
        "INSERT INTO admin_log (actor_id, actor, action, target_account, target_name, target,"
        " detail) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (who.id if who else None, who.pseudonym if who else "", action, account, name, target,
         Jsonb(detail) if detail is not None else None),
    )  # fmt: skip


def review_rules() -> dict:
    return participation.rules()["review"]


def privileged_sign_in(pseudonym: str, password: str) -> str | None:
    """sign_in for a reviewer or an administrator only: a new session marked privileged
    for review.privileged_hours, or None — every other account and every failure alike."""
    with pool.connection() as conn:
        account_id, stored, role = auth.login_account(conn, pseudonym)
    ok = auth.verify(stored, password)
    if role not in auth.PRIVILEGED:
        return None
    if not ok:
        privileged_refused(account_id, pseudonym)
        return None
    privileged_accepted(account_id)
    with pool.connection() as conn, conn.transaction():
        token = open_session(conn, account_id)
    hours = review_rules()["privileged_hours"]
    auth.privileged.put(auth.digest(token), account_id, hours * 3600)
    return token


@app.post("/api/review/session")
async def review_login(body: LoginIn):
    """The privileged entry (behind /revue's own gate): a reviewer or an administrator with
    a password signs in; 204 and the session cookie (as /api/session's), the session
    marked privileged. Anything else: 401 credentials after the pseudonym's delay, the
    same answer as /api/session's."""
    token = await throttled(body.pseudonym.lower(),
                            lambda: privileged_sign_in(body.pseudonym, body.password))  # fmt: skip
    if token is None:
        return credentials_refused()
    response = Response(status_code=204)
    set_session_cookie(response, token)
    return response


@app.get("/api/review/me")
def review_me(request: Request, who: Annotated[Account, Depends(staff)]):
    """Who is in /revue: the pseudonym, the role (the page's tabs follow it), and whether the
    password was given again recently (an administrator's destructive actions need it)."""
    token = session_token(request) or ""
    return {"pseudonym": who.pseudonym, "role": who.role,
            "reauth": auth.reauthed.has(auth.digest(token))}  # fmt: skip


class ReauthIn(BaseModel):
    password: str = Field(max_length=auth.PASSWORD_MAX)


@app.post("/api/review/reauth")
async def review_reauth(body: ReauthIn, request: Request,
                        who: Annotated[Account, Depends(staff)]):  # fmt: skip
    """« Confirmez avec votre mot de passe »: the password again (with the sign-in's delay);
    the session may then take the destructive administrator actions for
    review.reauth_minutes. 204, or 401 credentials."""

    def check() -> bool:
        if password_matches(who.id, body.password):
            privileged_accepted(who.id)
            return True
        privileged_refused(who.id, who.pseudonym)
        return False

    if not await throttled(who.pseudonym.lower(), check):
        return credentials_refused()
    token = session_token(request) or ""
    auth.reauthed.put(auth.digest(token), who.id, review_rules()["reauth_minutes"] * 60)
    return Response(status_code=204)


# --- review ------------------------------------------------------------------------------

# An account's pseudonym, NULL once it is deleted (its contributions stay without author).
PSEUDONYM_OF = "(SELECT pseudonym FROM accounts WHERE id = {})"
# A test account's contribution (migration 014, accounts.test, set from TEST_AUTHORS):
# stored, shown as proposals, marked "test" in /revue, out of its summary and of the
# leaderboard, never exported.
IS_TEST = "coalesce((SELECT test FROM accounts WHERE id = author_id), false)"
# What became of it on OpenStreetMap (migration 016): the most recent publication row, so
# that /revue can say a publication conflict; null when it never went.
OSM_PUBLISH = (
    "(SELECT json_build_object('server', p.server, 'state', p.state, 'reason', p.reason,"
    " 'changeset', p.changeset, 'month', to_char(p.month, 'YYYY-MM'))"
    " FROM osm_publications p WHERE p.uuid = contributions.uuid"
    " ORDER BY p.month DESC, p.server = 'live' DESC LIMIT 1)"
)
REVIEW_COLUMNS = (
    "uuid::text, kind, camera_id, osm_type, osm_id, osm_version, build_id,"
    f" {PSEUDONYM_OF.format('author_id')}, day::text, on_site, status, answer,"
    f" target::text, {PSEUDONYM_OF.format('decided_by_id')}, decided_on::text,"
    " ST_X(ST_Transform(geom, 4326)), ST_Y(ST_Transform(geom, 4326)), payload, apply_build,"
    f" apply_detail, direction_deg, operator_name, osm_tags, batch::text,"
    f" operator_proposed, operator_choice, {OSM_PUBLISH}, {IS_TEST}, dome_count"
)
REVIEW_KEYS = (
    "uuid", "kind", "camera", "osm_type", "osm_id", "osm_version", "build_id", "author",
    "day", "on_site", "status", "answer", "target", "decided_by",
    "decided_on", "lon", "lat", "payload", "apply_build", "apply_detail", "direction",
    "operator_name", "osm_tags", "batch", "operator_proposed", "operator_choice",
    "osm_publish", "test", "dome_count",
)  # fmt: skip
D2 = confirm.D2_KINDS  # "Compléter": shape, direction, operator, height, tilt
# "Je ne sais pas" / "Je ne vois pas" of a D2 question, in SQL.
BLANK_SQL = (
    "(kind IN (" + ", ".join(f"'{k}'" for k in D2) + ")"
    " AND coalesce(answer, '') IN ('unknown', 'not_visible'))"
)
OPINIONS = ("agree", "disagree")
# Statuses of a proposal still open to opinions and shown on the map: not yet applied by a
# build, not rejected (applied, superseded and conflict are written by the deploy).
OPEN = ("pending", "validated")
# Statuses after which nothing is said of a contribution any more: rejected by the review,
# withdrawn by its author (migration 008).
CLOSED = confirm.CLOSED
STATUSES = (
    "pending", "validated", "rejected", "applied", "superseded", "conflict", "withdrawn",
)  # fmt: skip


def review_rows(conn, kind=None, status=None, who=None, day_from=None, day_to=None,
                opinions=True, camera=None, withdrawn=False):  # fmt: skip
    where, args = ["true"], []
    if not withdrawn and status != "withdrawn":
        # Withdrawn by their author: under their own filter only (the CSV keeps them).
        where.append("status <> 'withdrawn'")
    if not opinions and not kind:
        where.append("kind NOT IN ('agree', 'disagree')")
    if not opinions:
        # "Je ne sais pas" / "Je ne vois pas" change nothing and wait for no decision: out of
        # the list (the camera's window and the CSV keep them).
        where.append(f"NOT {BLANK_SQL}")
    for column, value in (("kind", kind), ("status", status), ("camera_id", camera)):
        if value:
            where.append(f"{column} = %s")
            args.append(value)
    if who:
        where.append("author_id = (SELECT id FROM accounts WHERE lower(pseudonym) = lower(%s))")
        args.append(who)
    if day_from:
        where.append("day >= %s")
        args.append(day_from)
    if day_to:
        where.append("day <= %s")
        args.append(day_to)
    rows = conn.execute(
        f"SELECT {REVIEW_COLUMNS} FROM contributions WHERE {' AND '.join(where)}"
        " ORDER BY day DESC, camera_id, uuid",
        args,
    ).fetchall()
    out = [dict(zip(REVIEW_KEYS, r, strict=True)) for r in rows]
    counts = agreement_counts(conn, sorted({r["camera"] for r in out}))
    for r in out:
        r["agree"], r["disagree"] = counts.get(r["uuid"], (None, None))
    return out


KINDS = ("verify", "move", "agree", "disagree", "add", *D2)


@app.get("/api/review/contributions")
def review_list(
    request: Request,
    who: Annotated[Account, Depends(staff)],
    kind: Literal[KINDS] | None = None,
    status: Literal[STATUSES] | None = None,
    author: Annotated[str | None, Query(max_length=64)] = None,
    day_from: Annotated[date | None, Query(alias="from")] = None,
    day_to: Annotated[date | None, Query(alias="to")] = None,
    camera: Annotated[str | None, Query(max_length=32)] = None,
):
    """`camera`: one camera's (the sheet shows the review account its conflicts), for any
    reviewer. Without it, the whole list is the CSV's: an administrator's, within the
    reauthentication (403 admin, 403 reauth). An add comes with the cameras within
    review_near_m of it (`near`: id, kind, distance, and whether it is an add no build has
    applied yet); its facade distance is in its payload."""
    if camera is None:
        reauthed(request, admin(who))
    with pool.connection() as conn:
        # Opinions appear as counts on the proposals they are about, not as rows.
        rows = review_rows(conn, kind, status, author, day_from, day_to, opinions=False,
                           camera=camera)  # fmt: skip
        for r in rows:
            if r["kind"] == "add":
                r["near"] = cameras_near_add(conn, r["uuid"])
        authors = [r[0] for r in conn.execute(
            "SELECT pseudonym FROM accounts a"
            " WHERE EXISTS (SELECT FROM contributions WHERE author_id = a.id)")]  # fmt: skip
    return {"contributions": rows, "authors": sorted(authors)}


# --- the review queue (lot 1 « Modérer ») -------------------------------------------------

# What a decision is about: no opinion, no "Je ne sais pas" / "Je ne vois pas" (they wait
# for nothing).
DECIDABLE = f"kind NOT IN ('agree', 'disagree') AND NOT {BLANK_SQL}"
QUEUE_FILTERS = ("todo", "conflicts", "names", "osm", "all")
# A send's pieces in the order the phone asks them.
PIECE_ORDER = ("add", "verify", *BATCH_KINDS)
# Accepted: validated by the review, then applied by a build (or superseded since).
ACCEPTED = ("validated", "applied", "superseded")


def served_labels(conn, camera_ids: list[str]) -> dict[str, dict]:
    """The served build's row of each camera that has one: what its label and the queue's
    « before » values read."""
    keys = ("kind", "kind_certainty", "operator_class", "operator", "street", "commune",
            "directions", "direction_certainty", "height_m", "height_certainty", "tilt",
            "lon", "lat")  # fmt: skip
    return {r[0]: dict(zip(keys, r[1:], strict=True)) for r in conn.execute(
        "SELECT camera_id, kind, kind_certainty, operator_class, operator_norm, street, commune,"
        " directions, direction_certainty, height_m, height_certainty, tilt_deg,"
        " ST_X(ST_Transform(geom, 4326)), ST_Y(ST_Transform(geom, 4326))"
        " FROM cameras WHERE camera_id = ANY(%s)", (list(camera_ids),))}  # fmt: skip


def labels(conn, camera_ids: list[str], served: dict[str, dict] | None = None) -> dict[str, dict]:
    """How /revue names each camera: {add, built, kind, operator, operator_class, street,
    commune}. Built (in the served build): its row. Not built — an add no build has applied,
    or a camera that left the build — the street and commune of the nearest built camera
    (as for the commune before, migration 010); an add's kind from its shape answer and its
    operator class from its operator answer, both in the served build's words (the shape's
    kind, the answer's class: rules/questions.yaml), the name only when one was listed or
    chosen (add_answers: never a proposed name nobody chose)."""
    served = served_labels(conn, camera_ids) if served is None else served
    q = participation.questions()
    shapes = q["shape"]["kinds"]
    classes = {a: c["class"] for a, c in q["operator"]["classes"].items()}
    out = {}
    for cam in camera_ids:
        s = served.get(cam)
        out[cam] = {
            "add": participation.is_added(cam), "built": s is not None,
            "kind": s and s["kind"], "operator": s and s["operator"],
            "operator_class": s and s["operator_class"], "street": s and s["street"],
            "commune": s and s["commune"],
        }  # fmt: skip
    missing = [c for c in camera_ids if c not in served]
    if not missing:
        return out
    # Where an unbuilt camera stands: its add, else its oldest contribution.
    for cam, add_uuid, add_author, street, commune in conn.execute(
        "SELECT DISTINCT ON (c.camera_id) c.camera_id,"
        " CASE WHEN c.kind = 'add' THEN c.uuid::text END,"
        " CASE WHEN c.kind = 'add' THEN c.author_id::text END, k.street, k.commune"
        " FROM contributions c LEFT JOIN LATERAL (SELECT street, commune FROM cameras"
        "   ORDER BY cameras.geom <-> c.geom LIMIT 1) k ON true"
        " WHERE c.camera_id = ANY(%s) ORDER BY c.camera_id, c.kind = 'add' DESC, c.day, c.uuid",
        (missing,),
    ).fetchall():  # fmt: skip
        out[cam].update(street=street, commune=commune)
        if add_uuid is not None:
            kept = add_answers(conn, add_uuid, add_author)
            if "shape" in kept:
                out[cam]["kind"] = shapes.get(kept["shape"])
            if "operator" in kept:
                answer, out[cam]["operator"] = kept["operator"]
                out[cam]["operator_class"] = classes.get(answer)
    return out


def before_value(kind: str, s: dict | None):
    """What the map shows of the field a piece is about, in the served build's words, or
    None — not built, or only a generic assumption (certainty `default`): « inconnue ».
    move: [lon, lat]; shape: the kind; direction: degrees (a list: a mount may have
    several); height: metres; tilt: its class; operator: {class, name}; verify, add: None."""
    if s is None:
        return None
    if kind == "move":
        return [round(s["lon"], 7), round(s["lat"], 7)]
    if kind == "shape":
        return s["kind"] if s["kind_certainty"] != "default" else None
    if kind == "direction":
        known = s["direction_certainty"] != "default" and s["directions"]
        return [round(d) for d in s["directions"]] if known else None
    if kind == "height":
        return s["height_m"] if s["height_certainty"] != "default" else None
    if kind == "tilt":
        return participation.tilt_class(s["tilt"])
    if kind == "operator":
        known = s["operator_class"] not in (None, "unknown")
        return {"class": s["operator_class"], "name": s["operator"]} if known else None
    return None


def author_records(conn, author_ids: list[str]) -> dict[str, dict]:
    """{accepted, rejected} of each author: their decidable contributions, a « Modifier »
    send counted once (coalesce(batch, uuid))."""
    return {a: {"accepted": acc, "rejected": rej} for a, acc, rej in conn.execute(
        "SELECT author_id::text,"
        " count(DISTINCT coalesce(batch, uuid)) FILTER (WHERE status IN"
        f"   ({', '.join(repr(s) for s in ACCEPTED)})),"
        " count(DISTINCT coalesce(batch, uuid)) FILTER (WHERE status = 'rejected')"
        f" FROM contributions WHERE author_id = ANY(%s::uuid[]) AND {DECIDABLE}"
        " GROUP BY author_id", (list(author_ids),))}  # fmt: skip


def on_site_confirmed(conn, camera_ids: list[str]) -> dict[str, set[str]]:
    """uuid -> the other accounts confirming it on site (confirm.on_site_confirmers)."""
    rules = participation.rules()["confirm"]
    out: dict[str, set[str]] = {}
    for rows in camera_rows(conn, camera_ids).values():
        out.update(confirm.on_site_confirmers(rows, rules["move_within_m"],
                                              rules["direction_within_deg"]))  # fmt: skip
    return out


def in_filters(rows: list[dict]) -> dict[str, bool]:
    """Which filters a camera's live decidable rows put it in: todo (something waits),
    conflicts (a build's conflict), names (a proposed operator name waits for its choice),
    osm (a publication to OSM in conflict or uncertain, migration 022), all."""
    return {
        "todo": any(r["status"] == "pending" for r in rows),
        "conflicts": any(r["status"] == "conflict" for r in rows),
        "names": any(r["status"] == "pending" and r["operator_proposed"] is not None
                     and r["operator_choice"] is None for r in rows),
        "osm": any(r["osm"] is not None for r in rows),
        "all": bool(rows),
    }  # fmt: skip


QUEUE_KEYS = ("uuid", "camera", "kind", "status", "on_site", "day", "batch", "answer",
              "direction", "move_m", "operator_name", "operator_proposed", "operator_choice",
              "author_id", "pseudonym", "test", "osm")  # fmt: skip
# A publication to OSM that needs a look (migration 022): in conflict, or uncertain; the
# most recent one. {state, reason, server} or NULL.
OSM_TROUBLE = (
    "(SELECT json_build_object('state', p.state, 'reason', p.reason, 'server', p.server)"
    " FROM osm_publications p WHERE p.uuid = contributions.uuid"
    " AND p.state IN ('conflict', 'uncertain') ORDER BY p.month DESC, p.server = 'live' DESC"
    " LIMIT 1)"
)


def review_queue(conn, which: str = "todo", search: str | None = None) -> dict:
    """GET /api/review/queue: one item per camera with a live decidable contribution
    (withdrawn ones say nothing here), in the filter `which`, searched by `search`; and the
    summary of what waits, test accounts left out."""
    rows = [dict(zip(QUEUE_KEYS, r, strict=True)) for r in conn.execute(
        "SELECT uuid::text, camera_id, kind, status, on_site, day, batch::text, answer,"
        " direction_deg, (payload->>'move_m')::float, operator_name, operator_proposed,"
        f" operator_choice, author_id::text, {PSEUDONYM_OF.format('author_id')}, {IS_TEST},"
        f" {OSM_TROUBLE} FROM contributions WHERE {DECIDABLE} AND status <> 'withdrawn'"
    ).fetchall()]  # fmt: skip
    by_cam: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_cam[r["camera"]].append(r)
    today = date.today()
    real = [r for r in rows if not r["test"]]
    waiting = [r for r in real if r["status"] == "pending"]
    counts = {k: 0 for k in QUEUE_FILTERS if k != "all"}
    for rs in by_cam.values():
        member = in_filters([r for r in rs if not r["test"]])
        for k in counts:
            counts[k] += member[k]
    summary = {
        "pending": len({r["batch"] or r["uuid"] for r in waiting}),
        "oldest_days": (today - min(r["day"] for r in waiting)).days if waiting else None,
        "counts": counts,
    }
    chosen = sorted(c for c, rs in by_cam.items() if in_filters(rs)[which])
    served = served_labels(conn, chosen)
    names = labels(conn, chosen, served)
    if search:
        needle = search.lower()
        chosen = [c for c in chosen if any(
            needle in (v or "").lower() for v in (
                c, names[c]["street"], names[c]["commune"],
                *(r["pseudonym"] for r in by_cam[c])))]  # fmt: skip
    hidden = {r[0] for r in conn.execute("SELECT camera_id FROM hidden_cameras")}
    confirmed = on_site_confirmed(conn, chosen)
    items = []
    for cam in chosen:
        rs = sorted(by_cam[cam], key=lambda r: (r["day"], r["uuid"]))
        wait = [r for r in rs if r["status"] == "pending"]
        conflicts = [r for r in rs if r["status"] == "conflict"]
        # Under « OSM », the publications that need a look are pieces too.
        troubles = [r for r in rs if which == "osm" and r["osm"] is not None
                    and r not in wait and r not in conflicts]  # fmt: skip
        # Who and since when: the oldest waiting piece; else the oldest conflict; else
        # the latest contribution.
        first = wait[0] if wait else conflicts[0] if conflicts else rs[-1]
        member = in_filters(rs)
        # What waits, then what the build found in conflict (S2: a conflicts-only item
        # has its pieces too), each by day, send and the phone's order.
        pieces = sorted(wait + conflicts + troubles, key=lambda r: (
            r["status"] != "pending", r["day"], r["batch"] or r["uuid"],
            PIECE_ORDER.index(r["kind"])))  # fmt: skip
        items.append({
            "camera": cam,
            "label": names[cam],
            "pieces": [{
                "uuid": r["uuid"], "kind": r["kind"], "status": r["status"],
                "answer": r["answer"],
                "direction": r["direction"], "move_m": r["move_m"],
                "operator_name": r["operator_name"],
                "operator_proposed": r["operator_proposed"],
                "before": before_value(r["kind"], served.get(cam)), "batch": r["batch"],
                "osm": r["osm"],
            } for r in pieces],
            "conflict": member["conflicts"],
            "names": member["names"],
            "on_site": (True if any(r["on_site"] is True for r in wait)
                        else False if any(r["on_site"] is False for r in wait) else None),
            "confirmed": len(set().union(*(confirmed.get(r["uuid"], set()) for r in wait))),
            "author": {"pseudonym": first["pseudonym"], "id": first["author_id"]},
            "oldest_day": first["day"].isoformat(),
            "day": rs[-1]["day"].isoformat(),
            "test": all(r["test"] for r in rs),
            "hidden": cam in hidden,
            "_conflict_day": conflicts[0]["day"] if conflicts else None,
        })  # fmt: skip
    records = author_records(conn, sorted({i["author"]["id"] for i in items} - {None}))
    for i in items:
        aid = i["author"].pop("id")
        i["author"].update(records.get(aid, {"accepted": 0, "rejected": 0}))
    if which in ("todo", "names"):
        items.sort(key=lambda i: (i["confirmed"] == 0, i["oldest_day"], i["camera"]))
    elif which == "conflicts":
        items.sort(key=lambda i: (i["_conflict_day"], i["camera"]))
    elif which == "osm":
        items.sort(key=lambda i: i["camera"])
        items.sort(key=lambda i: i["day"], reverse=True)
    else:
        items.sort(key=lambda i: i["camera"])
        items.sort(key=lambda i: i["day"], reverse=True)
    for i in items:
        del i["_conflict_day"]
    return {"summary": summary, "items": items}


@app.get("/api/review/queue", dependencies=[Depends(staff)])
def review_queue_route(
    which: Annotated[Literal[QUEUE_FILTERS], Query(alias="filter")] = "todo",
    q: Annotated[str | None, Query(max_length=64)] = None,
):
    with pool.connection() as conn:
        return review_queue(conn, which, q)


@app.get("/api/review/camera", dependencies=[Depends(staff)])
def review_camera(camera: Annotated[str, Query(max_length=32)]):
    """Everything /revue's window shows of one camera: its label (labels), the served
    build's state (tags, version, what the map draws, where its position comes from, its
    field), every contribution (withdrawn ones included, opinions as counts; an add with the
    cameras within review_near_m) with where it goes (`destination`: stays here, or its
    latest publication on OSM), its author's record and the other accounts confirming it on
    site, and the cameras within review_near_m of it."""
    within = participation.rules()["add"]["review_near_m"]
    with pool.connection() as conn:
        rows = [r for r in review_rows(conn, camera=camera, withdrawn=True)
                if r["kind"] not in OPINIONS]  # fmt: skip
        state = conn.execute(
            "SELECT osm_type, osm_id, osm_version, tags, kind, kind_certainty, mount_group,"
            " directions, direction_certainty, height_m, height_certainty, operator_class,"
            " operator_norm, commune, geom_certainty, ST_X(ST_Transform(geom, 4326)),"
            " ST_Y(ST_Transform(geom, 4326)), tilt_deg, position_source"
            " FROM cameras WHERE camera_id = %s",
            (camera,),
        ).fetchone()
        if state is None and not rows:
            fail(404, "unknown_camera")
        authors = dict(conn.execute(
            "SELECT uuid::text, author_id::text FROM contributions WHERE camera_id = %s",
            (camera,)).fetchall())  # fmt: skip
        records = author_records(conn, sorted(set(authors.values()) - {None}))
        confirmed = on_site_confirmed(conn, [camera])
        bound = bound_for_osm(conn, camera, sorted(set(authors.values()) - {None}))
        for r in rows:
            if r["kind"] == "add":
                r["near"] = cameras_near_add(conn, r["uuid"])
            pub = r.pop("osm_publish")
            r["destination"] = ({"where": "osm", **pub} if pub
                                else bound.get(r["uuid"], {"where": "sw"}))  # fmt: skip
            r["author_record"] = records.get(authors[r["uuid"]], {"accepted": 0, "rejected": 0})
            r["confirmed"] = len(confirmed.get(r["uuid"], ()))
        served = None
        field: list[dict] = []
        if state is not None:
            keys = ("osm_type", "osm_id", "osm_version", "tags", "kind", "kind_certainty",
                    "mount_group", "directions", "direction_certainty", "height_m",
                    "height_certainty", "operator_class", "operator", "commune",
                    "geom_certainty", "lon", "lat", "tilt", "position_source")  # fmt: skip
            served = dict(zip(keys, state, strict=True))
            # A class, never degrees (phase D3); it counts only with an estimated height.
            served["tilt"] = participation.tilt_class(served["tilt"])
            cam = live.camera(conn, camera)
            polys = live.buildings_near(conn, cam.x, cam.y, live.fetch_radius(cam))
            field = live.shown_bands(live.field(cam, cam.x, cam.y, polys))
        add = next((r for r in rows if r["kind"] == "add"), None)
        at = (served["lon"], served["lat"]) if served else (add["lon"], add["lat"])
        x, y = live.to_metres(*at)
        near = [
            {"camera": c, "kind": k, "m": round(d, 1), "at": [round(lo, 7), round(la, 7)]}
            for c, k, d, lo, la in conn.execute(
                "SELECT camera_id, kind, ST_Distance(geom, p),"
                " ST_X(ST_Transform(geom, 4326)), ST_Y(ST_Transform(geom, 4326))"
                " FROM cameras, ST_SetSRID(ST_MakePoint(%s, %s), 2154) p"
                " WHERE ST_DWithin(geom, p, %s) AND camera_id <> %s ORDER BY 3, 1",
                (x, y, within, camera),
            )
        ]  # fmt: skip
        # An add no build has applied: the field its open answers give (answered_add).
        proposed = answered_add_bands(conn, camera) if add is not None else None
        # A « Modifier » send: the field its pieces give together (batch_field).
        batches = {b: batch_field(conn, b) for b in sorted({r["batch"] for r in rows} - {None})}
        label = labels(conn, [camera])[camera]
    return {"camera": camera, "label": label, "served": served, "field": field,
            "contributions": rows, "near": near, "proposed": proposed,
            "batches": batches}  # fmt: skip


def bound_for_osm(conn, camera: str, author_ids: list[str]) -> dict[str, dict]:
    """uuid -> where a contribution of the camera not gone to OSM is bound, when its author's
    synchronisation is on (publish.history): waiting (it leaves once accepted and applied,
    at the next pass: {where osm, server, state waiting}), or kept_edited (the review
    changed it: {where sw, state kept_edited}). Observed before her choice: nothing said."""
    server = publish_server()
    if server is None or not author_ids:
        return {}
    out = {}
    for author_id, consent in conn.execute(
        "SELECT account_id::text, consent_day FROM osm_write WHERE account_id = ANY(%s::uuid[])"
        " AND server = %s AND token IS NOT NULL AND coalesce(last_error, '') <> 'blocked'",
        (author_ids, server.name),
    ).fetchall():
        for h in publish.history(conn, author_id, server.name, consent, camera):
            if h["state"] == "waiting":
                out[h["uuid"]] = {"where": "osm", "server": server.name, "state": "waiting",
                                  "reason": None, "changeset": None, "month": None}  # fmt: skip
            elif h["state"] == "kept_edited":
                out[h["uuid"]] = {"where": "sw", "state": "kept_edited"}
    return out


def review_rate(who: Account) -> None:
    """The reviewer's decisions (decide, decide-on-site, undo) share one bucket:
    rules/participation.yaml limits.review_per_minute; over it, 429 rate."""
    if not limits.allow(who.id, "review", participation.rules()["limits"]["review_per_minute"]):
        fail(429, "rate")


class OnSiteIn(BaseModel):
    camera: str = Field(max_length=32)


@app.post("/api/review/decide-on-site")
def decide_on_site(body: OnSiteIn, who: Annotated[Account, Depends(staff)]):
    """ "Valider tout ce qui a été fait sur place": every pending contribution of the camera
    made on site (on_site true), opinions and "Je ne sais pas" aside, validated as one
    decision each (the database numbers them) — but an operator name proposed and not
    chosen yet, and the rest of its « Modifier » send (`left`): the reviewer decides it."""
    review_rate(who)
    with pool.connection() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (body.camera,))
        mine = "camera_id = %s AND status = 'pending' AND on_site IS TRUE"
        waiting = (
            f"EXISTS (SELECT FROM contributions p WHERE {PROPOSED_WAITING.format(c='p.')}"
            " AND (p.uuid = contributions.uuid OR p.batch = contributions.batch))"
        )
        left = [r[0] for r in conn.execute(
            f"SELECT uuid::text FROM contributions WHERE {mine} AND {DECIDABLE} AND {waiting}",
            (body.camera,),
        ).fetchall()]  # fmt: skip
        done = [r[0] for r in conn.execute(
            "UPDATE contributions SET status = 'validated', decided_by_id = %s,"
            f" decided_on = %s WHERE {mine} AND {DECIDABLE} AND NOT {waiting}"
            " RETURNING uuid::text",
            (who.id, date.today(), body.camera),
        ).fetchall()]  # fmt: skip
        journal_decisions(conn, who, "on_site", dict.fromkeys(done, "pending"), "validated")
        recompute(conn, body.camera)
    return {"camera": body.camera, "validated": sorted(done), "left": sorted(left)}


def cameras_near_add(conn, add_uuid: str) -> list[dict]:
    """The served build's cameras and the other open adds within review_near_m of an add:
    id, kind, distance, position, and whether it is an add no build has applied yet."""
    within = participation.rules()["add"]["review_near_m"]
    rows = conn.execute(
        "WITH a AS (SELECT camera_id, geom FROM contributions WHERE uuid = %s)"
        " SELECT k.camera_id, k.kind, ST_Distance(k.geom, a.geom), false,"
        " ST_X(ST_Transform(k.geom, 4326)), ST_Y(ST_Transform(k.geom, 4326)) FROM cameras k, a"
        " WHERE ST_DWithin(k.geom, a.geom, %s) AND k.camera_id <> a.camera_id"
        " UNION ALL"
        " SELECT c.camera_id, 'unknown', ST_Distance(c.geom, a.geom), true,"
        " ST_X(ST_Transform(c.geom, 4326)), ST_Y(ST_Transform(c.geom, 4326))"
        " FROM contributions c, a"
        " WHERE c.kind = 'add' AND c.status IN ('pending', 'validated', 'conflict')"
        " AND ST_DWithin(c.geom, a.geom, %s) AND c.camera_id <> a.camera_id"
        " ORDER BY 3, 1",
        (add_uuid, within, within),
    ).fetchall()
    return [
        {"camera": c, "kind": k, "m": round(d, 1), "pending": p,
         "at": [round(x, 7), round(y, 7)]}
        for c, k, d, p, x, y in rows
    ]  # fmt: skip


def in_footprint(payload: dict) -> bool:
    """A position in a building's footprint (awning, arcade); release 1 said under_arcade.
    The CSV's column."""
    return bool(payload.get("inside_footprint") or payload.get("under_arcade"))


def placement_of(payload: dict) -> str | None:
    """ "facade" or "free"; release 1 stored snap and under_arcade instead."""
    if payload.get("placement"):
        return payload["placement"]
    if payload.get("snap") is None:
        return None
    return "facade" if payload["snap"] and not payload.get("under_arcade") else "free"


class OperatorChoice(BaseModel):
    """What a reviewer accepts of an operator name proposed (migration 017): the name as
    typed, a name of the list (`name`), or no name — the class answer stands."""

    choice: Literal["proposed", "listed", "none"]
    name: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def _name(self):
        if (self.choice == "listed") != (self.name is not None):
            raise ValueError("name")
        return self


class DecideIn(BaseModel):
    uuid: str = Field(max_length=36)
    decision: Literal["validated", "rejected"]
    # Validating a contribution (or a send) whose operator name was proposed and not chosen
    # yet needs it; given again, it replaces the choice. Never with a rejection.
    operator: OperatorChoice | None = None


# What a decision may change (corrections after the D3 iPhone tests, "Changer la
# décision"): a waiting or conflicting contribution either way, a validated one to
# rejected and back, an applied one to rejected (the next build puts the camera back);
# nothing for a superseded or withdrawn one.
CHANGES = {
    "pending": {"validated", "rejected"},
    "conflict": {"validated", "rejected"},
    "validated": {"rejected"},
    "rejected": {"validated"},
    "applied": {"rejected"},
}


@app.post("/api/review/decide")
def decide(body: DecideIn, who: Annotated[Account, Depends(staff)]):
    """The review account validates or rejects a contribution, or changes its decision
    (CHANGES); the decision keeps who and which day (the database numbers each one,
    migrations 005 and 011). A validated contribution is applied by the next build
    deployed; rejecting an applied one puts the camera back in the next build; validating
    a conflict accepts the OSM version the deploy found (apply_detail) — not when the
    element is gone. A piece of a « Modifier » send, or the send's own id: one decision for
    the whole send (decide_batch). An operator name proposed (migration 017) is accepted
    only by a validation that says how (`operator`, operator_decision); a rejection
    refuses it."""
    uid = v4(body.uuid)
    if body.operator is not None and body.decision != "validated":
        fail(422, "operator_choice")
    review_rate(who)
    with pool.connection() as conn, conn.transaction():
        batch = batch_of(conn, uid)
        if batch is not None:
            return decide_batch(conn, uid, batch, body.decision, who, body.operator)
        row = conn.execute(
            "SELECT camera_id, kind, status, apply_detail->>'reason' FROM contributions"
            " WHERE uuid = %s",
            (uid,),
        ).fetchone()
        if row is None:
            fail(404, "unknown_contribution")
        if row[1] in OPINIONS:
            fail(422, "not_decidable")
        if row[2] == "withdrawn":
            fail(409, "withdrawn")  # its author took it back: nothing to decide
        if body.decision not in CHANGES.get(row[2], set()):
            fail(409, "not_a_change")
        if body.decision == "validated" and row[2:] == ("conflict", "osm_deleted"):
            fail(422, "element_gone")
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (row[0],))
        before = {uid: row[2]}
        if row[1] == "add" and body.decision == "validated" and row[2] == "pending":
            # The add and what its author answered with it are one gesture in /revue: its
            # author's waiting answers are validated with it, in this transaction.
            before |= add_author_answers(conn, uid)
        moving = sorted(before)
        name = operator_decision(conn, moving, body.decision, body.operator)
        if body.operator is not None and not name:
            fail(422, "operator_choice")  # nothing proposed to choose for
        conn.execute(
            "UPDATE contributions SET status = %s, decided_by_id = %s, decided_on = %s"
            " WHERE uuid = ANY(%s::uuid[])",
            (body.decision, who.id, date.today(), moving),
        )
        settle_name(conn, name)
        journal_decisions(conn, who, "decide", before, body.decision)
        if row[1] == "add" and body.decision == "rejected":
            moving += reject_add_answers(conn, who, uid)
        recompute(conn, row[0])
    return {"uuid": uid, "status": body.decision, "decided": sorted(set(moving))}


def add_author_answers(conn, add_uuid: str) -> dict[str, str]:
    """uuid -> status of the waiting answers the add's own author gave with it (other
    accounts' answers wait for their own decision; « Je ne sais pas » decides nothing)."""
    return dict(conn.execute(
        "SELECT c.uuid::text, c.status FROM contributions c"
        " JOIN contributions a ON a.uuid = c.target"
        " WHERE c.target = %s AND c.status = 'pending' AND c.author_id = a.author_id"
        f" AND NOT {BLANK_SQL.replace('kind', 'c.kind').replace('answer', 'c.answer')}",
        (add_uuid,)).fetchall())  # fmt: skip


def reject_add_answers(conn, who: Account, add_uuids: list[str] | str,
                       action: str = "decide") -> list[str]:  # fmt: skip
    """An add rejected: the camera leaves the next build with everything said of it (still
    open); a name proposed in its answers is refused with them, as a rejection does. Each
    rejected answer enters the journal (`action`); returns their uuids."""
    adds = [add_uuids] if isinstance(add_uuids, str) else add_uuids
    before = dict(conn.execute(
        "SELECT uuid::text, status FROM contributions WHERE target = ANY(%s::uuid[])"
        " AND status IN ('pending', 'validated')", (adds,)).fetchall())  # fmt: skip
    conn.execute(
        "UPDATE contributions SET status = 'rejected', decided_by_id = %s,"
        " decided_on = %s,"
        " operator_choice = CASE WHEN operator_proposed IS NULL"
        "   THEN operator_choice END,"
        " operator_name = CASE WHEN operator_proposed IS NULL THEN operator_name END"
        " WHERE uuid = ANY(%s::uuid[])",
        (who.id, date.today(), sorted(before)),
    )
    if action == "decide":
        journal_decisions(conn, who, action, before, "rejected")
    return sorted(before)


def journal_decisions(conn, who: Account, action: str, before: dict[str, str], to: str) -> None:
    """One journal line per contribution a reviewer's gesture changed (decide, undo,
    on_site): its uuid, its author (account and pseudonym), {from, to, camera}."""
    if not before:
        return
    for uid, cam, author_id, name in conn.execute(
        "SELECT c.uuid::text, c.camera_id, c.author_id::text, a.pseudonym FROM contributions c"
        " LEFT JOIN accounts a ON a.id = c.author_id WHERE c.uuid = ANY(%s::uuid[])"
        " ORDER BY c.uuid", (sorted(before),)).fetchall():  # fmt: skip
        journal(conn, who, action, account=author_id, name=name, target=uid,
                detail={"from": before[uid], "to": to, "camera": cam})  # fmt: skip


class UndoIn(BaseModel):
    uuids: list[str] = Field(min_length=1, max_length=100)


# What the caller may undo: their own decision of today, still standing (neither applied
# by a build since nor superseded: those statuses are no longer validated or rejected).
UNDOABLE = "status IN ('validated', 'rejected') AND decided_by_id = %s AND decided_on = %s"


@app.post("/api/review/undo")
def undo(body: UndoIn, who: Annotated[Account, Depends(staff)]):
    """« Annuler » for a few seconds after a decision (lot 1): each contribution the caller
    validated or rejected today goes back to pending, its decider and day cleared, and an
    operator name proposed waits for its choice again (the choice and the name a
    validation set are cleared: a proposed name always arrived without them). A send's id
    or one of its pieces undoes the send's pieces so decided; an add's rejection undone
    brings back its answers the caller rejected today with it (decide's cascade). The
    decision's number (decision_seq) stays: a later decision takes a new one. 409
    not_undoable when nothing is."""
    ids = sorted({v4(u) for u in body.uuids})
    review_rate(who)
    today = date.today()
    with pool.connection() as conn, conn.transaction():
        batches = sorted({b for u in ids if (b := batch_of(conn, u)) is not None})
        rows = conn.execute(
            "SELECT uuid::text, camera_id, kind, status FROM contributions"
            f" WHERE (uuid = ANY(%s::uuid[]) OR batch = ANY(%s::uuid[])) AND {UNDOABLE}",
            (ids, batches, who.id, today),
        ).fetchall()
        adds = [u for u, _, kind, status in rows if kind == "add" and status == "rejected"]
        if adds:
            rows += conn.execute(
                "SELECT uuid::text, camera_id, kind, status FROM contributions"
                f" WHERE target = ANY(%s::uuid[]) AND status = 'rejected' AND {UNDOABLE}",
                (adds, who.id, today),
            ).fetchall()
        if not rows:
            fail(409, "not_undoable")
        cameras = sorted({r[1] for r in rows})
        for cam in cameras:
            conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (cam,))
        done = [r[0] for r in conn.execute(
            "UPDATE contributions SET status = 'pending', decided_by_id = NULL,"
            " decided_on = NULL,"
            " operator_choice = CASE WHEN operator_proposed IS NULL THEN operator_choice END,"
            " operator_name = CASE WHEN operator_proposed IS NULL THEN operator_name END"
            f" WHERE uuid = ANY(%s::uuid[]) AND {UNDOABLE} RETURNING uuid::text",
            (sorted({r[0] for r in rows}), who.id, today),
        ).fetchall()]  # fmt: skip
        if not done:
            fail(409, "not_undoable")  # decided again meanwhile
        statuses = {r[0]: r[3] for r in rows}
        journal_decisions(conn, who, "undo", {u: statuses[u] for u in done}, "pending")
        for cam in cameras:
            recompute(conn, cam)
    return {"undone": sorted(done)}


def operator_decision(
    conn, uuids: list[str], decision: str, given: OperatorChoice | None
) -> dict[str, tuple[str | None, str | None]]:
    """For the contributions among `uuids` with an operator name proposed: uuid ->
    (operator_choice, operator_name) the decision leaves them with. A rejection clears both
    (the name is refused with the contribution); a validation takes `given`, else keeps the
    choice made before — none made before and none given is a 422 operator_choice. A listed
    name must be one the answer's class allows (operator_allowed), else 422 operator_name."""
    out = {}
    for u, cam_id, answer, proposed, choice, name in conn.execute(
        "SELECT uuid::text, camera_id, answer, operator_proposed, operator_choice, operator_name"
        " FROM contributions WHERE uuid = ANY(%s::uuid[]) AND operator_proposed IS NOT NULL",
        (uuids,),
    ).fetchall():
        if decision == "rejected":
            out[u] = (None, None)
        elif given is None:
            if choice is None:
                fail(422, "operator_choice")
            out[u] = (choice, name)
        elif given.choice == "listed":
            cam = live.camera(conn, cam_id) or pending_add(conn, cam_id)
            ok = {"name": given.name, "class": answer} in participation.all_operators() or (
                cam is not None and operator_allowed(conn, cam, answer, given.name)
            )
            if not ok:
                fail(422, "operator_name")
            out[u] = ("listed", given.name)
        else:
            out[u] = (given.choice, proposed if given.choice == "proposed" else None)
    return out


def settle_name(conn, names: dict[str, tuple[str | None, str | None]]) -> None:
    for u, (choice, name) in names.items():
        conn.execute(
            "UPDATE contributions SET operator_choice = %s, operator_name = %s WHERE uuid = %s",
            (choice, name, u),
        )


def decide_batch(
    conn, uid: str, batch: str, decision: str, who: Account, given: OperatorChoice | None = None
) -> dict:
    """decide() for a « Modifier » send (DECISIONS 2026-10-08: one decision per send): every
    piece the decision may change (CHANGES) takes it, in one transaction — a piece the build
    applied stays applied when the send is validated again, a conflict whose element is gone
    stays a conflict. Refused when it changes none (not_a_change) or the send was withdrawn.
    `decided` lists the pieces it changed."""
    rows = conn.execute(
        "SELECT uuid::text, camera_id, status, apply_detail->>'reason' FROM contributions"
        " WHERE batch = %s",
        (batch,),
    ).fetchall()
    if all(r[2] == "withdrawn" for r in rows):
        fail(409, "withdrawn")
    moving = [
        u for u, _, status, reason in rows
        if decision in CHANGES.get(status, set())
        and not (decision == "validated" and (status, reason) == ("conflict", "osm_deleted"))
    ]  # fmt: skip
    if not moving:
        fail(409, "not_a_change")
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (rows[0][1],))
    names = operator_decision(conn, moving, decision, given)
    if given is not None and not names:
        fail(422, "operator_choice")  # no piece proposed a name
    conn.execute(
        "UPDATE contributions SET status = %s, decided_by_id = %s, decided_on = %s"
        " WHERE uuid = ANY(%s::uuid[])",
        (decision, who.id, date.today(), moving),
    )
    settle_name(conn, names)
    statuses = {u: status for u, _, status, _ in rows}
    journal_decisions(conn, who, "decide", {u: statuses[u] for u in moving}, decision)
    recompute(conn, rows[0][1])
    return {"uuid": uid, "status": decision, "batch": batch, "decided": sorted(moving)}


# Columns the CSV leaves out or moves (test stays the last one, as before accounts).
CSV_LEFT = ("payload", "apply_detail", "osm_publish", "test")


@app.get("/api/review/export.csv")
def export_csv(who: Annotated[Account, Depends(reauthed)]):
    """« Exporter toutes les contributions (CSV) »: every contribution with its author's
    pseudonym, for an administrator after the password again (lot 2: it was any
    reviewer's); journalled."""
    with pool.connection() as conn:
        rows = review_rows(conn, withdrawn=True)
        journal(conn, who, "export_csv", detail={"rows": len(rows)})
    columns = [k for k in REVIEW_KEYS if k not in CSV_LEFT] + [
        "old_lon", "old_lat", "placement", "pulled", "inside_footprint", "move_m", "facade_m",
        "served_build", "agree", "disagree", "apply_reason", "osm_publish", "test",
    ]  # fmt: skip
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(columns)
    for r in rows:
        p = r["payload"]
        old = p.get("old") or [None, None]
        move = r["kind"] == "move"
        extra = [old[0], old[1], placement_of(p) if move else None, p.get("pulled"),
                 in_footprint(p) if move else None, p.get("move_m"), p.get("facade_m"),
                 p.get("served_build"), r["agree"], r["disagree"],
                 (r["apply_detail"] or {}).get("reason"),
                 json.dumps(r["osm_publish"]) if r["osm_publish"] else None, r["test"]]  # fmt: skip
        w.writerow([r[k] for k in REVIEW_KEYS if k not in CSV_LEFT] + extra)
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="contributions.csv"'},
    )


# --- statistics (lot 4 « Statistiques ») --------------------------------------------------


@app.get("/api/review/stats", dependencies=[Depends(admin)])
def review_stats():
    """« Statistiques » (administrators): one block per question — hours, days, weeks,
    months (the site's use), queue, contributors, osm, hidden — each with `enough`, its
    measures and the thresholds they are held to (`need`, rules/stats.yaml), test accounts
    left out (lacarte.api.stats)."""
    server = publish_server()
    with pool.connection() as conn:
        return stats.review_stats(conn, DECIDABLE, server.name if server else None)


# --- the journal, an activity feed (lot 2 « Administrer », the « go » of 17/10) -----------

# Migration 020's admin_log_action.
ADMIN_ACTIONS = (
    "decide", "undo", "on_site", "role", "disable", "enable", "cut", "reset", "delete",
    "export_account", "export_csv", "suspend", "hide", "unhide", "setting", "signin_refused",
)  # fmt: skip
DECISION_ACTIONS = ("decide", "undo", "on_site")  # on a contribution: its camera
CAMERA_ACTIONS = ("hide", "unhide")  # on a camera: `target` is its id
LOG_TYPES = ("all", "contributions", "decisions", "admin")
LOG_PAGE = 100
# A page's last entry, for the next: [day, 0, seq] (a journal line) or [day, 1, camera,
# send] (a send), base64url of its JSON. Opaque to the page.
CURSOR_MAX = 200


def log_cursor(entry: tuple) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(entry, separators=(",", ":")).encode())
    return raw.decode().rstrip("=")  # no padding: nothing to escape in an address


def read_cursor(raw: str) -> tuple:
    """The position `before` names; anything else 422 cursor."""
    try:
        value = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        day = date.fromisoformat(value[0])
        if value[1] == 0 and len(value) == 3 and isinstance(value[2], int):
            return (day, 0, value[2])
        if (value[1] == 1 and len(value) == 4 and isinstance(value[2], str)
                and isinstance(value[3], str)):  # fmt: skip
            return (day, 1, value[2], value[3])
    except (ValueError, TypeError, IndexError, json.JSONDecodeError):
        pass
    fail(422, "cursor")


def journal_keys(conn, kind: str, actor: str | None, cursor: tuple | None, n: int) -> list:
    """(day, 0, seq) of the journal's lines of `kind`, after the cursor, newest first."""
    where, args = ["true"], []
    if kind == "decisions":
        where.append("action = ANY(%s)")
        args.append(list(DECISION_ACTIONS))
    elif kind == "admin":
        where.append("NOT action = ANY(%s)")
        args.append(list(DECISION_ACTIONS))
    if actor:
        where.append("lower(actor) = lower(%s)")
        args.append(actor)
    if cursor is not None:
        # In a day the journal's lines come first: past a send of that day, none is left.
        if cursor[1] == 0:
            where.append("(day < %s OR (day = %s AND seq < %s))")
            args += [cursor[0], cursor[0], cursor[2]]
        else:
            where.append("day < %s")
            args.append(cursor[0])
    return [(d, 0, seq) for d, seq in conn.execute(
        f"SELECT day, seq FROM admin_log WHERE {' AND '.join(where)}"
        " ORDER BY day DESC, seq DESC LIMIT %s", (*args, n)).fetchall()]  # fmt: skip


# A send's camera and key in the C collation (bytes, as Python compares str): the cursor's
# comparison, the SQL order and the page's merge (feed_order) agree whatever the database's
# collation.
SEND_CAMERA = 'min(camera_id COLLATE "C")'
SEND_KEY = 'coalesce(batch, uuid)::text COLLATE "C"'


def send_keys(conn, actor: str | None, cursor: tuple | None, n: int) -> list:
    """(day, 1, camera, send) of the sends received (a « Modifier » once, by its batch,
    dated by its first piece), after the cursor; in a day by camera then send."""
    where, args = ["true"], []
    if actor:
        where.append("author_id = (SELECT id FROM accounts WHERE lower(pseudonym) = lower(%s))")
        args.append(actor)
    having, hargs = "true", []
    if cursor is not None:
        if cursor[1] == 0:
            having = "min(day) <= %s"
            hargs = [cursor[0]]
        else:
            having = (
                f"(min(day) < %s OR (min(day) = %s AND ({SEND_CAMERA}, {SEND_KEY})"
                ' > (%s COLLATE "C", %s COLLATE "C")))'
            )
            hargs = [cursor[0], cursor[0], cursor[2], cursor[3]]
    return [(d, 1, cam, key) for d, cam, key in conn.execute(
        f"SELECT min(day), {SEND_CAMERA}, {SEND_KEY} FROM contributions"
        f" WHERE {' AND '.join(where)} GROUP BY coalesce(batch, uuid) HAVING {having}"
        " ORDER BY 1 DESC, 2, 3 LIMIT %s", (*args, *hargs, n)).fetchall()]  # fmt: skip


def feed_order(k: tuple) -> tuple:
    """The feed's order as a sort key: day newest first; in a day the journal (seq newest
    first), then the sends (camera, send)."""
    if k[1] == 0:
        return (-k[0].toordinal(), 0, -k[2], "", "")
    return (-k[0].toordinal(), 1, 0, k[2], k[3])


def journal_entries(conn, seqs: list[int]) -> dict[int, dict]:
    out = {}
    for seq, day, actor, test, action, name, target, detail, camera in conn.execute(
        "SELECT l.seq, l.day, l.actor, coalesce(a.test, false), l.action, l.target_name,"
        " l.target, l.detail, CASE WHEN l.action = ANY(%s) THEN coalesce((SELECT camera_id"
        "   FROM contributions WHERE uuid::text = l.target), l.detail->>'camera')"
        "   WHEN l.action = ANY(%s) THEN l.target END"
        " FROM admin_log l LEFT JOIN accounts a ON a.id = l.actor_id WHERE l.seq = ANY(%s)",
        (list(DECISION_ACTIONS), list(CAMERA_ACTIONS), seqs),
    ).fetchall():  # fmt: skip
        out[seq] = {"key": f"j{seq}", "day": day.isoformat(), "source": "journal",
                    # The journal keeps the pseudonym of an account deleted since (migration
                    # 020); a refused sign-in has nobody (''): null.
                    "actor": actor or None, "actor_test": test, "action": action,
                    "pieces": [], "camera": camera, "label": None, "target_name": name,
                    "target": target, "detail": detail}  # fmt: skip
    return out


def send_entries(conn, keys: list[str]) -> dict[str, dict]:
    """Each send with its pieces, read from the contributions now (never copied into the
    journal): what was said, the move rounded to the metre, the operator's name as chosen
    or as proposed, the status."""
    out: dict[str, dict] = {}
    rows = conn.execute(
        "SELECT coalesce(c.batch, c.uuid)::text, c.day, c.camera_id, a.pseudonym,"
        " coalesce(a.test, false), c.kind, c.answer, c.direction_deg,"
        " round((c.payload->>'move_m')::numeric)::int, coalesce(c.operator_name,"
        " c.operator_proposed), c.status, c.uuid::text"
        " FROM contributions c LEFT JOIN accounts a ON a.id = c.author_id"
        " WHERE coalesce(c.batch, c.uuid)::text = ANY(%s)", (keys,)).fetchall()  # fmt: skip
    order = {k: i for i, k in enumerate((*PIECE_ORDER, "agree", "disagree"))}
    rows.sort(key=lambda r: (order.get(r[5], len(order)), r[11]))
    for key, day, cam, actor, test, kind, answer, deg, move, operator, status, _ in rows:
        e = out.setdefault(key, {"key": f"c{key}", "day": day.isoformat(),
                                 "source": "contribution", "actor": actor, "actor_test": test,
                                 "action": "contribution", "pieces": [], "camera": cam,
                                 "label": None, "target_name": None, "target": None,
                                 "detail": None})  # fmt: skip
        e["day"] = min(e["day"], day.isoformat())
        e["pieces"].append({"kind": kind, "answer": answer, "direction": deg,
                            "distance_m": move if kind == "move" else None,
                            "operator_name": operator, "status": status})  # fmt: skip
    return out


@app.get("/api/review/log", dependencies=[Depends(admin)])
def review_log(
    type: Literal[LOG_TYPES] = "all",  # noqa: A002 — the contract's name
    actor: Annotated[str | None, Query(max_length=64)] = None,
    before: Annotated[str | None, Query(max_length=CURSOR_MAX)] = None,
):
    """« Journal » (administrators), an activity feed: the journal's lines and the sends
    received, by day newest first, in a day the journal's lines (newest first) then the
    sends (camera, send), 100 a page. `type`: all, contributions, decisions (decide, undo,
    on_site), admin (the other actions); `actor` a pseudonym (any case; for a send its
    author); `before` the `next` of the previous page. No time of day: contributions have
    none. An entry on a camera carries the queue's label of it (labels())."""
    cursor = read_cursor(before) if before else None
    n = LOG_PAGE + 1
    with pool.connection() as conn:
        keys = []
        if type != "contributions":
            keys += journal_keys(conn, type, actor, cursor, n)
        if type in ("all", "contributions"):
            keys += send_keys(conn, actor, cursor, n)
        keys.sort(key=feed_order)
        page = keys[:LOG_PAGE]
        lines = journal_entries(conn, [k[2] for k in page if k[1] == 0])
        sends = send_entries(conn, [k[3] for k in page if k[1] == 1])
        entries = [lines[k[2]] if k[1] == 0 else sends[k[3]] for k in page]
        names = labels(conn, sorted({e["camera"] for e in entries if e["camera"]}))
    for e in entries:
        if e["camera"]:
            e["label"] = names[e["camera"]]
    last = page[-1] if page else None
    nxt = None
    if len(keys) > LOG_PAGE:
        nxt = log_cursor([last[0].isoformat(), *last[1:]])
    return {"entries": entries, "next": nxt}


# --- accounts, for administrators (lot 2 « Administrer ») --------------------------------

# A row of « Comptes »: never an OSM id, a hash, a session's day or points. Accepted,
# pending and rejected count a « Modifier » send once, as the queue's author record does.
ACCOUNT_ROW_SQL = f"""
SELECT a.id::text, a.pseudonym, a.role,
       CASE WHEN NOT {auth.CLAIMED} THEN 'placeholder'
            WHEN a.disabled THEN 'disabled' ELSE 'active' END,
       a.test,
       count(DISTINCT coalesce(c.batch, c.uuid)) FILTER (WHERE c.status IN
           ({", ".join(repr(s) for s in ACCEPTED)})),
       count(DISTINCT coalesce(c.batch, c.uuid)) FILTER (WHERE c.status = 'pending'),
       count(DISTINCT coalesce(c.batch, c.uuid)) FILTER (WHERE c.status = 'rejected'),
       (SELECT max(day)::text FROM contributions WHERE author_id = a.id)
FROM accounts a LEFT JOIN contributions c ON c.author_id = a.id AND {DECIDABLE}
"""
ACCOUNT_ROW_KEYS = ("id", "pseudonym", "role", "state", "test", "accepted", "pending",
                    "rejected", "last_day")  # fmt: skip
ACCOUNTS_SHOWN = 50
# Every change that may take the last administrator away waits for the others.
ADMINS_LOCK = "SELECT pg_advisory_xact_lock(hashtext('lacarte.admins'))"


def account_rows(conn, where: str, args: tuple, order: str, limit: int | None = None) -> list:
    rows = conn.execute(
        f"{ACCOUNT_ROW_SQL} WHERE {where} GROUP BY a.id ORDER BY {order}"
        + (f" LIMIT {int(limit)}" if limit else ""),
        args,
    ).fetchall()
    return [dict(zip(ACCOUNT_ROW_KEYS, r, strict=True)) for r in rows]


def account_row(conn, account_id: str) -> dict:
    rows = account_rows(conn, "a.id = %s", (account_id,), "a.id")
    if not rows:
        fail(404, "unknown_account")
    return rows[0]


def like(text: str) -> str:
    """A LIKE pattern matching `text` anywhere, its own % _ \\ taken literally."""
    return "%" + re.sub(r"([%_\\])", r"\\\1", text.lower()) + "%"


@app.get("/api/review/accounts", dependencies=[Depends(admin)])
def review_accounts(q: Annotated[str | None, Query(max_length=64)] = None):
    """« Comptes »: the team (reviewers and administrators, administrators first) and the
    other accounts, the latest to contribute first, at most ACCOUNTS_SHOWN; `q` a part of a
    pseudonym (any case), for both. Each row: id, pseudonym, role, state (active, disabled,
    placeholder), test, accepted / pending / rejected (a send once), last_day (the last
    contribution's day, null if none)."""
    found, args = ("lower(a.pseudonym) LIKE %s", (like(q),)) if q else ("true", ())
    with pool.connection() as conn:
        team = account_rows(conn, f"a.role IN ('reviewer', 'admin') AND {found}", args,
                            "a.role = 'admin' DESC, lower(a.pseudonym)")  # fmt: skip
        others = account_rows(conn, f"a.role = 'contributor' AND {found}", args,
                              "9 DESC NULLS LAST, lower(a.pseudonym)", ACCOUNTS_SHOWN)  # fmt: skip
    return {"team": team, "accounts": others}


def last_admin(conn, account_id: str) -> bool:
    """Whether this account is the only administrator left who can act (active, with a
    password): it can then be neither demoted, disabled, suspended nor deleted."""
    return conn.execute(
        "SELECT role = 'admin' AND NOT disabled AND password_hash IS NOT NULL AND NOT EXISTS"
        " (SELECT FROM accounts o WHERE o.id <> a.id AND o.role = 'admin' AND NOT o.disabled"
        "  AND o.password_hash IS NOT NULL) FROM accounts a WHERE id = %s",
        (account_id,),
    ).fetchone()[0]


@app.get("/api/review/account")
def review_account(id: Annotated[str, Query(max_length=36)],  # noqa: A002 — the contract's
                   who: Annotated[Account, Depends(admin)]):  # fmt: skip
    """« Fiche utilisateur »: the row of « Comptes », and the month it was made (`since`),
    whether it is linked to OSM and publishes there, how many sessions it has, its
    contributions counted by status, its latest 100 contributions (uuid, camera, its
    label, kind, status, day), what became of them on OSM, its OSM synchronisation (`sync`:
    on, the server, since which month, the last refusal's class), whether it is the last
    administrator (`protected`) and whether it is the caller (`self`). Never an OSM id, a
    hash, a session's day, points."""
    account_id = v4(id)
    with pool.connection() as conn:
        row = account_row(conn, account_id)
        since, osm_on, publish_on, sessions = conn.execute(
            "SELECT to_char(created_month, 'YYYY-MM'), osm_id IS NOT NULL,"
            " EXISTS (SELECT FROM osm_write WHERE account_id = a.id),"
            " (SELECT count(*) FROM sessions WHERE account_id = a.id)"
            " FROM accounts a WHERE id = %s", (account_id,)).fetchone()  # fmt: skip
        by_status = dict(conn.execute(
            "SELECT status, count(*) FROM contributions WHERE author_id = %s GROUP BY status",
            (account_id,)).fetchall())  # fmt: skip
        latest = conn.execute(
            "SELECT uuid::text, camera_id, kind, status, day::text FROM contributions"
            " WHERE author_id = %s ORDER BY day DESC, uuid LIMIT 100", (account_id,)
        ).fetchall()  # fmt: skip
        names = labels(conn, sorted({r[1] for r in latest}))
        publications = conn.execute(
            "SELECT p.uuid::text, p.server, p.state, p.reason, p.changeset,"
            " to_char(p.month, 'YYYY-MM') FROM osm_publications p"
            " JOIN contributions c ON c.uuid = p.uuid WHERE c.author_id = %s"
            " ORDER BY p.month DESC, p.uuid, p.server", (account_id,)).fetchall()  # fmt: skip
        protected = last_admin(conn, account_id)
        write = conn.execute(
            "SELECT server, token IS NOT NULL, to_char(consent_day, 'YYYY-MM'), last_error"
            " FROM osm_write WHERE account_id = %s", (account_id,)).fetchone()  # fmt: skip
    sync_ = {"on": bool(write and write[1]), "server": write[0] if write else None,
             "since": write[2] if write and write[1] else None,
             "last_error": write[3] if write else None}  # fmt: skip
    return {
        **row, "since": since, "osm": osm_on, "publish": publish_on, "sync": sync_,
        "sessions": sessions,
        "by_status": by_status,
        "contributions": [{"uuid": u, "camera": c, "label": names[c], "kind": k, "status": s,
                           "day": d} for u, c, k, s, d in latest],
        "publications": [dict(zip(("uuid", "server", "state", "reason", "changeset", "month"),
                                  p, strict=True)) for p in publications],
        "protected": protected, "self": account_id == who.id,
    }  # fmt: skip


class AccountIn(BaseModel):
    id: str = Field(max_length=36)


class RoleIn(AccountIn):
    role: Literal["contributor", "reviewer", "admin"]


class StateIn(AccountIn):
    disabled: bool


class DeleteAccountIn(AccountIn):
    pseudonym: str = Field(max_length=64)


def target(conn, body: AccountIn, who: Account, *, not_self: bool = True) -> dict:
    """The account an administrator acts on, locked for the transaction: its id,
    pseudonym, role, disabled, claimed (not a placeholder), test, password. 404
    unknown_account; 409 self for an action nobody takes on themselves."""
    account_id = v4(body.id)
    if not_self and account_id == who.id:
        fail(409, "self")
    conn.execute(ADMINS_LOCK)
    row = conn.execute(
        f"SELECT a.id::text, a.pseudonym, a.role, a.disabled, {auth.CLAIMED}, a.test,"
        " a.password_hash IS NOT NULL FROM accounts a WHERE a.id = %s FOR UPDATE",
        (account_id,),
    ).fetchone()
    if row is None:
        fail(404, "unknown_account")
    keys = ("id", "pseudonym", "role", "disabled", "claimed", "test", "password")
    return dict(zip(keys, row, strict=True))


def keep_an_admin(conn, t: dict) -> None:
    if last_admin(conn, t["id"]):
        fail(409, "last_admin")


def cut_sessions(conn, account_id: str) -> int:
    """Every session of the account deleted, their marks dropped (the privileged entry's
    and the reauthentication's): it signs in again, if it still can."""
    n = conn.execute("DELETE FROM sessions WHERE account_id = %s", (account_id,)).rowcount
    auth.forget_marks(account_id=account_id)
    return n


@app.post("/api/review/account/role")
def review_account_role(body: RoleIn, who: Annotated[Account, Depends(reauthed)]):
    """A role: not one's own, never the last administrator's taken away; a reviewer or an
    administrator needs a password (422 needs_password: the privileged entry asks for
    one); a placeholder has none to change (409 placeholder). Its marks are dropped: a
    promoted account enters /revue by the privileged entry, a demoted one leaves it."""
    with pool.connection() as conn, conn.transaction():
        t = target(conn, body, who)
        if not t["claimed"]:
            fail(409, "placeholder")
        if body.role != "contributor" and not t["password"]:
            fail(422, "needs_password")
        if t["role"] == "admin" and body.role != "admin":
            keep_an_admin(conn, t)
        if body.role != t["role"]:
            conn.execute("UPDATE accounts SET role = %s WHERE id = %s", (body.role, t["id"]))
            journal(conn, who, "role", account=t["id"], name=t["pseudonym"],
                    detail={"from": t["role"], "to": body.role})  # fmt: skip
            auth.forget_marks(account_id=t["id"])
        return account_row(conn, t["id"])


@app.post("/api/review/account/state")
def review_account_state(body: StateIn, who: Annotated[Account, Depends(reauthed)]):
    """Disable (no sign-in any more, its sessions cut) or enable an account; not one's
    own, never the last administrator."""
    with pool.connection() as conn, conn.transaction():
        t = target(conn, body, who)
        if body.disabled:
            keep_an_admin(conn, t)
        if body.disabled != t["disabled"]:
            conn.execute("UPDATE accounts SET disabled = %s WHERE id = %s",
                         (body.disabled, t["id"]))  # fmt: skip
            sessions = cut_sessions(conn, t["id"]) if body.disabled else 0
            journal(conn, who, "disable" if body.disabled else "enable", account=t["id"],
                    name=t["pseudonym"],
                    detail={"sessions": sessions} if body.disabled else None)  # fmt: skip
        return account_row(conn, t["id"])


@app.post("/api/review/account/cut")
def review_account_cut(body: AccountIn, who: Annotated[Account, Depends(reauthed)]):
    """« Couper l'accès »: every session of the account ends (one's own too: a lost
    phone); it may sign in again. {"sessions": n}."""
    with pool.connection() as conn, conn.transaction():
        t = target(conn, body, who, not_self=False)
        n = cut_sessions(conn, t["id"])
        journal(conn, who, "cut", account=t["id"], name=t["pseudonym"], detail={"sessions": n})
    return {"sessions": n}


GENERATED_BYTES = 18  # 24 urlsafe characters, as the accounts CLI draws them


@app.post("/api/review/account/reset")
def review_account_reset(body: AccountIn, who: Annotated[Account, Depends(reauthed)]):
    """« Réinitialiser le mot de passe »: a password drawn here and answered once
    ({"password"}, never stored but hashed, never logged); OSM unlinked and its write
    token revoked at OSM (whoever took the account over may have attached theirs), its
    sessions cut. Not one's own (/api/me/password), not a placeholder."""
    password = secrets.token_urlsafe(GENERATED_BYTES)
    hashed = auth.hash_password(password)
    with pool.connection() as conn, conn.transaction():
        t = target(conn, body, who)
        if not t["claimed"]:
            fail(409, "placeholder")
        unlinked = conn.execute(
            "UPDATE accounts SET password_hash = %s, osm_id = NULL, osm_server = NULL"
            " WHERE id = %s RETURNING (SELECT osm_id IS NOT NULL FROM accounts WHERE id = %s)",
            (hashed, t["id"], t["id"]),
        ).fetchone()[0]
        n = cut_sessions(conn, t["id"])
    publishing_ended = drop_write(t["id"])  # revoked at OSM, best effort, outside the lock
    with pool.connection() as conn:
        journal(conn, who, "reset", account=t["id"], name=t["pseudonym"],
                detail={"sessions": n, "osm_unlinked": unlinked,
                        "publishing_ended": publishing_ended})  # fmt: skip
    return JSONResponse({"password": password}, headers={"Cache-Control": "no-store"})


def remove_account(conn, account_id: str) -> None:
    """An account deleted (« Supprimer mon compte », or an administrator's), in the caller's
    transaction, which holds ADMINS_LOCK: never the last administrator (409 last_admin,
    checked in the transaction that deletes, so two deletions cannot pass it together).
    Its write token goes with it and is revoked at OSM once committed (best effort), its
    marks are dropped; the account and its sessions go, its contributions stay without
    author (migration 014: ON DELETE SET NULL), and the journal keeps its pseudonym."""
    if last_admin(conn, account_id):
        fail(409, "last_admin")
    row = conn.execute("DELETE FROM osm_write WHERE account_id = %s RETURNING server, token",
                       (account_id,)).fetchone()  # fmt: skip
    conn.execute("DELETE FROM accounts WHERE id = %s", (account_id,))
    conn.commit()
    auth.forget_marks(account_id=account_id)
    if row is not None:
        revoke_sealed(account_id, *row)


def remove_self(account_id: str) -> None:
    """« Supprimer mon compte »: the last administrator cannot (409 last_admin), as from
    « Comptes »."""
    with pool.connection() as conn:
        conn.execute(ADMINS_LOCK)
        remove_account(conn, account_id)


@app.post("/api/review/account/delete")
def review_account_delete(body: DeleteAccountIn, who: Annotated[Account, Depends(reauthed)]):
    """« Supprimer… »: the pseudonym retyped exactly (400 confirmation); as « Supprimer mon
    compte » does; not a test account (409 test_account, as there: the CLI deletes it with
    its contributions), not one's own, never the last administrator. 204."""
    with pool.connection() as conn:
        t = target(conn, body, who)
        if body.pseudonym != t["pseudonym"]:
            fail(400, "confirmation")
        if t["test"]:
            fail(409, "test_account")
        n = conn.execute("SELECT count(*) FROM contributions WHERE author_id = %s",
                         (t["id"],)).fetchone()[0]  # fmt: skip
        journal(conn, who, "delete", account=t["id"], name=t["pseudonym"],
                detail={"contributions": n})  # fmt: skip
        remove_account(conn, t["id"])
    return Response(status_code=204)


@app.get("/api/review/account/export")
def review_account_export(id: Annotated[str, Query(max_length=36)],  # noqa: A002 — the contract's
                          who: Annotated[Account, Depends(reauthed)]):  # fmt: skip
    """« Exporter ses données »: exactly what the person's own « Télécharger mes données »
    gives (/api/me/export), as an attachment named after the pseudonym; logged."""
    account_id = v4(id)
    with pool.connection() as conn, conn.transaction():
        row = conn.execute(f"SELECT {auth.ACCOUNT_COLUMNS} FROM accounts a WHERE a.id = %s",
                           (account_id,)).fetchone()  # fmt: skip
        if row is None:
            fail(404, "unknown_account")
        whose = Account(*row)
        data = export_data(conn, whose)
        journal(conn, who, "export_account", account=whose.id, name=whose.pseudonym)
    return export_response(data, f"surveillance-world-donnees-{whose.pseudonym}.json")


@app.post("/api/review/account/suspend")
def review_account_suspend(body: AccountIn, who: Annotated[Account, Depends(reauthed)]):
    """« Suspendre et rejeter ses envois en attente » (stopping a vandal in one gesture):
    the account disabled, its sessions cut, and every pending contribution of its that
    waits for a decision rejected by the caller today — an add's answers by others going
    with it, as decide does; each undoable by /api/review/undo, decision by decision.
    Not one's own, never the last administrator. One `suspend` line, {"rejected":
    [uuids]}. {"rejected": n}."""
    today = date.today()
    with pool.connection() as conn, conn.transaction():
        t = target(conn, body, who)
        keep_an_admin(conn, t)
        conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (t["id"],))
        n = cut_sessions(conn, t["id"])
        waiting = conn.execute(
            f"SELECT uuid::text, camera_id, kind FROM contributions WHERE author_id = %s"
            f" AND status = 'pending' AND {DECIDABLE}", (t["id"],)).fetchall()  # fmt: skip
        for cam in sorted({c for _, c, _ in waiting}):
            conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (cam,))
        mine = sorted(u for u, _, _ in waiting)
        conn.execute(
            "UPDATE contributions SET status = 'rejected', decided_by_id = %s, decided_on = %s,"
            " operator_choice = CASE WHEN operator_proposed IS NULL THEN operator_choice END,"
            " operator_name = CASE WHEN operator_proposed IS NULL THEN operator_name END"
            " WHERE uuid = ANY(%s::uuid[]) AND status = 'pending'",
            (who.id, today, mine),
        )
        adds = sorted(u for u, _, kind in waiting if kind == "add")
        rejected = sorted({*mine, *reject_add_answers(conn, who, adds, action="suspend")})
        for cam in sorted({c for _, c, _ in waiting}):
            recompute(conn, cam)
        journal(conn, who, "suspend", account=t["id"], name=t["pseudonym"],
                detail={"rejected": rejected, "sessions": n})  # fmt: skip
    return {"rejected": len(rejected)}


# --- hidden cameras, for administrators (lot 2 « Retraits ») -------------------------------


def hidden_labels(conn, camera_ids: list[str]) -> dict[str, dict | None]:
    """How « Retraits » names a hidden camera: its label (labels) while the database knows
    it (in the served build, or by a contribution), else None."""
    known = {r[0] for r in conn.execute(
        "SELECT camera_id FROM cameras WHERE camera_id = ANY(%s) UNION"
        " SELECT camera_id FROM contributions WHERE camera_id = ANY(%s)",
        (camera_ids, camera_ids))}  # fmt: skip
    names = labels(conn, sorted(known))
    return {c: names.get(c) for c in camera_ids}


@app.get("/api/review/hidden", dependencies=[Depends(admin)])
def review_hidden():
    """« Retraits »: the hidden cameras, the latest first — the id, the day it was hidden,
    the build that left it out (null: still on the served map, until the next build is
    deployed), and its label while the database knows the camera."""
    with pool.connection() as conn:
        rows = conn.execute("SELECT camera_id, added_on::text, applied_build FROM hidden_cameras"
                            " ORDER BY added_on DESC, camera_id").fetchall()  # fmt: skip
        names = hidden_labels(conn, [r[0] for r in rows])
    return [{"camera": c, "added_on": d, "applied_build": b, "label": names[c]}
            for c, d, b in rows]  # fmt: skip


class HiddenIn(BaseModel):
    camera: str = Field(max_length=32)
    hide: bool


@app.post("/api/review/hidden")
def review_hide(body: HiddenIn, request: Request, who: Annotated[Account, Depends(admin)]):
    """Hide a camera (`hide` true): from the next build on, it leaves the map, its field,
    its streets and the counts (the build's first stage; the proposals at once); only its
    id and the day are kept. `known`: whether the database knows that id (a typo
    otherwise). Show it again (`hide` false): after the password again (403 reauth), back
    at the next build; 404 not_hidden. Journalled (hide, unhide), not when nothing
    changes. {camera, hidden, known, changed}."""
    camera = body.camera.strip()
    if not CAMERA_ID.fullmatch(camera):
        fail(422, "camera_id")
    if not body.hide:
        reauthed(request, who)
    with pool.connection() as conn, conn.transaction():
        known = hidden_labels(conn, [camera])[camera] is not None
        if body.hide:
            changed = conn.execute("INSERT INTO hidden_cameras (camera_id) VALUES (%s)"
                                   " ON CONFLICT DO NOTHING", (camera,)).rowcount == 1  # fmt: skip
        else:
            changed = conn.execute("DELETE FROM hidden_cameras WHERE camera_id = %s",
                                   (camera,)).rowcount == 1  # fmt: skip
            if not changed:
                fail(404, "not_hidden")
        if changed:
            journal(conn, who, "hide" if body.hide else "unhide", target=camera,
                    detail={"known": known})  # fmt: skip
    return {"camera": camera, "hidden": body.hide, "known": known, "changed": changed}


# --- the site's settings, for administrators (lot 2 « Réglages ») -------------------------


def site_settings_answer(conn) -> dict:
    """GET /api/review/settings: the switches as the database has them now, and the OSM
    lines: where people sign in, whether publishing is offered and on which server, and
    whether the live server's client is there (osm_write_live can be turned on)."""
    read = dict(conn.execute("SELECT key, value FROM site_settings").fetchall())
    values = {k: read.get(k, default) for k, default in SWITCH_DEFAULTS.items()}
    server = publish_server(values["osm_write_live"])
    return {
        **values,
        "publisher": settings.publisher,
        "osm": {"login_server": settings.osm_login_server, "write_offered": server is not None,
                "write_server": server.name if server else None,
                "live_client": live_write_server() is not None},
    }  # fmt: skip


@app.get("/api/review/settings", dependencies=[Depends(admin)])
def review_settings():
    """« Réglages »: the switches — contributions and sign-ups open or not, the OSM
    synchronisation on or suspended, writing to OSM's live server or its test server —
    and read only what the deploy sets: the publisher's identity, the OSM server people
    sign in on, whether publishing to OSM is offered and where."""
    with pool.connection() as conn:
        return site_settings_answer(conn)


class SettingIn(BaseModel):
    key: Literal[SWITCHES]
    value: bool


@app.post("/api/review/settings")
def review_setting(body: SettingIn, who: Annotated[Account, Depends(reauthed)]):
    """A switch changed (after the password again), its day kept, journalled with its new
    value; every route it governs follows within SWITCHES_TTL_S (at once in this process),
    the OSM job at its next pass. Nothing is deleted when contributions close. Writing to
    OSM's live server needs its client (409 no_live_client). Answers as GET."""
    if body.key == "osm_write_live" and body.value and live_write_server() is None:
        fail(409, "no_live_client")
    with pool.connection() as conn, conn.transaction():
        changed = conn.execute(
            "UPDATE site_settings SET value = %s, changed_on = %s WHERE key = %s"
            " AND value IS DISTINCT FROM %s",
            (body.value, date.today(), body.key, body.value),
        ).rowcount
        if changed:
            journal(conn, who, "setting", target=body.key, detail={"value": body.value})
        answer = site_settings_answer(conn)
    switches.forget()
    return answer
