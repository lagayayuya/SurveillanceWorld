"""Lot of 2026-10-12, points 5 and 6: the height in metres without « Poteau » (the classique's
`pole` stored as `first`, migration 017 on stored answers) and the operator — every listed
name (`POST /api/operators` without a class), a name proposed after public or business
only, shown nowhere before /revue accepts it (as is, replaced, or without a name), applied
and published only once accepted."""

import json
import subprocess
import uuid
from types import SimpleNamespace

import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from test_accounts_db import apply as apply_migration
from test_accounts_db import at
from test_api_app import TODAY, headers, lonlat
from test_db import acct, ensure_sql, sql

from lacarte import contrib, participation, regions
from lacarte.api import app as api
from lacarte.api import live


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh(pg_dsn, client):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
    api.limits.hits.clear()


@pytest.fixture(scope="module")
def build_id(pg_dsn, pg_loaded):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute("SELECT build_id FROM meta").fetchone()[0]


@pytest.fixture(scope="module")
def cam(pg_dsn, pg_loaded):
    """An outdoor camera of unknown or private operator (the operator question's)."""
    with psycopg.connect(pg_dsn) as conn:
        cid = conn.execute(
            "SELECT camera_id FROM cameras WHERE NOT indoor AND operator_class <> 'public'"
            " ORDER BY camera_id LIMIT 1"
        ).fetchone()[0]
        return live.camera(conn, cid)


def body(cam, build_id, kind, uid=None, **fields):
    return {"kind": kind, "uuid": uid or str(uuid.uuid4()), "camera": cam.camera_id,
            "build_id": build_id, "day": TODAY, "duration_ms": 2000, "on_site": True,
            **fields}  # fmt: skip


def post(client, cam, build_id, kind, who="ana", **fields):
    b = body(cam, build_id, kind, **fields)
    return b["uuid"], client.post("/api/contributions", json=b, headers=headers(who))


def stored(pg_dsn, uid):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute(
            "SELECT answer, operator_name, operator_proposed, operator_choice, status, payload"
            " FROM contributions WHERE uuid = %s",
            (uid,),
        ).fetchone()


def decide(client, uid, decision="validated", operator=None):
    b = {"uuid": uid, "decision": decision, **({"operator": operator} if operator else {})}
    return client.post("/api/review/decide", json=b, headers=headers("rev"))


# --- height ------------------------------------------------------------------------------


def test_the_classes_are_metres_and_pole_is_the_classique_s_alone():
    h = participation.questions()["height"]
    assert {k: h["classes"][k] for k in ("ground", "first", "upper")} == {
        "ground": 2, "first": 4, "upper": 7}  # fmt: skip
    # The classique's hint still reads a value for « sur un poteau »; it is stored as first.
    assert h["classes"]["pole"] == h["classes"]["first"] and h["legacy"] == {"pole": "first"}
    assert participation.height_class("pole") == "first"
    assert participation.height_class("upper") == "upper"


def test_the_classique_s_pole_is_stored_as_first_and_stays_idempotent(client, cam, build_id,
                                                                      pg_dsn):  # fmt: skip
    b = body(cam, build_id, "height", answer="pole")
    r = client.post("/api/contributions", json=b, headers=headers())
    assert r.status_code == 200 and r.json()["new"] is True, r.text
    assert stored(pg_dsn, b["uuid"])[0] == "first"
    # Sent again from the phone's queue: the same body, the same contribution.
    again = client.post("/api/contributions", json=b, headers=headers())
    assert again.status_code == 200 and again.json()["new"] is False
    # A tilt answered after « sur un poteau » keeps the journey's height as first too.
    uid, r = post(client, cam, build_id, "tilt", answer="slight", aim_height="pole")
    assert r.status_code == 200, r.text
    assert stored(pg_dsn, uid)[5]["aim_height"] == "first"


