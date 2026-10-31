"""The participation API on a throwaway database, for development and the smoke tests.

    uv run python tests/apiserver.py --region ci [--port 8791] [--origin URL]
        [--registre data/registre/recherche.tsv.gz]

Makes a PostGIS cluster (tests/pgcluster.py; TEST_DSN in CI), applies the migrations,
loads the region's build (`lacarte db load`, its files in a temporary folder: the build is
only read), creates the bench's fictitious accounts (--accounts, the reviewers among them
--review-user, the administrators --admin-user, `rev` by default: migration 020; all with
web/bench/session.mjs's BENCH_PASSWORD; a reviewer or an administrator signs in by POST
/api/review/session, /api/session refuses them), then serves the API on
127.0.0.1 as the server does: no proxy headers, no access log, no Server header; the
session cookie is the local one (`session`, no Secure: http://localhost).
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pgcluster  # noqa: E402
import uvicorn  # noqa: E402

from lacarte import db, regions  # noqa: E402

# Every account the bench signs in as (the states' catalogue, the seed, the smokes, `make
# try`), and their one password: fictitious, a throwaway database's (web/bench/session.mjs).
BENCH_ACCOUNTS = "ana,bob,cara,dan,eve,fay,gil,hal,rev,tess,ivo,joe"
BENCH_PASSWORD = "bench-password-not-a-secret"


def bench_accounts(dsn: str, names: list[str], reviewers: set[str],
                   admins: frozenset[str] = frozenset()) -> None:  # fmt: skip
    """The accounts, with BENCH_PASSWORD hashed at a low argon2 cost (signing in is checked
    with the hash's own parameters: the bench signs in often); claimed when they exist."""
    from datetime import date

    import psycopg
    from argon2 import PasswordHasher

    hashed = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(BENCH_PASSWORD)
    with psycopg.connect(dsn, autocommit=True) as conn:
        for name in names:
            role = ("admin" if name in admins else "reviewer" if name in reviewers
                    else "contributor")  # fmt: skip
            conn.execute(
                "INSERT INTO accounts (pseudonym, password_hash, role, created_month)"
                " VALUES (%s, %s, %s, %s) ON CONFLICT ((lower(pseudonym))) DO UPDATE"
                " SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,"
                " disabled = false",
                (name, hashed, role, date.today().replace(day=1)),
            )


def near_facade(dsn: str) -> dict:
    """An outdoor camera 3-30 m from the facade nearest to it, and a point 2 m off that
    facade on the camera's side: where the smoke test drags the reticle."""
    import psycopg
    from shapely import Point
    from shapely.ops import nearest_points

    from lacarte.api import live

    with psycopg.connect(dsn) as conn:
        ids = [r[0] for r in conn.execute(
            "SELECT camera_id FROM cameras WHERE NOT indoor ORDER BY camera_id")]  # fmt: skip
        for cid in ids:
            cam = live.camera(conn, cid)
            polys = live.buildings_near(conn, cam.x, cam.y, 30)
            pt = Point(cam.x, cam.y)
            if not polys:
                continue
            host = min(polys, key=lambda q: q.boundary.distance(pt))
            d = host.boundary.distance(pt)
            if host.contains(pt) or not 3 < d < 30:
                continue
            n = nearest_points(host.boundary, pt)[0]
            x, y = n.x + (pt.x - n.x) * 2 / d, n.y + (pt.y - n.y) * 2 / d
            ix, iy = n.x - (pt.x - n.x) * 2 / d, n.y - (pt.y - n.y) * 2 / d  # 2 m inside
            if not host.contains(Point(ix, iy)):
                continue
            return {"camera": cid, "mg": cam.mount_group, "at": live.to_lonlat(cam.x, cam.y),
                    "inside": live.to_lonlat(ix, iy),
                    "target": live.to_lonlat(x, y)}  # fmt: skip
    raise SystemExit("no camera near a facade")


def complete_cameras(dsn: str) -> dict:
    """Cameras for the "Compléter" smoke test (phase D2): one that gets the three
    questions (unknown type, operator unknown or private, no direction; no contribution in
    the CI fixture), the one the fixture says a private individual installed, and (phase
    D3) a tube without height and one with its height and tilt applied."""
    import psycopg

    from lacarte import regions
    from lacarte.api import live

    fixture = regions.ROOT / "tests" / "fixtures" / "contrib-ci.jsonl"
    rows = [json.loads(line) for line in fixture.read_text().splitlines() if line.strip()]
    touched = {r["camera_id"] for r in rows}
    household = next(r["camera_id"] for r in rows if r.get("answer") == "household")
    with psycopg.connect(dsn) as conn:
        three = next(
            cid for (cid,) in conn.execute(
                "SELECT camera_id FROM cameras WHERE NOT indoor AND kind_certainty = 'default'"
                " AND operator_class <> 'public' AND cardinality(directions) = 0"
                " ORDER BY camera_id")
            if cid not in touched
        )  # fmt: skip
        # Phase D3: the fixture's tube with a tilt but no height (its screen asks the height,
        # then the tilt) and the tube whose height and tilt applied (the sheet's chips).
        heights = {r["camera_id"] for r in rows if r["kind"] == "height"}
        tilts = {r["camera_id"] for r in rows if r["kind"] == "tilt"}
        tube = min(tilts - heights)
        mounted = min(tilts & heights)
        at = {c: live.to_lonlat(*(lambda k: (k.x, k.y))(live.camera(conn, c)))
              for c in (three, household, tube, mounted)}  # fmt: skip
    return {"three": {"camera": three, "at": at[three]},
            "household": {"camera": household, "at": at[household]},
            "tube": {"camera": tube, "at": at[tube]},
            "mounted": {"camera": mounted, "at": at[mounted]}}  # fmt: skip


def main() -> None:
    # A stop from outside (SIGTERM) must still run the cluster's cleanup.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    p = argparse.ArgumentParser()
    p.add_argument("--region", default="ci")
    p.add_argument("--port", type=int, default=8791)
    p.add_argument("--origin", default="http://localhost:4173")
    p.add_argument("--accounts", default=BENCH_ACCOUNTS, help="comma-separated pseudonyms")
    p.add_argument("--review-user", default="rev", help="the reviewers among them")
    p.add_argument(
        "--admin-user",
        default="rev",
        help="the administrators among them (an administrator also reviews)",
    )
    p.add_argument("--fixtures", type=Path, help="write a camera and a point near a facade")
    p.add_argument("--reset", action="store_true", help="empty the contributions first")
    p.add_argument(
        "--registre",
        type=Path,
        help="the register's search rows to load (data/registre/recherche.tsv.gz, lot R3)",
    )
    args = p.parse_args()
    region = regions.load(args.region)
    with pgcluster.database() as dsn:
        db.migrate(dsn)
        os.environ.update(LACARTE_DSN=dsn, ALLOWED_ORIGIN=args.origin, SESSION_COOKIE="local")
        # The benches' database is thrown away: its retention never needs to run, and a run
        # in the middle of a bench would fold the counters it seeded.
        os.environ.setdefault("RETENTION_THREAD", "off")
        reviewers = set(filter(None, args.review_user.split(",")))
        admins = frozenset(filter(None, args.admin_user.split(",")))
        names = sorted(set(args.accounts.split(",")) | reviewers | admins)
        bench_accounts(dsn, names, reviewers, admins)
        # The load files go to a folder of their own, removed once loaded: the build is only
        # read (several servers may start at once; data/build is the main session's).
        with tempfile.TemporaryDirectory(prefix="apiserver-") as out:
            db.export(region, Path(out))
            db.load(Path(out), dsn)
        if args.registre:
            import psycopg

            from lacarte_registre import recherche

            with psycopg.connect(dsn, autocommit=True) as conn:
                n = recherche.charger(conn, args.registre)
            print(f"registre: {n} documents in the search", flush=True)
        if args.reset:  # CI's database also served pytest
            import subprocess

            # CASCADE: what became of them on OSM (016's osm_publications) goes with them.
            subprocess.run(["psql", "-X", "-q", dsn, "-c", "TRUNCATE contributions CASCADE"],
                           check=True)  # fmt: skip
        from lacarte.api.app import app, settings

        settings.__init__()
        if args.fixtures:
            args.fixtures.write_text(
                json.dumps({**near_facade(dsn), "complete": complete_cameras(dsn)})
            )
        print(f"api ready on 127.0.0.1:{args.port}", flush=True)
        uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False,
                    proxy_headers=False, server_header=False, log_level="warning")  # fmt: skip


if __name__ == "__main__":
    main()
