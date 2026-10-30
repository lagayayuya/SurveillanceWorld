"""Build the dispositifs CSVs from hand-read values (2026-10-23).

Every value below was read by hand in the downloaded PDF (pages printed with extract.py, names
scrubbed) or on Légifrance (WebFetch). sha256 is computed from the file on disk.
No natural-person names: beneficiaries are services, communes or legal entities.

Usage: python -I build_csv.py <M root>
"""
import csv, hashlib, os, sys

M = sys.argv[1]
RAW = os.path.join(M, "data/raw/dispositifs/raa")
OLD = os.path.join(M, "data/raw/arretes")
OUT = os.path.join(M, "data/derived/dispositifs")
os.makedirs(OUT, exist_ok=True)
WIN = ("2025-10-23", "2026-10-23")  # pilot window: 12 most recent months


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def manifest(d):
    m = {}
    for line in open(os.path.join(d, "manifest.tsv"), encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if len(f) >= 6 and f[1] == "200" and "ERREUR" not in line:
            m[f[4]] = f[5]
        elif len(f) == 5:  # older manifest format (no sha column)
            m[f[3]] = f[4]
    return m


MAN = manifest(RAW)
MAN_OLD = manifest(OLD)


def src(fname):
    if fname in MAN:
        return MAN[fname], sha(os.path.join(RAW, fname))
    return MAN_OLD[fname], sha(os.path.join(OLD, fname))


# type, dept, raa, act_id, date_acte, authority, beneficiary, perimeter, period, n_devices, file, note
ACTS = [
    ("drone", "75", "75-2025-357", "75-2025-06-19-00003 (arrêté 2025-00771)", "2025-06-19", "préfet de police",
     "PP, direction de l'ordre public et de la circulation (DOPC)", "Paris, plan en annexe (concert du 21/06/2025)",
     "2025-06-21 17h -> 2025-06-22", "2", "paris_raa_75-2025-357.pdf", "lu par le volet arrêtés; hors fenêtre"),
    ("drone", "75", "75-2026-008", "75-2026-01-05-00007 (arrêté 2026-00011)", "2026-01-05",
     "préfet de police + préfets 77, 78, 91, 95 (arrêté conjoint)", "PP DOPC (2 hélicoptères de la gendarmerie)",
     "Paris + 77, 78, 91, 92, 93, 94, 95 aux abords des rassemblements d'agriculteurs",
     "2026-01-06 06h -> 2026-01-09 18h", "2", "p75_2026-008.pdf", "sommaire daté « 05 janvier 2025 » (coquille)"),
    ("drone", "75", "75-2026-243", "75-2026-04-27-00006 (arrêté 2026-00477)", "2026-04-27", "préfet de police",
     "PP DOPC", "Paris, plan en annexe (match PSG - Bayern)", "2026-04-28 20h -> 2026-04-29 04h", "2",
     "p75_2026-243.pdf", ""),
    ("drone", "75", "75-2026-243", "75-2026-04-28-00006 (arrêté 2026-00481)", "2026-04-28", "préfet de police",
     "PP DOPC", "Paris, plan en annexe (manifestation du 1er mai)", "2026-05-01 12h-21h", "6", "p75_2026-243.pdf", ""),
    ("drone", "75(93)", "75-2026-243", "75-2026-04-28-00003 (arrêté 2026-00478)", "2026-04-28", "préfet de police",
     "PP DOPC (demande de la DTSP 93)", "Aulnay-sous-Bois (93), plan en annexe", "2026-04-29 15h-20h", "2",
     "p75_2026-243.pdf", "acte de la PP publié au RAA de Paris pour le 93"),
    ("drone", "75(93)", "75-2026-243", "75-2026-04-28-00004 (arrêté 2026-00479)", "2026-04-28", "préfet de police",
     "PP DOPC", "Bagnolet (93), plan en annexe", "2026-04-29 (horaires non relevés)", "2", "p75_2026-243.pdf", ""),
    ("drone", "69", "69-2025-332", "69-2025-12-17-00001", "2025-12-17", "préfet délégué pour la défense et la sécurité (Rhône)",
     "DIPN du Rhône", "Lyon, zone délimitée par une liste de voies", "2025-12-18 11h-18h",
     "1 (art. 2 cite le modèle DJI Matrice 4 T, pas un nombre)", "p69_2025-332.pdf", ""),
    ("drone", "69", "69-2026-259", "69-2026-09-01-00003", "2026-09-01", "préfet délégué pour la défense et la sécurité (Rhône)",
     "Direction zonale des CRS", "Vénissieux (deux opérations de voie publique)", "2026-09-02 14h -> 2026-09-03 01h",
     "2 (DJI Matrice 4T, une par drone)", "p69_2026-259.pdf", "trouvé par échantillon de septembre 2026"),
    ("drone", "13", "13-2025-333 Bis", "13-2025-11-06-00001", "2025-11-06", "préfète de police déléguée (BdR)",
     "DIPN des Bouches-du-Rhône", "Marseille, liste de voies autour du stade Orange Vélodrome",
     "2025-11-08 14h-20h", "2 (drones DJI Mavic)", "p13_2025-333bis.pdf", ""),
    ("drone", "13", "13-2025-354 bis", "13-2025-11-21-00001", "2025-11-21", "préfète de police déléguée (BdR)",
     "DIPN des Bouches-du-Rhône", "Marseille, secteurs place de la Joliette et Orange Vélodrome",
     "2025-11-25 11h-20h (Joliette); 2025-11-25 15h -> 11-26 01h (Vélodrome)", "2 (drones DJI Mavic)",
     "p13_2025-354bis.pdf", ""),
    ("drone", "13", "13-2025-389 ter", "(identifiant absent de la page)", "2025-12-19", "préfète de police déléguée (BdR)",
     "groupement de gendarmerie départementale des BdR", "Berre-l'Étang, quartier de la Mariélie (3 voies + annexe)",
     "2025-12-21 18h-24h", "1 (drone DJI Mavic 3T)", "p13_2025-389ter.pdf", "information du public écartée: RAA seul"),
    ("drone", "13", "13-2026-011", "13-2026-01-12-00009", "2026-01-12", "préfète de police déléguée (BdR)",
     "DIPN des Bouches-du-Rhône", "Miramas, périmètre de voies", "2026-01-14 20h -> 2026-01-15 04h",
     "2 (art. 2) mais « une caméra » dans les considérants", "p13_2026-011.pdf", "incohérence interne"),
    ("drone", "13", "13-2026-311-special-bis", "(sommaire sans identifiant)", "2026-10-05", "préfète de police déléguée (BdR)",
     "groupement de gendarmerie départementale des BdR", "Gardanne, 500 m autour de trois lycées",
     "2026-10-06 7h-10h, 11h-13h, 14h-17h", "1 (drone DJI Mavic 3T)", "p13_2026-311-bis.pdf",
     "trouvé par échantillon des recueils « bis » 2026"),
    ("vsa", "75(93)", "75-2025-070", "75-2025-01-31-00013 (arrêté DUPA 2025-0134)", "2025-01-31", "préfet de police",
     "préfecture de police (responsable de traitement; demande de la DILT)",
     "images des caméras installées aux accès du Stade de France", "2025-01-31 18h -> 2025-02-01 02h",
     "non précisé", "p75_2025-070.pdf",
     "traitement « Cityvision » développé par la société Wintics; attestation de conformité du ministre du 11/04/2024; hors fenêtre"),
    ("cameras_pietons", "13", "13-2022-179", "13-2022-06-21-00010", "2022-06-21", "préfète de police des BdR",
     "commune de Trets (le maire)", "territoire de la commune", "sans terme (modification de l'arrêté du 20/10/2021)",
     "8 (6 + 2)", "p13_2022-179.pdf", "hors fenêtre: aucun acte 2025-2026 trouvé dans le pilote"),
    ("lapi_mention", "07", "07-2025-090", "07-2025-03-27-00015", "2025-03-27", "préfet de l'Ardèche",
     "commune d'Étables (le maire)", "vidéoprotection de voie publique de la commune", "5 ans renouvelable",
     "7 caméras VP, dont « certaines » LAPI (nombre non donné)", "p07_2025-090.pdf",
     "hors pilote, trouvé par recherche; pas d'acte LAPI de l'État publié"),
    ("videoverbalisation+raccordement_mention", "69", "69-2025-307", "69-2025-11-18-00015", "2025-11-18", "préfète du Rhône",
     "commune de Mions", "commune (masquage du territoire de Corbas)", "5 ans", "7 int. / 22 ext. / 109 VP",
     "rhone_raa_69-2025-307.pdf",
     "finalité « constatation des infractions aux règles de la circulation »; art. 3: déport d'images vers la gendarmerie de Mions"),
]

with open(os.path.join(OUT, "actes_pilote.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["type", "departement", "raa", "acte", "date_acte", "dans_fenetre_12_mois", "autorite",
                "beneficiaire_entite", "perimetre", "periode", "n_dispositifs", "url", "sha256", "fichier", "note"])
    for t, d, raa, act, date, auth, ben, per, period, n, fn, note in ACTS:
        url, h = src(fn)
        inwin = "o" if WIN[0] <= date <= WIN[1] else "n"
        w.writerow([t, d, raa, act, date, inwin, auth, ben, per, period, n, url, h, fn, note])

# Hand-check verdicts: ok = present and unambiguous; ambigu = present but needs interpretation; absent.
SAMPLE = [
    ("drone", "75-2026-01-05-00007", "ambigu (sommaire 2025, acte 2026)", "ok (conjoint PP + 4 préfets)", "ok (service)",
     "ok (8 départements)", "ok", "ok (2)", "ok (4 finalités)", "arrêté signé par 5 autorités, publié 5 fois"),
    ("drone", "75-2026-04-28-00006", "ok", "ok", "ok (service)", "ambigu (plan en annexe, image)", "ok", "ok (6)",
     "ok (3)", "périmètre seulement sur carte"),
    ("drone", "69-2025-12-17-00001", "ok", "ok", "ok (service)", "ok (liste de voies)", "ok", "ambigu (modèle de drone au lieu d'un nombre)",
     "ok (2)", ""),
    ("drone", "13-2025-11-06-00001", "ok", "ok (par délégation)", "ok (service)", "ok (liste de voies)", "ok", "ok (2)",
     "ambigu (art. 1: 2 finalités; considérants: 1° et 4°)", "titre de page en image: OCR"),
    ("drone", "13-2026-01-12-00009", "ok (via identifiant)", "ok", "ok (service)", "ok", "ok", "ambigu (2 en art. 2, 1 dans les considérants)",
     "ok", "information du public écartée"),
    ("vsa", "75-2025-01-31-00013", "ok", "ok", "ok (PP, responsable de traitement)", "ambigu (« caméras aux accès du Stade de France »)",
     "ok", "absent", "ok (7 événements de l'art. 3 du décret)", "fournisseur et logiciel nommés, date d'attestation"),
    ("cameras_pietons", "13-2022-06-21-00010", "ok", "ok", "ok (commune)", "ok (territoire communal)", "absent (pas de terme)",
     "ok (8, dont delta +2)", "absent (renvoi au CSI)", "acte modificatif: le total se lit, pas toujours"),
    ("lapi_mention", "07-2025-03-27-00015", "ok", "ok", "ok (commune)", "ok", "ok (5 ans)", "ambigu (LAPI « certaines »)",
     "ok", "LAPI comme mention dans un arrêté de vidéoprotection"),
    ("videoverbalisation+raccordement_mention", "69-2025-11-18-00015", "ok", "ok", "ok (commune)", "ok", "ok (5 ans)",
     "ok (138)", "ok (inclut infractions circulation)", "déport vers la gendarmerie nommé; convention commune-État citée, non publiée"),
]
with open(os.path.join(OUT, "actes_echantillon.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["type", "acte", "date", "autorite", "beneficiaire", "perimetre", "periode", "n_dispositifs", "finalites", "remarque"])
    w.writerows(SAMPLE)

PRESTA = [
    ("WINTICS", "834113342", "WINTICS", "5710", "75018 PARIS", "A",
     "BOAMP 23-181232 (résultat, DEPAFI, ministère de l'intérieur, accord-cadre « Solutions algorithmiques de vidéo-protection », attribué le 2023-12-08): titulaire lots 1 à 4 (rang 1 lots 1 et 4, rang 2 lots 2 et 3); arrêté PP DUPA 2025-0134: logiciel « Cityvision », attestation de conformité du 11/04/2024",
     "https://www.boamp.fr/pages/avis/?q=idweb:23-181232 ; " + MAN["p75_2025-070.pdf"]),
    ("VIDETICS", "849070792", "VIDETICS", "5710", "06410 BIOT", "A",
     "BOAMP 23-181232: titulaire lots 1 à 3 (rang 1 lot 2)", "https://www.boamp.fr/pages/avis/?q=idweb:23-181232"),
    ("CHAPVISION (graphie BOAMP)", "851035329", "CHAPSVISION", "5710", "92150 SURESNES", "A",
     "BOAMP 23-181232: titulaire lots 1 à 4 (rang 1 lot 3); rapprochement SIRENE par nom + code postal",
     "https://www.boamp.fr/pages/avis/?q=idweb:23-181232"),
    ("Orange Business Service (graphie BOAMP)", "345039416", "ORANGE BUSINESS SERVICES", "5599", "93200 SAINT-DENIS", "A",
     "BOAMP 23-181232: lot 4 (transports), rang 3; BOAMP donne 93210 La Plaine Saint-Denis, SIRENE 93200: rapprochement par nom",
     "https://www.boamp.fr/pages/avis/?q=idweb:23-181232"),
]
with open(os.path.join(OUT, "vsa_prestataires.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["nom_dans_le_texte", "siren", "denomination_sirene", "nature_juridique_code_insee", "siege", "etat",
                "texte_officiel_qui_le_nomme", "url"])
    w.writerows(PRESTA)

LF = "https://www.legifrance.gouv.fr"
REG = [
    ("VSA", "loi n° 2023-380 art. 10 (I: expérimentation jusqu'au 31/12/2030; VII: emploi autorisé par le préfet, à Paris le PP, « décision motivée et publiée »; durée 1 mois pour les manifestations; VI: attestation de conformité « publiée »)",
     "en vigueur depuis le 2026-08-20, modifié par loi n° 2026-798 du 18/08/2026 art. 50; version 2026-03-22 -> 2026-08-20 (loi n° 2026-201 du 20/03/2026 art. 47, fin au 31/12/2027); version 2023-05-21 -> 2026-03-22 (fin au 31/03/2025: aucun emploi possible du 01/04/2025 au 21/03/2026)",
     "préfet / préfet de police; ministre de l'intérieur (attestation)", "arrêté préfectoral d'emploi; attestation de conformité",
     "o: RAA (et page d'information PP / ministère); attestation: publication prévue, non trouvée",
     LF + "/loda/article_lc/LEGIARTI000054725407 ; " + LF + "/loda/id/JORFTEXT000047561974/2026-05-01 ; " + LF + "/loda/id/JORFTEXT000047561974/2026-01-01"),
    ("VSA", "décret n° 2023-828 art. 3 (8 événements), 13 (arrêté du préfet; services: PN, GN, SIS, police municipale, SNCF, RATP), 14 (attestation délivrée par le ministre de l'intérieur)",
     "JORF, version publiée (2023-08-30)", "préfet / PP", "arrêté", "o (RAA)", LF + "/jorf/id/JORFTEXT000048007135"),
    ("VSA hors art. 10", "CSI L251-2 ne permet pas le traitement algorithmique des images (CE 30/01/2026 n° 506370, commune de Nice c/ CNIL)",
     "décision du 2026-01-30", "-", "-", "-", LF + "/ceta/id/CETATEXT000053425905"),
    ("drones FSI", "CSI L242-5 (IV: décision écrite et motivée du préfet, à Paris du PP; 3 mois max renouvelables; rassemblements: durée du rassemblement; urgence: 72 h et « publicité par tout moyen »; registre transmis au préfet)",
     "en vigueur depuis le 2026-08-20, modifié par loi n° 2026-798 art. 42 et 7", "préfet / PP (BdR: préfète de police déléguée)", "arrêté",
     "o en pratique: RAA (« publié au RAA » dans chaque arrêté lu); le texte n'impose la publicité qu'en urgence",
     LF + "/codes/section_lc/LEGITEXT000025503132/LEGISCTA000025505323/"),
    ("drones FSI", "arrêté du 19/04/2023: nombre maximal de caméras sur aéronefs par département (75, 69, 13: 100; 107 entrées, somme 6 170)",
     "version initiale (JO du 2023-04-20); consolidation non vérifiée", "ministre de l'intérieur", "arrêté ministériel", "o (JORF)",
     LF + "/jorf/id/JORFTEXT000047464724"),
    ("drones police municipale", "aucun régime: L242-7 absent du chapitre (expérimentation PM censurée, décision CC n° 2021-834 DC du 20/01/2022, art. 1er: le 8° de l'art. 15 de la loi 2022-52 et les mots « et L. 242-7 » sont contraires à la Constitution, cons. 34 à 39)",
     "chapitre lu le 2026-10-23", "-", "-", "n (aucun acte possible)", LF + "/codes/section_lc/LEGITEXT000025503132/LEGISCTA000025505308/ ; " + LF + "/jorf/id/JORFTEXT000045067968/"),
    ("caméras-piétons PM", "CSI L241-2 (autorisation du préfet, demande préalable du maire, convention de coordination) et R241-8 (arrêté du préfet, à Paris du PP, qui « précise le nombre de caméras » et les communes)",
     "L241-2: en vigueur depuis le 2022-01-26 (loi n° 2022-52 art. 14); R241-8: depuis le 2025-07-17 (décret n° 2025-650 art. 7)",
     "préfet / PP", "arrêté", "publication non prévue par les textes; en pratique RAA (BdR 2019-2022); aucun acte 2025-2026 trouvé dans le pilote",
     LF + "/codes/section_lc/LEGITEXT000025503132/LEGISCTA000025505308/ ; " + LF + "/codes/article_lc/LEGIARTI000046517582"),
    ("LAPI", "CSI L233-1 (PN, GN, douanes; III: usage temporaire pour l'ordre public sur « décision de l'autorité administrative », autorité non précisée), L233-1-1 (infractions routières, PN et GN), L233-2 (conservation 1 an, pas de reconnaissance faciale), L233-3 (conventions avec autorités publiques ou personnes morales de droit privé)",
     "L233-1, L233-2, L233-3: en vigueur depuis le 2026-08-20 (loi n° 2026-798 art. 44); L233-1-1: depuis le 2017-11-05",
     "services de l'État; aucune autorisation préfectorale prévue", "décision (III) ; convention (L233-3)",
     "n: aucune publication prévue ni trouvée; des caméras LAPI communales apparaissent comme mention dans des arrêtés de vidéoprotection (Ardèche)",
     LF + "/codes/section_lc/LEGITEXT000025503132/LEGISCTA000025505280/"),
    ("vidéoverbalisation", "CSI L251-2 4° (finalité « constatation des infractions aux règles de la circulation ») dans l'autorisation de vidéoprotection; code de la route L130-9 (appareils automatiques homologués; collectivités: avis favorable du préfet après CDSR) et D130-11-1 (dossier au préfet); L121-3/R121-6 (liste des infractions) non relus",
     "L251-2: depuis le 2023-05-21 (loi 2023-380 art. 9); L130-9: depuis le 2022-02-23 (loi 2022-217 art. 53); D130-11-1: depuis le 2025-07-17 (décret 2025-651 art. 2)",
     "préfet (autorisation de vidéoprotection)", "arrêté de vidéoprotection (finalité) ; avis du préfet (L130-9)",
     "o comme finalité dans l'arrêté publié au RAA (ex. Mions); avis L130-9: publication non prévue; actes municipaux non examinés",
     LF + "/codes/section_lc/LEGITEXT000025503132/LEGISCTA000025505402/ ; " + LF + "/codes/article_lc/LEGIARTI000039785284 ; " + LF + "/codes/article_lc/LEGIARTI000049255114"),
    ("raccordement CSU / déport", "CSI L252-3 (l'autorisation peut prévoir que les agents de PN, GN, douanes, SIS, PM sont destinataires des images; modalités fixées par l'autorisation) et L252-2",
     "L252-3: depuis le 2021-05-27 (loi 2021-646 art. 40); L252-2: depuis le 2023-05-21", "préfet", "clause de l'arrêté de vidéoprotection; convention commune-État",
     "partiel: la clause est publiée au RAA (ex. « déport d'images vers la gendarmerie de Mions »); les conventions de partenariat ne sont pas publiées (aucune trouvée); CSI L512-4 (convention de coordination) non relu: hypothèse",
     LF + "/codes/section_lc/LEGITEXT000025503132/LEGISCTA000025505402/"),
]
with open(os.path.join(OUT, "regimes.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["dispositif", "base_legale", "version_lue", "autorite", "type_acte", "publie_ou", "url_lue"])
    w.writerows(REG)
print("ok", len(ACTS), "actes,", len(SAMPLE), "échantillon,", len(PRESTA), "prestataires,", len(REG), "régimes")
