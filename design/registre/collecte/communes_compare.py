"""Five IDF communes, year by year: regional aid, BOAMP quantities, DECP contracts, OSM mapping.

Usage: python -I communes_compare.py <derived dir> <osm csv>

Writes communes/communes_5_par_an.csv (long) and communes/communes_5_details.csv
(one row per source item, with its link), and prints a table per commune.
"""

import sys
import unicodedata
from pathlib import Path

import re

import pandas as pd

# DECP objets sometimes state the count, abbreviated: « 17 NLLES CAMERAS », « 15 NLELS CAMERAS ».
DECP_QTY = re.compile(r"(?<![\w,.])(\d{1,4})\s+(?:nouvelles?\s+|nlles\s+|nlels\s+|nouv\.?\s+)?cam[ée]ras?", re.I)


def decp_qty(objet) -> int | None:
    found = [int(n) for n in DECP_QTY.findall(str(objet or "")) if 0 < int(n) <= 2000]
    return max(found) if found else None


d, osm_csv = Path(sys.argv[1]), sys.argv[2]
COMMUNES = {"77131": "Coulommiers", "94017": "Champigny-sur-Marne", "91386": "Mennecy",
            "91312": "Igny", "93066": "Saint-Denis"}

a = pd.read_csv(d / "idf/idf_aides.csv", dtype={"insee_commune": str})
a = a[(a.reaffectation != "oui") & a.insee_commune.isin(COMMUNES)]
m = pd.read_parquet(d / "decp/marches_classes.parquet")
m = m[(m.acheteur_categorie == "Commune") & m.acheteur_commune_code.isin(COMMUNES)]
sirens = m.groupby("acheteur_commune_code").siren.first().to_dict()
b = pd.read_parquet(d / "boamp/boamp_avis.parquet")
q = pd.read_csv(d / "boamp/boamp_quantites.csv")
b["siren"] = b.sirets.str[:9]
L = pd.read_csv(d / "boamp/liens_boamp_decp.csv", dtype={"siren": str})

details = []
for code, name in COMMUNES.items():
    for r in a[a.insee_commune == code].itertuples():
        details.append({"insee": code, "commune": name, "annee": r.annee, "source": "Région IDF (aide votée)",
                        "cameras": r.n_cameras_total, "nouvelles": r.n_cameras_nouvelles, "remplacees": r.n_cameras_remplacees,
                        "montant_eur": r.base_subventionnable_ht, "ref": r.deliberation_id, "url": r.source_url})
    siren = sirens.get(code)
    # BOAMP notices of this buyer: by SIRET in the notice, or linked to one of its DECP contracts.
    ids = set(b.loc[b.siren == siren, "idweb"]) | set(L.loc[L.siren == siren, "idweb"])
    # One procedure = its call for tenders, corrections and award: same buyer, same objet.
    # Counted once, in the year of its first notice, with the largest figure any of them gives
    # (a sum would count a sentence repeated in the description twice).
    bb = b[b.idweb.isin(ids) & b.objet_video].copy()
    # A notice can carry another buyer's SIRET (Gonesse's notices carry Garges-lès-Gonesse's):
    # keep it only when the buyer's name is this commune's.
    key = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().replace("-", " ")
    bb = bb[bb.acheteur.fillna("").map(lambda s: key in unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("-", " "))]
    bb["proc"] = bb.objet.str.lower().str.replace(r"[^a-z0-9]+", " ", regex=True).str.strip()
    for proc, g in bb.sort_values("dateparution").groupby("proc", sort=False):
        qs = q[q.idweb.isin(g.idweb)]
        new = qs.loc[qs.type == "nouvelles", "n"].max() if (qs.type == "nouvelles").any() else None
        parc = qs.loc[qs.type == "parc existant", "n"].max() if (qs.type == "parc existant").any() else None
        r = g.iloc[0]
        details.append({"insee": code, "commune": name, "annee": int(r.dateparution[:4]), "source": "BOAMP (procédure)",
                        "cameras": new, "parc_declare": parc, "ref": ";".join(g.idweb), "url": r.url_avis,
                        "objet": r.objet, "acheteur_avis": r.acheteur})
    for r in m[m.acheteur_commune_code == code].itertuples():
        details.append({"insee": code, "commune": name, "annee": r.annee, "source": "DECP (marché notifié)",
                        "montant_eur": r.montant_initial, "categorie": r.categorie, "ref": r.uid, "objet": r.objet,
                        "cameras": decp_qty(r.objet)})

D = pd.DataFrame(details)
osm = pd.read_csv(osm_csv, dtype={"code": str}, comment="#")
osm = osm[(osm.level == "commune") & osm.code.isin(COMMUNES)].copy()
osm["annee"] = pd.to_datetime(osm.date).dt.year
osm = osm[pd.to_datetime(osm.date).dt.strftime("%m-%d") == "01-01"]
out = Path(d / "communes")
out.mkdir(exist_ok=True)
D.to_csv(out / "communes_5_details.csv", index=False)

rows = []
for code, name in COMMUNES.items():
    x = D[D.insee == code]
    for y in range(2015, 2027):
        g = x[x.annee == y]
        reg = g[g.source.str.startswith("Région")]
        bo = g[g.source.str.startswith("BOAMP")]
        de = g[g.source.str.startswith("DECP")]
        o = osm[(osm.code == code) & (osm.annee == y)]
        rows.append({"insee": code, "commune": name, "annee": y,
                     "region_cameras": reg.cameras.sum() if len(reg) else None,
                     "boamp_nouvelles": bo.cameras.sum() if bo.cameras.notna().any() else None,
                     "boamp_parc_declare": bo.parc_declare.max() if "parc_declare" in bo and bo.parc_declare.notna().any() else None,
                     "boamp_avis": len(bo) or None,
                     "decp_cameras_objet": de.cameras.sum() if de.cameras.notna().any() else None,
                     "decp_marches": len(de) or None,
                     "decp_montant_eur": de.montant_eur.sum() if len(de) else None,
                     "osm_cartographiees_1er_janvier": int(o.count_man_made_surveillance.iloc[0]) if len(o) else None})
R = pd.DataFrame(rows)
R.to_csv(out / "communes_5_par_an.csv", index=False)
pd.set_option("display.width", 220)
for code, name in COMMUNES.items():
    print("\n==", name)
    print(R[R.insee == code].drop(columns=["insee", "commune"]).set_index("annee").T.to_string())
