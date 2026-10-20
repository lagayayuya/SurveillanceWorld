"""/revue by camera (lot 1 « Modérer »): the queue (GET /api/review/queue, its filters,
order, search and summary), the window of one camera (GET /api/review/camera), "Valider
tout ce qui a été fait sur place" (POST /api/review/decide-on-site) and the decisions'
rate bucket."""

import subprocess
import uuid
from datetime import date

import psycopg
import pytest
import sessions
import test_api_app
from fastapi.testclient import TestClient
from test_add import post, post_add
from test_api_app import headers

from lacarte import participation, regions
from lacarte.api import app as api
from lacarte.api import live

near_wall = test_api_app.near_wall  # a camera near a facade, a fixture
SCRIPT = regions.ROOT / "db" / "test_authors.sh"


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
    yield
    subprocess.run([SCRIPT, "", pg_dsn], check=True, capture_output=True)


@pytest.fixture(scope="module")
def build_id(pg_dsn, pg_loaded):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute("SELECT build_id FROM meta").fetchone()[0]


@pytest.fixture(scope="module")
def other_camera(pg_dsn, pg_loaded, near_wall):
    with psycopg.connect(pg_dsn) as conn:
        return conn.execute(
            "SELECT camera_id FROM cameras WHERE camera_id <> %s AND NOT indoor"
            " ORDER BY camera_id LIMIT 1",
            (near_wall[0].camera_id,),
        ).fetchone()[0]


def queue(client, **query):
    r = client.get("/api/review/queue", params=query, headers=headers("rev"))
    assert r.status_code == 200, r.text
    return r.json()


def items(client, **query):
    return {i["camera"]: i for i in queue(client, **query)["items"]}


def set_on_site(dsn, uid, value):
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET on_site = %s WHERE uuid = %s", (value, uid))


def owner(dsn, query, args=()):
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(query, args)


def test_one_item_per_camera_with_its_label_pieces_and_author(
    client, near_wall, other_camera, build_id, pg_dsn
):
    cam = near_wall[0].camera_id
    a, _ = post(client, cam, build_id, "verify", answer="present")  # on site
    b, _ = post(client, cam, build_id, "verify", who="bob", answer="not_found")
    set_on_site(pg_dsn, b, None)
    post(client, cam, build_id, "agree", who="cy", target=b)  # an opinion: no piece
    post(client, cam, build_id, "shape", who="cy", answer="unknown")  # waits for nothing
    c, _ = post(client, other_camera, build_id, "verify", answer="present")
    client.post("/api/review/decide", json={"uuid": c, "decision": "validated"},
                headers=headers("rev"))  # fmt: skip
    q = queue(client)
    assert q["summary"] == {"pending": 2, "oldest_days": 0,
                            "counts": {"todo": 1, "conflicts": 0, "names": 0,
                                       "osm": 0}}  # fmt: skip
    [item] = q["items"]  # nothing waits on the other one
    assert item["camera"] == cam
    label = item["label"]
    assert label["built"] and not label["add"] and label["kind"] and label["commune"]
    assert label["street"] and set(label) == {
        "add", "built", "kind", "operator", "operator_class", "street", "commune"}  # fmt: skip
    assert [p["uuid"] for p in item["pieces"]] == sorted([a, b])
    piece = next(p for p in item["pieces"] if p["uuid"] == b)
    assert piece == {"uuid": b, "kind": "verify", "status": "pending", "answer": "not_found",
                     "direction": None,
                     "move_m": None, "operator_name": None, "operator_proposed": None,
                     "before": None, "batch": None, "osm": None}  # fmt: skip
    assert (item["conflict"], item["names"], item["on_site"]) == (False, False, True)
    assert item["confirmed"] == 1  # cy agreed with bob's « introuvable », on site
    assert item["oldest_day"] == item["day"] and not item["test"] and not item["hidden"]
    # The oldest waiting piece (same day: the smaller uuid) names its author, with their
    # record: ana has one accepted (on the other camera), bob none.
    ana = {"pseudonym": "ana", "accepted": 1, "rejected": 0}
    bob = {"pseudonym": "bob", "accepted": 0, "rejected": 0}
    assert item["author"] == (ana if a < b else bob)
    every = items(client, filter="all")
    assert list(every) == sorted([cam, other_camera])  # same day: by id
    assert every[other_camera]["pieces"] == [] and every[other_camera]["on_site"] is None
    assert every[other_camera]["author"] == {"pseudonym": "ana", "accepted": 1, "rejected": 0}
    set_on_site(pg_dsn, a, False)
    assert items(client)[cam]["on_site"] is False  # none on site, one said not
    assert client.get("/api/review/queue", headers=headers("ana")).status_code == 401
    assert client.get("/api/review/queue", params={"filter": "adds"},
                      headers=headers("rev")).status_code == 422  # fmt: skip


