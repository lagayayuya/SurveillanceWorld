"""The prefectoral acts of one recueil (a « recueil des actes administratifs »), read: which acts
are about surveillance, and what each authorises. Deterministic: rules, no language model.

Ported from the registre's own exploration scripts (rhone_raa/extract.py and the national
framing's lire_actes.py), then adapted to the templates measured on 2026-10-31:
- recueils with national act ids (`69-2026-07-02-00011`): cut at each id after the summary,
  the summary giving each act its title;
- recueils without them (06, 08, 10, 11, 13, the Préfecture de police, Nouvelle-Calédonie)
  and single-act PDFs: cut at each act's heading (« ARRÊTÉ … n° … »), the heading's number
  being the act's;
- the dispositif (what the act decides) starts at « ARRÊTE : Article 1 » (any accent, the OCR's
  « Arréte » included), else at the first « Article 1 » after the « Vu » and « Considérant »;
  it ends at the execution article (« … chargés, chacun en ce qui le concerne »);
- dates written without their year (« les 9, 10 et 11 juillet », the Moselle's): the act's
  own year, read in its heading (« du 8 juillet 2026 ») or the recueil's, the next year when
  the month is earlier than the act's.

What an act gives (`Acte`): its id, its title (civilities masked), its kind (`type`, from
rules/collecte_actes.yaml), its subtype, its commune (the first named, by the département's
communes), and the kind's fields: the cameras of a video-protection act (interior, exterior,
public road, total), the dates, hours and number of cameras of a drone act and the words of
its perimeter, the cameras of a body-camera act. No natural person is kept: the beneficiary
is not read here, a title's civilities are masked.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

# The reader's version, written on every recueil and act it read: a recueil read by an older
# version is read again (its text asked again: no text is kept), so the threshold is always
# measured on what the current reader gives. Raise it with any change to what lire() returns.
VERSION = 1
ID = r"(?:\d{2,3}|2[AB])-20\d\d-\d\d-\d\d-\d{5}"
WORDS = {
    "un": 1,
    "une": 1,
    "deux": 2,
    "trois": 3,
    "quatre": 4,
    "cinq": 5,
    "six": 6,
    "sept": 7,
    "huit": 8,
    "neuf": 9,
    "dix": 10,
    "onze": 11,
    "douze": 12,
    "quinze": 15,
    "vingt": 20,
}
NUMW = r"(\d{1,4}|" + "|".join(WORDS) + r")"
MONTHS = "janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre"
MONTHS = MONTHS.split()
MOIS = {m: i + 1 for i, m in enumerate(MONTHS)}
MOISR = "(" + "|".join(MONTHS) + ")"
CIVILITY = re.compile(
    r"\b(?:M\.|MM\.|Mme|Mlle|Monsieur|Madame|Messieurs|Docteur|Dr)\s+"
    r"(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s*){1,3}",
    re.I,
)
HEAD = re.compile(
    r"(?m)^[ \t|]*(?:A\s?R\s?R\s?[EÊÉ]\s?T\s?[EÉ]|Arr[êeé]t[ée])"
    r"(?:[ \t]+(?:pr[ée]fectoral|[A-Za-z][\w/.-]*)){0,2}[ \t]*(?:N°|n°|no|n\s?°)[ \t]*"
    r"(\d+(?:[ \t]*[-/.][ \t]*\d+)*)?"
)
HOURS = re.compile(r"(?:de|entre) (\d{1,2}) ?h ?(\d{2})? ?(?:a|et|jusqu'a) (\d{1,2}) ?h ?(\d{2})?")
SPAN = re.compile(
    r"a (\d{1,2}) ?h ?(\d{2})? (?:au|jusqu'au) .{0,60}?20\d\d a (\d{1,2}) ?h ?(\d{2})?"
)


def strip(s: str) -> str:
    """Accent-free, one space, lower case: what every rule below reads."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("’", "'").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", s).lower()


def loose(s: str) -> str:
    """For names: no hyphen, no apostrophe, St → Saint, a word's final « s » dropped."""
    s = strip(s).replace("-", " ").replace("'", " ")
    s = re.sub(r"\bst\b", "saint", re.sub(r"\bste\b", "sainte", s))
    return re.sub(r"\s+", " ", re.sub(r"(\w{3,})s\b", r"\1", s)).strip()


