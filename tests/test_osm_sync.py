"""The OSM synchronisation's job (lacarte.api.sync, migration 022, rules/publish.yaml v3):
passes run by hand (sync_once) against a fake OSM on 127.0.0.1 (tests/fakeosm.py; never
openstreetmap.org), on fictitious accounts and contributions in the throwaway database.
The owner's conditions 1-6 for the synchronisation (2026-10-16): from the
consent day only, exactly what was sent, version control and duplicates, one changeset per
person per pass with its tags and caps, the live server only with /revue's switch, the
suspension; then reconciliation, backoff, refusals, the lock, the logs."""

import logging
import threading
from datetime import date
from uuid import uuid4

import fakeosm
import psycopg
import pytest
import sessions
from fastapi.testclient import TestClient
from test_osm_publish_api import (
    AT,
    DAY,
    KEY,
    SUB,
    added,
    change,
    make,
    mapped,
    node_tags,
    nodes,
    on_add,
    osm_cameras,
    publications,
    put,
)

from lacarte.api import app as api
from lacarte.api import osm, publish, sync

TODAY = date(2026, 10, 16)
NORTH = 1 / 111_195  # a metre north, in degrees


@pytest.fixture(scope="module")
def fake():
    f = fakeosm.FakeOsm()
    yield f
    f.close()


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app, follow_redirects=False) as c:
        yield c


def switch(dsn, key: str, value: bool) -> None:
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE site_settings SET value = %s WHERE key = %s", (value, key))
    api.switches.forget()


@pytest.fixture(autouse=True)
def on(monkeypatch, client, fake, pg_dsn):
    """Writing to the fake as the test server, signing in there too (offered); the job's
    backoff fresh; the switches at their defaults; this file's accounts, contributions and
    nodes gone."""
    fake.reset()
    s = api.settings
    monkeypatch.setattr(s, "osm_login_server", "dev")
    monkeypatch.setattr(s, "osm_write_server", "dev")
    monkeypatch.setattr(s, "osm_write_url", fake.url)
    monkeypatch.setattr(s, "osm_write_client_id", fakeosm.CLIENT_ID)
    monkeypatch.setattr(s, "osm_write_client_secret", fakeosm.CLIENT_SECRET)
    monkeypatch.setattr(s, "osm_token_key", KEY)
    for k in ("osm_live_write_url", "osm_live_write_client_id", "osm_live_write_client_secret"):
        monkeypatch.setattr(s, k, "")
    monkeypatch.setattr(sync, "backoff", sync.Backoff())
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
        conn.execute("DELETE FROM osm_nodes")
        conn.execute("DELETE FROM accounts WHERE pseudonym ~ '^syn'")
        conn.execute("UPDATE site_settings SET value = (key <> 'osm_write_live')")
    api.switches.forget()
    yield
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
        conn.execute("DELETE FROM osm_nodes")
        conn.execute("UPDATE site_settings SET value = (key <> 'osm_write_live')")
    api.switches.forget()


def chose(dsn, fake, aid, consent=DAY, server="dev") -> str:
    """The account chose to publish on `server` on `consent`, with a token the fake issued
    (with write_api): the token."""
    token = f"write-token-{uuid4().hex}"
    fake.issued.append(token)
    fake.granted[token] = "openid write_api"
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_write (account_id, server, osm_uid, token, since_month,"
                     " consent_day) VALUES (%s, %s, %s, %s, %s, %s)",
                     (aid, server, SUB, publish.seal(KEY, aid, server, token),
                      consent.replace(day=1), consent))  # fmt: skip
    return token


def state(dsn, aid) -> tuple | None:
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT token IS NOT NULL, failures, last_error, sent_day, sent_n"
                            " FROM osm_write WHERE account_id = %s", (aid,)).fetchone()  # fmt: skip


def run(today=TODAY) -> dict:
    return sync.once(lambda: psycopg.connect(api.settings.dsn, autocommit=True),
                     api.sync_config(), today)  # fmt: skip


