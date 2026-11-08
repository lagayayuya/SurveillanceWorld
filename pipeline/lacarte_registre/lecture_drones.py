"""What a drone act's article 1 says, read by rules where no model read it
(rules/registre_drones.yaml `texte`): the service that flies (a name of the list), the
purposes of L. 242-5 it retains (the model's ids), and the sector in the act's own words.

The text layer of the prefectures' PDFs splits words and loses pieces: the service and the
purposes are matched on the folded text with its spaces removed, and nothing cut is
completed."""

from __future__ import annotations

import re
import unicodedata
from functools import cache
from pathlib import Path
from typing import Any

import yaml

SECTEUR = re.compile(
    r"(?:sont|est)\s+autoris\w*\s+(.{5,600}?)\s*(?:,\s*)?aux?\s+titres?\s+d", re.I | re.S
)
MAX_SECTEUR = 300


def serre(s: str | None) -> str:
    """Folded (lower case, no accent, typographic apostrophe as ') with no space at all."""
    s = (s or "").replace("’", "'")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", "", s)


@cache
def regles(rules_dir: Path) -> dict[str, Any]:
    conf = yaml.safe_load((rules_dir / "registre_drones.yaml").read_text("utf-8"))["texte"]
    return {
        "services": [(s["id"], s["libelle"], re.compile(s["motif"])) for s in conf["services"]],
        "finalites": [(k, re.compile(v)) for k, v in conf["finalites"].items()],
    }


def lire(article_1: str | None, rules_dir: Path) -> dict[str, Any]:
    """{service?, service_id?, finalites?, secteur?}: what was found, nothing else."""
    conf = regles(rules_dir)
    text = re.sub(r"\s+", " ", article_1 or "").strip()
    flat = serre(text)
    out: dict[str, Any] = {}
    for sid, label, pat in conf["services"]:
        if pat.search(flat):
            out["service"], out["service_id"] = label, sid
            break
    fins = [k for k, pat in conf["finalites"] if pat.search(flat)]
    if fins:
        out["finalites"] = fins
    if (m := SECTEUR.search(text)) and len(m.group(1)) <= MAX_SECTEUR:
        # « Tremblay-en- France », « Saint-Ouen-sur- Seine »: a hyphen's space dropped
        out["secteur"] = re.sub(r"-\s+", "-", m.group(1)).strip(" ,;:")
    return out


def champs(a: dict[str, Any], rules_dir: Path) -> dict[str, Any]:
    """The fields for a drone act of the family the rule was measured on (the police
    prefecture and the four départements of its agglomeration), nothing for another."""
    conf = yaml.safe_load((rules_dir / "registre_drones.yaml").read_text("utf-8"))
    if a.get("administration") not in conf["fin"]["famille_pp"]:
        return {}
    return lire((a.get("champs") or {}).get("article_1"), rules_dir)
