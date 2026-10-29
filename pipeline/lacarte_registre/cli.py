"""`lacarte-registre importer-pilote [DIR]` reads the registre's pilot export (importer.py), DIR
or LACARTE_REGISTRE_PILOTE; `lacarte-registre construire` writes its site files, under the
machine's lock (construire.py); `lacarte-registre corrections exporter [--dsn DSN | --ssh HOST]`
writes the corrections /revue accepted, which construire applies (exporter.py).

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
from lacarte_registre import construire, exporter, importer, regles


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="lacarte-registre", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    imp = sub.add_parser("importer-pilote", help="read the pilot export (importer.py)")
    imp.add_argument(
        "dir",
        nargs="?",
        type=Path,
        help=f"the pilot export's folder (default: {registre.PILOTE_ENV})",
    )
    sub.add_parser("construire", help="write the site's files (construire.py), under the lock")
    cor = sub.add_parser("corrections", help="the corrections accepted in /revue (exporter.py)")
    cor.add_argument("action", choices=["exporter"])
    where = cor.add_mutually_exclusive_group()
    where.add_argument("--dsn", help="a local database (libpq connection string)")
    where.add_argument("--ssh", help="the server, over ssh (default: DEPLOY_TARGET)")
    args = parser.parse_args(argv)
    if args.cmd == "construire":
        try:
            summary = construire.main()
        except regles.CorrectionError as e:
            parser.exit(2, f"lacarte-registre construire: {e}\n")
        print(json.dumps(summary, ensure_ascii=False, indent=1))
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