def api_calls(fake) -> list[tuple[str, str]]:
    return [r for r in fake.requests if r[1].startswith("/api/")]


# --- what leaves, and how --------------------------------------------------------------------


def test_one_changeset_per_person_with_what_she_observed_since_her_choice(fake, pg_dsn):
    """Condition 1 and 4: each person's own changeset, under her token, its tags (the comment
    written from what it holds, the hashtag, the page; source=survey; no mechanical=yes);
    only what she observed from her consent day; nothing of someone who did not choose."""
    ana, bob, cy = make(pg_dsn, "syn-ana"), make(pg_dsn, "syn-bob"), make(pg_dsn, "syn-cy")
    ana_token = chose(pg_dsn, fake, ana)
    bob_token = chose(pg_dsn, fake, bob, consent=date(2026, 10, 11))
    add, cam = added(pg_dsn, ana)
    aim = on_add(pg_dsn, ana, add, "direction", direction=135)
    shape = on_add(pg_dsn, ana, add, "shape", answer="dome")
    before, _ = added(pg_dsn, bob, at=(2.2410, 48.8925))  # the 9th: before bob's choice
    after, cam2 = added(pg_dsn, bob, at=(2.2420, 48.8930), day=date(2026, 10, 12))
    added(pg_dsn, cy, at=(2.2430, 48.8935))  # cy never chose
    out = run()
    assert (out["state"], out["server"], out["accounts"], out["changesets"]) == (
        "done", "dev", 2, 2)  # fmt: skip
    assert (out["published"], out["conflicts"], out["errors"]) == (4, 0, {})
    by_token = {c["token"]: (cid, c) for cid, c in fake.changesets.items()}
    cid, cs = by_token[ana_token]
    assert cs["tags"] == {
        "source": "survey", "hashtags": "#SurveillanceWorld",
        "created_by": "Surveillance World dev",
        "description": "https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Surveillance_World",
        "comment": "Caméras de surveillance relevées sur place : 1 ajout, 1 forme, 1 direction"
                   " #SurveillanceWorld https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Surveillance_World",
    }  # fmt: skip
    assert cs["open"] is False
    (created,) = change(fake, cid).iter("node")
    assert node_tags(created) == {"man_made": "surveillance", "surveillance:type": "camera",
                                  "surveillance": "outdoor", "camera:type": "dome",
                                  "camera:direction": "135"}  # fmt: skip
    cid2, _ = by_token[bob_token]
    assert len(list(change(fake, cid2).iter("node"))) == 1
    pubs = publications(pg_dsn)
    assert {u: p[1] for u, p in pubs.items()} == dict.fromkeys(
        [add, aim, shape, after], "published")  # fmt: skip
    assert before not in pubs
    assert set(nodes(pg_dsn)) == {("dev", cam), ("dev", cam2)}
    assert state(pg_dsn, ana) == (True, 0, None, TODAY, 1)
    # Nothing new: the next pass asks OSM nothing.
    asked = len(fake.requests)
    assert run()["accounts"] == 0 and len(fake.requests) == asked


def test_nothing_to_send_asks_nothing_of_osm(fake, pg_dsn):
    """A person whose choice is on with nothing that may leave (pending, not on site, a
    height, a name the review chose): no request at all, not even her permissions."""
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid, status="validated")
    on_add(pg_dsn, aid, add, "height", answer="first")
    added(pg_dsn, aid, on_site=False, at=(2.2410, 48.8925))
    assert run()["accounts"] == 0 and fake.requests == []


