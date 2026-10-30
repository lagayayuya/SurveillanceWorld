"""Parse BOAMP notices: buyer SIRET, CPV, linked notices, and camera quantities.

Usage: python -I boamp_parse.py <pilotes_full.jsonl> <out_dir>

Personal data: contact blocks (names, e-mails, phones, addresses) are never read into
the outputs; holders' names are not kept either (DECP gives them by SIRET).
"""

import json
import re
import sys
from pathlib import Path

import pandas as pd

src, out = sys.argv[1], Path(sys.argv[2])
SKIP = re.compile(r"IDENTITE|CORRESPONDANT|MEL|TEL|FAX|ADRESSE|Contact|Telephone|Email|ElectronicMail|StreetName"
                  r"|PostalZone|Person|TITULAIRE|tendering-party|Winning", re.I)
TEXT = re.compile(r"OBJET|DESCRIPTION|Description|cbc:Name|INTITULE|LOT|QUANTITE|CARACTERISTIQUES|Note", re.I)
QTY = re.compile(
    r"(?<![\w,.])(\d{1,4})\s+(?:nouvelles?\s+|nouveaux\s+|futures?\s+)?(?:cam[ée]ras?|points?\s+de\s+vid[ée]o(?:protection)?)",
    re.I,
)
NOT_QTY = re.compile(r"(lot|n°|no|article|art\.|annexe)\s*$", re.I)
# What the number counts: the cue word nearest before the number wins (hand-read sample,
# boamp_quantites_echantillon.csv). "par rame", "chaque" just after it make it a per-unit count.
CUES = [
    ("parc existant", r"maintenance|maintenir|compos[ée]e?s?|existant|actuel|d[ée]j[àa]|dispose|en service|parc|op[ée]rationnel|analogiques|int[ée]gr"),
    ("nouvelles", r"nouvel|nouveaux|suppl[ée]mentaires|install|pose|fourniture|d[ée]ploi|mise en (place|oeuvre|œuvre)|ajout|extension|implant"
                  r"|cr[ée]ation|acquisition|achat|remplac|[ée]tendre|tranche|phase|ann[ée]e"),
]
UNIT = re.compile(r"^\W{0,3}(par\s+(rame|v[ée]hicule|bus|site|b[âa]timent|[ée]cole|station)|dans chacune)", re.I)
VIDEO_NOTICE = re.compile(r"vid[ée]o[\s\-]*(protection|surveillance)|\bcsu\b|supervision urbaine|cam[ée]ras?\s+(de\s+(surveillance|vid[ée]o|s[ée]curit[ée])|pi[ée]ton|nomade)", re.I)


def kind(before: str, after: str) -> str:
    if UNIT.search(after):
        return "unitaire"
    best, pos = "indéterminé", -1
    for name, rx in CUES:
        for m in re.finditer(rx, before[-90:], re.I):
            if m.start() > pos:
                best, pos = name, m.start()
    return best


def walk(o, p=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, f"{p}/{k}")
    elif isinstance(o, list):
        for v in o:
            yield from walk(v, p)
    elif o not in (None, ""):
        yield p, str(o)


def luhn(n: str) -> bool:
    s = 0
    for i, ch in enumerate(reversed(n)):
        d = int(ch) * (2 if i % 2 else 1)
        s += d - 9 if d > 9 else d
    return s % 10 == 0


def linked(v) -> list[str]:
    if not v:
        return []
    txt = v if isinstance(v, str) else json.dumps(v)
    return sorted(set(re.findall(r"\b\d{2}-\d{4,7}\b", txt)))


rows, qty_rows = [], []
for line in open(src):
    r = json.loads(line)
    d = json.loads(r["donnees"]) if r.get("donnees") else {}
    pairs = list(walk(d))
    text = " ".join(v for p, v in pairs if TEXT.search(p) and not SKIP.search(p))
    text = re.sub(r"\s+", " ", f"{r.get('objet') or ''} {text}")
    sirets = sorted({m for p, v in pairs for m in re.findall(r"(?<!\d)\d{14}(?!\d)", v.replace(" ", ""))
                     if luhn(m) and not re.search(r"TEL|FAX|Telephone", p, re.I)})
    cpv = sorted({m for p, v in pairs if re.search(r"CPV|ItemClassificationCode", p) for m in re.findall(r"\b\d{8}\b", v)})
    qtys = []
    is_video = bool(VIDEO_NOTICE.search(text))
    for m in QTY.finditer(text if is_video else ""):
        n = int(m.group(1))
        before = text[max(0, m.start() - 12):m.start()]
        if NOT_QTY.search(before) or n == 0 or n > 2000:
            continue
        k = kind(text[max(0, m.start() - 100):m.start()], text[m.end():m.end() + 40])
        if re.search(r"nouvel|nouveaux|futures?", m.group(0), re.I):  # « 17 nouvelles caméras »
            k = "nouvelles"
        qtys.append((n, k))
        qty_rows.append({"idweb": r["idweb"], "n": n, "type": k, "extrait": text[max(0, m.start() - 80):m.end() + 40]})
    rows.append({
        "idweb": r["idweb"], "dateparution": r["dateparution"], "nature": r["nature_libelle"], "famille": r["famille"],
        "departements": ",".join(r["code_departement"] or []), "acheteur": r["nomacheteur"], "objet": r["objet"],
        "sirets": ";".join(sirets), "cpv": ";".join(cpv),
        "avis_lies": ";".join(sorted(set(linked(r.get("annonce_lie")) + linked(r.get("annonces_anterieures"))) - {r["idweb"]})),
        "qty_nouvelles": sum(n for n, k in qtys if k == "nouvelles") or None,
        "qty_parc": max((n for n, k in qtys if k == "parc existant"), default=None),
        "qty_max": max(n for n, _ in qtys) if qtys else None, "qty_n": len(qtys), "url_avis": r["url_avis"], "texte_len": len(text), "objet_video": is_video,
    })

df = pd.DataFrame(rows)
df.to_parquet(out / "boamp_avis.parquet")
df.to_csv(out / "boamp_avis.csv", index=False)
pd.DataFrame(qty_rows).to_csv(out / "boamp_quantites.csv", index=False)
print(len(df), "avis;", (df.sirets != "").sum(), "avec SIRET;", df.qty_max.notna().sum(), "avec quantité;",
      (df.avis_lies != "").sum(), "liés")
print(df.groupby("nature").agg(n=("idweb", "size"), siret=("sirets", lambda s: (s != "").mean().round(2)),
                               qty=("qty_max", lambda s: s.notna().mean().round(2))))
