"""The BOAMP (Bulletin officiel des annonces des marchés publics, DILA): the calls for tenders,
their results and corrections about video surveillance, France since `first_year`.

Collection (`collect`): the DILA's records API (rules/registre_sources.yaml `sources.boamp`),
one request per second, the search words of rules/registre_selection.yaml `liens.recherche`,
page by page within a month (the API stops at offset 10 000). The first collection asks every
month since January `first_year`; the next ones ask again from the last month collected (a
notice may be published late in a month already read) to now. Each month's notices go to
brut/boamp/<YYYY-MM>.jsonl, written whole, without any natural person: the contact blocks
(names, e-mails, phones), the holders' names and, in free text, e-mails, phones and a civility
or a rank followed by a name are removed before anything is written (the exploration's
sanitize.py). The API's pages are not cached (fetch cache=False): no raw body is kept.

Reading (`parse`, `notices`): every notice that names video surveillance (`video_notice` in
its objet and its text), normalised: {idweb, date, nature, famille, departements, acheteur,
objet, sirets (Luhn-valid, never a phone), cpv, avis_lies, cameras (the new cameras it
counts), url, lieu {cp, ville}, resultat {titulaires (SIREN), cles (SHA-256 of a holder's
normalised name, never the name), montant_attribue, valeur_estimee, date_attribution,
groupement}}, to <root>/national/boamp.jsonl.gz.
"""

from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import re
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from lacarte_registre import fetch, selection

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
}  # fmt: skip


def _holder(h: Any) -> dict[str, Any]:
    if not isinstance(h, dict):
        return {}
    out = {k: v for k, v in h.items() if k in ("CODE_IDENT_NATIONAL", "TYPE_IDENT_NATIONAL")}
    # a holder's name only as its fingerprint, to be compared with SIRENE's
    if h.get("DENOMINATION"):
        out["DENOMINATION_CLE"] = cle(str(_t(h["DENOMINATION"]) or ""))
    return out


def _walk(o: Any) -> Any:
    if isinstance(o, dict):
        natural = str(o.get("efbc:NaturalPersonIndicator", "")).lower() == "true"
        out = {}
        for k, v in o.items():
            if k in DROP_KEYS:
                continue
            if k == "TITULAIRE":
                v = [_holder(x) for x in v] if isinstance(v, list) else _holder(v)
                out[k] = v
                continue
            if natural and k in ("cac:PartyName", "cac:PostalAddress"):
                continue
            if k == "cac:PartyName":
                # an organisation's name (a holder may be a sole trader): its fingerprint only;
                # the buyer's name is the record's own `nomacheteur`
                out[k] = [_party(x) for x in v] if isinstance(v, list) else _party(v)
                continue
            out[k] = _walk(v)
        return out
    if isinstance(o, list):
        return [_walk(v) for v in o]
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


# --- collection ---------------------------------------------------------------------------
def months(first: dt.date, last: dt.date) -> Iterator[str]:
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        yield f"{y:04d}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def _where(month: str, departements: set[str] | None) -> str:
    words = selection.rules()["liens"]["recherche"]
    y, m = (int(x) for x in month.split("-"))
    nxt = f"{y + 1:04d}-01-01" if m == 12 else f"{y:04d}-{m + 1:02d}-01"
    w = "(" + " or ".join(f'search(objet, "{x}")' for x in words) + ")"
    w += f" and dateparution >= date'{month}-01' and dateparution < date'{nxt}'"
    if departements:
        w += " and (" + " or ".join(f'code_departement = "{d}"' for d in sorted(departements)) + ")"
    return w


def collect_month(f: fetch.Fetcher, month: str, departements: set[str] | None) -> int:
    src = f.conf["sources"][SOURCE]
    size = int(src["page_size"])
    out = f.dir / f"{month}.jsonl"
    tmp = out.with_suffix(".tmp")
    n, offset = 0, 0
    with tmp.open("w", encoding="utf-8") as fh:
        while True:
            params = {"where": _where(month, departements), "select": FIELDS, "limit": size,
                      "offset": offset, "order_by": "idweb"}  # fmt: skip
            page = f.get_json(src["api"], params, cache=False)
            for rec in page.get("results", []):
                fh.write(json.dumps(clean(rec), ensure_ascii=False) + "\n")
                n += 1
            offset += size
            if offset >= int(page.get("total_count") or 0) or not page.get("results"):
                break
    tmp.replace(out)
    return n


def collect(
    f: fetch.Fetcher,
    out_dir: Path,
    departements: set[str] | None = None,
    resume: bool = False,
    today: dt.date | None = None,
) -> dict[str, Any]:
    """Every month not yet read (or read last), then the normalised notices."""
    today = today or dt.date.today()
    first = dt.date(int(f.conf["sources"][SOURCE]["first_year"]), 1, 1)
    st = f.state()
    done = st.get("mois_lus") or []
    if resume and (st.get("curseur") or {}).get("mois"):
        start = st["curseur"]["mois"]
    elif done:
        start = max(done)  # the last month read again: late publications
    else:
        start = first.strftime("%Y-%m")
    y, m = (int(x) for x in start.split("-"))
    total = 0
    for month in months(dt.date(y, m, 1), today):
        f.save_state(statut="en_cours", curseur={"mois": month})
        total += collect_month(f, month, departements)
        done = sorted(set(done) | {month})
        f.save_state(mois_lus=done)
    n = write(out_dir / "boamp.jsonl.gz", notices(sorted(f.dir.glob("????-??.jsonl"))))
    summary = {"source": SOURCE, "avis": n, "mois": len(done), "lus_cette_fois": total,
               "departements": sorted(departements) if departements else None,
               "requetes": f.requests}  # fmt: skip
    (out_dir / "boamp.json").write_text(json.dumps(summary, ensure_ascii=False), "utf-8")
    return summary


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
                orgs[oid] = (selection.siren_of(_t(le)), key)
    for tp in _under(don, "efac:TenderingParty"):
        for x in _items(tp):
            for ten in _under(x, "efac:Tenderer"):
                for y in _items(ten):
                    s, k = orgs.get(_t(y.get("cbc:ID")) if isinstance(y, dict) else None, ("", ""))
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
        "lieu": _lieu(d),
        "resultat": _resultat(d),
    }


def notices(paths: Iterable[Path]) -> Iterator[dict[str, Any]]:
    seen = set()
    for p in paths:
        with p.open(encoding="utf-8") as fh:
            for line in fh:
                r = json.loads(line)
                if r["idweb"] in seen:
                    continue
                seen.add(r["idweb"])
                if (n := notice(r)) is not None:
                    yield n


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
