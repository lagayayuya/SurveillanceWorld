"""The accounts CLI (python -m lacarte.api.accounts, lacarte accounts): fictitious accounts
in the throwaway database; passwords typed through a replaced getpass, never in argv."""

import argparse
import subprocess
import sys
import tomllib
import uuid

import psycopg
import pytest
import sessions
from argon2 import PasswordHasher

from lacarte import cli, regions
from lacarte.api import accounts, auth

TYPED = "a fictitious long password"


@pytest.fixture(autouse=True)
def cheap(monkeypatch, pg_loaded):
    monkeypatch.setattr(auth, "hasher", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
    monkeypatch.setattr(auth, "_dummy", None)


@pytest.fixture
def typed(monkeypatch):
    """getpass answers these, in order (never the command line)."""
    answers = []
    monkeypatch.setattr(accounts.getpass, "getpass", lambda prompt="": answers.pop(0))
    return answers


@pytest.fixture
def dsn(pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM accounts WHERE pseudonym IN ('kim', 'Kim', 'olga', 'pla')")
    return pg_dsn


def run(dsn, *argv):
    return accounts.main(["--dsn", dsn, *argv])


def account(dsn, name):
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT id::text, password_hash, role, disabled, test FROM accounts"
            " WHERE pseudonym = %s",
            (name,),
        ).fetchone()


def sessions_of(dsn, aid):
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT count(*) FROM sessions WHERE account_id = %s",
                            (aid,)).fetchone()[0]  # fmt: skip


def open_session(dsn, aid):
    with psycopg.connect(dsn, autocommit=True) as conn:
        auth.open_session(conn, aid, auth.date.today())


def test_create_asks_twice_and_stores_an_argon2id_hash(dsn, typed, capsys):
    typed += [TYPED, TYPED]
    assert run(dsn, "create", "kim") == 0
    aid, stored, role, disabled, test = account(dsn, "kim")
    assert stored.startswith("$argon2id$") and auth.verify(stored, TYPED)
    assert (role, disabled, test) == ("contributor", False, False)
    out = capsys.readouterr().out
    assert "created kim (contributor)" in out and TYPED not in out and "$argon2" not in out
    typed += [TYPED, TYPED]
    with pytest.raises(SystemExit, match="exists"):
        run(dsn, "create", "KIM")


@pytest.mark.parametrize(("answers", "why"), [
    ([TYPED, "another long password"], "differ"),
    (["short", "short"], "at least 12"),
])  # fmt: skip
def test_create_refuses_a_mistyped_or_short_password(dsn, typed, answers, why):
    typed += answers
    with pytest.raises(SystemExit, match=why):
        run(dsn, "create", "kim")
    assert account(dsn, "kim") is None


def test_generate_prints_the_password_once(dsn, capsys):
    assert run(dsn, "create", "olga", "--reviewer", "--generate") == 0
    out = capsys.readouterr().out
    password = out.split("password (shown once): ")[1].split()[0]
    assert len(password) == 24 and out.count(password) == 1
    _, stored, role, _, _ = account(dsn, "olga")
    assert role == "reviewer" and auth.verify(stored, password)


def test_the_first_administrator_and_a_role_changed_by_hand(dsn, typed, capsys):
    """Migration 020: `create --admin` makes the first administrator; `role` changes one
    (recovery), revoking the sessions; a reviewer or an administrator needs a password."""
    assert run(dsn, "create", "olga", "--admin", "--generate") == 0
    aid, _, role, _, _ = account(dsn, "olga")
    assert role == "admin" and "created olga (admin)" in capsys.readouterr().out
    open_session(dsn, aid)
    assert run(dsn, "role", "OLGA", "reviewer") == 0
    assert account(dsn, "olga")[2] == "reviewer" and sessions_of(dsn, aid) == 0
    assert "olga is now reviewer; sessions revoked: 1" in capsys.readouterr().out
    pid = sessions.account_id("pla", dsn)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET password_hash = NULL WHERE id = %s", (pid,))
    with pytest.raises(SystemExit, match="pla has no password"):
        run(dsn, "role", "pla", "admin")
    assert run(dsn, "role", "pla", "contributor") == 0
    with pytest.raises(SystemExit):
        run(dsn, "role", "olga", "owner")  # not a role
    with pytest.raises(SystemExit):
        run(dsn, "create", "kim", "--admin", "--reviewer")  # one or the other


