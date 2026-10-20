"""Phase "Retours terrain": test accounts (TEST_AUTHORS). Their contributions stay in the
database and show as proposals, are marked "test" in /revue and left out of its
statistics, and never leave it: the export skips them (and what was said of a test
account's add), and the deploy refuses a file or a build holding one (contrib.check_test).
Since migration 014 the database flags them (accounts.test, db/test_authors.sh); the export
and the check read the flag and the names, and still read a database before 014.
"""

import csv
import io
import json
import subprocess
import uuid

import psycopg
import pytest
import sessions
import test_api_app
from fastapi.testclient import TestClient
from test_add import COLS
from test_api_app import TODAY, headers
from test_db import acct, ensure_sql, other_database, sql

from lacarte import contrib, db, participation, regions
from lacarte.api import app as api

near_wall = test_api_app.near_wall  # a camera near a facade, a fixture
SCRIPT = regions.ROOT / "db" / "test_authors.sh"


@pytest.fixture(scope="module")
def plain(pg_dsn, pg_loaded):
    """A migrated database of its own, with a meta row (the export reads its region)."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS test_accounts")
    sql(pg_dsn, "CREATE DATABASE test_accounts")
    other = other_database(pg_dsn, "test_accounts")
    db.migrate(other)
    sql(other, "INSERT INTO meta VALUES (true, 'b', 'ci', ST_MakeEnvelope(0, 0, 1, 1, 4326))")
    return other


def _insert(dsn, author, kind, camera, target=None, answer=None):
    uid = str(uuid.uuid4())
    added = participation.ADDED_ID.fullmatch(camera)
    osm = ("NULL", "NULL", "NULL") if added else ("'n'", camera[1:], "1")
    t = f"'{target}'" if target else "NULL"
    a = f"'{answer}'" if answer else "NULL"
    sql(dsn, ensure_sql(author) + f"INSERT INTO contributions ({COLS}) VALUES ('{uid}',"
             f" '{kind}', '{camera}', {osm[0]}, {osm[1]}, {osm[2]}, 'b', {acct(author)},"
             " '2026-10-01',"
             f" ST_SetSRID(ST_MakePoint(644000, 6866000), 2154), '{{}}', 'x', '{{}}', {t}, {a},"
             f" 'validated')")  # fmt: skip
    return uid


def _export(dsn) -> dict[str, dict]:
    return {r["uuid"]: r for r in contrib.parse(contrib._psql_lines(dsn, None))[1]}


def test_the_export_skips_test_accounts_and_what_was_said_of_their_adds(plain, monkeypatch):
    real = _insert(plain, "joe", "verify", "n1", answer="present")
    test = _insert(plain, "ivo", "verify", "n2", answer="present")
    test_add = str(uuid.UUID(int=uuid.uuid4().int, version=4))
    sql(plain, f"INSERT INTO contributions ({COLS}) VALUES ('{test_add}', 'add',"
               f" '{participation.added_id(test_add)}', NULL, NULL, NULL, 'b', {acct('ivo')},"
               f" '2026-10-01', ST_SetSRID(ST_MakePoint(644000, 6866000), 2154), '{{}}', 'x',"
               f" '{{}}', NULL, NULL, 'validated')")  # fmt: skip
    on_test_add = _insert(plain, "joe", "shape", participation.added_id(test_add), test_add, "dome")
    monkeypatch.setenv("TEST_AUTHORS", "")
    assert set(_export(plain)) == {real, test, test_add, on_test_add}
    monkeypatch.setenv("TEST_AUTHORS", "IVO, zz")  # a pseudonym has no case
    assert set(_export(plain)) == {real}
    # Flagged by the last deploy (db/test_authors.sh), not listed any more: still a test.
    subprocess.run([SCRIPT, "ivo", plain], check=True, capture_output=True)
    monkeypatch.setenv("TEST_AUTHORS", "")
    assert set(_export(plain)) == {real}
    subprocess.run([SCRIPT, "", plain], check=True, capture_output=True)


def test_the_deploy_refuses_a_file_or_a_build_holding_a_test_account(plain, monkeypatch, tmp_path):
    sql(plain, "TRUNCATE contributions CASCADE")
    real = _insert(plain, "joe", "verify", "n1", answer="present")
    test = _insert(plain, "ivo", "verify", "n2", answer="present")
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    region = regions.load("ci")
    monkeypatch.setenv("TEST_AUTHORS", "ivo")
    assert contrib.check_test(region, dsn=plain) == 0  # no file
    region.contrib_file.write_text(json.dumps({"uuid": real}) + "\n")
    assert contrib.check_test(region, dsn=plain) == 0
    region.contrib_file.write_text(json.dumps({"uuid": real}) + "\n" + json.dumps({"uuid": test}))
    assert contrib.check_test(region, dsn=plain) == 1
    monkeypatch.setenv("TEST_AUTHORS", "")
    assert contrib.check_test(region, dsn=plain) == 0
    monkeypatch.setenv("TEST_AUTHORS", "ivo'; --")
    with pytest.raises(SystemExit):
        contrib.check_test(region, dsn=plain)


def test_the_script_sets_the_test_flags(plain):
    """Listed accounts are test accounts, the others not; a listed name no account has yet
    becomes a placeholder (no password), which `accounts create` claims with its flag."""

    def accounts():
        q = 'SELECT pseudonym FROM accounts WHERE test ORDER BY pseudonym COLLATE "C"'
        return [r[0] for r in sql(plain, q)]

    subprocess.run([SCRIPT, "ivo, Zz", plain], check=True, capture_output=True)
    assert accounts() == ["Zz", "ivo"]
    assert sql(plain, "SELECT password_hash IS NULL FROM accounts WHERE pseudonym = 'Zz'") == [
        ["t"]]  # fmt: skip
    subprocess.run([SCRIPT, "zz", plain], check=True, capture_output=True)  # any case
    assert accounts() == ["Zz"]
    assert sql(plain, "SELECT count(*) FROM accounts WHERE lower(pseudonym) = 'zz'") == [["1"]]
    for bad in ("ivo;drop", "y", "a" * 33):
        r = subprocess.run([SCRIPT, bad, plain], capture_output=True, text=True)
        assert r.returncode == 1 and accounts() == ["Zz"], bad
    subprocess.run([SCRIPT, "", plain], check=True, capture_output=True)
    assert accounts() == []


def test_the_export_and_the_check_read_a_database_before_014(pg_dsn, pg_loaded, monkeypatch,
                                                             tmp_path):  # fmt: skip
    """The first deploy with accounts exports (and checks) before it migrates: the names."""
    sql(pg_dsn, "DROP DATABASE IF EXISTS at_013")
    sql(pg_dsn, "CREATE DATABASE at_013")
    old = other_database(pg_dsn, "at_013")
    sql(old, "CREATE TABLE schema_migrations (version text PRIMARY KEY)")
    for f in sorted(db.MIGRATIONS.glob("0*.sql")):
        if f.stem >= "014":
            break
        subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", old, "-1", "-f", str(f)],
                       check=True, capture_output=True)  # fmt: skip
    sql(old, "INSERT INTO meta VALUES (true, 'b', 'ci', ST_MakeEnvelope(0, 0, 1, 1, 4326))")
    uids = {}
    for who, cam in (("joe", "n1"), ("ivo", "n2")):
        uids[who] = str(uuid.uuid4())
        # Before 014 (and 021): the author's name, and the gesture's duration.
        cols = COLS.replace("author_id", "author").replace(" day,", " day, duration_ms,")
        sql(old, f"INSERT INTO contributions ({cols}) VALUES"
                 f" ('{uids[who]}', 'verify', '{cam}', 'n', {cam[1:]}, 1, 'b', '{who}',"
                 " '2026-10-01', 0, ST_SetSRID(ST_MakePoint(644000, 6866000), 2154), '{}',"
                 " 'x', '{}', NULL, 'present', 'validated')")  # fmt: skip
    monkeypatch.setenv("TEST_AUTHORS", "ivo")
    assert set(_export(old)) == {uids["joe"]}
    monkeypatch.setattr(regions, "CONTRIB_ROOT", tmp_path)
    region = regions.load("ci")
    region.contrib_file.write_text("".join(json.dumps({"uuid": u}) + "\n" for u in uids.values()))
    assert contrib.check_test(region, dsn=old) == 1


@pytest.fixture(scope="module")
def client(pg_loaded, pg_dsn):
    sessions.configure(pg_dsn)
    with TestClient(api.app) as c:
        yield c


def test_review_marks_them_test_and_leaves_them_out_of_the_summary(client, pg_dsn, near_wall):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
        build_id = conn.execute("SELECT build_id FROM meta").fetchone()[0]
    subprocess.run([SCRIPT, "ivo", pg_dsn], check=True, capture_output=True)
    cam, _ = near_wall
    for who in ("ivo", "joe"):
        body = {"kind": "verify", "camera": cam.camera_id, "build_id": build_id, "day": TODAY,
                "duration_ms": 900, "on_site": None, "answer": "present",
                "uuid": str(uuid.uuid4())}  # fmt: skip
        assert client.post("/api/contributions", json=body, headers=headers(who)).status_code == 200
    rows = client.get("/api/review/contributions", headers=headers("rev")).json()
    assert sorted((r["author"], r["test"]) for r in rows["contributions"]) == [
        ("ivo", True), ("joe", False)]  # fmt: skip
    queue = client.get("/api/review/queue", headers=headers("rev")).json()
    assert queue["summary"]["pending"] == 1 and [i["test"] for i in queue["items"]] == [False]
    lines = list(csv.DictReader(io.StringIO(
        client.get("/api/review/export.csv", headers=headers("rev")).text)))  # fmt: skip
    assert sorted((r["author"], r["test"]) for r in lines) == [("ivo", "True"), ("joe", "False")]
    subprocess.run([SCRIPT, "", pg_dsn], check=True, capture_output=True)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("TRUNCATE contributions CASCADE")
