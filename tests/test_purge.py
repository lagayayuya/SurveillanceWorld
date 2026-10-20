"""db/purge_test_accounts.sh on fictitious data, in a copy of a database in service (as the
restored copy it runs on, db/restore.sh): the test accounts — flagged or named in
TEST_AUTHORS, less those kept — and what they wrote listed with every count, and deleted
only with --delete, with what is about their contributions; nothing else."""

import os
import subprocess

import pytest
from test_db import other_database, sql

from lacarte import db, regions

PURGE = regions.ROOT / "db" / "purge_test_accounts.sh"
U = "00000000-0000-4000-8000-0000000018{:02d}"
COLS = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author_id, day,"
        " geom, payload, body_sha256, osm_tags, answer, status, target")  # fmt: skip


def account(name, *, test=False, role="contributor") -> str:
    return ("INSERT INTO accounts (pseudonym, password_hash, role, created_month, test)"
            f" VALUES ('{name}', 'x', '{role}', '2026-10-01', {test});")  # fmt: skip


def contribution(i, author, kind="verify", answer="'present'", target=None, camera="n1",
                 status="pending"):  # fmt: skip
    osm = ("NULL", "NULL", "NULL") if camera.startswith("c") else ("'n'", camera[1:], "1")
    t = f"'{U.format(target)}'" if target is not None else "NULL"
    return (f"INSERT INTO contributions ({COLS}) VALUES ('{U.format(i)}', '{kind}', '{camera}',"
            f" {osm[0]}, {osm[1]}, {osm[2]}, 'b',"
            f" (SELECT id FROM accounts WHERE pseudonym = '{author}'), '2026-10-01',"
            " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', "
            f"{answer}, '{status}', {t});")  # fmt: skip


@pytest.fixture(scope="module")
def in_service(pg_dsn, pg_loaded):
    return database_in_service(pg_dsn)


def database_in_service(pg_dsn) -> str:
    """A migrated database `in_service` with: ivo (a test account) and its verify, its add
    with an answer by ana on it and an opinion by ana on its verify; ana's own verify,
    decided by tess (a test reviewer); joe (a reviewer, flagged test by mistake); a session,
    a publishing choice, a publication, a hidden camera; and a meta row."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS in_service")
    sql(pg_dsn, "CREATE DATABASE in_service")
    dsn = other_database(pg_dsn, "in_service")
    db.migrate(dsn)
    sql(dsn, account("ivo", test=True) + account("ana") + account("joe", test=True, role="reviewer")
        + account("tess", test=True, role="reviewer"))  # fmt: skip
    add = "c" + U.format(3).replace("-", "")[:12]
    sql(dsn, contribution(1, "ivo") + contribution(2, "ana")
        + contribution(3, "ivo", kind="add", answer="NULL", camera=add)
        + contribution(4, "ana", kind="shape", answer="'dome'", target=3, camera=add)
        + contribution(5, "ana", kind="agree", answer="NULL", target=1)
        + contribution(6, "joe"))  # fmt: skip
    sql(dsn, "UPDATE contributions SET status = 'validated', decided_on = '2026-10-02',"
             f" decided_by_id = (SELECT id FROM accounts WHERE pseudonym = 'tess')"
             f" WHERE uuid = '{U.format(2)}'")  # fmt: skip
    sql(dsn, "INSERT INTO sessions SELECT sha256('t'), id, '2026-11-01' FROM accounts"
             " WHERE pseudonym = 'ana';"
             " INSERT INTO osm_write SELECT id, 'dev', 7, '\\x00', '2026-10-01' FROM accounts"
             " WHERE pseudonym = 'joe';"
             f" INSERT INTO osm_publications VALUES ('{U.format(6)}', 'dev', 'published', NULL,"
             " 9, '2026-10-01');"
             " INSERT INTO hidden_cameras VALUES ('n42', '2026-10-03');"
             " INSERT INTO meta VALUES (true, 'b', 'ci',"
             " ST_MakeEnvelope(0, 0, 1, 1, 4326))")  # fmt: skip
    return dsn


@pytest.fixture
def restored(pg_dsn, in_service):
    """A copy of the database in service."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS purged")
    sql(pg_dsn, "CREATE DATABASE purged TEMPLATE in_service")
    return other_database(pg_dsn, "purged")


def counts(dsn) -> dict[str, int]:
    tables = ("accounts", "contributions", "sessions", "osm_write", "osm_publications",
              "hidden_cameras")  # fmt: skip
    return {t: int(sql(dsn, f"SELECT count(*) FROM {t}")[0][0]) for t in tables}


def purge(dsn, *args, names="ivo"):
    out = subprocess.run([str(PURGE), *args, dsn], capture_output=True, text=True,
                         env={**os.environ, "TEST_AUTHORS": names})  # fmt: skip
    assert out.returncode == 0, out.stderr
    return out.stdout


def test_the_listing_says_everything_and_deletes_nothing(restored):
    before = counts(restored)
    out = purge(restored, "--keep", "joe")
    assert "test accounts: 2 (flagged test or named in TEST_AUTHORS; kept: joe)" in out
    assert "account tess flagged not-named reviewer claimed 0 contributions 1 decisions" in out
    assert "account ivo flagged named contributor claimed 2 contributions" in out
    assert "their contributions: 2" in out
    assert "contributions of other accounts about them, deleted with them: 2" in out
    assert "staying: 2 accounts, 2 contributions" in out
    assert "kept by --keep though flagged or named: joe" in out
    assert "listed only: nothing deleted" in out
    assert counts(restored) == before


def test_delete_takes_them_and_what_is_about_them_only(restored):
    purge(restored, "--keep", "joe", "--delete")
    assert sql(restored, "SELECT pseudonym FROM accounts ORDER BY 1") == [["ana"], ["joe"]]
    left = sql(restored, "SELECT right(uuid::text, 2), decided_by_id IS NULL, status"
                         " FROM contributions ORDER BY 1")  # fmt: skip
    # ana's own verify stays, decided, its decider gone; joe's stays with its publication.
    assert left == [["02", "t", "validated"], ["06", "t", "pending"]]
    assert counts(restored)["osm_publications"] == 1 and counts(restored)["osm_write"] == 1
    assert counts(restored)["hidden_cameras"] == 1


def test_without_keep_a_flagged_account_goes_too(restored):
    out = purge(restored, names="")
    assert "test accounts: 3" in out and "account joe flagged not-named reviewer" in out


@pytest.mark.parametrize("names", ["ivo;DROP", "a"])
def test_names_are_pseudonyms(restored, names):
    out = subprocess.run([str(PURGE), restored], capture_output=True, text=True,
                         env={**os.environ, "TEST_AUTHORS": names})  # fmt: skip
    assert out.returncode == 1 and "pseudonyms" in out.stderr