def test_search_by_street_commune_pseudonym_or_id(client, near_wall, other_camera, build_id):
    cam = near_wall[0].camera_id
    post(client, cam, build_id, "verify", answer="present")
    post(client, other_camera, build_id, "verify", who="bob", answer="present")
    label = items(client)[cam]["label"]
    assert cam in items(client, q=label["street"].upper())
    assert cam in items(client, q=label["commune"][:4].lower())
    assert list(items(client, q="BOB")) == [other_camera]
    assert list(items(client, q=other_camera[-4:])) == [other_camera]
    assert items(client, q="nowhere-at-all") == {}
    assert queue(client, q="bob")["summary"]["pending"] == 2  # the summary is the site's
    r = client.get("/api/review/queue", params={"q": "x" * 65}, headers=headers("rev"))
    assert r.status_code == 422


def test_on_site_agreement_puts_a_camera_first(client, near_wall, other_camera, build_id, pg_dsn):
    """todo: confirmed > 0 first, then the oldest; an agreement counts only made on site,
    by another account, not disabled: an agree opinion, the same answer to a question."""
    cam = near_wall[0].camera_id
    a, _ = post(client, cam, build_id, "direction", direction=90)
    b, _ = post(client, other_camera, build_id, "verify", answer="not_found")
    owner(pg_dsn, "UPDATE contributions SET day = day - 3 WHERE uuid = %s", (b,))
    assert list(items(client)) == [other_camera, cam]  # the oldest first
    assert queue(client)["summary"]["oldest_days"] == 3
    d, _ = post(client, cam, build_id, "direction", who="bob", direction=100)  # within 20°
    first = items(client)
    assert list(first) == [cam, other_camera] and first[cam]["confirmed"] == 2  # each other
    set_on_site(pg_dsn, d, False)  # bob's no longer confirms ana's; ana's still confirms his
    assert items(client)[cam]["confirmed"] == 1
    set_on_site(pg_dsn, a, False)
    assert items(client)[cam]["confirmed"] == 0 and list(items(client))[0] == other_camera
    post(client, other_camera, build_id, "agree", who="cy", target=b)
    post(client, other_camera, build_id, "agree", who="dan", target=b)
    assert items(client)[other_camera]["confirmed"] == 2
    owner(pg_dsn, "UPDATE accounts SET disabled = true WHERE pseudonym = 'dan'")
    try:
        assert items(client)[other_camera]["confirmed"] == 1  # a disabled voice never counts
    finally:
        owner(pg_dsn, "UPDATE accounts SET disabled = false WHERE pseudonym = 'dan'")


