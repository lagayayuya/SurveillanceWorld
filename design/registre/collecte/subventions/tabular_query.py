"""Query data.gouv.fr tabular API with a `<column>__contains=<term>` filter, all pages.

Usage: python -I tabular_query.py <out_json> <resource_id> <column> <term> [<term>...]
Writes the union of rows (dedup on __id) to out_json and logs each request
(url, utc, status, sha256 of body) to <dir(out_json)>/manifest.tsv.
"""
import datetime, hashlib, json, os, sys, time, urllib.parse
import requests

UA = "SurveillanceWorld-research (+<contact>)"
out, rid, col, terms = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
base = f"https://tabular-api.data.gouv.fr/api/resources/{rid}/data/"
rows = {}
man = os.path.join(os.path.dirname(out), "manifest.tsv")
for t in terms:
    url = base + "?" + urllib.parse.urlencode({f"{col}__contains": t, "page_size": 50})
    while url:
        time.sleep(2.5)
        r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
        now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        with open(man, "a") as f:
            f.write(f"{now}\t{r.status_code}\t{len(r.content)}\t{hashlib.sha256(r.content).hexdigest()}\t{os.path.basename(out)}\t{url}\t{r.url}\t{r.headers.get('content-type','')}\n")
        if r.status_code != 200:
            print("HTTP", r.status_code, r.text[:300]); break
        d = r.json()
        for x in d["data"]:
            x["_term"] = t
            rows.setdefault(x["__id"], x)
        print(t, d["meta"].get("total"), len(rows))
        url = d["links"].get("next")
json.dump(list(rows.values()), open(out, "w"), ensure_ascii=False, indent=0)
print("rows", len(rows))