def test_create_claims_a_placeholder_with_its_contributions(dsn, typed, capsys):
    pid = sessions.account_id("pla", dsn)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET password_hash = NULL, test = true WHERE id = %s", (pid,))
        cam, build = conn.execute("SELECT camera_id, (SELECT build_id FROM meta) FROM cameras"
                                  " ORDER BY 1 LIMIT 1").fetchone()  # fmt: skip
        conn.execute(
            "INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
            " build_id, author_id, day, geom, payload, body_sha256, osm_tags,"
            " answer) VALUES (%s, 'verify', %s, 'n', %s, 1, %s, %s, current_date,"
            " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', 'present')",
            (str(uuid.uuid4()), cam, int(cam[1:]), build, pid),
        )
    typed += [TYPED, TYPED]
    assert run(dsn, "create", "PLA") == 0
    aid, stored, role, _, test = account(dsn, "pla")
    assert aid == pid and auth.verify(stored, TYPED) and test is True  # its flag kept
    assert "claimed pla (contributor): 1 contribution(s)" in capsys.readouterr().out
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM contributions WHERE author_id = %s", (pid,))


def test_an_osm_account_is_no_placeholder_to_claim(dsn, typed, capsys):
    """Migration 015: an account with an OSM user and no password is someone's: `create`
    refuses it (reset-password gives it a password), `list` says active and `no password`,
    never the OSM id."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO accounts (pseudonym, created_month, osm_id, osm_server)"
                     " VALUES ('olga', date_trunc('month', current_date), 9015015,"
                     " 'dev')")  # fmt: skip
        conn.execute("INSERT INTO accounts (pseudonym, created_month)"
                     " VALUES ('pla', date_trunc('month', current_date))")  # fmt: skip
    typed += [TYPED, TYPED]
    with pytest.raises(SystemExit, match="refused: the account olga exists"):
        run(dsn, "create", "Olga")
    assert account(dsn, "olga")[1] is None
    capsys.readouterr()
    run(dsn, "list")
    out = capsys.readouterr().out
    lines = {line.split()[0]: line for line in out.splitlines()}
    assert lines["pseudonym"].split()[:5] == ["pseudonym", "role", "since", "state", "osm"]
    assert " active " in lines["olga"] and "no password" in lines["olga"]
    assert " placeholder " in lines["pla"] and "9015015" not in out
    typed += [TYPED, TYPED]
    run(dsn, "reset-password", "olga")  # a password now, and OSM unlinked (a reset unlinks)
    run(dsn, "list")
    olga = {line.split()[0]: line for line in capsys.readouterr().out.splitlines()}["olga"]
    assert " active " in olga and " linked " not in olga and "no password" not in olga


def test_reset_disable_and_delete_revoke_the_sessions(dsn, typed, capsys, monkeypatch):
    typed += [TYPED, TYPED]
    run(dsn, "create", "kim")
    aid = account(dsn, "kim")[0]
    open_session(dsn, aid)
    typed += ["another long password"] * 2
    run(dsn, "reset-password", "Kim")
    assert sessions_of(dsn, aid) == 0
    assert auth.verify(account(dsn, "kim")[1], "another long password")
    open_session(dsn, aid)
    run(dsn, "disable", "kim")
    assert account(dsn, "kim")[3] is True and sessions_of(dsn, aid) == 0
    run(dsn, "enable", "kim")
    assert account(dsn, "kim")[3] is False
    open_session(dsn, aid)
    monkeypatch.setattr("builtins.input", lambda prompt="": "kimm")
    with pytest.raises(SystemExit, match="not deleted"):
        run(dsn, "delete", "kim")
    assert account(dsn, "kim") is not None
    monkeypatch.setattr("builtins.input", lambda prompt="": "kim")
    run(dsn, "delete", "kim")
    assert account(dsn, "kim") is None and sessions_of(dsn, aid) == 0
    with pytest.raises(SystemExit, match="no account kim"):
        run(dsn, "disable", "kim")


def give_write(dsn, aid, server="dev") -> None:
    """Publishing on (migration 016): a sealed token, as the API keeps it."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("INSERT INTO osm_write VALUES (%s, %s, 77, '\\x00', date_trunc('month',"
                     " current_date))", (aid, server))  # fmt: skip


def writes(dsn, aid) -> int:
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT count(*) FROM osm_write WHERE account_id = %s",
                            (aid,)).fetchone()[0]  # fmt: skip


