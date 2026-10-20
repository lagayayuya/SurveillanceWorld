"""Phase "Retours terrain": db/reset_contributions.sh removes every contribution of the
preview's database after dumping them; --dry-run changes nothing; refused anywhere but
the preview (STAGE) or for another region than the database's."""

import os
import subprocess

import pytest
from test_add import COLS
from test_db import acct, ensure, other_database, sql

from lacarte import db, regions

SCRIPT = regions.ROOT / "db" / "reset_contributions.sh"


@pytest.fixture
def full(pg_dsn, pg_loaded):
    sql(pg_dsn, "DROP DATABASE IF EXISTS reset_test")
    sql(pg_dsn, "CREATE DATABASE reset_test")
    other = other_database(pg_dsn, "reset_test")
    db.migrate(other)
    ensure(other, "ivo")
    sql(other, "INSERT INTO meta VALUES (true, 'b', 'ci', ST_MakeEnvelope(0, 0, 1, 1, 4326))")
    for i, (kind, status) in enumerate((("move", "pending"), ("verify", "applied"),
                                        ("verify", "withdrawn"))):  # fmt: skip
        answer = "'present'" if kind == "verify" else "NULL"
        sql(other, f"INSERT INTO contributions ({COLS}) VALUES"
                   f" ('00000000-0000-4000-8000-00000000003{i}', '{kind}', 'n1', 'n', 1, 1, 'b',"
                   f" {acct('ivo')}, '2026-10-01', ST_SetSRID(ST_MakePoint(0, 0), 2154),"
                   f" '{{}}', 'x', '{{}}', NULL, {answer}, '{status}')")  # fmt: skip
    sql(other, "UPDATE accounts SET test = true WHERE pseudonym = 'ivo'")
    return other


def run(dsn, *args, stage="preview"):
    env = {**os.environ, "STAGE": stage}
    return subprocess.run([SCRIPT, *args, dsn], capture_output=True, text=True, env=env)


def count(dsn):
    return int(sql(dsn, "SELECT count(*) FROM contributions")[0][0])


def test_dry_run_lists_and_changes_nothing(full):
    r = run(full, "--dry-run", "ci")
    assert r.returncode == 0, r.stderr
    assert "applied\tverify\t1" in r.stdout and "total: 3" in r.stdout
    assert "nothing deleted" in r.stdout and count(full) == 3


def test_refused_outside_the_preview_or_for_another_region(full, tmp_path):
    for args, stage, why in (
        (("--dry-run", "ci"), "", "not preview"),
        (("--dry-run", "ci"), "public", "not preview"),
        (("--dry-run", "idf"), "preview", "the database holds 'ci'"),
        (("ci",), "preview", "needs --backup"),
    ):
        r = run(full, *args, stage=stage)
        assert r.returncode == 1 and why in r.stderr, (args, stage, r.stderr)
    assert count(full) == 3


def test_a_real_run_dumps_then_deletes_everything(full, tmp_path):
    backup = tmp_path / "contributions.dump"
    r = run(full, "--backup", str(backup), "ci")
    assert r.returncode == 0, r.stderr
    assert count(full) == 0 and "deleted: 3; left: 0" in r.stdout
    listed = subprocess.run(["pg_restore", "--list", str(backup)], capture_output=True,
                            text=True, check=True).stdout  # fmt: skip
    assert "TABLE DATA public contributions" in listed
    assert sql(full, "SELECT pseudonym FROM accounts WHERE test") == [["ivo"]]  # kept
