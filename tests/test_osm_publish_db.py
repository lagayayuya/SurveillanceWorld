"""Migration 016 (publish to OpenStreetMap): osm_write, osm_publications and osm_nodes, their
constraints, what goes with an account or a contribution, and the API role's grants."""

import subprocess

import pytest
from test_accounts_db import apply, at
from test_db import sql

UUID = "00000000-0000-4000-8000-000000001601"


@pytest.fixture(scope="module")
def migrated(pg_dsn, pg_loaded):
    """At 015 with an account and one of its contributions, then 016."""
    other = at(pg_dsn, "osm_016", "015")
    sql(other, "INSERT INTO accounts (pseudonym, password_hash, created_month)"
               " VALUES ('pub', 'x', '2026-10-01')")  # fmt: skip
    sql(other, "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
               " build_id, author_id, day, duration_ms, geom, payload, body_sha256, osm_tags,"
               f" answer) VALUES ('{UUID}', 'verify', 'n1', 'n', 1, 1, 'b',"
               " (SELECT id FROM accounts WHERE pseudonym = 'pub'), '2026-10-01', 0,"
               " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', 'present')")  # fmt: skip
    apply(other, "016_osm_publish")
    return other


ACCOUNT = "(SELECT id FROM accounts WHERE pseudonym = 'pub')"


def refused(dsn, statement, constraint):
    with pytest.raises(subprocess.CalledProcessError) as e:
        sql(dsn, statement)
    assert constraint in e.value.stderr, (statement, e.value.stderr)


def test_016_osm_write_holds_one_server_a_positive_uid_and_a_month(migrated):
    insert = ("INSERT INTO osm_write (account_id, server, osm_uid, token, since_month)"
              f" VALUES ({ACCOUNT}, {{}})")  # fmt: skip
    for values, constraint in (("'beta', 1, '\\x00', '2026-10-01'", "osm_write_server"),
                               ("'dev', 0, '\\x00', '2026-10-01'", "osm_write_osm_uid"),
                               ("'dev', 1, '\\x00', '2026-10-02'", "osm_write_since_month"),
                               ("'dev', 1, NULL, '2026-10-01'", "token")):  # fmt: skip
        refused(migrated, insert.format(values), constraint)
    sql(migrated, insert.format("'dev', 7, '\\x0102', '2026-10-01'"))
    refused(migrated, insert.format("'live', 8, '\\x00', '2026-10-01'"), "osm_write_pkey")
    sql(migrated, "DELETE FROM osm_write")


def test_016_a_publication_is_sending_published_or_a_conflict_with_its_reason(migrated):
    insert = ("INSERT INTO osm_publications (uuid, server, state, reason, changeset, month)"
              f" VALUES ('{UUID}', {{}})")  # fmt: skip
    for values, constraint in (
        ("'dev', 'conflict', NULL, NULL, '2026-10-01'", "osm_publications_conflict"),
        ("'dev', 'published', 'osm_value', NULL, '2026-10-01'", "osm_publications_conflict"),
        ("'dev', 'conflict', 'same_day', NULL, '2026-10-01'", "osm_publications_reason"),
        ("'dev', 'gone', NULL, NULL, '2026-10-01'", "osm_publications_state"),
        ("'beta', 'sending', NULL, 5, '2026-10-01'", "osm_publications_server"),
        ("'dev', 'sending', NULL, 0, '2026-10-01'", "osm_publications_changeset"),
        ("'dev', 'sending', NULL, 5, '2026-10-09'", "osm_publications_month"),
        ("'dev', NULL, NULL, 5, '2026-10-01'", "state"),
    ):  # fmt: skip
        refused(migrated, insert.format(values), constraint)
    sql(migrated, insert.format("'dev', 'published', NULL, NULL, '2026-10-01'"))
    sql(migrated, insert.format("'live', 'conflict', 'osm_deleted', NULL, '2026-10-01'"))
    refused(migrated, insert.format("'dev', 'sending', NULL, 5, '2026-10-01'"),
            "osm_publications_pkey")  # fmt: skip
    sql(migrated, "DELETE FROM osm_publications")


