"""Sign in with OpenStreetMap (OSM lot 1, scope `openid`; migration 015), and the second
pass that grants publishing (OSM lot 2, scope `openid write_api`: complete_write keeps that
token, lacarte.api.publish seals it).

OAuth 2.0 authorization code with PKCE S256 (RFC 7636) against the live server's endpoints,
read from its /.well-known/openid-configuration (OSM lot 1's contract):
/oauth2/authorize, /oauth2/token (client_secret_basic), /oauth2/revoke, and the id_token's
keys at /oauth2/discovery/keys. The id_token (RS256) gives `sub`, the OSM user's numeric
id, and `preferred_username`, the OSM name, which is never stored: only offered as the
pseudonym's suggestion while a sign-up waits. OSM's access tokens do not expire (wiki
« OAuth »): the one a sign-in gets is revoked at once (RFC 7009), whatever the id_token.

What waits in memory only (one uvicorn worker; lost at a restart, the person starts
again): the flows under way (state, nonce, code_verifier, where to go back), and the
sign-ups whose pseudonym is not chosen yet. Each 10 minutes, single use, 1 000 at most.

Nothing here logs more than an exception's class. Imported by the API only (its
dependency group: PyJWT with its crypto extra, the standard library's urllib).
"""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import logging
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlencode, urlsplit

import jwt

log = logging.getLogger("lacarte.api")

LIVE_URL = "https://www.openstreetmap.org"
DEV_URL = "https://master.apis.dev.openstreetmap.org"  # OSM's test server
SCOPE = "openid"
TTL_S = 600  # a flow or a sign-up waits 10 minutes
MAX_WAITING = 1_000  # of each; the oldest dropped first
TIMEOUT_S = 10  # each request to OSM
MAX_BODY = 1 << 20  # bytes read from an OSM answer
JWKS_LIFESPAN_S = 3600  # the keys are cached an hour
LEEWAY_S = 30  # clock skew allowed on the id_token's exp
DEFAULT_THEN = "/?ui=punk"
THEN_MAX = 2048
SUB_RE = re.compile(r"[1-9][0-9]{0,17}")  # a positive bigint, as a string
PSEUDONYM_MAX = 32  # accounts.pseudonym's CHECK
OUTSIDE_PSEUDONYM = re.compile(r"[^A-Za-z0-9._-]")


class OsmError(Exception):
    """OSM answered something we do not accept (no detail kept: it is never logged)."""


# Why an OSM return failed, as the callback's redirect says it (`osm_why`, shown by the page
# under ?debug=1 only; never logged): a fixed vocabulary, nothing from the request or OSM.
FLOW_UNKNOWN = "flux_inconnu"  # state unknown, used, expired, or lost at a restart
FLOW_SERVER = "flux_serveur"  # the server the flow started on is no longer configured
BROWSER = "navigateur"  # the flow cookie absent, or another browser's
OSM_ERROR = "refus_osm"  # OSM sent an error other than access_denied, or no code
CLIENT_REFUSED = "client_refuse"  # the token endpoint refused our client (401): id or secret
EXCHANGE_REFUSED = "echange_refuse"  # any other refusal of the code exchange
NETWORK = "reseau"  # no answer: connection, timeout, TLS, a cut answer
ID_TOKEN = "id_token"  # the id_token or its keys did not hold
RIGHTS = "droits"  # a write: OSM did not grant write_api
ACCOUNT = "compte"  # our side: the account gone, disabled, a test one, or storage failed


