# Surveillance World

> **In English.** A map of the video surveillance cameras mapped in OpenStreetMap, and of
> what each one can film, street by street: its field of view cut by the buildings, and
> where it can identify, recognise or detect a person (IEC 62676-4). Everything is computed
> ahead of time from open data; the site shows vector tiles, with no tracker and no
> third-party service. Code AGPL-3.0-or-later, data ODbL. The site and the docs are in French.

![Surveillance World, la carte des caméras](docs/images/hero.jpg)

**La carte des caméras de surveillance, et de ce qu'elles peuvent filmer, rue par rue.**

## Ce que c'est

Les contributeurs d'OpenStreetMap ont recensé des dizaines de milliers de caméras en France.
Surveillance World les place sur une carte et calcule, pour chacune, la zone qu'elle peut
filmer et les rues qu'elle couvre, en tenant compte des bâtiments qui lui bouchent la vue.

| La carte | En mode sombre |
|---|---|
| ![La carte au niveau de la rue, en clair](docs/images/carte-clair.png) | ![La même vue en sombre](docs/images/carte-sombre.png) |

| La fiche d'une caméra | Au téléphone |
|---|---|
| ![Une caméra ouverte : son champ sur la carte, ses distances et ses caractéristiques](docs/images/fiche-camera.png) | <img src="docs/images/telephone.png" alt="La fiche d'une caméra sur un téléphone" width="280"> |

![Toucher une caméra : sa fiche s'ouvre et son champ s'affiche](docs/images/toucher-une-camera.gif)

*Captures prises sur l'extrait de test (La Défense).*

## Comment ça marche

```mermaid
flowchart LR
  OSM[(OpenStreetMap)] --> P[Pipeline Python<br/>champs, rues, communes]
  IGN[(Communes IGN)] --> P
  P --> T[Tuiles vectorielles<br/>PMTiles]
  T --> C[Carte<br/>MapLibre]
  C -- contribution --> R[Revue humaine]
  R -- acceptée --> P
  R -. si la personne le choisit .-> OSM
```

- **Une estimation optique.** Pour chaque type de caméra, une distribution de résolutions et
  d'angles de champ tirée des fiches des fabricants (`catalogue/`, `rules/optics.yaml`) donne
  la distance à laquelle elle peut **identifier**, **reconnaître** ou **détecter** une
  personne (niveaux de la norme IEC 62676-4).
- **Deux hypothèses.** « Standard » montre ce qu'une caméra filme avec une probabilité d'au
  moins 50 % ; « Prudent », au moins 10 % : la zone qu'une caméra plutôt haut de gamme
  pourrait couvrir.
- **Un champ exact.** Chaque champ est découpé par les bâtiments d'OSM, puis reporté sur les
  rues. Chaque valeur garde son degré de certitude (connue, estimée ou supposée), jusque
  dans la fiche.

## Vie privée par construction

- Aucun traceur, aucun cookie de mesure : la carte n'appelle aucun service tiers. Le fond de
  carte, les polices et les tuiles sont servis par le site lui-même.
- Aucune adresse IP gardée : le serveur web ne les journalise pas et l'API ne les reçoit
  jamais.
- Des compteurs agrégés seulement (cartes chargées, connexions), par heure puis par jour,
  sans identifiant ni rien d'écrit sur l'appareil.
