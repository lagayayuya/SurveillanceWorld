"""The registre: public documents on video surveillance (contracts, tender notices,
prefectoral acts, subsidies), beside the map. A package of its own, outside lacarte: the
map's build id covers that package's every source (lacarte/buildinfo.py), so a change here
never asks for the map to be built again.

Two commands, never run by the map's build:
- `lacarte-registre importer-pilote [DIR]` (importer.py) reads the pilot export, files of
  `window.NAME = <JSON>;` assignments, as JSON, and keeps one JSON file per global under
  data/registre/pilote/, with each source file's sha256;
- `lacarte-registre construire` (construire.py) applies the counting rules (regles.py) and
  writes, for each page, the subset of the data it reads (fermetures.py) and the coverage of
  each source (couverture.py) under data/registre/site/, in one rename.

A rule lives in one place, here: the web views read the flags written on each document
(`compte`, `copie`, `communal`...) and never recompute them. Nothing under data/ is versioned;
the pilot export's folder is given on the command line or by LACARTE_REGISTRE_PILOTE.
"""

from __future__ import annotations

from lacarte import regions

# Where the registre's files go; the tests point it at a temporary folder.
ROOT = regions.ROOT / "data" / "registre"
PILOTE_ENV = "LACARTE_REGISTRE_PILOTE"
RULES = regions.ROOT / "rules"
