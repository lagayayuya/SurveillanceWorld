# Maquettes du registre (référence temporaire)

Ce dossier contient les maquettes validées du registre et le prototype qui les reproduit. Il sert de
référence aux vues encore à porter dans `web/src/registre/`. Rien ici n'est servi par le site, ni construit,
ni vérifié par `make check`. Il sera retiré une fois toutes les vues portées.

- `maquettes/` : les maquettes grand écran (format `.dc.html` : gabarit HTML avec des trous `{{…}}`, des
  boucles `<sc-for>` et des conditions `<sc-if>`, puis un script `renderVals()` qui donne la logique et
  les données d'exemple). `Filtres.dc.html` est le panneau de filtres au téléphone.
- `kit-grand-ecran.md` : l'ossature commune des vues (en-tête, fil d'Ariane, chiffres, onglets, panneau).
- `captures/` : le rendu de référence de chaque maquette, 1 280 px de large, en clair et en sombre.
  Numérotation : 01 Registre, 02 Chiffres, 03 L'essentiel, 04 Documents, 05 Autorisations,
  06 Carte et drones, 07 Contrat, 08 Entreprise, 09 Acheteur, 10 Département, 11 Glossaire.
- `prototype/` : le prototype qui reproduit les maquettes. `vues/<vue>.html` (gabarit), `vues/<vue>.js`
  (logique), `app.js` et `donnees11.js` (aides et règles de calcul), `kit.css`, `dc.js` (moteur).
- `ecarts/` : chaque écart entre une maquette et le gabarit du prototype, avec sa raison.

Les chiffres des maquettes viennent de données publiques réelles (données essentielles de la commande
publique, BOAMP, recueils des actes de la préfecture du Rhône, SIRENE : Licence Ouverte 2.0 ;
caméras : © contributeurs OpenStreetMap, ODbL). Les règles du site l'emportent sur les maquettes quand
elles diffèrent : voir `DECISIONS.md` (lignes du 28/10/2026) et `docs/interface.md` § 3.
