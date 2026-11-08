"""The motive of a drone act read by rules (rules/registre_motifs.yaml): its title and its
article 1 folded, the purposes of L. 242-5 and a few closing phrases removed, then the first
class whose words match. A class is served only when its hand-read measure passed
(`publie`); the model's reading, when there is one, comes first (collecte.act_event)."""

from __future__ import annotations

import re
import unicodedata
from functools import cache
from pathlib import Path
from typing import Any

import yaml

FILE = "registre_motifs.yaml"


def fold(s: str | None) -> str:
    """Lower case, no accent and no other non-ASCII character, any run of spaces as one: the
    text the rule's words were measured on."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s)


@cache
def regles(rules_dir: Path) -> dict[str, Any]:
    conf = yaml.safe_load((rules_dir / FILE).read_text("utf-8"))
    noise = [p for r in conf["retirer"] for p in r["motifs"]]
    gap = conf["melange_fete_apres_manifestation"]
    return {
        "retirer": re.compile("|".join(noise)),
        "classes": [(c["id"], re.compile(c["mots"]), bool(c["publie"])) for c in conf["classes"]],
        "melange": re.compile(rf"manifestation[^.;|]{{0,{gap}}}$"),
    }


def classe(titre: str | None, article_1: str | None, rules_dir: Path) -> str | None:
    """The act's class, served or not, or None (« non lu »)."""
    conf = regles(rules_dir)
    text = conf["retirer"].sub(" ", fold(f"{titre or ''} | {article_1 or ''}"))
    for k, words, _ in conf["classes"]:
        m = words.search(text)
        if not m:
            continue
        # a fête right after an unqualified « manifestation » is a mixed motive
        if k == "concert_fete" and conf["melange"].search(text[: m.start()]):
            return None
        return k
    return None


def motif(a: dict[str, Any], rules_dir: Path) -> dict[str, Any] | None:
    """{categorie, libelle, origine} for a drone act whose class is served, else None."""
    k = classe(a.get("titre"), (a.get("champs") or {}).get("article_1"), rules_dir)
    if k is None or not dict((c, p) for c, _, p in regles(rules_dir)["classes"])[k]:
        return None
    return {"categorie": k, "libelle": None, "origine": "regles"}