def test_exactly_what_she_sent(fake, pg_dsn):
    """Condition 2: a name the review replaced by a listed one (or dropped) keeps the
    contribution here; one kept as typed leaves, with the rest."""
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    kept = on_add(pg_dsn, aid, add, "operator", answer="business")
    add2, _ = added(pg_dsn, aid, at=(2.2410, 48.8925))
    typed = on_add(pg_dsn, aid, add2, "operator", answer="public")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET operator_proposed = 'Chez Paul',"
                     " operator_choice = 'listed', operator_name = 'Monoprix' WHERE uuid = %s",
                     (kept,))  # fmt: skip
        conn.execute("UPDATE contributions SET operator_proposed = 'Ville de Puteaux',"
                     " operator_choice = 'proposed', operator_name = 'Ville de Puteaux'"
                     " WHERE uuid = %s", (typed,))  # fmt: skip
    run()
    pubs = publications(pg_dsn)
    assert kept not in pubs and pubs[typed][1] == "published"
    sent = [node_tags(n) for cs in fake.changesets for n in change(fake, cs).iter("node")]
    assert "Monoprix" not in str(sent) and any(t.get("operator") == "Ville de Puteaux"
                                               for t in sent)  # fmt: skip


def test_osm_changed_or_a_camera_nearby_writes_nothing_and_says_it(fake, pg_dsn, monkeypatch):
    """Condition 3: an OSM camera edited since the observation is a conflict (never
    overwritten); a camera within 5 m of an add, a conflict osm_duplicate (nothing
    created). Both for the review, and nothing of them leaves again."""
    s = api.settings
    monkeypatch.setattr(s, "osm_live_write_url", fake.url)
    monkeypatch.setattr(s, "osm_live_write_client_id", fakeosm.CLIENT_ID)
    monkeypatch.setattr(s, "osm_live_write_client_secret", fakeosm.CLIENT_SECRET)
    switch(pg_dsn, "osm_write_live", True)
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid, server="live")
    ((cam, ref, tags, at),) = osm_cameras(pg_dsn, 1)
    mapped(fake, ref, tags, at, **{"camera:type": "dome"})
    fake.nodes[ref[1]]["version"] += 1
    shape = put(pg_dsn, aid, "shape", cam, answer="bullet", osm=ref, tags=tags, at=at)
    add, _ = added(pg_dsn, aid)
    fake.node(1, AT[0], AT[1] + 3 * NORTH, {"man_made": "surveillance"})
    out = run()
    assert (out["changesets"], out["conflicts"]) == (0, 2)
    pubs = publications(pg_dsn)
    assert (pubs[shape][1:3], pubs[add][1:3]) == (("conflict", "osm_tags"),
                                                  ("conflict", "osm_duplicate"))  # fmt: skip
    assert fake.nodes[ref[1]]["tags"]["camera:type"] == "dome" and len(fake.nodes) == 2
    asked = len(fake.requests)
    assert run()["accounts"] == 0 and len(fake.requests) == asked


def test_the_live_server_only_with_the_switch(fake, pg_dsn, monkeypatch):
    """Condition 5: the live client configured, the switch off: a choice made on the live
    server sends nothing there (writing goes to the test server, where she has no choice);
    switched on, it goes."""
    other = fakeosm.FakeOsm()
    try:
        s = api.settings
        monkeypatch.setattr(s, "osm_live_write_url", other.url)
        monkeypatch.setattr(s, "osm_live_write_client_id", fakeosm.CLIENT_ID)
        monkeypatch.setattr(s, "osm_live_write_client_secret", fakeosm.CLIENT_SECRET)
        aid = make(pg_dsn, "syn-a")
        chose(pg_dsn, other, aid, server="live")
        add, _ = added(pg_dsn, aid)
        out = run()
        assert (out["server"], out["accounts"]) == ("dev", 0)
        assert other.requests == [] and fake.requests == []
        switch(pg_dsn, "osm_write_live", True)
        out = run()
        assert (out["server"], out["changesets"]) == ("live", 1)
        assert publications(pg_dsn)[add][:2] == ("live", "published")
        # Signing in on the live server, writing to the test one: not offered, nobody asked.
        switch(pg_dsn, "osm_write_live", False)
        monkeypatch.setattr(s, "osm_login_server", "live")
        added(pg_dsn, aid, at=(2.2410, 48.8925))
        asked = len(other.requests)
        assert run()["state"] == "not_offered" and len(other.requests) == asked
        assert fake.requests == []
    finally:
        other.close()


