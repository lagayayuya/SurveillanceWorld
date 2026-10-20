"""Points and leaderboard (rules/leaderboard.yaml): a fixture whose points are computed by
hand below, through GET /api/me/score and GET /api/leaderboard."""

import json
import uuid

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient

from lacarte.api import app as api
from lacarte.api import leaderboard

SEPT, OCT = "2026-09", "2026-10"


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def frozen_month(monkeypatch):
    """The current month, whatever today is."""
    monkeypatch.setattr(leaderboard, "this_month", lambda: "2026-11")


class Fixture:
    def __init__(self, dsn: str):
        self.conn = psycopg.connect(dsn, autocommit=True)
        self.conn.execute("TRUNCATE contributions CASCADE")
        self.rev = sessions.account_id("rev")
        cams = self.conn.execute(
            "SELECT camera_id, ST_X(geom), ST_Y(geom), commune FROM cameras"
            " WHERE commune IS NOT NULL ORDER BY commune, camera_id"
        ).fetchall()
        # Two cameras of one commune and one of another, when the extract has two.
        first = [c for c in cams if c[3] == cams[0][3]]
        other = [c for c in cams if c[3] != cams[0][3]] or first[2:]
        self.cams = [first[0], first[1], other[0]]
        # More cameras, for counts that need one camera each (points come once per camera,
        # kind and month).
        self.cams += [c for c in cams if c not in self.cams][:20]

    def account(self, name, *, leaderboard=True, test=False, disabled=False) -> str:
        aid = sessions.account_id(name)
        self.conn.execute(
            "UPDATE accounts SET leaderboard = %s, test = %s, disabled = %s WHERE id = %s",
            (leaderboard, test, disabled, aid),
        )
        return aid

    def add(self, who, status="validated", decided=None, cam=0, on_site=True) -> tuple[str, str]:
        uid = str(uuid.uuid4())
        added = "c" + uid.replace("-", "")[:12]
        x, y = self.cams[cam][1:3]  # on a served camera: its commune is the add's
        self._insert(uid, "add", added, None, who, status, decided, x=x, y=y, on_site=on_site)
        return uid, added

    def answer(self, who, kind, answer, status="validated", decided=None, add=None, cam=0,
               tags=None, direction=None):  # fmt: skip
        uid = str(uuid.uuid4())
        camera = add[1] if add else self.cams[cam][0]
        self._insert(uid, kind, camera, add[0] if add else None, who, status, decided,
                     answer=answer, tags=tags, direction=direction)  # fmt: skip
        return uid

    def _insert(self, uid, kind, camera, target, who, status, decided, *, answer=None,
                tags=None, direction=None, x=0.0, y=0.0, on_site=None):  # fmt: skip
        osm = (None, None, None) if camera.startswith("c") else ("n", int(camera[1:]), 1)
        self.conn.execute(
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
            " build_id, author_id, day, on_site, status, answer, target, geom,"
            " payload, body_sha256, osm_tags, direction_deg, decided_on, decided_by_id)"
            " VALUES (%s, %s, %s, %s, %s, %s, 'b', %s, '2026-09-01', %s, %s, %s, %s,"
            " ST_SetSRID(ST_MakePoint(%s, %s), 2154), '{}', 'x', %s, %s, %s, %s)",
            (uid, kind, camera, *osm, who, on_site, status, answer, target, x, y,
             json.dumps(tags or {}), direction, decided, self.rev if decided else None),
        )  # fmt: skip


