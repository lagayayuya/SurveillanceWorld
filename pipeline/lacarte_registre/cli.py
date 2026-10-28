"""`lacarte-registre importer-pilote [DIR]` reads the registre's pilot export (importer.py), DIR
or LACARTE_REGISTRE_PILOTE.

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
from lacarte_registre import importer


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
    args = parser.parse_args(argv)
    if args.cmd == "importer-pilote":
        folder = args.dir or os.environ.get(registre.PILOTE_ENV)
        if not folder:
            parser.error(f"importer-pilote needs DIR or {registre.PILOTE_ENV}")
        try:
            manifest = importer.run(Path(folder))
        except (FileNotFoundError, importer.NotPilotFile) as e:
            parser.exit(2, f"lacarte-registre importer-pilote: {e}\n")
        print(json.dumps(manifest, ensure_ascii=False, indent=1))
