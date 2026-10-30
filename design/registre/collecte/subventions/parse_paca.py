"""Parse Région Sud (PACA) CP 'Tableau_financier.pdf' annexes (pdftotext -layout).

Usage: python -I parse_paca.py <out_csv> <pdf>...
One row per dossier: file, cp_date, dossier, objet, beneficiaire, code_postal, base_ht, subvention.
Natural persons never appear in these tables (beneficiaries are communes / EPCI / associations).
"""
import csv, re, subprocess, sys

DOS = re.compile(r"^\s{0,4}(\d{4}_\d{5}|R?\d{7,8}-\d)\s+(.*?)\s{2,}([\d\s  ]+,\d{2}) € (?:HT|TTC)\s+([\d\s  ]+,\d{2}) €")
BEN = re.compile(r"^\s+(.*?\S)\s+(\d{9}|\d{5})(?:\b[\s-]|\s*$)")
SKIP = re.compile(r"Région Provence|COMMISSION PERMANENTE|AFFECTATION|Subventions proportionnelles|Type d'intervention|INVESTISSEMENT|Investissement|Exercice|Z:Sécurité|Secteur Z|S300|Programme S300|FORCES DE SECURITE|Hors [Pp]lan|Dossier|Subventionnable|^\s*\d+/\d+\s*$|^\s*\d\d/\d\d/\d{4}\s*$|Total|TOTAL")


def num(s):
    return float(re.sub(r"[\s  ]", "", s).replace(",", "."))


rows = []
for pdf in sys.argv[2:]:
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    m = re.search(r"COMMISSION PERMANENTE DU (\d+ \w+ \d{4})", txt)
    cp = m.group(1) if m else ""
    cur = None
    for line in txt.splitlines():
        if not line.strip():
            continue
        d = DOS.match(line)
        if d:
            if cur:
                rows.append(cur)
            cur = dict(file=pdf.rsplit("/", 1)[-1], cp_date=cp, dossier=d.group(1), objet=d.group(2).strip(),
                       beneficiaire="", code_postal="", siren="", base_ht=num(d.group(3)), subvention=num(d.group(4)))
            continue
        if cur is None or SKIP.search(line):
            continue
        if cur["code_postal"] or cur["siren"]:
            continue  # wrapped town name after the beneficiary line
        b = BEN.match(line)
        if b and re.match(r"(COMMUNE|COM |CA |CC |COMMUNAUTE|METROPOLE|SYND|SIVOM|SIVU|MAIRIE|VILLE|ASSOC|ASS |EPCI|REGIE|OFFICE|CENTRE|SDIS|DEPARTEMENT)", b.group(1), re.I):
            cur["beneficiaire"] = b.group(1)
            if len(b.group(2)) == 9:
                cur["siren"] = b.group(2)
            else:
                cur["code_postal"] = b.group(2)
        else:
            cur["objet"] += " " + line.strip()
    if cur:
        rows.append(cur)
TAIL = re.compile(r"\s((?:COMMUNE ?D[EU']?\s?|COM )?[A-ZÉÈÀÂÎÔÛÇ' \-]{3,}?)\s(\d{9}|\d{5})(?:-\S.*| [A-Z' \-]+)?$")
for r in rows:  # beneficiary line glued to the object (no SIREN/postcode on its own line)
    if not (r["code_postal"] or r["siren"]):
        t = TAIL.search(r["objet"])
        if t:
            r["beneficiaire"] = t.group(1).strip()
            r["siren" if len(t.group(2)) == 9 else "code_postal"] = t.group(2)
            r["objet"] = r["objet"][: t.start()].strip()
with open(sys.argv[1], "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(len(rows), "rows;", sum(1 for r in rows if not (r["code_postal"] or r["siren"])), "without beneficiary/postcode")