def num(x: str) -> int | None:
    x = x.lower()
    return int(x) if x.isdigit() else WORDS.get(x)


def mask(s: str) -> str:
    return CIVILITY.sub("[…] ", s).strip()


# --- the kinds of acts (rules/collecte_actes.yaml) ---------------------------------------
@dataclass
class Type:
    id: str
    titre: str  # in the title (normalised text)
    dispositif: str  # in the dispositif's first lines
    exclure: str = ""
    priorite: int = 0


def types(path: Path) -> list[Type]:
    conf = yaml.safe_load(path.read_text("utf-8"))
    out = [
        Type(
            id=k,
            titre=v.get("titre", "$^"),
            dispositif=v.get("dispositif", "$^"),
            exclure=v.get("exclure", ""),
            priorite=int(v.get("priorite", 0)),
        )
        for k, v in conf["types"].items()
    ]
    return sorted(out, key=lambda t: t.priorite)


# --- cutting a recueil into acts -----------------------------------------------------------
@dataclass
class Morceau:
    acte: str
    titre: str
    texte: str
    gabarit: str  # "identifiants" | "en-tete" | "entier"


def split_acts(txt: str) -> list[Morceau]:
    titles: dict[str, str] = {}
    for m in re.finditer(r"(" + ID + r")\s*-\s*(.+?)\((\d+)\s*pages?\)", txt, re.S):
        titles.setdefault(m.group(1), re.sub(r"\s+", " ", m.group(2)).strip())
    som_end = 0
    for m in re.finditer(r"\((\d+)\s*pages?\)\s*Page\s*\d+", txt):
        som_end = max(som_end, m.end())
    starts: dict[str, int] = {}
    for m in re.finditer(ID, txt[som_end:]):
        # with a summary, its acts only: an act cited in another's visas (a delegation of
        # signature) is not where an act starts
        if not titles or m.group(0) in titles:
            starts.setdefault(m.group(0), som_end + m.start())
    ids = sorted(starts, key=starts.__getitem__)
    if ids:
        return [
            Morceau(
                a,
                titles.get(a, ""),
                txt[starts[a] : starts[ids[i + 1]] if i + 1 < len(ids) else len(txt)],
                "identifiants",
            )
            for i, a in enumerate(ids)
        ]
    heads = list(HEAD.finditer(txt))
    if not heads:
        return [Morceau("1", re.sub(r"\s+", " ", txt[:300]).strip(), txt, "entier")]
    out = []
    seen: dict[str, int] = {}
    for i, m in enumerate(heads):
        body = txt[m.start() : heads[i + 1].start() if i + 1 < len(heads) else len(txt)]
        n = re.sub(r"\s+", "", m.group(1) or "").strip(".-/") or str(i + 1)
        seen[n] = seen.get(n, 0) + 1
        key = n if seen[n] == 1 else f"{n}~{seen[n]}"
        out.append(Morceau(key, re.sub(r"\s+", " ", body[:400]).strip(), body, "en-tete"))
    return out


# --- the dispositif --------------------------------------------------------------------------
def operative(n: str) -> str:
    """From « arrête : article 1 » (else the first « article 1 » after the visas) to the end."""
    m = re.search(r"\barr[eé]t[eé]\s*:?\s*article\s*(?:1|1er|premier)\b", n)
    if m:
        return n[m.start() :]
    last_visa = 0
    for v in re.finditer(r"\b(?:vu|considerant|sur (?:la )?proposition)\b", n):
        last_visa = v.start()
    m = re.search(r"\barticle\s*(?:1|1er|premier)\b", n[last_visa:])
    return n[last_visa + m.start() :] if m else n


# Where a dispositif ends: the execution article, the signature (« Fait à Metz, le … »,
# « À Metz, le 08 juil. 2026 »), the article on appeals; else the page's foot would be read
# (the Moselle's opening hours, « de 8h30 à 12h00 », taken for flight hours).
END = re.compile(
    r"(?:sont charges|est charge),? chacun en ce qui|\b(?:fait )?a [a-z' -]{2,40},? le \d"
    r"|peut faire l'objet,? (?:dans un delai de deux mois[^,]*, )?d'un recours"
)