@pytest.fixture(scope="module")
def world(pg_dsn, pg_loaded, client):
    """The contributions whose points the tests below expect, computed by hand."""
    f = Fixture(pg_dsn)
    ana, bob = f.account("ana"), f.account("bob")
    cara = f.account("cara", leaderboard=False)
    tess = f.account("tess", test=True)
    dan = f.account("dan", disabled=True)
    eve = f.account("eve")
    d = "2026-09-10"
    # ana, September (accepted):
    #   add A1, a tube (shape bullet -> fixed), and its five infos   50 add + 5 x 10 info
    #     fixed asks shape, operator, direction, height, tilt: all   + 10 bonus (add)
    a1 = f.add(ana, decided=d)
    f.answer(ana, "shape", "bullet", decided=d, add=a1)
    f.answer(ana, "direction", None, decided=d, add=a1, direction=120)
    f.answer(ana, "height", "first", decided=d, add=a1)
    f.answer(ana, "tilt", "slight", decided="2026-09-12", add=a1)
    f.answer(ana, "operator", "business", decided="2026-09-12", add=a1)
    #   add A2, a big ball (ptz asks shape and operator); operator   50 add + 10 info
    #     « Je ne sais pas »: not every info, no bonus, no point
    a2 = f.add(ana, decided="2026-09-15", cam=2)
    f.answer(ana, "shape", "ptz", decided="2026-09-15", add=a2)
    f.answer(ana, "operator", "unknown", decided="2026-09-15", add=a2)
    #   a move, applied since                                        20 correction
    f.answer(ana, "move", None, "applied", "2026-09-20", cam=1)
    #   a shape replacing OSM's camera:type                          20 correction
    f.answer(ana, "shape", "dome", decided="2026-09-21", cam=1, tags={"camera:type": "fixed"})
    #   a direction where OSM had none (superseded since)            10 info
    f.answer(ana, "direction", None, "superseded", "2026-09-22", cam=1, direction=40,
             tags={"camera:direction": "nope"})  # fmt: skip
    #   « Toujours là ? » on site                                    10 verification
    f.answer(ana, "verify", "present", decided="2026-09-23")
    #   nothing: off site, unsure, an opinion, rejected, withdrawn, « Je ne sais pas »
    off = f.answer(ana, "verify", "present", decided="2026-09-23")
    f.conn.execute("UPDATE contributions SET on_site = NULL WHERE uuid = %s", (off,))
    f.answer(ana, "verify", "unsure", decided="2026-09-23")
    rejected = f.answer(ana, "move", None, "rejected", "2026-09-24")
    f._insert(str(uuid.uuid4()), "agree", f.cams[0][0], rejected, ana, "pending", None)
    f.answer(ana, "move", None, "withdrawn", "2026-09-25")
    f.answer(ana, "height", "unknown", decided="2026-09-25")
    # The on_site flag of every verify above is the helper's: set the on-site ones.
    f.conn.execute("UPDATE contributions SET on_site = true WHERE kind = 'verify'"
                   " AND uuid <> %s", (off,))  # fmt: skip
    # ana, October: a verification                                   10 verification
    f.answer(ana, "verify", "present", decided="2026-10-02")
    f.conn.execute("UPDATE contributions SET on_site = true WHERE kind = 'verify'"
                   " AND uuid <> %s", (off,))  # fmt: skip
    # ana, pending: a move and a height over OSM's height            20 + 20, for her only
    f.answer(ana, "move", None, "pending")
    f.answer(ana, "height", "upper", "pending", tags={"height": "5 m"})
    # bob: an add pending with its dome's five infos (pending bonus) 50 + 5 x 10 + 10
    #   (a small dome asks the tilt too, questions@5)
    #   and, in September, a verification                            10
    a3 = f.add(bob, "pending", cam=1)
    for kind, ans, deg in (("shape", "dome", None), ("direction", None, 200),
                           ("height", "ground", None), ("tilt", "steep", None),
                           ("operator", "public", None)):  # fmt: skip
        f.answer(bob, kind, ans, "pending", add=a3, direction=deg)
    f.answer(bob, "verify", "present", decided=d)
    #   an info on ana's add A2: not his add, nothing known there    10 info
    f.answer(bob, "height", "first", decided=d, add=a2)
    # eve: 20, as bob; cara (not shown), tess (test), dan (disabled): points, never ranked
    f.answer(eve, "move", None, decided=d)
    f.answer(cara, "move", None, decided="2026-08-30")
    f.answer(tess, "move", None, decided=d)
    f.answer(dan, "move", None, decided=d)
    f.conn.execute("UPDATE contributions SET on_site = true WHERE kind = 'verify'"
                   " AND uuid <> %s", (off,))  # fmt: skip
    yield f
    f.conn.execute("TRUNCATE contributions CASCADE")
    f.conn.execute("UPDATE accounts SET leaderboard = false, test = false, disabled = false")
    f.conn.close()


def get(client, who, path):
    r = client.get(path, headers=sessions.headers(who))
    assert r.status_code == 200, r.text
    return r.json()


def test_ana_s_september_by_hand(client, world):
    s = get(client, "ana", f"/api/me/score?period={SEPT}")
    assert s["by"] == {"add": 110, "info": 70, "correction": 40, "verification": 10}
    assert s["total"] == 230
    assert s["counts"] == {"add": 2, "info": 7, "correction": 2, "verification": 1}
    assert s["accepted"] == 12  # A1 and its 5 infos, A2 and its shape, 4 more
    expected = len({c[3] for c in world.cams})  # the adds sit on served cameras
    assert s["communes"] == expected
    assert s["pending"] == 40
    assert s["rank"] == 1 and s["period"] == SEPT


