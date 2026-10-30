"""Build the pilot's registre: one row per official document (événement), grouped into affaires.

Usage: python -I build_registre.py <marches dir>

Reads derived files only (never data/raw except hashes and public reference tables). Writes
prototype-v4/registre.js (window.REG), exports/ (CSV and JSON samples) and
data/derived/registre_rattachement.csv (measured linking rates).

Stable ids, taken from official identifiers (they become addresses):
  événement: BOAMP idweb · DECP <uid>~<modification_id> · arrêté 69-AAAA-MM-JJ-NNNNN ·
             délibération <CP id>/<dossier EX…> · DETR detr-<dep>-<année>-<n>
  affaire:   contrat = DECP uid (or « avis-<idweb> » when no contract was found) ·
             dossier préfectoral = <dép>-<numéro de dossier> · subvention = dossier EX… ·
             drone / acte isolé = the act id
  entreprise = SIREN · commune = code INSEE
"""

import csv
import hashlib
import os
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import duckdb
import pandas as pd

M = Path(sys.argv[1])
D = M / "data/derived"
sys.path.insert(0, str(M / "scripts"))
from sanitize import _text as clean_text  # noqa: E402  natural persons out of every free text

PILOTE = {"75", "69", "13"}
IDF = {"75", "77", "78", "91", "92", "93", "94", "95"}
SCOPE = PILOTE | IDF
TODAY = date.today().isoformat()


def txt(s, n=300):
    if not isinstance(s, str) or not s.strip():
        return ""
    s = clean_text(re.sub(r"\s+", " ", s.replace("<br />", " ")).strip())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"\b(commune|ville|mairie|de|d|du|la|le|les|l)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def num(x):
    try:
        v = float(x)
        return None if v != v else v
    except (TypeError, ValueError):
        return None


# --- reference tables -------------------------------------------------------------------
geo = pd.DataFrame(json.load(open(M / "data/raw/geo_pop/communes_france.json")))
commune_by_siren = dict(zip(geo["siren"], geo["code"]))
communes = {r.code: {"nom": r.nom, "dep": r.codeDepartement, "pop": int(num(r.population) or 0), "epci": r.codeEpci if isinstance(r.codeEpci, str) else ""}
            for r in geo.itertuples()}
naf = pd.read_excel(M / "data/raw/insee_naf/naf2008_liste_n5.xls", header=None, skiprows=3).dropna()
naf = dict(zip(naf[0].str.replace(".", "", regex=False), naf[1]))
sirene = {}
if (D / "entreprises_sirene.csv").exists():
    sirene = {r["siren"]: r for r in csv.DictReader(open(D / "entreprises_sirene.csv"))}
mandats = list(csv.DictReader(open(D / "mandats_municipaux.csv")))

# rows read by a person somewhere in the exploration
relus = set()
for f in ["decp/review_round1.csv", "decp/sample_round3.csv", "decp/sample_categories.csv"]:
    relus |= set(pd.read_csv(D / f)["uid"])
relus |= set(pd.read_csv(D / "boamp/liens_boamp_decp_echantillon.csv")["idweb"])
relus |= set(pd.read_csv(D / "rhone_raa/echantillon.csv")["acte"])
relus |= {"69-2026-04-24-00011", "69-2026-07-01-00018", "69-2026-09-28-00011", "69-2026-09-10-00005", "69-2026-04-24-00003",
          "69-2026-09-28-00012", "69-2026-06-18-00026", "69-2026-06-18-00017", "69-2026-10-16-00028", "69-2026-03-02-00003"}
for f in "ABCD":
    relus |= set(pd.read_csv(D / f"idf/accuracy_sample_{f}.csv")["dossier"].astype(str))

ev, docs = [], {}


def doc(url, kind, sha=None, collected=None, note=None):
    if not url:
        return None
    d = docs.setdefault(url, {"url": url, "kind": kind, "sha256": sha, "collecte": collected, "note": note})
    if sha and not d["sha256"]:
        d["sha256"] = sha
    return url


# --- DECP contracts and their modifications ---------------------------------------------
m = pd.read_parquet(D / "decp/marches_classes.parquet")
m = m[~m["uid"].isin({"2169028330001320_32323500"})]  # double publication (relecture.csv)
vsa = pd.read_csv(D / "dispositifs_decp/vsa_par_fournisseur.csv", dtype=str)
alpha = set(vsa.loc[vsa["nom"] == "ALPHAIOTA", "uid"])
m = m[m["acheteur_departement_code"].isin(SCOPE) | m["uid"].isin(alpha)]
# Alphaiota contracts found by its SIREN but outside the CPV/keyword selection: taken from the
# consolidated DECP, deduplicated with the same rule as decp_analyse.py
raw_decp = (D.parent / "raw/decp/decp.parquet").as_posix()
extra = duckdb.connect().execute(
    f"""select uid, any_value(acheteur_id) acheteur_id, any_value(acheteur_nom) acheteur_nom, any_value(acheteur_departement_code) acheteur_departement_code,
               any_value(acheteur_commune_code) acheteur_commune_code, any_value(objet) objet, any_value(techniques) techniques,
               min(dateNotification) date_notification, any_value(montant) filter (where modification_id = 0) montant_initial
        from read_parquet('{raw_decp}') where uid in (select unnest(?)) group by uid""", [sorted(alpha - set(m["uid"]))]).df()
