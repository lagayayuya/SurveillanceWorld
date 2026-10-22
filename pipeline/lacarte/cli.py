"""One command: `lacarte build --region NAME` runs every stage from the .osm.pbf (a region
in parts, France: its parts' stages, then their merge; merge.py).
`lacarte calibrate` rewrites the optical distributions of rules/optics.yaml from the
catalogue (a rules change, reviewed and committed like any other).
`lacarte db migrate|load` manage the participation database (db.py).
`lacarte audit --region NAME` measures the streets tiles and filters (streetaudit.py).
`lacarte contrib export` writes the validated contributions the build applies, `lacarte contrib
report` compares a contributed build with the one before (contrib.py).
`lacarte accounts create|reset-password|disable|enable|delete|list` manage the accounts
(lacarte/api/accounts.py, also run on the server as `python -m lacarte.api.accounts`).
`lacarte hidden add|remove|list` the cameras every build leaves out (lacarte/api/hidden.py,
on the server `python -m lacarte.api.hidden`).
`lacarte osm sync --once` runs one pass of the OSM synchronisation (lacarte/api/sync.py; the
API's thread runs the others).
A build holds the machine's lock (lock.py), as the gate and the deploy do: taken, it stops."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from lacarte import (
    admin,
    apply,
    calibrate,
    exposure,
    extract,
    lock,
    merge,
    normalize,
    regions,
    review,
    tiles,
    views,
)

# A region built in parts (merge.py): its own stages.
AGGREGATE_STAGES = merge.STAGES
STAGES = {
    "extract": extract.run,
    "normalize": normalize.run,
    "apply": apply.run,
    "views": views.run,
    "exposure": exposure.run,
    "qa": review.run,
    "admin": admin.run,
    "tiles": tiles.run,
    "tiles_stats": tiles.run_stats,
}


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["accounts"]:
        from lacarte.api import accounts

        raise SystemExit(accounts.main(argv[1:], prog="lacarte accounts"))
    if argv[:1] == ["hidden"]:
        from lacarte.api import hidden

        raise SystemExit(hidden.main(argv[1:], prog="lacarte hidden"))
    if argv[:1] == ["osm"]:
        from lacarte.api import sync

        raise SystemExit(sync.main(argv[1:], prog="lacarte osm"))
    parser = argparse.ArgumentParser(prog="lacarte")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("accounts", help="accounts: create, reset-password, disable, enable, delete,"
                                    " list (lacarte accounts --help)")  # fmt: skip
    sub.add_parser("hidden", help="hidden cameras: add, remove, list (lacarte hidden --help)")
    sub.add_parser("osm", help="one pass of the OSM synchronisation: lacarte osm sync --once")
    build = sub.add_parser("build", help="run the pipeline for a region")
    build.add_argument("--region", required=True)
    starts = list(dict.fromkeys([*STAGES, *AGGREGATE_STAGES]))
    build.add_argument("--from", dest="start", choices=starts)
    build.add_argument("--only", choices=list(STAGES))
    build.add_argument(
        "--resume", action="store_true", help="a region in parts: skip the parts' stages done"
    )
    sub.add_parser("calibrate", help="optical distributions from catalogue/models.csv")
    audit = sub.add_parser("audit", help="streets tiles and filters against the filmed length")
    audit.add_argument("--region", required=True)
    audit.add_argument("--skip-tiles", action="store_true")
    dbp = sub.add_parser("db", help="participation database (PostGIS)")
    dbp.add_argument("action", choices=["migrate", "load"])
    dbp.add_argument("--region")
    dbp.add_argument("--dsn", help="libpq connection string (default: PG* environment)")
    dbp.add_argument("--to-dir", type=Path, help="load: write the export here, load nothing")
    cp = sub.add_parser("contrib", help="validated contributions for the build")
    cp.add_argument("action", choices=["export", "report", "check-test", "check-fresh"])
    cp.add_argument("--dsn", help="a local database (default: DB_DSN over ssh DEPLOY_TARGET)")
    cp.add_argument(
        "--region",
        help="report: the contributed build; export: a region covering"
        " the database's (France after the Île-de-France)",
    )
    cp.add_argument("--before", type=Path, help="report: the build without contributions")
    bm = sub.add_parser("basemap", help="the self-hosted basemap: strip layers from its archive")
    bm.add_argument("action", choices=["strip"])
    bm.add_argument("src", type=Path)
    bm.add_argument("dst", type=Path)
    bm.add_argument("--drop", action="append", required=True, help="a layer to drop (repeat)")
    bm.add_argument(
        "--names", nargs="+", metavar="LANG", help="keep the names in these languages only"
    )
    args = parser.parse_args(argv)
    if args.cmd == "basemap":
        from lacarte import basemap

        basemap.main(str(args.src), str(args.dst), args.drop, args.names)
        return
    if args.cmd == "contrib":
        from lacarte import contrib

        if args.action == "report":
            if not (args.region and args.before):
                parser.error("contrib report needs --region and --before")
            rep = contrib.report(regions.load(args.region), args.before)
            print(json.dumps(rep, ensure_ascii=False, indent=1))
            return
        ssh = None if args.dsn else os.environ.get("DEPLOY_TARGET")
        if not args.dsn and not ssh:
            parser.error(f"contrib {args.action} needs --dsn or DEPLOY_TARGET (deploy/deploy.env)")
        if args.action == "check-fresh":
            if not args.region:
                parser.error("contrib check-fresh needs --region")
            stale = contrib.check_fresh(regions.load(args.region), args.dsn, ssh)
            if stale:
                raise SystemExit(f"the database's validated contributions or hidden cameras"
                                 f" differ from the export the build read ({', '.join(stale)}):"
                                 " lacarte contrib export, then build")  # fmt: skip
            print("the export is the database's: contributions and hidden cameras current")
            return
        if args.action == "check-test":
            if not args.region:
                parser.error("contrib check-test needs --region")
            n = contrib.check_test(regions.load(args.region), args.dsn, ssh)
            if n:
                raise SystemExit(f"{n} contribution(s) of a test account (TEST_AUTHORS) in the"
                                 " export or the build: export again, then build")  # fmt: skip
            print(f"no test account's contribution ({len(contrib.test_authors())} test account(s))")
            return
        print(json.dumps(contrib.export(args.dsn, ssh, args.region)))
        return
    if args.cmd == "db":
        from lacarte import db  # geopandas-free commands stay fast

        if args.action == "migrate":
            print("applied:", ", ".join(db.migrate(args.dsn)) or "nothing")
            return
        if not args.region:
            parser.error("db load needs --region")
        region = regions.load(args.region)
        out = args.to_dir or region.build_dir / "db"
        print(json.dumps(db.export(region, out)))
        if not args.to_dir:
            db.load(out, args.dsn)
        return
    if args.cmd == "calibrate":
        for kind, d in calibrate.run().items():
            print(kind, json.dumps(d, ensure_ascii=False))
        return

    if args.cmd == "audit":
        from lacarte import streetaudit

        print(streetaudit.run(regions.load(args.region), skip_tiles=args.skip_tiles))
        return

    region = regions.load(args.region)
    if region.parts:
        start = args.start or "cut"
        if start not in AGGREGATE_STAGES or args.only:
            parser.error(f"a region in parts builds from one of {', '.join(AGGREGATE_STAGES)}")
        try:
            with lock.held("lacarte " + " ".join(argv)):
                merge.build(region, start, resume=args.resume)
        except lock.Busy as e:
            parser.exit(3, f"lacarte build: {e}\n")
        return
    names = list(STAGES)
    start = args.start or "extract"
    if start not in names:
        parser.error(f"--from takes one of {', '.join(names)}")
    todo = [args.only] if args.only else names[names.index(start) :]
    if "extract" not in todo:
        from lacarte import extract

        applied = region.build_dir / extract.HIDDEN_APPLIED
        done = frozenset(applied.read_text().split()) if applied.exists() else frozenset()
        if done != regions.hidden(region):
            parser.error("the hidden cameras changed since the extract: build from extract")
    timings_path = region.build_dir / "timings.json"
    timings = json.loads(timings_path.read_text()) if timings_path.exists() else {}
    try:
        with lock.held("lacarte " + " ".join(argv)):
            for name in todo:
                t0 = time.perf_counter()
                STAGES[name](region)
                timings[name] = round(time.perf_counter() - t0, 2)
                print(f"{name}: {timings[name]} s", flush=True)
                region.build_dir.mkdir(parents=True, exist_ok=True)
                timings_path.write_text(json.dumps(timings, indent=2))
    except lock.Busy as e:
        parser.exit(3, f"lacarte build: {e}\n")


if __name__ == "__main__":
    main()
