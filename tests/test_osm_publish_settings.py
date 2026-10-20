"""Publishing to OpenStreetMap, its settings and its token (OSM lot 2, lacarte.api.publish;
the synchronisation, migration 022): the deploy's write server (the test server only; the
live one is /revue's switch osm_write_live, with the live client read here), the key, the
sealed token. No request leaves this machine."""

import base64
import logging
import os

import pytest
from cryptography.exceptions import InvalidTag

from lacarte.api import app as api
from lacarte.api import osm, publish

KEY = base64.b64encode(bytes(range(32))).decode()
ACCOUNT = "6a1f3c2e-0000-4000-8000-000000000001"
VARS = ("OSM_WRITE_SERVER", "OSM_WRITE_LIVE_APPROVED", "OSM_TOKEN_KEY", "OSM_DEV_URL",
        "OSM_LIVE_URL", "OSM_DEV_CLIENT_ID", "OSM_DEV_CLIENT_SECRET", "OSM_LIVE_CLIENT_ID",
        "OSM_LIVE_CLIENT_SECRET", "OSM_LOGIN_SERVER")  # fmt: skip


@pytest.fixture
def env(monkeypatch):
    """A clean OSM environment: both clients and the key set, nothing else."""
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    for pair in ("OSM_DEV", "OSM_LIVE"):
        monkeypatch.setenv(f"{pair}_CLIENT_ID", "fake-id")
        monkeypatch.setenv(f"{pair}_CLIENT_SECRET", "fake-secret")
    monkeypatch.setenv("OSM_TOKEN_KEY", KEY)
    return monkeypatch


def settings(caplog=None):
    if caplog is None:
        return api.Settings()
    with caplog.at_level(logging.DEBUG, logger="lacarte.api"):
        return api.Settings()


def test_the_test_server_by_default(env):
    s = settings()
    assert (s.osm_write_server, s.osm_write_url) == ("dev", osm.DEV_URL)
    assert s.osm_token_key == bytes(range(32))


@pytest.mark.parametrize(("changes", "why"), [
    ({"OSM_WRITE_SERVER": "live"}, "server"),
    ({"OSM_WRITE_SERVER": "master"}, "server"),
    ({"OSM_WRITE_SERVER": ""}, "server"),
    ({"OSM_DEV_URL": "http://osm.example"}, "url"),
    ({"OSM_DEV_CLIENT_SECRET": ""}, "client"),
    ({"OSM_TOKEN_KEY": ""}, "key"),
    ({"OSM_TOKEN_KEY": base64.b64encode(bytes(31)).decode()}, "key"),
    ({"OSM_TOKEN_KEY": base64.b64encode(bytes(33)).decode()}, "key"),
    ({"OSM_TOKEN_KEY": "not base64!"}, "key"),
])  # fmt: skip
def test_writing_is_off_and_said_once_by_what_is_missing(env, caplog, changes, why):
    for k, v in changes.items():
        env.setenv(k, v)
    s = settings(caplog)
    assert s.osm_write_server == ""
    assert [r.getMessage() for r in caplog.records] == [f"osm writing off: {why}"]
    for value in ("fake-secret", "fake-id", KEY, "master", "osm.example"):
        assert value not in caplog.text


def test_the_live_server_is_read_for_the_switch_and_the_old_approval_ignored(env, caplog):
    """OSM_WRITE_LIVE_APPROVED is no longer read (said once): the live client is read in
    any case, for /revue's osm_write_live; the deploy's write server stays the test one."""
    env.setenv("OSM_WRITE_LIVE_APPROVED", "yes")
    s = settings(caplog)
    assert (s.osm_write_server, s.osm_write_url) == ("dev", osm.DEV_URL)
    assert (s.osm_live_write_url, s.osm_live_write_client_id) == (osm.LIVE_URL, "fake-id")
    assert [r.getMessage() for r in caplog.records] == [
        "OSM_WRITE_LIVE_APPROVED ignored: the live server is /revue's switch"]  # fmt: skip
    env.setenv("OSM_LIVE_URL", "http://osm.example")  # not https: no live server
    assert settings().osm_live_write_url == ""


def test_a_sealed_token_opens_with_its_key_account_and_server_only():
    key = publish.token_key(KEY)
    sealed = publish.seal(key, ACCOUNT, "dev", "the-token")
    assert len(sealed) == 12 + len("the-token") + 16 and b"the-token" not in sealed
    assert publish.unseal(key, ACCOUNT, "dev", sealed) == "the-token"
    assert publish.seal(key, ACCOUNT, "dev", "the-token") != sealed  # a fresh nonce each time
    other = os.urandom(32)
    for args in ((other, ACCOUNT, "dev"), (key, ACCOUNT.replace("1", "2"), "dev"),
                 (key, ACCOUNT, "live")):  # fmt: skip
        with pytest.raises(InvalidTag):
            publish.unseal(*args, sealed)
    tampered = sealed[:-1] + bytes([sealed[-1] ^ 1])
    with pytest.raises(InvalidTag):
        publish.unseal(key, ACCOUNT, "dev", tampered)