class Refused(Exception):
    """A step of the return failed for `reason` (one of the codes above); the cause is
    chained, and only its class is ever logged."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def cause(exc: BaseException) -> str:
    """The class logged for a failed return: the underlying one, as before the codes."""
    return type(exc.__cause__ if isinstance(exc, Refused) and exc.__cause__ else exc).__name__


# No answer: the connection, a timeout, TLS (ssl.SSLError is an OSError, raised raw while
# reading), a cut answer.
_NO_ANSWER = (urllib.error.URLError, OSError, http.client.HTTPException)


def _exchanged(server: Server, code: str, verifier: str) -> dict:
    try:
        return exchange(server, code, verifier)
    except urllib.error.HTTPError as exc:
        # RFC 6749 §5.2: invalid_client may come as 401 (client_secret_basic) or 400.
        try:
            error = json.loads(exc.read(MAX_BODY)).get("error")
        except Exception:  # noqa: BLE001
            error = None
        refused = exc.code == 401 or error == "invalid_client"
        raise Refused(CLIENT_REFUSED if refused else EXCHANGE_REFUSED) from exc
    except _NO_ANSWER as exc:
        raise Refused(NETWORK) from exc
    except (ValueError, OsmError) as exc:  # not JSON, not an object
        raise Refused(EXCHANGE_REFUSED) from exc


def _identified(server: Server, id_token: object, nonce: str) -> tuple[int, str]:
    try:
        return identity(server, id_token, nonce)
    except jwt.PyJWKClientConnectionError as exc:
        raise Refused(NETWORK) from exc
    except Exception as exc:  # noqa: BLE001 — PyJWT's errors, ours, a malformed key set
        raise Refused(ID_TOKEN) from exc


@dataclass(frozen=True)
class Server:
    """The server people sign in on, as the API is configured for it (OSM_LOGIN_SERVER: the
    test server `dev` by default, or `live`; a fake in tests)."""

    url: str  # also the id_token's issuer
    client_id: str
    client_secret: str
    redirect_uri: str  # ALLOWED_ORIGIN + /api/osm/callback, as the app registered it
    name: str = "dev"  # accounts.osm_server: OSM users are numbered apart on each server


@dataclass(frozen=True)
class Flow:
    kind: Literal["login", "link", "write"]
    nonce: str
    verifier: str
    then: str
    account: str | None = None  # a link's or a write's account (its session does not come back)
    # A secret also set in the browser that started the flow (the flow cookie): the
    # callback is answered only there, so that a callback URL handed to someone else
    # (login CSRF, a link forced onto another account) leads nowhere.
    browser: str = ""
    server: str = ""  # a write's server name: the callback answers it on that server only


@dataclass(frozen=True)
class Signup:
    sub: int
    osm_name: str
    then: str


class Waiting[T]:
    """Values under random keys, `ttl` seconds each, at most `size` (the oldest dropped
    first); `take` hands one out once. In memory, thread-safe."""

    def __init__(self, ttl: float = TTL_S, size: int = MAX_WAITING,
                 clock: Callable[[], float] = time.monotonic) -> None:  # fmt: skip
        self.ttl, self.size, self.clock = ttl, size, clock
        self.items: OrderedDict[str, tuple[float, T]] = OrderedDict()
        self.lock = threading.Lock()

    def put(self, key: str, value: T) -> None:
        with self.lock:
            now = self.clock()
            while self.items and now - next(iter(self.items.values()))[0] >= self.ttl:
                self.items.popitem(last=False)
            self.items[key] = (now, value)
            while len(self.items) > self.size:
                self.items.popitem(last=False)

    def get(self, key: str) -> T | None:
        with self.lock:
            entry = self.items.get(key)
            if entry is None or self.clock() - entry[0] >= self.ttl:
                return None
            return entry[1]

    def take(self, key: str) -> T | None:
        with self.lock:
            entry = self.items.pop(key, None)
            if entry is None or self.clock() - entry[0] >= self.ttl:
                return None
            return entry[1]

    def clear(self) -> None:
        with self.lock:
            self.items.clear()


flows: Waiting[Flow] = Waiting()
signups: Waiting[Signup] = Waiting()


# --- where to go back --------------------------------------------------------------------


def safe_then(raw: str | None) -> str:
    """`raw` when it is a path of this site (starts with one `/`, no backslash, no scheme or
    host, printable ASCII only: browsers drop tabs and newlines from a URL and read `\\` as
    `/`, so `/\\evil` or `/<tab>/evil` would become `//evil`), else DEFAULT_THEN. It may
    carry a query and a fragment."""
    if not raw or len(raw) > THEN_MAX or not raw.startswith("/") or raw.startswith("//"):
        return DEFAULT_THEN
    if "\\" in raw or any(not 0x21 <= ord(c) <= 0x7E for c in raw):
        return DEFAULT_THEN
    parts = urlsplit(raw)
    if parts.scheme or parts.netloc:
        return DEFAULT_THEN
    return raw


def with_status(then: str, status: str, why: str | None = None) -> str:
    """`then` with `osm=<status>` in its query, and `osm_why=<why>` for a failure, before
    its fragment (earlier `osm` and `osm_why` parameters replaced). `then` is safe_then's:
    its encoding is kept as it came."""
    rest, hash_, fragment = then.partition("#")
    path, _, query = rest.partition("?")
    params = [p for p in query.split("&")
              if p and p.partition("=")[0] not in ("osm", "osm_why")]  # fmt: skip
    params.append(f"osm={status}")
    if why:
        params.append(f"osm_why={why}")
    return f"{path}?{'&'.join(params)}{hash_}{fragment}"


# --- the authorization request -----------------------------------------------------------


def release(module: Path | None = None) -> str:
    """The API's release: the deploy's directory name (deploy.sh: <api>/releases/<stamp>,
    this module at <stamp>/pipeline/lacarte/api/osm.py, `current` a link to it), else
    `dev`."""
    root = (module or Path(__file__)).resolve().parents[3]
    return root.name if root.parent.name == "releases" else "dev"


def user_agent() -> str:
    # The OSMF API usage policy asks for a User-Agent naming the application and version.
    return f"SurveillanceWorld/{release()}"


def challenge(verifier: str) -> str:
    """RFC 7636 §4.2, S256: BASE64URL-ENCODE(SHA256(ASCII(code_verifier))), no padding."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def start(server: Server, kind: Literal["login", "link", "write"], then: str | None,
          account: str | None = None, scope: str = SCOPE) -> tuple[str, str]:  # fmt: skip
    """A new flow, kept under its `state`: the URL of OSM's authorization page, and the
    secret the starting browser keeps in the flow cookie."""
    state = secrets.token_urlsafe(32)
    # RFC 7636 §4.1: a verifier is 43 to 128 unreserved characters (64 here).
    flow = Flow(kind=kind, nonce=secrets.token_urlsafe(32), verifier=secrets.token_urlsafe(48),
                then=safe_then(then), account=account,
                browser=secrets.token_urlsafe(32), server=server.name)  # fmt: skip
    flows.put(state, flow)
    query = urlencode({
        "response_type": "code",
        "client_id": server.client_id,
        "redirect_uri": server.redirect_uri,
        "scope": scope,
        "state": state,
        "nonce": flow.nonce,
        "code_challenge": challenge(flow.verifier),
        "code_challenge_method": "S256",
    })  # fmt: skip
    return f"{server.url}/oauth2/authorize?{query}", flow.browser