def test_016_a_node_is_positive_and_one_per_camera_and_server(migrated):
    insert = "INSERT INTO osm_nodes (server, camera_id, node_id, version) VALUES ({})"
    for values, constraint in (("'dev', 'c1', 0, 1", "osm_nodes_node_id"),
                               ("'dev', 'c1', 1, 0", "osm_nodes_version"),
                               ("'beta', 'c1', 1, 1", "osm_nodes_server")):  # fmt: skip
        refused(migrated, insert.format(values), constraint)
    sql(migrated, insert.format("'dev', 'c1', 1, 1"))
    sql(migrated, insert.format("'live', 'c1', 2, 1"))
    refused(migrated, insert.format("'dev', 'c1', 3, 1"), "osm_nodes_pkey")
    sql(migrated, "DELETE FROM osm_nodes")


def test_016_the_rows_go_with_their_account_or_contribution(migrated):
    sql(migrated, "INSERT INTO accounts (pseudonym, password_hash, created_month)"
                  " VALUES ('gone', 'x', '2026-10-01')")  # fmt: skip
    sql(migrated, "INSERT INTO osm_write VALUES ((SELECT id FROM accounts WHERE pseudonym ="
                  " 'gone'), 'dev', 7, '\\x00', '2026-10-01')")  # fmt: skip
    sql(migrated, "DELETE FROM accounts WHERE pseudonym = 'gone'")
    assert sql(migrated, "SELECT count(*) FROM osm_write") == [["0"]]
    gone = UUID[:-1] + "2"
    sql(migrated, f"INSERT INTO contributions SELECT (json_populate_record(c, json_build_object("
                  f"'uuid', '{gone}'))).* FROM contributions c WHERE uuid = '{UUID}'")  # fmt: skip
    sql(migrated, "INSERT INTO osm_publications VALUES"
                  f" ('{gone}', 'dev', 'published', NULL, 9, '2026-10-01')")  # fmt: skip
    sql(migrated, f"DELETE FROM contributions WHERE uuid = '{gone}'")
    assert sql(migrated, "SELECT count(*) FROM osm_publications") == [["0"]]


def test_016_grants_the_api_role_what_publishing_needs_and_nothing_more(migrated):
    def can(table, privilege):
        return sql(migrated, f"SELECT has_table_privilege('preview_api', '{table}',"
                             f" '{privilege}')")[0][0] == "t"  # fmt: skip

    for table in ("osm_write", "osm_publications"):
        assert all(can(table, p) for p in ("SELECT", "INSERT", "UPDATE", "DELETE")), table
    assert all(can("osm_nodes", p) for p in ("SELECT", "INSERT", "UPDATE"))
    assert not can("osm_nodes", "DELETE")
    for table in ("osm_write", "osm_publications", "osm_nodes"):
        assert not any(can(table, p) for p in ("TRUNCATE", "REFERENCES", "TRIGGER")), table
    # Nothing new on contributions: still its column grants only.
    assert not can("contributions", "UPDATE") and not can("contributions", "DELETE")
    api = "SET ROLE preview_api; "
    sql(migrated, api + "INSERT INTO osm_write VALUES"
                        f" ({ACCOUNT}, 'dev', 7, '\\x00', '2026-10-01');"
                        " UPDATE osm_write SET osm_uid = 8; DELETE FROM osm_write")  # fmt: skip
    sql(migrated, api + "INSERT INTO osm_nodes VALUES ('dev', 'c9', 1, 1);"
                        " UPDATE osm_nodes SET version = 2 WHERE camera_id = 'c9'")  # fmt: skip
    refused(migrated, api + "DELETE FROM osm_nodes", "permission denied")
    sql(migrated, "DELETE FROM osm_nodes")


# --- migration 022: the synchronisation -------------------------------------------------------


