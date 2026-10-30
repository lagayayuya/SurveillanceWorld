"""db/restore.sh and db/purge_test_accounts.sh on fictitious data: a database in service (at
the latest migration, or at 013 as the owner's copy of 2026-10-10) dumped as the server
does, restored into a fresh database set up as bootstrap.sh sets the server's (a deploy role
that owns it, the API's role by default privileges, postgis made by the superuser) by that
deploy role, migrated; then the test accounts listed, and deleted only with --delete."""

import subprocess

import pytest
from psycopg.conninfo import make_conninfo
from test_accounts_db import at, at_013, row
from test_db import other_database, sql
from test_purge import database_in_service

from lacarte import regions

RESTORE = regions.ROOT / "db" / "restore.sh"
DEPLOY = "deployer"
DEPLOY_PASSWORD = "deployer-test-only"


@pytest.fixture(scope="module")
def in_service(pg_dsn, pg_loaded):
    """With, since 020, two journal lines (the second numbered 7) and contributions closed:
    the restore keeps the dump's settings over the ones 020 seeds, and the journal goes on
    numbering after its last line; since 021, two days of counters and a monthly total;
    since 022, the synchronisation suspended, a consent day, a revoked token, an uncertain
    sending and a duplicate."""
    dsn = database_in_service(pg_dsn)
    sql(dsn, "INSERT INTO admin_log (seq, actor, action, target) VALUES"
             " (3, 'joe', 'hide', 'n42'), (7, 'joe', 'setting', 'contributions_open');"
             " UPDATE site_settings SET value = false, changed_on = '2026-10-05'"
             " WHERE key = 'contributions_open';"
             " INSERT INTO site_counters VALUES ('2026-10-15', 'map', 12),"
             " ('2026-10-15', 'welcome', 4); INSERT INTO site_counters_month VALUES"
             " ('2025-08-01', 'map', 300); INSERT INTO site_counters_hour VALUES"
             " ('2026-10-16 09:00+00', 'signin', 2)")  # fmt: skip
    sql(dsn, "UPDATE site_settings SET value = false, changed_on = '2026-10-06'"
             " WHERE key = 'osm_sync';"
             " UPDATE osm_write SET consent_day = '2026-10-04', token = NULL,"
             " last_error = 'revoked', failures = 1;"
             " UPDATE osm_publications SET state = 'uncertain', reason = NULL, changeset = 77"
             " WHERE uuid = (SELECT min(uuid::text)::uuid FROM osm_publications);"
             " INSERT INTO osm_publications SELECT uuid, 'live', 'conflict', 'osm_duplicate',"
             " NULL, '2026-10-01' FROM contributions ORDER BY uuid LIMIT 1")  # fmt: skip
    # Since 026, a register report waiting, with its contact.
    sql(dsn, "INSERT INTO registre_reports (evenement, affaire, category, correction, contact)"
             " VALUES ('e1~0', 'e1', 'montant', '12 000 €', 'lecteur')")  # fmt: skip
    return dsn


def fresh(pg_dsn, name) -> str:
    """As bootstrap.sh: the deploy role owns the database, postgis made by the superuser,
    the API's role reads what the deploy role creates. The deploy role's DSN, built from the
    superuser's whatever its form (keywords here, a URL in CI), with the role's password: the
    server's deploy role signs in over the local socket, CI's service asks a password over
    TCP."""
    sql(pg_dsn, f"DROP DATABASE IF EXISTS {name}")
    for role in (f"{DEPLOY} LOGIN", "preview_api"):
        sql(pg_dsn, f"DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname ="
                    f" '{role.split()[0]}') THEN CREATE ROLE {role}; END IF; END $$")  # fmt: skip
    sql(pg_dsn, f"ALTER ROLE {DEPLOY} PASSWORD '{DEPLOY_PASSWORD}'")
    sql(pg_dsn, f"CREATE DATABASE {name} OWNER {DEPLOY}")
    su = other_database(pg_dsn, name)
    sql(su, "CREATE EXTENSION IF NOT EXISTS postgis")
    sql(su, f"ALTER DEFAULT PRIVILEGES FOR ROLE {DEPLOY} IN SCHEMA public"
            " GRANT SELECT ON TABLES TO preview_api")  # fmt: skip
    return make_conninfo(su, user=DEPLOY, password=DEPLOY_PASSWORD)