# --- the token, the id_token, the revocation ---------------------------------------------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The token and revoke endpoints answer directly: a redirect is refused, not followed
    (the client's credentials would go along)."""

    def redirect_request(self, *_args, **_kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect())


def basic(server: Server) -> str:
    """client_secret_basic: RFC 6749 §2.3.1, the id and secret form-encoded, joined by `:`,
    base64 (deploy.sh only lets unreserved characters through, which encoding keeps)."""
    pair = f"{quote(server.client_id, safe='')}:{quote(server.client_secret, safe='')}"
    return "Basic " + base64.b64encode(pair.encode()).decode("ascii")


def post(server: Server, path: str, form: dict[str, str]) -> bytes:
    request = urllib.request.Request(
        server.url + path, data=urlencode(form).encode(), method="POST",
        headers={"Authorization": basic(server), "Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": user_agent()},
    )  # fmt: skip
    with _opener.open(request, timeout=TIMEOUT_S) as response:
        return response.read(MAX_BODY)


def exchange(server: Server, code: str, verifier: str) -> dict:
    """RFC 6749 §4.1.3 with RFC 7636 §4.5's code_verifier: the token response (JSON)."""
    body = post(server, "/oauth2/token", {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": server.redirect_uri,
        "code_verifier": verifier,
    })  # fmt: skip
    tokens = json.loads(body)
    if not isinstance(tokens, dict):
        raise OsmError("token response")
    return tokens


def revoke(server: Server, access_token: str) -> None:
    """RFC 7009 §2.1. A failure is logged by its class and does not stop anything."""
    try:
        post(server, "/oauth2/revoke",
             {"token": access_token, "token_type_hint": "access_token"})  # fmt: skip
    except Exception as exc:  # noqa: BLE001
        log.warning("osm revoke failed: %s", type(exc).__name__)


_jwks: dict[str, jwt.PyJWKClient] = {}
_jwks_lock = threading.Lock()


def jwks(server: Server) -> jwt.PyJWKClient:
    """The id_token's keys, one client per server URL. PyJWT 2.15's PyJWKClient (read in
    jwt/jwks_client.py): the whole set cached `lifespan` seconds (an hour here), and an
    unknown `kid` makes it fetch the set once more, then fail (get_signing_key);
    cooldown_duration=0, else a key OSM rotated within 30 s of the last fetch would wait.
    Redirects are not followed; `headers` go with each fetch."""
    uri = server.url + "/oauth2/discovery/keys"
    with _jwks_lock:
        client = _jwks.get(uri)
        if client is None:
            client = jwt.PyJWKClient(uri, cache_jwk_set=True, lifespan=JWKS_LIFESPAN_S,
                                     headers={"User-Agent": user_agent()}, timeout=TIMEOUT_S,
                                     cooldown_duration=0)  # fmt: skip
            _jwks[uri] = client
        return client


def identity(server: Server, id_token: object, nonce: str) -> tuple[int, str]:
    """(sub, preferred_username) of a valid id_token: RS256 on OSM's keys, our client in
    `aud`, OSM as `iss`, not expired, this flow's nonce. PyJWT 2.15's jwt.decode (read in
    jwt/api_jwt.py): `algorithms` fixed here, never taken from the token; `audience` and
    `issuer` checked; options.require refuses a token missing a claim; it does not know
    the nonce, compared here."""
    if not isinstance(id_token, str) or not 0 < len(id_token) <= 16384:
        raise OsmError("id_token")
    key = jwks(server).get_signing_key_from_jwt(id_token)
    required = ["exp", "iat", "iss", "aud", "sub", "nonce"]  # OIDC Core §2: iat required
    claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=server.client_id,
                        issuer=server.url, leeway=LEEWAY_S,
                        options={"require": required})  # fmt: skip
    if not secrets.compare_digest(str(claims["nonce"]), nonce):
        raise OsmError("nonce")
    sub = claims["sub"]
    if not isinstance(sub, str) or not SUB_RE.fullmatch(sub):
        raise OsmError("sub")
    name = claims.get("preferred_username")
    return int(sub), name if isinstance(name, str) else ""


