"""`make rehearse-restore DUMP=…`: db/restore.sh, then db/purge_test_accounts.sh in list mode,
on a throwaway local PostgreSQL with PostGIS (tests/pgcluster.py), set up as bootstrap.sh
sets up the server: a deploy role that owns a fresh database, the API's role reading it by
default privileges, the postgis extension made by the superuser. The restore runs as the
deploy role, as on the server; the grants the API ends with are then checked. Nothing is
deleted; the dump is kept and the cluster dropped. TEST_AUTHORS and KEEP (comma-separated
pseudonyms) go to the purge's listing."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

import pgcluster  # noqa: E402

DEPLOY = "deployer"  # the deploy user's role, any name
DATABASE = "fresh"
# What the API may do after a restore, as after the migrations alone (tests/test_db.py).
GRANTS = """
SELECT 'api ' || t || ' ' || p || ': ' || has_table_privilege('preview_api', t, p)
FROM (VALUES ('contributions', 'SELECT'), ('contributions', 'INSERT'),
             ('contributions', 'DELETE'), ('accounts', 'SELECT'), ('accounts', 'DELETE'),
             ('sessions', 'INSERT'), ('osm_write', 'INSERT'), ('osm_write', 'UPDATE'),
             ('osm_write', 'DELETE'), ('osm_publications', 'INSERT'),
             ('osm_publications', 'UPDATE'), ('osm_publications', 'DELETE'),
             ('osm_nodes', 'UPDATE'), ('osm_nodes', 'DELETE'), ('hidden_cameras', 'SELECT'),
             ('hidden_cameras', 'INSERT'), ('hidden_cameras', 'DELETE'),
             ('hidden_cameras', 'UPDATE'), ('accounts', 'UPDATE'), ('admin_log', 'SELECT'),
             ('admin_log', 'INSERT'), ('admin_log', 'UPDATE'), ('admin_log', 'DELETE'),
             ('site_settings', 'SELECT'), ('site_settings', 'INSERT'),
             ('site_settings', 'DELETE'), ('site_counters_hour', 'SELECT'),
             ('site_counters_hour', 'INSERT'), ('site_counters_hour', 'DELETE'),
             ('site_counters', 'SELECT'), ('site_counters', 'INSERT'),
             ('site_counters', 'DELETE'),
             ('site_counters_month', 'SELECT'), ('site_counters_month', 'INSERT'),
             ('site_counters_month', 'UPDATE'), ('site_counters_month', 'DELETE')) g(t, p)
UNION ALL
SELECT 'api admin_log_seq_seq USAGE: ' || has_sequence_privilege('preview_api',
       'admin_log_seq_seq', 'USAGE')
UNION ALL
SELECT 'api ' || t || ' UPDATE columns: ' || coalesce((SELECT string_agg(column_name, ','
       ORDER BY column_name) FROM information_schema.column_privileges
       WHERE grantee = 'preview_api' AND table_name = t AND privilege_type = 'UPDATE'), '')
FROM (VALUES ('accounts'), ('contributions'), ('site_settings'), ('site_counters_hour'),
             ('site_counters')) c(t)
UNION ALL
SELECT 'api ' || f || ' EXECUTE: ' || has_function_privilege('preview_api', f, 'EXECUTE')
FROM (VALUES ('lacarte_retention()'), ('lacarte_retention_at(date)')) r(f)
UNION ALL
SELECT 'public lacarte_retention() EXECUTE: '
       || coalesce((SELECT bool_or(a.grantee = 0) FROM pg_proc p, aclexplode(p.proacl) a
                    WHERE p.proname = 'lacarte_retention'), true)
UNION ALL
SELECT 'owner of every table is ' || string_agg(DISTINCT tableowner, ',')
FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys'
"""
# What the restored database holds after the migrations (020: every reviewer an admin): the
# roles counted, never a pseudonym; the settings; the journal's next number; (021) the
# counters' rows and whether the gesture's duration is gone; (022) the choices to publish with
# their consent day and state, the publications by server and state, the two OSM switches.
AFTER = """
SELECT 'accounts ' || role || CASE WHEN disabled THEN ' disabled' ELSE '' END
       || CASE WHEN password_hash IS NULL AND osm_id IS NULL THEN ' placeholder' ELSE '' END
       || ': ' || count(*)
FROM accounts GROUP BY role, disabled, password_hash IS NULL AND osm_id IS NULL
UNION ALL
SELECT 'privileged accounts without a password: ' || count(*) FROM accounts
WHERE role IN ('reviewer', 'admin') AND password_hash IS NULL
UNION ALL
SELECT 'setting ' || key || ': ' || value FROM site_settings
UNION ALL
SELECT 'admin_log rows: ' || count(*) || ', next seq: '
       || (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END
           FROM admin_log_seq_seq)
