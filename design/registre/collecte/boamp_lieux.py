"""The buyer's commune of each BOAMP notice, read in the notice's own address (legacy CP/VILLE, or eForms
cbc:PostalZone/cbc:CityName of the first organisation), matched to the COG by name and département.

Usage: python -I boamp_lieux.py <marches dir>
Writes data/derived/boamp/lieux_acheteurs.csv (idweb, cp, ville, insee) and prototype-v9/lieux_avis.js
(window.LIEUX_AVIS = {idweb: insee}). The raw notices are purged on 2026-11-22; this derived table stays.
"""
import csv
import json
import os
import re
import sys
import unicodedata

M = sys.argv[1]
plain = lambda s: re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()).replace(" st ", " saint ").strip()
geo = json.load(open(os.path.join(M, "data/raw/geo_pop/communes_france.json")))
by = {}
for c in geo:
    by.setdefault((plain(c["nom"]), c["codeDepartement"]), c["code"])
ARR = {"paris": "75056", "lyon": "69123", "marseille": "13055"}


def first(d, keys):
    if isinstance(d, dict):
        for k, v in d.items():
            if k in keys and isinstance(v, (str, int)):
                return str(v)
        for v in d.values():
            r = first(v, keys)
            if r:
                return r
    if isinstance(d, list):
        for v in d:
            r = first(v, keys)
            if r:
                return r
    return None


rows, out = [], {}
seen = set()
for fn in ("pilotes_full.jsonl", "idf_full.jsonl", "all_full.jsonl"):
    p = os.path.join(M, "data/raw/boamp", fn)
    if not os.path.exists(p):
        continue
    for line in open(p):
        d = json.loads(line)
        if d["idweb"] in seen:
            continue
        seen.add(d["idweb"])
        g = d.get("donnees"); g = json.loads(g) if isinstance(g, str) else g
        cp, ville = first(g, {"CP", "cbc:PostalZone"}), first(g, {"VILLE", "cbc:CityName"})
        if isinstance(ville, str):
            ville = re.sub(r"\s+cedex.*$", "", ville, flags=re.I).strip()
        insee = None
        if cp and ville:
            dep = cp[:3] if cp.startswith("97") else cp[:2]
            v = plain(re.sub(r"\b\d+(er|e)?\b", "", ville))
            insee = ARR.get(v.split(" ")[0]) if v.split(" ")[0] in ARR and dep in ("75", "69", "13") else by.get((v, dep))
        rows.append({"idweb": d["idweb"], "cp": cp or "", "ville": ville or "", "insee": insee or ""})
        if insee:
            out[d["idweb"]] = insee
os.makedirs(os.path.join(M, "data/derived/boamp"), exist_ok=True)
with open(os.path.join(M, "data/derived/boamp/lieux_acheteurs.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["idweb", "cp", "ville", "insee"]); w.writeheader(); w.writerows(rows)
open(os.path.join(M, "prototype-v9/lieux_avis.js"), "w").write("// The buyer's commune of each BOAMP notice (scripts/boamp_lieux.py)\nwindow.LIEUX_AVIS = " + json.dumps(out, separators=(",", ":")) + ";\n")
print(len(rows), "avis lus ;", len(out), "avec une commune d'acheteur ;", sum(1 for r in rows if r["ville"] and not r["insee"]), "villes non rapprochées")