def test_the_other_filters_test_accounts_and_hidden_cameras(
    client, near_wall, other_camera, build_id, pg_dsn, facade_point
):
    cam = near_wall[0].camera_id
    w, _ = post(client, cam, build_id, "verify", answer="present")
    client.post("/api/contributions/withdraw", json={"uuid": w}, headers=headers())
    t, _ = post(client, other_camera, build_id, "verify", who="ivo", answer="present")
    owner(pg_dsn, "UPDATE contributions SET status = 'conflict' WHERE uuid = %s", (t,))
    subprocess.run([SCRIPT, "ivo", pg_dsn], check=True, capture_output=True)
    add, _ = post_add(client, build_id, facade_point)
    added = participation.added_id(add)
    post(client, added, build_id, "shape", answer="bullet")
    n, r = post(client, added, build_id, "operator", who="bob", answer="business",
                operator_proposed="Boulangerie Dupont")  # fmt: skip
    assert r.status_code == 200, r.text
    assert cam not in items(client, filter="all")  # withdrawn only: in no filter
    conflicts = items(client, filter="conflicts")
    assert list(conflicts) == [other_camera] and conflicts[other_camera]["test"] is True
    assert conflicts[other_camera]["conflict"]
    # S2: a conflicts-only item lists its conflict rows, marked so.
    assert [(p["uuid"], p["status"]) for p in conflicts[other_camera]["pieces"]] == [
        (t, "conflict")]  # fmt: skip
    names = items(client, filter="names")
    assert list(names) == [added] and names[added]["names"]
    label = names[added]["label"]
    assert label["add"] and not label["built"] and label["kind"] == "fixed"  # bullet: fixed
    assert label["operator_class"] == "private_outdoor"  # business, in the served words
    assert label["operator"] is None  # the proposed name, not chosen
    assert label["street"] and label["commune"]  # its nearest built camera's
    proposed = next(p for p in names[added]["pieces"] if p["uuid"] == n)
    assert proposed["operator_proposed"] == "Boulangerie Dupont" and proposed["before"] is None
    # The test account's conflict stays listed, out of the summary.
    assert queue(client)["summary"]["counts"] == {"todo": 1, "conflicts": 0, "names": 1,
                                                  "osm": 0}  # fmt: skip
    owner(pg_dsn, "INSERT INTO hidden_cameras (camera_id) VALUES (%s)", (added,))
    try:
        assert items(client)[added]["hidden"] is True
    finally:
        owner(pg_dsn, "DELETE FROM hidden_cameras WHERE camera_id = %s", (added,))


def test_the_window_of_one_camera(client, near_wall, build_id):
    cam = near_wall[0].camera_id
    a, _ = post(client, cam, build_id, "verify", answer="not_found")  # a proposal
    b, _ = post(client, cam, build_id, "shape", who="bob", answer="unknown")  # "Je ne sais pas"
    post(client, cam, build_id, "agree", who="cy", target=a)
    w = client.get("/api/review/camera", params={"camera": cam}, headers=headers("rev")).json()
    served = w["served"]
    assert served["osm_type"] and served["osm_version"] and isinstance(served["tags"], dict)
    assert served["kind"] and served["commune"] and w["field"]
    # Every contribution but the opinion (counted on its proposal).
    assert {c["uuid"] for c in w["contributions"]} == {a, b}
    assert next(c for c in w["contributions"] if c["uuid"] == a)["agree"] == 1
    assert all(n["m"] <= 10 for n in w["near"])
    r = client.get("/api/review/camera", params={"camera": "n0"}, headers=headers("rev"))
    assert r.status_code == 404


