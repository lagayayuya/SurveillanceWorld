# Contribuer

Merci ! Il y a trois façons d'aider.

## Une caméra est fausse sur la carte

Les données vivent dans [OpenStreetMap](https://www.openstreetmap.org) : la carte est
reconstruite à partir d'OSM, et une correction faite ici serait effacée à la construction
suivante.

1. Sur la carte, ouvrez la fiche de la caméra, puis son lien « OpenStreetMap ». Il mène au
   nœud `man_made=surveillance` concerné.
2. Corrigez-le dans OSM : position, `camera:direction`, `camera:type`, `operator`… Le
   [wiki d'OSM](https://wiki.openstreetmap.org/wiki/Tag:man_made%3Dsurveillance) décrit
   chaque attribut. Une caméra disparue se supprime, une caméra manquante s'ajoute.
3. La carte suivra à sa prochaine construction.

Quand les contributions sont ouvertes sur le site, vous pouvez aussi y proposer la
correction avec un compte. Elle sera relue avant d'entrer sur la carte.

Si l'erreur vient du calcul (un champ, une distance, une rue mal comptée) et non des données,
ouvrez un ticket « Donnée ou calcul ».

## Un bug du site

Ouvrez un ticket « Bug » : ce que vous avez fait, ce que vous attendiez, ce qui s'est passé,
votre appareil et votre navigateur, et l'adresse de la page si elle montre le problème.

## Proposer du code

- Lisez [`CLAUDE.md`](CLAUDE.md) (les règles de travail du projet) et
  [`DECISIONS.md`](DECISIONS.md) (pourquoi les choses sont ainsi).
- `make install`, puis `make check` doit passer avant chaque commit.
- Des commits petits, un par changement, avec un message en anglais qui dit ce qui change et
  pourquoi. Le code, les commentaires et les identifiants sont en anglais ; l'interface est en
  français et passe par `web/src/locales/fr.json`.
- Tout changement de géométrie (champ de vision, exposition des rues) vient avec un cas figé
  dans `tests/`.
- Les contributions de code sont publiées sous [AGPL-3.0-or-later](LICENSE).

## La salle blanche

Ce projet n'utilise **aucun code, texte, chiffre ni jeu de données issu d'autres projets de
cartographie des caméras**, quelle que soit leur licence. Ne les consultez pas pour
contribuer ici, et ne proposez rien qui en vienne.

Sources permises : les données d'OpenStreetMap (ODbL), le wiki d'OSM, taginfo, les fiches
techniques des fabricants, les normes, les documents publics (par exemple les appels d'offres
des communes) et l'optique. Chaque ligne du catalogue (`catalogue/`) cite sa source.
