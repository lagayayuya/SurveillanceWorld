"""Every document a registre build wrote, read back from its search rows
(recherche.tsv.gz beside the site: the files no longer hold every document in one)."""

from __future__ import annotations

import gzip
import json
import re
from pathlib import Path

from lacarte_registre import recherche


def _field(v: str) -> str:
    return re.sub(r"\\(.)", lambda m: {"t": "\t", "n": "\n", "r": "\r"}.get(m[1], m[1]), v)


def rows(site: Path) -> list[dict]:
    out = []
    with gzip.open(site.parent / "recherche.tsv.gz", "rt", encoding="utf-8") as g:
        for line in g:
            values = [_field(v) for v in line.rstrip("\n").split("\t")]
            out.append(dict(zip(recherche.COLUMNS, values, strict=True)))
    return out


def documents(site: Path) -> list[dict]:
    return [json.loads(r["doc"]) for r in rows(site)]
