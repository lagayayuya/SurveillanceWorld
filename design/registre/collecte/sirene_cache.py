"""Look up holders in SIRENE (API Recherche d'entreprises), cached, ≤1 request per second.

Usage: python -I sirene_cache.py <cache.csv> <siren> [<siren> ...]   (or sirens on stdin)

Writes siren, raison_sociale (empty for a sole trader), nature_juridique, naf, etat, found.
A sole trader (nature juridique 1000) is never named: the registre shows « entrepreneur
individuel » and the SIREN.
"""

import csv
import os
import sys
import time

import requests

UA = "SurveillanceWorld-research (+<contact>)"
cache_path = sys.argv[1]
sirens = sys.argv[2:] or [l.strip() for l in sys.stdin if l.strip()]
done = {}
if os.path.exists(cache_path):
    done = {r["siren"]: r for r in csv.DictReader(open(cache_path))}
fields = ["siren", "raison_sociale", "nature_juridique", "naf", "etat", "found"]
new = [s for s in dict.fromkeys(sirens) if s not in done and len(s) == 9 and s.isdigit()]
with open(cache_path, "a", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    if not done:
        w.writeheader()
    for i, s in enumerate(new):
        try:
            r = requests.get("https://recherche-entreprises.api.gouv.fr/search", params={"q": s},
                             headers={"User-Agent": UA}, timeout=30).json()
            res = [x for x in r.get("results", []) if x.get("siren") == s]
        except Exception:
            res = None
        time.sleep(1.1)
        if res is None:
            continue  # retried on the next run
        if not res:
            w.writerow({"siren": s, "found": "non"})
            continue
        x = res[0]
        nj = str(x.get("nature_juridique") or "")
        w.writerow({"siren": s, "raison_sociale": "" if nj == "1000" else (x.get("nom_raison_sociale") or x.get("nom_complet") or ""),
                    "nature_juridique": nj, "naf": x.get("activite_principale") or "", "etat": x.get("etat_administratif") or "",
                    "found": "oui"})
        f.flush()
        if i % 50 == 0:
            print(i, "/", len(new), file=sys.stderr)
print(len(new), "new lookups")