def test_017_moves_the_stored_pole_answers_and_refuses_new_ones(pg_dsn, pg_loaded):
    """On a database left at 016 with a « sur un poteau » answer and a tilt that followed
    it: 017 changes both, says how many, and its CHECK refuses `pole` from then on."""
    other = at(pg_dsn, "height_017", "016")
    cols = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
            " duration_ms, geom, payload, body_sha256, osm_tags, answer")  # fmt: skip

    def insert(i, kind, answer, payload="{}"):
        sql(other, ensure_sql("ana") + f"INSERT INTO contributions ({cols}) VALUES"
            f" ('00000000-0000-4000-8000-0000000017{i:02d}', '{kind}', 'n1', 'n', 1, 1, 'b',"
            f" {acct('ana')}, '2026-10-04', 0, ST_SetSRID(ST_MakePoint(0, 0), 2154),"
            f" '{payload}', 'x', '{{}}', '{answer}')")  # fmt: skip

    insert(1, "height", "pole")
    insert(2, "height", "pole")
    insert(3, "height", "upper")
    insert(4, "tilt", "steep", '{"aim_height": "pole", "aim_kind": "fixed"}')
    f = regions.ROOT / "db" / "migrations" / "017_height_operator.sql"
    out = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", other, "-1", "-f", str(f)],
                         check=True, capture_output=True, text=True)  # fmt: skip
    assert "017: 2 height answers pole -> first, 1 tilt aim_height pole -> first" in out.stderr
    assert sql(other, "SELECT right(uuid::text, 2), answer, payload ->> 'aim_height'"
                      " FROM contributions ORDER BY uuid") == [
        ["01", "first", ""], ["02", "first", ""], ["03", "upper", ""],
        ["04", "steep", "first"]]  # fmt: skip
    with pytest.raises(subprocess.CalledProcessError) as e:
        insert(5, "height", "pole")
    assert "contributions_answer" in e.value.stderr


def test_017_lets_the_api_role_set_an_accepted_name_only(pg_dsn, pg_loaded):
    """The constraints of a proposed name, and the API role's two new columns."""
    other = at(pg_dsn, "operator_017", "016")
    apply_migration(other, "017_height_operator")
    cols = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
            " duration_ms, geom, payload, body_sha256, osm_tags, answer, operator_name,"
            " operator_proposed")  # fmt: skip

    def insert(i, answer, name="NULL", proposed="NULL"):
        sql(other, ensure_sql("ana") + f"INSERT INTO contributions ({cols}) VALUES"
            f" ('00000000-0000-4000-8000-0000000018{i:02d}', 'operator', 'n1', 'n', 1, 1, 'b',"
            f" {acct('ana')}, '2026-10-04', 0, ST_SetSRID(ST_MakePoint(0, 0), 2154), '{{}}',"
            f" 'x', '{{}}', '{answer}', {name}, {proposed})")  # fmt: skip

    insert(1, "business", proposed="'Boulangerie Dupont'")
    for i, answer, name, proposed in [
        (2, "household", "NULL", "'Jean Dupont'"),  # never after « Particulier »
        (3, "business", "NULL", "'B'"),  # too short
        (4, "business", "'Darty'", "'Boulangerie Dupont'"),  # a name before any choice
    ]:
        with pytest.raises(subprocess.CalledProcessError):
            insert(i, answer, name, proposed)
    as_api = ("SET ROLE preview_api; UPDATE contributions SET {}"
              " WHERE uuid = '00000000-0000-4000-8000-000000001801'")  # fmt: skip
    sql(other, as_api.format("operator_choice = 'listed', operator_name = 'Franprix'"))
    sql(other, as_api.format("operator_choice = 'proposed', operator_name = operator_proposed"))
    for bad in ("operator_choice = 'proposed', operator_name = 'Franprix'",
                "operator_choice = 'none', operator_name = 'Franprix'",
                "operator_choice = 'maybe', operator_name = NULL",
                "operator_proposed = 'Autre nom'"):  # not the API's to change  # fmt: skip
        with pytest.raises(subprocess.CalledProcessError):
            sql(other, as_api.format(bad))


# --- the operator list -------------------------------------------------------------------


