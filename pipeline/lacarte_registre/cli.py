"""`lacarte-registre collecter [--source S] [--resume]` collects the national public procurement
from its sources (collecter.py, the network through fetch.py only), under the machine's lock;
`lacarte-registre importer-pilote [DIR]` reads the registre's pilot export (importer.py), DIR
or LACARTE_REGISTRE_PILOTE; `lacarte-registre construire [--dsn DSN | --ssh HOST |
--sans-corrections]` exports the corrections /revue accepted, then writes its site files, under
the machine's lock (construire.py); `lacarte-registre verifier` says whether the built site may
be deployed;
`lacarte-registre corrections exporter [--dsn DSN | --ssh HOST]` writes the corrections alone
(exporter.py).

A command of its own, beside `lacarte`: the map's build id covers every source of the lacarte
package (buildinfo.py), its command line included, and the deploy refuses a build made by
other code; the registre lives outside that package, so that adding to it never asks for the
map to be built again."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import lacarte_registre as registre
from lacarte_registre import collecter, construire, exporter, fetch, importer, pages, regles


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="lacarte-registre", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    col = sub.add_parser(
        "collecter", help="collect the national public procurement (collecter.py), under the lock"
    )
    col.add_argument("--source", choices=collecter.SOURCES, action="append",
                     help="one source (repeat for several; default: all, in order)")  # fmt: skip
    col.add_argument("--resume", action="store_true", help="go on from where a run stopped")
    col.add_argument("--departement", action="append",
                     help="only these départements (a partial collection, for a test)")  # fmt: skip
    imp = sub.add_parser("importer-pilote", help="read the pilot export (importer.py)")
    imp.add_argument(
        "dir",
        nargs="?",
        type=Path,
        help=f"the pilot export's folder (default: {registre.PILOTE_ENV})",
    )
    con = sub.add_parser(
        "construire",
        help="export the corrections accepted in /revue, then write the site's files "
        "(construire.py), under the lock",
    )
    src = con.add_mutually_exclusive_group()
    src.add_argument("--dsn", help="the corrections from a local database")
    src.add_argument(
        "--ssh", help="the corrections from the server, over ssh (default: DEPLOY_TARGET)"
    )
    src.add_argument("--sans-corrections", action="store_true",
                     help="build without the database's corrections (never deployed)")  # fmt: skip
    sub.add_parser("verifier", help="whether the built site may be deployed (deploy.sh)")
    pag = sub.add_parser("pages", help="the records' entry pages into the web build (pages.py)")
    pag.add_argument("shell", type=Path, help="the built map's page (web/dist/index.html)")
    pag.add_argument("out", type=Path, help="the web build's folder (web/dist)")
    pag.add_argument("--site", required=True, help="the site's address (VITE_SITE_URL)")
    cor = sub.add_parser("corrections", help="the corrections accepted in /revue (exporter.py)")
    cor.add_argument("action", choices=["exporter"])
    where = cor.add_mutually_exclusive_group()
    where.add_argument("--dsn", help="a local database (libpq connection string)")
    where.add_argument("--ssh", help="the server, over ssh (default: DEPLOY_TARGET)")
    args = parser.parse_args(argv)
    if args.cmd == "collecter":
        try:
            summary = collecter.main(
                sources=tuple(args.source or collecter.SOURCES),
                resume=args.resume,
                departements=set(args.departement) if args.departement else None,
            )
        except (fetch.NoContact, fetch.Blocked, fetch.Forbidden, fetch.Failed) as e:
            parser.exit(2, f"lacarte-registre collecter: {e}\n")
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        return
    if args.cmd == "construire":
        ssh = None if args.dsn else (args.ssh or os.environ.get("DEPLOY_TARGET"))
        try:
            summary = construire.main(dsn=args.dsn, ssh=ssh, sans_corrections=args.sans_corrections)
        except (regles.CorrectionError, construire.NoDatabase) as e:
            parser.exit(2, f"lacarte-registre construire: {e}\n")
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        return
    if args.cmd == "pages":
        try:
            n = pages.run(args.shell, registre.ROOT / "site", args.out, args.site)
        except (ValueError, FileNotFoundError) as e:
            parser.exit(2, f"lacarte-registre pages: {e}\n")
        print(f"lacarte-registre pages: {n} entry pages")
        return
    if args.cmd == "verifier":
        why = construire.verifier()
        if why:
            parser.exit(2, f"lacarte-registre verifier: {why}\n")
        print("lacarte-registre verifier: built with the database's corrections")
        return
    if args.cmd == "corrections":
        ssh = None if args.dsn else (args.ssh or os.environ.get("DEPLOY_TARGET"))
        if not args.dsn and not ssh:
            parser.error("corrections exporter needs --dsn, --ssh or DEPLOY_TARGET")
        print(json.dumps(exporter.export(args.dsn, ssh), ensure_ascii=False, indent=1))
        return
    if args.cmd == "importer-pilote":
        folder = args.dir or os.environ.get(registre.PILOTE_ENV)
        if not folder:
            parser.error(f"importer-pilote needs DIR or {registre.PILOTE_ENV}")
        try:
            manifest = importer.run(Path(folder))
        except (FileNotFoundError, importer.NotPilotFile) as e:
            parser.exit(2, f"lacarte-registre importer-pilote: {e}\n")
        print(json.dumps(manifest, ensure_ascii=False, indent=1))
