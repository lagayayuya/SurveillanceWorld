"""The fields read beyond the first ones (lot R4.2): an act's purpose, its service, the purposes
of L. 242-5 it ticks, the places it cites, its perimeters and communes; for video protection,
the site's kind and address, the purposes, the retention, the expiry and the act's nature.

They are asked in the same request as the first fields for an act never read, and alone, on
the lighter window, for an act read already (`a_lire` in modele.py tells the two apart by the
two fingerprints). Each carries the passage that proves it and is checked here, as the first
ones in modele.controler: a value outside its closed list (rules/collecte_champs.yaml), a
passage not in the text word for word, a date that does not parse leaves the field empty.
A disagreement on these fields is never arbitrated: the field stays empty. The address is kept
only when the petitioner is proved a company or a public body, never a sole trader's: the
commune alone then (the same rule as the SIREN's, regles.masquer_ei).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import yaml

from lacarte_collecte import parse_raa

DRONE = (
    "motif",
    "motif_libelle",
    "service",
    "finalites",
    "lieux",
    "n_perimetres",
    "communes",
)
VIDEO = (
    "etablissement",
    "adresse",
    "petitionnaire",
    "finalites",
    "conservation_jours",
    "echeance",
    "nature",
)
CHAMPS = tuple(dict.fromkeys(DRONE + VIDEO))

# the words that make a petitioner a company or a public body (its legal form in its name)
MORALE = re.compile(
    r"\b(?:s\.?a\.?s\.?u?|s\.?a\.?r\.?l|e\.?u\.?r\.?l|s\.?n\.?c|s\.?c\.?i|s\.?a|s\.?e\.?l\.?a\.?r\.?l"
    r"|soci[ée]t[ée]|association|groupe|compagnie|banque|caisse|mutuelle|coop[ée]rative"
    r"|commune|mairie|ville|m[ée]tropole|communaut[ée]|d[ée]partement|r[ée]gion|syndicat"
    r"|[ée]tablissement public|centre hospitalier|h[ôo]pital|universit[ée]|lyc[ée]e|coll[èe]ge"
    r"|minist[èe]re|office|r[ée]gie|sncf|ratp|la poste)\b",
    re.I,
)
EI = re.compile(
    r"\b(?:e\.?i\.?|entrepreneur individuel|auto-?entrepreneur|micro-?entreprise)\b", re.I
)


def regles(rules_dir: Path) -> dict[str, Any]:
    return yaml.safe_load((rules_dir / "collecte_champs.yaml").read_text("utf-8"))


def consigne(conf: dict[str, Any]) -> str:
    motifs = " ; ".join(f"{k} ({v})" for k, v in conf["motifs"].items())
    fins = " ; ".join(f"{k} ({v})" for k, v in conf["finalites"].items())
    return f"""\
Champs complémentaires, chacun avec sa valeur et la citation exacte qui la prouve :
- drone et caméras-piétons :
  · motif : la raison de l'autorisation, une catégorie parmi {motifs} ; motif_libelle : un \
libellé court tiré du texte (« mouvement social lycéen et étudiant ») ;
  · service : le service qui demande ou met en œuvre (« Direction de la sécurité de proximité \
de l'agglomération parisienne ») ;
  · finalites : celles de l'article L. 242-5 du code de la sécurité intérieure que l'acte \
retient, parmi {fins} ;
  · lieux : chaque lieu cité pour le périmètre (arrondissement, quartier, place, rue, stade, \
gare, établissement), son texte exact et son genre ({", ".join(conf["genres_lieux"])}) ;
  · n_perimetres : le nombre de périmètres distincts que l'acte autorise ;
  · communes : toutes les communes que l'acte vise, leur nom seul ;
- vidéoprotection :
  · etablissement : le genre du site, parmi {", ".join(conf["etablissements"])} ;
  · adresse : l'adresse du site (numéro, voie), sans la commune ;
  · petitionnaire : personne_morale, organisme_public ou entrepreneur_individuel, d'après la \
forme du nom du pétitionnaire (la citation : ce nom tel qu'il est écrit) ;
  · finalites : les finalités cochées, leur texte ;
  · conservation_jours : la durée de conservation des images, en jours ;
  · echeance : la date de fin de l'autorisation, AAAA-MM-JJ ;
  · nature : nouvelle, renouvellement ou modification.
Un champ qui ne concerne pas le dispositif de l'acte, ou que le texte ne prouve pas : valeur \
null (ou liste vide) et citation null."""


def consigne_seule(conf: dict[str, Any]) -> str:
    """The instruction for an act read already: the complementary fields only."""
    return (
        "Tu lis un arrêté préfectoral français dans le texte d'un recueil des actes "
        "administratifs (texte issu d'un PDF, parfois d'une reconnaissance de caractères). On te "
        "donne un extrait et le numéro de l'acte à lire ; lis cet acte-là seulement : ses "
        "demandes, ses considérants et ses articles.\n\n"
        + consigne(conf)
        + "\n\nN'écris aucun nom de personne physique, nulle part. N'invente rien."
    )


def _champ(kind: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"valeur": kind, "citation": {"type": ["string", "null"]}},
        "required": ["valeur", "citation"],
        "additionalProperties": False,
    }


def _choix(values: list[str]) -> dict[str, Any]:
    return {"anyOf": [{"type": "string", "enum": list(values)}, {"type": "null"}]}


