"""Select video-surveillance contracts from the consolidated DECP.

Usage: python -I decp_select.py <decp.parquet> <cpv_codes.csv> <out_dir>

Writes:
  candidates.parquet  one row per (uid, modification_id, titulaire) kept, with the selection path
  marches.parquet     one row per contract (uid): initial notice, current state, modifications
"""

import sys

import duckdb

decp, cpv, out = sys.argv[1:4]
con = duckdb.connect()
con.execute(f"create view d as select * from read_parquet('{decp}')")
con.execute(f"create table cpv as select * from read_csv('{cpv}', all_varchar=true)")

# Strong words name video surveillance unambiguously; weak words need a CPV or a context.
STRONG = (
    r"vid[ée]o[\s\-]*(protection|surveillance|verbalisation|patrouill)"
    r"|\bcsu\b|centres?\s+de\s+supervision\s+urbain|supervision\s+urbaine"
    r"|cam[ée]ras?\s+de\s+(surveillance|vid[ée]o|s[ée]curit[ée]|protection)"
    r"|lecture\s+automatique\s+de\s+plaques|\blapi\b"
    r"|cam[ée]ras?[\s\-]+(pi[ée]tons?|individuelles|nomades)"
)
# Reviewed sample (sample_noise.csv): bare "vidéo", "supervision" and "caméra" alone were
# mostly audiovisual, scientific, medical or sewer-inspection purchases; "PPMS" mostly
# school alarms and bells; "surveillance" alone mostly guarding (CPV 79714000).
VIDEO_ANY = r"vid[ée]o|cam[ée]ra|webcam|images"
WEAK = (
    r"cam[ée]ras?|lev[ée]e\s+de\s+doute\s+vid[ée]o|portiers?\s+vid[ée]o"
    r"|vid[ée]o.{0,40}(s[ûu]ret[ée]|s[ée]curit[ée]|intrusion)"
    r"|(s[ûu]ret[ée]|s[ée]curit[ée]|intrusion).{0,40}vid[ée]o"
)
# Round-3 review: what the non-"strong" paths still caught that is not surveillance.
NOISE = (
    r"thermique|inspection|assainissement|incendie|feux|sous[\s\-]marine|optronique|spectr"
    r"|scientifique|microscop|gamma|holograph|covoiturage|trafic|circulation|webcam|front d.onde"
)
DRONE_CONTEXT = (
    r"drones?.*(surveillance|s[ée]curit[ée] publique|police|gendarmerie)"
    r"|(surveillance|police|gendarmerie).*drones?"
)

con.execute(f"""
create table cand as
select d.*,  -- the raw parquet holds no holders' names (dropped at collection: SIREN only)
       c.role as cpv_role,
       regexp_matches(lower(objet), '{STRONG}') as kw_strong,
       regexp_matches(lower(objet), '{WEAK}') as kw_weak,
       regexp_matches(lower(objet), '{DRONE_CONTEXT}') as kw_drone,
       case
         when coalesce(c.role, '') = 'exclu' then null
         when regexp_matches(lower(objet), '{STRONG}') then 'mot_fort'
         when c.role = 'coeur' and regexp_matches(lower(objet), '{VIDEO_ANY}|{WEAK}') then 'cpv_coeur+mot'
         when c.role = 'coeur' then 'cpv_coeur_seul'
         when regexp_matches(lower(objet), '{DRONE_CONTEXT}') then 'drone'
         when c.role = 'drone' and (regexp_matches(lower(acheteur_nom), 'police|gendarmerie|int[ée]rieur')) then 'drone'
         when c.role = 'large' and regexp_matches(lower(objet), '{WEAK}') then 'cpv_large+mot_faible'
       end as path
from d left join cpv c on left(d.codeCPV, 8) = c.code
""")
# Keep every row of a contract once any of its rows qualifies (modification rows may lack objet).
con.execute("""
create or replace table cand as
with p as (
  select uid, min(case path when 'mot_fort' then 1 when 'cpv_coeur+mot' then 2
                            when 'cpv_large+mot_faible' then 3 when 'drone' then 4 else 5 end) r
  from cand where path is not null group by 1)
select cand.* exclude (path),
       ['mot_fort','cpv_coeur+mot','cpv_large+mot_faible','drone','cpv_coeur_seul'][p.r] as path
from cand join p using (uid)
""")
con.execute(f"update cand set path = null where path not in ('mot_fort', 'drone') and regexp_matches(lower(objet), '{NOISE}')")
con.execute("delete from cand where uid in (select uid from cand where path is null)")
con.execute(f"copy cand to '{out}/candidates.parquet' (format parquet)")

# One row per contract. Amounts repeat on each co-holder row, so take one per (uid, modification_id).
con.execute(f"""
copy (
  with per_mod as (
    select uid, modification_id,
           any_value(montant) montant, any_value(dateNotification) date_notif,
           any_value(objet) objet, any_value(dureeMois) duree_mois,
           string_agg(distinct titulaire_id, ';') titulaires_id,
           count(distinct titulaire_id) n_titulaires,
           bool_or(donneesActuelles) actuelle
    from cand group by 1, 2
  ),
  first as (select * from per_mod qualify row_number() over (partition by uid order by modification_id) = 1),
  cur as (select * from per_mod qualify row_number() over (partition by uid order by modification_id desc) = 1)
  select k.uid, k.id, k.acheteur_id, k.acheteur_nom, k.acheteur_categorie,
         k.acheteur_commune_code, k.acheteur_commune_nom, k.acheteur_departement_code,
         k.codeCPV, k.cpv_role, k.path, k.nature, k.procedure, k.techniques, k.idAccordCadre,
         k.lieuExecution_code, k.lieuExecution_typeCode, k.sourceDataset,
         f.objet, f.date_notif as date_notification, f.montant as montant_initial,
         f.duree_mois, f.n_titulaires, f.titulaires_id,
         cur.modification_id as n_modifications, cur.montant as montant_actuel,
         cur.date_notif as date_derniere_modif,
         k.montant_anomalie
  from (select * from cand qualify row_number() over (partition by uid order by modification_id) = 1) k
  join first f using (uid) join cur using (uid)
) to '{out}/marches.parquet' (format parquet)
""")
# Kept out of every total, but not lost: a CPV alone was relevant one time in two (sample_noise.csv).
con.execute(f"""copy (select uid, acheteur_id, acheteur_nom, acheteur_departement_code, codeCPV, date_notification,
                      montant_initial, objet from read_parquet('{out}/marches.parquet') where path = 'cpv_coeur_seul'
                      order by date_notification) to '{out}/a_relire_cpv_seul.csv' (header)""")
print(con.execute(f"select path, count(*) n from read_parquet('{out}/marches.parquet') group by 1 order by 2 desc").df())
