"""The BOAMP (Bulletin officiel des annonces des marchés publics, DILA): the calls for tenders,
their results and corrections about video surveillance, France since `first_year`.

Collection: no longer here. The DILA's records API (Opendatasoft) is forbidden to robots by its
robots.txt (`Disallow: /api/` for every agent but Googlebot, read on 2026-10-31); the notices
come from the DILA's archives (rules/registre_sources.yaml `sources.boamp`). What this module
keeps is what any source of notices goes through: `clean` removes every natural person before
anything is written (the contact blocks: names, e-mails, phones; the holders' names; in free
text, e-mails, phones and a civility or a rank followed by a name: the exploration's
sanitize.py), `notice` reads a cleaned record.

Reading (`parse`, `notices`): every notice that names video surveillance (`video_notice` in
its objet and its text), normalised: {idweb, date, nature, famille, departements, acheteur,
objet, sirets (Luhn-valid, never a phone), cpv, avis_lies, cameras (the new cameras it
counts), url, lieu {cp, ville}, resultat {titulaires (SIREN), cles (SHA-256 of a holder's
normalised name, never the name), montant_attribue, valeur_estimee, date_attribution,
groupement}}, to <root>/national/boamp.jsonl.gz.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from lacarte_registre import selection

SOURCE = "boamp"
FIELDS = (
    "idweb,id,dateparution,code_departement,nomacheteur,objet,nature,nature_libelle,famille,"
    "annonce_lie,annonces_anterieures,url_avis,type_marche,donnees"
)

# --- no natural person in what is kept (sanitize.py) -------------------------------------
DROP_KEYS = {
    "CORRESPONDANT", "CONTACT", "MEL", "TEL", "FAX", "nomContact", "telContact",
    "adresseMailContact", "PersonnePhysique", "cac:Contact", "titulaire",
    "RENS_COMPLEMENT", "ADRESSES_COMPLEMENTAIRES",
    # eForms: a holder's beneficial owners are persons, whatever they carry
    "efac:UltimateBeneficialOwner", "cbc:FirstName", "cbc:FamilyName",
}  # fmt: skip


def _holder(h: Any) -> dict[str, Any]:
    if not isinstance(h, dict):
        return {}
    out = {k: v for k, v in h.items() if k in ("CODE_IDENT_NATIONAL", "TYPE_IDENT_NATIONAL")}
    # a holder's name only as its fingerprint, to be compared with SIRENE's
    if h.get("DENOMINATION"):
        out["DENOMINATION_CLE"] = cle(str(_t(h["DENOMINATION"]) or ""))
    return out


# What an eForms organisation that is a natural person loses: everything that names or places
# it (its indicator is efac:Organization's child, its name and address efac:Company's, one
# level down: the flag is carried down); its notice-local id (ORG-0005) stays, so a result
# can say « a holder who is a person » without naming them
PERSON_KEYS = {
    "cac:PartyName", "cac:PostalAddress", "cac:PartyLegalEntity", "cac:Contact",
    "cbc:WebsiteURI", "cbc:EndpointID",
}  # fmt: skip


def _walk(o: Any, natural: bool = False) -> Any:
    if isinstance(o, dict):
        ind = _t(o.get("efbc:NaturalPersonIndicator", ""))
        natural = natural or str(ind or "").lower() == "true"
        out: dict[str, Any] = {"personne_physique": True} if natural and ind else {}
        for k, v in o.items():
            if k in DROP_KEYS:
                continue
            if k == "TITULAIRE":
                v = [_holder(x) for x in v] if isinstance(v, list) else _holder(v)
                out[k] = v
                continue
            if natural and k in PERSON_KEYS:
                continue
            if k == "cac:PartyName":
                # an organisation's name (a holder may be a sole trader): its fingerprint only;
                # the buyer's name is the record's own `nomacheteur`
                out[k] = [_party(x) for x in v] if isinstance(v, list) else _party(v)
                continue
            out[k] = _walk(v, natural)
        return out
    if isinstance(o, list):
        return [_walk(v, natural) for v in o]
    if isinstance(o, str):
        return selection._sans_personne(o)
    return o


def _party(x: Any) -> dict[str, Any]:
    name = _t(x.get("cbc:Name")) if isinstance(x, dict) else None
    return {"cbc:Name_cle": cle(str(name))} if name else {}


def clean(rec: dict[str, Any]) -> dict[str, Any]:
    rec = {k: v for k, v in rec.items() if k not in DROP_KEYS}
    if rec.get("donnees"):
        d = rec["donnees"]
        d = json.loads(d) if isinstance(d, str) else d
        rec["donnees"] = _walk(d)
    if rec.get("objet"):
        rec["objet"] = selection._sans_personne(rec["objet"])
    return rec


# --- holders' names as fingerprints (sirene_whitelist.key) --------------------------------
FORMS = {
    "SA", "SAS", "SASU", "SARL", "EURL", "SNC", "SCI", "SCM", "SCA", "SELARL", "SELAS",
    "SELAFA", "SEL", "GIE", "SEM", "SPL", "SCOP", "SCS", "SC", "EARL", "GAEC", "SOCIETE", "STE",
    "ETS", "ETABLISSEMENTS", "LA", "LE", "LES", "L",
}  # fmt: skip


def nom_norm(s: str) -> str:
    s = selection.plain(s).upper()
    toks = re.sub(r"[^A-Z0-9]+", " ", s).split()
    while toks and toks[0] in FORMS:
        toks.pop(0)
    while toks and (toks[-1] in FORMS or toks[-1].isdigit()):
        toks.pop()
    return " ".join(toks)


def cle(s: str) -> str:
    return hashlib.sha256(nom_norm(s).encode()).hexdigest()


# --- reading ------------------------------------------------------------------------------
SKIP = re.compile(
    r"IDENTITE|CORRESPONDANT|MEL|TEL|FAX|ADRESSE|Contact|Telephone|Email|ElectronicMail"
    r"|StreetName|PostalZone|Person|TITULAIRE|tendering-party|Winning",
    re.I,
)
TEXT = re.compile(r"OBJET|DESCRIPTION|Description|cbc:Name|INTITULE|LOT|QUANTITE|CARACTERISTIQUES|Note", re.I)  # fmt: skip # noqa: E501
QTY = re.compile(
    r"(?<![\w,.])(\d{1,4})\s+(?:nouvelles?\s+|nouveaux\s+|futures?\s+)?"
    r"(?:cam[ée]ras?|points?\s+de\s+vid[ée]o(?:protection)?)",
    re.I,
)
NOT_QTY = re.compile(r"(lot|n°|no|article|art\.|annexe)\s*$", re.I)
CUES = [
    ("parc existant", r"maintenance|maintenir|compos[ée]e?s?|existant|actuel|d[ée]j[àa]|dispose"
                      r"|en service|parc|op[ée]rationnel|analogiques|int[ée]gr"),
    ("nouvelles", r"nouvel|nouveaux|suppl[ée]mentaires|install|pose|fourniture|d[ée]ploi"
                  r"|mise en (place|oeuvre|œuvre)|ajout|extension|implant|cr[ée]ation|acquisition"
                  r"|achat|remplac|[ée]tendre|tranche|phase|ann[ée]e"),
]  # fmt: skip
UNIT = re.compile(
    r"^\W{0,3}(par\s+(rame|v[ée]hicule|bus|site|b[âa]timent|[ée]cole|station)|dans chacune)", re.I
)


def _kind(before: str, after: str) -> str:
    if UNIT.search(after):
        return "unitaire"
    best, pos = "indéterminé", -1
    for name, rx in CUES:
        for m in re.finditer(rx, before[-90:], re.I):
            if m.start() > pos:
                best, pos = name, m.start()
    return best


def _pairs(o: Any, p: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(o, dict):
        for k, v in o.items():
            yield from _pairs(v, f"{p}/{k}")
    elif isinstance(o, list):
        for v in o:
            yield from _pairs(v, p)
    elif o not in (None, ""):
        yield p, str(o)


def _under(o: Any, key: str) -> Iterator[Any]:
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key:
                yield v
            yield from _under(v, key)
    elif isinstance(o, list):
        for v in o:
            yield from _under(v, key)


def _items(v: Any) -> list[Any]:
    return v if isinstance(v, list) else [v]


def _t(v: Any) -> Any:
    return v.get("#text") if isinstance(v, dict) else v


def _amount(v: Any) -> float | None:
    v = _t(v)
    try:
        return float(str(v).replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def _first(v: Any) -> Any:
    return (v[0] if isinstance(v, list) and v else v) or {}


def _linked(v: Any) -> list[str]:
    if not v:
        return []
    txt = v if isinstance(v, str) else json.dumps(v)
    return sorted(set(re.findall(r"\b\d{2}-\d{4,7}\b", txt)))


def _lieu(d: Any) -> dict[str, str]:
    def first(o: Any, keys: set[str]) -> str | None:
        if isinstance(o, dict):
            for k, v in o.items():
                if k in keys and isinstance(v, (str, int)):
                    return str(v)
            for v in o.values():
                if r := first(v, keys):
                    return r
        if isinstance(o, list):
            for v in o:
                if r := first(v, keys):
                    return r
        return None

    cp, ville = first(d, {"CP", "cbc:PostalZone"}), first(d, {"VILLE", "cbc:CityName"})
    if ville:
        ville = re.sub(r"\s+cedex.*$", "", ville, flags=re.I).strip()
    return {"cp": cp or "", "ville": ville or ""}


# --- an eForms notice's own fields (from 2024: the DILA's daily files) ----------------------
# The codes are eForms' code lists (winner-selection-status, procurement-procedure-type,
# award-criterion-type, number-weight), kept as they are; the site words them.
ISSUES = {"selec-w": "attribue", "clos-nw": "sans_attributaire", "open-nw": "pas_encore"}
MOIS = {"MONTH": 1.0, "YEAR": 12.0, "DAY": 12 / 365.25, "WEEK": 12 / 52.18}


def _dict(v: Any) -> dict[str, Any]:
    v = _first(v)
    return v if isinstance(v, dict) else {}


def _num(v: Any) -> float | None:
    n = _amount(v)
    return int(n) if n is not None and n == int(n) else n


def _duree(project: dict[str, Any]) -> float | None:
    """A lot's duration in months: its DurationMeasure, else its start and end days."""
    pp = _dict(project.get("cac:PlannedPeriod"))
    dm = pp.get("cbc:DurationMeasure")
    if dm is not None:
        unit = dm.get("@unitCode") if isinstance(dm, dict) else None
        n = _amount(dm)
        if n is not None and unit in MOIS:
            return round(n * MOIS[unit], 1)
    a, b = str(_t(pp.get("cbc:StartDate")) or "")[:10], str(_t(pp.get("cbc:EndDate")) or "")[:10]
    if re.fullmatch(r"\d{4}-\d\d-\d\d", a) and re.fullmatch(r"\d{4}-\d\d-\d\d", b):
        import datetime as dt

        days = (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days + 1
        return round(days * 12 / 365.25, 1) if days > 0 else None
    return None


def _adresse(a: Any) -> dict[str, str]:
    a = _dict(a)
    ville = str(_t(a.get("cbc:CityName")) or "").strip()
    ville = re.sub(r"\s+cedex.*$", "", ville, flags=re.I).strip()
    return {
        "cp": str(_t(a.get("cbc:PostalZone")) or "").strip(),
        "ville": ville,
        "nuts": str(_t(a.get("cbc:CountrySubentityCode")) or "").strip(),
    }


def _criteres(lot: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    terms = _dict(_dict(lot.get("cac:TenderingTerms")).get("cac:AwardingTerms"))
    for c in _items(terms.get("cac:AwardingCriterion") or []):
        for sub in _items(_dict(c).get("cac:SubordinateAwardingCriterion") or []):
            if not isinstance(sub, dict):
                continue
            param = next(iter(_under(sub, "efac:AwardCriterionParameter")), None)
            param = _dict(param)
            out.append(
                {
                    "type": _t(sub.get("cbc:AwardingCriterionTypeCode")),
                    "poids": _num(param.get("efbc:ParameterNumeric")),
                    "unite": _t(param.get("efbc:ParameterCode")),
                }
            )
    return out


def eforms(don: Any) -> dict[str, Any] | None:
    """What an eForms notice says besides its holders: the procedure, the buyer's place and
    where the contract is performed, each lot (its duration, renewals, criteria and the price's
    weight) and each lot's result (awarded or not, the tenders received). None for a notice
    of the former schema."""
    if not isinstance(don, dict) or not any(_under(don, "efac:Organizations")):
        return None
    orgs = {}
    for o in _under(don, "efac:Organization"):
        for x in _items(o):
            comp = _dict(x.get("efac:Company")) if isinstance(x, dict) else {}
            oid = _t(_dict(comp.get("cac:PartyIdentification")).get("cbc:ID"))
            if oid:
                orgs[oid] = _adresse(comp.get("cac:PostalAddress"))
    party = _dict(_dict(don.get("cac:ContractingParty")).get("cac:Party"))
    buyer = _t(_dict(party.get("cac:PartyIdentification")).get("cbc:ID"))
    project = _dict(don.get("cac:ProcurementProject"))
    lots, where = [], _adresse(_dict(project.get("cac:RealizedLocation")).get("cac:Address"))
    for lot in _items(don.get("cac:ProcurementProjectLot") or []):
        if not isinstance(lot, dict):
            continue
        lp = _dict(lot.get("cac:ProcurementProject"))
        ext = _dict(lp.get("cac:ContractExtension"))
        crit = _criteres(lot)
        prix = [c["poids"] for c in crit if c["type"] == "price" and c["poids"] is not None]
        lots.append(
            {
                "lot": _t(lot.get("cbc:ID")),
                "titre": selection.texte(_t(lp.get("cbc:Name"))),
                "duree_mois": _duree(lp),
                "reconductions": _num(ext.get("cbc:MaximumNumberNumeric")),
                "criteres": crit,
                "poids_prix": sum(prix)
                if prix and all(str(c["unite"] or "").startswith("per") for c in crit)
                else None,
            }
        )
        if not where["ville"] and not where["cp"]:
            where = _adresse(_dict(lp.get("cac:RealizedLocation")).get("cac:Address"))
    results = []
    for nr in _under(don, "efac:NoticeResult"):
        for lr in _items(_dict(nr).get("efac:LotResult") or []):
            if not isinstance(lr, dict):
                continue
            offres = [
                _num(st.get("efbc:StatisticsNumeric"))
                for st in _items(lr.get("efac:ReceivedSubmissionsStatistics") or [])
                if isinstance(st, dict) and _t(st.get("efbc:StatisticsCode")) == "tenders"
            ]
            code = _t(lr.get("cbc:TenderResultCode"))
            results.append(
                {
                    "lot": _t(_dict(lr.get("efac:TenderLot")).get("cbc:ID")),
                    "issue": ISSUES.get(str(code), code),
                    "offres": offres[0] if offres else None,
                    "motif": _t(
                        _dict(lr.get("efac:DecisionReason")).get("efbc:DecisionReasonCode")
                    ),
                }
            )
    issues = {r["issue"] for r in results}
    one = len(results) == 1
    return {
        "procedure": _t(_dict(don.get("cac:TenderingProcess")).get("cbc:ProcedureCode")),
        "lieu_acheteur": orgs.get(buyer) or {"cp": "", "ville": "", "nuts": ""},
        "lieu_execution": where,
        "lots": lots,
        "resultats": results,
        "issue": (issues.pop() if len(issues) == 1 else "mixte") if results else None,
        "offres": results[0]["offres"] if one else None,
        "duree_mois": max((x["duree_mois"] for x in lots if x["duree_mois"]), default=None),
        "reconductions": max(
            (x["reconductions"] for x in lots if x["reconductions"]), default=None
        ),
    }


def _resultat(don: Any) -> dict[str, Any]:
    sirens, keys, montants, estim, dates = set(), set(), [], [], set()
    for t in _under(don, "TITULAIRE"):
        for x in _items(t):
            if isinstance(x, dict):
                if s := selection.siren_of(x.get("CODE_IDENT_NATIONAL")):
                    sirens.add(s)
                if x.get("DENOMINATION_CLE"):
                    keys.add(x["DENOMINATION_CLE"])
    for r in _under(don, "RENSEIGNEMENT"):
        for x in _items(r):
            if isinstance(x, dict):
                if m := _amount(x.get("MONTANT")):
                    montants.append(m)
                if x.get("DATE_ATTRIBUTION"):
                    dates.add(str(x["DATE_ATTRIBUTION"])[:10])
    for c in _under(don, "CARACTERISTIQUES"):
        for x in _items(c):
            if isinstance(x, dict) and _amount(x.get("VALEUR")):
                estim.append(_amount(x.get("VALEUR")))
    orgs = {}
    for o in _under(don, "efac:Organization"):
        for x in _items(o):
            comp = x.get("efac:Company") if isinstance(x, dict) else None
            if isinstance(comp, dict):
                oid = _t(_first(comp.get("cac:PartyIdentification")).get("cbc:ID"))
                le = _first(_first(comp.get("cac:PartyLegalEntity")).get("cbc:CompanyID"))
                key = _first(comp.get("cac:PartyName")).get("cbc:Name_cle") or ""
                orgs[oid] = (selection.siren_of(_t(le)), key, bool(x.get("personne_physique")))
    personnes = set()
    for tp in _under(don, "efac:TenderingParty"):
        for x in _items(tp):
            for ten in _under(x, "efac:Tenderer"):
                for y in _items(ten):
                    oid = _t(y.get("cbc:ID")) if isinstance(y, dict) else None
                    s, k, person = orgs.get(oid, ("", "", False))
                    if person:
                        personnes.add(oid)  # a holder who is a person: counted, never named
                        continue
                    if s:
                        sirens.add(s)
                    if k:
                        keys.add(k)
    for k in ("cbc:PayableAmount", "efbc:ReestimatedValueAmount", "cbc:LegalMonetaryTotal"):
        for v in _under(don, k):
            if m := _amount(v):
                montants.append(m)
    for k in ("cbc:EstimatedOverallContractAmount", "efbc:FrameworkMaximumAmount"):
        for v in _under(don, k):
            if m := _amount(v):
                estim.append(m)
    for sc in _under(don, "efac:SettledContract"):
        for x in _items(sc):
            if isinstance(x, dict) and x.get("cbc:IssueDate"):
                dates.add(str(x["cbc:IssueDate"])[:10])
    low = json.dumps(don, ensure_ascii=False).lower()
    buyers = (
        sum(1 for _ in _under(don, "cac:ContractingParty")) if "cac:contractingparty" in low else 0
    )  # noqa: E501
    groupement = (
        "agit_pour_autre_compte_oui" in low
        or "groupement de commandes" in low
        or re.search(r"coordonn?ateur|coordinateur", low) is not None
        or buyers > 1
    )
    return {
        "titulaires": sorted(sirens),
        "cles": sorted(keys),
        "montant_attribue": round(sum(montants), 2) if montants else None,
        "date_attribution": min(dates) if dates else None,
        "valeur_estimee": max(estim) if estim else None,
        "groupement": groupement,
        "titulaires_personnes": len(personnes),
    }


def notice(r: dict[str, Any]) -> dict[str, Any] | None:
    """A collected record, read; None when it is not about video surveillance."""
    d = r.get("donnees") or {}
    d = json.loads(d) if isinstance(d, str) else d
    pairs = list(_pairs(d))
    text = " ".join(v for p, v in pairs if TEXT.search(p) and not SKIP.search(p))
    text = re.sub(r"\s+", " ", f"{r.get('objet') or ''} {text}")
    if not selection.video_notice(text):
        return None
    sirets = sorted({
        m for p, v in pairs for m in re.findall(r"(?<!\d)\d{14}(?!\d)", v.replace(" ", ""))
        if selection.luhn(m) and not re.search(r"TEL|FAX|Telephone", p, re.I)
    })  # fmt: skip
    cpv = sorted({
        m for p, v in pairs if re.search(r"CPV|ItemClassificationCode", p)
        for m in re.findall(r"\b\d{8}\b", v)
    })  # fmt: skip
    nouvelles = 0
    for m in QTY.finditer(text):
        n = int(m.group(1))
        if NOT_QTY.search(text[max(0, m.start() - 12) : m.start()]) or n == 0 or n > 2000:
            continue
        k = _kind(text[max(0, m.start() - 100) : m.start()], text[m.end() : m.end() + 40])
        if re.search(r"nouvel|nouveaux|futures?", m.group(0), re.I):
            k = "nouvelles"
        if k == "nouvelles":
            nouvelles = max(nouvelles, n)
    natures = selection.rules()["liens"]["natures"]
    ef = eforms(d)
    lies = set(_linked(r.get("annonce_lie")) + _linked(r.get("annonces_anterieures")))
    return {
        "idweb": r["idweb"],
        "date": str(r.get("dateparution") or "")[:10],
        "nature": natures.get(r.get("nature_libelle") or "", "avis"),
        "famille": r.get("famille"),
        "departements": list(r.get("code_departement") or []),
        "acheteur": r.get("nomacheteur") or "",
        "objet": selection.texte(r.get("objet")),
        "sirets": sirets,
        "cpv": cpv,
        "avis_lies": sorted(lies - {r["idweb"]}),
        "cameras": nouvelles or None,
        "url": r.get("url_avis"),
        "lieu": _lieu_de(d, ef),
        "resultat": _resultat(d),
        "eforms": ef,
    }


def _lieu_de(d: Any, ef: dict[str, Any] | None) -> dict[str, str]:
    """Where a notice is: an eForms notice's buyer (its own organisation, never the first
    address met, which is often the platform that sent it: Avenue-Web Systèmes at
    Seyssinet-Pariset for Lyon's 25-71998), else where it is performed; a former notice's
    first address."""
    if ef:
        for k in ("lieu_acheteur", "lieu_execution"):
            if ef[k]["ville"] or ef[k]["cp"]:
                return {"cp": ef[k]["cp"], "ville": ef[k]["ville"]}
    return _lieu(d)


def notices_of(records: Iterable[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    """The video surveillance notices among cleaned records, each idweb once (the first)."""
    seen = set()
    for r in records:
        if r["idweb"] in seen:
            continue
        seen.add(r["idweb"])
        if (n := notice(r)) is not None:
            yield n


def notices(paths: Iterable[Path]) -> Iterator[dict[str, Any]]:
    def records() -> Iterator[dict[str, Any]]:
        for p in paths:
            with p.open(encoding="utf-8") as fh:
                for line in fh:
                    yield json.loads(line)

    return notices_of(records())


def write(out: Path, items: Iterable[dict[str, Any]]) -> int:
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.name}.tmp")
    n = 0
    with gzip.open(tmp, "wt", encoding="utf-8") as g:
        for x in items:
            g.write(json.dumps(x, ensure_ascii=False, separators=(",", ":")) + "\n")
            n += 1
    tmp.replace(out)
    return n


def load(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as g:
        for line in g:
            yield json.loads(line)