extra["siren"] = extra["acheteur_id"].str[:9]
extra["categorie"] = "logiciel d'analyse (VSA)"
extra["objet_norm"] = extra["objet"].fillna("").map(lambda s: re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip())
key = ["siren", "date_notification", "montant_initial", "objet_norm"]
extra["date_notification"] = pd.to_datetime(extra["date_notification"])
seen = set(map(tuple, m.assign(date_notification=pd.to_datetime(m["date_notification"]))[key].astype(str).values))
extra = extra.sort_values("uid").drop_duplicates(key)
extra = extra[[tuple(x) not in seen for x in extra[key].astype(str).values]]
print(f"Alphaiota : {len(extra)} contrats ajoutés depuis les DECP consolidées (hors sélection par objet)")
m = pd.concat([m, extra[[c for c in extra.columns if c != "acheteur_id"]]], ignore_index=True)
# same buyer, same day, same amount, two uids: one contract published twice (stricter than the
# national rule, applied to this supplier only, where it was checked by hand)
al = m["uid"].isin(alpha)
dup = pd.Series(False, index=m.index)
dup[al] = m[al].assign(d=pd.to_datetime(m.loc[al, "date_notification"]))[["siren", "d", "montant_initial"]].duplicated(keep="first")
print(f"Alphaiota : {int(dup.sum())} publications en double écartées (même acheteur, même jour, même montant)", list(m.loc[dup, "uid"]))
m = m[~dup]
hits = pd.read_parquet(D / "dispositifs_decp/dispositifs_decp.parquet")
dispo_of = hits.drop_duplicates("uid").set_index("uid")["dispositif"].to_dict()
rows = duckdb.connect().execute(
    f"""select uid, modification_id, dateNotification, montant, dureeMois, titulaire_id, sourceDataset, sourceFile
        from read_parquet('{D / 'decp/candidates.parquet'}') where uid in (select unnest(?))
        union all
        select uid, modification_id, dateNotification, montant, dureeMois, titulaire_id, sourceDataset, sourceFile
        from read_parquet('{raw_decp}') where uid in (select unnest(?))""", [list(m["uid"]), list(extra["uid"])]
).df().drop_duplicates()
# 8th pass: offers received (« offresRecues »), when the DECP give them; 100 and more is taken for
# an input error (21 contracts give 126) and not shown
offres_of = duckdb.connect().execute(
    f"""select uid, max(offresRecues) o from read_parquet('{raw_decp}') where uid in (select unnest(?)) and offresRecues is not null group by uid""",
    [list(m["uid"]) + list(extra["uid"])]).df().set_index("uid")["o"].to_dict()
DISPO = {"logiciel d'analyse (VSA)": "vsa", "centre de supervision": "csu", "caméras piétons, embarquées": "pietons", "drones": "drone"}
bad_ids = set()  # holder ids that are neither a SIREN nor a SIRET (left out, counted)
contrats = {}
for r in m.itertuples():
    insee = commune_by_siren.get(r.siren) or r.acheteur_commune_code
    g = rows[rows["uid"] == r.uid].sort_values("modification_id")
    disp = dispo_of.get(r.uid) or DISPO.get(r.categorie, "videoprotection")
    contrats[r.uid] = {"id": r.uid, "kind": "contrat", "titre": txt(r.objet, 160), "insee": insee, "dep": r.acheteur_departement_code,
                       "acheteur": re.sub(r"\s*\(.*\)\s*$", "", r.acheteur_nom or ""), "acheteur_siren": r.siren,
                       "acheteur_communal": r.siren in commune_by_siren, "categorie": r.categorie, "dispositif": disp,
                       "techniques": r.techniques if isinstance(r.techniques, str) else "", "hors_pilote": r.acheteur_departement_code not in SCOPE}
    prev = None
    for mod, gm in g.groupby("modification_id"):
        g0 = gm.iloc[0]
        ids = {re.sub(r"\s", "", str(t)) for t in gm["titulaire_id"].dropna()}
        tit = sorted({t[:9] for t in ids if re.fullmatch(r"\d{9}(\d{5})?", t)})
        bad_ids.update(f"{r.uid}|{t}" for t in ids if not re.fullmatch(r"\d{9}(\d{5})?", t))
        changes = []
        if prev is not None:
            if num(g0.montant) != num(prev.montant):
                fe = lambda v: f"{v:,.0f}".replace(",", " ") if v is not None else "?"
                changes.append(f"montant {fe(num(prev.montant))} → {fe(num(g0.montant))} €")
            if num(g0.dureeMois) != num(prev.dureeMois):
                changes.append(f"durée {int(num(prev.dureeMois) or 0)} → {int(num(g0.dureeMois) or 0)} mois")
            if set(tit) != prev_tit:
                changes.append("titulaires")
        ev.append({"id": f"{r.uid}~{int(mod)}", "t": "attribution" if mod == 0 else "modification",
                   "date": str(g0.dateNotification)[:10], "insee": insee, "dep": r.acheteur_departement_code,
                   "affaire": r.uid, "entreprises": tit, "montant": num(g0.montant), "duree": num(g0.dureeMois),
                   "modif_n": int(mod), "changements": changes, "objet": txt(r.objet),
                   "ref": f"DECP {r.uid}" + (f", modification {int(mod)}" if mod else ""),
                   "url": doc(g0.sourceFile if isinstance(g0.sourceFile, str) and g0.sourceFile.startswith("http") else
                              "https://www.data.gouv.fr/datasets/608c055b35eb4e6ee20eb325", "donnée DECP",
                              collected="2026-10-23", note=f"source {g0.sourceDataset}, version consolidée du 23/10/2026"),
                   "relu": r.uid in relus, "dispositif": disp, "estimation": False,
                   **({"offres": int(offres_of[r.uid])} if mod == 0 and r.uid in offres_of and 0 < offres_of[r.uid] < 100 else {})})
        prev, prev_tit = g0, set(tit)

# --- BOAMP notices -----------------------------------------------------------------------
b = pd.read_parquet(D / "boamp/boamp_avis.parquet")
links = pd.read_csv(D / "boamp/liens_boamp_decp.csv", dtype={"siren": str})
links = links[links["jaccard"] >= 0.2]
links = links[links["uid"].isin(set(m["uid"]))].sort_values("rang").drop_duplicates("idweb").set_index("idweb")   # rank 1 may be a dropped double
corr = pd.read_csv(D / "boamp/corrections.csv", dtype=str).set_index("idweb")
commune_siren_by_name = {}
for r in geo.itertuples():
    k_ = (r.codeDepartement, norm(r.nom))
    commune_siren_by_name[k_] = None if k_ in commune_siren_by_name else r.siren   # homonyms in a département: no match
