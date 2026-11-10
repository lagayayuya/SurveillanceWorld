"""A name as the pages show it (rules/registre_noms.yaml): a company's from SIRENE's capitals,
a beneficiary's from the DGCL's capitalised words; acronyms kept, accents put back, small words
in lower case. The source's name is kept beside it."""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path
from typing import Any

import yaml

VOYELLES = set("AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜ")
MOT = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ0-9]+|[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+")


@cache
def regles(rules_dir: Path) -> dict[str, Any]:
    conf = yaml.safe_load((rules_dir / "registre_noms.yaml").read_text("utf-8"))["casse"]
    return {
        "sigles": {s.upper() for s in conf["sigles"]},
        "noms": {k.upper(): v for k, v in (conf.get("noms") or {}).items()},
        "petits": {m.lower() for m in conf["minuscules"]},
        "accents": {k.lower(): v for k, v in conf["accents"].items()},
        "usuels": {str(k): v for k, v in (conf.get("usuels") or {}).items()},
    }


def _mot(w: str, first: bool, after_elision: bool, conf: dict[str, Any], caps: bool) -> str:
    up, low = w.upper(), w.lower()
    if up in conf["noms"]:
        return conf["noms"][up]
    if caps and (up in conf["sigles"] or (len(w) > 1 and not set(up) & VOYELLES and w.isalpha())):
        return up
    if w.isdigit():
        return w
    if not first and not after_elision and low in conf["petits"]:
        return low
    word = conf["accents"].get(low, low)
    if after_elision and not caps and w[:1].islower():
        return word  # the DGCL's « D'agglomeration »: its own lower case kept
    return word[:1].upper() + word[1:]


def afficher(nom: str | None, rules_dir: Path, siren: str | None = None) -> str | None:
    """The display form of `nom`: the usual name when listed, else by the rules; None stays."""
    if not nom:
        return nom
    conf = regles(rules_dir)
    if siren and siren in conf["usuels"]:
        return conf["usuels"][siren]
    caps = nom.upper() == nom  # SIRENE's capitals: its short words may be acronyms
    toks = MOT.findall(nom)
    out: list[str] = []
    first = True
    for i, tok in enumerate(toks):
        if not tok[0].isalnum():
            out.append(tok)
            continue
        apos = i + 1 < len(toks) and toks[i + 1] in ("'", "’")
        nxt = toks[i + 2] if i + 2 < len(toks) else ""
        elided = i >= 2 and toks[i - 1] in ("'", "’") and toks[i - 2].lower() in ("d", "l")
        if apos and tok.lower() in ("d", "l") and not first:
            # « D'AZUR », « D'agglomeration »: the article in lower case; the DGCL's
            # « L'Isle-Adam » (its next word capitalised) is a name's own article, kept
            word = tok if not caps and nxt[:1].isupper() else tok.lower()
        else:
            word = _mot(tok, first, elided, conf, caps)
        out.append(word)
        first = False
    return "".join(out)


@cache
def renommages(rules_dir: Path) -> dict[str, dict[str, Any]]:
    """{a former SIREN: its rename} and {the current SIREN: the same}, each with both numbers
    (rule:registre_noms@1:renommages)."""
    doc = yaml.safe_load((rules_dir / "registre_noms.yaml").read_text("utf-8"))
    out: dict[str, dict[str, Any]] = {}
    for r in (doc.get("renommages") or {}).get("acheteurs") or []:
        row = {**r, "sirens": [r["nouveau"], r["ancien"]]}
        out[r["ancien"]] = out[r["nouveau"]] = row
    return out
