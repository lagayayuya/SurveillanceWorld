"""A fake OpenStreetMap for the sign-in tests, on 127.0.0.1 (never openstreetmap.org): the
endpoints its /.well-known/openid-configuration names,
as far as the API uses them.

- authorize: not served; `authorize(location)` reads the URL the API sent the browser to,
  as OSM's page would, and hands out a code for a fictitious user.
- POST /oauth2/token: client_secret_basic, grant_type, the code (single use), its
  redirect_uri, and the PKCE S256 code_verifier checked; an id_token signed RS256.
- POST /oauth2/revoke: recorded.
- GET /oauth2/discovery/keys: the published keys (a generated RSA key), fetches counted.
- API 0.6 (OSM lot 2), each with `Authorization: Bearer <a token issued, not revoked>` (else
  401): GET /api/0.6/permissions.json, GET /api/0.6/node/#id.json (404 unknown, 410
  deleted), GET /api/0.6/node/#id/ways.json (`ways[node]`, none by default), PUT
  changeset/create (the id as text), POST changeset/#id/upload (an OsmChange
  applied all or nothing: a <modify> of another version is 409; a diffResult back), PUT
  changeset/#id/close.
- The synchronisation's reads (migration 022), public: without a token, or with a valid
  one (an invalid one is 401): GET /api/0.6/changeset/#id (XML: <changeset id open
  changes_count>), GET /api/0.6/changeset/#id/download (the OsmChange of what it applied,
  with the nodes' real ids and versions), GET /api/0.6/map?bbox=left,bottom,right,top (XML:
  the nodes inside, with their tags). XML is these calls' default format (wiki « API v0.6 »).
- `status[op]` forces an answer for "permissions", "node", "ways", "create", "upload",
  "close", "changeset", "download" or "map"; `on_upload(body)` runs before an upload is applied (a
  test reads the database there). Every request's (method, path) is kept: a test counts
  them.

`tamper(claims, header) -> key or None` changes what the next id_tokens say or which key
signs them. Every request's User-Agent is kept, every request's method and path too.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import json
import re
import secrets
import threading
import time
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, urlsplit

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

CLIENT_ID = "fake-client-id"
CLIENT_SECRET = "fake-client-secret-not-a-secret"


def new_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeOsm:
    def __init__(self) -> None:
        self.keys = {"k1": new_key()}  # kid -> private key
        self.published = ["k1"]  # the kids /oauth2/discovery/keys lists
        self.signing = "k1"
        self.codes: dict[str, dict] = {}
        self.tokens: list[dict] = []  # each token request's form
        self.issued: list[str] = []  # access tokens handed out
        self.revoked: list[str] = []
        self.jwks_fetches = 0
        self.user_agents: list[str] = []
        self.tamper = None
        self.token_status = 200
        self.bare_keys = False  # the keys without `alg` nor `use` (both optional, RFC 7517)
        self.revoke_status = 200
        self.token_scope: str | None = None  # the token response's scope (None: the grant's)
        self.omit_scope = False  # the token response without `scope` (RFC 6749 §5.1)
        self.after_upload: int | None = None  # an upload applied, then answered so
        # The scopes each access token was granted: GET /api/0.6/permissions answers them.
        self.granted: dict[str, str] = {}
        self.permissions: list[str] | None = None  # None: from the grant
        self.permissions_status = 200
        self.requests: list[tuple[str, str]] = []  # (method, path) of every request
        self.nodes: dict[int, dict] = {}  # id -> {version, lat, lon, tags, deleted}
        self.changesets: dict[int, dict] = {}  # id -> {tags, open, token, uploads}
        self.status: dict[str, int] = {}  # op -> a forced answer
        self.on_upload = None
        self.maps: list[tuple[float, float, float, float]] = []  # each map call's bbox
        self.ways: dict[int, list[int]] = {}  # node id -> the ways it is a vertex of
        self.next_node = 1000
        self.next_changeset = 5000
        self.lock = threading.Lock()
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), self.handler())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def reset(self) -> None:
        self.keys = {"k1": self.keys["k1"]}
        self.published, self.signing = ["k1"], "k1"
        self.codes.clear()
        for log in (self.tokens, self.issued, self.revoked, self.user_agents, self.requests):
            log.clear()
        self.jwks_fetches = 0
        self.tamper = None
        self.token_status = self.revoke_status = 200
        self.bare_keys = False
        self.token_scope = None
        self.omit_scope = False
        self.after_upload = None
        self.granted.clear()
        self.permissions = None
        self.permissions_status = 200
        self.nodes.clear()
        self.changesets.clear()
        self.status.clear()
        self.on_upload = None
        self.maps.clear()
        self.ways.clear()

    # --- what OSM's authorization page does ---------------------------------------------

    def authorize(self, location: str, sub: int = 4242, name: str = "Fictitious Mapper") -> dict:
        """The person agrees: a code for this request; returns the request's parameters
        (`code` added)."""
        parts = urlsplit(location)
        assert f"{parts.scheme}://{parts.netloc}" == self.url, location
        assert parts.path == "/oauth2/authorize", location
        params = {k: v[0] for k, v in parse_qs(parts.query, strict_parsing=True).items()}
        code = secrets.token_urlsafe(16)
        self.codes[code] = {**params, "sub": sub, "name": name}
        return {**params, "code": code}

    # --- the endpoints ------------------------------------------------------------------

    def jwks(self) -> dict:
        keys = []
        for kid in self.published:
            jwk = jwt.algorithms.RSAAlgorithm.to_jwk(self.keys[kid].public_key(), as_dict=True)
            extra = {} if self.bare_keys else {"use": "sig", "alg": "RS256"}
            keys.append({**jwk, "kid": kid, **extra})
        return {"keys": keys}

    def id_token(self, grant: dict) -> str:
        now = int(time.time())
        claims = {"iss": self.url, "sub": str(grant["sub"]), "aud": grant["client_id"],
                  "exp": now + 120, "iat": now, "nonce": grant["nonce"],
                  "preferred_username": grant["name"]}  # fmt: skip
        header = {"kid": self.signing}
        key = self.keys.get(self.signing) or new_key()
        if self.tamper:
            key = self.tamper(claims, header) or key
        algorithm = header.pop("alg", "RS256")
        return jwt.encode(claims, key, algorithm=algorithm, headers=header)

    def token(self, form: dict, authorization: str) -> tuple[int, dict]:
        self.tokens.append({**form, "authorization": authorization})
        expected = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
        if authorization != f"Basic {expected}":
            return 401, {"error": "invalid_client"}
        if self.token_status != 200:
            return self.token_status, {"error": "server_error"}
        grant = self.codes.pop(form.get("code", ""), None)
        if form.get("grant_type") != "authorization_code" or grant is None:
            return 400, {"error": "invalid_grant"}
        verifier = form.get("code_verifier", "")
        digest = hashlib.sha256(verifier.encode()).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        if (grant["code_challenge_method"] != "S256" or challenge != grant["code_challenge"]
                or form.get("redirect_uri") != grant["redirect_uri"]):  # fmt: skip
            return 400, {"error": "invalid_grant"}
        access = secrets.token_urlsafe(24)
        self.issued.append(access)
        self.granted[access] = grant["scope"]
        scope = grant["scope"] if self.token_scope is None else self.token_scope
        answer = {"access_token": access, "token_type": "Bearer", "scope": scope,
                  "created_at": int(time.time()), "id_token": self.id_token(grant)}  # fmt: skip
        if self.omit_scope:
            del answer["scope"]
        return 200, answer

    # --- API 0.6 ----------------------------------------------------------------------

    def node(self, node_id: int, lon: float, lat: float, tags: dict, version: int = 1) -> int:
        """A node already on this server (a mapper's)."""
        self.nodes[node_id] = {"version": version, "lat": lat, "lon": lon, "tags": dict(tags),
                               "deleted": False}  # fmt: skip
        return node_id

    def edit(self, node_id: int, **tags) -> None:
        """Another mapper edits the node: its tags change, its version goes up."""
        n = self.nodes[node_id]
        n["tags"].update(tags)
        n["version"] += 1

    def bearer(self, authorization: str) -> str | None:
        token = authorization.removeprefix("Bearer ")
        ok = authorization.startswith("Bearer ") and token in self.issued
        return token if ok and token not in self.revoked else None

    def public(self, method: str, path: str) -> tuple[int, str, bytes] | None:
        """The public reads: a changeset, its content, a map's nodes; None for another path."""
        parts = urlsplit(path)
        m = re.fullmatch(r"/api/0\.6/changeset/(\d+)(/download)?", parts.path)
        if m and method == "GET":
            op = "download" if m.group(2) else "changeset"
            if op in self.status:
                return self.status[op], "text/plain", b""
            changeset = self.changesets.get(int(m.group(1)))
            if changeset is None:
                return 404, "text/plain", b""
            if op == "download":
                return 200, "application/xml", self.download(changeset)
            root = ET.Element("osm", version="0.6")
            ET.SubElement(root, "changeset", id=m.group(1),
                          open="true" if changeset["open"] else "false",
                          changes_count=str(len(changeset["applied"])))  # fmt: skip
            return 200, "application/xml", ET.tostring(root, encoding="utf-8")
        if parts.path == "/api/0.6/map" and method == "GET":
            if "map" in self.status:
                return self.status["map"], "text/plain", b""
            left, bottom, right, top = map(float, parse_qs(parts.query)["bbox"][0].split(","))
            root = ET.Element("osm", version="0.6")
            for nid, n in sorted(self.nodes.items()):
                if not n["deleted"] and left <= n["lon"] <= right and bottom <= n["lat"] <= top:
                    node = ET.SubElement(root, "node", id=str(nid), version=str(n["version"]),
                                         lat=str(n["lat"]), lon=str(n["lon"]))  # fmt: skip
                    for k, v in n["tags"].items():
                        ET.SubElement(node, "tag", k=k, v=v)
            self.maps.append((left, bottom, right, top))
            return 200, "application/xml", ET.tostring(root, encoding="utf-8")
        return None

    def download(self, changeset: dict) -> bytes:
        root = ET.Element("osmChange", version="0.6")
        for action, nid, version, lat, lon, tags in changeset["applied"]:
            block = ET.SubElement(root, action)
            node = ET.SubElement(block, "node", id=str(nid), version=str(version),
                                 lat=str(lat), lon=str(lon))  # fmt: skip
            for k, v in tags.items():
                ET.SubElement(node, "tag", k=k, v=v)
        return ET.tostring(root, encoding="utf-8")

    def api(
        self, method: str, path: str, body: bytes, authorization: str
    ) -> tuple[int, str, bytes]:
        """(status, content type, body) of an API 0.6 request."""
        token = self.bearer(authorization)
        if token is None and authorization:
            return 401, "text/plain", b"Couldn't authenticate you"
        public = self.public(method, path)
        if public is not None:
            return public
        if token is None:
            return 401, "text/plain", b"Couldn't authenticate you"
        if path == "/api/0.6/permissions.json" and method == "GET":
            if "permissions" in self.status:
                return self.status["permissions"], "text/plain", b""
            if self.permissions_status != 200:
                return self.permissions_status, "text/plain", b"Service unavailable"
            if self.permissions is not None:
                granted = self.permissions
            else:
                scopes = self.granted.get(token, "").split()
                granted = [f"allow_{s}" for s in scopes if s != "openid"]
            data = {"version": "0.6", "permissions": granted}
            return 200, "application/json", json.dumps(data).encode()
        m = re.fullmatch(r"/api/0\.6/node/(\d+)\.json", path)
        if m and method == "GET":
            if "node" in self.status:
                return self.status["node"], "text/plain", b""
            n = self.nodes.get(int(m.group(1)))
            if n is None:
                return 404, "text/plain", b""
            if n["deleted"]:
                return 410, "text/plain", b""
            element = {"type": "node", "id": int(m.group(1)), "lat": n["lat"], "lon": n["lon"],
                       "version": n["version"], "tags": n["tags"]}  # fmt: skip
            data = {"version": "0.6", "elements": [element]}
            return 200, "application/json", json.dumps(data).encode()
        m = re.fullmatch(r"/api/0\.6/node/(\d+)/ways\.json", path)
        if m and method == "GET":
            if "ways" in self.status:
                return self.status["ways"], "text/plain", b""
            ways = [{"type": "way", "id": w, "nodes": [int(m.group(1))]}
                    for w in self.ways.get(int(m.group(1)), [])]  # fmt: skip
            data = {"version": "0.6", "elements": ways}
            return 200, "application/json", json.dumps(data).encode()
        if path == "/api/0.6/changeset/create" and method == "PUT":
            if "create" in self.status:
                return self.status["create"], "text/plain", b""
            tags = {t.get("k"): t.get("v") for t in ET.fromstring(body).iter("tag")}
            with self.lock:
                self.next_changeset += 1
                cid = self.next_changeset
            self.changesets[cid] = {"tags": tags, "open": True, "token": token, "uploads": [],
                                    "applied": []}  # fmt: skip
            return 200, "text/plain", str(cid).encode()
        m = re.fullmatch(r"/api/0\.6/changeset/(\d+)/(upload|close)", path)
        if m:
            cid, op = int(m.group(1)), m.group(2)
            changeset = self.changesets.get(cid)
            if changeset is None:
                return 404, "text/plain", b""
            if (op, method) == ("close", "PUT"):
                if "close" in self.status:
                    return self.status["close"], "text/plain", b""
                changeset["open"] = False
                return 200, "text/plain", b""
            if (op, method) == ("upload", "POST"):
                if self.on_upload:
                    self.on_upload(body)
                if "upload" in self.status:
                    return self.status["upload"], "text/plain", b""
                if not changeset["open"] or changeset["token"] != token:
                    return 409, "text/plain", b""
                applied = self.apply(cid, body)
                if self.after_upload is not None and applied[0] == 200:
                    return self.after_upload, "text/plain", b""  # a proxy's 5xx, OSM committed
                return applied
        return 404, "text/plain", b""

    def apply(self, cid: int, body: bytes) -> tuple[int, str, bytes]:
        """An OsmChange, all or nothing: a <modify> of another version than the node's, or of
        a node that is not there, changes nothing (409)."""
        change = ET.fromstring(body)
        self.changesets[cid]["uploads"].append(body)
        nodes = {k: {**v, "tags": dict(v["tags"])} for k, v in self.nodes.items()}
        diff = ET.Element("diffResult", version="0.6")
        applied = []
        for block in change:
            for n in block.iter("node"):
                if n.get("changeset") != str(cid):
                    return 409, "text/plain", b""
                tags = {t.get("k"): t.get("v") for t in n.iter("tag")}
                lat, lon = float(n.get("lat")), float(n.get("lon"))
                if block.tag == "create":
                    self.next_node += 1
                    new = self.next_node
                    nodes[new] = {"version": 1, "lat": lat, "lon": lon, "tags": tags,
                                  "deleted": False}  # fmt: skip
                    ET.SubElement(diff, "node", old_id=n.get("id"), new_id=str(new),
                                  new_version="1")  # fmt: skip
                    applied.append(("create", new, 1, lat, lon, tags))
                elif block.tag == "modify":
                    old = nodes.get(int(n.get("id")))
                    if old is None or old["deleted"] or str(old["version"]) != n.get("version"):
                        return 409, "text/plain", b""
                    old.update(version=old["version"] + 1, lat=lat, lon=lon, tags=tags)
                    ET.SubElement(diff, "node", old_id=n.get("id"), new_id=n.get("id"),
                                  new_version=str(old["version"]))  # fmt: skip
                    applied.append(("modify", int(n.get("id")), old["version"], lat, lon, tags))
                else:
                    return 400, "text/plain", b""
        self.nodes = nodes
        self.changesets[cid]["applied"] += applied
        return 200, "application/xml", ET.tostring(diff, encoding="utf-8")

    def handler(self):
        fake = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def answer(self, status: int, body: dict) -> None:
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def raw(self, status: int, ctype: str, data: bytes) -> None:
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def body(self) -> bytes:
                return self.rfile.read(int(self.headers.get("Content-Length", "0")))

            def seen(self) -> None:
                fake.user_agents.append(self.headers.get("User-Agent", ""))
                fake.requests.append((self.command, self.path))

            def do_GET(self):  # noqa: N802
                self.seen()
                if self.path == "/oauth2/discovery/keys":
                    fake.jwks_fetches += 1
                    return self.answer(200, fake.jwks())
                if self.path.startswith("/api/0.6/"):
                    return self.raw(*fake.api("GET", self.path, b"",
                                              self.headers.get("Authorization", "")))  # fmt: skip
                return self.answer(404, {})

            def do_PUT(self):  # noqa: N802
                self.seen()
                return self.raw(*fake.api("PUT", self.path, self.body(),
                                          self.headers.get("Authorization", "")))  # fmt: skip

            def do_POST(self):  # noqa: N802
                self.seen()
                data = self.body()
                authorization = self.headers.get("Authorization", "")
                if self.path.startswith("/api/0.6/"):
                    return self.raw(*fake.api("POST", self.path, data, authorization))
                form = {k: v[0] for k, v in parse_qs(data.decode()).items()}
                if self.path == "/oauth2/token":
                    return self.answer(*fake.token(form, authorization))
                if self.path == "/oauth2/revoke":
                    fake.revoked.append(form.get("token", ""))
                    return self.answer(fake.revoke_status, {})
                return self.answer(404, {})

            def log_message(self, *_args):
                pass

        return Handler