name_to_siren = m.assign(k=m["acheteur_nom"].map(norm)).groupby("k")["siren"].first().to_dict()
NAT = {"Avis de marché": "avis", "Résultat de marché": "resultat", "Rectificatif": "rectificatif"}
qty = pd.read_csv(D / "boamp/boamp_quantites.csv")
qn = qty[qty["type"] == "nouvelles"].groupby("idweb")["n"].max().to_dict()
b_ids = set(b["idweb"])
cam_re = re.compile(r"(?<![\w,.])(\d{1,4})\s+(?:nouvelles?\s+|nlles\s+|nlels\s+)?cam[ée]ras?", re.I)
m_date = dict(zip(m["uid"], m["date_notification"].astype(str)))
m_objet = dict(zip(m["uid"], m["objet"]))
par_cameras = set()
first_of = {}
for r in b.sort_values("dateparution").itertuples():
    if not r.objet_video:
        continue
    sirets = [s[:9] for s in (r.sirets or "").split(";") if s]
    named = name_to_siren.get(norm(r.acheteur))
    if not named and not sirets:   # 5th pass: « Ville de Mions » → the commune's SIREN, in the notice's département
        named = commune_siren_by_name.get(((r.departements or "").split(",")[0], norm(r.acheteur)))
    siren = corr.loc[r.idweb, "siren_retenu"] if r.idweb in corr.index else (named if named in sirets else (sirets[0] if sirets else named))
    insee = commune_by_siren.get(siren)
    dep = (insee or "")[:2] if insee else (r.departements or "").split(",")[0]
    if dep not in SCOPE:
        continue
    if r.idweb in links.index:
        aff = links.loc[r.idweb, "uid"]
        aff = aff if aff in contrats else None
    else:
        aff = None
    if aff is None:  # follow the notice's own links (award → call, corrections)
        for lid in (r.avis_lies or "").split(";"):
            if lid in first_of:
                aff = first_of[lid]
                break
    if aff is None and qn.get(r.idweb) and siren:  # second signal: same buyer, same camera count, date window
        n_ = int(qn[r.idweb])
        cand = [u for u, c in contrats.items() if c["acheteur_siren"] == siren
                and 0 <= (pd.Timestamp(m_date[u]) - pd.Timestamp(r.dateparution)).days <= 548
                and n_ in [int(x) for x in cam_re.findall(m_objet[u] or "")]]
        if len(cand) == 1:
            aff = cand[0]
            par_cameras.add(r.idweb)
    if aff is None:
        aff = f"avis-{r.idweb}"
    first_of[r.idweb] = aff
    ev.append({"id": r.idweb, "t": NAT.get(r.nature, "avis"), "date": r.dateparution[:10], "insee": insee, "dep": dep,
               "affaire": aff, "entreprises": [], "acheteur": r.acheteur, "acheteur_siren": siren,
               "cameras": qn.get(r.idweb), "objet": txt(r.objet), "ref": f"BOAMP {r.idweb}",
               "url": doc(r.url_avis, "avis BOAMP", collected="2026-10-23", note="avis publié au BOAMP (pas de copie de fichier)"),
               "relu": r.idweb in relus, "dispositif": None, "corrige": r.idweb in corr.index})

# --- prefectoral orders (Rhône, 12 months) ----------------------------------------------
man = pd.read_csv(M / "data/raw/rhone_raa/manifest.tsv", sep="\t", dtype=str)
sha_of = dict(zip(man["url"], man["sha256"]))
a = pd.read_csv(D / "rhone_raa/actes.csv", dtype=str)
PUBLIC_BENEF = ("commune", "epci", "etat")
TYPE = {"videoprotection": "arrete", "drone": "arrete_drone", "cameras_pietons": "arrete_pietons"}
for r in a.itertuples():
    dossier = r.dossier if isinstance(r.dossier, str) and r.dossier.strip() else None
    if r.type == "videoprotection" and dossier:
        aff = f"69-{dossier}"
    else:
        aff = r.acte
    benef = clean_text(r.beneficiaire) if isinstance(r.beneficiaire, str) else ""
    bsiren = getattr(r, "beneficiaire_siren", None)
    bsiren = bsiren if isinstance(bsiren, str) and bsiren.strip() else None
    # whitelist (5th pass): a private beneficiary is shown only with its SIRENE match
    if "[nom retiré]" in benef or (r.type_beneficiaire not in PUBLIC_BENEF and not benef.startswith("[") and not bsiren):
        benef = "[non retenu]"
    ev.append({"id": r.acte, "t": TYPE.get(r.type, "arrete"), "sous_type": r.sous_type, "date": r.date_acte, "insee": r.insee if isinstance(r.insee, str) else None,
               "dep": "69", "affaire": aff, "entreprises": [], "beneficiaire": benef, "beneficiaire_siren": bsiren if benef != "[non retenu]" else None,
               "type_beneficiaire": r.type_beneficiaire, "duree_inchangee": getattr(r, "duree_inchangee", "") == "oui",
               "cameras": num(r.n_cameras_total), "cameras_vp": num(r.n_voie_publique), "cameras_int": num(r.n_interieur),
               "cameras_ext": num(r.n_exterieur), "cameras_lib": None if num(r.n_cameras_total) is not None else "non précisé",
               "dossier": dossier, "periode": r.periode if isinstance(r.periode, str) else "", "duree": r.duree_autorisation if isinstance(r.duree_autorisation, str) else "",
               "videoverbalisation": True if r.videoverbalisation == "oui" else None, "deport_forces": True if r.deport_vers_police_gendarmerie == "oui" else None,
               "ref": f"préfecture du Rhône, acte {r.acte}", "url": doc(r.url, "recueil des actes administratifs", sha_of.get(r.url), "2026-10-23"),
               "page": r.page, "relu": r.acte in relus, "dispositif": {"drone": "drone", "cameras_pietons": "pietons"}.get(r.type, "videoprotection")})

# 8th pass: what a drone order allows (video, aerial photographs, shots for an exercise), read by
# scripts/drones/perimetres.py; shown, and a filter hides the last two
nature_vol = {}
for r_ in csv.DictReader(open(D / "drones/perimetres.csv")):
    nature_vol.setdefault(r_["acte"], r_["nature"])
for e in ev:
    if e["t"] == "arrete_drone" and e["id"] in nature_vol:
        e["nature_vol"] = nature_vol[e["id"]]