def dump(dsn, path, *tables) -> str:
    """pg_dump -Fc: whole without the buildings' rows (the owner's copy), or with -t (the
    nightly backup's tables)."""
    only = [a for t in tables for a in ("-t", t)] or ["--exclude-table-data=buildings"]
    subprocess.run(["pg_dump", "-Fc", *only, "-f", str(path), dsn], check=True)
    return str(path)


def restore(dump_path, dsn):
    return subprocess.run([str(RESTORE), dump_path, dsn], capture_output=True, text=True)


def counts(dsn) -> dict[str, int]:
    tables = ("accounts", "contributions", "sessions", "osm_write", "osm_publications",
              "hidden_cameras", "cameras", "meta", "admin_log", "site_settings",
              "site_counters_hour", "site_counters", "site_counters_month",
              "registre_reports")  # fmt: skip
    return {t: int(sql(dsn, f"SELECT count(*) FROM {t}")[0][0]) for t in tables}


@pytest.mark.parametrize("tables", [(), ("contributions", "accounts", "schema_migrations",
                                         "meta", "osm_publications", "osm_nodes", "osm_write",
                                         "hidden_cameras", "admin_log",
                                         "site_settings", "site_counters_hour",
                                         "site_counters", "site_counters_month",
                                         "registre_reports")])  # fmt: skip
def test_a_dump_restores_into_a_fresh_database_by_its_owner(pg_dsn, in_service, tmp_path, tables):
    sql(in_service, "UPDATE meta SET buildings_sha256 = 'abc'")  # its buildings: not dumped
    path = dump(in_service, tmp_path / "copy.dump", *tables)
    target = fresh(pg_dsn, "restored")
    out = restore(path, target)
    assert out.returncode == 0, out.stderr
    assert "dump at 027_registre_recherche" in out.stdout
    assert counts(target) == {**counts(in_service), "sessions": 0, "cameras": 0}
    # The dump's settings, not the ones 020 and 022 seed; the journal numbers on after its
    # last.
    assert sql(target, "SELECT key, value, changed_on FROM site_settings ORDER BY 1") == [
        ["contributions_open", "f", "2026-10-05"], ["osm_sync", "f", "2026-10-06"],
        ["osm_write_live", "f", ""], ["signups_open", "t", ""]]  # fmt: skip
    # The synchronisation's states (022): a consent day, a revoked token, a duplicate, an
    # uncertain sending.
    assert sql(target, "SELECT consent_day, token IS NULL, last_error, failures FROM osm_write"
                       " ORDER BY consent_day") == sql(in_service, "SELECT consent_day,"
        " token IS NULL, last_error, failures FROM osm_write ORDER BY consent_day")  # fmt: skip
    assert sql(target, "SELECT state, reason FROM osm_publications ORDER BY 1, 2") == sql(
        in_service, "SELECT state, reason FROM osm_publications ORDER BY 1, 2")  # fmt: skip
    assert sql(target, "INSERT INTO admin_log (actor, action) VALUES ('ana', 'cut')"
                       " RETURNING seq")[0] == ["8"]  # fmt: skip
    # The region for `lacarte contrib export`; the buildings loaded by the next deploy.
    assert sql(target, "SELECT region, buildings_sha256 IS NULL FROM meta") == [["ci", "t"]]
    # Owners and grants as the migrations make them, whoever owned the dumped tables.
    assert sql(target, "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'"
                       " AND tablename <> 'spatial_ref_sys'") == [[DEPLOY]]  # fmt: skip
    can = "SELECT has_table_privilege('preview_api', '{}', '{}')"
    assert sql(target, can.format("contributions", "INSERT")) == [["t"]]
    assert sql(target, can.format("hidden_cameras", "INSERT")) == [["t"]]  # 020
    assert sql(target, can.format("admin_log", "DELETE")) == [["f"]]
    # The triggers are back on.
    assert sql(target, "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'contributions'::regclass"
                       " AND NOT tgisinternal AND tgenabled <> 'O'") == [["0"]]  # fmt: skip
    again = restore(path, target)
    assert again.returncode == 1 and "not fresh" in again.stderr


def test_a_dump_at_013_restores_and_migrates(pg_dsn, pg_loaded, tmp_path):
    old = at_013(pg_dsn, "restore_013")
    sql(old, "INSERT INTO test_authors VALUES ('ivo')")
    sql(old, row(1, "ivo"))
    sql(old, row(2, "joe", status="validated", decided_by="joe"))
    target = fresh(pg_dsn, "restored_013")
    out = restore(dump(old, tmp_path / "old.dump"), target)
    assert out.returncode == 0, out.stderr
    assert "dump at 013_position_source" in out.stdout and "applied 014_accounts" in out.stdout
    accounts = sql(target, "SELECT pseudonym, test FROM accounts ORDER BY 1")
    assert accounts == [["ivo", "t"], ["joe", "f"]]
    last = sql(target, "SELECT max(version) FROM schema_migrations")
    assert last == [["027_registre_recherche"]]