def test_periods_and_all(client, world):
    october = get(client, "ana", f"/api/me/score?period={OCT}")
    assert (october["total"], october["by"]["verification"], october["pending"]) == (10, 10, 40)
    every = get(client, "ana", "/api/me/score?period=all")
    assert every["total"] == 240 and every["accepted"] == 13
    default = get(client, "ana", "/api/me/score")  # the current month
    assert (default["period"], default["total"], default["rank"]) == ("2026-11", 0, None)


def test_bob_s_pending_add_counts_for_him_only(client, world):
    s = get(client, "bob", f"/api/me/score?period={SEPT}")
    assert (s["total"], s["by"]["verification"], s["by"]["info"]) == (20, 10, 10)
    assert s["pending"] == 50 + 5 * 10 + 10


def test_the_leaderboard_shows_opted_in_people_only(client, world):
    board = get(client, "bob", f"/api/leaderboard?period={SEPT}&kind=total")
    assert board["rows"] == [
        {"rank": 1, "pseudonym": "ana", "points": 230, "me": False},
        {"rank": 2, "pseudonym": "bob", "points": 20, "me": True},
        {"rank": 2, "pseudonym": "eve", "points": 20, "me": False},  # a tie shares the rank
    ]
    # cara chose not to appear (her points are in August): neither her row nor her month.
    assert board["periods"] == ["2026-11", OCT, SEPT]
    assert (board["period"], board["kind"]) == (SEPT, "total")
    # 26a's « Comment on compte ? » reads the scale from the rules, never from the web.
    assert board["scale"] == {"add": 50, "info": 10, "complete_bonus": 10, "correction": 20,
                              "verification": 10, "verification_on_site_only": True}  # fmt: skip
    mine = get(client, "ana", f"/api/leaderboard?period={SEPT}&kind=correction")["rows"]
    assert mine == [{"rank": 1, "pseudonym": "ana", "points": 40, "me": True},
                    {"rank": 2, "pseudonym": "eve", "points": 20, "me": False}]  # fmt: skip
    cara = get(client, "cara", "/api/me/score?period=2026-08")
    assert (cara["total"], cara["rank"]) == (20, None)  # not opted in: no rank
    assert get(client, "cara", "/api/leaderboard")["periods"] == ["2026-11", OCT, SEPT, "2026-08"]
    assert all(not r["me"] for r in get(client, "cara", f"/api/leaderboard?period={SEPT}")["rows"])
    tess = get(client, "tess", f"/api/me/score?period={SEPT}")
    assert (tess["total"], tess["rank"]) == (20, None)  # a test account: never ranked


def test_an_osm_account_without_password_is_ranked_a_placeholder_is_not(client, world):
    """Migration 015: a placeholder is « no password and no OSM user »; an account that
    signs in with OpenStreetMap only (no password) is a person, ranked like any other."""
    rows = f"/api/leaderboard?period={SEPT}&kind=total"
    # Their sessions first: sessions.account_id gives a password back to an account that
    # has none.
    sessions.token("bob"), sessions.token("eve")
    try:
        world.conn.execute("UPDATE accounts SET password_hash = NULL, osm_id = 7015,"
                           " osm_server = 'dev' WHERE pseudonym = 'eve'")  # fmt: skip
        assert "eve" in [r["pseudonym"] for r in get(client, "bob", rows)["rows"]]
        assert get(client, "eve", f"/api/me/score?period={SEPT}")["rank"] == 2
        world.conn.execute("UPDATE accounts SET osm_id = NULL, osm_server = NULL"
                           " WHERE pseudonym = 'eve'")  # fmt: skip
        assert "eve" not in [r["pseudonym"] for r in get(client, "bob", rows)["rows"]]
    finally:
        world.conn.execute("UPDATE accounts SET password_hash = %s, osm_id = NULL,"
                           " osm_server = NULL WHERE pseudonym = 'eve'",
                           (sessions.NO_LOGIN,))  # fmt: skip


def test_a_row_is_a_pseudonym_a_rank_and_points_only(client, world):
    for kind in leaderboard.KINDS:
        for row in get(client, "bob", f"/api/leaderboard?period=all&kind={kind}")["rows"]:
            assert set(row) == {"rank", "pseudonym", "points", "me"}