# --- other prefectoral acts already read (Paris drones, VSA Stade de France, Marseille) --
ap = pd.read_csv(D / "dispositifs/actes_pilote.csv", dtype=str)
for r in ap.itertuples():
    dep = r.departement[:2]
    if dep not in {"75", "13"} or r.acte.startswith("("):
        continue
    t = {"drone": "arrete_drone", "vsa": "arrete_vsa", "cameras_pietons": "arrete_pietons"}.get(r.type)
    if not t:
        continue
    ev.append({"id": re.sub(r"\s.*", "", r.acte), "t": t, "date": r.date_acte, "insee": None, "dep": dep,
               "affaire": re.sub(r"\s.*", "", r.acte), "entreprises": [], "beneficiaire": txt(r.beneficiaire_entite, 120),
               "type_beneficiaire": "commune" if str(r.beneficiaire_entite).lower().startswith("commune") else "etat",
               "cameras": num(r.n_dispositifs.split()[0]) if isinstance(r.n_dispositifs, str) and r.n_dispositifs.split()[0].isdigit() else None,
               "cameras_lib": None if isinstance(r.n_dispositifs, str) and r.n_dispositifs[:1].isdigit() else "non précisé",
               "periode": r.periode, "objet": txt(r.perimetre, 200), "ref": f"recueil {r.raa}, acte {r.acte}",
               "url": doc(r.url, "recueil des actes administratifs", r.sha256 if isinstance(r.sha256, str) else None, "2026-10-23"),
               "relu": True, "dispositif": {"arrete_drone": "drone", "arrete_vsa": "vsa", "arrete_pietons": "pietons"}[t]})

# --- regional subsidies (Île-de-France) --------------------------------------------------
src = pd.read_csv(D / "idf/idf_sources.csv", dtype=str)
sha_local = {}
for r in src.itertuples():
    p = Path(str(r.local_path))
    if str(r.url).endswith(".pdf") and p.exists():
        sha_local[r.url] = hashlib.sha256(p.read_bytes()).hexdigest()
ai = pd.read_csv(D / "idf/idf_aides.csv", dtype={"insee_commune": str, "insee_localisation": str})
for r in ai.itertuples():
    insee = r.insee_commune if isinstance(r.insee_commune, str) else (r.insee_localisation if isinstance(r.insee_localisation, str) else None)
    ev.append({"id": f"{r.deliberation_id}/{r.dossier}", "t": "subvention_region", "date": r.cp_date, "insee": insee,
               "dep": (insee or "")[:2], "affaire": f"sub-{r.dossier}", "entreprises": [], "beneficiaire": r.beneficiaire.title() if isinstance(r.beneficiaire, str) else "",
               "montant": num(r.subvention_eur), "base": num(r.base_subventionnable_ht), "taux": num(r.taux_pct),
               "cameras": num(r.n_cameras_total), "cameras_nouvelles": num(r.n_cameras_nouvelles), "cameras_remplacees": num(r.n_cameras_remplacees),
               "objet": txt(r.description_courte if isinstance(r.description_courte, str) else r.objet, 260),
               "ref": f"Région Île-de-France, délibération {r.deliberation_id}, dossier {r.dossier}, page {r.pdf_page}",
               "url": doc(r.source_url, "délibération", sha_local.get(r.source_url), "2026-10-23"),
               "relu": str(r.dossier) in relus, "dispositif": "videoprotection", "reaffectation": r.reaffectation == "oui"})

# --- State subsidies (DETR, Rhône and Bouches-du-Rhône) and Région Sud lines in the 13 -----
det = pd.read_csv(D / "detr/detr_dsil_videoprotection.csv", dtype=str)
for i, r in enumerate(det.itertuples()):
    ev.append({"id": f"detr-{r.departement}-{r.annee}-{i}", "t": "subvention_etat", "date": f"{r.annee}-12-31", "date_annee": True,
               "insee": r.insee, "dep": r.departement, "affaire": f"detr-{r.departement}-{r.annee}-{i}", "entreprises": [],
               "beneficiaire": r.beneficiaire.title(), "montant": num(r.subvention), "base": num(r.cout_ht), "cameras": num(r.n_cameras),
               "objet": txt(r.libelle_projet), "ref": f"préfecture, liste {r.programme} {r.annee}", "url": doc(r.url, "liste DETR/DSIL", collected="2026-10-23"),
               "relu": False, "dispositif": "videoprotection", "programme": r.programme})
sub = pd.read_csv(D / "subventions/lignes_videoprotection.csv", dtype=str)
for i, r in enumerate(sub[(sub["departement"] == "13") & (sub["source_strand"] != "detr_prev")].itertuples()):
    if r.programme.upper().startswith("DETR") or r.programme.upper().startswith("DPV"):
        continue
    ev.append({"id": f"region-sud-{r.decision}-{i}", "t": "subvention_region", "date": f"{r.annee}-12-31", "date_annee": True,
               "insee": r.insee, "dep": "13", "affaire": f"region-sud-{r.decision}-{i}", "entreprises": [], "beneficiaire": (r.beneficiaire or "").title(),
               "montant": num(r.montant), "base": num(r.base_ht), "cameras": num(r.n_cameras), "objet": txt(r.libelle),
               "ref": f"Région Sud, délibération {r.decision}", "url": doc(r.url, "délibération", collected="2026-10-23"), "relu": False,
               "dispositif": "videoprotection"})

# --- 8th pass: an act about a site outside its département belongs to the site's commune ---
hors = {r["acte"]: r for r in csv.DictReader(open(D / "rhone_raa/hors_departement.csv"))}
for e in ev:
    h = hors.get(e["id"])
    if h:
        e["insee"], e["dep"], e["publie_par"] = h["insee_site"], h["insee_site"][:2], h["publie_par"]
        if h["note"]:
            e["note_lieu"] = h["note"]
print(f"actes rattachés à la commune du site, hors de leur département : {sum(1 for e in ev if e.get('publie_par'))}")

# --- 7th pass: arrondissements belong to their city (Paris, Lyon, Marseille) ---------------
ARR = {**{f"751{i:02d}": ("75056", f"Paris {i}{'er' if i == 1 else 'e'}") for i in range(1, 21)},
       **{f"6938{i}": ("69123", f"Lyon {i}{'er' if i == 1 else 'e'}") for i in range(1, 10)},
       **{f"132{i:02d}": ("13055", f"Marseille {i}{'er' if i == 1 else 'e'}") for i in range(1, 17)}}
for e in ev:
    ins = e.get("insee")
    if isinstance(ins, str) and re.search(r"[;|]", ins):   # an act or a subsidy over several communes: the first one, all kept
        e["communes_multi"] = re.split(r"[;|]", ins); ins = e["insee"] = e["communes_multi"][0]
    if ins in ARR:
        e["insee"], e["arrondissement"] = ARR[ins][0], ARR[ins][1]
for c in contrats.values():
    if c.get("insee") in ARR:
        c["insee"] = ARR[c["insee"]][0]

