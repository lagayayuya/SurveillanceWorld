# Cadrage avant le national : dispositifs, données, affichage

23/10/2026, session Explorations. Rien n'a été collecté au national : ce rapport dit ce qui tournerait et combien cela coûterait. Le dépôt, le verrou et le serveur n'ont pas été touchés. Compléments : `dictionnaire.md`, `planches/`, `rapport.md` (premier rapport, dont la section OSM est maintenant remplie).

## 0. Ce qui a changé depuis le premier rapport

- **Identifiant de robot.** `SurveillanceWorld-research (+<contact>)` dans tous les scripts.
- **Données personnelles retirées dès la collecte** (`scripts/sanitize.py`, appelé par `boamp_fetch.py`) :
  - dans le BOAMP brut, les contacts, courriels, téléphones et noms de titulaires, ainsi que les civilités ou grades suivis d'un nom (la fonction est gardée) ; 6 781 adresses mail ramenées à 0 ;
  - dans le Parquet DECP brut, la colonne `titulaire_nom` (3 314 764 lignes conservées).
- **Gonesse et Garges-lès-Gonesse.** Dans SIRENE, le SIRET 21950268900454 est un établissement de Garges (l'Espace Lino Ventura). Les 9 avis de Gonesse qui le portent ont l'adresse de la mairie de Gonesse et le champ `AGIT_POUR_AUTRE_COMPTE_NON` : ce n'est pas un groupement, c'est une **erreur de saisie**. Ils sont rattachés à Gonesse (SIREN 219502770), qui a ses propres marchés dans les DECP (132 226 € en 2022, 250 000 € en 2023). La correction est tracée dans `data/derived/boamp/corrections.csv`.
- **Défaut corrigé en chemin.** Les avis eForms listent plusieurs organisations, dont l'instance de recours. Le premier SIRET n'est pas forcément celui de l'acheteur : on prend désormais celui de l'acheteur nommé. Résultat : 586 avis reliés à un marché au lieu de 559.
- **À relire, sans disparaître.** Les 235 marchés repérés par le seul code CPV sont dans `data/derived/decp/a_relire_cpv_seul.csv`.
- **Région Île-de-France.** Les PDF des délibérations sur iledefrance.fr sont autorisés par son `robots.txt` et ont servi. L'export de data.iledefrance.fr n'est pas utilisé : aucun message n'est donc nécessaire pour l'IDF.

**Règle de conservation de `data/raw/`.**

1. Le dossier reste privé.
2. Les noms de personnes sont retirés **à l'écriture** : bloc de contact, nom de titulaire, civilité ou grade suivi d'un nom.
3. Un document qu'on ne peut pas nettoyer (PDF de recueil, de délibération ou de liste) est supprimé **30 jours après son extraction** (première purge des documents actuels : 22/11/2026). On ne garde que l'URL, la date de collecte, la licence et l'empreinte SHA-256, ce qui permet de le retélécharger et de prouver qu'il n'a pas changé.
4. Les jeux publics retéléchargeables (Parquet DECP, BOAMP) peuvent être effacés après chaque traitement.
5. Rien de `data/raw/` ne sort de la machine : ni commit, ni build, ni artefact.

## 1. Les dispositifs dans le pilote

**Méthode.**

- **Achats.** Recherche dans **tout** le Parquet DECP (France, depuis 2019), puis dans le pilote (acheteurs de Paris, du Rhône et des Bouches-du-Rhône). Justesse mesurée sur un échantillon relu (`data/derived/dispositifs_decp/echantillon_dispositifs.csv`).
- **Régimes.** Lus sur Légifrance (`data/derived/dispositifs/regimes.csv`, version citée pour chaque article).
- **Actes.** Comptés dans les recueils des actes administratifs entre le 23/10/2025 et le 23/10/2026 (`actes_pilote.csv`, 17 actes ; `notes/dispositifs.md`). Ce sont des **bornes basses** : le moteur de recherche indexe mal les recueils de 2026, et les échantillons de recueils ont été choisis, pas tirés au hasard.

| Dispositif | Achats : France depuis 2019 · pilote · justesse | Régime (lu sur Légifrance) | Actes publiés dans le pilote (12 mois) | Faisabilité nationale |
|---|---|---|---|---|
| Vidéoprotection fixe | 4 795 · 584 · 96 % | CSI L.252-1 : arrêté préfectoral | 43 arrêtés sur 48 lus donnent un nombre ; Paris ne publie qu'une liste sans nombre | oui (recueils, OCR selon les départements) |
| CSU, intercommunaux compris | 258 · 43 · 8 sur 12 nets, plus 3 lots de bâtiment | CSI L.252-3 : le déport des images vers police ou gendarmerie est une clause de l'arrêté ; conventions non publiées | clause lue à Mions (déport vers la gendarmerie) et dans les 24 arrêtés du Cher | achats oui ; raccordement par la clause des arrêtés |
| LAPI | 40 · 9 · 8 sur 12 | CSI L.233-1 à L.233-3 : police nationale, gendarmerie, douanes seulement ; aucune publication prévue | 0 (une mention hors pilote, Ardèche) | achats oui ; usage d'État : demande au ministère |
| Caméras-piétons de police municipale | 35 · 3 · 11 sur 12 | CSI L.241-2 et R.241-8 : arrêté préfectoral qui fixe le nombre de caméras ; publication non imposée | 0 dans la fenêtre ; les Bouches-du-Rhône en publiaient de 2019 à 2022 (Trets : 8 caméras) | achats oui ; arrêtés : CADA par préfecture |
| Vidéoverbalisation | 8 · 1 · 7 sur 7 | pas d'acte propre : finalité L.251-2 4° de l'arrêté de vidéoprotection ; avis du préfet (code de la route L.130-9) non publié | 1 mention (Mions) | par la finalité des arrêtés ; l'usage effectif seulement par contribution |
| Drones des forces de l'ordre | achats : 24 · 7 · 2 nets sur 12 (bruit) | CSI L.242-5 : décision motivée du préfet (3 mois au plus) qui fixe le périmètre et le nombre maximal de caméras | **12 arrêtés** (Paris 5, Rhône 2, Bouches-du-Rhône 5), tous « publiés au RAA » | oui par les recueils ; *extrapolation* 500 à 2 000 par an |
| Drones de police municipale | — | **aucun régime** : la décision du Conseil constitutionnel 2021-834 DC a censuré l'expérimentation | — | sans objet |
| VSA (expérimentation) | 39 par objet (environ un tiers pertinent) ; 44 par fournisseur | loi 2023-380, art. 10, et décret 2023-828 : arrêté préfectoral et attestation de conformité du ministre | 0 dans la fenêtre ; hors fenêtre, Stade de France (31/01/2025, logiciel « Cityvision » de Wintics) | actes rares ; attestations à demander au ministère |

**VSA : le cadre lu.**

- **Durée de l'expérimentation.** Elle va jusqu'au 31/12/2030 dans la version de l'article 10 en vigueur depuis le 20/08/2026 (loi 2026-798, art. 50). La version précédente fixait le 31/12/2027 (loi 2026-201, art. 47, en vigueur du 22/03/2026 au 20/08/2026) ; le texte initial, le 31/03/2025.
- **Période sans version en vigueur.** D'après les versions successives lues sur Légifrance, aucune version n'était en vigueur entre le 01/04/2025 et le 21/03/2026.
- **Décision du Conseil d'État.** Le 30/01/2026 (n° 506370), il juge que l'article L.251-2 n'autorise pas, hors article 10, de traitement algorithmique des images.

**VSA : ce que la recherche par objet manque.**

- **Fournisseurs à provenance officielle (8 SIREN).**
  - Les deux de ta liste : Veesion et Orasio.
  - Les quatre titulaires de l'avis d'attribution BOAMP 23-181232 du ministère de l'Intérieur : Wintics, Videtics, Chapsvision, Orange Business Services.
  - Deux titulaires de marchés trouvés par l'objet : Flandrin Technologies et Alphaiota.
  - Deux autres SIREN viennent de ma connaissance générale (XXII, Two-i) ; ils sont marqués « à confirmer » (voir la question 2).
- **Le résultat.** La recherche par SIREN trouve **44 marchés**, après dédoublonnage : l'accord-cadre multi-attributaire du ministère compte une fois par date. La recherche par objet n'en trouvait que **6**.
- **Le manque se concentre sur Alphaiota.** 37 marchés auprès de 33 acheteurs (2024-2026, 3,6 M€ de plafonds), surtout des caméras nomades à détection automatique contre les dépôts sauvages ; l'objet n'en trouvait que 3.
- **Aucun marché dans les DECP** pour Veesion, Orasio, Two-i et Chapsvision. Leurs clients achètent peut-être sous le seuil, sur catalogue, ou sont privés (*hypothèse*).
- **À vérifier.** Les lignes DECP de l'accord-cadre du ministère nomment Flandrin Technologies, là où l'avis d'attribution BOAMP nomme Chapsvision.

**Autres acheteurs publics** (marchés retenus depuis 2019, `acheteurs_types.csv`) :

| Type d'acheteur | France | Pilote | Plafonds France (M€ HT) |
|---|---:|---:|---:|
| Commune | 2 678 | 278 | 1 588 |
| Intercommunalité | 459 | 14 | 501 |
| État (ministères, préfectures, pénitentiaire) | 435 | 108 | 236 |
| Bailleur social public | 190 | 29 | 57 |
| Enseignement (lycées, universités) | 140 | 10 | 55 |
| Syndicat (énergie, transports) | 138 | 1 | 511 |
| Département | 137 | 7 | 153 |
| Hôpital | 92 | 21 | 24 |
| Transport public | 56 | 23 | 70 |
| Région | 50 | 8 | 117 |
| Centrale d'achat | 25 | 2 | 1 305 (accords nationaux, hors totaux territoriaux) |

**Subventions** (`notes/subventions.md`, `data/derived/subventions/`). 418 lignes de vidéoprotection hors Île-de-France ; 32 justes, 3 partielles et 0 fausse sur 35 relues.

| Source | Lignes | Communes | Nombre de caméras | Années |
|---|---:|---|---|---|
| Région Île-de-France (premier rapport) | 1 074 fiches | 569 | 95 % des fiches | 2016-2026 |
| Grand Est, open data (programme P078O001) | 183 | 179 + 3 EPCI | 54 lignes (748 caméras) | 2022-2024 |
| Région Sud, « Région sûre » | 129 (dont 7 CSU) | 95 | 4 lignes | 2023-2025 |
| DETR, 10 départements tirés au sort | 80 | 78 | 4 lignes | 2025-2026 |
| DETR et DPV, Rhône et Bouches-du-Rhône | 16 | 16 | 2 lignes | 2019-2026 |
| DSIL régionales (IDF 2022, PACA 2021, Nouvelle-Aquitaine 2024) | 8 | 6 + 2 EPCI | 1 ligne | 2021-2024 |
| Occitanie (open data) | 2 | 1 + 1 EPCI | 0 | 2023-2024 |

- **FIPD** : aucune liste publiée. L'appel à projets 2027 du Rhône indique que les crédits de vidéoprotection sont gérés au niveau national (DEPSA).
- **DETR** : 9 préfectures sur 10 tirées au sort publient leur liste, dans 3 formats.
- **AURA et Hauts-de-France** : bloqués (voir §4). Le dispositif des Hauts-de-France est confirmé par un communiqué régional.
- **Seuil** : le Grand Est ne publie que les aides de 23 000 € ou plus (seuil vérifié sur les données).

## 2. Le dictionnaire

`dictionnaire.md` couvre 12 entités. Pour chaque champ, il donne la source, le format, la couverture **mesurée** (`data/derived/dictionnaire_couverture.csv`), la fréquence de mise à jour, la licence et le statut personnel ; ses sections 13 et 14 donnent les ajouts et les champs manquants.

Les manques les plus lourds :

- l'objet des **modifications** ;
- le **parc total** de caméras (les arrêtés d'extension donnent un écart) ;
- le **montant exécuté** ;
- les achats sur **catalogue de centrale** (*hypothèse* : invisibles par commune) ;
- les **conventions de raccordement** ;
- les **attestations VSA**.

Le lot n'est pas une entité distincte, et une modification n'a ni objet ni nature.

## 3. Les trois planches

Les planches sont dans `planches/`, chacune en deux formats : 960 × 581 et 390 × 845 CSS, à l'échelle 2. La légende « sûr / fragile » figure dans l'image même. Les montants sont présentés comme des plafonds et OSM comme de la cartographie.

| Planche | Données sûres | Fragile |
|---|---|---|
| **1. Dossier commune** (Mennecy) : chiffres clés, frise, fournisseurs, mandat en lien, RSS, carte de partage | aides votées (15/15), marchés et plafonds (DECP), avis (BOAMP), titulaire vérifié dans SIRENE (SARL, catégorie 5499), comptage OSM | type des quantités BOAMP (26/30) ; borne du mandat (date du scrutin de 2026 à charger) ; arrêtés absents (Essonne fermée aux robots) ; achats sous le seuil absents |
| **2. Couches de la carte** (schéma de principe, Paris et petite couronne) : périmètres de drones datés, lieu de VSA, CSU | arrêtés publiés : date, service, période, finalités (5 sur 5 relus) ; marchés de CSU (DECP) | périmètre redessiné depuis un plan en image ; nombre de caméras ambigu (2 sur 5) ; CSU placé à la commune ; raccordement inconnu |
| **3. Fournisseur** (Alphaiota, SAS, NAF 58.29C) : acheteurs, montants par an, type de produit | marchés, acheteurs et plafonds (DECP) ; SIREN et catégorie (SIRENE, nomenclature INSEE) | type de produit déduit de l'objet ; achats sous 40 000 € HT et sur catalogue absents |

La frise de Mennecy montre ce que la fiche peut raconter. Chaque tranche du marché est suivie d'une aide régionale du même nombre de caméras, votée 0 à 2 ans plus tard :

| Tranche | Marché | Aide votée par la Région |
|---|---|---|
| 17 caméras | 2020 | 2020 |
| 15 caméras | 2021 | 2022 |
| 16 caméras | 2022 | 2024 (CP24-093) |
| 24 caméras | 2023 | 2024 (CP24-160) |
| 30 caméras | avis de 2024 | 2026 |

## 4. Le national, chiffré

Les débits viennent des mesures de cette exploration. Les volumes marqués *extrapolation* restent à vérifier.

| Source | Volume attendu | Collecte initiale | Mise à jour |
|---|---|---|---|
| DECP | 4 795 marchés vidéo depuis 2019, environ 830 par an ; Parquet de 250 Mo | quelques minutes (téléchargement, puis sélection en 10 s) | mensuelle, quelques minutes |
| BOAMP | 8 534 avis vidéo depuis 2015, plus environ 1 500 avis de dispositifs (LAPI 377, drones 523, CSU 279, IA 228, caméras-piétons 63, vidéoverbalisation 14), avec leur texte | environ 20 min à une requête par seconde (1 471 avis en 3 min mesurés) | hebdomadaire, quelques requêtes |
| SIRENE (titulaires et acheteurs) | 1 207 titulaires et 2 111 acheteurs | environ 1 h à une requête par seconde | mensuelle, seulement les nouveaux |
| Aides IDF | 1 074 fiches, historique complet fait | fait | 4 à 6 séances par an, une dizaine de requêtes chacune |
| Grand Est, Région Sud, Occitanie | 183, 129 et 2 lignes | un fichier, ou 11 PDF par an | annuelle |
| DETR | *extrapolation* : environ 850 lignes vidéo par an ; 85 listes par an en 4 formats | quelques heures, avec relecture des correspondances de colonnes | annuelle |
| Arrêtés (vidéoprotection, drones, caméras-piétons) | *extrapolation* : 450 à 700 recueils par an et par département, soit environ **50 000 PDF par an** ; drones 500 à 2 000 actes par an | environ 28 h de téléchargement par an en séquentiel (50 000 PDF × 2 s), bien moins en parallélisant par préfecture, à un document toutes les 2 s par hôte ; OCR d'environ 1 s par page là où il le faut | mensuelle, au fil des recueils |
| OSM (comptages cartographiés) | 101 départements, par an | jamais par ohsome en production ; *hypothèse* : un fichier d'historique OSM complet, une fois par an | annuelle |

**Sources bloquées et plan pour chacune.**

| Source | Blocage | Plan |
|---|---|---|
| Préfecture de l'Essonne | `robots.txt` interdit la collecte | saisie manuelle ou formulaire de contribution relu dans /revue |
| Préfecture de police (Paris) | connexion coupée ; index des recueils derrière un défi anti-robot ; liste sans nombre | demande d'export à la PP, puis CADA |
| Pages HTML de prefectures-regions.gouv.fr (IDF, PACA : recueils, DSIL) | défi anti-robot | demander les liens directs ou les tableurs à la préfecture de région |
| Région AURA | `robots.txt` (« Disallow: / ») et défi anti-robot ; aucun jeu de données sur data.gouv | demande d'export à la Région (rappel de l'obligation de publier les aides de 23 000 € ou plus) |
| Région Hauts-de-France | recherche des délibérations par formulaire JS ; un appel direct renvoie une erreur 500 | même demande d'export |
| data.iledefrance.fr (export des actes) | `robots.txt` interdit l'API aux robots sauf Googlebot | non nécessaire (PDF de iledefrance.fr autorisés) |
| grandest.fr (PDF) | `robots.txt` | non nécessaire (open data) |
| data.laregion.fr (API) | `robots.txt` | question 1 |
| FIPD | non publié (géré au national) | demande à la DEPSA (texte rédigé dans `notes/subventions.md`), puis CADA |
| Attestations VSA, conventions de raccordement, arrêtés de caméras-piétons | non publiés | CADA au ministère ou par préfecture |

**À relire par un humain (/revue)** :

- les marchés sans mot fort (CPV seuls, CPV génériques, drones) et la liste `a_relire_cpv_seul.csv` ;
- les quantités au type « indéterminé » et les nombres de caméras ambigus dans les arrêtés de drones ;
- chaque correction de SIRET (`corrections.csv`) ;
- les liens BOAMP ↔ DECP de similarité inférieure à 0,5 ;
- le type de produit des fournisseurs ;
- les CSU sans « création » ni « centre » dans l'objet ;
- tout nouveau titulaire (nature juridique), toute nouvelle commune bénéficiaire sans code INSEE, et tout périmètre redessiné à la main.

Ordre de grandeur, à confirmer au premier mois : 20 à 40 lignes par mois au niveau national.

## 5. Questions, avec ma réponse par défaut

1. **Occitanie et Lot-et-Garonne.** L'agent a lu la copie data.gouv des données Occitanie alors que data.laregion.fr interdit son API aux robots, et a traité un `robots.txt` injoignable (erreur 599) comme une absence de règle. *Par défaut* : on garde les deux et on le note. Le `robots.txt` d'un hôte ne régit pas la copie publiée sur un autre, et une erreur serveur ne vaut pas interdiction. Si tu préfères la prudence : on retire les 2 lignes occitanes et on refait le Lot-et-Garonne plus tard.
2. **Fournisseurs tirés de ma connaissance générale (XXII, Two-i).** *Par défaut* : ils sont retirés. Seuls entrent dans la recherche les SIREN issus d'un texte officiel, d'un avis ou d'un marché.
3. **Nombre de caméras ambigu dans un arrêté de drone** (un modèle de drone au lieu d'un nombre, ou 2 contre 1 dans le même acte). *Par défaut* : « non précisé », avec renvoi à l'acte et passage en relecture ; jamais une valeur devinée.
4. **Prochaine exploration des recueils.** *Par défaut* : un département entier sur 12 mois, le Rhône (texte natif), pour mesurer les vrais volumes (vidéoprotection, drones, caméras-piétons). Puis le Cher et le Loiret. Pour Paris, une demande d'export à la Préfecture de police.
5. **Borne du mandat de 2026.** *Par défaut* : charger les dates officielles des élections municipales (ministère de l'Intérieur) avant tout affichage ; d'ici là, la mention reste marquée « fragile ».

Arrêt ici, avant toute collecte nationale.

---

**Mesuré le 23/10/2026 au soir** (troisième passe ; détail dans `rapport-v3.md`, section 2). Ces mesures remplacent les extrapolations de la section 4 pour le Rhône :

- **Recueils :** 404 par an pour le Rhône, 349 pour l'Essonne. L'estimation nationale passe de « environ 50 000 » à « 35 000 à 40 000 par an » (*extrapolation*).
- **Rythme accepté** par la préfecture du Rhône : une requête toutes les 10 s. À 2,5 s, le serveur a coupé la connexion au bout de 55 requêtes.
- **Drones :** 60 actes en 12 mois dans le Rhône (50 autorisations et 10 provisoires), contre 45 extrapolés.
- **Caméras-piétons :** 7 actes (29 caméras). **VSA et LAPI :** 0.
- **Vidéoprotection :** 1 196 dossiers, dont 85 communaux dans 56 communes ; 21 240 caméras autorisées au dernier arrêté de chaque dossier, dont 2 825 sur la voie publique.
- **Fournisseur Alphaiota :** 32 acheteurs comptés par SIREN, et non 33 comptés par nom.
