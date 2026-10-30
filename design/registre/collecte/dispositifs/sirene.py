"""Query recherche-entreprises.api.gouv.fr (1 req / 1.5 s, fixed UA). Saves raw JSON to <out_dir>, logs manifest.
Usage: python -I sirene.py <out_dir> "<query>|<code_postal>" ...
Prints legal entities only (siren, nom, nature juridique, siege CP/commune, etat). No natural-person fields printed."""
import datetime, hashlib, json, os, sys, time, urllib.parse
import requests
UA = "SurveillanceWorld-research (+<contact>)"
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for arg in sys.argv[2:]:
    q, _, cp = arg.partition("|")
    params = {"q": q, "per_page": 5}
    if cp:
        params["code_postal"] = cp
    url = "https://recherche-entreprises.api.gouv.fr/search?" + urllib.parse.urlencode(params)
    time.sleep(1.5)
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    name = "sirene_" + hashlib.sha1(url.encode()).hexdigest()[:10] + ".json"
    d = r.json() if r.ok else {}
    # strip natural persons (dirigeants) before saving
    for res in d.get("results", []):
        res.pop("dirigeants", None)
        res.pop("matching_etablissements", None)
    raw = json.dumps(d, ensure_ascii=False).encode()
    open(os.path.join(out, name), "wb").write(raw)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    with open(os.path.join(out, "manifest.tsv"), "a") as f:
        f.write(f"{now}\t{r.status_code}\t{len(raw)}\t{hashlib.sha256(raw).hexdigest()}\t{name}\t{url}\t(dirigeants stripped before save)\n")
    print("==", arg, r.status_code)
    for res in d.get("results", []):
        s = res.get("siege", {})
        print("  ", res.get("siren"), "|", res.get("nom_complet"), "|", res.get("nature_juridique"), "|", s.get("code_postal"), s.get("libelle_commune"), "|", res.get("etat_administratif"), "| creation", res.get("date_creation"))