# --- affaires ----------------------------------------------------------------------------
affaires = {}
for e in ev:
    aid = e["affaire"]
    if aid not in affaires:
        base = contrats.get(aid) or {"id": aid}
        kind = ("contrat" if aid in contrats else "contrat_non_retrouve" if aid.startswith("avis-") else
                "dossier" if re.match(r"^\d\d-\d{6,}$", aid) else "subvention" if aid.startswith(("sub-", "detr-", "region-sud-")) else "acte")
        affaires[aid] = {**base, "kind": kind, "events": []}
    affaires[aid]["events"].append(e["id"])
evd = {e["id"]: e for e in ev}
for a_ in affaires.values():
    es = sorted((evd[i] for i in a_["events"]), key=lambda e: e["date"] or "")
    a_["events"] = [e["id"] for e in es]
    a_["debut"], a_["fin"] = es[0]["date"], es[-1]["date"]
    a_.setdefault("insee", next((e["insee"] for e in es if e.get("insee")), None))
    a_.setdefault("dep", es[0]["dep"])
    a_["entreprises"] = sorted({s for e in es for s in e.get("entreprises", [])})
    if a_["kind"] == "dossier":
        last = es[-1]
        bn = last.get("beneficiaire") or ""
        bn = "bénéficiaire privé, nom non publié" if bn == "[non retenu]" else "" if bn.startswith("[") else bn
        a_["titre"] = f"Dossier préfectoral n° {a_['id'].split('-', 1)[1]} : {bn}".strip(" :")
        # successive orders only: several orders on the same day (different sites under one
        # dossier number, e.g. 7 motorway tunnels on 28/11/2025) form a group, with no difference
        by_day = {}
        for e in es:
            by_day.setdefault(e["date"], []).append(e)
        a_["cameras"] = [{"date": d, "n": x[0].get("cameras"), "vp": x[0].get("cameras_vp")} if len(x) == 1 else
                         {"date": d, "groupe": len(x), "n": sum(y.get("cameras") or 0 for y in x),
                          "min": min((y.get("cameras") for y in x if y.get("cameras") is not None), default=None),
                          "max": max((y.get("cameras") for y in x if y.get("cameras") is not None), default=None)}
                         for d, x in by_day.items()]
        yr = re.match(r"^(\d{4})", a_["id"].split("-", 1)[1])
        a_["origine_annee"] = int(yr.group(1)) if yr and 1995 <= int(yr.group(1)) <= 2026 else None
        # validity: read in the act (5th pass), never assumed. The latest act that states a
        # duration sets the end; if the latest act does not state one, it is said.
        lu = [e for e in es if re.search(r"(\d+)\s*ans", e.get("duree") or "")]
        a_["duree_dernier_arrete"] = last.get("duree") or None
        if lu:
            y = int(re.search(r"(\d+)\s*ans", lu[-1]["duree"]).group(1))
            a_["echeance"] = f"{int(lu[-1]['date'][:4]) + y}{lu[-1]['date'][4:]}"
            a_["echeance_source"] = lu[-1]["id"]
    elif a_["kind"] in ("subvention",):
        a_["titre"] = f"Subvention : {es[0].get('beneficiaire', '')}"
    elif a_["kind"] in ("acte", "contrat_non_retrouve"):
        a_["titre"] = es[0].get("objet") or es[0].get("ref")

# --- subsidy → contract « probable » link (IDF): same commune, same camera count, -24/+6 months
contrat_events = [e for e in ev if e["t"] == "attribution"]
cam_in_obj = re.compile(r"(?<![\w,.])(\d{1,4})\s+(?:nouvelles?\s+|nlles\s+|nlels\s+)?cam[ée]ras?", re.I)
probables = 0
idf_subs = [e for e in ev if e["t"] == "subvention_region" and e["affaire"].startswith("sub-")]
for s in idf_subs:
    cands = []
    for c in contrat_events:
        if c["insee"] != s["insee"] or not s.get("cameras"):
            continue
        dd = (pd.Timestamp(s["date"]) - pd.Timestamp(c["date"])).days
        if not -183 <= dd <= 730:
            continue
        n_obj = [int(x) for x in cam_in_obj.findall(c["objet"] or "")]
        n_boamp = [evd[i].get("cameras") for i in affaires[c["affaire"]]["events"] if evd[i]["t"] in ("avis", "resultat")]
        if int(s["cameras"]) in n_obj or int(s["cameras"]) in [int(x) for x in n_boamp if x]:
            cands.append(c["affaire"])
    if len(set(cands)) == 1:
        affaires[s["affaire"]]["contrat_probable"] = cands[0]
        affaires.setdefault(cands[0], {}).setdefault("subventions_probables", []).append(s["affaire"])
        probables += 1

# --- 5th pass: amount quality (central purchasing, mixed contracts, implausible amounts) ----
# Central purchasing bodies: their framework ceiling is what other buyers may order, not a spend.
CENTRALES = {"776056467": "UGAP (Union des groupements d'achats publics)",
             "924435951": "Centrale d'achat du numérique et des télécoms"}
CENTRALE_RX = re.compile(r"centrale d.?achat|\bugap\b|union des groupements d.?achats|\bresah\b|\bcaih\b", re.I)
# Mixed contracts: the objet covers more than video (the brief's list, plus close trades).
# two families (5th pass, answer 1): building security (video with intrusion, alarm, access
# control…) and other services (guarding, fire, lighting…); a contract in both counts as « autres »
SURETE_RX = re.compile(r"controle d.?acces|intrusion|alarme|interphon|courants? faibles|\bgtb\b", re.I)
AUTRES_RX = re.compile(r"securite humaine|surveillance humaine|gardiennage|agents? de (?:securite|surete)|incendie|\bssi\b"
                       r"|eclairage|signalisation lumineuse|feux tricolores|multi ?techni|telephon", re.I)
# national buyers (answer 5): out of a département's totals, flagged « acheteur national »
NATIONAL_RX = re.compile(r"^(?!secretariat general pour l.?administration)(?:minist[eè]re|secr[ée]tariat g[ée]n[ée]ral d[eu]s? minist)"
                         r"|direction g[ée]n[ée]rale|^france travail|^france t[ée]l[ée]visions|services de l.?etat pour la facturation"
                         r"|^agence nationale", re.I)   # central administration and national networks, not their local sites