def test_suspended_no_call_at_all_and_resuming_selects_again(fake, pg_dsn):
    """Condition 6: osm_sync off: no request, not even to reconcile a `sending` row; what
    the review rejected meanwhile does not leave once resumed."""
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    gone, _ = added(pg_dsn, aid, at=(2.2410, 48.8925))
    stuck, _ = added(pg_dsn, aid, at=(2.2420, 48.8930))
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_publications VALUES (%s, 'dev', 'sending', NULL, 9999,"
                     " '2026-10-01')", (stuck,))  # fmt: skip
    switch(pg_dsn, "osm_sync", False)
    assert run()["state"] == "suspended" and fake.requests == []
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE contributions SET status = 'rejected' WHERE uuid = %s", (gone,))
    switch(pg_dsn, "osm_sync", True)
    out = run()
    assert out["published"] == 1 and publications(pg_dsn)[add][1] == "published"
    assert gone not in publications(pg_dsn)


def test_only_what_she_sent_after_choosing_even_the_same_day(fake, pg_dsn):
    """Condition 1: an add she sent in the morning of the day she chose (received while her
    choice was off) never leaves; the one sent after, the same day, does."""
    aid = make(pg_dsn, "syn-s")
    morning, _ = added(pg_dsn, aid, chosen=False)
    chose(pg_dsn, fake, aid)
    evening, _ = added(pg_dsn, aid, at=(2.2410, 48.8925))
    assert run()["published"] == 1
    assert evening in publications(pg_dsn) and morning not in publications(pg_dsn)


def test_another_key_keeps_her_choice_and_token(fake, pg_dsn, monkeypatch):
    """A deploy with another OSM_TOKEN_KEY (well formed): nothing sent, her choice and her
    token untouched; the right key back, it leaves."""
    aid = make(pg_dsn, "syn-k")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    monkeypatch.setattr(api.settings, "osm_token_key", bytes(32))
    out = run()
    assert out["published"] == 0 and out["errors"] == {"unreadable": 1}
    assert api_calls(fake) == [] and state(pg_dsn, aid) == (True, 0, None, None, 0)
    monkeypatch.setattr(api.settings, "osm_token_key", KEY)
    assert run()["published"] == 1 and publications(pg_dsn)[add][1] == "published"


def test_writing_not_offered_or_no_key_makes_no_call(fake, pg_dsn, monkeypatch):
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    added(pg_dsn, aid)
    monkeypatch.setattr(api.settings, "osm_token_key", None)
    assert run()["state"] == "not_offered"
    monkeypatch.setattr(api.settings, "osm_token_key", KEY)
    monkeypatch.setattr(api.settings, "osm_write_server", "")
    assert run()["state"] == "not_offered" and fake.requests == []


def test_never_a_test_or_disabled_account_a_hidden_or_household_camera(fake, pg_dsn):
    test, off, aid = make(pg_dsn, "syn-t", test=True), make(pg_dsn, "syn-d"), make(pg_dsn, "syn-a")
    for who in (test, off, aid):
        chose(pg_dsn, fake, who)
    added(pg_dsn, test)
    added(pg_dsn, off, at=(2.2410, 48.8925))
    hidden, cam = added(pg_dsn, aid, at=(2.2420, 48.8930))
    house, cam2 = added(pg_dsn, aid, at=(2.2430, 48.8935))
    on_add(pg_dsn, test, house, "operator", answer="household", status="pending")
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET disabled = true WHERE id = %s", (off,))
        conn.execute("INSERT INTO hidden_cameras (camera_id) VALUES (%s)", (cam,))
    try:
        assert run()["accounts"] == 0 and fake.requests == []
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM hidden_cameras WHERE camera_id = %s", (cam,))
    assert publications(pg_dsn) == {}


