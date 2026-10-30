"""Build lignes_videoprotection.csv from every source of the subsidies strand.

Usage: python -I build_lines.py <M>
  <M> = the exploration folder (reads data/raw/..., data/derived/..., writes
  data/derived/subventions/lignes_videoprotection.csv and prints per-source counts).

Sources:
  - Grand Est SCDL (data/raw/regions/grandest_subventions_scdl.csv, earlier strand's download):
    communal security programme P078O001, tranches T02/T06/T19/T22.
  - Région Sud (PACA) CP 'Tableau_financier.pdf' (parsed by parse_paca.py).
  - Occitanie SCDL lines found through the data.gouv.fr tabular API (occitanie_video*.json).
  - DETR sample of 10 prefectures (extract_detr_sample.py output).
  - DETR/DPV lines of the earlier strand (data/derived/detr/detr_dsil_videoprotection.csv), copied.
  - DSIL regional lists: IDF 2022, PACA 2021 (earlier strand's PDFs), Nouvelle-Aquitaine 2024:
    hand-transcribed below from the PDF text (8 lines).
No natural person's name is read or written: beneficiaries are legal entities.
"""
import csv, json, os, re, sys, unicodedata
import pandas as pd

M = sys.argv[1]
RAW, DER = f"{M}/data/raw", f"{M}/data/derived"
OUT = f"{DER}/subventions/lignes_videoprotection.csv"

communes = json.load(open(f"{RAW}/subventions/geo/communes_siren.json"))
epcis = json.load(open(f"{RAW}/subventions/geo/epcis.json"))
by_siren = {c["siren"]: c for c in communes if c.get("siren")}
epci_by_siren = {e["code"]: e for e in epcis}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().upper()
    s = s.replace("’", "'")
    s = re.sub(r"^(COMMUNE|COM|MAIRIE|VILLE)\s+(DE LA |DE L'|DES |DU |DE |D'|DE|D)?", "", s.strip())
    s = re.sub(r"\bST\b", "SAINT", s)
    s = re.sub(r"\bSTE\b", "SAINTE", s)
    s = re.sub(r"[^A-Z]", "", s)
    return s


by_name = {}
for c in communes:
    by_name.setdefault((c["codeDepartement"], norm(c["nom"])), []).append(c)
    # "LE MUY" / "MUY", "LES BAUX-DE-PROVENCE" / "BAUX DE PROVENCE"
    m = re.match(r"^(LES|LE|LA|L)(?=[A-Z])", norm(c["nom"]))
    if m:
        by_name.setdefault((c["codeDepartement"], norm(c["nom"])[len(m.group(1)):]), []).append(c)


# Names written differently in the source, checked by hand against geo.api.gouv.fr (2026-10-23):
ALIAS = {("83", "LUCENPROVENCE"): "83073",   # « Commune du Luc en Provence » = Le Luc
         ("83", "ARCSSURARGENS"): "83004",   # « Commune des Arcs-sur-Argens » = Les Arcs
         ("33", "CADILLAC"): "33081"}        # Gironde list, arrondissement Langon = Cadillac-sur-Garonne
by_code = {c["code"]: c for c in communes}


def resolve(name, dept=None, siren=None):
    """Return (insee_or_epci_code, status, population)."""
    if dept and (dept, norm(name)) in ALIAS:
        c = by_code[ALIAS[(dept, norm(name))]]
        return c["code"], "alias_manuel", c.get("population")
    if siren:
        siren = str(siren)[:9]
        if siren in by_siren:
            c = by_siren[siren]
            return c["code"], "siren_commune", c.get("population")
        if siren in epci_by_siren:
            return siren, "siren_epci", None
    if dept:
        hits = by_name.get((dept, norm(name)), [])
        if len({h["code"] for h in hits}) == 1:
            return hits[0]["code"], "nom_exact_dept", hits[0].get("population")
        if len(hits) > 1:
            return "", "ambigu", None
        n = norm(name)
        e = [x for x in epcis if dept in x["codesDepartements"] and norm(x["nom"]) == n]
        m = re.match(r"^(CA|CC|CU|COMMUNAUTE (D'AGGLOMERATION|DE COMMUNES)( DU| DE LA| DES| DE)?)\s+(.*)$", unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().upper())
        if not e and m:
            tail = norm(m.group(4))
            e = [x for x in epcis if dept in x["codesDepartements"] and norm(re.sub(r"^(CA|CC|CU)\s+(du |de la |des |de |d')?", "", x["nom"], flags=re.I)) == tail]
        if len(e) == 1:
            return e[0]["code"], "nom_epci", None
    return "", "non_resolu", None


