"""Print titulaires / lots of BOAMP records by idweb. Usage: python -I boamp_show.py <jsonl> <idweb>..."""
import json, re, sys
ids = set(sys.argv[2:])
for line in open(sys.argv[1], encoding="utf-8"):
    if not any(i in line for i in ids):
        continue
    d = json.loads(line)
    if d.get("idweb") not in ids:
        continue
    print("==", d.get("idweb"), d.get("dateparution"), d.get("nomacheteur"), d.get("objet"))
    s = json.dumps(d, ensure_ascii=False)
    # titulaire names / SIRET fragments
    for m in re.finditer(r'(?i)"(?:[^"]*(?:titulaire|attributaire|OfficialName|Name|Nom|CompanyID|siret|LotNumber|Title)[^"]*)"\s*:\s*"([^"]{2,200})"', s):
        print("  ", m.group(0)[:220])