@pytest.mark.parametrize("raw", ["", "   ", "AAAA", "not base64", KEY[:-4]])
def test_a_key_is_base64_of_exactly_32_bytes(raw):
    assert publish.token_key(raw) is None
    assert publish.token_key(KEY + "\n") == bytes(range(32))


@pytest.mark.parametrize(("key", "current", "value", "result"), [
    ("camera:type", None, "dome", "send"),
    ("camera:type", "dome", "dome", "same"),
    ("camera:type", "fixed", "dome", "conflict"),
    ("check_date", None, "2026-10-09", "send"),
    ("check_date", "2024-05-01", "2026-10-09", "send"),
    ("check_date", "2026-10-09", "2026-10-09", "same"),
    ("check_date", "2026-10-10", "2026-10-09", "same"),
    ("check_date", "2025", "2026-10-09", "send"),
    ("check_date", "2026-10", "2026-10-09", "same"),
    ("check_date", "2026-09", "2026-10-09", "send"),
    ("check_date", "last summer", "2026-10-09", "conflict"),
    ("check_date", "09/10/2026", "2026-10-09", "conflict"),
])  # fmt: skip
def test_never_overwrite_but_an_older_check_date(key, current, value, result):
    assert publish.outcome(key, current, value) == result


def test_the_default_comment_counts_by_kind_in_the_rule_s_order():
    assert publish.default_comment(["verify", "add", "direction", "direction"]) == (
        "Caméras de surveillance relevées sur place : 1 ajout, 2 directions, 1 vérification"
    )
    assert publish.default_comment(["shape", "shape", "operator"]) == (
        "Caméras de surveillance relevées sur place : 2 formes, 1 exploitant"
    )
    assert publish.default_comment([]) is None


def test_the_rules_have_an_id_and_a_rationale_each():
    rules = publish.rules()
    for name, rule in rules.items():
        if name != "version":
            assert rule["id"].startswith(f"rule:publish@{rules['version']}:"), name
            assert len(rule["rationale"]) > 40, name
    assert rules["add_tags"]["tags"]["surveillance"] == "outdoor"
    assert set(rules["answers"]["operator"]) == {"public", "business"}  # never household
    # Version 2 (lot of 2026-10-12): no height answer leaves, « sur un poteau » is gone.
    assert rules["answers"]["height"] == {} and "height" not in publish.KINDS
    # Version 3 (the synchronisation): never mechanical=yes, the job's pace has its rule.
    assert "mechanical" not in rules["changeset"]["tags"]
    assert rules["sync"]["every_minutes"] == 15 and rules["sync"]["max_changesets_per_day"] == 4


def test_the_comment_says_what_it_holds_with_the_hashtag_and_the_page_in_255():
    """The longest comment a pass can write (every kind, max_cameras of each) holds in the
    API's 255 characters, the hashtag and the page included."""
    n = publish.rules()["max_cameras"]["value"]
    longest = publish.changeset_comment([k for k in publish.KINDS for _ in range(n)])
    assert len(longest) <= 255 and longest.endswith(
        "#SurveillanceWorld https://wiki.openstreetmap.org/wiki/"
        "Organised_Editing/Activities/Surveillance_World")  # fmt: skip
    assert publish.changeset_comment(["add", "direction"]) == (
        "Caméras de surveillance relevées sur place : 1 ajout, 1 direction #SurveillanceWorld"
        " https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Surveillance_World"
    )


@pytest.mark.parametrize(("tags", "camera"), [
    ({"man_made": "surveillance"}, True),
    ({"man_made": "surveillance", "surveillance:type": "camera"}, True),
    ({"man_made": "surveillance", "surveillance:type": "ALPR"}, True),
    ({"man_made": "surveillance", "surveillance:type": "guard"}, False),
    ({"man_made": "surveillance", "surveillance:type": "guard;camera"}, True),
    ({"surveillance:type": "camera"}, False),
    ({"highway": "street_lamp"}, False),
])  # fmt: skip
def test_an_osm_camera_near_an_add_is_counted_as_the_build_counts_one(tags, camera):
    not_cameras = set(publish.rules()["duplicate"]["not_cameras"])
    assert publish.is_camera(tags, not_cameras) is camera


def test_metres_between_two_points_a_few_metres_apart():
    assert publish.metres_between(2.24, 48.892, 2.24, 48.892 + 5 / 111_195) == pytest.approx(
        5, 0.01
    )
    east = 5 / (111_195 * 0.6578)  # cos(48.892°)
    assert publish.metres_between(2.24, 48.892, 2.24 + east, 48.892) == pytest.approx(5, 0.01)