CAM = re.compile(r"(\d{1,3}|treize)\s*(?:nouvelles?\s+|nouveaux\s+)?(?:cam[ée]ras?|cam\b|ca\b|c\b|cameras?)", re.I)


def cameras(label, truncated=False):
    s = re.sub(r"^\s*\(\w+\)\s*", "", str(label))  # drop the '(25E00169327)' dossier id
    s = re.sub(r"\d{2}/\d{4}", "", s)
    m = CAM.search(s)
    if m:
        return (13 if m.group(1).lower() == "treize" else int(m.group(1))), "libelle"
    if truncated:
        m = re.search(r"\s-\s*(\d{1,3})\s*$", s)
        if m:
            return int(m.group(1)), "libelle_tronque_nombre_final"
    return "", ""


rows = []


def add(**k):
    base = dict(source_strand="subventions", programme="", annee="", decision="", territoire="", departement="",
                beneficiaire="", siren="", insee="", insee_statut="", population=None, montant=None, base_ht=None,
                n_cameras="", n_cameras_source="", perimetre="voie_publique_ou_communal", libelle="", url="")
    base.update(k)
    if not base["insee"] and base["beneficiaire"]:
        code, st, pop = resolve(base["beneficiaire"], base["departement"] or None, base["siren"] or None)
        base["insee"], base["insee_statut"], base["population"] = code, st, pop
    if base["n_cameras"] == "":
        base["n_cameras"], base["n_cameras_source"] = cameras(base["libelle"], base.get("_trunc", False))
    base.pop("_trunc", None)
    rows.append(base)


# --- Grand Est -------------------------------------------------------------------------
GE_URL = "https://www.datagrandest.fr/geonetwork/srv/api/records/f9f20850-ab92-42ee-b188-e4eb76bd0b26/attachments/subvention_region_grandest.csv"
ge = pd.read_csv(f"{RAW}/regions/grandest_subventions_scdl.csv", dtype=str)
ge = ge[ge.code_tranche.isin(["P078O001T02", "P078O001T06", "P078O001T19", "P078O001T22"])]
for r in ge.itertuples():
    y = re.findall(r"(20\d\d)", r.referencedecision or "")
    add(programme="Région Grand Est (sécurité des communes, P078O001)", annee=y[-1] if y else "",
        decision=r.referencedecision, territoire="Grand Est", beneficiaire=r.nombeneficiaire.strip(),
        siren=str(r.idbeneficiaire)[:9], montant=float(r.montant), libelle=r.objet.strip(), url=GE_URL,
        departement=by_siren.get(str(r.idbeneficiaire)[:9], {}).get("codeDepartement", ""), _trunc=True,
        perimetre="voie_publique_ou_communal" if re.search(r"vid|cam", r.objet, re.I) else "programme_seul")

# --- PACA (Région Sud) -----------------------------------------------------------------
pa = pd.read_csv(f"{DER}/subventions/paca_cp_dossiers.csv", dtype=str)
NUMDOC = {"12387": "23-0209", "19973": "23-0421", "20347": "23-0596", "20771": "23-0846", "21137": "24-0162",
          "22071": "24-0433", "22846": "24-0675", "23104": "24-0819", "23402": "25-0173", "23658": "25-0379",
          "26358": "25-0576"}