def test_without_a_class_every_listed_name_with_its_class(client, cam):
    r = client.post("/api/operators", json={"camera": cam.camera_id}, headers=headers())
    assert r.status_code == 200, r.text
    out = r.json()
    every = out["all"]
    # « ratp » folds onto RATP (the search is the client's): a public name of the list.
    assert [e for e in every if participation.fold(e["name"]) == "ratp"] == [
        {"name": "RATP", "class": "public"}]  # fmt: skip
    assert {"name": "Franprix", "class": "business"} in every
    names = [e["name"] for e in every]
    assert names == sorted(names, key=lambda n: (participation.fold(n), n))
    excluded = set(participation.questions()["operator"]["list_excludes"])
    assert not excluded & set(names) and {e["class"] for e in every} == {"public", "business"}
    # near: both classes' offered names, as the classique's two lists have them.
    by_class = {
        c: client.post("/api/operators", json={"camera": cam.camera_id, "class": c},
                       headers=headers()).json()["names"]
        for c in ("public", "business")
    }  # fmt: skip
    assert sorted((e["name"], e["class"]) for e in out["near"]) == sorted(
        (n, c) for c, ns in by_class.items() for n in ns)  # fmt: skip
    assert [participation.fold(e["name"]) for e in out["near"]] == sorted(
        participation.fold(e["name"]) for e in out["near"])  # fmt: skip


def test_a_listed_name_must_match_the_answer_s_class(client, cam, build_id, pg_dsn):
    uid, r = post(client, cam, build_id, "operator", answer="public", operator_name="RATP")
    assert r.status_code == 200, r.text
    assert stored(pg_dsn, uid)[:3] == ("public", "RATP", None)
    _, r = post(client, cam, build_id, "operator", answer="business", operator_name="RATP")
    assert (r.status_code, r.json()) == (422, {"error": "operator_name"})


# --- a name proposed ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        {"answer": "household", "operator_proposed": "Jean Dupont"},  # never a person's name
        {"answer": "unknown", "operator_proposed": "Boulangerie Dupont"},
        {"answer": "business", "operator_proposed": "Boulangerie", "operator_name": "Franprix"},
        {"answer": "business", "operator_proposed": "B"},
        {"answer": "business", "operator_proposed": "x" * 61},
        {"answer": "business", "operator_proposed": "-Dupont"},
        {"answer": "business", "operator_proposed": "<b>Dupont</b>"},
        {"answer": "business", "operator_proposed": "https://dupont.fr"},
        {"answer": "business", "operator_proposed": "Dupont 📷"},
        {"answer": "public", "operator_proposed": "   "},
    ],
)
def test_a_proposed_name_is_refused_after_household_or_when_it_is_not_a_name(
    client, cam, build_id, fields
):
    _, r = post(client, cam, build_id, "operator", **fields)
    assert (r.status_code, r.json()) == (422, {"error": "operator_proposed"})


def test_a_proposed_name_is_cleaned_or_taken_as_the_listed_one(client, cam, build_id, pg_dsn):
    uid, r = post(client, cam, build_id, "operator", answer="business",
                  operator_proposed="  Boulangerie  Dupont-Lefèvre ")  # fmt: skip
    assert r.status_code == 200, r.text
    assert stored(pg_dsn, uid)[:4] == ("business", None, "Boulangerie Dupont-Lefèvre", None)
    # NFC: « e » + combining acute is « é ».
    uid, _ = post(client, cam, build_id, "operator", answer="business",
                  operator_proposed="Café de l’Église (Saint-Denis)")  # fmt: skip
    assert stored(pg_dsn, uid)[2] == "Café de l’Église (Saint-Denis)"
    # A listed name of the class once folded: that name, nothing waits for the review.
    uid, _ = post(client, cam, build_id, "operator", answer="public", operator_proposed="ratp")
    assert stored(pg_dsn, uid)[1:4] == ("RATP", None, None)
    uid, _ = post(client, cam, build_id, "operator", answer="business",
                  operator_proposed="societe  GENERALE")  # fmt: skip
    assert stored(pg_dsn, uid)[1:3] == ("Société Générale", None)
    # Of the other class: a proposal, the reviewer sees it.
    uid, _ = post(client, cam, build_id, "operator", answer="business", operator_proposed="RATP")
    assert stored(pg_dsn, uid)[1:3] == (None, "RATP")


NAME = "Boulangerie Dupont"


