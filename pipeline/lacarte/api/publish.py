"""Publish to OpenStreetMap in the person's name (OSM lot 2, migration 016, rules/publish.yaml;
the synchronisation of 16/10, migration 022).

The person chooses « Publier aussi sur OpenStreetMap en mon nom » (a second pass through
OSM with the `write_api` scope: the token is kept, sealed with AES-256-GCM under
OSM_TOKEN_KEY, and the day she chose it is her consent day); then the API's job
(lacarte.api.sync) sends what she observed on site since that day, once the review
accepted it and a build applied it, exactly as she answered it: one changeset per person
per pass. Everything here goes to the write server only (OSM's test server unless /revue
switched writing to the live one: app.py).

OSM API 0.6, as the contract's « Facts read » give it: PUT /changeset/create (the id as
text), POST /changeset/#id/upload (an OsmChange, all or nothing; a diffResult back; 409 on a
version conflict), PUT /changeset/#id/close, GET /node/#id.json (410 deleted, 404 unknown);
and GET /map?bbox= (XML, the API's default format: the nodes around an add, before it is
created). Hypothesis, not in those facts: the JSON of a node is {"elements": [{"type":
"node", "id", "lat", "lon", "version", "tags"}]}; an answer of another shape is refused.

Nothing here logs more than a class or an HTTP status: never a token, a user id, a node or
a changeset id.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import math
import re
import secrets
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

import yaml
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from lacarte import participation, regions
from lacarte.api import osm

log = logging.getLogger("lacarte.api")

WRITE_SCOPE = "openid write_api"
KEY_BYTES = 32  # AES-256
NONCE_BYTES = 12  # GCM's 96-bit nonce, random per token
API = "/api/0.6"
KINDS = ("add", "move", "verify", "shape", "direction", "operator")  # no height (publish.yaml v2)
NO_ANSWER = ("unknown", "not_visible")
EDITED = ("listed", "none")  # operator_choice: a name the review chose, or dropped
EARTH_M = 6_371_008.8  # mean radius
METRES_PER_DEGREE = EARTH_M * math.pi / 180
PARTIAL_DATE = re.compile(r"[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?")
CHANGESET_ID = re.compile(r"[1-9][0-9]{0,17}")


def rules() -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / "publish.yaml").read_text())


# --- the write token -----------------------------------------------------------------------


def token_key(raw: str) -> bytes | None:
    """OSM_TOKEN_KEY: base64 of exactly 32 bytes, else None (writing off)."""
    try:
        key = base64.b64decode(raw.strip(), validate=True)
    except (binascii.Error, ValueError):
        return None
    return key if len(key) == KEY_BYTES else None


def associated(account_id: str, server: str) -> bytes:
    """The token's associated data: a row copied onto another account or server does not
    open."""
    return f"{account_id}:{server}".encode()


def seal(key: bytes, account_id: str, server: str, token: str) -> bytes:
    """12 random bytes (the nonce) || AES-256-GCM ciphertext and tag."""
    nonce = secrets.token_bytes(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, token.encode(), associated(account_id, server))


def unseal(key: bytes, account_id: str, server: str, sealed: bytes) -> str:
    """The token; cryptography.exceptions.InvalidTag for another key, account or server."""
    sealed = bytes(sealed)
    nonce, box = sealed[:NONCE_BYTES], sealed[NONCE_BYTES:]
    return AESGCM(key).decrypt(nonce, box, associated(account_id, server)).decode()


# --- OSM API 0.6, with the person's token --------------------------------------------------


class Refused(Exception):
    """OSM answered an error status (`status`), or nothing we can read (None: no answer, a
    timeout, a body of another shape)."""

    def __init__(self, status: int | None) -> None:
        super().__init__(status)
        self.status = status


def refusal(exc: Refused) -> str:
    return f"HTTP {exc.status}" if exc.status is not None else "no answer"


def call(url: str, token: str | None, method: str, path: str, body: bytes | None = None) -> bytes:
    """One request: the Bearer token (none for a public read), our User-Agent, a timeout,
    no redirect followed (a 3xx is a refusal: the token would go along), the answer read up
    to osm.MAX_BODY."""
    headers = {"User-Agent": osm.user_agent()}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "text/xml; charset=utf-8"
    request = urllib.request.Request(url + API + path, data=body, method=method, headers=headers)
    try:
        with osm._opener.open(request, timeout=osm.TIMEOUT_S) as response:
            return response.read(osm.MAX_BODY)
    except urllib.error.HTTPError as exc:
        raise Refused(exc.code) from None
    except (OSError, ValueError):  # URLError, a timeout, a reset connection
        raise Refused(None) from None


@dataclass(frozen=True)
class Node:
    id: int
    version: int
    lon: float
    lat: float
    tags: dict[str, str]


def read_node(url: str, token: str, node_id: int) -> Node | None:
    """The node as OSM has it now; None when it is deleted (410) or unknown (404)."""
    try:
        body = call(url, token, "GET", f"/node/{node_id}.json")
    except Refused as exc:
        if exc.status in (404, 410):
            return None
        raise
    try:
        (element,) = [e for e in json.loads(body)["elements"]
                      if e.get("type") == "node" and e.get("id") == node_id]  # fmt: skip
        tags = element.get("tags") or {}
        if not isinstance(tags, dict):
            raise TypeError
        return Node(node_id, int(element["version"]), float(element["lon"]),
                    float(element["lat"]), {str(k): str(v) for k, v in tags.items()})  # fmt: skip
    except (ValueError, KeyError, TypeError, AttributeError):
        raise Refused(None) from None


def in_ways(url: str, token: str, node_id: int) -> bool:
    """Whether the node is a vertex of a way (GET /node/#id/ways.json, its `elements`;
    empty when it is in none, as read on OSM's test and live servers on 2026-10-16):
    moving it would move the way (a building, a wall), so a move of it never leaves."""
    body = call(url, token, "GET", f"/node/{node_id}/ways.json")
    try:
        return bool(json.loads(body)["elements"])
    except (ValueError, KeyError, TypeError):
        raise Refused(None) from None


def nodes_around(url: str, token: str | None, lon: float, lat: float, metres: float) -> list[Node]:
    """The nodes OSM has within a box `metres` around a point (GET /map?bbox=, XML)."""
    dlat = metres / METRES_PER_DEGREE
    dlon = dlat / max(math.cos(math.radians(lat)), 0.01)
    bbox = ",".join(fmt(v) for v in (lon - dlon, lat - dlat, lon + dlon, lat + dlat))
    body = call(url, token, "GET", f"/map?bbox={bbox}")
    try:
        out = []
        for n in ET.fromstring(body).iter("node"):
            tags = {t.get("k", ""): t.get("v", "") for t in n.iter("tag")}
            out.append(Node(int(n.get("id", "")), int(n.get("version", "")),
                            float(n.get("lon", "")), float(n.get("lat", "")), tags))  # fmt: skip
        return out
    except (ET.ParseError, ValueError):
        raise Refused(None) from None


def metres_between(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Equirectangular: exact enough for a few metres."""
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(x, math.radians(lat2 - lat1)) * EARTH_M


def is_camera(tags: dict[str, str], not_cameras: set[str]) -> bool:
    """An OSM camera as the build counts one (man_made=surveillance, unless every
    surveillance:type is one of not_cameras: lacarte.normalize.is_camera)."""
    if tags.get("man_made") != "surveillance":
        return False
    types = {v.strip().lower() for v in tags.get("surveillance:type", "").split(";") if v.strip()}
    return not types or not types <= not_cameras


def open_changeset(url: str, token: str, tags: dict[str, str]) -> int:
    root = ET.Element("osm")
    changeset = ET.SubElement(root, "changeset")
    for k, v in tags.items():
        ET.SubElement(changeset, "tag", k=k, v=v)
    body = call(url, token, "PUT", "/changeset/create", ET.tostring(root, encoding="utf-8"))
    text = body.decode("ascii", "replace").strip()
    if not CHANGESET_ID.fullmatch(text):
        raise Refused(None)
    return int(text)


def upload(url: str, token: str, changeset: int, change: bytes) -> bytes:
    return call(url, token, "POST", f"/changeset/{changeset}/upload", change)


def diff_result(body: bytes) -> dict[int, tuple[int, int]]:
    """old_id -> (new_id, new_version) of each node of a diffResult."""
    out = {}
    for node in ET.fromstring(body).iter("node"):
        out[int(node.get("old_id", ""))] = (int(node.get("new_id", "")),
                                            int(node.get("new_version", "")))  # fmt: skip
    return out


def close_changeset(url: str, token: str, changeset: int) -> None:
    """Best effort: OSM closes an idle changeset itself after an hour."""
    try:
        call(url, token, "PUT", f"/changeset/{changeset}/close", b"")
    except Refused as exc:
        log.warning("osm changeset close failed: %s", refusal(exc))


def fmt(degrees: float) -> str:
    return f"{degrees:.7f}"


def osm_change(changeset: int, creates: list[tuple[int, float, float, dict]],
               modifies: list[tuple[int, int, float, float, dict]]) -> bytes:  # fmt: skip
    """An OsmChange: <create> nodes with placeholder ids (-1, -2 …) and all their tags,
    <modify> nodes with the version read, their position and ALL their tags (Wiki
    « OsmChange »: there is no change at the tag level)."""
    root = ET.Element("osmChange", version="0.6", generator=osm.user_agent())

    def node(parent, attrs, tags):
        n = ET.SubElement(parent, "node", attrs)
        for k in sorted(tags):
            ET.SubElement(n, "tag", k=k, v=tags[k])

    if creates:
        block = ET.SubElement(root, "create")
        for placeholder, lon, lat, tags in creates:
            node(block, {"id": str(placeholder), "changeset": str(changeset), "lat": fmt(lat),
                         "lon": fmt(lon)}, tags)  # fmt: skip
    if modifies:
        block = ET.SubElement(root, "modify")
        for node_id, version, lon, lat, tags in modifies:
            attrs = {"id": str(node_id), "changeset": str(changeset), "version": str(version),
                     "lat": fmt(lat), "lon": fmt(lon)}  # fmt: skip
            node(block, attrs, tags)
    return ET.tostring(root, encoding="utf-8")


# --- what may leave (rules/publish.yaml) ------------------------------------------------


@dataclass
class Contribution:
    uuid: str
    kind: str
    camera: str
    osm_type: str | None
    osm_id: int | None
    held: int | None  # the OSM version it is held against (apply_detail's, else its own)
    answer: str | None
    direction: int | None
    operator_name: str | None
    osm_tags: dict
    day: date
    seq: int | None
    lon: float
    lat: float
    old: list | None  # a move's served position, [lon, lat]
    on_site: bool
    sent: bool  # a row in osm_publications for this server
    household: bool
    operator_choice: str | None  # the review's choice on a proposed name (migration 017)
    dome_count: int | None = None  # « Multi-boules »: its number of domes (migration 025)
    tags: dict[str, str] = field(default_factory=dict)  # what it sets on OSM

    @property
    def edited(self) -> bool:
        """The review changed what the person sent (rules/publish.yaml exact)."""
        return self.operator_choice in EDITED


@dataclass
class Item:
    camera: str
    action: str  # create | modify
    node: int | None
    node_version: int | None  # osm_nodes': the version we last left it at
    osm_type: str | None
    lon: float
    lat: float
    contributions: list[Contribution]
    kind: str = "unknown"
    operator: str | None = None


SELECTION_SQL = """
SELECT c.uuid::text, c.kind, c.camera_id, c.osm_type, c.osm_id,
       coalesce((c.apply_detail ->> 'osm_version')::integer, c.osm_version), c.answer,
       c.direction_deg, c.operator_name, coalesce(c.osm_tags, '{}'), c.day, c.decision_seq,
       ST_X(ST_Transform(c.geom, 4326)), ST_Y(ST_Transform(c.geom, 4326)), c.payload -> 'old',
       c.on_site IS TRUE,
       EXISTS (SELECT FROM osm_publications p WHERE p.uuid = c.uuid AND p.server = %(server)s),
       EXISTS (SELECT FROM contributions h WHERE h.camera_id = c.camera_id
               AND h.kind = 'operator' AND h.answer = 'household'
               AND h.status NOT IN ('rejected', 'withdrawn')),
       c.operator_choice, c.dome_count
FROM contributions c
WHERE c.author_id = %(account)s AND c.status = 'applied' AND c.sync_chosen
  AND c.kind = ANY(%(kinds)s) AND coalesce(c.answer, '') <> ALL(%(blank)s)
  AND NOT EXISTS (SELECT FROM accounts a WHERE a.id = c.author_id AND (a.test OR a.disabled))
  AND c.camera_id NOT IN (SELECT camera_id FROM hidden_cameras)
"""


def answer_tags(c: Contribution, answers: dict) -> dict[str, str]:
    """The tags an answer sets (rules/publish.yaml answers); {} for one that sends nothing
    (an add and a move send their node and position instead)."""
    if c.kind in ("shape", "verify") and c.answer is not None:
        tags = answers[c.kind].get(c.answer)
        if c.kind == "verify":
            return {tags: c.day.isoformat()} if tags else {}
        if c.answer == "multidome":  # rules/publish.yaml multidome: with its number only
            return {**tags, answers["dome_count"]: str(c.dome_count)} if c.dome_count else {}
        return dict(tags or {})
    if c.kind == "direction" and c.direction is not None:
        return {answers["direction"]: str(c.direction)}
    if c.kind == "operator" and c.answer in answers["operator"]:
        tags = dict(answers["operator"][c.answer] or {})
        if c.operator_name:
            tags[answers["operator_name"]] = c.operator_name
        return tags
    return {}


def rank(c: Contribution) -> tuple:
    """The build's order (export_contributions.sql): the day, then the review's decision
    order (a decision before the counter first), then the uuid for a stable tie."""
    return (c.day, c.seq is not None, c.seq or 0, c.uuid)


def leaves(c: Contribution, since: date | None) -> bool:
    """Whether the person's latest answer to a question goes to OSM (rules/publish.yaml):
    made on site, not sent to that server yet, on no household's camera, exactly what she
    sent (exact), observed on or after her consent day (consent: `since`), and saying
    something OSM can hold."""
    return (c.on_site and not c.sent and not c.household and not c.edited
            and (since is None or c.day >= since)
            and (c.kind in ("add", "move") or bool(c.tags)))  # fmt: skip


def selection(conn, account_id: str, server: str,
              since: date | None = None) -> tuple[list[Item], int]:  # fmt: skip
    """(items, elsewhere): what goes to `server` for this account, one item per camera, and
    how many contributions are on OSM cameras the test server does not have. `since`: the
    consent day, nothing observed before it (None: no such bound)."""
    answers = rules()["answers"]
    params = {"account": account_id, "server": server, "kinds": list(KINDS),
              "blank": list(NO_ANSWER)}  # fmt: skip
    rows = conn.execute(SELECTION_SQL, params)
    latest: dict[tuple[str, str], Contribution] = {}
    for r in rows:
        c = Contribution(*r)
        key = (c.camera, c.kind)
        if key not in latest or rank(c) > rank(latest[key]):
            latest[key] = c
    by_camera: dict[str, list[Contribution]] = defaultdict(list)
    for c in latest.values():
        c.tags = answer_tags(c, answers)
        if leaves(c, since):
            by_camera[c.camera].append(c)
    if not by_camera:
        return [], 0
    cams = sorted(by_camera)
    nodes = {cam: (n, v) for cam, n, v in conn.execute(
        "SELECT camera_id, node_id, version FROM osm_nodes WHERE server = %s"
        " AND camera_id = ANY(%s)", (server, cams))}  # fmt: skip
    served = {cam: rest for cam, *rest in conn.execute(
        "SELECT camera_id, kind, operator_norm, ST_X(ST_Transform(geom, 4326)),"
        " ST_Y(ST_Transform(geom, 4326)) FROM cameras WHERE camera_id = ANY(%s)",
        (cams,))}  # fmt: skip
    # An added camera no build has yet: where its add placed it.
    added_at = {cam: (x, y) for cam, x, y in conn.execute(
        "SELECT camera_id, ST_X(ST_Transform(geom, 4326)), ST_Y(ST_Transform(geom, 4326))"
        " FROM contributions WHERE kind = 'add' AND camera_id = ANY(%s)", (cams,))}  # fmt: skip
    shape_kinds = participation.questions()["shape"]["kinds"]
    items, elsewhere = [], 0
    for cam in cams:
        cs = sorted(by_camera[cam], key=lambda c: (KINDS.index(c.kind), c.uuid))
        osm_type = cs[0].osm_type
        node, version = nodes.get(cam, (None, None))
        if osm_type == "n":
            if server != "live":  # the test server's database has none of the map's cameras
                elsewhere += len(cs)
                continue
            action, node = "modify", cs[0].osm_id
        elif osm_type is not None:  # ways and relations: never
            continue
        elif node is not None:
            action = "modify"
            cs = [c for c in cs if c.kind != "add"]  # created already
        elif cs[0].kind == "add":  # the add is the person's own and goes with its answers
            action = "create"
        else:  # someone else's add, not on this server: its answers wait for it
            continue
        if not cs:
            continue
        kind, operator, *at = served.get(cam) or ("unknown", None, *added_at.get(cam, (0, 0)))
        move = next((c for c in cs if c.kind == "move"), None)
        add = next((c for c in cs if c.kind == "add"), None)
        lon, lat = (move.lon, move.lat) if move else (add.lon, add.lat) if add else at
        shape = next((c for c in cs if c.kind == "shape"), None)
        op = next((c for c in cs if c.kind == "operator"), None)
        items.append(Item(cam, action, node, version, osm_type, lon, lat, cs,
                          shape_kinds.get(shape.answer, kind) if shape else kind,
                          op.operator_name if op else operator))  # fmt: skip
    return items, elsewhere


def says_something(
    kind: str,
    answer: str | None,
    direction: int | None,
    operator_name: str | None,
    operator_proposed: str | None = None,
    dome_count: int | None = None,
) -> bool:
    """Whether an answer of this kind can set something on OSM (rules/publish.yaml answers):
    an add or a move always; a shape (« Multi-boules » with its number only), « toujours
    là : oui », a direction; an operator « commerce ou entreprise », or a public one with a
    name (chosen, or proposed and maybe accepted). Never a household, « introuvable », « je
    ne sais pas »."""
    answers = rules()["answers"]
    if kind in ("add", "move"):
        return True
    if kind == "operator" and answer == "public":
        return bool(operator_name or operator_proposed)
    c = Contribution("", kind, "", None, None, None, answer, direction, operator_name, {},
                     date.min, None, 0.0, 0.0, None, True, False, False, None,
                     dome_count)  # fmt: skip
    return kind in KINDS and answer not in NO_ANSWER and bool(answer_tags(c, answers))


def kept_reason(kind: str, answer: str | None, dome_count: int | None) -> str | None:
    """Why an answer that says something on Surveillance World stays there by rule, or
    None: « Multi-boules » without its number of domes (rules/publish.yaml multidome)."""
    if kind == "shape" and answer == "multidome" and dome_count is None:
        return rules()["multidome"]["reason"]
    return None


HISTORY_SQL = """
SELECT c.uuid::text, c.kind, c.camera_id, c.osm_type, c.status, c.day, c.on_site IS TRUE,
       c.answer, c.direction_deg, c.operator_name, c.operator_proposed, c.operator_choice,
       c.decision_seq,
       EXISTS (SELECT FROM contributions h WHERE h.camera_id = c.camera_id
               AND h.kind = 'operator' AND h.answer = 'household'
               AND h.status NOT IN ('rejected', 'withdrawn')),
       c.camera_id IN (SELECT camera_id FROM hidden_cameras),
       p.state, p.reason, p.changeset, to_char(p.month, 'YYYY-MM'), c.dome_count
FROM contributions c
LEFT JOIN osm_publications p ON p.uuid = c.uuid AND p.server = %(server)s
WHERE c.author_id = %(account)s AND c.kind = ANY(%(kinds)s)
  AND coalesce(c.answer, '') <> ALL(%(blank)s)
  AND (p.uuid IS NOT NULL OR c.status IN ('pending', 'validated', 'applied'))
  AND (%(camera)s::text IS NULL OR c.camera_id = %(camera)s)
ORDER BY c.day DESC, c.uuid
"""
HISTORY_MAX = 200
# What became of a contribution on OSM, as « Compte » says it: its publication's state.
STATE_SAID = {"published": "gone", "conflict": "conflict", "uncertain": "uncertain",
              "sending": "sending"}  # fmt: skip


def history(conn, account_id: str, server: str, consent: date | None,
            camera: str | None = None) -> list[dict]:  # fmt: skip
    """GET /api/osm/sync's history, newest first (HISTORY_MAX at most): each of the
    person's contributions that went to `server` (gone, conflict, uncertain, sending:
    month and changeset), and while her choice is on (`consent`, her consent day), each
    that may still leave there: waiting (its status says whether the review or a build is
    still to come), or kept on Surveillance World — observed before her choice
    (kept_before), changed by the review (kept_edited), or kept by a rule whatever the
    review says (kept_rule, with its `reason`: multidome_count_unknown, « Multi-boules »
    without its number, rules/publish.yaml multidome). Nothing else that can never leave (not
    on site, a household's or a hidden camera, an answer OSM cannot hold, an OSM camera on
    the test server), nor an older accepted answer her later one replaced. Months, never
    a day. `camera`: that camera's only (/revue's window), every one of them."""
    rows = conn.execute(HISTORY_SQL, {"server": server, "account": account_id,
                                      "kinds": list(KINDS), "blank": list(NO_ANSWER),
                                      "camera": camera})  # fmt: skip
    out, latest = [], {}
    rows = rows.fetchall()
    for r in rows:  # the latest applied answer per camera and question (rule latest)
        uid, kind, cam, _, status, day, *_, seq = r[:13]
        if status == "applied":
            rank_ = (day, seq is not None, seq or 0, uid)
            if (cam, kind) not in latest or rank_ > latest[(cam, kind)]:
                latest[(cam, kind)] = rank_
    for (uid, kind, cam, osm_type, status, day, on_site, answer, direction, name, proposed,
         choice, seq, household, hidden, state, reason, changeset, month,
         count) in rows:  # fmt: skip
        item = {"uuid": uid, "camera": cam, "kind": kind, "status": status,
                "changeset": changeset, "reason": reason}  # fmt: skip
        if state is not None:
            out.append({**item, "state": STATE_SAID[state], "month": month})
        elif consent is not None:
            kept = kept_reason(kind, answer, count)
            if (
                not on_site
                or household
                or hidden
                or osm_type in ("w", "r")
                or (osm_type == "n" and server != "live")
                or (
                    kept is None
                    and not says_something(kind, answer, direction, name, proposed, count)
                )
                or (
                    status == "applied"
                    and latest[(cam, kind)] != (day, seq is not None, seq or 0, uid)
                )
            ):
                continue  # fmt: skip
            said = ("kept_rule" if kept else "kept_before" if day < consent
                    else "kept_edited" if choice in EDITED else "waiting")  # fmt: skip
            out.append({**item, "state": said, "month": day.strftime("%Y-%m"),
                        **({"reason": kept} if kept else {})})  # fmt: skip
        if camera is None and len(out) >= HISTORY_MAX:
            break
    return out


def outcome(key: str, current: str | None, value: str) -> str:
    """never_overwrite: `send` when the node lacks the tag, `same` when it already has this
    value, `conflict` for another value — but check_date, sent when older than the day
    (a check_date that is no date: conflict)."""
    if current is None:
        return "send"
    if key == "check_date":
        if not PARTIAL_DATE.fullmatch(current):
            return "conflict"
        return "send" if current < value[: len(current)] else "same"
    return "same" if current == value else "conflict"


def default_comment(kinds: list[str]) -> str | None:
    """« Caméras de surveillance relevées sur place : 1 ajout, 2 directions … »; None for
    nothing."""
    if not kinds:
        return None
    cs = rules()["changeset"]
    parts = []
    for kind, (one, many) in cs["comment_words"].items():
        n = kinds.count(kind)
        if n:
            parts.append(f"{n} {one if n == 1 else many}")
    return cs["comment_prefix"] + ", ".join(parts)


# --- sending ----------------------------------------------------------------------------------


def held_against(c: Contribution, item: Item, node: Node, keys: dict) -> str | None:
    """The conflict reason (rules/publish.yaml held), or None."""
    if item.osm_type is None:  # a node we created: the version we left it at
        return None if node.version == item.node_version else "osm_version"
    accepted = {c.held, item.node_version} - {None}
    if c.kind in ("move", "verify"):
        return None if node.version in accepted else "osm_version"
    return None if all(node.tags.get(k) == c.osm_tags.get(k) for k in keys[c.kind]) else "osm_tags"


def fine_keys() -> dict[str, list[str]]:
    keys = dict(participation.contributions()["fine_conflict"]["keys"])
    keys.update(rules()["held"]["keys"])
    return keys


class Stop(Exception):
    """Nothing more goes for this person in this pass: `error` is what the job keeps of it —
    revoked (401: the token is dead), blocked (403 with the right to write: OSM blocked
    her), rate_limited (429), osm_down (no answer, a 5xx, another refusal), changed (409 at
    the upload: OSM changed since the nodes were read; the next pass reads them again) or
    off (her choice ended while the pass ran). Nothing was written but what `record` says:
    the `sending` rows of an upload OSM refused are deleted, those of an upload without a
    clear answer stay (lacarte.api.sync reconciles them)."""

    def __init__(self, error: str) -> None:
        super().__init__(error)
        self.error = error


def stopped(exc: Refused) -> Stop:
    return Stop({401: "revoked", 403: "blocked", 429: "rate_limited"}.get(exc.status or 0,
                                                                          "osm_down"))  # fmt: skip


def changeset_comment(kinds: list[str]) -> str:
    """What the changeset holds, in plain words, with the hashtag and the project's page
    (rules/publish.yaml changeset): « Caméras de surveillance relevées sur place : 1 ajout,
    2 directions #SurveillanceWorld https://… »."""
    cs = rules()["changeset"]
    return ((default_comment(kinds) or cs["comment_prefix"].rstrip(" :")) +
            cs["comment_suffix"])[: cs["comment_max"]]  # fmt: skip


def duplicates(server: osm.Server, token: str, item: Item) -> bool:
    """An OSM camera within duplicate_m of where an add is about to be created (read now,
    not from the build's extract: rules/publish.yaml duplicate)."""
    rule = rules()["duplicate"]
    near, others = rule["duplicate_m"], set(rule["not_cameras"])
    around = nodes_around(server.url, token, item.lon, item.lat, 2 * near)
    return any(is_camera(n.tags, others)
               and metres_between(item.lon, item.lat, n.lon, n.lat) <= near
               for n in around)  # fmt: skip


def send(connect: Callable, server: osm.Server, token: str, items: list[Item],
         comment: str | None = None, hold: Callable | None = None,
         opened: Callable[[int], None] | None = None) -> dict:  # fmt: skip
    """`items` checked against OSM, then sent in one changeset (the answer: changeset, url,
    published, conflicts). Each existing node read again (never overwrite: a conflict
    instead), each add's surroundings read (a camera there: osm_duplicate, nothing
    created), the rows `sending` before the upload, published or conflicts after. `comment`:
    the changeset's (default: changeset_comment). `hold(conn, going)`: run in the transaction
    that writes the `sending` rows, with the uuids about to leave; False stops it (Stop off).
    `opened(changeset)`: called once OSM opened the changeset (the day's count). Raises
    Stop. `connect` opens a database connection."""
    rule = rules()
    keys = fine_keys()
    conflicts: dict[str, str] = {}
    same: list[str] = []  # nothing to send: OSM has it already
    going: list[str] = []
    creates: list[tuple[int, float, float, dict]] = []
    modifies: list[tuple[int, int, float, float, dict]] = []
    camera_of: dict[int, str] = {}  # the upload's node id (placeholder or real) -> camera
    kinds: list[str] = []
    for item in items:
        if item.action == "create":
            try:
                near = duplicates(server, token, item)
            except Refused as exc:
                raise stopped(exc) from None
            if near:
                conflicts.update({c.uuid: "osm_duplicate" for c in item.contributions})
                continue
            tags = dict(rule["add_tags"]["tags"])
            for c in item.contributions:
                tags.update(c.tags)
            placeholder = -(len(creates) + 1)
            creates.append((placeholder, item.lon, item.lat, tags))
            camera_of[placeholder] = item.camera
            going += [c.uuid for c in item.contributions]
            kinds += [c.kind for c in item.contributions]
            continue
        try:
            node = read_node(server.url, token, item.node)
        except Refused as exc:
            raise stopped(exc) from None
        if node is None:
            conflicts.update({c.uuid: "osm_deleted" for c in item.contributions})
            continue
        lon, lat, sends, these = node.lon, node.lat, {}, []
        for c in item.contributions:
            reason = held_against(c, item, node, keys)
            if reason is None and c.kind != "move":
                result = {k: outcome(k, node.tags.get(k), v) for k, v in c.tags.items()}
                if "conflict" in result.values():
                    reason = "osm_value"
                elif "send" not in result.values():
                    same.append(c.uuid)
                    continue
                sends.update({k: c.tags[k] for k, r in result.items() if r == "send"})
            elif reason is None:
                if (fmt(c.lon), fmt(c.lat)) == (fmt(node.lon), fmt(node.lat)):
                    same.append(c.uuid)
                    continue
                try:
                    vertex = in_ways(server.url, token, node.id)
                except Refused as exc:
                    raise stopped(exc) from None
                if vertex:
                    reason = "osm_way"
                else:
                    lon, lat = c.lon, c.lat
            if reason is not None:
                conflicts[c.uuid] = reason
                continue
            these.append(c.uuid)
            kinds.append(c.kind)
        if these:
            modifies.append((node.id, node.version, lon, lat, {**node.tags, **sends}))
            camera_of[node.id] = item.camera
            going += these
    month = date.today().replace(day=1)
    if not going:
        record(connect, server.name, month, [], same, conflicts, {})
        return answer(server, None, same, conflicts)
    cs = rule["changeset"]
    tags = {**cs["tags"], "created_by": cs["created_by"].format(release=osm.release()),
            "comment": comment or changeset_comment(kinds)}  # fmt: skip
    try:
        changeset = open_changeset(server.url, token, tags)
    except Refused as exc:
        raise stopped(exc) from None
    if opened is not None:
        opened(changeset)
    # Before the upload: a crash after it must not publish these twice.
    with connect() as conn, conn.transaction():
        if hold is not None and not hold(conn, going):
            off = True
        else:
            off = False
            for uid in going:
                conn.execute("INSERT INTO osm_publications (uuid, server, state, changeset,"
                             " month) VALUES (%s, %s, 'sending', %s, %s)",
                             (uid, server.name, changeset, month))  # fmt: skip
    if off:
        close_changeset(server.url, token, changeset)
        raise Stop("off")
    try:
        body = upload(server.url, token, changeset, osm_change(changeset, creates, modifies))
    except Refused as exc:
        if exc.status is not None and 400 <= exc.status < 500:
            # OSM refused it, and applies all of an upload or none of it: nothing went.
            with connect() as conn:
                conn.execute("DELETE FROM osm_publications WHERE uuid = ANY(%s::uuid[])"
                             " AND server = %s AND state = 'sending'",
                             (going, server.name))  # fmt: skip
        # No answer, or a 5xx (a proxy may answer so after OSM committed): it may have
        # gone; the rows stay `sending`, never sent again (a second <create> would be a
        # second node on OSM): the job reconciles them with the changeset.
        log.warning("osm upload refused: %s", refusal(exc))
        close_changeset(server.url, token, changeset)
        if exc.status == 409:
            raise Stop("changed") from None
        raise stopped(exc) from None
    try:
        diff = diff_result(body)
    except (ET.ParseError, ValueError) as exc:
        # Applied (200), but the new nodes are unknown here: later answers on an added
        # camera wait until its node is known again.
        log.warning("osm diffResult unreadable: %s", type(exc).__name__)
        diff = {}
    placed = {camera_of[old]: new for old, new in diff.items() if old in camera_of}
    record(connect, server.name, month, going, same, conflicts, placed, changeset)
    close_changeset(server.url, token, changeset)
    return answer(server, changeset, going + same, conflicts)


def record(connect: Callable, server: str, month: date, going: list[str], same: list[str],
           conflicts: dict[str, str], placed: dict[str, tuple[int, int]],
           changeset: int | None = None) -> None:  # fmt: skip
    """In one transaction: what went (sending -> published), what OSM had already
    (published, no changeset), the conflicts, and the nodes as we leave them."""
    with connect() as conn, conn.transaction():
        if going:
            conn.execute("UPDATE osm_publications SET state = 'published' WHERE"
                         " uuid = ANY(%s::uuid[]) AND server = %s AND changeset = %s",
                         (going, server, changeset))  # fmt: skip
        for uid in same:
            conn.execute("INSERT INTO osm_publications (uuid, server, state, month)"
                         " VALUES (%s, %s, 'published', %s)", (uid, server, month))  # fmt: skip
        for uid, reason in conflicts.items():
            conn.execute("INSERT INTO osm_publications (uuid, server, state, reason, month)"
                         " VALUES (%s, %s, 'conflict', %s, %s)",
                         (uid, server, reason, month))  # fmt: skip
        for camera, (node_id, version) in placed.items():
            conn.execute("INSERT INTO osm_nodes (server, camera_id, node_id, version)"
                         " VALUES (%s, %s, %s, %s) ON CONFLICT (server, camera_id) DO UPDATE"
                         " SET node_id = EXCLUDED.node_id, version = EXCLUDED.version",
                         (server, camera, node_id, version))  # fmt: skip


def answer(server: osm.Server, changeset: int | None, published: list[str],
           conflicts: dict[str, str]) -> dict:  # fmt: skip
    return {
        "changeset": changeset,
        "url": f"{server.url}/changeset/{changeset}" if changeset else None,
        "published": sorted(published),
        "conflicts": [{"uuid": u, "reason": r} for u, r in sorted(conflicts.items())],
    }
