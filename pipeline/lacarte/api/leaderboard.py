"""Points of the accounts (rules/leaderboard.yaml): GET /api/me/score, GET /api/leaderboard.

Each contribution an account made earns points by its kind once the review accepted it
(awards); pending ones are counted apart, for their author only. Computed at each request
from the contributions table (a prototype's volumes): nothing about points is stored.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from functools import cache

import yaml

from lacarte import direction, osmtags, participation, regions
from lacarte.api import auth

KINDS = ("total", "add", "info", "correction", "verification")
CATEGORIES = KINDS[1:]
INFO_KINDS = ("shape", "direction", "height", "tilt", "operator")
NO_ANSWER = ("unknown", "not_visible")  # « Je ne sais pas », « Je ne vois pas »


@cache
def rules() -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / "leaderboard.yaml").read_text())


def value(name: str) -> int:
    return rules()["points"][name]["value"]


def accepted_statuses() -> tuple[str, ...]:
    return tuple(rules()["accepted"]["statuses"])


def this_month() -> str:
    return date.today().strftime("%Y-%m")


@dataclass(frozen=True)
class Row:
    uuid: str
    kind: str
    camera_id: str
    author: str | None
    status: str
    answer: str | None
    on_site: bool | None
    target: str | None
    decided_on: date | None
    day: date
    osm_tags: dict | None
    decided_by: str | None = None


@dataclass(frozen=True)
class Award:
    """Points one account earns: for a contribution (`uuid`), or the add's bonus (`bonus`)."""

    account: str
    category: str
    points: int
    accepted: bool
    month: str | None  # of the decision; None while pending
    uuid: str
    camera_id: str
    bonus: bool = False


ROWS_SQL = (
    "SELECT uuid::text, kind, camera_id, author_id::text, status, answer, on_site,"
    " target::text, decided_on, day, osm_tags, decided_by_id::text FROM contributions"
    " WHERE author_id IS NOT NULL AND kind NOT IN ('agree', 'disagree')"
    " ORDER BY day, uuid"
)


def load(conn) -> list[Row]:
    return [Row(*r) for r in conn.execute(ROWS_SQL)]


def known(row: Row) -> bool:
    """Whether the camera had a value for this info when the contribution was made: its OSM
    tags then, as the pipeline reads them (rules/leaderboard.yaml known)."""
    tags = row.osm_tags or {}
    if row.kind == "shape":
        return osmtags.classify_kind(tags)[1] != osmtags.DEFAULT
    if row.kind == "direction":
        bearing = tags.get("camera:direction") or tags.get("direction")
        return bool(osmtags.parse_direction(bearing)[0])
    if row.kind == "height":
        return osmtags.parse_height(tags.get("height")) is not None
    if row.kind == "tilt":
        return osmtags.parse_tilt(tags.get("camera:angle")) is not None
    if row.kind == "operator":
        return any((tags.get(k) or "").strip() for k in ("operator", "operator:type"))
    return False


def asked(shape_answer: str) -> set[str]:
    """The infos an add whose shape answer is this one asks (rules/leaderboard.yaml
    all_infos; the add's sheet: web/src/participate/questions.ts editorParts)."""
    q = participation.questions()
    kind = q["shape"]["kinds"][shape_answer]
    out = {"shape", "operator"}
    if kind in direction.kinds():
        out.add("direction")
    if kind not in q["height"].get("modify_excludes", []):
        out.add("height")
        if kind in participation.tilt_kinds():
            out.add("tilt")
    return out


def _month(row: Row) -> str:
    return (row.decided_on or row.day).strftime("%Y-%m")