@pytest.fixture(scope="module")
def synced(pg_dsn, pg_loaded):
    """At 021 with an account that chose the manual « À publier » of 016 and one published
    contribution, then 022."""
    other = at(pg_dsn, "osm_022", "021")
    sql(other, "INSERT INTO accounts (pseudonym, password_hash, created_month)"
               " VALUES ('pub', 'x', '2026-10-01')")  # fmt: skip
    sql(other, "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
               " build_id, author_id, day, geom, payload, body_sha256, osm_tags, answer)"
               f" VALUES ('{UUID}', 'verify', 'n1', 'n', 1, 1, 'b', {ACCOUNT}, '2026-10-01',"
               " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', 'present')")  # fmt: skip
    sql(other, f"INSERT INTO osm_write VALUES ({ACCOUNT}, 'dev', 7, '\\x00', '2026-10-01')")
    sql(other, f"INSERT INTO osm_publications VALUES ('{UUID}', 'dev', 'published', NULL, 9,"
               " '2026-10-01')")  # fmt: skip
    apply(other, "022_osm_sync")
    return other


def test_022_an_existing_choice_dates_its_consent_from_the_migration(synced):
    """Additive: the row of 016 stays, its consent the migration's day, no failure, no
    error, nothing sent today; the publication stays as it was."""
    assert sql(synced, "SELECT consent_day = current_date, failures, last_error, sent_day,"
                       " sent_n, token IS NOT NULL FROM osm_write") == [
        ["t", "0", "", "", "0", "t"]]  # fmt: skip
    assert sql(synced, "SELECT state, changeset FROM osm_publications") == [["published", "9"]]


def test_022_a_token_is_null_exactly_when_osm_refused_it(synced):
    def update(values):
        sql(synced, f"BEGIN; UPDATE osm_write SET {values}; ROLLBACK")

    refused(synced, "UPDATE osm_write SET token = NULL", "osm_write_revoked")
    refused(synced, "UPDATE osm_write SET last_error = 'revoked'", "osm_write_revoked")
    refused(synced, "UPDATE osm_write SET last_error = 'gone'", "osm_write_last_error")
    refused(synced, "UPDATE osm_write SET failures = -1", "osm_write_failures")
    refused(synced, "UPDATE osm_write SET sent_n = -1", "osm_write_sent_n")
    update("token = NULL, last_error = 'revoked'")
    for error in ("blocked", "rate_limited", "osm_down"):
        update(f"last_error = '{error}', failures = 3")


def test_022_uncertain_and_a_duplicate_are_states_of_their_own(synced):
    insert = ("INSERT INTO osm_publications (uuid, server, state, reason, changeset, month)"
              f" VALUES ('{UUID}', 'live', {{}})")  # fmt: skip
    for values in ("'uncertain', NULL, 12, '2026-10-01'",
                   "'conflict', 'osm_duplicate', NULL, '2026-10-01'"):  # fmt: skip
        sql(synced, "BEGIN; " + insert.format(values) + "; ROLLBACK")
    refused(synced, insert.format("'uncertain', 'osm_value', 12, '2026-10-01'"),
            "osm_publications_conflict")  # fmt: skip
    refused(synced, insert.format("'queued', NULL, NULL, '2026-10-01'"), "osm_publications_state")


def test_022_two_switches_the_api_may_turn(synced):
    assert sql(synced, "SELECT key, value FROM site_settings ORDER BY 1") == [
        ["contributions_open", "t"], ["osm_sync", "t"], ["osm_write_live", "f"],
        ["signups_open", "t"]]  # fmt: skip
    refused(synced, "INSERT INTO site_settings VALUES ('osm_other', true)", "site_settings_key")
    sql(synced, "SET ROLE preview_api; UPDATE site_settings SET value = false,"
                " changed_on = current_date WHERE key = 'osm_sync'")  # fmt: skip
    sql(synced, "UPDATE site_settings SET value = true, changed_on = NULL WHERE key = 'osm_sync'")
