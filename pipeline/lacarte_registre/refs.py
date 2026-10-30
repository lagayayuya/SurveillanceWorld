"""Every name the registre serves leads to its record when the record exists (lot R3 § 5).

A record's reference is its address under /registre/, `<type>/<id>`: `commune/<INSEE>`,
`departement/<code>`, `acheteur/<SIREN>` (an intercommunality that buys has its page there),
`entreprise/<SIREN>`, `contrat/<affaire>` (every document's record). A name gets one only when
its record is written by this build (`Fiches`): a commune with a document, a département
with one, a buyer of a document, a company of one that is not a sole trader. A name without
a record has none: a sole trader never (the token `ei`), a commune without a document
neither.

Where the references are (fermetures.py writes them):
- every dictionary entry of a file (`entreprises`, `acheteurs`, `communes`) has `ref` when
  its record exists; a commune's entry has `epci_ref` and `dep_ref` too;
- a document: `acheteur_ref` (its buyer, named by the notice or by its affaire), `commune_ref`
  (its commune: an act's, a notice's buyer's), `lieu_ref` (a notice's buyer's address),
  `beneficiaire_ref` (an act's beneficiary, a buyer whose page exists), `entreprises_refs`
  (its companies, in their order, null for one without a record), `partage_refs` and
  `insee0_ref` (an act's other communes, its original's), `mentions` (below);
- an affaire's links (`contrat_probable`, `avis_probables`, a lot's members) are affaire ids:
  each is a record, `contrat/<id>`.

A name read in a free text (`mentions` of an objet): [{"debut", "fin", "ref"}], character
offsets in that text. Linked only when the match is sure (DECISIONS 2026-10-30):
- a SIREN or a SIRET written in it (9 or 14 digits, Luhn-valid) whose company's or buyer's
  record exists;
- an INSEE code written as such (« INSEE 69283 », « code INSEE : 69283 »; a bare five-digit
  number is a postal code more often than not);
- a commune's name, whole words, accents and case aside, hyphens as spaces, when that name
  is exact and unique in the document's département, at least `MIN_NOM` letters long, and its
  record exists; the longest name wins where two overlap.
Anything else stays text.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

from lacarte_registre.regles import EI, Event, Registre
from lacarte_registre.selection import luhn

MIN_NOM = 3


def ref(kind: str, key: str | None) -> str | None:
    return f"{kind}/{key}" if key else None


@dataclass
class Fiches:
    """The records this build writes, by type."""

    communes: set[str] = field(default_factory=set)
    departements: set[str] = field(default_factory=set)
    acheteurs: set[str] = field(default_factory=set)
    entreprises: set[str] = field(default_factory=set)
    affaires: set[str] = field(default_factory=set)

    def commune(self, k: str | None) -> str | None:
        return ref("commune", k) if k in self.communes else None

    def departement(self, k: str | None) -> str | None:
        return ref("departement", k) if k in self.departements else None

    def acheteur(self, s: str | None) -> str | None:
        return ref("acheteur", s) if s in self.acheteurs else None

    def entreprise(self, s: str | None) -> str | None:
        return ref("entreprise", s) if s and s != EI and s in self.entreprises else None

    def affaire(self, a: str | None) -> str | None:
        return ref("contrat", a) if a in self.affaires else None

    def siren(self, s: str) -> str | None:
        return self.entreprise(s) or self.acheteur(s)


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s)


def _folded_with_map(s: str) -> tuple[str, list[int]]:
    """`s` folded (no accent, lower case, any other character a space), one character for one,
    with each folded character's offset in `s`."""
    out, where = [], []
    for i, ch in enumerate(s):
        f = unicodedata.normalize("NFKD", ch).encode("ascii", "ignore").decode().lower()
        f = f[:1] if f else ""
        if not f:
            continue
        out.append(f if f.isalnum() else " ")
        where.append(i)
    return "".join(out), where


INSEE_WRITTEN = re.compile(r"\binsee\s*(?:n\s*[°o]\s*)?:?\s*((?:\d[\dAB]|2[AB])\d{3})\b", re.I)
SIREN_WRITTEN = re.compile(r"(?<!\d)(\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?)(?!\d)")


