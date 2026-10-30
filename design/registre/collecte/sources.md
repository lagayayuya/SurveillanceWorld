# Sources (URL, date de téléchargement, licence)

| Fichier local | URL | Téléchargé le | Licence |
|---|---|---|---|
| data/raw/decp_schema/schema.json | https://static.data.gouv.fr/resources/donnees-essentielles-de-la-commande-publique-consolidees-format-tabulaire/20261023-052021/schema.json | 2026-10-23 | Licence Ouverte 2.0 (DECP consolidées, data.gouv.fr, version du 2026-10-23 05:20) |
| data/raw/decp/decp.parquet | https://static.data.gouv.fr/resources/donnees-essentielles-de-la-commande-publique-consolidees-format-tabulaire/20261023-051653/decp.parquet | 2026-10-23 | Licence Ouverte 2.0 (DECP consolidées, data.gouv.fr, version du 2026-10-23 05:16) |
| data/raw/cpv_op/cpv_fr.csv | https://publications.europa.eu/webapi/rdf/sparql (concept scheme http://data.europa.eu/cpv/cpv, libellés FR, 9 454 codes) | 2026-10-23 | Office des publications de l'UE, réutilisation libre (décision 2011/833/UE) |
| data/raw/boamp/pilotes_full.jsonl | https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records (objet vidéo, départements 75, 69, 13, avec `donnees`) | 2026-10-23 | Licence Ouverte 2.0 (DILA) |
| data/raw/boamp/national_light.jsonl | même API, France entière, champs légers | 2026-10-23 | Licence Ouverte 2.0 (DILA) |
| data/raw/boamp/idf_full.jsonl | même API, départements 77, 78, 91, 92, 93, 94, 95, avec `donnees` | 2026-10-23 | Licence Ouverte 2.0 (DILA) |
| data/raw/geo_communes/communes.json | https://geo.api.gouv.fr/communes?fields=code,nom,population,codeDepartement,codeRegion | 2026-10-23 | Licence Ouverte 2.0 (API Découpage administratif, populations INSEE) |
| (consultation) | https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045739606 (art. R2196-1 CCP, en vigueur depuis le 01/01/2024) | 2026-10-23 | — |
| (consultation) | https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000046850496 (arrêté du 22/12/2022, données essentielles) | 2026-10-23 | — |
| (requêtes unitaires) | https://recherche-entreprises.api.gouv.fr/search (nature juridique des titulaires des 3 traces) | 2026-10-23 | Licence Ouverte 2.0 |

Robot : `la-carte-exploration/0.1 (+https://github.com/lagayayuya/SurveillanceWorld)`, 1 requête/s. Les toutes premières requêtes (schéma et Parquet DECP, EUR-Lex, SIMAP) portaient une adresse mail de contact dans l'identifiant ; remplacée ensuite par l'URL du dépôt.

Les trois volets délégués tiennent leur propre journal (URL et date de chaque fichier) : `data/derived/idf/idf_sources.csv`, `data/raw/regions/regions_sources.csv`, `data/raw/arretes/manifest.tsv`, `data/raw/detr/*/manifest.tsv`, et `data/raw/ohsome/requests.jsonl` pour ohsome.

**`data/raw/` contient des données personnelles par nature** : noms et adresses mail des correspondants dans le champ `donnees` du BOAMP, gérants et maires dans les recueils des actes administratifs, noms des titulaires dans le Parquet DECP. Ces fichiers ne doivent jamais sortir de ce dossier privé. Les fichiers dérivés ne gardent que des personnes morales et des SIREN.

**Depuis la session de cadrage (23/10/2026, après-midi)** : l'identifiant de robot est `SurveillanceWorld-research (+<contact>)` dans tous les scripts. Les quatre premières requêtes de la matinée (schéma et Parquet DECP, EUR-Lex, SIMAP) portaient une adresse personnelle ; c'est noté ici, rien d'autre à faire.

**Session de cadrage, sources ajoutées.**
- Nomenclatures INSEE : `data/raw/insee_cj/cj.xls` (catégories juridiques, version de septembre 2022), https://www.insee.fr/fr/statistiques/fichier/2028129/cj_septembre_2022.xls, téléchargé le 23/10/2026 ; NAF 58.29C lue sur https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/58.29C.
- Journaux des volets délégués : `data/raw/dispositifs/{raa,index,sirene}/manifest.tsv` et `data/raw/subventions/*/manifest.tsv` (URL, date et SHA-256), plus `data/raw/subventions/manifest_external.tsv` pour les fichiers repris des autres volets.
- Fournisseurs VSA et provenance de chaque SIREN : `data/derived/dispositifs_decp/vsa_fournisseurs.csv`.
- Corrections de SIRET : `data/derived/boamp/corrections.csv`.

