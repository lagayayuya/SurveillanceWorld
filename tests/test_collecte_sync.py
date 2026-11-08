"""deploy/collecte-sync.sh rapatrier: the server's derived files land in the main checkout's
data folder, from a worktree too (2026-11-08: run from a worktree, they landed in its own
data/, which no build reads). rsync and ssh are stubs that only write their arguments."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "deploy" / "collecte-sync.sh"


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_rapatrier_writes_to_the_main_checkout_from_a_worktree(tmp_path):
    main = tmp_path / "la-carte"
    (main / "deploy").mkdir(parents=True)
    shutil.copy(SCRIPT, main / "deploy" / SCRIPT.name)
    _git(main, "init", "-q")
    _git(main, "add", "-A")
    _git(main, "-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-qm", "s")
    tree = tmp_path / "la-carte-r5"
    _git(main, "worktree", "add", "-q", "-b", "r5", str(tree))
    stubs = tmp_path / "bin"
    stubs.mkdir()
    log = tmp_path / "rsync.args"
    for name in ("rsync", "ssh"):
        (stubs / name).write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{log}"\n')
        (stubs / name).chmod(0o755)
    env = {**os.environ, "PATH": f"{stubs}:{os.environ['PATH']}", "DEPLOY_TARGET": "h"}
    for cwd in (tree, tree / "deploy", main):
        log.write_text("")
        out = subprocess.run(
            ["bash", "deploy/collecte-sync.sh" if cwd != tree / "deploy" else "./collecte-sync.sh",
             "rapatrier"], cwd=cwd, env=env, check=True, capture_output=True, text=True,
        )  # fmt: skip
        dest = log.read_text().splitlines()[-1]
        assert dest == f"{main.resolve()}/data/registre/collecte/", (cwd, out.stdout)
    assert (main / "data" / "registre" / "collecte").is_dir()
    assert not (tree / "data").exists()