def test_a_proposed_name_is_shown_nowhere_before_it_is_accepted(client, cam, build_id, pg_dsn,
                                                                tmp_path, monkeypatch):  # fmt: skip
    uid, r = post(client, cam, build_id, "operator", answer="business", operator_proposed=NAME)
    assert r.status_code == 200, r.text
    # On an added camera too: its sheet lists the answers it keeps (`ans`).
    lon, lat = lonlat(cam)
    add = str(uuid.uuid4())
    r = client.post("/api/contributions", headers=headers(), json={
        "kind": "add", "uuid": add, "build_id": build_id, "day": TODAY, "duration_ms": 9000,
        "on_site": True, "lon": lon, "lat": lat, "placement": "free"})  # fmt: skip
    assert r.status_code == 200, r.text
    added = SimpleNamespace(camera_id=participation.added_id(add))
    _, r = post(client, added, build_id, "operator", answer="public", operator_proposed=NAME)
    assert r.status_code == 200, r.text
    reads = {
        "me": client.get("/api/me/contributions", headers=headers()),
        "proposals": client.get(f"/api/proposals?camera={participation.added_id(add)}",
                                headers=headers()),
        "bbox": client.get("/api/proposals?bbox=" + ",".join(
            str(v) for v in (lon - 0.001, lat - 0.001, lon + 0.001, lat + 0.001))),
        "score": client.get("/api/me/score", headers=headers()),
        "leaderboard": client.get("/api/leaderboard", headers=headers()),
    }  # fmt: skip
    for what, r in reads.items():
        assert r.status_code == 200, (what, r.text)
        assert NAME not in r.text, what
    mine = {c["uuid"]: c for c in reads["me"].json()["contributions"]}
    assert (mine[uid]["operator_name"], mine[uid]["operator_proposed"]) == (None, True)
    assert mine[add]["operator_proposed"] is False
    # Validated in peer mode or by mistake without a choice, the build still has no name.
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'validated' WHERE uuid = %s", (uid,))
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    contrib.export(dsn=pg_dsn)
    assert NAME not in (tmp_path / "ci.jsonl").read_text()
    # The review sees it, and its CSV.
    window = client.get(f"/api/review/camera?camera={cam.camera_id}", headers=headers("rev"))
    (row,) = [c for c in window.json()["contributions"] if c["uuid"] == uid]
    assert (row["operator_proposed"], row["operator_choice"], row["operator_name"]) == (
        NAME, None, None)  # fmt: skip
    assert NAME in client.get("/api/review/export.csv", headers=headers("rev")).text


def exported_name(pg_dsn, tmp_path, monkeypatch, uid):
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    contrib.export(dsn=pg_dsn)
    rows = {
        r.get("uuid"): r for r in map(json.loads, (tmp_path / "ci.jsonl").read_text().splitlines())
    }
    return rows[uid].get("operator_name")


@pytest.mark.parametrize(
    ("choice", "name"),
    [({"choice": "proposed"}, NAME), ({"choice": "listed", "name": "Franprix"}, "Franprix"),
     ({"choice": "none"}, None)],
)  # fmt: skip
def test_the_review_accepts_as_is_replaced_or_without_a_name(
    client, cam, build_id, pg_dsn, tmp_path, monkeypatch, choice, name
):
    uid, _ = post(client, cam, build_id, "operator", answer="business", operator_proposed=NAME)
    r = decide(client, uid)
    assert (r.status_code, r.json()) == (422, {"error": "operator_choice"})
    assert stored(pg_dsn, uid)[4] == "pending"
    r = decide(client, uid, operator=choice)
    assert r.status_code == 200, r.text
    assert stored(pg_dsn, uid)[1:5] == (name, NAME, choice["choice"], "validated")
    assert exported_name(pg_dsn, tmp_path, monkeypatch, uid) == name
    me = client.get("/api/me/contributions", headers=headers()).json()
    mine = {c["uuid"]: c for c in me["contributions"]}
    assert (mine[uid]["operator_name"], mine[uid]["operator_proposed"]) == (name, False)
    # Rejected afterwards: the name goes with it; validated again, a choice is asked again.
    assert decide(client, uid, "rejected").status_code == 200
    assert stored(pg_dsn, uid)[1:5] == (None, NAME, None, "rejected")
    assert decide(client, uid).json() == {"error": "operator_choice"}


