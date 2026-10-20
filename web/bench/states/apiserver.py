"""tests/apiserver.py, with its throwaway database's DSN written to a file, for
web/bench/shots-states.mjs: the captures empty the contributions between states, and play
what a deploy does after a build (db/settle.sh: the build's outcome written as the tables'
owner), which the API alone never does. Nothing else changes: same database, same API.

    uv run python web/bench/states/apiserver.py --dsn-file PATH [tests/apiserver.py's options]

The file holds two lines: the libpq DSN, then the folder of the PostgreSQL binaries (psql)
of that cluster, empty when the database comes from TEST_DSN.
"""

from __future__ import annotations

import contextlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests"))

import apiserver  # noqa: E402
import pgcluster  # noqa: E402


def main() -> None:
    argv = sys.argv[1:]
    at = argv.index("--dsn-file")
    target = Path(argv[at + 1])
    del argv[at : at + 2]
    sys.argv = [sys.argv[0], *argv]
    database = pgcluster.database

    @contextlib.contextmanager
    def written():
        with database() as dsn:
            bindir = pgcluster.postgis_bin()
            target.write_text(f"{dsn}\n{bindir or ''}\n")
            yield dsn

    pgcluster.database = written
    apiserver.main()


if __name__ == "__main__":
    main()
