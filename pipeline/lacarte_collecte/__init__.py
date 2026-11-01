"""The registre's national collection: prefectoral acts, BOAMP notices and subsidies, for all of
France. A package of its own, beside lacarte_registre (which it uses for the network,
`fetch.py`, and the notices' cleaning, `boamp.py`): it runs on the server, never on the
machine that builds and deploys, and writes files that `lacarte-registre construire` reads.

- Sources are modules (`dila`, `dgcl`, `regions`, `attrap`, `pdf`, `parcours`), each with
  `collect(ctx)`; act types are rules (rules/collecte_actes.yaml) and readers (`lecteur`).
- State: one file per source and administration (etat.py), written at each step, so that a
  cut run goes on where it stopped (`--resume` is the default: a run always resumes) and a
  replay rewrites the same records under the same ids (no duplicate).
- Kept: no PDF, no raw text with a natural person, no notice before it is cleaned; only the
  records (store.py, one JSON line per id) and, in SORTIE, the derived files construire
  reads, the coverage and the collection's report.

Where: LACARTE_COLLECTE_DIR (states, records, the network's caches and journal; default
data/registre/collecte-travail) and LACARTE_COLLECTE_SORTIE (the derived files; default
data/registre/collecte, where `deploy/collecte-sync.sh rapatrier` puts them on the Mac).
"""

from __future__ import annotations

import os
from pathlib import Path

import lacarte_registre as registre

ROOT = Path(os.environ.get("LACARTE_COLLECTE_DIR") or registre.ROOT / "collecte-travail")
SORTIE = Path(os.environ.get("LACARTE_COLLECTE_SORTIE") or registre.ROOT / "collecte")
RULES = registre.RULES
