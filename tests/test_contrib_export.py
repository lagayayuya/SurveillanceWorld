"""`lacarte contrib export` against a local PostGIS (db/export_contributions.sql): what
leaves the database is only what the build reads — no author, no day, no time — and the
rank orders a camera's contributions by the day of observation, not by the decision."""

import json
import uuid as uuidlib

import psycopg
import pytest
import sessions

from lacarte import apply, contrib, regions

AUTHOR = "auteur-a-ne-pas-exporter"


def _insert(conn, camera, kind, status, day, *, answer=None, decided_on=None, x=0.0, y=0.0,
            payload=None):  # fmt: skip
    uid = str(uuidlib.uuid4())
    conn.execute(
        "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
        " osm_timestamp, build_id, author_id, day, on_site, status, answer, geom,"
        " payload, body_sha256, decided_by_id, decided_on, osm_tags) VALUES (%s, %s, %s, 'n', %s,"
        " 7, '2026-01-02T03:04:05Z', 'ci-x', %s, %s, true, %s, %s,"
        " ST_SetSRID(ST_MakePoint(%s, %s), 2154), %s, 'x', %s, %s, '{}')",
        (uid, kind, camera, int(camera[1:]), sessions.account_id(AUTHOR, conn=conn), day,
         status, answer, x, y, json.dumps(payload or {}),
         sessions.account_id("joe", conn=conn) if decided_on else None, decided_on),
    )  # fmt: skip
    return uid


@pytest.fixture
def exported(pg_loaded, pg_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    cam = "n990000000001"
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        ids = {
            # Observed on the 20th, decided first; observed on the 10th, decided later.
            "late_obs": _insert(conn, cam, "move", "validated", "2026-09-20",
                                decided_on="2026-09-21", x=644000.123456789, y=6866000.987654321,
                                payload={"placement": "facade", "position": [2.1, 48.8]}),
            "early_obs": _insert(conn, cam, "move", "validated", "2026-09-10",
                                 decided_on="2026-09-30", x=644001.5, y=6866001.25,
                                 payload={"placement": "free"}),
            "present": _insert(conn, cam, "verify", "validated", "2026-10-01",
                               answer="present", decided_on="2026-10-02"),
            "rejected": _insert(conn, cam, "verify", "rejected", "2026-09-15",
                                answer="not_found", decided_on="2026-09-16"),
            "pending": _insert(conn, cam, "move", "pending", "2026-09-15"),
            "unsure": _insert(conn, cam, "verify", "validated", "2026-09-15", answer="unsure",
                              decided_on="2026-09-16"),
        }  # fmt: skip
    info = contrib.export(dsn=pg_dsn)
    text = (tmp_path / "ci.jsonl").read_text()
    rows = {r["uuid"]: r for r in map(json.loads, text.splitlines())}
    yield info, text, {k: rows.get(v) for k, v in ids.items()}
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM contributions WHERE camera_id = %s", (cam,))


def test_only_accepted_moves_and_answers_are_exported(exported):
    info, _, rows = exported
    assert info["region"] == "ci" and info["file"] == "ci.jsonl"
    assert rows["rejected"] is None and rows["pending"] is None and rows["unsure"] is None
    assert rows["late_obs"] and rows["early_obs"] and rows["present"]


def test_no_author_no_day_no_time_leave_the_database(exported):
    _, text, rows = exported
    assert AUTHOR not in text and "2026-09-2" not in text and "2026-10-0" not in text
    assert "T03:04" not in text  # osm_timestamp
    for r in rows.values():
        if r is not None:
            assert set(r) <= apply.KEYS
    assert rows["late_obs"]["month"] == "2026-09" and rows["present"]["month"] == "2026-10"


def test_rank_follows_the_day_of_observation_not_the_decision(exported):
    _, _, rows = exported
    assert (rows["early_obs"]["rank"], rows["late_obs"]["rank"], rows["present"]["rank"]) == (
        1, 2, 3)  # fmt: skip


def test_a_move_carries_its_exact_position_and_placement(exported):
    _, _, rows = exported
    r = rows["late_obs"]
    assert (r["x"], r["y"], r["placement"]) == (644000.123456789, 6866000.987654321, "facade")
    assert rows["early_obs"]["placement"] == "free"
    assert "x" not in rows["present"] and "answer" not in rows["late_obs"]


def test_the_file_reads_back_as_the_build_reads_it(exported, tmp_path):
    _, text, rows = exported
    path = tmp_path / "ci.jsonl"
    back = {c.uuid: c for c in apply.read(path)}
    c = back[rows["late_obs"]["uuid"]]
    assert (c.kind, c.x, c.osm_version, c.rank, c.month) == ("move", 644000.123456789, 7, 2,
                                                              "2026-09")  # fmt: skip


def test_on_the_same_day_the_review_s_decision_order_ranks(pg_loaded, pg_dsn, tmp_path,
                                                           monkeypatch):  # fmt: skip
    """Migration 005: the trigger numbers decisions; a revalidated conflict is held against
    the version the deploy found (apply_detail.osm_version)."""
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    cam = "n990000000002"
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        first = _insert(conn, cam, "move", "pending", "2026-09-20", x=1.0, y=1.0)
        second = _insert(conn, cam, "move", "pending", "2026-09-20", x=2.0, y=2.0)
        for uid in (second, first):  # the review decides `second` first
            conn.execute("UPDATE contributions SET status = 'validated', decided_by_id = %s,"
                         " decided_on = '2026-09-30' WHERE uuid = %s",
                         (sessions.account_id("joe", conn=conn), uid))  # fmt: skip
        conn.execute("UPDATE contributions SET apply_detail = '{\"osm_version\": 9}'"
                     " WHERE uuid = %s", (first,))  # fmt: skip
    try:
        contrib.export(dsn=pg_dsn)
        rows = {r["uuid"]: r for r in map(json.loads, (tmp_path / "ci.jsonl").read_text()
                                          .splitlines())}  # fmt: skip
        assert (rows[second]["rank"], rows[first]["rank"]) == (1, 2)
        assert (rows[second]["osm_version"], rows[first]["osm_version"]) == (7, 9)
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM contributions WHERE camera_id = %s", (cam,))


def test_check_fresh_refuses_an_export_older_than_the_database(pg_loaded, pg_dsn, tmp_path,
                                                                monkeypatch):  # fmt: skip
    # A build from an export taken before the last review decision would drop the
    # contribution from the map: the deploy's check names the stale file.
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    ci = regions.load("ci")
    cam = "n990000000002"
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        _insert(conn, cam, "verify", "validated", "2026-10-01", answer="present",
                decided_on="2026-10-02")  # fmt: skip
    try:
        contrib.export(dsn=pg_dsn)
        assert contrib.check_fresh(ci, dsn=pg_dsn) == []
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            _insert(conn, cam, "verify", "validated", "2026-10-03", answer="present",
                    decided_on="2026-10-04")  # fmt: skip
        assert contrib.check_fresh(ci, dsn=pg_dsn) == ["ci.jsonl"]
        contrib.export(dsn=pg_dsn)
        assert contrib.check_fresh(ci, dsn=pg_dsn) == []
        ci.contrib_file.unlink()
        assert contrib.check_fresh(ci, dsn=pg_dsn) == ["ci.jsonl"]
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM contributions WHERE camera_id = %s", (cam,))