def test_the_caller_s_row_follows_the_top_ten(client, world):
    for i in range(11):
        aid = world.account(f"p{i:02d}")
        for k in range(i + 3):  # 60 .. 260 points: all above bob's 20; a camera each
            world.answer(aid, "move", None, decided="2026-09-11", cam=k % len(world.cams))
    try:
        rows = get(client, "bob", f"/api/leaderboard?period={SEPT}")["rows"]
        assert len(rows) == 11 and rows[-1] == {"rank": 13, "pseudonym": "bob", "points": 20,
                                                "me": True}  # fmt: skip
        assert [r["pseudonym"] for r in rows[:4]] == ["p10", "p09", "ana", "p08"]
        assert get(client, "cara", f"/api/leaderboard?period={SEPT}")["rows"][-1]["rank"] == 10
    finally:
        world.conn.execute(
            "DELETE FROM contributions WHERE author_id IN"
            " (SELECT id FROM accounts WHERE pseudonym ~ '^p[0-9]{2}$')"
        )
        world.conn.execute(
            "UPDATE accounts SET leaderboard = false WHERE pseudonym ~ '^p[0-9]{2}$'"
        )


def test_the_scores_need_a_session_and_a_valid_period(client, world):
    assert client.get("/api/leaderboard").status_code == 401
    assert client.get("/api/me/score").status_code == 401
    for bad in ("period=2026-13", "period=2026-9", "period=tout", "kind=moves"):
        r = client.get(f"/api/leaderboard?{bad}", headers=sessions.headers("ana"))
        assert r.status_code == 422, bad


@pytest.mark.parametrize(("shape", "asked"), [
    ("bullet", {"shape", "operator", "direction", "height", "tilt"}),
    ("dome", {"shape", "operator", "direction", "height", "tilt"}),
    ("ptz", {"shape", "operator"}),
    ("multi", {"shape", "operator", "height"}),
])  # fmt: skip
def test_what_an_add_s_shape_asks(shape, asked):
    """As the add's sheet offers them (web/src/participate/questions.ts editorParts): height
    for every kind but the big ball, tilt for a tube and a small dome (questions@5),
    direction under the direction rule."""
    assert leaderboard.asked(shape) == asked


def _row(uid, kind, answer=None, target=None, day="2026-10-01"):
    from datetime import date

    on = date.fromisoformat(day)
    return leaderboard.Row(uid, kind, "c0123456789ab", "ana", "validated", answer, True,
                           target, on, on, {})  # fmt: skip


def test_a_small_dome_s_bonus_needs_its_tilt():
    """« Tout y est » for a small dome (questions@5): its shape, direction, height and who
    films no longer suffice, the tilt is asked too; « Je ne sais pas » for it is no answer."""
    add = _row("a", "add")
    four = [_row("s", "shape", "dome", "a"), _row("d", "direction", None, "a"),
            _row("h", "height", "first", "a"), _row("o", "operator", "public", "a")]  # fmt: skip
    assert leaderboard.add_bonus(add, four) is None
    dunno = [*four, _row("t", "tilt", "unknown", "a")]
    assert not any(a.bonus for a in leaderboard.awards([add, *dunno]))
    full = [*four, _row("t", "tilt", "slight", "a", day="2026-10-20")]
    bonus = leaderboard.add_bonus(add, full)
    assert bonus is not None and (bonus.points, bonus.accepted, bonus.month) == (10, True, OCT)
    assert [a.points for a in leaderboard.awards([add, *full]) if a.bonus] == [10]


@pytest.mark.parametrize(("kind", "tags", "known"), [
    ("shape", {"camera:type": "dome"}, True), ("shape", {"camera:type": "weird"}, False),
    ("shape", {"camera:mount": "doorbell"}, True), ("direction", {"direction": "NE"}, True),
    ("direction", {"camera:direction": "0-360"}, False), ("height", {"height": "4"}, True),
    ("height", {"height": "high"}, False), ("tilt", {"camera:angle": "-30"}, True),
    ("tilt", {"camera:angle": "2"}, False), ("operator", {"operator:type": "private"}, True),
    ("operator", {"operator": " "}, False), ("shape", None, False),
])  # fmt: skip
def test_a_known_value_is_one_the_osm_tags_gave(kind, tags, known):
    row = leaderboard.Row("u", kind, "n1", "a", "validated", "x", None, None, None, None, tags)
    assert leaderboard.known(row) is known