def awards(rows: list[Row]) -> list[Award]:
    """Every account's points: one award per contribution that earns some, accepted or
    pending, plus each add's bonus (rules/leaderboard.yaml)."""
    ok = accepted_statuses()
    live = (*ok, "pending")
    by_uuid = {r.uuid: r for r in rows}
    out: list[Award] = []
    own_answers: dict[str, list[Row]] = defaultdict(list)  # add uuid -> its author's answers
    # Once per account, camera, kind of contribution and month (or while pending): sending
    # the same « Toujours là ? » or the same info again earns nothing more.
    seen: set[tuple] = set()
    for r in rows:
        if r.status not in live:
            continue
        # A reviewer's decision on their own contribution earns them nothing.
        if r.decided_by is not None and r.decided_by == r.author:
            continue
        points = category = None
        if r.kind == "add":
            category, points = "add", value("add")
        elif r.kind == "move":
            category, points = "correction", value("correction")
        elif r.kind == "verify":
            if r.on_site is True and r.answer in ("present", "not_found"):
                category, points = "verification", value("verification")
        elif r.kind in INFO_KINDS and r.answer not in NO_ANSWER:
            add = by_uuid.get(r.target) if r.target else None
            if add is not None and add.kind == "add" and add.author == r.author:
                own_answers[add.uuid].append(r)
                category, points = "info", value("info")
            elif known(r):
                category, points = "correction", value("correction")
            else:
                category, points = "info", value("info")
        if points:
            accepted = r.status in ok
            month = _month(r) if accepted else None
            key = (r.author, r.camera_id, r.kind, month)
            if key in seen:
                continue
            seen.add(key)
            out.append(Award(r.author, category, points, accepted, month, r.uuid,
                             r.camera_id))  # fmt: skip
    for add_uuid, answers in own_answers.items():
        bonus = add_bonus(by_uuid[add_uuid], answers)
        if bonus is not None:
            out.append(bonus)
    return out


def add_bonus(add: Row, answers: list[Row]) -> Award | None:
    """The bonus of an add whose author answered every info its shape asks: accepted when
    the add and one answer per info are, in the month the last of them was; pending when
    some of them still wait; none otherwise."""
    ok = accepted_statuses()
    live = (*ok, "pending")
    if add.status not in live:
        return None

    def complete(states) -> dict[str, Row] | None:
        first: dict[str, Row] = {}
        for r in sorted(answers, key=lambda r: (r.decided_on or r.day, r.uuid)):
            if r.status in states:
                first.setdefault(r.kind, r)
        if "shape" not in first or not asked(first["shape"].answer) <= set(first):
            return None
        return {k: first[k] for k in asked(first["shape"].answer)}

    points = value("all_infos")
    if add.status in ok and (done := complete(ok)) is not None:
        month = max(_month(r) for r in (add, *done.values()))
        return Award(add.author, "add", points, True, month, add.uuid, add.camera_id, True)
    if complete(live) is not None:
        return Award(add.author, "add", points, False, None, add.uuid, add.camera_id, True)
    return None


def in_period(a: Award, period: str) -> bool:
    return a.accepted and (period == "all" or a.month == period)


def totals(all_awards: list[Award], period: str, kind: str) -> dict[str, int]:
    """Accepted points per account in the period, of one kind or all (`total`)."""
    out: dict[str, int] = defaultdict(int)
    for a in all_awards:
        if in_period(a, period) and kind in ("total", a.category):
            out[a.account] += a.points
    return out


def eligible(conn) -> dict[str, str]:
    """Accounts that may appear in the leaderboard, id -> pseudonym: opted in, not a test
    account, not disabled, not a placeholder (migration 015: a password or an OSM user)."""
    return dict(conn.execute(
        "SELECT a.id::text, a.pseudonym FROM accounts a WHERE a.leaderboard AND NOT a.test"
        f" AND NOT a.disabled AND {auth.CLAIMED}"
    ).fetchall())  # fmt: skip


def ranking(points: dict[str, int], names: dict[str, str]) -> list[dict]:
    """The eligible accounts with points, best first then by pseudonym; equal points share
    a rank (1, 1, 3)."""
    rows = sorted(((p, names[a], a) for a, p in points.items() if a in names and p > 0),
                  key=lambda t: (-t[0], t[1].lower(), t[1]))  # fmt: skip
    out, rank = [], 0
    for i, (p, name, account) in enumerate(rows):
        if i == 0 or p != rows[i - 1][0]:
            rank = i + 1
        out.append({"rank": rank, "pseudonym": name, "points": p, "account": account})
    return out


def periods(all_awards: list[Award], names: dict[str, str], me: str) -> list[str]:
    """The months to choose from, newest first: the current one, and every month where an
    account of the leaderboard or the caller has accepted points."""
    months = {this_month()} | {
        a.month for a in all_awards if a.accepted and (a.account in names or a.account == me)
    }
    return sorted(months, reverse=True)  # fmt: skip