def test_the_window_says_label_destination_record_and_confirmation(
    client, near_wall, build_id, pg_dsn
):
    cam = near_wall[0].camera_id
    a, _ = post(client, cam, build_id, "verify", answer="not_found")
    b, _ = post(client, cam, build_id, "direction", who="bob", direction=45)
    post(client, cam, build_id, "agree", who="cy", target=a)  # on site
    client.post("/api/review/decide", json={"uuid": b, "decision": "rejected"},
                headers=headers("rev"))  # fmt: skip

    def window():
        r = client.get("/api/review/camera", params={"camera": cam}, headers=headers("rev"))
        assert r.status_code == 200
        return r.json()

    w = window()
    assert w["label"] == items(client, filter="all")[cam]["label"] and w["label"]["street"]
    assert "position_source" in w["served"] and w["served"]["position_source"] is None
    rows = {c["uuid"]: c for c in w["contributions"]}
    assert all("osm_publish" not in c for c in rows.values())
    assert rows[a]["destination"] == {"where": "sw"} and rows[a]["confirmed"] == 1
    assert rows[a]["author_record"] == {"accepted": 0, "rejected": 0}
    assert rows[b]["author_record"] == {"accepted": 0, "rejected": 1} and rows[b]["confirmed"] == 0
    assert all("duration_ms" not in c for c in rows.values())  # lot 4: no longer kept
    owner(pg_dsn, "INSERT INTO osm_publications (uuid, server, state, changeset, month)"
                  " VALUES (%s, 'dev', 'published', 4242, date_trunc('month', current_date))",
          (a,))  # fmt: skip
    dest = {c["uuid"]: c for c in window()["contributions"]}[a]["destination"]
    assert dest == {"where": "osm", "server": "dev", "state": "published", "reason": None,
                    "changeset": 4242, "month": date.today().strftime("%Y-%m")}  # fmt: skip


def test_validate_what_was_done_on_site(client, near_wall, build_id, pg_dsn):
    cam = near_wall[0].camera_id
    on, _ = post(client, cam, build_id, "verify", answer="present")
    off, _ = post(client, cam, build_id, "verify", who="bob", answer="present")
    set_on_site(pg_dsn, off, False)
    blank, _ = post(client, cam, build_id, "shape", who="cy", answer="unknown")
    r = client.post("/api/review/decide-on-site", json={"camera": cam}, headers=headers("rev"))
    assert r.status_code == 200 and r.json()["validated"] == [on]
    with psycopg.connect(pg_dsn) as conn:
        got = dict(conn.execute("SELECT uuid::text, status FROM contributions").fetchall())
    assert (got[on], got[off], got[blank]) == ("validated", "pending", "pending")
    r = client.post("/api/review/decide-on-site", json={"camera": cam}, headers=headers("ana"))
    assert (r.status_code, r.json()) == (401, {"error": "privileged"})


@pytest.fixture(scope="module")
def facade_point(pg_dsn, pg_loaded):
    """1 m off a facade, more than 20 m from every camera (as in test_add)."""
    return live.to_lonlat(644329.8662116162 + 0.7, 6866484.319232392 + 0.7)


def test_decisions_share_one_rate_bucket_per_reviewer(client, near_wall, build_id, monkeypatch):
    """limits.review_per_minute counts decide, decide-on-site and undo together; over it,
    429 rate; another reviewer has its own bucket."""
    rules = participation.rules()
    limited = {**rules, "limits": {**rules["limits"], "review_per_minute": 3}}
    monkeypatch.setattr(participation, "rules", lambda: limited)
    cam = near_wall[0].camera_id
    a, _ = post(client, cam, build_id, "verify", answer="present")
    b, _ = post(client, cam, build_id, "verify", who="bob", answer="present")
    ok = client.post("/api/review/decide", json={"uuid": a, "decision": "validated"},
                     headers=headers("rev"))  # fmt: skip
    site = client.post("/api/review/decide-on-site", json={"camera": cam}, headers=headers("rev"))
    back = client.post("/api/review/undo", json={"uuids": [a]}, headers=headers("rev"))
    over = client.post("/api/review/decide", json={"uuid": b, "decision": "rejected"},
                       headers=headers("rev"))  # fmt: skip
    codes = (ok.status_code, site.status_code, back.status_code, over.status_code)
    assert codes == (200, 200, 200, 429)
    assert over.json() == {"error": "rate"}
    sessions.account_id("rev2", role="reviewer")
    other = client.post("/api/review/decide", json={"uuid": b, "decision": "rejected"},
                        headers=headers("rev2"))  # fmt: skip
    assert other.status_code == 200


def undo(client, *uuids, who="rev"):
    return client.post("/api/review/undo", json={"uuids": list(uuids)}, headers=headers(who))


def decide(client, uid, decision="validated", who="rev", **extra):
    r = client.post("/api/review/decide", json={"uuid": uid, "decision": decision, **extra},
                    headers=headers(who))  # fmt: skip
    assert r.status_code == 200, r.text
    return r