**Écarts à signaler.**
- Les lectures faites avec l'outil WebFetch ne portent pas notre identifiant de robot : Légifrance, op.europa.eu, insee.fr, recherche-entreprises (docs), senat.fr (volet dispositifs).
- Le volet dispositifs a demandé 9 fois par erreur la page d'accueil de rhone.gouv.fr (fichiers supprimés, lignes annotées dans le manifeste) et a écrit un fichier temporaire dans /tmp (supprimé).
- Ses échantillons de recueils ont été choisis et non tirés au hasard, ce qui biaise vers le haut.
- Le volet subventions a lu la copie data.gouv des données Occitanie alors que data.laregion.fr interdit `/api/` aux robots, et a traité un `robots.txt` injoignable (Lot-et-Garonne, erreur 599) comme une absence de règle.

**Conservation.** Les PDF et pages d'index de `data/raw/{idf,arretes,detr,dispositifs,subventions,insee_cj}` contiennent des noms tels que publiés. Le délai de 30 jours court depuis le 23/10/2026 : première purge le **22/11/2026**. On ne garde ensuite que l'URL, la date et le SHA-256 des manifestes.

**Troisième passe (23/10/2026, soir).**
- Essonne : `robots.txt` absent (404, trois variantes d'hôte). Pages de liste `https://www.essonne.gouv.fr/Publications/Recueils-des-actes-administratifs-RAA/<année>/<Mois>` (12 pages lues) → `data/derived/essonne/recueils_12_mois_urls.txt`. Aucun PDF téléchargé.
- Rhône : 404 recueils (novembre 2025 à octobre 2026) listés par `https://www.rhone.gouv.fr/Publications/Recueil-des-actes-administratifs-du-Rhone-RAA/…`. URL, date et SHA-256 dans `data/raw/rhone_raa/manifest.tsv`, requêtes dans `requests.tsv`. Les PDF (1,46 Go) contiennent des noms tels que publiés : **suppression le 23/11/2026 au plus tard**, en gardant le manifeste.
- Populations et centres des communes : `data/raw/geo_pop/communes_91.json`, `communes_69.json`, `communes_centres.json` (API Découpage administratif, Licence Ouverte 2.0).
- Nomenclature d'activités : https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/42.22Z et …/46.51Z (lues avec WebFetch).
- Dates des élections municipales : décret n° 2025-848 du 27/08/2025 (https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000052142190) et décret n° 2020-642 du 27/05/2020, lus avec WebFetch.
- OSM de Mions : `data/derived/communes/osm_mions.csv` (une requête ohsome).
- Lot-et-Garonne : fichiers supprimés (RFC 9309) ; trace dans `data/raw/subventions/detr_sample/manifest.tsv`.

**Quatrième passe (24/10/2026).**
- SIRENE (titulaires du registre) : API Recherche d'entreprises, `https://recherche-entreprises.api.gouv.fr/search?q=<SIREN>`, une requête toutes les 1,1 s, identifiant de robot du projet → `data/derived/entreprises_sirene.csv` (raison sociale vide pour un entrepreneur individuel). Licence Ouverte 2.0.
- Nomenclature NAF rév. 2 (libellés) : `data/raw/insee_naf/naf2008_liste_n5.xls`, insee.fr.
- DECP consolidées (`data/raw/decp/decp.parquet`, déjà collecté) : 18 contrats d'Alphaiota repris par SIREN, hors de la sélection par objet.
- archive.org (`/wayback/available`) : 20 essais, tous refusés (429) → `data/derived/archives_verif.csv`. Rien n'est construit dessus.
- Aucune nouvelle collecte de recueils. Les CSV extraits du Rhône (`actes.csv`, `actes_toutes_publications.csv`) ont été refiltrés par `scripts/rhone_raa/refilter_names.py` (règle des noms durcie, voir `rapport-v4.md` § 3).
- Le prototype (`prototype-v4/`) n'appelle aucun service : vérifié par `scripts/check_v4.cjs`, qui journalise toute requête autre que `file:`, `blob:` ou `data:`.

**Cinquième passe (24/10/2026).**
- BOAMP : titulaires (SIREN, ou empreinte SHA-256 du nom normalisé), montants attribués, valeurs estimées, lus dans les avis déjà collectés → `data/derived/boamp/resultats.csv` (`scripts/boamp_resultats.py`). Aucune nouvelle requête au BOAMP.
- API Recherche d'entreprises, documentation lue le 24/10/2026 (`/openapi.json` : le paramètre `departement` filtre les établissements ; la recherche porte aussi sur les dirigeants et les élus ; au plus 7 requêtes par seconde). Recherches de noms pour la liste blanche à une requête par 1,1 s → `data/derived/sirene_noms_cache.csv` (clés = empreintes, seules les personnes morales acceptées en clair). L'API et l'infrastructure de data.gouv.fr ne répondaient plus de 13 h 59 à au moins 15 h 15, avec une réponse isolée à 15 h 09 (`rapport-v5.md` § 4).
- files.data.gouv.fr : `robots.txt` lu, `Disallow: /` pour tous : pas utilisé.
- Ma Dada : `robots.txt` lu (seuls certains chemins sont interdits), puis la page d'accueil, une fois, le 24/10/2026, avec l'identifiant du projet.
- Recueils du Rhône : relus depuis la copie privée (aucune nouvelle requête). État intermédiaire avec les noms candidats dans `data/raw/rhone_raa/_extraction_en_cours.pkl` : même purge que les PDF (23/11/2026 au plus tard), supprimé automatiquement après application de la liste blanche.
- DECP : vérification des enregistrements de Mions dans `data/raw/decp/decp.parquet`, déjà collecté.

**Fin de la cinquième passe (24/10/2026, après-midi).**
- API Recherche d'entreprises depuis le Mac de Ju (ProtonVPN connecté) : réponses irrégulières de 15 h 29 à 15 h 39, puis arrêt de la reprise (`rapport-v5b.md` § 1). 22 noms vérifiés en cache (empreintes).
- INSEE : guide « Utiliser les API de l'Insee » (static.insee.fr/api-sirene/Insee_API_publique_modalites_connexion.pdf, lu avec WebFetch) ; quota de 30 requêtes par minute lu sur https://www.insee.fr/fr/information/9019311 (mise à jour du 01/07/2026, WebFetch). portail-api.insee.fr : `robots.txt` et page d'accueil lus une fois avec l'identifiant du projet. Aucune clé créée, aucun appel à l'API Sirene.
- BOAMP : marqueurs de groupement de commandes (`AGIT_POUR_AUTRE_COMPTE_OUI`, « groupement de commandes », « coordonnateur », plusieurs acheteurs eForms) lus dans les avis déjà collectés ; aucune nouvelle requête.
- Reprise SIRENE, VPN coupé, de 15 h 43 à 16 h 51 : décrochages de l'API de 15 h 55 à 16 h 05 et à 16 h 45, relance à 16 h 50, fin. Revérification des noms acceptés (`recheck_enseignes.py`, règles enseigne, sigle et homonymes) jusqu'à 17 h 10 environ. Cache : 891 réponses, clés par empreinte.

**Sixième passe (24/10/2026, soir).**
- axe-core 4.10.2 (npm, MPL-2.0), installé dans `~/.cache/la-carte-explorations/node`, hors du dépôt ; injecté localement, aucun appel réseau pendant les mesures.
- Couleurs du mode sombre lues dans `web/src/theme/punk/tokens.css` du dépôt (lecture seule).
- Cartes de partage v3 recopiées dans `revue-v6/partage/` avec les polices locales (l'original chargeait Google Fonts).

**Septième passe (24/10/2026, nuit).**
- OpenStreetMap, extrait local de la France du 16/10/2026 (`<chemin local>`, lu sans modification) : découpe du Rhône (`data/raw/osm_rhone/rhone.osm.pbf`, osmium), puis rues nommées, lieux nommés, limites de communes et adresses numérotées (ogr2ogr, osmium). ODbL. Extrait d'Île-de-France du dépôt pour l'objet « Stade de France ».
- Fond de carte du site : `data/basemap/france.pmtiles` du dépôt, découpé sur Lyon (`pmtiles extract`, 18 Mo) ; glyphes et sprites de `web/public/basemap/` ; bibliothèques maplibre-gl 6.11.2, pmtiles 4.5.0 (BSD-3-Clause), fflate 0.8.3 (MIT), @protomaps/basemaps 5.7.2 (BSD-3-Clause), copiées de `web/node_modules` dans `drones/lib/`.
- Arrêtés de drones du Rhône : relus depuis la copie privée des recueils (aucune requête). Textes filtrés des noms de personnes, gardés dans le dossier de travail de la session, hors du projet.

## Passe 8 (24/10/2026)

- Carte des communes : construction du site (`data/build/<région>/{communes,cameras,bands,street_portions}.parquet`, OpenStreetMap, ODbL), découpée par `scripts/carte/couches.py` ; fond `data/basemap/france.pmtiles` (Protomaps), extrait par commune avec `pmtiles extract`.
- Offres reçues : colonne `offresRecues` des données consolidées de la commande publique (`data/raw/decp/decp.parquet`), 594 contrats sur 1 233.
- Communes des sites hors département : `data/raw/geo_communes/communes.json` (codes INSEE de Dullin, Nances, Andilly, Vif, Sinard, Varces-Allières-et-Risset, Cruseilles).
- Zones de drones : tracés à la main de deux agents indépendants (`data/derived/drones/traces_main_{A,B}`), OSM Rhône local ; zone d'analyse algorithmique du Stade de France : deux tracés (`traces_vsa_{C,D}`), OSM Île-de-France local (`data/build/fr-idf/fr-idf.osm.pbf`).
- Textes des arrêtés de drones, nettoyés : `data/raw/rhone_raa/drones_textes.jsonl` (purge avec les PDF le 23/11/2026).
