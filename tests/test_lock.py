"""The machine's lock (lacarte/lock.py): one build, gate or deploy at a time."""

import json
import os
import subprocess
import sys

import pytest

from lacarte import lock


@pytest.fixture(autouse=True)
def lock_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("LACARTE_LOCK", str(tmp_path / "build.lock"))
    monkeypatch.delenv(lock.TOKEN_ENV, raising=False)
    monkeypatch.setenv("LACARTE_SESSION", "test-session")
    return tmp_path / "build.lock"


def test_taken_stops_at_once_and_says_by_whom(lock_dir):
    token = lock.acquire("lacarte build --region idf")
    info = json.loads((lock_dir / "owner.json").read_text())
    assert info["what"] == "lacarte build --region idf" and info["pid"] == os.getpid()
    assert info["session"] == "LACARTE_SESSION=test-session" and info["since"].endswith("Z")
    with pytest.raises(lock.Busy, match="lock taken: lacarte build --region idf"):
        lock.acquire("make smoke")
    assert lock.release(token) and not lock_dir.exists()
    assert lock.acquire("make smoke")


def test_a_holders_child_passes_and_does_not_release(monkeypatch, lock_dir):
    token = lock.acquire("deploy/deploy.sh")
    monkeypatch.setenv(lock.TOKEN_ENV, token)
    assert lock.acquire("lacarte build --region idf") is None
    assert not lock.release(None) and lock_dir.exists()
    assert not lock.release("another") and lock_dir.exists()


def test_an_abandoned_lock_is_said_and_lifted_by_hand_only(lock_dir):
    dead = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"],
                          capture_output=True, text=True, check=True)  # fmt: skip
    lock.acquire("lacarte build --region idf", pid=int(dead.stdout))
    with pytest.raises(lock.Busy, match="abandoned"):
        lock.acquire("make smoke")
    assert lock_dir.exists()  # never lifted by itself
    assert lock.lift_abandoned().startswith("lifted the abandoned lock")
    assert not lock_dir.exists()


def test_break_refuses_a_living_holder(lock_dir):
    lock.acquire("make smoke")
    with pytest.raises(lock.Busy, match="running process"):
        lock.lift_abandoned()
    assert lock_dir.exists()


def test_the_shell_side(lock_dir):
    def run(*args, env=None):
        env = {**os.environ, **(env or {})}
        return subprocess.run([sys.executable, "-m", "lacarte.lock", *args], capture_output=True,
                              text=True, env=env)  # fmt: skip

    got = run("acquire", "--pid", str(os.getpid()), "--what", "make smoke")
    token = got.stdout.strip()
    assert got.returncode == 0 and len(token) == 16
    busy = run("acquire", "--what", "deploy/deploy.sh")
    assert busy.returncode == 3 and "lock taken: make smoke" in busy.stderr
    assert run("acquire", "--what", "x", env={lock.TOKEN_ENV: token}).stdout.strip() == ""
    assert "held: make smoke" in run("status").stdout
    run("release", "--token", token)
    assert run("status").stdout.startswith("free")


def test_a_build_stops_when_the_lock_is_taken(capsys):
    from lacarte import cli

    lock.acquire("make smoke")
    with pytest.raises(SystemExit) as stop:
        cli.main(["build", "--region", "ci", "--only", "tiles_stats"])
    assert stop.value.code == 3 and "lock taken: make smoke" in capsys.readouterr().err
