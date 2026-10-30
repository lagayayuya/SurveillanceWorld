"""Extract vidéoprotection lines from the sampled prefectures' DETR (and DSIL) lists.

Usage: python -I extract_detr_sample.py <raw_dir> <out_csv>
Reads the files named in FILES (ods/xlsx via pandas, pdf via pdfplumber tables), finds the
header row, maps columns by header words, keeps rows whose label matches VIDEO.
Output columns: dept, file, sheet, programme, beneficiaire, libelle, cout_ht, subvention.
"""
import csv, re, sys
import pandas as pd
import pdfplumber

VIDEO = re.compile(r"vid[ée]o[\s\-]*(?:protec|surveil)|cam[ée]ras?\b(?!\s+pi[ée]ton)|\bCSU\b|vid[ée]oprot", re.I)
FILES = [  # dept, file, programme (DETR unless the column says otherwise)
    ("03", "03_detr_2025.xlsx", "DETR"), ("28", "28_detr_dsil_2025.pdf", "DETR/DSIL"),
    ("31", "31_prog_2025.ods", "DETR"), ("33", "33_detr_2025.pdf", "DETR"),
    ("34", "34_detr_2025.ods", "DETR"), ("47", "47_detr_2025.ods", "DETR"),
    ("53", "53_detr_2025.pdf", "DETR"), ("70", "70_detr_2026_06.ods", "DETR"),
    ("76", "76_detr_2025.ods", "DETR"),
]
BEN = re.compile(r"collectivit|b[ée]n[ée]ficiaire|ma[iî]tre d|^commune|nom de la|demandeur", re.I)
LAB = re.compile(r"intitul|nature|projet|op[ée]ration|investissement|objet", re.I)
COST = re.compile(r"co[uû]t|d[ée]penses|subventionnable|[ée]ligible|travaux|assiette|base|\bH\.?T\b|pr[ée]visionnel", re.I)
SUB = re.compile(r"accord|^subvention|montant (de )?(la |l')?(subvention|detr|aide)|^detr$|detr\+|subventions 20|montant detr|attribu", re.I)
LAB1 = re.compile(r"intitul|nature", re.I)
INSEE = re.compile(r"code insee", re.I)


def num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    s = re.sub(r"[€\s  ]", "", str(v)).replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return ""


def tables(path):
    if path.endswith(".pdf"):
        with pdfplumber.open(path) as pdf:
            rows = [r for pg in pdf.pages for t in pg.extract_tables() for r in t]
        yield "pdf", [[(c or "").replace("\n", " ").strip() for c in r] for r in rows]
    else:
        for sh, df in pd.read_excel(path, sheet_name=None, header=None, dtype=str).items():
            yield sh, [["" if pd.isna(c) else str(c).replace("\n", " ").strip() for c in r] for r in df.values.tolist()]


out = []
last_ben = ""
for dept, fn, prog in FILES:
    for sh, rows in tables(f"{sys.argv[1]}/{fn}"):
        hdr = None
        for r in rows:
            cells = [c for c in r if c]
            if hdr is None or (sum(bool(BEN.search(c)) for c in cells) and sum(bool(LAB.search(c)) for c in cells) and len(cells) >= 2 and not any(VIDEO.search(c) for c in cells)):
                if any(BEN.search(c) for c in r) and any(LAB.search(c) for c in r):
                    hdr = r
                    col = {}
                    for i, c in enumerate(r):
                        if c and INSEE.search(c):
                            col["insee"] = i
                            continue
                        if c and LAB1.search(c) and "lab" not in col and not BEN.search(c):
                            col["lab"] = i
                            continue
                    for i, c in enumerate(r):
                        if i in col.values():
                            continue
                        for k, p in (("ben", BEN), ("sub", SUB), ("cost", COST), ("lab", LAB)):
                            if c and p.search(c) and k not in col and not (k == "lab" and "ben" in col and col["ben"] == i):
                                col[k] = i
                                break
                    if "ben" in col and col.get("lab") == col["ben"]:
                        col.pop("lab")
                    continue
            if hdr is None or "lab" not in col:
                continue
            if col.get("ben") is not None and col["ben"] < len(r):
                if r[col["ben"]]:
                    last_ben = r[col["ben"]]
                else:  # merged cell: beneficiary given on an earlier row
                    r = list(r); r[col["ben"]] = last_ben
            lab = r[col["lab"]] if col["lab"] < len(r) else ""
            if not VIDEO.search(lab):
                continue
            g = lambda k: r[col[k]] if k in col and col[k] < len(r) else ""
            sub = g("sub")
            if dept == "28":  # columns DETR, DETR Eau, DSIL, DSIL contractualisée / FNADT, total
                p = [n for n, i in (("DETR", 3), ("DETR Eau", 4), ("DSIL", 5), ("DSIL contractualisée/FNADT", 6)) if r[i]]
                prog = "+".join(p) or "DETR/DSIL"
                sub = r[3] if r[3] and not r[4] and not r[5] and not r[6] else r[7]  # DETR alone: exact column; mixed: total
            out.append(dict(dept=dept, file=fn, sheet=sh, programme=prog if dept == "28" else "DETR",
                            beneficiaire=g("ben"), insee=g("insee"), libelle=lab, cout_ht=num(g("cost")), subvention=num(sub),
                            header="|".join(hdr)))
with open(sys.argv[2], "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)
print(len(out), "video lines")
for d in sorted({o["dept"] for o in out}):
    print(d, sum(o["dept"] == d for o in out))