def board(conn, who, period: str, kind: str) -> dict:
    """GET /api/leaderboard: the top of the ranking, and the caller's own row when it is
    below (and they appear in it at all); each row its rank, pseudonym, points and `me`."""
    all_awards = awards(load(conn))
    names = eligible(conn)
    ranked = ranking(totals(all_awards, period, kind), names)
    top = rules()["leaderboard"]["top"]
    rows = ranked[:top] + [r for r in ranked[top:] if r["account"] == who.id]
    return {
        "period": period,
        "kind": kind,
        "rows": [{"rank": r["rank"], "pseudonym": r["pseudonym"], "points": r["points"],
                  "me": r["account"] == who.id} for r in rows],
        "periods": periods(all_awards, names, who.id),
        # 26a's « Comment on compte ? »: the scale itself, never written in the web.
        "scale": scale(),
    }  # fmt: skip


def scale() -> dict[str, int | bool]:
    """26a's « Comment on compte ? » (rules/leaderboard.yaml points), in the contract's
    words: the bonus is `complete_bonus`, and a
    verification scores on site only (awards)."""
    return {
        "add": value("add"),
        "info": value("info"),
        "complete_bonus": value("all_infos"),
        "correction": value("correction"),
        "verification": value("verification"),
        "verification_on_site_only": True,
    }


def communes(conn, camera_ids: set[str]) -> int:
    """How many communes these cameras are in: the served build's, or for an add no build
    has applied, the nearest camera's (as /revue's lines say it)."""
    if not camera_ids:
        return 0
    rows = conn.execute(
        "SELECT coalesce(k.commune, (SELECT n.commune FROM cameras n"
        "                            ORDER BY n.geom <-> c.geom LIMIT 1))"
        " FROM (SELECT DISTINCT ON (camera_id) camera_id, geom FROM contributions"
        "       WHERE camera_id = ANY(%s) ORDER BY camera_id, kind <> 'add') c"
        " LEFT JOIN cameras k USING (camera_id)",
        (sorted(camera_ids),),
    ).fetchall()
    return len({r[0] for r in rows if r[0]})


def score(conn, who, period: str) -> dict:
    """GET /api/me/score: the person's accepted points in the period by kind, how many
    contributions earned them and in how many communes, the points waiting for review
    (every period), and their rank (null when they do not appear or have no points)."""
    all_awards = awards(load(conn))
    mine = [a for a in all_awards if a.account == who.id]
    got = [a for a in mine if in_period(a, period)]
    by = {c: sum(a.points for a in got if a.category == c) for c in CATEGORIES}
    counts = {c: sum(1 for a in got if a.category == c and not a.bonus) for c in CATEGORIES}
    names = eligible(conn)
    rank = next((r["rank"] for r in ranking(totals(all_awards, period, "total"), names)
                 if r["account"] == who.id), None)  # fmt: skip
    return {
        "period": period,
        "total": sum(by.values()),
        "by": by,
        "counts": counts,
        "accepted": len({a.uuid for a in got if not a.bonus}),
        "communes": communes(conn, {a.camera_id for a in got}),
        "pending": sum(a.points for a in mine if not a.accepted),
        "rank": rank,
    }


def sent(conn, who, uuids: list[str]) -> dict:
    """GET /api/me/points (8a, the points shown at send): the awards of these contributions
    of the caller's, as awards() gives them to the leaderboard — accepted or still waiting
    for review, an add's bonus as a second item on the add's uuid —, in the order asked;
    a contribution that earns nothing has no item. `total`: what the leaderboard's total
    grows by once they are all accepted (in the same month)."""
    rows = load(conn)
    kind = {r.uuid: r.kind for r in rows if r.author == who.id}
    order = {u: i for i, u in enumerate(dict.fromkeys(uuids)) if u in kind}
    every = [a for a in awards(rows) if a.account == who.id]
    # awards() keys a pending award by month None: a piece sent again after the same one was
    # accepted this month shows there, yet earns nothing once accepted (the month's key is
    # taken). It is accepted this month at the earliest: no item for it here.
    taken = {(a.camera_id, kind.get(a.uuid), a.month) for a in every if a.accepted}
    month = this_month()

    def counts(a: Award) -> bool:
        return a.accepted or a.bonus or (a.camera_id, kind[a.uuid], month) not in taken

    mine = [a for a in every if a.uuid in order and counts(a)]
    mine.sort(key=lambda a: (order[a.uuid], a.bonus))
    items = [{"uuid": a.uuid, "kind": kind[a.uuid], "category": a.category,
              "points": a.points, "bonus": a.bonus, "accepted": a.accepted}
             for a in mine]  # fmt: skip
    return {"items": items, "total": sum(a.points for a in mine)}
