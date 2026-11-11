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


# « 14e arrondissement de Paris », « 18e et 19e arrondissements », « Paris 18 ème et 19 ème »
ORDINAL = r"\d{1,2}\s*(?:e|er|eme|ieme)\b"
ARRONDISSEMENT = re.compile(
    rf"\b((?:{ORDINAL}\s*(?:,|et)\s*)*)(\d{{1,2}})\s*(?:e|er|eme|ieme)\s+arrondissements?"
    r"(?:\s+de\s+(paris|lyon|marseille))?"
    rf"|\b(paris|lyon|marseille)\s+(\d{{1,2}})\s*(?:e|er|eme)\b((?:\s*(?:,|et)\s*{ORDINAL})*)"
)


@cache
def _secteur(rules_dir: Path) -> dict[str, Any]:
    conf = yaml.safe_load((rules_dir / "registre_drones.yaml").read_text("utf-8"))["secteur"]
    return {
        **conf,
        "lieu": re.compile(conf["lieu"]),
        "departement": re.compile(conf["departement"]),
    }


# a place the text layer broke: a figure, a private-use glyph, a lone letter
# (« Notr e-Dame », « d e Paris », « Stade de2024-01014 France »)
LIEU_ABIME = re.compile(r"\d|[\ue000-\uf8ff]|(?<![\w'’])(?![aàyAÀ]\b)\w(?![\w'’])|\w(?=\s\w\b)")


def _plie_avec_places(s: str) -> tuple[str, list[int]]:
    """`plie(s)` and, for each of its characters, its place in `s` (a span read on the folded
    text is cut from the act's own text, its capitals and accents kept)."""
    out: list[str] = []
    at: list[int] = []
    for i, ch in enumerate(s.replace("’", "'")):
        if ch.isspace():
            if out and out[-1] != " ":
                out.append(" ")
                at.append(i)
            continue
        for f in unicodedata.normalize("NFKD", ch).encode("ascii", "ignore").decode().lower():
            out.append(f)
            at.append(i)
    while out and out[-1] == " ":
        out.pop()
        at.pop()
    return "".join(out), at


def _nomme(nom: str, t: str) -> bool:
    """Whether a folded text names a commune by its folded name, as a whole word."""
    return re.search(rf"(?<![a-z-]){re.escape(nom)}(?![a-z-])", t) is not None


def situer(
    secteur: str | None,
    noms: dict[str, str],
    rules_dir: Path,
    ville: str | None = None,
    libelles: dict[str, str] | None = None,
) -> dict[str, Any]:
    """{secteur_niveau, secteur?, secteur_insee?, secteur_lieu?} (rule:registre_drones@1:secteur):
    `noms` the folded names of the communes it may name → their code, `libelles` a code → its
    name; `ville` the city an arrondissement without its city belongs to (the act's own
    commune). `secteur` is the place alone, never the act's words."""
    conf = _secteur(rules_dir)
    raw = re.sub(r"\s+", " ", secteur or "").strip()
    t, at = _plie_avec_places(raw)
    if not t:
        return {"secteur_niveau": "non_lu"}
    arr = []
    for m in ARRONDISSEMENT.finditer(t):
        if m.group(2):
            ns, city = [*re.findall(r"\d{1,2}", m.group(1)), m.group(2)], m.group(3)
        else:
            ns, city = [m.group(5), *re.findall(r"\d{1,2}", m.group(6))], m.group(4)
        prefix = conf["villes_arrondissements"].get(city or ville or "")
        for n in ns:
            if prefix and 1 <= int(n) <= 20:
                arr.append(f"{prefix[1]}{int(n):02d}" if prefix[1] != "6938" else f"6938{int(n)}")
    if arr:
        codes = sorted(set(arr))
        nums = [str(int(c[-2:])) if not c.startswith("6938") else c[-1] for c in codes]
        city = {"751": "Paris", "693": "Lyon", "132": "Marseille"}[codes[0][:3]]
        label = f"{city} {', '.join(n + ('er' if n == '1' else 'e') for n in nums)}"
        # the other communes it names beside them (« Paris 18e et 19e ainsi que Saint-Denis
        # et Pantin »), the arrondissements' own city not among them
        whole = {"Paris": "75056", "Lyon": "69123", "Marseille": "13055"}[city]
        more = sorted({k for n, k in noms.items() if k != whole and _nomme(n, t)})
        if more and libelles and all(k in libelles for k in more):
            label = ", ".join([label, *(libelles[k] for k in more)])
        return {"secteur_niveau": "arrondissement", "secteur_insee": codes + more,
                "secteur": label}  # fmt: skip
    m = conf["lieu"].search(t)
    # a kind alone (« Arena », « Palais ») is no place
    if m and " " in m.group(0).strip():
        place = raw[at[m.start()] : at[m.end() - 1] + 1].strip(" ,;.")
        place = re.sub(r"\s+-\s*", "-", place)  # « Paris -Longchamp »
        if LIEU_ABIME.search(place):
            m = None  # the PDF's text layer broke it: no place, the commune's level instead
        else:
            place = place[0].upper() + place[1:]
            return {"secteur_niveau": "lieu", "secteur_lieu": place, "secteur": place}
    named = sorted({k for n, k in noms.items() if _nomme(n, t)})
    if named:
        out: dict[str, Any] = {"secteur_niveau": "commune", "secteur_insee": named}
        if libelles and all(k in libelles for k in named):
            out["secteur"] = ", ".join(libelles[k] for k in named)
        return out
    if conf["departement"].search(t):
        return {"secteur_niveau": "departement"}
    return {"secteur_niveau": "non_lu"}


PLACE = ("secteur", "secteur_niveau", "secteur_insee", "secteur_lieu")


def aux_copies(by_insee: dict[str, list[dict[str, Any]]], by_id: dict[str, dict[str, Any]]) -> int:
    """A drone act's copies in its other communes' lists (`insee0`) take their original's
    place, read once; returns how many copies changed."""
    n = 0
    for rows in by_insee.values():
        for c in rows:
            o = by_id.get(c["id"])
            if not c.get("insee0") or o is None or c is o or o.get("t") != "arrete_drone":
                continue
            before = {k: c.get(k) for k in PLACE}
            for k in PLACE:
                c.pop(k, None)
                if k in o:
                    c[k] = o[k]
            n += before != {k: c.get(k) for k in PLACE}
    return n


def champs(a: dict[str, Any], rules_dir: Path) -> dict[str, Any]:
    """The fields for a drone act of the family the rule was measured on (the police
    prefecture and the four départements of its agglomeration), nothing for another."""
    conf = yaml.safe_load((rules_dir / "registre_drones.yaml").read_text("utf-8"))
    if a.get("administration") not in conf["fin"]["famille_pp"]:
        return {}
    return lire((a.get("champs") or {}).get("article_1"), rules_dir)