def test_delete_and_reset_end_publishing_and_say_so(dsn, typed, capsys, monkeypatch):
    """The write token goes, deleted here, not revoked at OSM (the CLI has neither the key
    nor the client): said on the line, only when there was one."""
    typed += [TYPED, TYPED]
    run(dsn, "create", "kim")
    aid = account(dsn, "kim")[0]
    give_write(dsn, aid, "live")
    capsys.readouterr()
    run(dsn, "list")
    head, *rows = capsys.readouterr().out.splitlines()
    assert head.split()[:6] == ["pseudonym", "role", "since", "state", "osm", "publish"]
    (kim,) = [r for r in rows if r.startswith("kim ")]
    assert kim.split()[4] == "live"
    typed += [TYPED, TYPED]
    run(dsn, "reset-password", "kim")
    assert capsys.readouterr().out.endswith(
        "; OSM publishing off (token deleted here, not revoked at OSM)\n")  # fmt: skip
    assert writes(dsn, aid) == 0
    typed += [TYPED, TYPED]
    run(dsn, "reset-password", "kim")
    assert "OSM publishing off" not in capsys.readouterr().out
    run(dsn, "list")
    (kim,) = [r for r in capsys.readouterr().out.splitlines() if r.startswith("kim ")]
    assert kim.split()[4] == "-"
    give_write(dsn, aid)
    monkeypatch.setattr("builtins.input", lambda prompt="": "kim")
    run(dsn, "delete", "kim")
    out = capsys.readouterr().out
    assert "kim deleted" in out and out.endswith(
        "; OSM publishing off (token deleted here, not revoked at OSM)\n")  # fmt: skip
    assert writes(dsn, aid) == 0


def test_list_shows_no_hash(dsn, typed, capsys):
    typed += [TYPED, TYPED]
    run(dsn, "create", "kim")
    capsys.readouterr()
    run(dsn, "list")
    out = capsys.readouterr().out
    assert out.startswith("pseudonym") and "kim" in out and "$argon2" not in out


def test_no_password_ever_goes_in_the_command_line(dsn):
    """No option takes a password: argv is in the shell history and in `ps`."""
    p = accounts.parser("x")
    subs = next(a for a in p._actions if isinstance(a, argparse._SubParsersAction))
    for name, sub in subs.choices.items():
        options = [o for a in sub._actions for o in a.option_strings]
        assert not [o for o in options if "pass" in o or "pw" in o], name
    for argv in (["create", "kim", "--password", TYPED], ["reset-password", "kim", TYPED]):
        with pytest.raises(SystemExit) as e:
            run(dsn, *argv)
        assert e.value.code == 2  # argparse refuses it
    assert account(dsn, "kim") is None


def test_lacarte_accounts_is_the_same_command(dsn, capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["accounts", "--dsn", dsn, "list"])
    assert e.value.code == 0 and capsys.readouterr().out.startswith("pseudonym")


# Dependencies of the pipeline the API's group does not have (pyproject.toml): the server's
# venv has only the `api` group, so nothing under lacarte.api may import them.
NOT_ON_THE_SERVER = ("geopandas", "pandas", "pyarrow", "osmium", "h3", "pmtiles")


