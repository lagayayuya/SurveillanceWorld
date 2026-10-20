"""Hidden cameras, by hand: the owner adds a camera to the list the build leaves out of
every output, removes it, lists them (an administrator does the same in /revue's
« Retraits », lot 2, journalled; this CLI is not). On the server, as the deploy user (the
tables' owner), from the API release, as the accounts CLI:

    cd /srv/preview/api/current
    PYTHONPATH=pipeline .venv/bin/python -m lacarte.api.hidden list

Locally: `lacarte hidden …` (the same commands). The database: --dsn, else DB_DSN, else
`dbname=preview`. A camera's id is an OSM element's (n123, w456, r789) or an added
camera's (c and 12 hex), as the map's sheet links it. The table (migration 018) keeps the
id and the day it was added, nothing else. `lacarte contrib export` writes the list for
the build, which leaves those cameras out from its first stage: the camera goes at the next
build and deploy. The API serves the list to administrators only (GET /api/review/hidden),
and leaves those cameras out of the proposals it shows and of « À publier ».
"""

from __future__ import annotations

import argparse
import os
import sys

import psycopg

from lacarte.regions import CAMERA_ID


def connect(dsn: str):
    return psycopg.connect(dsn, autocommit=True)


def checked(camera_id: str) -> str:
    camera_id = camera_id.strip()
    if not CAMERA_ID.fullmatch(camera_id):
        raise SystemExit("refused: a camera id is n123, w456, r789 or c and 12 hex")
    return camera_id


def where(conn, camera_id: str) -> str:
    """What the database knows of the camera: in the served build, an add, or neither (a
    typo, or a camera of another build)."""
    if conn.execute("SELECT 1 FROM cameras WHERE camera_id = %s", (camera_id,)).fetchone():
        return "in the served build"
    if conn.execute("SELECT 1 FROM contributions WHERE camera_id = %s AND kind = 'add'",
                    (camera_id,)).fetchone():  # fmt: skip
        return "an added camera, not in the served build"
    return "unknown to the served build and to the contributions: check the id"


def add(conn, camera_id: str) -> None:
    camera_id = checked(camera_id)
    done = conn.execute("INSERT INTO hidden_cameras (camera_id) VALUES (%s)"
                        " ON CONFLICT DO NOTHING", (camera_id,)).rowcount  # fmt: skip
    state = "hidden" if done else "already hidden"
    print(f"{camera_id} {state} ({where(conn, camera_id)}); gone from the map at the next"
          " build and deploy")  # fmt: skip


def remove(conn, camera_id: str) -> None:
    camera_id = checked(camera_id)
    done = conn.execute("DELETE FROM hidden_cameras WHERE camera_id = %s", (camera_id,)).rowcount
    if not done:
        raise SystemExit(f"{camera_id} is not hidden")
    print(f"{camera_id} no longer hidden; back on the map at the next build and deploy")


def listing(conn) -> None:
    rows = conn.execute(
        "SELECT camera_id, added_on::text FROM hidden_cameras ORDER BY added_on, camera_id"
    ).fetchall()
    for camera_id, added_on in rows:
        print(f"{camera_id}  {added_on}")
    print(f"{len(rows)} hidden camera(s)")


def parser(prog: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=prog, description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)  # fmt: skip
    p.add_argument("--dsn", help="libpq connection string (default: DB_DSN, else dbname=preview)")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("add", help="hide a camera from the next build on").add_argument("camera_id")
    sub.add_parser("remove", help="show it again from the next build on").add_argument("camera_id")
    sub.add_parser("list", help="the hidden cameras and the day each was added")
    return p


def main(argv: list[str] | None = None, prog: str = "python -m lacarte.api.hidden") -> int:
    args = parser(prog).parse_args(argv)
    dsn = args.dsn or os.environ.get("DB_DSN") or "dbname=preview"
    with connect(dsn) as conn:
        if args.command == "add":
            add(conn, args.camera_id)
        elif args.command == "remove":
            remove(conn, args.camera_id)
        else:
            listing(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