VID = re.compile(r"vid[ée]o[\s\-]*(?:protec|surveil)|vid[ée]oprot|cam[ée]ras? de vid", re.I)
CSU = re.compile(r"supervision urbain|centre de supervision|cam[ée]ra nomade", re.I)
for r in pa.itertuples():
    # body-worn ("piéton", "individuelles") cameras of municipal police are not video surveillance: excluded
    if not (VID.search(r.objet) or CSU.search(r.objet)):
        continue
    n = re.search(r"tableau_(\d+)", r.file).group(1)
    cp = str(r.code_postal) if isinstance(r.code_postal, str) else ""
    dep = cp[:2] if cp else ""
    add(programme="Région Sud – « Région sûre » (aides aux communes)", annee=r.cp_date[-4:],
        decision=f"CP {NUMDOC[n]} du {r.cp_date.lower()}", territoire="PACA", departement=dep,
        beneficiaire=r.beneficiaire, siren=r.siren if isinstance(r.siren, str) else "", montant=float(r.subvention),
        base_ht=float(r.base_ht), libelle=r.objet, url=f"https://actes.maregionsud.fr/actes/php/recup_fichiers.php?numDoc={n}",
        perimetre="csu_ou_camera_nomade" if not VID.search(r.objet) else "voie_publique_ou_communal")

# --- Occitanie ---------------------------------------------------------------------------
seen = set()
for fn in ("occitanie_video.json", "occitanie_video2.json"):
    for x in json.load(open(f"{RAW}/subventions/regions/{fn}")):
        nj = str(x["Id bénéficiaire"])[:2]
        if x["__id"] in seen or nj not in ("21", "24", "20") or "LYCEE" in x["Nom bénéficiaire"]:
            continue
        if not VID.search(x["Objet de la subvention"]):
            continue
        seen.add(x["__id"])
        add(programme="Région Occitanie (subventions votées en CP)", annee=str(x["Annee de la décision"]),
            decision=f"décision {x['referenceDecision']} du {x['Date de décision']}", territoire="Occitanie",
            beneficiaire=x["Nom bénéficiaire"], siren=str(x["Id bénéficiaire"])[:9], montant=float(x["Montant voté"]),
            libelle=x["Objet de la subvention"],
            perimetre="batiment_equipement" if "CITE DE L'ESPACE" in x["Objet de la subvention"] else "voie_publique_ou_communal",
            url="https://tabular-api.data.gouv.fr/api/resources/ebb11142-c461-494c-bebf-fbb83102f79e/data/ (copie data.gouv.fr de data.laregion.fr subventions-du-conseil-regional)")

# --- DETR sample of 10 prefectures ------------------------------------------------------
man = {}
for line in open(f"{RAW}/subventions/detr_sample/manifest.tsv"):
    p = line.rstrip("\n").split("\t")
    if len(p) > 5 and p[0] != "utc":
        man[p[4]] = p[5]
ds = pd.read_csv(f"{DER}/subventions/detr_sample_video.csv", dtype=str)
YEAR = {"70": "2026"}
for r in ds.itertuples():
    if pd.isna(r.subvention) and pd.isna(r.cout_ht):
        continue  # legend rows (Hérault category list)
    add(source_strand="subventions (échantillon DETR)", programme=r.programme, annee=YEAR.get(r.dept, "2025"),
        decision=f"liste préfecture {r.dept}", territoire=r.dept, departement=r.dept, beneficiaire=r.beneficiaire,
        insee=r.insee if isinstance(r.insee, str) else "", insee_statut="fourni_par_la_source" if isinstance(r.insee, str) else "",
        montant=float(r.subvention) if isinstance(r.subvention, str) else None,
        base_ht=float(r.cout_ht) if isinstance(r.cout_ht, str) else None, libelle=r.libelle, url=man.get(r.file, ""),
        perimetre="batiment_equipement" if re.search(r"centre de sant|b[âa]timents? communaux|salle|mairie [ée]cole", r.libelle, re.I) else "voie_publique_ou_communal")