class Lecteur:
    """Reads the names in free texts, by département (commune names built once)."""

    def __init__(self, reg: Registre, fiches: Fiches):
        self.fiches = fiches
        self.known = frozenset(reg.communes)
        names: dict[str, Counter[str]] = defaultdict(Counter)
        code_of: dict[tuple[str, str], str] = {}
        for k, c in reg.communes.items():
            dep, nom = c.get("dep") or "", _fold(c.get("nom") or "").strip()
            nom = re.sub(r" +", " ", nom)
            if len(nom.replace(" ", "")) < MIN_NOM:
                continue
            names[dep][nom] += 1
            code_of[(dep, nom)] = k
        self._rx: dict[str, re.Pattern[str] | None] = {}
        self._code: dict[str, dict[str, str]] = {}
        for dep, cnt in names.items():
            # unique in the département and with a record: the only names that may link
            ok = {
                n: code_of[(dep, n)]
                for n, c in cnt.items()
                if c == 1 and code_of[(dep, n)] in fiches.communes
            }  # noqa: E501
            self._code[dep] = ok
            if ok:
                alts = "|".join(
                    re.escape(n).replace(r"\ ", " +") for n in sorted(ok, key=len, reverse=True)
                )  # noqa: E501
                self._rx[dep] = re.compile(rf"(?<![a-z0-9])(?:{alts})(?![a-z0-9])")

    def mentions(self, text: str | None, dep: str | None) -> list[dict[str, Any]]:
        if not text:
            return []
        out: list[dict[str, Any]] = []
        for m in SIREN_WRITTEN.finditer(text):
            digits = re.sub(r"\s", "", m.group(1))
            if not luhn(digits[:9]) or (len(digits) == 14 and not luhn(digits)):
                continue
            if r := self.fiches.siren(digits[:9]):
                out.append({"debut": m.start(1), "fin": m.end(1), "ref": r})
        for m in INSEE_WRITTEN.finditer(text):
            if r := self.fiches.commune(m.group(1).upper()):
                out.append({"debut": m.start(1), "fin": m.end(1), "ref": r})
        rx = self._rx.get(dep or "")
        if rx is not None:
            folded, where = _folded_with_map(text)
            for m in rx.finditer(folded):
                code = self._code[dep or ""][re.sub(r" +", " ", m.group(0))]
                start, end = where[m.start()], where[m.end() - 1] + 1
                if not any(x["debut"] < end and start < x["fin"] for x in out):
                    out.append({"debut": start, "fin": end, "ref": ref("commune", code)})
        return sorted(out, key=lambda x: x["debut"])


# What a name without a reference is, for the build's report: (type, reason).
Missing = Counter[tuple[str, str]]


def annoter(reg: Registre, fiches: Fiches, buyer_of: Any) -> Missing:
    """Write the references on every document (once: a document is shared between files);
    return the names left without one, by type and reason."""
    lecteur = Lecteur(reg, fiches)
    missing: Missing = Counter()
    # the copies of a shared act (one per other commune, regles.appliquer) are documents too
    every = {id(e): e for e in reg.evenements}
    originals = set(every)
    for evs in reg.by_insee.values():
        every.update((id(e), e) for e in evs)
    for key, e in every.items():
        if key not in originals:
            _annotate(e, fiches, buyer_of, lecteur, Counter())
            continue
        _annotate(e, fiches, buyer_of, lecteur, missing)
    return missing


def _annotate(e: Event, fiches: Fiches, buyer_of: Any, lecteur: Lecteur, missing: Missing) -> None:
    def put(key: str, value: str | None, kind: str, why: str) -> None:
        if value:
            e[key] = value
        else:
            e.pop(key, None)
            missing[(kind, why)] += 1

    b = buyer_of(e)
    if b or e.get("acheteur"):
        put("acheteur_ref", fiches.acheteur(b), "acheteur", "sans_fiche" if b else "siren_inconnu")
    if e.get("insee"):
        why = "sans_fiche" if e["insee"] in lecteur.known else "hors_reference"
        put("commune_ref", fiches.commune(e["insee"]), "commune", why)
    elif e["t"].startswith("arrete") or e.get("acheteur"):
        missing[("commune", "commune_inconnue")] += 1
    if e.get("lieu_insee"):
        put("lieu_ref", fiches.commune(e["lieu_insee"]), "commune", "lieu_sans_fiche")
    if e.get("beneficiaire_siren"):
        s = e["beneficiaire_siren"]
        put("beneficiaire_ref", fiches.acheteur(s) or fiches.entreprise(s), "beneficiaire",
            "sans_fiche")  # fmt: skip
    elif e.get("beneficiaire") and e.get("nom_publie"):
        missing[("beneficiaire", "sans_siren")] += 1
    if e.get("entreprises"):
        e["entreprises_refs"] = [fiches.entreprise(s) for s in e["entreprises"]]
        for s, r in zip(e["entreprises"], e["entreprises_refs"], strict=True):
            if r is None:
                missing[("entreprise", "entreprise_individuelle" if s == EI else "sans_fiche")] += 1
    if e.get("partage"):
        e["partage_refs"] = [fiches.commune(k) for k in e["partage"]]
        missing[("commune", "partage_sans_fiche")] += sum(1 for r in e["partage_refs"] if not r)
    if e.get("insee0"):
        e["insee0_ref"] = fiches.commune(e["insee0"])
    found = lecteur.mentions(e.get("objet"), e.get("dep"))
    if found:
        e["mentions"] = found
    else:
        e.pop("mentions", None)