def test_the_same_contribution_again_and_one_s_own_decision_earn_nothing():
    """Sending « Toujours là ? » again on the same camera in the same month earns once; a
    reviewer deciding on their own contribution earns nothing for it."""
    from datetime import date

    def verify(u, camera, day, decided_by=None):
        on = date(2026, 9, day)
        return leaderboard.Row(u, "verify", camera, "a", "validated", "present", True, None,
                               on, on, None, decided_by)  # fmt: skip

    rows = [verify("1", "n1", 1), verify("2", "n1", 2), verify("3", "n2", 3),
            verify("4", "n3", 4, decided_by="a")]  # fmt: skip
    got = leaderboard.awards(rows)
    assert [(a.uuid, a.points) for a in got] == [("1", 10), ("3", 10)]


def test_the_points_at_send_are_the_leaderboard_s_own(client, world):
    """GET /api/me/points (8a): bob's pending add and its five infos, asked as the send
    asks them, show what his total grows by once the review accepts them all."""
    bob = world.conn.execute("SELECT id FROM accounts WHERE pseudonym = 'bob'").fetchone()[0]
    ana_s = world.conn.execute("SELECT c.uuid::text FROM contributions c JOIN accounts a"
                               " ON a.id = c.author_id WHERE a.pseudonym = 'ana'"
                               " LIMIT 1").fetchone()[0]  # fmt: skip
    pending = [u for (u,) in world.conn.execute(
        "SELECT uuid::text FROM contributions WHERE author_id = %s AND status = 'pending'"
        " ORDER BY kind <> 'add', kind", (bob,))]  # fmt: skip
    query = "&".join(f"uuid={u}" for u in [*pending, ana_s])  # someone else's: ignored
    got = get(client, "bob", f"/api/me/points?{query}")
    assert [(i["kind"], i["category"], i["points"], i["bonus"]) for i in got["items"]] == [
        ("add", "add", 50, False), ("add", "add", 10, True),
        ("direction", "info", 10, False), ("height", "info", 10, False),
        ("operator", "info", 10, False), ("shape", "info", 10, False),
        ("tilt", "info", 10, False)]  # fmt: skip
    assert got["total"] == 110 and not any(i["accepted"] for i in got["items"])
    before = get(client, "bob", f"/api/me/score?period={OCT}")["total"]
    world.conn.execute("UPDATE contributions SET status = 'validated', decided_on = '2026-10-05'"
                       " WHERE uuid = ANY(%s)", (pending,))  # fmt: skip
    try:
        after = get(client, "bob", f"/api/me/score?period={OCT}")["total"]
        assert after - before == got["total"]
    finally:
        world.conn.execute("UPDATE contributions SET status = 'pending', decided_on = NULL"
                           " WHERE uuid = ANY(%s)", (pending,))  # fmt: skip


def test_the_points_at_send_need_a_session_and_v4_uuids(client, world):
    assert client.get(f"/api/me/points?uuid={uuid.uuid4()}").status_code == 401
    h = sessions.headers("bob")
    assert client.get("/api/me/points?uuid=nope", headers=h).status_code == 422
    many = "&".join(f"uuid={uuid.uuid4()}" for _ in range(51))
    assert client.get(f"/api/me/points?{many}", headers=h).status_code == 422
    assert client.get("/api/me/points", headers=h).json() == {"items": [], "total": 0}


def test_a_piece_sent_again_after_one_accepted_this_month_shows_no_points(client, world):
    """Review finding (2026-10-11): an on-site « Toujours là » accepted this month, the same
    sent again: the leaderboard will give it nothing, so GET /api/me/points neither."""
    eve = world.conn.execute("SELECT id::text FROM accounts WHERE pseudonym = 'eve'").fetchone()[0]
    first = world.answer(eve, "verify", "present", decided="2026-11-03")
    again = world.answer(eve, "verify", "present", "pending")
    world.conn.execute("UPDATE contributions SET on_site = true WHERE uuid IN (%s, %s)",
                       (first, again))  # fmt: skip
    try:
        got = get(client, "eve", f"/api/me/points?uuid={first}&uuid={again}")
        assert [(i["uuid"], i["points"]) for i in got["items"]] == [(first, 10)]
        assert got["total"] == 10
    finally:
        world.conn.execute("DELETE FROM contributions WHERE uuid IN (%s, %s)", (first, again))
