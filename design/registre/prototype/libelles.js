// Short labels written by hand in the validated mockups (maquette-direction/, 2026-10-25), for the documents they
// show: the published object stays in the record and in the exports; the label only reads better. Any other
// document is shown with its published object, in sentence case. { affaire: { court, titre } }:
// court = a few words after « Appel d'offres : » or « Premier contrat trouvé avec X : »; titre = a title.
window.LIBELLES = {
  // Mions (Commune-grand, Documents-grand, Contrat-grand)
  "avis-17-164514": { court: "pour l'entretien des caméras", titre: "Entretien d'un système de vidéosurveillance", source: "Commune-grand" },
  "avis-20-142345": { court: "achat et entretien des caméras", titre: "Achat et entretien d'un système de vidéosurveillance", source: "Commune-grand" },
  "avis-26-71981": { court: "entretien, renouvellement et achat de caméras", titre: "Entretien, renouvellement et achat de matériel de vidéoprotection", source: "Commune-grand" },
  "216902833000132020_32323500": { court: "achat et entretien des caméras", titre: "Achat et entretien des caméras de Mions", source: "Commune-grand" },
  "21690283300013202520240600_32323500": { court: "achat et entretien des caméras", titre: "Achat et entretien des caméras de Mions", source: "Contrat-grand" },
  // Sytral (Acheteur-grand)
  "256900994000112018M1800_32323500": { court: "systèmes centraux de vidéoprotection, métro et réseau", titre: "Systèmes centraux de vidéoprotection, métro et réseau", source: "Acheteur-grand" },
  "256900994000112019M19004700_45311000": { court: "ligne D : courants faibles et caméras", titre: "Ligne D : courants faibles et caméras", source: "Acheteur-grand" },
  "256900994000112019M19007200_32323500": { court: "interface serveur vidéo – postes de commande lignes A et C", titre: "Interface serveur vidéo – postes de commande lignes A et C", source: "Acheteur-grand" },
  "256900994000112020M20_45300000": { court: "vidéosurveillance des stations de tramway T1, T2, T3", titre: "Vidéosurveillance des stations de tramway T1, T2, T3", source: "Acheteur-grand" },
  "256900994000112020M20012300_45300000": { court: "vidéoprotection du parc relais Laurent Bonnevay", titre: "Vidéoprotection du parc relais Laurent Bonnevay", source: "Acheteur-grand" },
  "256900994000112021M210162_32323500": { court: "vidéoprotection à bord des rames de tramway de 32 m", titre: "Vidéoprotection à bord des rames de tramway de 32 m", source: "Acheteur-grand" },
  "256900994000112021M21018300_35120000": { court: "T1, T2, T3 : enregistrement central des images", titre: "T1, T2, T3 : enregistrement central des images", source: "Acheteur-grand" },
  "avis-15-73895": { court: "maîtrise d'œuvre et systèmes pour la vidéoprotection embarquée de la ligne de métro D", titre: "Maîtrise d'œuvre et systèmes pour la vidéoprotection embarquée de la ligne de métro D", source: "Acheteur-grand" },
  "avis-15-173782": { court: "enregistreurs, caméras supplémentaires et câblages dans les 73 rames de 32 m du tramway", titre: "Enregistreurs, caméras supplémentaires et câblages dans les 73 rames de 32 m du tramway", source: "Acheteur-grand" },
  "avis-16-24009": { court: "vidéoprotection embarquée de la ligne D et communication sol/bord de la ligne B", titre: "Vidéoprotection embarquée de la ligne D et communication sol/bord de la ligne B", source: "Acheteur-grand" },
  "20009638600012202323M_45234124": { court: "communication sol-bord pour la vidéoprotection embarquée de la ligne A", titre: "Communication sol-bord pour la vidéoprotection embarquée de la ligne A", source: "Acheteur-grand" },
  "20009638600012202423M_32323500": { court: "paramétrage de la vidéoprotection (systèmes transverses)", titre: "Paramétrage de la vidéoprotection (systèmes transverses)", source: "Acheteur-grand" },
  "20009638600020202524M0127_45233292": { court: "renouvellement de la vidéoprotection, tramway T4 et extension T1", titre: "Renouvellement de la vidéoprotection, tramway T4 et extension T1", source: "Acheteur-grand" },
  "20009638600020202625M128_45233292": { court: "caméras de voie sur la ligne A : fourniture, installation, raccordement", titre: "Caméras de voie sur la ligne A : fourniture, installation, raccordement", source: "Acheteur-grand" },
};
// Short names of a few buyers, as the mockups write them (Acheteur-grand, Entreprise-grand, Departement-grand)
window.NOMS_COURTS = {
  "256900994": "Sytral (transports lyonnais)",
  "200096386": "Sytral Mobilités",
  "776056467": "UGAP (centrale d’achat)",
  "176901205": "Services pénitentiaires Lyon Centre-Est",
};
// Buyers of one same network, each with its own SIREN (Acheteur-grand: « Aussi : Sytral Mobilités »)
window.ACHETEURS_LIES = { "256900994": "200096386", "200096386": "256900994" };
// The lead of a buyer's page, as the mockup words it (Acheteur-grand)
window.LEADS_ACHETEURS = { "256900994": { sujet: "L'autorité des transports lyonnais", pour: "pour filmer son réseau (métro, tramways, parc relais)" } };