def test_the_api_and_the_cli_import_only_the_api_group():
    project = tomllib.loads((regions.ROOT / "pyproject.toml").read_text())
    api_group = " ".join(project["dependency-groups"]["api"])
    assert "argon2-cffi" in api_group and "psycopg" in api_group
    blocker = (
        "import sys\n"
        "class Block:\n"
        "    def find_spec(self, name, path=None, target=None):\n"
        f"        if name.split('.')[0] in {NOT_ON_THE_SERVER!r}:\n"
        "            raise ImportError('not in the api group: ' + name)\n"
        "sys.meta_path.insert(0, Block())\n"
        "import lacarte.api.app, lacarte.api.accounts, lacarte.api.leaderboard\n"
        "import lacarte.api.osm\n"
        "import runpy; sys.argv = ['accounts', '--help']\n"
        "runpy.run_module('lacarte.api.accounts', run_name='__main__')\n"
    )
    r = subprocess.run([sys.executable, "-c", blocker], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-2000:]
    assert "python -m lacarte.api.accounts" in r.stdout or "usage: accounts" in r.stdout


def test_deleting_a_test_account_takes_its_contributions(dsn, monkeypatch, capsys):
    """Without their author nothing would mark them as test: they go with the account, and
    an opinion someone else gave on one (it cannot stand without its target) with them."""
    tid = sessions.account_id("tst", dsn)
    other = sessions.account_id("oth", dsn)
    ins = ("INSERT INTO contributions (uuid, kind, camera_id, osm_type, osm_id, osm_version,"
           " build_id, author_id, day, geom, payload, body_sha256, osm_tags,"
           " answer, target) VALUES (%s, %s, %s, 'n', %s, 1, %s, %s, current_date,"
           " ST_SetSRID(ST_MakePoint(0, 0), 2154), '{}', 'x', '{}', %s, %s)")  # fmt: skip
    mine, theirs = str(uuid.uuid4()), str(uuid.uuid4())
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET test = true WHERE id = %s", (tid,))
        cam, build = conn.execute("SELECT camera_id, (SELECT build_id FROM meta) FROM cameras"
                                  " ORDER BY 1 LIMIT 1").fetchone()  # fmt: skip
        conn.execute(ins, (mine, "verify", cam, int(cam[1:]), build, tid, "not_found", None))
        conn.execute(ins, (theirs, "agree", cam, int(cam[1:]), build, other, None, mine))
    monkeypatch.setattr("builtins.input", lambda prompt="": "tst")
    run(dsn, "delete", "tst")
    out = capsys.readouterr().out
    assert "1 contribution(s) deleted with it (a test account)" in out
    assert "1 contribution(s) of others about them deleted too" in out
    with psycopg.connect(dsn, autocommit=True) as conn:
        left = conn.execute("SELECT count(*) FROM contributions WHERE uuid IN (%s, %s)",
                            (mine, theirs)).fetchone()[0]  # fmt: skip
    assert left == 0


def test_reset_password_unlinks_openstreetmap(dsn, typed, capsys):
    """Whoever took the account over may have linked their OSM user for a way back in: a
    reset unlinks it, and says so."""
    typed += [TYPED, TYPED]
    run(dsn, "create", "osl")
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("UPDATE accounts SET osm_id = 9016016, osm_server = 'dev'"
                     " WHERE pseudonym = 'osl'")  # fmt: skip
    typed += ["another long password"] * 2
    run(dsn, "reset-password", "osl")
    assert "OpenStreetMap unlinked" in capsys.readouterr().out
    with psycopg.connect(dsn) as conn:
        row = conn.execute("SELECT osm_id, osm_server FROM accounts WHERE pseudonym = 'osl'")
        assert row.fetchone() == (None, None)
    typed += ["a third long password"] * 2
    run(dsn, "reset-password", "osl")  # nothing linked now: nothing said of OSM
    assert "OpenStreetMap" not in capsys.readouterr().out