def test_the_review_s_choice_is_checked(client, cam, build_id, pg_dsn):
    uid, _ = post(client, cam, build_id, "operator", answer="business", operator_proposed=NAME)
    for operator, error in [
        ({"choice": "listed", "name": "RATP"}, "operator_name"),  # a public name
        ({"choice": "listed", "name": "Mon voisin"}, "operator_name"),
    ]:
        r = decide(client, uid, operator=operator)
        assert (r.status_code, r.json()) == (422, {"error": error})
    for operator in ({"choice": "listed"}, {"choice": "proposed", "name": "Franprix"},
                     {"choice": "maybe"}):  # fmt: skip
        assert decide(client, uid, operator=operator).status_code == 422
    # Never with a rejection, never where nothing was proposed.
    r = decide(client, uid, "rejected", operator={"choice": "none"})
    assert (r.status_code, r.json()) == (422, {"error": "operator_choice"})
    plain, _ = post(client, cam, build_id, "operator", answer="business")
    r = decide(client, plain, operator={"choice": "none"})
    assert (r.status_code, r.json()) == (422, {"error": "operator_choice"})
    # Rejected outright: refused with it.
    assert decide(client, uid, "rejected").status_code == 200
    assert stored(pg_dsn, uid)[1:5] == (None, NAME, None, "rejected")


def test_a_send_with_a_proposed_name_is_one_decision_with_a_choice(client, cam, build_id,
                                                                    pg_dsn):  # fmt: skip
    batch = str(uuid.uuid4())
    shape, _ = post(client, cam, build_id, "shape", answer="dome", batch=batch)
    who, r = post(client, cam, build_id, "operator", answer="business", operator_proposed=NAME,
                  batch=batch)  # fmt: skip
    assert r.status_code == 200, r.text
    # « Valider tout ce qui a été fait sur place » leaves the send to the reviewer.
    alone, _ = post(client, cam, build_id, "verify", answer="present")
    r = client.post("/api/review/decide-on-site", json={"camera": cam.camera_id},
                    headers=headers("rev"))  # fmt: skip
    assert r.json()["validated"] == [alone] and r.json()["left"] == sorted([shape, who])
    assert decide(client, batch).json() == {"error": "operator_choice"}
    assert stored(pg_dsn, shape)[4] == "pending"  # nothing of the send moved
    r = decide(client, shape, operator={"choice": "proposed"})
    assert r.status_code == 200 and r.json()["decided"] == sorted([shape, who]), r.text
    assert stored(pg_dsn, who)[1:5] == (NAME, NAME, "proposed", "validated")


def test_an_accepted_name_absent_from_the_list_is_applied_with_the_answer_s_class(ci_build):
    """The build takes operator_name as it is (normalize: the name, the class of the answer)."""
    from lacarte import apply, normalize

    over = apply.overrides(apply.State(operator=("business", NAME)), {})
    row, _ = normalize.normalize_row("n1", 1, None, json.dumps({"man_made": "surveillance"}), over)
    assert (row["operator_class"], row["operator_name"], row["operator_norm"]) == (
        "private_outdoor", NAME, NAME)  # fmt: skip


def test_an_add_rejected_takes_the_name_accepted_on_its_answer(client, build_id, pg_dsn):
    """Rejecting an add rejects what was said of it; a name proposed in its answers, even one
    a reviewer had accepted, goes with them (it would otherwise stay as the answer's name)."""
    at = live.to_lonlat(644329.8662116162 + 0.7, 6866484.319232392 + 0.7)  # test_add's facade
    add = str(uuid.uuid4())
    r = client.post("/api/contributions", headers=headers(),
                    json={"kind": "add", "uuid": add, "build_id": build_id, "day": TODAY,
                          "duration_ms": 9000, "on_site": True, "lon": at[0], "lat": at[1],
                          "placement": "facade"})  # fmt: skip
    assert r.status_code == 200, r.text
    with psycopg.connect(pg_dsn) as conn:
        added = conn.execute("SELECT camera_id FROM contributions WHERE uuid = %s",
                             (add,)).fetchone()[0]  # fmt: skip
    who = str(uuid.uuid4())
    r = client.post("/api/contributions", headers=headers(),
                    json={"kind": "operator", "uuid": who, "camera": added, "build_id": build_id,
                          "day": TODAY, "duration_ms": 2000, "on_site": True,
                          "answer": "business", "operator_proposed": NAME})  # fmt: skip
    assert r.status_code == 200, r.text
    assert decide(client, who, operator={"choice": "proposed"}).status_code == 200
    assert stored(pg_dsn, who)[1:5] == (NAME, NAME, "proposed", "validated")
    assert decide(client, add, "rejected").status_code == 200
    assert stored(pg_dsn, who)[1:5] == (None, NAME, None, "rejected")