def state(dsn, *uuids):
    with psycopg.connect(dsn) as conn:
        return {u: s for u, *s in conn.execute(
            "SELECT uuid::text, status, decided_by_id IS NULL, decided_on IS NULL,"
            " operator_choice, operator_name FROM contributions WHERE uuid = ANY(%s::uuid[])",
            (list(uuids),))}  # fmt: skip


def test_undo_puts_today_s_own_decision_back_to_pending(client, near_wall, build_id, pg_dsn):
    cam = near_wall[0].camera_id
    a, _ = post(client, cam, build_id, "verify", answer="not_found")
    b, _ = post(client, cam, build_id, "verify", who="bob", answer="present")
    decide(client, a)
    decide(client, b, "rejected")
    r = undo(client, a, b)
    assert r.status_code == 200 and r.json() == {"undone": sorted([a, b])}
    assert state(pg_dsn, a, b) == {a: ["pending", True, True, None, None],
                                   b: ["pending", True, True, None, None]}  # fmt: skip
    assert a in {p["uuid"] for p in items(client)[cam]["pieces"]}  # waiting again
    again = undo(client, a)
    assert again.status_code == 409 and again.json() == {"error": "not_undoable"}
    # Another reviewer's decision, yesterday's, or one a build applied: not this undo's.
    sessions.account_id("rev2", role="reviewer")
    decide(client, a, who="rev2")
    assert undo(client, a).status_code == 409
    decide(client, b)
    owner(pg_dsn, "UPDATE contributions SET decided_on = decided_on - 1 WHERE uuid = %s", (b,))
    assert undo(client, b).status_code == 409
    owner(pg_dsn, "UPDATE contributions SET status = 'applied', decided_on = current_date"
                  " WHERE uuid = %s", (b,))  # fmt: skip
    assert undo(client, b).status_code == 409
    assert undo(client, a, who="ana").status_code == 401
    assert undo(client, "not-a-uuid").status_code == 422
    assert undo(client, *[str(uuid.uuid4()) for _ in range(101)]).status_code == 422
    r = client.post("/api/review/undo", json={"uuids": []}, headers=headers("rev"))
    assert r.status_code == 422


def test_undo_takes_back_a_send_and_an_add_s_answers(
    client, near_wall, build_id, pg_dsn, facade_point
):
    cam = near_wall[0].camera_id
    batch = str(uuid.uuid4())
    shape, _ = post(client, cam, build_id, "shape", answer="bullet", batch=batch)
    aim, _ = post(client, cam, build_id, "direction", direction=90, batch=batch)
    decide(client, batch)  # the send, by its id
    assert undo(client, aim).json() == {"undone": sorted([shape, aim])}  # by one piece
    add, _ = post_add(client, build_id, facade_point)
    added = participation.added_id(add)
    answer, _ = post(client, added, build_id, "shape", who="bob", answer="dome")
    decide(client, add, "rejected")  # its answers leave with it
    assert state(pg_dsn, answer)[answer][0] == "rejected"
    assert undo(client, add).json() == {"undone": sorted([add, answer])}
    assert {v[0] for v in state(pg_dsn, add, answer).values()} == {"pending"}


def test_undo_lets_a_proposed_name_wait_for_its_choice_again(client, near_wall, build_id, pg_dsn):
    cam = near_wall[0].camera_id
    n, r = post(client, cam, build_id, "operator", answer="business",
                operator_proposed="Boulangerie Dupont")  # fmt: skip
    assert r.status_code == 200, r.text
    decide(client, n, operator={"choice": "proposed"})
    assert state(pg_dsn, n)[n][3:] == ["proposed", "Boulangerie Dupont"]
    assert cam not in items(client, filter="names")
    assert undo(client, n).status_code == 200
    assert state(pg_dsn, n)[n] == ["pending", True, True, None, None]
    assert cam in items(client, filter="names")
