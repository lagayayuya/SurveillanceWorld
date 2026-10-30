# Registre v2 : maquettes de la refonte (référence temporaire)

Ces maquettes dessinent le nouveau cadre du registre. Le contenu des fiches reste celui des maquettes
validées, dans `design/registre/maquettes/`. Ce qui change :
- le registre s'ouvre en modale sur la carte ;
- chaque fiche dit son type ;
- toutes les fiches ont la même ossature ;
- chaque type a sa liste ;
- Carte et drones passe sur la vraie carte, inclinée ;
- chaque fiche se partage.

Rien ici n'est servi, construit ni vérifié par `make check`. Le dossier sera retiré une fois la refonte
portée.

- `maquettes/` : les maquettes, au format `.dc.html` (voir `design/registre/README.md`), avec des données
  réelles du pilote.
- `captures/` : le rendu de chaque maquette en clair et en sombre, à 1 440 × 900 pour le grand écran
  et à 390 × 844 pour le téléphone. Les captures dont le numéro porte un « b » montrent un deuxième état.

| N° | Maquette | Ce qu'elle fixe |
|---|---|---|
| 01 | `V2-Sommaire` | La modale sur la carte, la recherche globale, les quatre familles et leurs comptes, « Comment lire le registre », la date de mise à jour |
| 02 | `V2-Liste` | La liste d'un type : le rail des listes, le classement par clé (il remplace « Chiffres et classements »), les filtres avec leurs comptes, le filtre texte, « Afficher plus » |
| 03 | `V2-Entreprise` | Une fiche : l'étiquette du type, le bandeau du type collé en haut avec ses sections et « Partager », les cinq sections, le panneau du détail, les liens colorés par leur cible |
| 04 | `V2-CarteDrones` | La vraie carte inclinée, les zones de drones en volumes (hauteur = heures sur la période), le registre réduit à droite, les heures de vol par semaine |
| 05 | `V2-Types` | Le système de repérage : quatre familles, quatre couleurs, l'ossature commune, les trois repères |
| 06 | `V2-Partage` | L'image d'aperçu d'une fiche : un seul gabarit, dans la DA de l'aperçu du site |
| 07, 08 | `V2-Tel-…` | Au téléphone : le registre en feuille sur la carte ; le détail et le partage en tiroir |

## Les règles que les maquettes ne montrent pas toutes
- **Les types**. Il y a quatre familles :
  - territoires (commune, intercommunalité, département) : `#ffe800` ;
  - acheteurs : `#9be7c4` ;
  - entreprises : `#c9b8ff` ;
  - documents (contrat, modification, appel d'offres, arrêté, subvention) : `#7fd4ff`.

  Chaque type a un pictogramme et un mot. La couleur dit le type, jamais une valeur. Le rose reste au
  cadre du registre et à la carte.
- **Les liens**. Toute mention d'un territoire, d'un acheteur, d'une entreprise ou d'un document qui a sa
  fiche est un lien, où qu'elle soit : phrase, tableau, panneau, info-bulle, résultat de recherche, fil
  d'Ariane. Le lien porte le pictogramme et la couleur de sa cible.
- **L'ossature**. Les sections sont toujours dans cet ordre : identité, L'essentiel, Dans le temps,
  Avec qui, Documents, Sources. Une section vide est retirée. Une collectivité a une seule fiche, qui
  réunit son territoire et ses achats.
- **Les graphiques**. Chaque graphique dit ce qu'il montre et dans quelle unité. Il montre une seule
  mesure, sur un axe qui part de zéro. Les marques sont alignées sur un axe lisible ; jamais de
  placement en couloirs. Il a une info-bulle au survol et au clavier. Les valeurs sont écrites seulement
  quand il y a peu de barres. Le détail reste dans le panneau ou dans la liste.
- **Le partage**. L'image d'aperçu est produite au build (lot R3). Elle reprend le logo, « Le
  registre », l'étiquette du type, le nom (deux lignes au plus) et trois chiffres, toujours les mêmes
  par type, sur le fond de carte sombre. Il n'y a pas de bandeau ni de pied de page. Le texte partagé
  reprend ces chiffres, la phrase sur le montant prévu, les sources et la date de mise à jour.

L'adresse du site est écrite `adresse-du-site` dans les maquettes : elle vient de `VITE_SITE_URL`.
