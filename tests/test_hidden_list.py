"""The hidden cameras' list on the database side (migration 018): the CLI (python -m
lacarte.api.hidden, lacarte hidden) adds, removes and lists; `lacarte contrib export`
writes it beside the contributions for the build; the API leaves those cameras out of the
proposals it shows and never serves the list. Fictitious data in the throwaway database."""

import json
import subprocess
import sys
import uuid

import psycopg
import pytest
import sessions
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from lacarte import cli, contrib, regions
from lacarte.api import app as api
from lacarte.api import hidden


@pytest.fixture
def dsn(pg_loaded, pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM hidden_cameras")
    yield pg_dsn
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM hidden_cameras")


def run(dsn, *argv):
    return hidden.main(["--dsn", dsn, *argv])


def listed(dsn) -> list[tuple[str, str]]:
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT camera_id, added_on::text FROM hidden_cameras"
                            " ORDER BY 1").fetchall()  # fmt: skip


def a_camera(dsn) -> str:
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT camera_id FROM cameras WHERE osm_type = 'n'"
                            " ORDER BY camera_id LIMIT 1").fetchone()[0]  # fmt: skip


# --- the CLI -------------------------------------------------------------------------------


def test_add_list_remove(dsn, capsys):
    cam = a_camera(dsn)
    assert run(dsn, "add", cam) == 0
    assert f"{cam} hidden (in the served build)" in capsys.readouterr().out
    run(dsn, "add", cam)
    assert f"{cam} already hidden" in capsys.readouterr().out
    run(dsn, "add", "c0123456789ab")
    assert "unknown to the served build" in capsys.readouterr().out  # a typo shows
    assert [r[0] for r in listed(dsn)] == ["c0123456789ab", cam]
    run(dsn, "list")
    out = capsys.readouterr().out
    assert cam in out and "2 hidden camera(s)" in out
    run(dsn, "remove", cam)
    assert f"{cam} no longer hidden" in capsys.readouterr().out
    with pytest.raises(SystemExit, match="is not hidden"):
        run(dsn, "remove", cam)
    assert [r[0] for r in listed(dsn)] == ["c0123456789ab"]


@pytest.mark.parametrize("bad", ["n0", "camera", "n12;DROP", "c123", "https://osm.org/node/1"])
def test_anything_but_a_camera_id_is_refused(dsn, bad):
    with pytest.raises(SystemExit, match="refused: a camera id"):
        run(dsn, "add", bad)
    assert listed(dsn) == []


def test_the_table_keeps_the_id_and_the_day_only(dsn):
    with psycopg.connect(dsn) as conn:
        cols = conn.execute(
            "SELECT column_name FROM information_schema.columns"
            " WHERE table_name = 'hidden_cameras' ORDER BY ordinal_position"
        )
        # 020: the build that left it out (a build id, set by the deploy's settle).
        assert [c for (c,) in cols] == ["camera_id", "added_on", "applied_build"]
    with pytest.raises(psycopg.errors.CheckViolation), psycopg.connect(dsn) as conn:
        conn.execute("INSERT INTO hidden_cameras VALUES ('not an id')")


def test_lacarte_hidden_runs_the_same_commands(dsn, capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["hidden", "--dsn", dsn, "list"])
    assert e.value.code == 0 and "0 hidden camera(s)" in capsys.readouterr().out


def test_the_module_runs_with_the_api_s_dependencies_only():
    """On the server it runs from the API's venv: no geopandas, no osmium (as the accounts
    CLI)."""
    blocker = ("import sys\n"
               "for m in ('geopandas', 'osmium', 'pyarrow', 'h3'): sys.modules[m] = None\n"
               "import lacarte.api.hidden as h\n"
               "h.parser('x').parse_args(['list'])\n")  # fmt: skip
    r = subprocess.run([sys.executable, "-c", blocker], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


# --- the export for the build ------------------------------------------------------------


def test_the_export_writes_the_list_beside_the_contributions(dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    region = regions.load("ci")
    region.hidden_file.write_text("n999\n")  # an earlier list
    info = contrib.export(dsn)
    assert info["hidden"] == 0 and region.hidden_file.read_text() == ""  # emptied, not left
    cam = a_camera(dsn)
    run(dsn, "add", cam)
    run(dsn, "add", "c0123456789ab")
    info = contrib.export(dsn)
    assert info["hidden"] == 2
    assert region.hidden_file.read_text() == f"c0123456789ab\n{cam}\n"
    assert regions.hidden(region) == {cam, "c0123456789ab"}
    assert "added_on" not in region.hidden_file.read_text()


def test_the_export_reads_a_database_before_018(pg_dsn, pg_loaded, tmp_path, monkeypatch):
    """A deploy exports before it migrates: no table, no camera hidden."""
    from test_db import other_database, sql

    from lacarte import db

    sql(pg_dsn, "DROP DATABASE IF EXISTS before_018")
    sql(pg_dsn, "CREATE DATABASE before_018")
    other = other_database(pg_dsn, "before_018")
    db.migrate(other)
    sql(other, "DROP TABLE hidden_cameras")
    sql(other, "INSERT INTO meta VALUES (true, 'b', 'ci', ST_MakeEnvelope(0, 0, 1, 1, 4326))")
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    assert contrib.export(other)["hidden"] == 0
    assert regions.load("ci").hidden_file.read_text() == ""


# --- the API -------------------------------------------------------------------------------


@pytest.fixture
def client(dsn):
    sessions.configure(dsn)
    with TestClient(api.app) as c:
        yield c


def test_no_route_serves_the_list_but_the_administrators():
    """Lot 2: « Retraits » reads and changes it (test_review_hidden.py); nothing else."""
    paths = [r.path for r in api.app.routes if isinstance(r, APIRoute)]
    assert paths and {p for p in paths if "hidden" in p} == {"/api/review/hidden"}


def test_the_proposals_leave_a_hidden_camera_out(client, dsn):
    cam = a_camera(dsn)
    uid = str(uuid.uuid4())
    with psycopg.connect(dsn, autocommit=True) as conn:
        x, y, build = conn.execute(
            "SELECT ST_X(geom), ST_Y(geom), (SELECT build_id FROM meta) FROM cameras"
            " WHERE camera_id = %s",
            (cam,),
        ).fetchone()
        conn.execute(
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
            " build_id, author_id, day, geom, payload, body_sha256, osm_tags,"
            " answer) VALUES (%s, 'verify', %s, 'n', %s, 1, %s, %s, current_date,"
            " ST_SetSRID(ST_MakePoint(%s, %s), 2154), '{}', 'x', '{}', 'not_found')",
            (uid, cam, int(cam[1:]), build, sessions.account_id("ana"), x, y),
        )  # fmt: skip
    try:

        def shown():
            by_camera = client.get("/api/proposals", params={"camera": cam}).json()
            lon, lat = (
                by_camera["features"][0]["geometry"]["coordinates"]
                if by_camera["features"]
                else (2.24, 48.89)
            )
            box = f"{lon - 0.01},{lat - 0.01},{lon + 0.01},{lat + 0.01}"
            in_view = client.get("/api/proposals", params={"bbox": box}).json()
            return (bool(by_camera["features"]),
                    cam in json.dumps(in_view))  # fmt: skip

        assert shown() == (True, True)
        run(dsn, "add", cam)
        assert shown() == (False, False)
        run(dsn, "remove", cam)
        assert shown() == (True, True)
    finally:
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute("DELETE FROM contributions WHERE uuid = %s", (uid,))
