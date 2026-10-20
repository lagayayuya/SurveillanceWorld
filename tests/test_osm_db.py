"""Migration 015 (sign in with OpenStreetMap): accounts.osm_id, unique and positive, what a
placeholder means now, and the API role's two new column grants and nothing more."""

import subprocess

import pytest
from test_accounts_db import apply, at
from test_db import sql

from lacarte.api import auth


@pytest.fixture(scope="module")
def migrated(pg_dsn, pg_loaded):
    """At 014 with a placeholder and an account with a password, then 015."""
    other = at(pg_dsn, "osm_015", "014")
    sql(other, "INSERT INTO accounts (pseudonym, created_month) VALUES ('pla', '2026-10-01')")
    sql(other, "INSERT INTO accounts (pseudonym, password_hash, created_month)"
               " VALUES ('pwd', 'x', '2026-10-01')")  # fmt: skip
    apply(other, "015_osm")
    return other


def test_015_adds_a_positive_osm_id_unique_per_server_and_keeps_every_row(migrated):
    assert sql(migrated, "SELECT pseudonym, osm_id IS NULL FROM accounts ORDER BY 1") == [
        ["pla", "t"], ["pwd", "t"]]  # fmt: skip
    sql(migrated, "UPDATE accounts SET osm_id = 4242, osm_server = 'dev' WHERE pseudonym = 'pwd'")
    with pytest.raises(subprocess.CalledProcessError) as e:
        sql(migrated, "INSERT INTO accounts (pseudonym, created_month, osm_id, osm_server)"
                      " VALUES ('dup', '2026-10-01', 4242, 'dev')")  # fmt: skip
    assert "accounts_osm_id_key" in e.value.stderr
    # The same number on the other server is another person.
    sql(migrated, "INSERT INTO accounts (pseudonym, created_month, osm_id, osm_server)"
                  " VALUES ('liv', '2026-10-01', 4242, 'live')")  # fmt: skip
    bads = (("osm_id = 0, osm_server = 'dev'", "accounts_osm_id"),
            ("osm_id = 5, osm_server = NULL", "accounts_osm_pair"),
            ("osm_id = 5, osm_server = 'beta'", "accounts_osm_server"))  # fmt: skip
    for bad, constraint in bads:
        with pytest.raises(subprocess.CalledProcessError) as e:
            sql(migrated, f"UPDATE accounts SET {bad} WHERE pseudonym = 'pla'")
        assert constraint in e.value.stderr, bad
    sql(migrated, "DELETE FROM accounts WHERE pseudonym = 'liv'")
    sql(migrated, "UPDATE accounts SET osm_id = NULL, osm_server = NULL WHERE pseudonym = 'pwd'")


def test_015_a_placeholder_has_neither_a_password_nor_an_osm_id(migrated):
    """auth.CLAIMED, the one test every « not a placeholder » check uses."""
    sql(migrated, "INSERT INTO accounts (pseudonym, created_month, osm_id, osm_server)"
                  " VALUES ('osmo', '2026-10-01', 77, 'dev')")  # fmt: skip
    got = sql(migrated, f"SELECT a.pseudonym, {auth.CLAIMED} FROM accounts a ORDER BY 1")
    assert got == [["osmo", "t"], ["pla", "f"], ["pwd", "t"]]
    sql(migrated, "DELETE FROM accounts WHERE pseudonym = 'osmo'")


def test_015_grants_the_api_role_osm_id_and_an_osm_sign_up_only(migrated):
    def columns(privilege):
        return sql(migrated, "SELECT table_name, column_name"
                             " FROM information_schema.column_privileges"
                             f" WHERE grantee = 'preview_api' AND privilege_type = '{privilege}'"
                             " AND table_name = 'accounts' ORDER BY 1, 2")  # fmt: skip

    assert columns("UPDATE") == [["accounts", "leaderboard"], ["accounts", "osm_id"],
                                 ["accounts", "osm_server"],
                                 ["accounts", "password_hash"]]  # fmt: skip
    assert columns("INSERT") == [["accounts", "created_month"], ["accounts", "osm_id"],
                                 ["accounts", "osm_server"], ["accounts", "pseudonym"]]  # fmt: skip
    # Table-wide, nothing new: column grants only.
    assert sql(migrated, "SELECT has_table_privilege('preview_api', 'accounts', 'INSERT'),"
                         " has_table_privilege('preview_api', 'accounts', 'UPDATE')") == [
        ["f", "f"]]  # fmt: skip
    # What the API does: an OSM sign-up (the other columns keep their defaults), a link.
    created = sql(migrated, "SET ROLE preview_api; INSERT INTO accounts (pseudonym,"
                            " created_month, osm_id, osm_server)"
                            " VALUES ('osmo', '2026-10-01', 99, 'dev')"
                            " RETURNING role, password_hash IS NULL, disabled, leaderboard,"
                            " test")  # fmt: skip
    assert ["contributor", "t", "f", "f", "f"] in created
    sql(migrated, "SET ROLE preview_api; UPDATE accounts SET osm_id = 98, osm_server = 'dev'"
                  " WHERE pseudonym = 'pwd'")  # fmt: skip
    sql(migrated, "SET ROLE preview_api; UPDATE accounts SET osm_id = NULL, osm_server = NULL"
                  " WHERE pseudonym = 'pwd'")  # fmt: skip
    for refused in ("INSERT INTO accounts (pseudonym, created_month, osm_id, osm_server, role)"
                    " VALUES ('eve', '2026-10-01', 5, 'dev', 'reviewer')",
                    "INSERT INTO accounts (pseudonym, created_month, password_hash)"
                    " VALUES ('eve', '2026-10-01', 'x')",
                    "INSERT INTO accounts (pseudonym, created_month, test)"
                    " VALUES ('eve', '2026-10-01', true)",
                    "UPDATE accounts SET role = 'reviewer'", "UPDATE accounts SET disabled = false",
                    "UPDATE accounts SET pseudonym = 'x' || pseudonym"):  # fmt: skip
        with pytest.raises(subprocess.CalledProcessError) as e:
            sql(migrated, f"SET ROLE preview_api; {refused}")
        assert "permission denied" in e.value.stderr, refused
    sql(migrated, "DELETE FROM accounts WHERE pseudonym = 'osmo'")