ETUDE_RX = re.compile(r"assistance a maitrise d.?ouvrage|\bamo\b|\betudes?\b|audit|diagnostic|mission de conseil|maitrise d.?oeuvre", re.I)
plain = lambda x: unicodedata.normalize("NFKD", str(x or "")).encode("ascii", "ignore").decode().lower()
pop_by_siren = {s_: communes[c]["pop"] for s_, c in commune_by_siren.items() if c in communes}
for c in communes.values():
    if c["epci"]:
        pop_by_siren[c["epci"]] = pop_by_siren.get(c["epci"], 0) + c["pop"]
bres = pd.read_csv(D / "boamp/resultats.csv", dtype=str).fillna("").set_index("idweb")
first_attr = {}
for e in ev:
    if e["t"] == "attribution":
        first_attr[e["affaire"]] = e
# same amount published by several buyers within a month: one group purchase counted N times
by_amount = {}
for u, e in first_attr.items():
    if (e["montant"] or 0) >= 1e6:
        by_amount.setdefault(e["montant"], []).append(e)
groupes = set()
for v, es_ in by_amount.items():
    es_ = sorted(es_, key=lambda e: e["date"])
    for i, e in enumerate(es_):
        near = {contrats[x["affaire"]]["acheteur_siren"] for x in es_ if abs((pd.Timestamp(x["date"]) - pd.Timestamp(e["date"])).days) <= 31}
        if len(near) >= 3:
            groupes.add(e["affaire"])
a_verifier = []
for u, c in contrats.items():
    e = first_attr.get(u)
    if not e:
        continue
    ob = plain(e["objet"])
    c["centrale_achat"] = c["acheteur_siren"] in CENTRALES or bool(CENTRALE_RX.search(plain(c["acheteur"])))
    fam = "autres" if AUTRES_RX.search(ob) else "surete" if SURETE_RX.search(ob) else ""
    c["mixte_famille"] = fam if not c["centrale_achat"] else ""
    c["contrat_mixte"] = bool(c["mixte_famille"])
    c["acheteur_national"] = bool(NATIONAL_RX.search(plain(c["acheteur"])))
    # shared ceiling: several holders, a group purchase in a linked notice, or the same amount by several buyers
    pp = []
    if len(e["entreprises"]) >= 2:
        pp.append(f"accord-cadre à {len(e['entreprises'])} titulaires")
    if any(evd[i]["t"] in ("avis", "resultat", "rectificatif") and evd[i]["id"] in bres.index and bres.loc[evd[i]["id"], "groupement_commandes"] == "oui"
           for i in affaires[u]["events"]):
        pp.append("groupement de commandes ou coordonnateur dans l'avis BOAMP")
    if u in groupes:
        pp.append("même montant publié par plusieurs acheteurs le même mois")
    c["plafond_partage"] = "; ".join(pp)
    raisons = []
    mt = e["montant"] or 0
    if not c["centrale_achat"]:
        pop = pop_by_siren.get(c["acheteur_siren"], 0)
        if pop and mt / pop > 250 and mt >= 5e5:
            raisons.append(f"{round(mt / pop):,} € par habitant de l'acheteur ({pop:,} habitants)".replace(",", " "))
        if mt > 1e6 and (c["categorie"] == "études, AMO" or ETUDE_RX.search(ob)):
            raisons.append("mission d'études ou d'assistance à plus de 1 M€")
        for i in affaires[u]["events"]:
            x = evd[i]
            if x["t"] not in ("avis", "resultat") or x["id"] not in bres.index:
                continue
            ve, ma = num(bres.loc[x["id"], "valeur_estimee"]), num(bres.loc[x["id"], "montant_attribue"])
            if ve and mt > 5 * ve and mt - ve > 5e5:
                raisons.append(f"{mt / ve:.0f} fois la valeur estimée de l'avis {x['id']} ({ve:,.0f} €)".replace(",", " "))
            if ma and mt > 10 * ma and mt - ma > 5e5:
                raisons.append(f"{mt / ma:.0f} fois le montant attribué publié par l'avis {x['id']} ({ma:,.0f} €)".replace(",", " "))
        if u in groupes:
            raisons.append("même montant publié par au moins 3 acheteurs le même mois (groupement de commandes ?)")
    c["montant_a_verifier"] = "; ".join(dict.fromkeys(raisons))
    if raisons:
        a_verifier.append({"uid": u, "date": e["date"], "acheteur": c["acheteur"], "acheteur_siren": c["acheteur_siren"],
                           "montant": mt, "objet": e["objet"], "raisons": c["montant_a_verifier"], "plafond_partage": c["plafond_partage"]})
    for i in affaires[u]["events"]:
        if evd[i]["t"] in ("attribution", "modification"):
            evd[i]["hors_totaux"] = ("centrale" if c["centrale_achat"] else "a_verifier" if raisons else
                                     f"mixte_{c['mixte_famille']}" if c["contrat_mixte"] else "")
            evd[i]["national"] = c["acheteur_national"]
for u, c in contrats.items():   # affaires were copied from contrats before the flags were set
    if u in affaires:
        affaires[u].update({k: c.get(k) for k in ("centrale_achat", "contrat_mixte", "mixte_famille", "montant_a_verifier",
                                                   "plafond_partage", "acheteur_national")})
pd.DataFrame(a_verifier).sort_values("montant", ascending=False).to_csv(D / "montants_a_verifier.csv", index=False)
print(f"montants à vérifier : {len(a_verifier)} (dont plafond partagé : {sum(1 for x in a_verifier if x['plafond_partage'])}) ;"
      f" centrales : {sum(c.get('centrale_achat', False) for c in contrats.values())} ;"
      f" mixtes sûreté : {sum(c.get('mixte_famille') == 'surete' for c in contrats.values())} ;"
      f" mixtes autres : {sum(c.get('mixte_famille') == 'autres' for c in contrats.values())} ;"
      f" acheteurs nationaux : {sum(c.get('acheteur_national', False) for c in contrats.values())} contrats")

# --- 5th pass: call for tenders → contract « probable » (same buyer, close objet, 1 to 12 months
# later; the same holder in the award notice is the strongest signal) -------------------------
STOP = set("de la le les des du et en a au aux pour sur dans un une d l lot n no marche marches accord cadre "
           "fourniture fournitures installation travaux prestations prestation maintenance".split())
toks = lambda x: {w for w in norm(x).split() if len(w) > 2 and w not in STOP}
def jac(a_, b_):
    a_, b_ = toks(a_), toks(b_)
    return len(a_ & b_) / len(a_ | b_) if a_ and b_ else 0.0