def dispositif(n: str) -> str:
    """The dispositif, from its article 1 to where it ends (END)."""
    op = operative(n)
    m = END.search(op, 20)
    return op[: m.start()] if m else op[:6000]


def art1(n: str) -> str:
    op = operative(n)
    m = re.search(r"article 2\b", op[20:])
    return op[: m.start() + 20] if m else op[:3000]


def classify(title: str, n: str, kinds: list[Type]) -> str | None:
    t = strip(title)
    op = operative(n)[:3000]
    for k in kinds:
        if k.exclure and re.search(k.exclure, t):
            return None
        if re.search(k.titre, t) or re.search(k.dispositif, op):
            return k.id
    return None


def subtype(title: str, n: str) -> str:
    tn = strip(title)
    dem = re.search(r"demande .{0,400}", n)
    d = dem.group(0) if dem else ""
    if re.search(r"abrog|retrait", tn):
        return "abrogation"
    if re.search(r"\brefus", tn):
        return "refus"
    if re.search(r"modifi", tn) or re.search(r"en vue d'obtenir (?:la )?modification", d):
        return "modification"
    if re.search(r"renouvel", tn) or re.search(r"en vue d'obtenir (?:le )?renouvellement", d):
        return "renouvellement"
    if re.search(r"urgence|provisoire", tn):
        return "provisoire"
    return "autorisation"


# --- the fields of each kind -------------------------------------------------------------------
def cams_vp(n: str, sub: str) -> dict[str, Any]:
    w = art1(n)
    out: dict[str, Any] = {
        "n_interieur": None,
        "n_exterieur": None,
        "n_voie_publique": None,
        "n_total": None,
        "delta_ou_total": None,
    }
    if m := re.search(NUMW + r" cameras? interieures?", w):
        out["n_interieur"] = num(m.group(1))
    if m := re.search(NUMW + r" cameras? exterieures?", w):
        out["n_exterieur"] = num(m.group(1))
    road = r" cameras? (?:visionnant (?:la |l')?(?:voie|espace) publi|(?:sur|de) (?:la )?voie publique|voie publique)"  # noqa: E501
    if m := re.search(NUMW + road, w):
        out["n_voie_publique"] = num(m.group(1))
    subset = re.search(r"dont " + NUMW + r" (?:cameras? )?visionnant", w)
    if subset and out["n_voie_publique"] is None:
        out["n_voie_publique"] = num(subset.group(1))
    parts = ("n_interieur", "n_exterieur", "n_voie_publique")
    vals = [out[k] for k in parts if out[k] is not None]
    if vals:
        out["n_total"] = sum(out[k] or 0 for k in parts[:2]) if subset else sum(vals)
    elif m := re.search(
        r"(?:pour|de|comprenant|compose de|constitue de) " + NUMW + r" cameras?\b", w
    ):
        out["n_total"] = num(m.group(1))
    if sub == "modification":
        if re.search(r"ajout|supplementaire|nouvelles? cameras?|extension", w):
            out["delta_ou_total"] = "delta"
        elif out["n_total"] is not None:
            out["delta_ou_total"] = "total"
    elif out["n_total"] is not None:
        out["delta_ou_total"] = "total"
    return out


def act_date(head: str, fallback: dt.date) -> dt.date:
    """The act's own day, from its heading (« du 8 juillet 2026 »), else the recueil's."""
    m = re.search(r"(?:du|le) (\d{1,2})(?:er)? " + MOISR + r" (20\d\d)", strip(head[:400]))
    if m:
        try:
            return dt.date(int(m.group(3)), MOIS[m.group(2)], int(m.group(1)))
        except ValueError:
            pass
    return fallback