FROM admin_log
UNION ALL
SELECT 'hidden cameras left the map: ' || count(applied_build) || ' of ' || count(*)
FROM hidden_cameras
UNION ALL
SELECT 'site_counters_hour rows: ' || (SELECT count(*) FROM site_counters_hour)
       || ', site_counters rows: ' || (SELECT count(*) FROM site_counters)
       || ', site_counters_month rows: ' || (SELECT count(*) FROM site_counters_month)
UNION ALL
SELECT 'contributions.duration_ms present: ' || EXISTS (SELECT FROM information_schema.columns
       WHERE table_name = 'contributions' AND column_name = 'duration_ms')
UNION ALL
SELECT 'osm_write ' || server || ': ' || count(*) || ', consent day set: '
       || count(consent_day) || ', token kept: ' || count(token) || ', last error: '
       || coalesce(string_agg(DISTINCT last_error, ','), '-')
FROM osm_write GROUP BY server
UNION ALL
SELECT 'osm_write rows: ' || count(*) FROM osm_write
UNION ALL
SELECT 'osm_publications ' || server || ' ' || state || coalesce(' ' || reason, '') || ': '
       || count(*)
FROM osm_publications GROUP BY server, state, reason
UNION ALL
SELECT 'osm settings present: ' || count(*) FROM site_settings
WHERE key IN ('osm_sync', 'osm_write_live')
UNION ALL
SELECT 'function ' || p.proname || ' owner ' || pg_get_userbyid(p.proowner) || ', security '
       || CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END || ', '
       || array_to_string(p.proconfig, ';')
FROM pg_proc p WHERE p.proname LIKE 'lacarte_retention%'
"""
# What the API's retention would do on this copy now (migration 023), as the API's role: the
# counts only. The copy is the throwaway cluster's; the dump is never touched.
RETENTION = """
SET ROLE preview_api;
SELECT 'retention as the api: journal ' || journal || ', hours ' || hours || ', days ' || days
FROM lacarte_retention();
"""


def with_keys(dsn: str, **keys) -> str:
    parts = [p for p in dsn.split() if p.split("=")[0] not in keys]
    return " ".join(parts + [f"{k}={v}" for k, v in keys.items()])


def psql(dsn: str, sql: str) -> str:
    return subprocess.run(["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", dsn, "-c", sql],
                          check=True, capture_output=True, text=True).stdout  # fmt: skip


def main(dump: str) -> None:
    env = dict(os.environ)
    bindir = pgcluster.postgis_bin()
    if bindir is not None:
        env["PATH"] = f"{bindir}{os.pathsep}{env['PATH']}"
    with pgcluster.database() as su:
        psql(su, f"CREATE ROLE {DEPLOY} LOGIN")
        psql(su, "CREATE ROLE preview_api LOGIN")
        psql(su, f"CREATE DATABASE {DATABASE} OWNER {DEPLOY}")
        fresh_su = with_keys(su, dbname=DATABASE)
        psql(fresh_su, "CREATE EXTENSION IF NOT EXISTS postgis")
        psql(fresh_su, f"REVOKE CONNECT ON DATABASE {DATABASE} FROM PUBLIC;"
                       f" GRANT CONNECT ON DATABASE {DATABASE} TO preview_api, {DEPLOY};"
                       " GRANT USAGE ON SCHEMA public TO preview_api;"
                       f" ALTER DEFAULT PRIVILEGES FOR ROLE {DEPLOY} IN SCHEMA public"
                       " GRANT SELECT ON TABLES TO preview_api")  # fmt: skip
        fresh = with_keys(su, user=DEPLOY, dbname=DATABASE)
        run = {"check": True, "env": env}
        print("== restore (as the deploy role)", flush=True)
        subprocess.run([str(ROOT / "db" / "restore.sh"), dump, fresh], **run)
        print("== grants", flush=True)
        print(psql(fresh, GRANTS), end="", flush=True)
        print("== after", flush=True)
        print(psql(fresh, AFTER), end="", flush=True)
        print("== retention (migration 023)", flush=True)
        print(psql(fresh_su, RETENTION), end="", flush=True)
        print("== purge, listed only", flush=True)
        keep = os.environ.get("KEEP", "")
        subprocess.run([str(ROOT / "db" / "purge_test_accounts.sh"),
                        *(["--keep", keep] if keep else []), fresh], **run)  # fmt: skip
        print(f"rehearsal done: the cluster is dropped, {dump} kept", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: make rehearse-restore DUMP=path/to/copy.dump")
    main(sys.argv[1])
