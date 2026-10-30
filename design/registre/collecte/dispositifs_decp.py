"""Search the whole DECP for each surveillance device by its objet, then VSA by supplier SIREN.

Usage: python -I dispositifs_decp.py <decp.parquet> <out_dir>

Writes dispositifs_decp.parquet (one row per contract and device), dispositifs_volumes.csv,
vsa_fournisseurs_candidats.csv (holders of objet-matched VSA contracts, to check in SIRENE).
"""

import sys

import duckdb

decp, out = sys.argv[1:3]
DEVICES = {
    "vsa": r"vid[ée]o[\s\-]*(intelligente|analyse)|analyse\s+(vid[ée]o|d.images|automatique\s+d)|algorithm"
           r"|\bvsa\b|traitement\s+automatis[ée]\s+d.images|d[ée]tection\s+automatique|intelligence\s+artificielle.{0,60}(vid|cam[ée]ra|image)"
           r"|(vid|cam[ée]ra|image).{0,60}intelligence\s+artificielle|cam[ée]ras?\s+(ia|intelligentes?)\b",
    "lapi": r"lecture\s+automati(que|s[ée]e)\s+des?\s+plaques|\blapi\b",
    "cameras_pietons": r"cam[ée]ras?[\s\-]+(pi[ée]tons?|individuelles|corporelles)|body[\s\-]?cam",
    "videoverbalisation": r"vid[ée]o[\s\-]*verbalis",
    "csu": r"\bcsu\b|centres?\s+de\s+supervision|supervision\s+urbaine|centre\s+de\s+vid[ée]o[\s\-]*protection",
    "drones": r"drones?|a[ée]ronefs?\s+(sans|t[ée]l[ée]pilot)",
}
# Drones and VSA words also name non-surveillance purchases: keep them only with a security context.
CONTEXT = r"surveillance|s[ée]curit|police|gendarmerie|vid[ée]o[\s\-]*protection|sûreté|surete|captation|cam[ée]ra"

con = duckdb.connect()
con.execute(f"""create view cur as select * from read_parquet('{decp}')
                qualify row_number() over (partition by uid order by modification_id desc, titulaire_id) = 1""")
parts = []
for dev, rx in DEVICES.items():
    ctx = f"and regexp_matches(lower(objet), '{CONTEXT}')" if dev in ("drones", "vsa") else ""
    parts.append(f"""select '{dev}' dispositif, uid, acheteur_id, acheteur_nom, acheteur_categorie, acheteur_departement_code,
                            acheteur_commune_code, codeCPV, dateNotification, montant, objet
                     from cur where regexp_matches(lower(objet), '{rx}') {ctx}""")
con.execute("create table hits as " + " union all ".join(parts))
con.execute(f"copy hits to '{out}/dispositifs_decp.parquet' (format parquet)")
vol = con.execute("""
  select dispositif,
         count(*) filter (where year(dateNotification) >= 2019) france_2019_plus,
         count(*) filter (where year(dateNotification) >= 2019 and acheteur_departement_code in ('75','69','13')) pilote,
         count(distinct acheteur_id[:9]) filter (where year(dateNotification) >= 2019) acheteurs_france
  from hits group by 1 order by 2 desc""").df()
vol.to_csv(f"{out}/dispositifs_volumes.csv", index=False)
print(vol.to_string())

# VSA holders: every holder SIRET of the objet-matched VSA contracts, all rows of those contracts.
con.execute(f"""copy (
  select left(d.titulaire_id, 9) siren, count(distinct d.uid) marches_vsa_objet, min(d.dateNotification) premier
  from read_parquet('{decp}') d join hits h using (uid)
  where h.dispositif = 'vsa' and d.titulaire_typeIdentifiant ilike 'SIRET%' and length(d.titulaire_id) >= 9
  group by 1 order by 2 desc) to '{out}/vsa_fournisseurs_candidats.csv' (header)""")
