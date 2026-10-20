"""Migration 014 (accounts): placeholders from the names the contributions held, the text
columns dropped, the API role's grants, and an account deleted by the API role."""

import subprocess

import pytest
from test_db import other_database, sql

from lacarte import db

COLS = ("uuid, kind, camera_id, osm_type, osm_id, osm_version, build_id, author, day,"
        " duration_ms, geom, payload, body_sha256, osm_tags, answer, status, decided_by,"
        " decided_on")  # fmt: skip


def apply(dsn: str, stem: str) -> None:
    """One migration, as db/migrate.sh applies it (its own transaction, recorded)."""
    f = db.MIGRATIONS / f"{stem}.sql"
    subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", dsn, "-1", "-f", str(f)],
                   check=True, capture_output=True, text=True)  # fmt: skip
    sql(dsn, f"INSERT INTO schema_migrations VALUES ('{stem}')")


def at(pg_dsn: str, name: str, last: str) -> str:
    """A database of its own migrated up to `last` (a version prefix, e.g. "013"), with the
    API role as bootstrap.sh sets it."""
    sql(pg_dsn, f"DROP DATABASE IF EXISTS {name}")
    sql(pg_dsn, f"CREATE DATABASE {name}")
    other = other_database(pg_dsn, name)
    sql(other, "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api')"
               " THEN CREATE ROLE preview_api; END IF; END $$")  # fmt: skip
    sql(other, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO preview_api")
    sql(other, "CREATE TABLE schema_migrations (version text PRIMARY KEY)")
    for f in sorted(db.MIGRATIONS.glob("0*.sql")):
        if f.stem[:3] > last:
            break
        apply(other, f.stem)
    return other


def at_013(pg_dsn: str, name: str) -> str:
    return at(pg_dsn, name, "013")


def row(i: int, author: str, status="pending", decided_by=None, camera="n1") -> str:
    by = f"'{decided_by}'" if decided_by else "NULL"
    on = "'2026-10-02'" if decided_by else "NULL"
    return (f"INSERT INTO contributions ({COLS}) VALUES ('00000000-0000-4000-8000-0000000014"
            f"{i:02d}', 'verify', '{camera}', 'n', 1, 1, 'b', '{author}', '2026-10-01', 0,"
            f" ST_SetSRID(ST_MakePoint(0, 0), 2154), '{{}}', 'x', '{{}}', 'present', '{status}',"
            f" {by}, {on})")  # fmt: skip


def accounts(dsn: str) -> list[list[str]]:
    return sql(dsn, "SELECT pseudonym, password_hash IS NULL, role, test,"
                    " created_month = date_trunc('month', current_date)::date"
                    " FROM accounts ORDER BY pseudonym")  # fmt: skip


@pytest.fixture(scope="module")
def migrated(pg_dsn, pg_loaded):
    """Names in author and decided_by, one of them a test account, then 014."""
    other = at_013(pg_dsn, "accounts_014")
    sql(other, "INSERT INTO test_authors VALUES ('bob')")
    sql(other, row(1, "ana"))
    sql(other, row(2, "bob"))
    sql(other, row(3, "ana", camera="n2"))
    # Decided by the review (the guard numbers each decision per camera).
    sql(other, "UPDATE contributions SET status = 'validated', decided_by = 'rev',"
               " decided_on = '2026-10-02' WHERE right(uuid::text, 2) IN ('02', '03')")  # fmt: skip
    # Withdrawn by its author (008: decided_by is the author).
    sql(other, row(4, "ana", "pending"))
    sql(other, "UPDATE contributions SET status = 'withdrawn', decided_by = 'ana',"
               " decided_on = '2026-10-03' WHERE uuid::text LIKE '%001404'")  # fmt: skip
    apply(other, "014_accounts")  # 014 alone: what it did (015 is test_osm_db's)
    return other


def test_014_makes_a_placeholder_for_every_name(migrated):
    assert accounts(migrated) == [
        ["ana", "t", "contributor", "f", "t"],
        ["bob", "t", "contributor", "t", "t"],  # in test_authors
        ["rev", "t", "contributor", "f", "t"],  # a decider only: a placeholder too
    ]
    links = sql(migrated, "SELECT right(uuid::text, 2), a.pseudonym, d.pseudonym, status,"
                          " decision_seq FROM contributions c"
                          " JOIN accounts a ON a.id = c.author_id"
                          " LEFT JOIN accounts d ON d.id = c.decided_by_id ORDER BY 1")  # fmt: skip
    assert links == [["01", "ana", "", "pending", ""], ["02", "bob", "rev", "validated", "1"],
                     ["03", "ana", "rev", "validated", "1"],
                     ["04", "ana", "ana", "withdrawn", ""]]  # fmt: skip
    columns = {r[0] for r in sql(migrated, "SELECT column_name FROM information_schema.columns"
                                           " WHERE table_name = 'contributions'")}  # fmt: skip
    assert {"author_id", "decided_by_id"} <= columns and not {"author", "decided_by"} & columns
    assert sql(migrated, "SELECT to_regclass('test_authors') IS NULL") == [["t"]]


def test_014_grants_the_api_role_what_it_needs_and_nothing_more(migrated):
    def can(table, privilege):
        return sql(migrated, f"SELECT has_table_privilege('preview_api', '{table}',"
                             f" '{privilege}')")[0][0] == "t"  # fmt: skip

    assert [can("accounts", p) for p in ("SELECT", "INSERT", "UPDATE", "DELETE")] == [
        True, False, False, True]  # fmt: skip
    assert [can("sessions", p) for p in ("SELECT", "INSERT", "UPDATE", "DELETE")] == [
        True, True, False, True]  # fmt: skip
    updatable = sql(migrated, "SELECT table_name, column_name"
                              " FROM information_schema.column_privileges"
                              " WHERE grantee = 'preview_api' AND privilege_type = 'UPDATE'"
                              " ORDER BY 1, 2")  # fmt: skip
    assert updatable == [["accounts", "leaderboard"], ["accounts", "password_hash"],
                         ["contributions", "decided_by_id"], ["contributions", "decided_on"],
                         ["contributions", "status"]]  # fmt: skip
    for refused in ("INSERT INTO accounts (pseudonym, created_month) VALUES ('eve', current_date)",
                    "UPDATE accounts SET role = 'reviewer'", "UPDATE accounts SET test = false",
                    "UPDATE accounts SET pseudonym = 'x' || pseudonym"):  # fmt: skip
        with pytest.raises(subprocess.CalledProcessError) as e:
            sql(migrated, f"SET ROLE preview_api; {refused}")
        assert "permission denied" in e.value.stderr, refused


def test_014_new_contributions_have_an_author(migrated):
    with pytest.raises(subprocess.CalledProcessError) as e:
        sql(
            migrated,
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id,"
            " osm_version, build_id, day, duration_ms, geom, payload, body_sha256,"
            " osm_tags, answer) VALUES ('00000000-0000-4000-8000-000000001409',"
            " 'verify', 'n1', 'n', 1, 1, 'b', '2026-10-01', 0,"
            " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', 'present')",
        )
    assert "a contribution has an author" in e.value.stderr


def test_an_account_deleted_by_the_api_role_leaves_its_contributions_without_author(migrated):
    """ON DELETE SET NULL under the API role: the rows stay, nameless; a withdrawn row is
    not « changed » for the guard, a decision keeps its day and its rank; the sessions go."""
    sql(migrated, "INSERT INTO sessions VALUES (sha256('t1'), (SELECT id FROM accounts"
                  " WHERE pseudonym = 'ana'), current_date + 30)")  # fmt: skip
    sql(migrated, "INSERT INTO sessions VALUES (sha256('t2'), (SELECT id FROM accounts"
                  " WHERE pseudonym = 'rev'), current_date + 30)")  # fmt: skip
    sql(migrated, "SET ROLE preview_api; DELETE FROM accounts WHERE pseudonym IN ('ana', 'rev')")
    got = sql(migrated, "SELECT right(uuid::text, 2), author_id IS NULL,"
                        " decided_by_id IS NULL, status, decided_on, decision_seq"
                        " FROM contributions ORDER BY 1")  # fmt: skip
    assert got == [["01", "t", "t", "pending", "", ""],
                   ["02", "f", "t", "validated", "2026-10-02", "1"],
                   ["03", "t", "t", "validated", "2026-10-02", "1"],
                   ["04", "t", "t", "withdrawn", "2026-10-03", ""]]  # fmt: skip
    assert sql(migrated, "SELECT count(*) FROM sessions") == [["0"]]
    assert [r[0] for r in accounts(migrated)] == ["bob"]


@pytest.mark.parametrize(("names", "message"), [
    (("ana", "x"), "names that are not pseudonyms (2 to 32 of A-Z a-z 0-9 . _ -): x"),
    (("ana", "Ana", "bob"), "names that differ only by case (one pseudonym each): Ana, ana"),
])  # fmt: skip
def test_014_stops_on_a_name_it_cannot_keep(pg_dsn, pg_loaded, names, message):
    other = at_013(pg_dsn, "accounts_014_bad")
    for i, n in enumerate(names):
        sql(other, row(i, n))
    with pytest.raises(subprocess.CalledProcessError) as e:
        db.migrate(other)
    assert message in e.value.stderr
    assert sql(other, "SELECT to_regclass('accounts') IS NULL") == [["t"]]  # rolled back


def test_the_rehearsal_migrates_a_restored_dump_and_keeps_the_file(pg_dsn, pg_loaded, tmp_path):
    """db/rehearse_migrations.sh on a dump of a preview database at 013 (as the owner
    downloads it, without the buildings' rows): restored into a throwaway database of this
    server, migrated and summed up, dropped; the file kept. joe is no test account."""
    preview = at_013(pg_dsn, "rehearsal_preview")
    sql(preview, "INSERT INTO test_authors VALUES ('ivo')")
    sql(preview, row(1, "ivo"))
    sql(preview, row(2, "joe"))
    dump = tmp_path / "copy.dump"
    subprocess.run(["pg_dump", "-Fc", "--exclude-table-data=buildings", "-f", str(dump),
                    preview], check=True)  # fmt: skip
    out = subprocess.run(["db/rehearse_migrations.sh", str(dump), pg_dsn], check=True,
                         capture_output=True, text=True).stdout  # fmt: skip
    assert "last migration: 013_position_source" in out and "applied 014_accounts" in out
    assert "account ivo placeholder test 1 contributions 0 decisions" in out
    assert "account joe placeholder not-test 1 contributions 0 decisions" in out
    assert "contributions without an author: 0" in out
    assert dump.exists()
    left = sql(pg_dsn, "SELECT count(*) FROM pg_database WHERE datname LIKE 'rehearsal_2%'")
    assert left == [["0"]]