# --- earlier DETR strand (copied as is) ---------------------------------------------------
old = pd.read_csv(f"{DER}/detr/detr_dsil_videoprotection.csv", dtype=str)
for r in old.itertuples():
    add(source_strand="detr (volet antérieur, copié)", programme=r.programme, annee=r.annee, territoire=r.departement,
        departement=r.departement, beneficiaire=r.beneficiaire, insee=r.insee, insee_statut=r.insee_statut,
        population=r.population_insee, montant=float(r.subvention),
        base_ht=float(r.cout_ht) if isinstance(r.cout_ht, str) else None, libelle=r.libelle_projet,
        n_cameras=r.n_cameras if isinstance(r.n_cameras, str) else "", n_cameras_source="libelle" if isinstance(r.n_cameras, str) else "",
        url=r.url)

# --- DSIL regional lists (hand transcription from the PDF text, checked line by line) ------
IDF22 = "https://www.prefectures-regions.gouv.fr/irecontenu/telechargement/102593/651288/file/Arr%C3%AAt%C3%A9s%20DSIL%20au%2031-12-2022.pdf"
PACA21 = "https://www.prefectures-regions.gouv.fr/irecontenu/telechargement/92577/592683/file/PACA_2021_liste%20projets%20(toutes%20enveloppes).pdf"
NA24 = "https://www.prefectures-regions.gouv.fr/irecontenu/telechargement/125023/925079/file/Liste%20des%20op%C3%A9rations%20ayant%20b%C3%A9n%C3%A9fici%C3%A9%20de%20la%20DSIL%20en%20Nouvelle-Aquitaine_31%20dec%202024.pdf"
DSIL = [
    ("2022", "IDF", "94", "CHAMPIGNY-SUR-MARNE", "Déploiement du dispositif de vidéo protection", 1371650, 100000, IDF22, ""),
    ("2022", "IDF", "94", "LIMEIL-BREVANNES", "Extension du dispositif de vidéo protection de la commune aux abords des écoles de la commune et de la salle de spectacle municipale dite « boîte à clous »", 325239, 150000, IDF22, ""),
    ("2022", "IDF", "94", "VILLENEUVE-SAINT-GEORGES", "Acquisition et installation de 10 caméras supplémentaires de vidéoprotection dans la commune", 109261.24, 54631, IDF22, ""),
    ("2022", "IDF", "95", "CA PLAINE-VALLEE", "Modernisation et extension des dispositifs intercommunaux de vidéoprotection", 3492566, 900000, IDF22, ""),
    ("2021", "PACA", "05", "CA Gap Tallard-Durance", "Equipement de 15 autobus en caméras de vidéosurveillance", 90000, 27000, PACA21, ""),
    ("2021", "PACA", "83", "FREJUS", "Modernisation et renforcement des installations de vidéoprotection dans un quartier prioritaire de la politique de la ville – quartier la Gabelle", 176777, 30016.73, PACA21, ""),
    ("2024", "Nouvelle-Aquitaine", "86", "POITIERS", "VIDEOPROTECTION", 20057.92, 16046.33, NA24, ""),
    ("2024", "Nouvelle-Aquitaine", "87", "Limoges", "Déploiement d’un système de vidéoprotection", 310887, 200000, NA24, ""),
]
for y, terr, dep, ben, lab, cost, sub, url, siren in DSIL:
    add(programme="DSIL", annee=y, decision=f"liste régionale DSIL {y}", territoire=terr, departement=dep,
        beneficiaire=ben, siren=siren, montant=sub, base_ht=cost, libelle=lab, url=url,
        perimetre="transport_embarque" if "autobus" in lab else "voie_publique_ou_communal")

cols = ["source_strand", "programme", "annee", "decision", "territoire", "departement", "beneficiaire", "siren",
        "insee", "insee_statut", "population", "montant", "base_ht", "n_cameras", "n_cameras_source", "perimetre",
        "libelle", "url"]
with open(OUT, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for r in rows:
        w.writerow({k: r[k] for k in cols})
df = pd.DataFrame(rows)
print(len(df), "lines")
print(df.groupby("programme").agg(lignes=("libelle", "size"), communes=("insee", "nunique"),
                                   cam=("n_cameras", lambda s: (s != "").sum()),
                                   montant=("montant", "sum")).to_string())
print(df.insee_statut.value_counts().to_string())
print(df[df.insee == ""][["programme", "departement", "beneficiaire", "siren", "insee_statut"]].to_string())
