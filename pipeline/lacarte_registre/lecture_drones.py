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


def plie(s: str | None) -> str:
    """Folded with its spaces: lower case, no accent, one space."""
    s = unicodedata.normalize("NFKD", (s or "").replace("’", "'"))
    return re.sub(r"\s+", " ", s.encode("ascii", "ignore").decode().lower()).strip()


@cache
def _aeronef(rules_dir: Path) -> tuple[re.Pattern[str], re.Pattern[str]]:
    conf = yaml.safe_load((rules_dir / "registre_drones.yaml").read_text("utf-8"))["aeronef"]
    return re.compile(conf["helicoptere"]), re.compile(conf["drone"])


def aeronef(textes: list[str | None], rules_dir: Path) -> str:
    """« drone », « helicoptere » or « non_lu » (rule:registre_drones@1:aeronef): the first
    of `textes` that names an aircraft decides (the title and article 1, then the act's
    own sentences naming one)."""
    heli, drone = _aeronef(rules_dir)
    for t in textes:
        t = plie(t)
        if drone.search(t):
            return "drone"
        if heli.search(t):
            return "helicoptere"
    return "non_lu"


def aeronef_acte(a: dict[str, Any], rules_dir: Path) -> str:
    ch = a.get("champs") or {}
    first = f"{a.get('titre') or ''} {ch.get('article_1') or ''}"
    return aeronef([first, ch.get("aeronef_extrait")], rules_dir)


ARRONDISSEMENT = re.compile(
    r"\b(\d{1,2})\s*(?:e|er|eme|ieme)\s+arrondissements?(?:\s+de\s+(paris|lyon|marseille))?"
    r"|\b(paris|lyon|marseille)\s+(\d{1,2})\s*(?:e|er|eme)\b"
)


@cache
def _secteur(rules_dir: Path) -> dict[str, Any]:
    conf = yaml.safe_load((rules_dir / "registre_drones.yaml").read_text("utf-8"))["secteur"]
    return {
        **conf,
        "lieu": re.compile(conf["lieu"]),
        "departement": re.compile(conf["departement"]),
    }


def situer(
    secteur: str | None, noms: dict[str, str], rules_dir: Path, ville: str | None = None
) -> dict[str, Any]:
    """{secteur_niveau, secteur_insee?, secteur_lieu?} (rule:registre_drones@1:secteur):
    `noms` the folded names of the communes it may name → their code; `ville` the city an
    arrondissement without its city belongs to (the act's own commune)."""
    conf = _secteur(rules_dir)
    t = plie(secteur)
    if not t:
        return {"secteur_niveau": "non_lu"}
    arr = []
    for m in ARRONDISSEMENT.finditer(t):
        n, city = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        prefix = conf["villes_arrondissements"].get(city or ville or "")
        if prefix and 1 <= int(n) <= 20:
            arr.append(f"{prefix[1]}{int(n):02d}" if prefix[1] != "6938" else f"6938{int(n)}")
    if arr:
        return {"secteur_niveau": "arrondissement", "secteur_insee": sorted(set(arr))}
    if m := conf["lieu"].search(t):
        return {"secteur_niveau": "lieu", "secteur_lieu": m.group(0).strip()}
    named = sorted(
        {k for n, k in noms.items() if re.search(rf"(?<![a-z-]){re.escape(n)}(?![a-z-])", t)}
    )
    if named:
        return {"secteur_niveau": "commune", "secteur_insee": named}
    if conf["departement"].search(t):
        return {"secteur_niveau": "departement"}
    return {"secteur_niveau": "non_lu"}


def champs(a: dict[str, Any], rules_dir: Path) -> dict[str, Any]:
    """The fields for a drone act of the family the rule was measured on (the police
    prefecture and the four départements of its agglomeration), nothing for another."""
    conf = yaml.safe_load((rules_dir / "registre_drones.yaml").read_text("utf-8"))
    if a.get("administration") not in conf["fin"]["famille_pp"]:
        return {}
    return lire((a.get("champs") or {}).get("article_1"), rules_dir)