- « Me localiser » : la position reste sur l'appareil, elle n'est ni envoyée ni gardée.
- Les contributions ne gardent que le jour (jamais l'heure) et, sur la carte, le mois.

## Lancer en local

Il faut [uv](https://docs.astral.sh/uv/), Node 22, `osmium-tool`, `tippecanoe` et
`pmtiles` (macOS : `brew install osmium-tool tippecanoe pmtiles`).

```bash
make install                 # dépendances Python et web
make check                   # lint et tests (Python et web)
mkdir -p data/contrib && cp tests/fixtures/contrib-ci.jsonl data/contrib/ci.jsonl
make build REGION=ci         # le pipeline complet sur l'extrait de test (La Défense, ~10 s)
make web REGION=ci           # la carte sur http://localhost:5173
```

Pour essayer aussi les contributions, les comptes et la revue (il faut en plus PostgreSQL
avec PostGIS : `initdb` et `pg_ctl` dans le PATH, ou `PG_BIN`) :

```bash
make try                     # http://127.0.0.1:4470/ — Ctrl-C arrête tout
```

`make try` lance l'API sur une base jetable, remplie avec les données de test. Un compte
contributeur fictif est connecté d'office ; `?as=rev` passe sur le compte administrateur,
qui ouvre `/revue`. L'ancienne interface reste accessible avec `?ui=classique`.

### Toute l'Île-de-France

Comptez environ 16 minutes sur un portable à 8 cœurs.

```bash
curl -L -o data/src/ile-de-france-latest.osm.pbf \
  https://download.geofabrik.de/europe/france/ile-de-france-latest.osm.pbf
B=https://data.geopf.fr/telechargement/download/ADMIN-EXPRESS-COG-CARTO/ADMIN-EXPRESS-COG-CARTO_4-0__GEOPARQUET_WGS84G_FRA_2026-01-01
for f in commune arrondissement_municipal departement; do   # communes IGN, 133 Mo
  curl -L --create-dirs -o data/src/admin-express-2026/$f.parquet $B/$f.parquet; done
make build REGION=idf        # tuiles dans data/build/idf/tiles, contrôles dans qa/out/idf
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles data/basemap/idf-full.pmtiles \
  --bbox=1.44,48.12,3.56,49.24 --maxzoom=15   # le fond de carte, auto-hébergé
uv run lacarte basemap strip data/basemap/idf-full.pmtiles data/basemap/idf.pmtiles \
  --drop pois --names fr en
make web REGION=idf
```

Les régions sont déclarées dans `regions.yaml` ; les valeurs par défaut et les règles de
classement, chacune avec son identifiant et sa justification, dans `rules/`.

## Contribuer

Une caméra manque, est mal placée ou n'existe plus ? Elle se corrige dans OpenStreetMap :
la carte est reconstruite à partir d'OSM. Pour le code et les signalements, voir
[CONTRIBUTING.md](CONTRIBUTING.md). Pour une faille de sécurité, voir [SECURITY.md](SECURITY.md).

## Limites

Les zones et les distances sont des **estimations**, calculées à partir des données d'OSM et
d'hypothèses optiques : ce n'est ni un constat qu'une caméra filme un lieu, ni un avis
juridique sur sa conformité. Une caméra absente d'OSM n'apparaît pas sur la carte.

## Licences et crédits

- Code : [AGPL-3.0-or-later](LICENSE).
- Données dérivées (tuiles, fichiers intermédiaires) : [ODbL 1.0](LICENSE-DATA),
  © les contributeurs d'OpenStreetMap.
- Contributions faites sur le site : CC0, pour que la couche puisse être publiée sous ODbL.
- Communes, arrondissements et départements : IGN – Admin Express COG Carto, édition du
  1er janvier 2026, Licence Ouverte 2.0.
- Catalogue des caméras (`catalogue/`) : [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
  tiré des fiches techniques des fabricants et des appels d'offres publics des communes,
  chaque ligne avec sa source.
- Fond de carte : [Protomaps](https://protomaps.com) (données OSM, ODbL), glyphes Noto Sans
  (SIL OFL 1.1) et icônes tangrams (MIT) de `basemaps-assets`. Rendu par
  [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause).
- Polices de l'interface : Archivo (SIL OFL 1.1) et Special Elite (Apache 2.0), modifiées
  (voir [`web/src/theme/fonts/README.md`](web/src/theme/fonts/README.md)). Le site sert
  toutes les notices tierces à `/licences.txt`.
- Fixtures de test (`tests/fixtures/`) : extrait OSM et extrait du fond Protomaps sur
  La Défense (ODbL), communes IGN découpées (Licence Ouverte 2.0), contributions inventées.
- Sources consultées : les données, le wiki et taginfo d'OSM, les fiches des fabricants, les
  normes et la documentation des bibliothèques. Aucun code, texte ni jeu de données d'autres
  projets de cartographie des caméras n'est lu ni repris.

Imaginé par lagayayuya.

## Héberger une instance

`deploy/` contient les scripts d'un déploiement auto-hébergé (Caddy, PostgreSQL et PostGIS,
une API Python), réglés uniquement par des variables d'environnement : voir
[`deploy/deploy.env.example`](deploy/deploy.env.example). Rien du serveur n'est écrit dans
le dépôt.

- **Comptes.** On entre avec son compte OpenStreetMap (OAuth 2.0 avec PKCE, portée
  `openid` ; le jeton est révoqué aussitôt et seul l'identifiant OSM numérique est gardé). Les
  comptes à mot de passe (administration, revue) se gèrent en ligne de commande :
  `uv run lacarte accounts --help`. Un mot de passe ne passe jamais en argument.
- **Applications OSM.** Une application confidentielle par serveur OSM (test et réel), avec
  l'URI de retour `https://<votre hôte>/api/osm/callback`. Leurs identifiants vont dans
  l'environnement du déploiement, jamais dans le dépôt.
- **Publication sur OSM.** Seulement si la personne le choisit, sous son propre compte OSM.
  Seules partent ses observations faites sur place, une fois acceptées une à une par la revue
  et appliquées par une construction : `rules/publish.yaml`.
- **Contributions acceptées.** Elles entrent à la construction suivante :
  `uv run lacarte contrib export` écrit `data/contrib/<région>.jsonl`, que l'étape `apply`
  applique (`rules/contributions.yaml`).
