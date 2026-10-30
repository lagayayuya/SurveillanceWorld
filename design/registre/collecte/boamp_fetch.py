"""Fetch BOAMP notices about video surveillance from the DILA opendatasoft API.

Usage: python -I boamp_fetch.py <out.jsonl> <light|full> [departements,comma,separated]

light: national, small fields only. full: pilot departments, with the notice body (donnees).
Polite: one request per second, honest User-Agent, records API only (robots.txt forbids
the bulk download paths, not the API).
"""

import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I leaves the script's folder out
from sanitize import clean  # noqa: E402  natural persons are dropped before anything is written

API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records"
UA = "SurveillanceWorld-research (+<contact>)"
WORDS = [
    "vidéoprotection", "vidéosurveillance", "vidéo protection", "vidéo surveillance",
    "vidéo-protection", "vidéo-surveillance", "caméras", "centre de supervision urbain",
]
LIGHT = ("idweb,id,contractfolderid,dateparution,code_departement,code_departement_prestation,nomacheteur,"
         "objet,nature,nature_libelle,type_avis,famille,descripteur_code,descripteur_libelle,annonce_lie,"
         "annonces_anterieures,perimetre,type_marche,url_avis,procedure_libelle")  # no holder names

out, mode = sys.argv[1], sys.argv[2]
deps = sys.argv[3].split(",") if len(sys.argv) > 3 else []
words = WORDS if deps else WORDS[:6]  # "caméras" alone is too broad nationally
where = "(" + " or ".join(f'search(objet, "{w}")' for w in words) + ")"
if deps:
    where += " and (" + " or ".join(f'code_departement = "{d}"' for d in deps) + ")"
select = LIGHT + (",donnees,gestion" if mode == "full" else "")

s = requests.Session()
s.headers["User-Agent"] = UA


def get(params):
    for attempt in range(5):
        r = s.get(API, params=params, timeout=60)
        time.sleep(1)
        if r.status_code == 200:
            return r.json()
        time.sleep(5 * (attempt + 1))
    r.raise_for_status()


# The records API stops at offset 10,000: page by year to stay under it.
n = 0
with open(out, "w") as f:
    for year in range(2015, 2027):
        w = where + f" and dateparution >= date'{year}-01-01' and dateparution < date'{year + 1}-01-01'"
        offset = 0
        while True:
            page = get({"where": w, "select": select, "limit": 100, "offset": offset, "order_by": "idweb"})
            for rec in page["results"]:
                f.write(json.dumps(clean(rec), ensure_ascii=False) + "\n")
            n += len(page["results"])
            offset += 100
            if offset >= page["total_count"] or not page["results"]:
                break
        print(year, page["total_count"], file=sys.stderr)
print(n, "records")