def drone_dates(d: str, when: dt.date) -> list[str]:
    """The days the dispositif names: « les 9, 10 et 11 juillet 2026 », and without a year
    (« 14 et 15 juillet ») the act's year, or the next one for a month before the act's."""
    days: set[str] = set()
    pat = r"((?:\d{1,2}(?:er|°)?(?:\s*(?:,|et|au|-|/)\s*)?)+)\s*" + MOISR + r"(?:\s*(20\d\d))?"
    for m in re.finditer(pat, d):
        month = MOIS[m.group(2)]
        late = 1 if month < when.month - 1 else 0
        year = int(m.group(3)) if m.group(3) else when.year + late
        for x in re.findall(r"(?<![-.\d])(\d{1,2})(?:er|°)?(?![\d-]|\s*h)", m.group(1)):
            try:
                days.add(dt.date(year, month, int(x)).isoformat())
            except ValueError:
                continue
    return sorted(days)


def drone_fields(n: str, title_n: str, when: dt.date) -> dict[str, Any]:
    d = dispositif(n)
    hours = {
        f"{int(a):02d}h{b or '00'}-{int(c):02d}h{e or '00'}" for a, b, c, e in HOURS.findall(d)
    }
    if not hours:  # one range over two days, often in the title only
        hours = {
            f"{int(a):02d}h{b or '00'}-{int(c):02d}h{e or '00'}"
            for a, b, c, e in SPAN.findall(title_n + " " + d)
        }
    m = re.search(r"nombre maximal de cameras?.{0,160}?(?:fixe a|est de) " + NUMW, d) or re.search(
        NUMW + r" (?:cameras?|aeronefs?|drones?)\b", d
    )
    zones = [
        z.group(0).strip()
        for z in re.finditer(
            r"[^.;]*(?:limitee? (?:au|a la|aux)|perimetres?|secteurs?|quartiers?|zone geographique"
            r"|lieux? suivants?|delimites? par)[^.;]*",
            d,
        )
    ]
    days = drone_dates(art1(n), when) or drone_dates(d, when)
    return {
        "dates": days,
        "horaires": sorted(hours),
        "n_cameras_drone": num(m.group(1)) if m else None,
        "zone_extrait": " | ".join(zones)[:800],
    }


# --- communes ------------------------------------------------------------------------------
class Communes:
    """The communes of one or more départements, by their loose name."""

    def __init__(self, items: dict[str, dict[str, Any]], deps: set[str]):
        self.by = {
            loose(c["nom"]): (c["nom"], code) for code, c in items.items() if c.get("dep") in deps
        }
        self._rx = None
        if self.by:
            alts = "|".join(re.escape(k) for k in sorted(self.by, key=len, reverse=True))
            self._rx = re.compile(r"(?<![a-z])(" + alts + r")(?![a-z])")

    @classmethod
    def load(cls, path: Path, deps: set[str]) -> Communes:
        return cls(json.loads(path.read_text("utf-8"))["communes"], deps)

    def first(self, text: str) -> tuple[str, str] | None:
        """The commune named first (the longest name at one place: Saint-Priest, not Priest)."""
        if self._rx is None:
            return None
        m = self._rx.search(loose(text))
        return self.by[m.group(1)] if m else None


# --- one recueil -----------------------------------------------------------------------------
@dataclass
class Acte:
    acte: str
    type: str
    sous_type: str
    titre: str
    gabarit: str
    commune: str | None = None
    insee: str | None = None
    date_acte: str | None = None
    champs: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def lire(text: str, communes: Communes, kinds: list[Type], recueil_date: dt.date) -> list[Acte]:
    out = []
    for m in split_acts(text):
        n = strip(m.texte)
        kind = classify(m.titre or m.texte[:400], n, kinds)
        if kind is None:
            continue
        sub = subtype(m.titre, n)
        when = act_date(m.texte, recueil_date)
        com = communes.first(strip(m.titre)) or communes.first(operative(n)[:1500])
        a = Acte(
            acte=m.acte,
            type=kind,
            sous_type=sub,
            titre=mask(m.titre)[:200],
            gabarit=m.gabarit,
            commune=com[0] if com else None,
            insee=com[1] if com else None,
            date_acte=when.isoformat(),
        )
        if kind == "videoprotection":
            a.champs = cams_vp(n, sub)
        elif kind == "drone":
            a.champs = drone_fields(n, strip(m.titre), when)
        elif kind == "cameras_pietons":
            c = re.search(NUMW + r" cameras?", art1(n))
            a.champs = {"n_total": num(c.group(1)) if c else None}
        out.append(a)
    return out