def complete(server: Server, code: str, flow: Flow) -> tuple[int, str]:
    """The code exchanged (with the flow's verifier), the id_token checked, then the access
    token revoked whatever the check said: (sub, OSM name). A failure raises Refused."""
    tokens = _exchanged(server, code, flow.verifier)
    access = tokens.get("access_token")
    try:
        return _identified(server, tokens.get("id_token"), flow.nonce)
    finally:
        if isinstance(access, str) and access:
            revoke(server, access)


def permissions(server: Server, access_token: str) -> list[str]:
    """What the token may do, as OSM says it: GET /api/0.6/permissions.json (wiki « API
    v0.6 », « Retrieving permissions »: for OAuth 2.0 « the list will be based on the
    granted scopes », each prefixed `allow_`; JSON `{"permissions": [...]}`)."""
    request = urllib.request.Request(
        server.url + "/api/0.6/permissions.json",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json",
                 "User-Agent": user_agent()},
    )  # fmt: skip
    with _opener.open(request, timeout=TIMEOUT_S) as response:
        data = json.loads(response.read(MAX_BODY))
    granted = data.get("permissions") if isinstance(data, dict) else None
    if not isinstance(granted, list):
        raise OsmError("permissions")
    return [p for p in granted if isinstance(p, str)]


def complete_write(server: Server, code: str, flow: Flow) -> tuple[int, str]:
    """A write flow's end: the code exchanged, the id_token checked, and the token allowed
    to write: (sub, access token), the token kept — the caller seals it, or revokes it when
    the OSM user is not the account's. Any failure here revokes it before raising.
    Allowed to write: OSM's own list of the token's permissions holds allow_write_api (the
    person may untick « Modify the map » on OSM's page); a token response's `scope`, when
    it comes (RFC 6749 §5.1 lets a server leave it out when it equals the request), must
    hold write_api too. A failure raises Refused."""
    tokens = _exchanged(server, code, flow.verifier)
    access = tokens.get("access_token")
    if not isinstance(access, str) or not access:
        raise Refused(EXCHANGE_REFUSED) from OsmError("access_token")
    try:
        scope = tokens.get("scope")
        if scope is not None and (not isinstance(scope, str) or "write_api" not in scope.split()):
            raise Refused(RIGHTS) from OsmError("scope")
        sub, _ = _identified(server, tokens.get("id_token"), flow.nonce)
        try:
            granted = permissions(server, access)
        except urllib.error.HTTPError as exc:  # before _NO_ANSWER: it is a URLError
            # OSM down (5xx) is no answer about the rights; a 4xx refuses them.
            raise Refused(NETWORK if exc.code >= 500 else RIGHTS) from exc
        except _NO_ANSWER as exc:
            raise Refused(NETWORK) from exc
        except Exception as exc:  # noqa: BLE001 — an HTTP refusal, not JSON, not a list
            raise Refused(RIGHTS) from exc
        if "allow_write_api" not in granted:
            raise Refused(RIGHTS) from OsmError("permissions")
    except BaseException:
        revoke(server, access)
        raise
    return sub, access


# --- the pseudonym's suggestion ----------------------------------------------------------


def suggest(osm_name: str, sub: int, taken: Callable[[str], bool]) -> str:
    """The OSM name made a pseudonym: spaces as `_`, other characters outside
    [A-Za-z0-9._-] dropped, cut to 32; shorter than 2: osm_<sub>; taken (any case):
    _2, _3 … appended, the name cut to keep 32 at most."""
    base = OUTSIDE_PSEUDONYM.sub("", osm_name.replace(" ", "_"))[:PSEUDONYM_MAX]
    if len(base) < 2:
        base = f"osm_{sub}"[:PSEUDONYM_MAX]
    if not taken(base):
        return base
    for n in range(2, 1000):
        tail = f"_{n}"
        candidate = base[: PSEUDONYM_MAX - len(tail)] + tail
        if not taken(candidate):
            return candidate
    return base  # the person chooses another; POST /api/osm/signup says it is taken