@pytest.mark.parametrize("meanwhile", ["hidden", "rejected", "disabled", "suspended"])
def test_what_changed_while_the_pass_read_osm_stops_the_upload(fake, pg_dsn, monkeypatch,
                                                                meanwhile):  # fmt: skip
    """A camera hidden, a contribution rejected, an account disabled or the synchronisation
    suspended while the pass was reading OSM: nothing is uploaded, nothing recorded; the
    next pass selects again."""
    aid = make(pg_dsn, "syn-m")
    chose(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    change = {
        "hidden": ("INSERT INTO hidden_cameras (camera_id) VALUES (%s)", cam),
        "rejected": ("UPDATE contributions SET status = 'rejected' WHERE uuid = %s", add),
        "disabled": ("UPDATE accounts SET disabled = true WHERE id = %s", aid),
        "suspended": ("UPDATE site_settings SET value = false WHERE key = 'osm_sync'"
                      " AND %s::uuid IS NOT NULL", aid),
    }[meanwhile]  # fmt: skip
    reading = publish.duplicates

    def meanwhile_change(*args, **kw):
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute(change[0], (change[1],))
        return reading(*args, **kw)

    monkeypatch.setattr(publish, "duplicates", meanwhile_change)
    try:
        summary = run()
        assert summary["published"] == 0 and summary["errors"] == {"off": 1}
        assert not any(path.endswith("/upload") for _, path in api_calls(fake))
        assert publications(pg_dsn) == {}
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM hidden_cameras WHERE camera_id = %s", (cam,))
            conn.execute("UPDATE accounts SET disabled = false WHERE id = %s", (aid,))


# --- caps ------------------------------------------------------------------------------------


def test_at_most_max_cameras_per_pass_the_oldest_first(fake, pg_dsn, monkeypatch):
    rules = publish.rules()
    rules["max_cameras"]["value"] = 1
    monkeypatch.setattr(publish, "rules", lambda: rules)
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    newer, _ = added(pg_dsn, aid, day=date(2026, 10, 12))
    older, _ = added(pg_dsn, aid, at=(2.2410, 48.8925), day=date(2026, 10, 10))
    assert run()["published"] == 1 and list(publications(pg_dsn)) == [older]
    assert run()["published"] == 1 and set(publications(pg_dsn)) == {older, newer}


def test_at_most_max_changesets_a_day_per_person(fake, pg_dsn, monkeypatch):
    rules = publish.rules()
    rules["max_cameras"]["value"] = 1
    rules["sync"]["max_changesets_per_day"] = 2
    monkeypatch.setattr(publish, "rules", lambda: rules)
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    for i in range(3):
        added(pg_dsn, aid, at=(2.2400 + i / 1000, 48.8920))
    assert run()["changesets"] == 1 and run()["changesets"] == 1
    asked = len(fake.requests)
    out = run()
    assert (out["changesets"], out["skipped"]) == (0, {"capped": 1})
    assert len(fake.requests) == asked and state(pg_dsn, aid)[3:] == (TODAY, 2)
    out = run(date(2026, 10, 17))  # the next day
    assert out["changesets"] == 1 and state(pg_dsn, aid)[3:] == (date(2026, 10, 17), 1)


# --- reconciling `sending` -------------------------------------------------------------------


def forgive(dsn, aid, monkeypatch) -> None:
    """The refusals in a row forgotten (here and in memory): the next pass tries her."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE osm_write SET failures = 0, last_error = NULL WHERE account_id = %s",
                     (aid,))  # fmt: skip
    monkeypatch.setattr(sync, "backoff", sync.Backoff())


def stuck_upload(fake, pg_dsn, aid, monkeypatch, **kw) -> tuple[str, str, int]:
    """An add whose upload OSM applied but answered 504 (a proxy): left `sending`."""
    add, cam = added(pg_dsn, aid, **kw)
    fake.after_upload = 504
    out = run()
    fake.after_upload = None
    assert out["errors"] == {"osm_down": 1}, out
    (cid,) = [cid for cid, c in fake.changesets.items() if c["applied"]][-1:]
    assert publications(pg_dsn)[add][1:] == ("sending", None, cid)
    forgive(pg_dsn, aid, monkeypatch)
    return add, cam, cid


def test_a_sending_row_is_reconciled_with_its_changeset(fake, pg_dsn, monkeypatch):
    """Closed with changes, our node in it: published, its node known (later answers modify
    it). Never sent twice: one node on OSM."""
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, cam, cid = stuck_upload(fake, pg_dsn, aid, monkeypatch)
    created = len(fake.nodes)
    out = run()
    assert out["reconciled"] == {"published": 1}
    assert publications(pg_dsn)[add][1:] == ("published", None, cid)
    assert nodes(pg_dsn)[("dev", cam)] == (fake.next_node, 1) and len(fake.nodes) == created
    aim = on_add(pg_dsn, aid, add, "direction", direction=10, day=date(2026, 10, 12))
    assert run()["published"] == 1 and publications(pg_dsn)[aim][1] == "published"
    assert fake.nodes[fake.next_node]["tags"]["camera:direction"] == "10"


def test_an_open_changeset_waits_and_an_empty_one_lets_them_leave_again(fake, pg_dsn,
                                                                         monkeypatch):  # fmt: skip
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)

    def cut(_body):
        raise ConnectionResetError  # no answer, nothing applied

    fake.on_upload = cut
    assert run()["errors"] == {"osm_down": 1}
    fake.on_upload = None
    (cid,) = fake.changesets
    assert publications(pg_dsn)[add][1] == "sending"
    forgive(pg_dsn, aid, monkeypatch)
    fake.changesets[cid]["open"] = True  # OSM has not closed it yet
    out = run()
    assert out["reconciled"] == {"waiting": 1} and out["accounts"] == 0
    fake.changesets[cid]["open"] = False  # closed after an hour, nothing in it
    out = run()
    assert out["reconciled"] == {"cleared": 1} and out["published"] == 1
    assert publications(pg_dsn)[add][1] == "published"
    assert len([n for n in fake.nodes.values() if n["tags"].get("man_made")]) == 1


def test_what_cannot_be_matched_is_uncertain_and_never_sent_again(fake, pg_dsn, monkeypatch):
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _, cid = stuck_upload(fake, pg_dsn, aid, monkeypatch)
    fake.changesets[cid]["applied"] = [("modify", 42, 3, 48.0, 2.0, {"name": "x"})]
    out = run()
    assert out["reconciled"] == {"uncertain": 1} and out["accounts"] == 0
    assert publications(pg_dsn)[add][1:] == ("uncertain", None, cid)
    asked = len(fake.requests)
    assert run()["reconciled"] == {} and len(fake.requests) == asked
    # A changeset OSM does not know: uncertain too; one it cannot read now: later.
    other, _ = added(pg_dsn, aid, at=(2.2410, 48.8925))
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_publications VALUES (%s, 'dev', 'sending', NULL, 77777,"
                     " '2026-10-01')", (other,))  # fmt: skip
    fake.status["changeset"] = 503
    assert run()["reconciled"] == {"unread": 1}
    del fake.status["changeset"]
    assert run()["reconciled"] == {"uncertain": 1}


# --- refusals --------------------------------------------------------------------------------


@pytest.mark.parametrize(("force", "error"), [
    ({"permissions": 503}, "osm_down"), ({"permissions": 429}, "rate_limited"),
    ({"create": 429}, "rate_limited"), ({"map": 500}, "osm_down"),
])  # fmt: skip
def test_osm_down_or_rate_limited_backs_off_then_tries_again(fake, pg_dsn, monkeypatch, force,
                                                             error):  # fmt: skip
    clock = [1000.0]
    monkeypatch.setattr(sync, "backoff", sync.Backoff(lambda: clock[0]))
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    fake.status.update(force)
    assert run()["errors"] == {error: 1}
    assert state(pg_dsn, aid)[:3] == (True, 1, error)
    asked = len(fake.requests)
    assert run()["skipped"] == {"backoff": 1} and len(fake.requests) == asked
    clock[0] += 15 * 60  # the first step
    assert run()["errors"] == {error: 1} and state(pg_dsn, aid)[1] == 2
    clock[0] += 15 * 60  # not the second step (an hour)
    assert run()["skipped"] == {"backoff": 1}
    # After a restart, the memory is gone: the step starts again from the first sight.
    monkeypatch.setattr(sync, "backoff", sync.Backoff(lambda: clock[0]))
    assert run()["skipped"] == {"backoff": 1}
    fake.status.clear()
    clock[0] += 60 * 60
    out = run()
    assert out["published"] == 1 and out["errors"] == {}
    assert state(pg_dsn, aid)[:3] == (True, 0, None)
    assert publications(pg_dsn)[add][1] == "published"


@pytest.mark.parametrize("how", ["revoked", "permissions"])
def test_a_token_osm_refuses_ends_her_choice_and_says_it(fake, pg_dsn, how):
    """Revoked in her OSM settings (401), or the right to write taken back (permissions
    without allow_write_api): the token is deleted, the class kept (« Compte » says it), no
    more requests for her. (A key that no longer opens it keeps it: another test.)"""
    aid = make(pg_dsn, "syn-a")
    token = chose(pg_dsn, fake, aid)
    added(pg_dsn, aid)
    if how == "revoked":
        fake.revoked.append(token)
    else:
        fake.permissions = ["allow_read_prefs"]
    assert run()["errors"] == {"revoked": 1}
    assert state(pg_dsn, aid)[:3] == (False, 1, "revoked")
    assert fake.changesets == {} and publications(pg_dsn) == {}
    if how == "permissions":
        assert token in fake.revoked  # a valid token without the right: revoked at OSM
    asked = len(fake.requests)
    assert run()["accounts"] == 0 and len(fake.requests) == asked


def test_a_403_with_the_right_to_write_is_a_block_no_more_tries(fake, pg_dsn):
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    fake.status["upload"] = 403
    assert run()["errors"] == {"blocked": 1}
    assert state(pg_dsn, aid)[:3] == (True, 1, "blocked")
    assert add not in publications(pg_dsn)  # OSM refused the upload: nothing went
    del fake.status["upload"]
    asked = len(fake.requests)
    assert run()["accounts"] == 0 and len(fake.requests) == asked


def test_a_conflict_at_the_upload_is_read_again_next_pass(fake, pg_dsn):
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    fake.status["upload"] = 409
    assert run()["errors"] == {"changed": 1}
    assert state(pg_dsn, aid)[:3] == (True, 0, None) and publications(pg_dsn) == {}
    del fake.status["upload"]
    assert run()["published"] == 1


def test_her_choice_ended_while_the_pass_ran_sends_nothing(fake, pg_dsn, monkeypatch):
    """« Rester sur Surveillance World » between the changeset's opening and the upload:
    the rows are not written, nothing is uploaded, the changeset is closed."""
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    add, _ = added(pg_dsn, aid)
    real = publish.open_changeset

    def then_stops(*args):
        cid = real(*args)
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM osm_write WHERE account_id = %s", (aid,))
        return cid

    monkeypatch.setattr(publish, "open_changeset", then_stops)
    assert run()["errors"] == {"off": 1}
    ((cid, cs),) = fake.changesets.items()
    assert cs["uploads"] == [] and cs["open"] is False and publications(pg_dsn) == {}


# --- one pass at a time, the logs, the thread, the command ------------------------------------


def test_two_passes_never_run_together(fake, pg_dsn):
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    added(pg_dsn, aid)
    with psycopg.connect(pg_dsn, autocommit=True) as other:
        other.execute("SELECT pg_advisory_lock(%s)", (sync.LOCK,))
        out = run()
        assert (out["ran"], out["state"]) == (False, "busy") and fake.requests == []
    assert run()["published"] == 1  # the lock released with its session


def test_nothing_identifying_in_the_logs(fake, pg_dsn, caplog):
    aid = make(pg_dsn, "syn-a")
    token = chose(pg_dsn, fake, aid)
    add, cam = added(pg_dsn, aid)
    fake.status["close"] = 500
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        run()
    messages = [r.getMessage() for r in caplog.records]
    assert messages[0] == "osm changeset close failed: HTTP 500"
    assert messages[1].startswith("osm sync pass: done, accounts 1, changesets 1, published 1")
    (cid,) = fake.changesets
    for secret in (token, str(cid), str(fake.next_node), cam, add, aid, str(SUB)):
        assert secret not in caplog.text


def test_the_thread_passes_until_stopped_and_logs_a_failure_by_class(caplog):
    calls = []
    done = threading.Event()

    def pass_():
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("a camera id n1234 in the message")
        if len(calls) >= 3:
            done.set()
        return {}

    job = sync.Job(pass_, every_s=0.01, first_s=0.01)
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        job.start()
        assert done.wait(5)
        job.stop()
    assert not job.thread.is_alive() and len(calls) >= 3
    assert "osm sync pass failed: ValueError" in caplog.text and "n1234" not in caplog.text


def test_the_api_starts_no_thread_in_the_tests():
    assert not [t for t in threading.enumerate() if t.name == "osm-sync"]


def test_the_command_runs_one_pass_and_prints_its_counts(fake, pg_dsn, capsys):
    from lacarte import cli

    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    added(pg_dsn, aid)
    with pytest.raises(SystemExit) as e:
        cli.main(["osm", "sync", "--once", "--dsn", pg_dsn])
    assert e.value.code == 0
    out = capsys.readouterr().out
    assert '"state": "done"' in out and '"published": 1' in out
    with pytest.raises(SystemExit):
        cli.main(["osm", "sync"])  # --once is required: the API's thread runs the others


def test_osm_permissions_are_asked_with_her_token_only(fake, pg_dsn):
    """The pass asks OSM nothing with another token than hers, and the reads it makes
    without one are public."""
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    added(pg_dsn, aid)
    run()
    assert ("GET", "/api/0.6/permissions.json") in api_calls(fake)
    assert all(ua == osm.user_agent() for ua in fake.user_agents)


def test_a_pass_that_did_something_reaches_the_api_s_journal_level(fake, pg_dsn, caplog):
    """The unit runs uvicorn with --log-level warning: a pass that sent is said at WARNING,
    one with nothing to do stays at INFO (out of the journal)."""
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        run()
    assert [r.levelno for r in caplog.records] == [logging.INFO]
    caplog.clear()
    aid = make(pg_dsn, "syn-a")
    chose(pg_dsn, fake, aid)
    added(pg_dsn, aid)
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        run()
    (line,) = [r for r in caplog.records if r.getMessage().startswith("osm sync pass")]
    assert line.levelno == logging.WARNING


def test_the_api_starts_its_thread_and_stops_it(pg_dsn, monkeypatch):
    """OSM_SYNC_THREAD unset (production): the app's lifespan starts the thread, which
    passes after first_pass_s, and stops it on shutdown."""
    rules = publish.rules()
    rules["sync"]["first_pass_s"] = 0.05
    monkeypatch.setattr(publish, "rules", lambda: rules)
    monkeypatch.delenv("OSM_SYNC_THREAD")
    passed = threading.Event()
    monkeypatch.setattr(api, "sync_once", lambda: passed.set() or {})
    with TestClient(api.app):
        assert [t for t in threading.enumerate() if t.name == "osm-sync"]
        assert passed.wait(5)
    assert not [t for t in threading.enumerate() if t.name == "osm-sync"]