def test_a_dump_at_019_restores_its_reviewers_as_administrators(pg_dsn, pg_loaded, tmp_path):
    """The production dump of 2026-10-16 is at 019: its rows load before 020, which makes
    every reviewer an administrator and seeds the settings open; the journal starts at 1."""
    old = at(pg_dsn, "restore_019", "019")
    sql(old, "INSERT INTO accounts (pseudonym, password_hash, role, created_month) VALUES"
             " ('own', 'x', 'reviewer', '2026-10-01'), ('ana', 'x', 'contributor', '2026-10-01');"
             " INSERT INTO hidden_cameras VALUES ('n42', '2026-10-03')")  # fmt: skip
    target = fresh(pg_dsn, "restored_019")
    out = restore(dump(old, tmp_path / "old.dump", "accounts", "schema_migrations",
                       "hidden_cameras", "contributions"), target)  # fmt: skip
    assert out.returncode == 0, out.stderr
    assert "dump at 019_review_labels" in out.stdout and "applied 020_admin" in out.stdout
    assert sql(target, "SELECT pseudonym, role FROM accounts ORDER BY 1") == [
        ["ana", "contributor"], ["own", "admin"]]  # fmt: skip
    assert sql(target, "SELECT key, value FROM site_settings ORDER BY 1") == [
        ["contributions_open", "t"], ["osm_sync", "t"], ["osm_write_live", "f"],
        ["signups_open", "t"]]  # fmt: skip
    assert sql(target, "SELECT camera_id, applied_build IS NULL FROM hidden_cameras") == [
        ["n42", "t"]]  # fmt: skip
    assert sql(target, "INSERT INTO admin_log (actor, action) VALUES ('own', 'cut')"
                       " RETURNING seq")[0] == ["1"]  # fmt: skip


def test_a_dump_at_020_restores_without_the_gesture_s_duration(pg_dsn, pg_loaded, tmp_path):
    """The deploy dumps before migrating: a dump at 020 has contributions with their
    duration_ms. Its rows load at 020 (the column is there), then 021 drops the column and
    adds the counters, empty."""
    old = at(pg_dsn, "restore_020", "020")
    sql(old, "INSERT INTO accounts (pseudonym, password_hash, role, created_month) VALUES"
             " ('ana', 'x', 'contributor', '2026-10-01');"
             " INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
             " build_id, author_id, day, duration_ms, geom, payload, body_sha256, osm_tags,"
             " answer) VALUES ('00000000-0000-4000-8000-000000002101', 'verify', 'n1', 'n', 1, 1,"
             " 'b', (SELECT id FROM accounts WHERE pseudonym = 'ana'), '2026-10-12', 4321,"
             " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', 'present')")  # fmt: skip
    path = dump(old, tmp_path / "old.dump", "accounts", "schema_migrations", "contributions")
    listed = subprocess.run(["pg_restore", "-a", "-t", "contributions", "-f", "-", path],
                            check=True, capture_output=True, text=True).stdout  # fmt: skip
    assert "duration_ms" in listed and "4321" in listed  # the dump does carry it
    target = fresh(pg_dsn, "restored_020")
    out = restore(path, target)
    assert out.returncode == 0, out.stderr
    assert "dump at 020_admin" in out.stdout and "applied 021_site_counters" in out.stdout
    assert sql(target, "SELECT uuid, day, answer FROM contributions") == [
        ["00000000-0000-4000-8000-000000002101", "2026-10-12", "present"]]  # fmt: skip
    assert sql(target, "SELECT count(*) FROM information_schema.columns WHERE table_name ="
                       " 'contributions' AND column_name = 'duration_ms'") == [["0"]]  # fmt: skip
    assert sql(target, "SELECT (SELECT count(*) FROM site_counters),"
                       " (SELECT count(*) FROM site_counters_month)") == [["0", "0"]]  # fmt: skip
    assert "site_counters: 0" in out.stdout and "site_counters_month: 0" in out.stdout


def test_a_dump_without_migrations_is_refused(pg_dsn, in_service, tmp_path):
    out = restore(dump(in_service, tmp_path / "c.dump", "contributions"), fresh(pg_dsn, "r2"))
    assert out.returncode == 1 and "last migration (none)" in out.stderr
