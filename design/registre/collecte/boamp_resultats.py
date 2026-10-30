"""From the BOAMP notices already collected: holders' SIRENs (digits only, never names), awarded
amounts, award dates and the estimated value of calls for tenders.

Usage: python -I boamp_resultats.py <out.csv> <notices.jsonl> [...]

Legacy schema: ATTRIBUTION/DECISION[*]/TITULAIRE/CODE_IDENT_NATIONAL (SIRET), RENSEIGNEMENT/MONTANT,
DATE_ATTRIBUTION; CARACTERISTIQUES/VALEUR for the estimate. eForms: the organisations that are
tenderers of a tendering party (efac:TenderingParty → efac:Tenderer → ORG-x → cbc:CompanyID),
cbc:IssueDate of settled contracts, efac:LotResult/cbc:… amounts. Only 9-digit SIRENs that pass
the Luhn check are kept; a holder's name is kept only as the SHA-256 of its normalised form
(sirene_whitelist.key), to be compared with SIRENE's name of a contract's holder.
"""

import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sirene_whitelist import key as name_key  # noqa: E402  SHA-256 of the normalised name


def luhn(s: str) -> bool:
    t = 0
    for i, c in enumerate(reversed(s)):
        d = int(c) * (2 if i % 2 else 1)
        t += d - 9 if d > 9 else d
    return t % 10 == 0


def siren_of(x) -> str:
    d = re.sub(r"\D", "", str(x or ""))
    return d[:9] if len(d) in (9, 14) and luhn(d[:9]) else ""


def walk(o, key):
    """Every value stored under `key` anywhere in o."""
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key:
                yield v
            yield from walk(v, key)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v, key)


def amount(v):
    if isinstance(v, dict):
        v = v.get("#text")
    try:
        return float(str(v).replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def text(v):
    return v.get("#text") if isinstance(v, dict) else v


rows = {}
for path in sys.argv[2:]:
    for line in open(path):
        d = json.loads(line)
        don = d.get("donnees")
        if isinstance(don, str):
            try:
                don = json.loads(don)
            except ValueError:
                continue
        if not don:
            continue
        sirens, montants, dates, estim, keys = set(), [], set(), [], set()
        # legacy
        for t in walk(don, "TITULAIRE"):
            for x in (t if isinstance(t, list) else [t]):
                if isinstance(x, dict):
                    s = siren_of(x.get("CODE_IDENT_NATIONAL"))
                    if s:
                        sirens.add(s)
                    if x.get("DENOMINATION"):
                        keys.add(name_key(text(x["DENOMINATION"])))
        for r in walk(don, "RENSEIGNEMENT"):
            for x in (r if isinstance(r, list) else [r]):
                if isinstance(x, dict):
                    m = amount(x.get("MONTANT"))
                    if m:
                        montants.append(m)
                    if x.get("DATE_ATTRIBUTION"):
                        dates.add(str(x["DATE_ATTRIBUTION"])[:10])
        for c in walk(don, "CARACTERISTIQUES"):
            for x in (c if isinstance(c, list) else [c]):
                if isinstance(x, dict) and amount(x.get("VALEUR")):
                    estim.append(amount(x.get("VALEUR")))
        # eForms
        orgs = {}
        for o in walk(don, "efac:Organization"):
            for x in (o if isinstance(o, list) else [o]):
                comp = x.get("efac:Company") if isinstance(x, dict) else None
                if isinstance(comp, dict):
                    first = lambda v: (v[0] if isinstance(v, list) and v else v) or {}
                    oid = text(first(comp.get("cac:PartyIdentification")).get("cbc:ID"))
                    orgs[oid] = (siren_of(text(first(first(comp.get("cac:PartyLegalEntity")).get("cbc:CompanyID")))),
                                 name_key(text(first(first(comp.get("cac:PartyName")).get("cbc:Name"))) or ""))
        for tp in walk(don, "efac:TenderingParty"):
            for x in (tp if isinstance(tp, list) else [tp]):
                if isinstance(x, dict):
                    for ten in walk(x, "efac:Tenderer"):
                        for y in (ten if isinstance(ten, list) else [ten]):
                            s, k = orgs.get(text(y.get("cbc:ID")) if isinstance(y, dict) else None, ("", ""))
                            if s:
                                sirens.add(s)
                            if k:
                                keys.add(k)
        for k in ("cbc:PayableAmount", "efbc:ReestimatedValueAmount", "cbc:LegalMonetaryTotal"):
            for v in walk(don, k):
                m = amount(v)
                if m:
                    montants.append(m)
        for k in ("cbc:EstimatedOverallContractAmount", "efbc:FrameworkMaximumAmount"):
            for v in walk(don, k):
                m = amount(v)
                if m:
                    estim.append(m)
        for sc in walk(don, "efac:SettledContract"):
            for x in (sc if isinstance(sc, list) else [sc]):
                if isinstance(x, dict) and x.get("cbc:IssueDate"):
                    dates.add(str(x["cbc:IssueDate"])[:10])
        low = json.dumps(don, ensure_ascii=False).lower()
        n_buyers = sum(1 for _ in walk(don, "cac:ContractingParty")) if "cac:contractingparty" in low else 0
        groupement = ("agit_pour_autre_compte_oui" in low or "groupement de commandes" in low
                      or re.search(r"coordonn?ateur|coordinateur", low) is not None or n_buyers > 1)
        rows[d["idweb"]] = {"idweb": d["idweb"], "groupement_commandes": "oui" if groupement else "", "titulaires_siren": " ".join(sorted(sirens)), "titulaires_cles": " ".join(sorted(keys)),
                            "montant_attribue": round(sum(montants), 2) if montants else "",
                            "date_attribution": min(dates) if dates else "",
                            "valeur_estimee": max(estim) if estim else ""}
with open(sys.argv[1], "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["idweb", "groupement_commandes", "titulaires_siren", "titulaires_cles", "montant_attribue", "date_attribution", "valeur_estimee"])
    w.writeheader()
    w.writerows(rows.values())
print(len(rows), "avis ;", sum(1 for r in rows.values() if r["titulaires_siren"]), "avec SIREN du titulaire ;",
      sum(1 for r in rows.values() if r["titulaires_cles"]), "avec nom du titulaire (empreinte) ;",
      sum(1 for r in rows.values() if r["montant_attribue"] != ""), "avec montant ;",
      sum(1 for r in rows.values() if r["valeur_estimee"] != ""), "avec valeur estimée ;",
      sum(1 for r in rows.values() if r["groupement_commandes"]), "groupements de commandes")