sys.path.insert(0, str(Path(__file__).parent))
from sirene_whitelist import key as name_key  # noqa: E402
ent_keys = {s_: name_key(r["raison_sociale"]) for s_, r in sirene.items() if r.get("raison_sociale")}
by_buyer = {}
for u, c in contrats.items():
    if u in first_attr:
        by_buyer.setdefault(c["acheteur_siren"], []).append(u)
avis_probables = 0
for aid, a_ in affaires.items():
    if a_["kind"] != "contrat_non_retrouve":
        continue
    es = [evd[i] for i in a_["events"]]
    av = next((e for e in es if e["t"] == "avis"), es[0])
    sir = av.get("acheteur_siren")
    if not sir or av["date"] < "2018-07-01":
        continue
    tit_s, tit_k = set(), set()
    for e in es:
        if e["id"] in bres.index:
            tit_s |= set(bres.loc[e["id"], "titulaires_siren"].split())
            tit_k |= set(bres.loc[e["id"], "titulaires_cles"].split())
    best = []
    for u in by_buyer.get(sir, []):
        ce = first_attr[u]
        dd = (pd.Timestamp(ce["date"]) - pd.Timestamp(av["date"])).days
        if not 30 <= dd <= 366:
            continue
        holder = bool(set(ce["entreprises"]) & tit_s) or any(ent_keys.get(x) in tit_k for x in ce["entreprises"])
        j = max(jac(av["objet"], ce["objet"]), max((jac(e["objet"], ce["objet"]) for e in es), default=0))
        if holder or j >= 0.25:
            best.append((holder, j, u, dd))
    if os.environ.get("DEBUG_AVIS") and aid == os.environ["DEBUG_AVIS"]:
        print("DEBUG", aid, sir, av["date"], av["objet"][:60], [(u, first_attr[u]["date"]) for u in by_buyer.get(sir, [])], best)
    if not best:
        continue
    best.sort(key=lambda t: (t[0], t[1]), reverse=True)
    if not best[0][0] and len(best) > 1 and best[1][1] >= best[0][1] - 0.05:
        continue   # two contracts as close as each other, no holder to decide: no link
    holder, j, u, dd = best[0]
    a_["contrat_probable"] = u
    a_["lien_probable"] = {"regle": "même titulaire" if holder else "objet proche", "jaccard": round(j, 2), "jours": dd}
    affaires[u].setdefault("avis_probables", []).append(aid)
    avis_probables += 1
# hand-read notes (relecture_notes.csv): a note on a row, and a link a reader established
notes = pd.read_csv(D / "relecture_notes.csv", dtype=str).fillna("")
for r in notes.itertuples():
    if r.id in evd or r.id in affaires:
        tgt = evd.get(r.id) or evd.get(f"{r.id}~0")
        if tgt:
            tgt["note_relecture"] = r.note
    if r.lier_avis in affaires and r.id in contrats and not affaires[r.lier_avis].get("contrat_probable"):
        affaires[r.lier_avis]["contrat_probable"] = r.id
        affaires[r.lier_avis]["lien_probable"] = {"regle": "relecture (date du contrat probablement erronée)", "jaccard": None, "jours": None}
        affaires[r.id].setdefault("avis_probables", []).append(r.lier_avis)
        avis_probables += 1
print(f"appels d'offres → contrat probable : {avis_probables}")
pd.DataFrame([{"avis_affaire": k, "avis": evd[v["events"][0]]["id"], "date_avis": v["debut"], "acheteur": evd[v["events"][0]].get("acheteur"),
               "objet_avis": evd[v["events"][0]]["objet"], "contrat": v["contrat_probable"], "date_contrat": first_attr[v["contrat_probable"]]["date"],
               "objet_contrat": first_attr[v["contrat_probable"]]["objet"], "montant_contrat": first_attr[v["contrat_probable"]]["montant"],
               "titulaires_contrat": " ".join(first_attr[v["contrat_probable"]]["entreprises"]), **v["lien_probable"]}
              for k, v in affaires.items() if v["kind"] == "contrat_non_retrouve" and v.get("contrat_probable")]
             ).to_csv(D / "liens_avis_contrat_probables.csv", index=False)

# --- entreprises ---------------------------------------------------------------------------
ent = {}
for e in ev:
    for s in e.get("entreprises", []):
        x = sirene.get(s, {})
        ei = x.get("nature_juridique") == "1000"
        ent.setdefault(s, {"siren": s, "nom": None if ei else (x.get("raison_sociale") or None),
                           "entrepreneur_individuel": ei, "nature_juridique": x.get("nature_juridique"),
                           "naf": x.get("naf"), "naf_libelle": naf.get((x.get("naf") or "").replace(".", "")),
                           "verifie_sirene": x.get("found") == "oui", "affaires": set()})
        ent[s]["affaires"].add(e["affaire"])
for x in ent.values():
    x["affaires"] = sorted(x["affaires"])

# --- linking rates -------------------------------------------------------------------------
rates = []
def rate(label, num_, den, rule):
    rates.append({"rattachement": label, "rattaches": num_, "total": den, "taux_pct": round(100 * num_ / den, 1) if den else None, "regle": rule})
mods = [e for e in ev if e["t"] == "modification"]
rate("modification → contrat", len(mods), len(mods), "même identifiant DECP (uid) : 100 % par construction")
bo = [e for e in ev if e["id"] in b_ids]
rate("avis BOAMP → contrat DECP", sum(1 for e in bo if e["affaire"] in contrats), len(bo),
     "SIREN de l'acheteur (SIRET de l'avis ou nom), date, similarité d'objet ≥ 0,2 ; ou par l'avis lié")
