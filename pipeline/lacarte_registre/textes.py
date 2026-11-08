"""The texts' repairs at the build (rules/registre_textes.yaml): the titles and objets as
their publishers garbled them (an apostrophe turned into « ? »), mended in the documents and
the affaires before any page or the search reads them."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

FIELDS = ("titre", "objet")


def regles(rules_dir: Path) -> list[tuple[re.Pattern[str], str]]:
    doc = yaml.safe_load((rules_dir / "registre_textes.yaml").read_text("utf-8"))
    return [(re.compile(r["motif"]), r["par"]) for r in doc["apostrophes"]["remplacements"]]


def reparer(text: str, rules: list[tuple[re.Pattern[str], str]]) -> str:
    for pat, by in rules:
        text = pat.sub(by, text)
    return text


def appliquer(records: list[dict[str, Any]], rules: list[tuple[re.Pattern[str], str]]) -> int:
    """Mend the records' titles and objets in place; the number of records changed."""
    n = 0
    for r in records:
        changed = False
        for k in FIELDS:
            v = r.get(k)
            if isinstance(v, str) and "?" in v and (w := reparer(v, rules)) != v:
                r[k], changed = w, True
        n += changed
    return n
