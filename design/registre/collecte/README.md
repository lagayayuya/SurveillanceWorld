# Scripts de collecte de l'exploration (référence temporaire)

Les scripts qui ont produit le registre du pilote (Île-de-France, Rhône, Bouches-du-Rhône) pendant
l'exploration : sélection des marchés vidéo dans les DECP, collecte et lecture du BOAMP, liens entre avis
et contrats, acheteurs, dispositifs, vérification SIRENE, règle `robots.txt`. Ils servent de référence au
portage dans `pipeline/lacarte_registre/` ; ils ne sont ni exécutés, ni testés, ni vérifiés par
`make check` (exclus de ruff). `sources.md` liste chaque source, son adresse et sa licence ;
`dictionnaire.md` les champs ; `rapport-cadrage.md` les volumes mesurés et les règles de sélection.
L'adresse de contact du robot est remplacée par `<contact>` : elle vient de l'environnement.
Ce dossier sera retiré une fois la collecte portée.