rate("dont avis rattachés par le nombre de caméras", len(par_cameras), len(bo), "même acheteur, même nombre de caméras dans l'avis et l'objet du contrat, contrat notifié dans les 18 mois")
rect = [e for e in bo if e["t"] in ("rectificatif", "resultat")]
rate("rectificatif ou résultat → son appel d'offres", sum(1 for e in rect if not e["affaire"].startswith(f"avis-{e['id']}")), len(rect), "numéros d'avis liés (annonces antérieures)")
vp = [e for e in ev if e["t"] == "arrete" and e["dep"] == "69"]
rate("arrêté de vidéoprotection → dossier préfectoral", sum(1 for e in vp if e.get("dossier")), len(vp), "numéro de dossier écrit dans l'arrêté")
bo19 = [e for e in bo if e["date"] >= "2019-01-01"]
rate("avis BOAMP depuis 2019 → contrat DECP", sum(1 for e in bo19 if e["affaire"] in contrats), len(bo19), "même règle, sur la période couverte par les DECP")
with_c = [s_ for s_ in idf_subs if s_["date"] >= "2019-07-01" and any(c["insee"] == s_["insee"] and -183 <= (pd.Timestamp(s_["date"]) - pd.Timestamp(c["date"])).days <= 730 for c in contrat_events)]
rate("subvention IDF (commune ayant un contrat dans la fenêtre) → contrat « probable »", sum(1 for s_ in with_c if "contrat_probable" in affaires[s_["affaire"]]), len(with_c), "même règle, seulement quand un contrat de la commune existe dans la fenêtre")
rate("subvention IDF → contrat « probable »", probables, len(idf_subs), "même commune, même nombre de caméras (objet ou avis), contrat notifié de 6 mois avant à 24 mois après le vote")
rate("avis BOAMP depuis 2019 → contrat DECP, y compris « probable »", sum(1 for e in bo19 if e["affaire"] in contrats or affaires[e["affaire"]].get("contrat_probable")), len(bo19),
     "rattachement par l'identifiant ou l'avis lié, puis « probable » : même acheteur, objet proche (Jaccard ≥ 0,25) ou même titulaire dans l'avis de résultat, contrat signé 1 à 12 mois après l'avis")
att = [e for e in ev if e["t"] == "attribution" and not contrats[e["affaire"]]["hors_pilote"]]
rate("contrat → au moins un avis BOAMP", sum(1 for e in att if any(evd[i]["t"] in ("avis", "resultat", "rectificatif") for i in affaires[e["affaire"]]["events"])), len(att), "lien inverse du rattachement avis → contrat")
pd.DataFrame(rates).to_csv(D / "registre_rattachement.csv", index=False)

# --- archive check results, if measured -------------------------------------------------------
arch = D / "archives_verif.csv"
if arch.exists():
    for r in csv.DictReader(open(arch)):
        if r["url"] in docs:
            docs[r["url"]]["archive"] = r["archive_url"] or None

# --- automatic control: every commune shown has a name (no « undefined ») -----------------------
shown = {k: v for k, v in communes.items() if v["dep"] in SCOPE or k in {e.get("insee") for e in ev}}
orphans = sorted({e["insee"] for e in ev if e.get("insee") and e["insee"] not in shown}
                 | {a_["insee"] for a_ in affaires.values() if a_.get("insee") and a_["insee"] not in shown})
if orphans:
    sys.exit(f"CONTRÔLE ÉCHOUÉ : {len(orphans)} codes de commune sans nom, ex. {orphans[:8]}")
print("contrôle des communes : aucun code sans nom")

# --- automatic control: no beneficiary is shown outside the SIRENE whitelist ------------------
wl_ok = {(r["siren"], r["nom_affiche"]) for r in csv.DictReader(open(D / "sirene_noms_cache.csv"))
         if r["siren"] and not r["nature_juridique"].startswith("1")} if (D / "sirene_noms_cache.csv").exists() else set()
bad = [e["id"] for e in ev if e["t"].startswith("arrete") and e.get("type_beneficiaire") not in PUBLIC_BENEF and e.get("beneficiaire")
       and not e["beneficiaire"].startswith("[") and (e.get("beneficiaire_siren"), e["beneficiaire"]) not in wl_ok]
if bad:
    sys.exit(f"CONTRÔLE ÉCHOUÉ : {len(bad)} bénéficiaires affichés hors de la liste blanche SIRENE, ex. {bad[:5]}")
print(f"contrôle liste blanche : 0 bénéficiaire privé affiché hors SIRENE ({sum(1 for e in ev if e.get('beneficiaire_siren'))} affichés avec leur SIREN)")

reg = {"meta": {"construit": TODAY, "licence": "Licence Ouverte 2.0 (registre) — sources citées par ligne ; données OpenStreetMap exclues (ODbL)",
                "perimetre": "acheteurs et actes de Paris, du Rhône, des Bouches-du-Rhône et d'Île-de-France ; contrats d'Alphaiota hors périmètre marqués",
                "rattachements": rates},
       "evenements": ev, "affaires": affaires, "entreprises": ent, "documents": docs, "mandats": mandats,
       "communes": {k: v for k, v in communes.items() if v["dep"] in SCOPE or k in {e.get("insee") for e in ev}}}
out = M / "prototype-v4"
out.mkdir(exist_ok=True)
js = "window.REG = " + json.dumps(reg, ensure_ascii=False, separators=(",", ":"), default=str) + ";\n"
(out / "registre.js").write_text(js)
# map points: commune centres (geo.api.gouv.fr) for the communes in the registre, and the
# France outline dots of the v3 boards
cent = {c["code"]: c["centre"]["coordinates"] for c in json.load(open(M / "data/raw/geo_pop/communes_centres.json")) if c.get("centre")}
used = {e.get("insee") for e in ev if e.get("insee")}
fond = (M / "planches-v3/france.js").read_text().split("\n")[0]
(out / "carte.js").write_text(fond + "\nwindow.CENTRES = " + json.dumps({k: cent[k] for k in sorted(used) if k in cent}, separators=(",", ":")) + ";\n")
# OpenStreetMap counts (ODbL), kept in their own file: never in registre.js nor in an export
osm = {}
for f in ("osm_5_communes.csv", "osm_mions.csv"):
    for r in csv.DictReader(l for l in open(D / "communes" / f) if not l.startswith("#")):
        o = osm.setdefault(r["code"], {"serie": {}})
        o["serie"][r["date"][:4]] = int(r["count_man_made_surveillance"])
        o["n"], o["date"] = int(r["count_man_made_surveillance"]), r["date"]
(out / "osm.js").write_text("// © contributeurs OpenStreetMap, ODbL 1.0 ; comptages par l'API ohsome (HeiGIT), au 1er janvier, dernière date = fin de la base.\n"
                            "window.OSM = " + json.dumps(osm, separators=(",", ":")) + ";\n")
print(f"identifiants de titulaire écartés (ni SIREN ni SIRET) : {len(bad_ids)}", sorted(bad_ids)[:8])
print(f"{len(ev)} événements, {len(affaires)} affaires, {len(ent)} entreprises, {len(docs)} documents; {len(js) / 1e6:.1f} Mo")
print(pd.DataFrame(rates).to_string(index=False))
