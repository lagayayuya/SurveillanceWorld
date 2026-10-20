"""A PostGIS database for the tests.

CI gives one (`TEST_DSN`, a PostGIS service container). Locally the tests make a throwaway
cluster: initdb and pg_ctl in a temporary folder, on a free port, destroyed at the end; no
brew service is started and no existing cluster is touched. The binaries come from
`PG_BIN`, else from the first `pg_config` on PATH or in Homebrew whose server has PostGIS.
Without either the tests skip, unless REQUIRE_PG=1 (CI), where they fail.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path


def _candidates() -> list[Path]:
    if os.environ.get("PG_BIN"):
        return [Path(os.environ["PG_BIN"])]
    found = []
    on_path = shutil.which("pg_config")
    if on_path:
        found.append(Path(on_path).parent)
    found += sorted(Path("/opt/homebrew/opt").glob("postgresql@*/bin"), reverse=True)
    return found


def postgis_bin() -> Path | None:
    """Folder of initdb / pg_ctl for a server that has the PostGIS extension."""
    for bindir in _candidates():
        pg_config = bindir / "pg_config"
        if not pg_config.exists():
            continue
        share = subprocess.run(
            [str(pg_config), "--sharedir"], capture_output=True, text=True
        ).stdout.strip()
        if (Path(share) / "extension" / "postgis.control").exists():
            return bindir
    return None


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _reap(bindir: Path) -> None:
    """Stop and remove clusters whose owner died without cleaning up (killed by a signal
    that skipped the `finally`, e.g. a dev server stopped from outside)."""
    for tmp in Path(tempfile.gettempdir()).glob("lacarte-pg-*"):
        owner = tmp / "owner.pid"
        try:
            pid = int(owner.read_text())
        except (OSError, ValueError):
            continue
        if _alive(pid):
            continue
        subprocess.run([str(bindir / "pg_ctl"), "-D", str(tmp / "data"), "-m", "immediate",
                        "stop"], capture_output=True)  # fmt: skip
        shutil.rmtree(tmp, ignore_errors=True)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def database():
    """Yield a libpq DSN of an empty database where PostGIS can be created."""
    if os.environ.get("TEST_DSN"):
        yield os.environ["TEST_DSN"]
        return
    bindir = postgis_bin()
    if bindir is None:
        raise LookupError("no PostgreSQL with PostGIS (set PG_BIN or TEST_DSN)")
    _reap(bindir)
    tmp = Path(tempfile.mkdtemp(prefix="lacarte-pg-"))
    (tmp / "owner.pid").write_text(str(os.getpid()))
    data, port = tmp / "data", _free_port()
    env = {**os.environ, "LC_ALL": "C"}
    run = {"check": True, "capture_output": True, "env": env}
    subprocess.run(
        [str(bindir / "initdb"), "-D", str(data), "-U", "test", "--auth=trust", "-E", "UTF8"],
        **run,
    )
    opts = f"-p {port} -k {tmp} -c listen_addresses='' -c fsync=off"
    subprocess.run(
        [str(bindir / "pg_ctl"), "-D", str(data), "-o", opts, "-l", str(tmp / "log"), "-w",
         "start"],
        **run,
    )  # fmt: skip
    try:
        subprocess.run(
            [str(bindir / "createdb"), "-h", str(tmp), "-p", str(port), "-U", "test", "lacarte"],
            **run,
        )
        # psql of the same version first on PATH, for db/load.sh and the migrations.
        os.environ["PATH"] = f"{bindir}{os.pathsep}{os.environ['PATH']}"
        yield f"host={tmp} port={port} user=test dbname=lacarte"
    finally:
        subprocess.run([str(bindir / "pg_ctl"), "-D", str(data), "-m", "immediate", "stop"],
                       capture_output=True, env=env)  # fmt: skip
        shutil.rmtree(tmp, ignore_errors=True)