def proprietes(conf: dict[str, Any]) -> dict[str, Any]:
    s = {"type": ["string", "null"]}
    return {
        "motif": _champ(_choix(conf["motifs"])),
        "motif_libelle": _champ(s),
        "service": _champ(s),
        "finalites": _champ({"type": "array", "items": {"type": "string"}}),
        "lieux": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "texte": {"type": "string"},
                    "genre": {"type": "string", "enum": conf["genres_lieux"]},
                    "citation": {"type": ["string", "null"]},
                },
                "required": ["texte", "genre", "citation"],
                "additionalProperties": False,
            },
        },
        "n_perimetres": _champ({"type": ["integer", "null"]}),
        "communes": _champ({"type": "array", "items": {"type": "string"}}),
        "etablissement": _champ(_choix(conf["etablissements"])),
        "adresse": _champ(s),
        "petitionnaire": _champ(
            _choix(["personne_morale", "organisme_public", "entrepreneur_individuel"])
        ),
        "conservation_jours": _champ({"type": ["integer", "null"]}),
        "echeance": _champ(s),
        "nature": _champ(_choix(conf["natures"])),
    }


def schema_seul(conf: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"trouve": {"type": "boolean"}, **proprietes(conf)},
        "required": ["trouve", *CHAMPS],
        "additionalProperties": False,
    }


def empreinte(conf: dict[str, Any]) -> str:
    """The complementary fields' fingerprint: a change reads them again, never the first ones."""
    raw = consigne(conf) + json.dumps(proprietes(conf), sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# --- the deterministic check ------------------------------------------------------------------
def _ws(s: str) -> str:
    s = s.replace("’", "'").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def _in(c: str | None, text: str) -> bool:
    return bool(c) and _ws(c) in _ws(text)


def _plain(s: str) -> str:
    return parse_raa.loose(s)


def controler(
    lu: dict[str, Any],
    text: str,
    communes: parse_raa.Communes,
    when: dt.date,
    conf: dict[str, Any],
    kind: str,
) -> dict[str, Any]:
    """{field: value or None}: each kept only when its passage proves it and its value fits."""
    out: dict[str, Any] = {k: None for k in CHAMPS}
    own = DRONE if kind != "videoprotection" else VIDEO

    def get(k: str) -> tuple[Any, str | None]:
        f = lu.get(k) or {}
        return f.get("valeur"), f.get("citation")

    for k in own:
        if k == "lieux":
            places = []
            for p in lu.get("lieux") or []:
                t, c = (p.get("texte") or "").strip(), p.get("citation")
                if (
                    t
                    and p.get("genre") in conf["genres_lieux"]
                    and _in(c, text)
                    and _plain(t) in _plain(c)
                ):
                    places.append({"texte": t, "genre": p["genre"]})
            out[k] = places or None
            continue
        v, c = get(k)
        if v in (None, [], "") or not _in(c, text):
            continue
        if k == "motif":
            out[k] = v if v in conf["motifs"] else None
        elif k in ("motif_libelle", "service"):
            # the label is the text's own words
            out[k] = str(v).strip() if _plain(str(v)) in _plain(c) else None
        elif k == "finalites":
            if kind == "videoprotection":
                keep = [str(x).strip() for x in v if str(x).strip() and _plain(str(x)) in _plain(c)]
            else:
                keep = [x for x in dict.fromkeys(v) if x in conf["finalites"]]
            out[k] = keep or None
        elif k in ("n_perimetres", "conservation_jours"):
            low = "".join(
                x for x in unicodedata.normalize("NFKD", c) if not unicodedata.combining(x)
            ).lower()
            nums = [int(x) for x in re.findall(r"\d{1,4}", low)]
            words = [n for w, n in parse_raa.WORDS.items() if re.search(rf"\b{w}\b", low)]
            if isinstance(v, int) and v > 0 and (v in nums or v in words):
                out[k] = v
        elif k == "communes":
            found = []
            for name in v:
                hit = communes.first(str(name))
                same = hit and parse_raa.loose(hit[0]) == parse_raa.loose(str(name))
                if same and parse_raa.loose(hit[0]) in parse_raa.loose(c):
                    found.append(hit[1])
            out[k] = list(dict.fromkeys(found)) or None
        elif k == "etablissement":
            out[k] = v if v in conf["etablissements"] else None
        elif k == "nature":
            out[k] = v if v in conf["natures"] else None
        elif k == "echeance":
            try:
                d = dt.date.fromisoformat(str(v))
            except ValueError:
                continue
            if 0 <= (d - when).days <= int(conf["echeance_jours_max"]) and str(d.year) in c:
                out[k] = d.isoformat()
        elif k == "petitionnaire":
            if EI.search(c):
                out[k] = "entrepreneur_individuel"
            elif v in ("personne_morale", "organisme_public") and MORALE.search(c):
                out[k] = v
            else:
                out[k] = "entrepreneur_individuel" if v == "entrepreneur_individuel" else None
        elif k == "adresse":
            out[k] = str(v).strip() if _plain(str(v)) in _plain(c) else None
    if kind == "videoprotection" and out.get("petitionnaire") not in (
        "personne_morale",
        "organisme_public",
    ):
        # a sole trader's address, or one whose petitioner is not proved: the commune alone
        out["adresse"] = None
    out.pop("petitionnaire", None)  # what the petitioner is, kept only through its address
    return out
