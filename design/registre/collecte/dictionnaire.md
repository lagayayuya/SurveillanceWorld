# Dictionnaire de données : achats, aides, autorisations et comptages de surveillance

État au 23/10/2026. Couvertures **mesurées** sur les données de l'exploration (`scripts/dictionnaire_stats.py` → `data/derived/dictionnaire_couverture.csv`). Sauf mention, la couverture vaut pour le pilote (75, 69, 13, et l'IDF pour les aides) ou pour les marchés retenus en France depuis 2019 (9 686 lignes DECP, 5 991 marchés avant dédoublonnage).

Colonne **Perso** : *non* = pas de donnée personnelle ; *réduire* = garder la fonction ou le SIREN, jamais le nom ; *exclure* = jamais stocké, même dans `data/raw/`.

**Licences.** DECP, BOAMP, SIRENE, COG, geo.api, RNE : Licence Ouverte 2.0. Délibérations, arrêtés et listes DETR : documents administratifs publiés, réutilisables (CRPA L.321-1), source et date citées. OSM : ODbL, attribution « © contributeurs OpenStreetMap ».

## 1. Acheteur

| Champ | Source | Format | Couverture | Mise à jour | Perso |
|---|---|---|---|---|---|
| SIRET de l'acheteur | DECP `acheteur_id` ; BOAMP (SIRET lu dans l'avis, contrôle de Luhn) | 14 chiffres | DECP 100 % ; BOAMP 35,8 % des avis | DECP quotidienne ; BOAMP quotidienne | non |
| SIREN | 9 premiers chiffres du SIRET | 9 chiffres | comme le SIRET | — | non |
| Nom légal | SIRENE (via DECP `acheteur_nom`) | texte | 99,6 % | SIRENE mensuelle | non |
| Nom d'établissement | SIRENE (entre parenthèses dans `acheteur_nom`) | texte | élevée ; trompeur (« Commune de Marseille (Direction ressources humaines) ») | — | non |
| Catégorie juridique | DECP `acheteur_categorie` (code juridique INSEE) | libellé | 92,0 % ; vide pour Paris (statut particulier) | — | non |
| Type d'acheteur dérivé | règle de l'exploration (commune, intercommunalité, département, région, bailleur, transport, enseignement, État, hôpital, centrale d'achat) | énuméré | 100 % (8 % « autre ») | — | non |
| Commune, département, région | DECP (consolidation depuis SIRENE et COG) | codes COG | 99,5 % | — | non |
| Coordonnées de l'établissement | DECP `acheteur_latitude/longitude` | WGS84 | 93,0 % | — | non |
| Population | DECP `acheteur_population` | entier | **0 %** : utiliser geo.api ou l'INSEE | annuelle | non |
| Correction du SIRET | `boamp/corrections.csv` (SIRET d'une autre commune que celle nommée) | table | 9 avis sur 2 674 (tous à Gonesse) | à chaque collecte | non |
| Correspondant, courriel, téléphone | BOAMP (`CORRESPONDANT`, `cac:Contact`…) | texte | présents dans 40 à 90 % des avis | — | **exclure** (retiré à la collecte) |

## 2. Marché (un `uid` DECP = un marché ou un lot)

| Champ | Source | Format | Couverture | Mise à jour | Perso |
|---|---|---|---|---|---|
| Identifiant | DECP `uid` (SIRET de l'acheteur + `id` interne) | texte | 100 % ; `id` n'est unique que chez un même acheteur | quotidienne | non |
| Objet | DECP `objet` | texte, parfois coupé à 256 ou 1 000 caractères | 100 % | — | non (rares noms dans le texte : filtre) |
| CPV | DECP `codeCPV` ; libellé de la nomenclature officielle (9 454 codes) | 8 chiffres | 100 % | — | non |
| Nature, procédure, technique d'achat | DECP | énumérés | 99,9 % / 96,4 % / 62,7 % | — | non |
| Accord-cadre parent | DECP `idAccordCadre` | id interne de l'acheteur | 16,8 % | — | non |
| **Montant (plafond HT)** | DECP `montant` | euros | 98,5 % ; anomalies signalées 6,2 % | — | non |
| Durée | DECP `dureeMois` | mois | 99,8 % | — | non |
| Date de notification | DECP | date | 100 % | — | non |
| Date de publication des données | DECP | date | 96,8 % | — | non |
| Offres reçues | DECP | entier | 46,9 % | — | non |
| Forme et type de prix | DECP | énumérés | 97,9 % / 58,5 % | — | non |
| Lieu d'exécution | DECP (code postal, commune, département…) | code et type | 100 %, mais 15 types de code différents | — | non |
| Sous-traitance déclarée | DECP | booléen | 43,5 % | — | non |
| Source de la donnée | DECP `sourceDataset`, `sourceFile` | texte, URL | 100 % (39 sources) | — | non |
| Dispositif (dérivé) | règles de l'exploration : vidéoprotection, CSU, VSA, LAPI, caméras-piétons, vidéoverbalisation, drones | énuméré | justesse par dispositif mesurée (`dispositifs_decp/echantillon_dispositifs.csv`) | — | non |
| Catégorie (dérivée) | installation, extension, maintenance, CSU, VSA, piétons ou embarquées, études et AMO, drones, autre | énuméré | justesse 34/40 (85 %) | — | non |
| Voie de sélection et note de relecture | `path` ; liste `a_relire_cpv_seul.csv` (235 marchés) | énuméré | 100 % | — | non |
| Doublon | même SIREN, date, montant et objet normalisé | booléen | 16 % des marchés retenus | — | non |
| Nombre de caméras dans l'objet | expression régulière (« 17 NLLES CAMERAS ») | entier | **0,8 %** | — | non |

## 3. Lot

Il n'existe **pas d'entité lot** distincte. Un `uid` DECP correspond déjà à un lot quand l'acheteur publie lot par lot, et le seul signal est « Lot N » dans l'objet (16,0 % des lignes). Dans le BOAMP ancien format, `OBJET/LOTS/LOT` donne l'intitulé, la description et parfois l'estimation ; en eForms, `cac:ProcurementProjectLot`. Le rapprochement lot BOAMP ↔ `uid` DECP n'est pas fait.

## 4. Modification

| Champ | Source | Format | Couverture | Perso |
|---|---|---|---|---|
| Numéro | DECP `modification_id` (0 = initial) | entier | 32,4 % des lignes sont des modifications ; 17 % des marchés en ont au moins une | non |
| Date, montant, durée après modification | DECP | date, euros, mois | comme le marché | non |
| Titulaires après modification | DECP `titulaire_id` | SIRET | 97,9 % | réduire |
| **Objet ou nature de la modification** | — | — | **absent** | — |

## 5. Avis BOAMP

| Champ | Source | Format | Couverture (avis pilote et IDF) | Mise à jour | Perso |
|---|---|---|---|---|---|
| Numéro d'avis, date, nature (avis, résultat, rectificatif…), famille | API BOAMP (DILA) | texte, date | 100 % | quotidienne | non |
| Acheteur (nom) | `nomacheteur` | texte | 100 % | — | non |
| SIRET de l'acheteur | `donnees` (ancien : `CODE_IDENT_NATIONAL` ; eForms : plusieurs organisations, dont l'instance de recours) | 14 chiffres | 35,8 % ; en eForms, choisir celui de l'acheteur nommé | — | non |
| CPV | `donnees` | 8 chiffres | 84,9 % | — | non |
| Objet et descriptif (lots, caractéristiques, quantités) | `donnees` | texte | 100 % | — | non (noms filtrés à la collecte) |
| Avis liés (antérieurs, rectificatifs) | `annonce_lie`, `annonces_anterieures` | liste d'idweb | 33,5 % | — | non |
| Quantité de caméras, avec son type (nouvelles, parc existant, par unité) | extraction de l'exploration | entier et type | 7,5 % des avis ; nombre juste 30/30, type 26/30 | — | non |
| Lien vers l'avis | `url_avis` | URL | 100 % | — | non |
| Titulaire (nom) | `donnees` (résultats) | texte | variable | — | **exclure** (retiré à la collecte : nom de la personne si entrepreneur individuel) |

## 6. Titulaire et fournisseur

| Champ | Source | Format | Couverture | Mise à jour | Perso |
|---|---|---|---|---|---|
| SIRET et SIREN | DECP `titulaire_id` (+ `typeIdentifiant`) | 14 chiffres | 97,9 % (6 types d'identifiant, dont TVA intracommunautaire) | quotidienne | réduire |
| Nature juridique | SIRENE (API Recherche d'entreprises) | code | à interroger ; 1000 = entrepreneur individuel → SIREN seul | mensuelle | décide de la réduction |
| Raison sociale | SIRENE, seulement si personne morale | texte | — | — | non (personne morale) |
| Activité (NAF), catégorie (PME, ETI, GE) | DECP | code | 97,1 % / 95,6 % | — | non |
| Commune du titulaire | DECP | COG | 97,1 % | — | non pour une personne morale ; **réduire** pour un entrepreneur individuel (pas d'adresse) |
| Rôle (spécialiste VSA, intégrateur, mainteneur) | dérivé (liste de SIREN avec sa provenance : `dispositifs_decp/vsa_fournisseurs.csv`) | énuméré | 8 SIREN dans le pilote | à chaque collecte | non |
| Sous-traitants | — | — | **absents** des DECP (seulement un booléen) | — | — |

## 7. Aide ou subvention

| Champ | Source | Format | Couverture | Mise à jour | Perso |
|---|---|---|---|---|---|
| Programme | Région IDF, Région Grand Est, DETR, DSIL, DPV, FIPD | énuméré | — | — | non |
| Acte (délibération ou arrêté), date | délibération de la commission permanente (IDF) ; tableau de la préfecture (DETR) | id, date | 100 % | IDF : 4 à 6 séances par an ; DETR : annuelle | non |
| Bénéficiaire (personne morale), INSEE, EPCI | fiche projet (IDF) ; geo.api | texte, COG, SIREN | INSEE 94,8 % des fiches (EPCI bénéficiaires à part) | — | non |
| Base subventionnable HT, taux, subvention | fiche projet | euros, % | 100 % (IDF) ; coût HT 93,8 % (DETR) | — | non |
| Nombre de caméras (nouvelles, remplacées) | fiche projet | entiers | IDF 95,4 % ; DETR **12,5 %** | — | non |
| Objet, description, page du PDF | fiche projet | texte, entier | 99,6 % | — | non |
| Votée, versée, caduque | — | — | **seulement la somme votée** (les réaffectations signalent des caducités) | — | — |
| Représentant ou élu signataire | délibération | — | présent dans le PDF | — | **exclure** |

## 8. Arrêté (par type)

Types : vidéoprotection (code de la sécurité intérieure L.252-1), drone (forces de l'ordre), VSA (expérimentation, art. 10 de la loi 2023-380), caméras-piétons de police municipale, autres. Le régime de chaque type est à lire dans `notes/dispositifs.md`.

| Champ | Source | Format | Couverture (échantillon de 48 arrêtés de vidéoprotection) | Mise à jour | Perso |
|---|---|---|---|---|---|
| Identifiant de l'acte, recueil, date | recueil des actes administratifs (RAA) de la préfecture | id, date | 100 % | mensuelle | non |
| Bénéficiaire (personne morale ou commune), type | arrêté | texte, énuméré | 100 % | — | réduire (gérant, maire : fonction seulement) |
| Numéro de dossier | arrêté | texte | présent hors Paris | — | non |
| Nombre de caméras (total, voie publique, intérieur, extérieur) | arrêté | entiers | total 89,6 % ; voie publique 31,2 % ; écart et non total pour les extensions | — | non |
| Périmètre, adresses des caméras | arrêté, plan annexé (souvent une image) | texte, image | parfois | — | non |
| Finalités, durée de conservation, durée de l'autorisation | arrêté | listes, jours, années | élevée hors Paris | — | non |
| Créneaux et périmètre (drone, VSA) | arrêté d'autorisation | dates, heures, plan | voir `notes/dispositifs.md` | veille d'événement | non |
| Texte natif ou scan | dérivé | énuméré | les Bouches-du-Rhône exigent l'OCR | — | non |
| Responsable nommé (liste parisienne) | arrêté « portant communication » | — | présent | — | **exclure** |

## 9. Comptage de caméras (par source et par date)

Une ligne par **source × territoire × date**, jamais additionnée entre sources.

| Champ | Valeurs | Source | Couverture |
|---|---|---|---|
| Nature du comptage | `aidées` (votées), `annoncées` (projet de marché), `autorisées` (arrêté), `cartographiées` (OSM), `déclarées` (autre document officiel) | — | — |
| Sens | `flux` (nouvelles ou remplacées dans l'acte) ; `stock` (parc à une date) | — | les aides et les marchés sont des flux, OSM un stock, les arrêtés les deux selon le cas |
| Valeur, unité | entier ; caméras, points de vue, appareils (les drones comptent « caméras sur aéronef ») | — | — |
| Territoire et date | COG ; date de l'acte ou date d'état | — | — |
| Référence | identifiant de l'acte ou de l'avis, ou requête ohsome | — | 100 % |
| Fiabilité | extraction relue, extraction automatique, cartographie | — | — |

## 10. Territoire : commune, intercommunalité, département

| Champ | Source | Format | Couverture | Mise à jour | Perso |
|---|---|---|---|---|---|
| Code INSEE, nom, département, région | COG (INSEE) ; API Découpage administratif | COG | 100 % | annuelle (1er janvier) | non |
| SIREN de la commune, SIREN et nom de l'EPCI | API Découpage administratif (`siren`, `codeEpci`, `epci`) | 9 chiffres | 100 % | annuelle | non |
| Population | API Découpage administratif | entier | 100 % | annuelle | non |
| Contour | API Découpage administratif (`geometry=contour`) | GeoJSON | 100 % | annuelle | non |
| Fusions et changements de code | COG, table de passage | table | — | annuelle | non |

## 11. Mandat (lien seulement)

| Champ | Source | Format | Perso |
|---|---|---|---|
| Période du mandat en cours à la date de l'acte (« mandat 2020-2026 ») | dates des élections municipales (ministère de l'Intérieur) ; *hypothèse à vérifier* : nouveau mandat après le scrutin de mars 2026 | période | non |
| Lien vers la source officielle | [Répertoire national des élus](https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1) (ministère de l'Intérieur, Licence Ouverte 2.0, trimestriel), ou le site de la mairie | URL | non |
| Nom, fonction nominative, étiquette politique | — | — | **exclure** : jamais stockés |

## 12. Source

| Champ | Format | Couverture actuelle |
|---|---|---|
| URL | texte | 100 % (`sources.md`, `*_sources.csv`, `manifest.tsv`) |
| Date de collecte | date et heure | 100 % |
| Empreinte du document | SHA-256 | partielle (manifestes des agents) ; à généraliser |
| Licence | énuméré | 100 % |
| Statut d'accès | autorisé, `robots.txt` interdit, défi anti-robot, connexion coupée | dans les notes ; à normaliser |
| Identifiant du robot | `SurveillanceWorld-research (+<contact>)` | 100 % depuis le 23/10/2026 après-midi |

## 13. Ajouts probablement oubliés

- **Correction** : une table des corrections (champ, valeur publiée, valeur retenue, raison, date, auteur), à relire dans /revue. Exemple : Gonesse.
- **Relecture** : verdict, date, motif. Elle sert pour les échantillons et les « à relire ».
- **Groupement de commandes** : coordonnateur et membres (« pour le compte de… »). Repéré dans le BOAMP (`AGIT_POUR_AUTRE_COMPTE_OUI/NON`), absent des DECP.
- **Centrale d'achat et commande sur catalogue** (UGAP, Centrale d'achat du numérique et des télécoms) : *hypothèse à vérifier* : la commune qui commande sur catalogue n'apparaît pas dans les DECP, seule la centrale publie son accord-cadre. Ce serait un trou structurel.
- **Projet** : regroupement inter-sources d'un même déploiement (avis, marché, aide, arrêté). C'est la clé pour éviter les doubles comptes.
- **Équipement de la commune** déjà publié sur le site : nombre de caméras cartographiées, pour l'écart avec les autres comptages.

## 14. Champs manquants (livrable)

| Manque | Pourquoi il compte | Piste |
|---|---|---|
| Objet et nature de chaque **modification** | sans eux, une modification est illisible (Quinze-Vingts : de 48 à 175 mois) | avis de modification BOAMP (`Modification`, peu nombreux), demande CADA |
| **Montant exécuté** (payé) | les DECP ne donnent que des plafonds | comptes administratifs (ne séparent pas la vidéo), CADA |
| **Parc total** de caméras d'une commune | aucune source ne le donne | arrêtés chaînés par numéro de dossier ; rapports annuels des polices municipales |
| **Total après extension** dans les arrêtés | ils donnent l'écart (« +31 ») | chaîner les arrêtés par dossier |
| Nombre de caméras dans les marchés | 7,5 % des avis, 0,8 % des objets | pièces du marché (CCTP, BPU), non publiées : CADA |
| **SIRET fiable** de l'acheteur dans le BOAMP | 35,8 % présent ; parfois faux (Gonesse) ou celui d'une autre organisation (eForms) | rapprochement par nom avec trace de la correction |
| Marchés de la **Préfecture de police** | absents des DECP | CADA |
| Marchés passés sur **catalogue de centrale** | invisibles par commune (*hypothèse*) | vérifier sur un échantillon de communes, puis CADA |
| Commandes sous le seuil (40 000 € HT) | non obligatoires | — |
| **Sous-traitants** | non publiés | — |
| Subvention **versée** et non votée ; listes FIPD | non publiées | CADA, voir `notes/subventions.md` |
| **Raccordement** des CSU aux forces de l'ordre | conventions non publiées | voir `notes/dispositifs.md` |
| Périmètres de drone et de VSA en **géométrie** | plans annexés en image | saisie manuelle relue dans /revue |
| Mise en service effective (date) | ni les marchés ni les aides ne la donnent | arrêtés (date d'autorisation), contributions |

---

## 15. Événement (ajout du 24/10/2026, 4ᵉ passe)

Un **événement** est un document officiel daté, et un seul. C'est la ligne du dossier d'une commune et de l'Explorer. Construit par `scripts/build_registre.py` → `prototype-v4/registre.js` (`evenements`).

| Champ | Format | Règle | Couverture (pilote, 6 759 événements) |
|---|---|---|---|
| `id` | texte stable | identifiant officiel de la source : `<uid DECP>~<n° de modification>`, n° d'avis BOAMP (idweb), n° d'acte de la préfecture (`69-2026-06-30-00021`), `<CP>/<EX>` pour une aide de la Région IDF, `detr-<dép>-<année>-<rang>` | 100 % |
| `t` (nature) | énuméré | `avis`, `resultat`, `rectificatif`, `attribution`, `modification`, `arrete`, `arrete_drone`, `arrete_pietons`, `arrete_vsa`, `subvention_region`, `subvention_etat` | 100 % |
| `date` | date | notification (contrat), publication (avis), signature (arrêté), vote (aide) ; `date_annee` = vrai si seule l'année est connue (DETR) | 100 % (38 à l'année) |
| `montant` | euros | contrat : **maximum** ; aide : montant voté | 2 787 |
| `cameras` | entier | arrêté : total autorisé ; aide : caméras du projet ; avis : caméras nouvelles si le texte le dit | 2 453 |
| `entreprises` | liste de SIREN | titulaires ; un identifiant qui n'est ni un SIREN ni un SIRET est écarté (7 écartés) | contrats 100 % |
| `beneficiaire` | texte | personne morale seulement ; sinon `[non retenu]` | arrêtés et aides |
| `affaire` | id | voir § 16 | 100 % |
| `ref` | texte | la référence telle que la source l'écrit, pour la retrouver | 100 % |
| `url` | URL | le document ou le jeu de données d'origine | 100 % |
| `relu` | booléen | vrai si la ligne appartient à un échantillon relu par une personne | 100 % |

**Adresse stable** : `/evenement/<id>`, l'identifiant étant encodé pour l'URL. Elle ne dépend d'aucun numéro interne : si la base est reconstruite, l'adresse reste la même.

## 16. Affaire

Une **affaire** regroupe les événements d'un même objet administratif, du premier document au dernier.

| Genre (`kind`) | Clé | Ce qu'elle regroupe | Nombre |
|---|---|---|---|
| `contrat` | `uid` DECP | avis, résultat et rectificatifs liés, contrat signé, modifications | 1 233 |
| `contrat_non_retrouve` | `avis-<idweb>` | un appel d'offres et ses suites, quand le contrat n’est pas dans les DECP | 1 208 |
| `dossier` | `69-<n° de dossier préfectoral>` | tous les arrêtés d'un même système ; évolution du nombre de caméras ; échéance = dernier arrêté + 5 ans ; année d'ouverture lue dans le numéro | 1 191 |
| `subvention` | `sub-<EX>` (IDF), `detr-…`, `region-sud-…` | délibération, et le contrat « probable » quand la règle le trouve | 1 104 |
| `acte` | n° d'acte | arrêté isolé : drone, caméras-piétons, analyse automatique | 83 |

**Adresses stables** : `/commune/<INSEE>`, `/commune/<INSEE>/dossier`, `/affaire/<id>`, `/entreprise/<SIREN>`. Toutes viennent d'identifiants officiels (COG, SIREN, uid DECP, n° de dossier préfectoral, n° de délibération).

## 17. Règles de rattachement et taux mesurés

Mesuré le 24/10/2026 sur le pilote (`data/derived/registre_rattachement.csv`).

| Rattachement | Règle | Taux |
|---|---|---|
| modification → contrat | même `uid` | 488 / 488 = 100 % |
| rectificatif ou résultat → appel d'offres | n° d'avis antérieur cité par l'avis | 747 / 802 = 93,1 % |
| arrêté → dossier préfectoral (Rhône) | n° de dossier écrit dans l'arrêté | 1 227 / 1 232 = 99,6 % |
| avis BOAMP → contrat DECP | SIREN de l'acheteur (SIRET de l'avis ou nom), date, objet proche (similarité ≥ 0,2) ; ou par l'avis lié | 642 / 2 616 = 24,5 % ; **depuis 2019 : 614 / 1 621 = 37,9 %** |
| dont par le nombre de caméras | même acheteur, même nombre de caméras dans l'avis et l'objet du contrat, contrat notifié dans les 18 mois | 3 |
| contrat → au moins un avis | lien inverse | 342 / 1 203 = 28,4 % |
| subvention IDF → contrat « probable » | même commune, même nombre de caméras (objet du contrat ou avis lié), contrat notifié de 6 mois avant à 24 mois après le vote, **un seul candidat** | 6 / 1 074 = 0,6 % ; 6 / 204 = 2,9 % quand la commune a un contrat dans la fenêtre |

Un lien « probable » est toujours affiché comme tel, avec sa règle. Il n'entre jamais dans un total.

## 18. Document d'origine

| Champ | Format | Règle |
|---|---|---|
| `url` | URL | adresse d'origine, jamais une copie |
| `sha256` | hex | empreinte du PDF téléchargé (aides IDF : calculée sur la copie locale) ; vide pour une API (DECP, BOAMP) |
| `collecte` | date | date de collecte |
| `archive` | URL ou vide | copie publique (archive.org) vérifiée **au moment de la collecte** seulement ; 20 essais le 24/10/2026, tous refusés (429) : champ vide partout |
| copie privée | — | conservée hors du site, jamais servie : les recueils nomment des personnes |

## 19. Champs ajoutés à la 5ᵉ passe (24/10/2026)

| Champ | Où | Règle |
|---|---|---|
| `centrale_achat` | contrat | acheteur UGAP (776056467), Centrale d'achat du numérique et des télécoms (924435951), ou nom d'acheteur « centrale d'achat », « UGAP », « RESAH », « CAIH » ; hors de tous les totaux |
| `contrat_mixte` | contrat | objet qui couvre aussi sécurité humaine, gardiennage, incendie, éclairage, signalisation, contrôle d'accès, intrusion, alarme, interphonie, courants faibles, GTB, téléphonie ; hors des totaux par défaut |
| `montant_a_verifier` | contrat | texte des raisons (voir `rapport-v5.md` § 2) ; hors des totaux, liste dans `data/derived/montants_a_verifier.csv` |
| `hors_totaux` | événement de contrat | `centrale`, `a_verifier`, `mixte` ou vide |
| `contrat_probable`, `lien_probable` | affaire « appel d'offres » | contrat du même acheteur signé 1 à 12 mois après l'avis, objet proche (Jaccard ≥ 0,25) ou même titulaire dans l'avis de résultat ; ou lien établi en relecture (`relecture_notes.csv`) |
| `avis_probables` | contrat | lien inverse |
| `beneficiaire_siren` | arrêté | SIREN de la personne morale reconnue dans SIRENE (liste blanche) ; le nom affiché est celui de SIRENE |
| `duree` | arrêté | durée lue dans les articles de l'arrêté ; vide si l'arrêté ne la donne pas |
| `echeance`, `echeance_source` | dossier préfectoral | date du dernier arrêté qui donne une durée, plus cette durée ; jamais supposée |
| `note_relecture` | événement | remarque d'une relecture (ex. date probablement erronée dans la source) |
| `changements` | modification | « montant A → B € », « durée A → B mois », « titulaires » ; sinon « aucun changement publié » |
| `date_annee` | événement | vrai quand la source ne donne que l'année ; affiché « 2026, date non précisée », rangé après les dates connues de l'année |
