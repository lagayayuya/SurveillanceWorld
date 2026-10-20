"""`make rehearse DUMP=…`: db/rehearse_migrations.sh on a throwaway local PostgreSQL with
PostGIS (tests/pgcluster.py: the tests' own; TEST_DSN when set), its binaries first on PATH
so that pg_restore matches the server."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))

import pgcluster  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: make rehearse DUMP=path/to/copy.dump")
    env = dict(os.environ)
    bindir = pgcluster.postgis_bin()
    if bindir is not None:
        env["PATH"] = f"{bindir}{os.pathsep}{env['PATH']}"
    with pgcluster.database() as dsn:
        subprocess.run([str(ROOT / "db" / "rehearse_migrations.sh"), sys.argv[1], dsn],
                       check=True, env=env)  # fmt: skip
