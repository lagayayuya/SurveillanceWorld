"""Build the registry of public buyers for prototype-v9 (window.ACHETEURS).

Usage: python -I scripts/acheteurs/build_acheteurs.py   (from anywhere; paths are relative to M)

Reads (read-only): prototype-v4/registre.js, data/raw/decp/decp.parquet,
data/raw/geo_pop/communes_france.json.
Writes: prototype-v9/acheteurs.js, data/derived/acheteurs/acheteurs_revue.csv,
data/derived/acheteurs/lyon.md.

One entry per buyer SIREN found in the registry's contracts and notices (avis).
Names: a commune gets its COG name; any other buyer gets the best published variant,
or a careful French title case of it when every variant is in capitals.
"""

import collections
import csv
import json
import re
import unicodedata
from pathlib import Path

import duckdb

M = Path(__file__).resolve().parents[2]
REG = M / "prototype-v4" / "registre.js"
DECP = M / "data" / "raw" / "decp" / "decp.parquet"
COG = M / "data" / "raw" / "geo_pop" / "communes_france.json"
OUT_JS = M / "prototype-v9" / "acheteurs.js"
OUT_DIR = M / "data" / "derived" / "acheteurs"

# ---------------------------------------------------------------- text helpers


def plain(s: str) -> str:
    """Upper case, no accents, punctuation as spaces: the comparison form."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Za-z0-9]+", " ", s).upper()
    return re.sub(r"\s+", " ", s).strip()


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def has_accent(s: str) -> bool:
    return strip_accents(s) != s


def lower_share(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    return sum(c.islower() for c in letters) / len(letters) if letters else 0.0


def is_mixed(s: str) -> bool:
    """Mixed case in earnest: enough lower-case letters, and not all lower case."""
    return s != s.lower() and lower_share(s) >= 0.4


def clean_variant(s: str) -> str:
    """Drop trailing parentheses (service names, codes) and trailing department codes."""
    s = re.sub(r"\s+", " ", s).strip()
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\s*\([^()]*\)\s*$", "", s).strip()
        s = re.sub(r"\s*[-–]\s*\d{2,3}\s*$", "", s).strip()
        s = re.sub(r"^\d{2,3}\s*[-–]\s*", "", s).strip()  # leading department code (« 94 - CAF… »)
        s = re.sub(r"\s+[-–]\s+(AGENCE|ANTENNE|DIRECTION TERRITORIALE|SITE|DT)\b.*$", "", s, flags=re.I).strip()
    s = re.sub(r"\b([DLdl])['’]\s+(?=\w)", r"\1'", s)  # « DE L' ESSONNE »
    s = re.sub(r"\s*-\s+|\s+-\s*", " - ", s)  # « SETE- La tour »
    return s.strip(" -–,;")


GENERIC = {"DE", "DU", "DES", "LA", "LE", "LES", "L", "D", "ET", "A", "AU", "AUX", "EN", "SUR", "POUR"}
ABBREV_TOKENS = {"CA": ["COMMUNAUTE", "AGGLOMERATION"], "CC": ["COMMUNAUTE", "COMMUNES"],
                 "CU": ["COMMUNAUTE", "URBAINE"], "CTRE": ["CENTRE"], "AP": ["ASSISTANCE"], "HP": ["PUBLIQUE", "HOPITAUX"]}


SYNONYMS = [(r"\bCONSEIL (DEPARTEMENTAL|GENERAL)\b", "DEPARTEMENT"), (r"\bCONSEIL REGIONAL\b", "REGION"),
            (r"\bAGGLO\b", "AGGLOMERATION"), (r"^C C\b", "CC"), (r"^C A\b", "CA")]


def tokens(s: str) -> set:
    out = set()
    p = plain(clean_variant(s))
    for a, b in SYNONYMS:
        p = re.sub(a, b, p)
    for t in p.split():
        if t in GENERIC:
            continue
        out.update(ABBREV_TOKENS.get(t, [t]))
    return out


def jaccard(a: str, b: str) -> float:
    ta, tb = tokens(a), tokens(b)
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def _subsequence(a: str, b: str) -> bool:
    it = iter(b)
    return all(ch in it for ch in a)


def spells_out(short: str, name: str) -> bool:
    """« SDESM » / « SYNDICAT DEPARTEMENTAL DES ENERGIES DE SEINE-ET-MARNE », « DISP Paris » /
    « DIRECTION INTERREGIONALE DES SERVICES PENITENTIAIRES PARIS… »: the leading acronym is a
    subsequence of the name's initials and the other words all appear in the name."""
    raw = clean_variant(short).split()
    if not raw or not re.fullmatch(r"[A-Z]{3,8}", plain(raw[0])) or raw[0] != raw[0].upper():
        return False
    words = plain(clean_variant(name)).split()
    if len(words) < 2:
        return False
    rest = tokens(" ".join(raw[1:])) if len(raw) > 1 else set()
    return _subsequence(plain(raw[0]), "".join(w[0] for w in words)) and rest <= tokens(name)


def same_body(a: str, b: str) -> bool:
    return similar(a, b) or spells_out(a, b) or spells_out(b, a)


def similar(a: str, b: str) -> bool:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    inter = len(ta & tb)
    return inter / len(ta | tb) >= 0.5 or inter / min(len(ta), len(tb)) >= 0.8


# ---------------------------------------------------------------- title case

SMALL = {"de", "du", "des", "la", "le", "les", "et", "à", "a", "en", "sur", "sous", "pour", "par",
         "au", "aux", "dans", "ou"}
ACRONYMS = {
    "SYTRAL", "SNCF", "RATP", "OPAC", "SIVOM", "SIVU", "SDIS", "CCAS", "CIAS", "EPT", "GIP", "SEM", "SPL", "UGAP",
    "OPH", "HLM", "SA", "SAS", "SARL", "SAEM", "SEMOP", "EPA", "EPIC", "EPCI", "CHU", "CHR", "CHS", "CH", "GHT",
    "GHU", "APHP", "AP-HP", "SGAMI", "SGAP", "SGAR", "DGGN", "DGPN", "DGA", "DDT", "DDTM", "DREAL", "DRIEA",
    "DRIEAT", "DIR", "DIRM", "DISP", "DPE", "PACA", "IDF", "CNRS", "INRAE", "INSERM", "CEA", "CAF", "CNAF",
    "CPAM", "URSSAF", "ARS", "CROUS", "INSA", "ENS", "HEC", "ESPCI", "CNAM", "IGN", "INA", "BNF", "VNF", "ONF",
    "CNES", "SIAAP", "SEDIF", "SIPPEREC", "SIGEIF", "SYCTOM", "SMICTOM", "SICTEUB", "SDESM", "SDEHG", "SIEL",
    "EPAURIF", "OPPIC", "SEMAPA", "CDC", "ICF", "TCL", "RTM", "TAM", "SNC", "SG", "SFAC", "SDBA", "DMA", "DFA",
    "SDA", "CHNO", "MIOMCT", "RGPACA", "SDEC", "SYDEV", "SIEDS", "SYDESL", "UGECAM", "CARSAT", "MSA", "UCANSS",
    "ANTS", "ANSM", "RTE", "EDF", "GRDF", "ENEDIS", "SEMIDEP", "HAROPA", "CIRAD", "IRD", "INRIA", "INRAP",
    "CMN", "RMN", "EHPAD", "IUT", "UFR", "CFA", "CCI", "CMA", "ESAT", "ADEME", "AFPA", "SPLA", "SIRTOM", "SITOM",
    "SICOVAL", "SMTC", "SMT", "AOM", "TER", "TGV", "RER", "SAN", "SMA", "SIAH", "SIVOA", "SMIRTOM", "SIEA",
    "SIETOM", "SITCOM", "SDE", "SDEE", "SYANE", "TE", "FDEE", "DSI", "DSIC", "SDSIC", "DRFIP", "DGFIP", "DDFIP",
    "DIRECCTE", "DREETS", "DRAAF", "DRAC", "DRJSCS", "DDPP", "DDCS", "SPIP", "PJJ", "DPJJ", "SGC", "SGCD",
    "CRS", "GGD", "BSPP", "BMPM", "SSA", "SID", "ESID", "USID", "GSBDD", "CEREMA", "IFSTTAR", "INSP", "UGAP",
    "SMO", "GPIS", "EPPDCSI", "SIREDOM", "SIECCAO", "CREPS", "CRAM", "SPLM", "ENSAM", "EPPGHV", "RIVP", "SIEMP",
    "MEN", "RECT", "AP-HM", "APHM", "CHPA", "CHIAP", "VBA", "CD", "MC", "CY", "DT", "BA", "IRVE", "SIRTOM",
}
ROMAN = re.compile(r"^(?=[IVX]+$)X{0,3}(?:IX|IV|V?I{0,3})$")
VOWELS = set("AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜŸ")
# The spec's institutional words, and a few the data table may miss (short or rare words).
ACCENTS_MANUAL = {
    "METROPOLE": "métropole", "REGION": "région", "DEPARTEMENT": "département", "COMMUNAUTE": "communauté",
    "AGGLOMERATION": "agglomération", "ETABLISSEMENT": "établissement", "PREFECTURE": "préfecture",
    "SECURITE": "sécurité", "UNIVERSITE": "université", "SOCIETE": "société", "ELECTRICITE": "électricité",
    "ENERGIE": "énergie", "ENERGIES": "énergies", "EQUIPEMENT": "équipement", "EQUIPEMENTS": "équipements",
    "ECOLE": "école", "TELECOM": "télécom", "TELECOMS": "télécoms", "TELECOMMUNICATIONS": "télécommunications",
    "ILE": "île", "ETAT": "état", "HOPITAL": "hôpital", "HOPITAUX": "hôpitaux", "SANTE": "santé",
    "DEPARTEMENTAL": "départemental", "DEPARTEMENTALE": "départementale", "REGIONAL": "régional",
    "REGIONALE": "régionale", "INTERREGIONALE": "interrégionale", "INTERREGIONAL": "interrégional",
    "GENERAL": "général", "GENERALE": "générale", "GENERALES": "générales", "MINISTERE": "ministère",
    "SECRETARIAT": "secrétariat", "INTERIEUR": "intérieur", "PENITENTIAIRE": "pénitentiaire",
    "PENITENTIAIRES": "pénitentiaires", "RHONE": "rhône", "SAONE": "saône", "ISERE": "isère", "COTE": "côte",
    "COTES": "côtes", "AGE": "âge", "HOTEL": "hôtel", "MUSEE": "musée", "THEATRE": "théâtre", "OPERA": "opéra",
    "CITE": "cité", "LYCEE": "lycée", "COLLEGE": "collège", "ACADEMIE": "académie", "ECONOMIE": "économie",
    "ECONOMIQUE": "économique", "ETUDES": "études", "SUPERIEURE": "supérieure", "SUPERIEUR": "supérieur",
    "AMENAGEMENT": "aménagement", "RESEAU": "réseau", "RESEAUX": "réseaux", "DEVELOPPEMENT": "développement",
    "ELECTRONIQUE": "électronique", "TELEVISIONS": "télévisions", "TELEVISION": "télévision",
    "MEDITERRANEE": "méditerranée", "VALLEE": "vallée", "DECHETS": "déchets", "ELIMINATION": "élimination",
    "EVACUATION": "évacuation", "BIBLIOTHEQUE": "bibliothèque", "METIERS": "métiers", "FRANCAIS": "français",
    "FRANCAISE": "française", "LEGION": "légion", "DEFENSE": "défense", "ARMEES": "armées", "ARMEE": "armée",
    "MEDICAMENT": "médicament", "ELECTRIQUE": "électrique", "ELECTRIFICATION": "électrification",
    "IMMOBILIERES": "immobilières", "EVALUATION": "évaluation", "AEROPORT": "aéroport", "AEROPORTS": "aéroports",
    "MOBILITES": "mobilités", "MOBILITE": "mobilité", "COMEDIE": "comédie", "ODEON": "odéon",
    "SOUVERAINETE": "souveraineté", "CHAMBERY": "chambéry", "ORLEANS": "orléans", "EVRY": "évry",
    "NIMES": "nîmes", "BEZIERS": "béziers", "HERAULT": "hérault", "PYRENEES": "pyrénées", "DROME": "drôme",
    "ARDECHE": "ardèche", "VENDEE": "vendée", "FINISTERE": "finistère", "LOZERE": "lozère", "ARIEGE": "ariège",
    "CORREZE": "corrèze", "GAZIERE": "gazière", "GAZIERES": "gazières", "NIEVRE": "nièvre", "BIEVRE": "bièvre", "RESIDENCES": "résidences",
    "COOPERATION": "coopération", "OPERATIONS": "opérations", "EPINEAUX": "épineaux", "ZONE": "zone",
    "DIRECTION": "direction", "GRANDLYON": "grandlyon", "PUBLIC": "public", "MARCHE": "marché",
}
# Generic heads whose second word stays lower case in French usage.
PHRASES = [
    (r"\bCommunauté d'Agglomération\b", "Communauté d'agglomération"),
    (r"\bCommunauté de Communes\b", "Communauté de communes"),
    (r"\bCommunauté Urbaine\b", "Communauté urbaine"),
    (r"\bCentre Hospitalier\b", "Centre hospitalier"),
    (r"\bCentre Hospitalier Universitaire\b", "Centre hospitalier universitaire"),
    (r"\bCentre Communal d'Action Sociale\b", "Centre communal d'action sociale"),
    (r"\bSyndicat Mixte\b", "Syndicat mixte"),
    (r"\bSyndicat Intercommunal\b", "Syndicat intercommunal"),
    (r"\bOffice Public de l'Habitat\b", "Office public de l'habitat"),
    (r"\bConseil Départemental\b", "Conseil départemental"),
    (r"\bConseil Régional\b", "Conseil régional"),
    (r"\bÉtablissement Public Territorial\b", "Établissement public territorial"),
    (r"\bÉtablissement Public\b", "Établissement public"),
    (r"\bSecrétariat Général\b", "Secrétariat général"),
    (r"\bDirection Interrégionale\b", "Direction interrégionale"),
    (r"\bDirection Régionale\b", "Direction régionale"),
    (r"\bDirection Départementale\b", "Direction départementale"),
    (r"\bAssistance Publique\b", "Assistance publique"),
    (r"\bSociété Anonyme\b", "Société anonyme"),
    (r"\bHabitations à Loyer Modéré\b", "habitations à loyer modéré"),
    (r"\bHabitat Social\b", "Habitat social"),
]
PRE_FIXES = [  # on the upper-case string, before casing: abbreviations and lost words in published names
    (r"^C\.? ?C\.? ", "CC "), (r"^CA ", "COMMUNAUTE D'AGGLOMERATION "), (r"^CC ", "COMMUNAUTE DE COMMUNES "),
    (r"^CU ", "COMMUNAUTE URBAINE "), (r"\bCOMMUNAUTE (D'|D )?AGGLO\b", "COMMUNAUTE D'AGGLOMERATION"),
    (r"\bCOMMUNAUTE AGGLOMERATION\b", "COMMUNAUTE D'AGGLOMERATION"),
    (r"\bCOMMUNAUTE (DE )?COMMUNES?\b", "COMMUNAUTE DE COMMUNES"), (r"\bCTRE\b", "CENTRE"),
    (r"\bCENT HOSP\b", "CENTRE HOSPITALIER"), (r"\bHOSP\b", "HOSPITALIER"), (r"\bSOC\b", "SOCIETE"),
    (r"\bCENTRE COM ACTION SOCIALE\b", "CENTRE COMMUNAL D'ACTION SOCIALE"), (r"\bASSUR\b", "ASSURANCE"),
    (r"\bINVAL\b", "INVALIDITE"), (r"\bMALA\b", "MALADIE"), (r"\bAGENCE NAT\b", "AGENCE NATIONALE"),
    (r"\bETS\b", "ETABLISSEMENT"), (r"\bSCE\b", "SERVICE"), (r"\bPUB\b", "PUBLIC"), (r"\bALLOCAT\b", "ALLOCATIONS"),
    (r"\bFAMIL\b", "FAMILIALES"), (r"\bUNIV\b", "UNIVERSITE"), (r"\bINTERNAT\b", "INTERNATIONALE"),
    (r"\bCOOP\b", "COOPERATION"), (r"\bAGRO DEV\b", "AGRONOMIQUE POUR LE DEVELOPPEMENT"), (r"\bPERS\b", "PERSONNEL"),
    (r"\bGENER\b", "GENERALE"), (r"\bS (?=SAONE|SEINE|MARNE|LOIRE|OISE)", "SUR "), (r"\bST\b", "SAINT"),
    (r"^DIR ADMINISTRATION\b", "DIRECTION DE L'ADMINISTRATION"), (r"\bGENERALE ET EQUIPEMENT\b", "GENERALE ET DE L'EQUIPEMENT"),
    (r"\bCAISSE ALLOCATIONS\b", "CAISSE D'ALLOCATIONS"), (r"\bCAISSE PREVOYANCE\b", "CAISSE DE PREVOYANCE"),
    (r"\bAGENCE REGIONALE SANTE\b", "AGENCE REGIONALE DE SANTE"),
    (r"\bDIRECTION (REGIONALE|DEPARTEMENTALE) FINANCES\b", r"DIRECTION \1 DES FINANCES"),
    (r"^SI D'", "SYNDICAT INTERCOMMUNAL D'"), (r"\bSA HABITATIONS? LOYER MODERE\b", "SA D'HLM"),
    (r"\bSA HABITAT LOYER MODERE\b", "SA D'HLM"),
    (r"\bAGENCE NATIONALE GESTION DECHETS\b", "AGENCE NATIONALE POUR LA GESTION DES DECHETS"),
    (r"^INSTITUT NATIONAL RECHERCHE SECURITE$", "INSTITUT NATIONAL DE RECHERCHE ET DE SECURITE"),
    (r"^CAISSE ASSURANCE VIEILLE INVALIDITE MALADIE CULTES$", "CAISSE D'ASSURANCE VIEILLESSE INVALIDITE ET MALADIE DES CULTES"),
    (r"\bCAISSE PRIMAIRE CENTRALE ASSURANCE\b", "CAISSE PRIMAIRE CENTRALE D'ASSURANCE"),
    (r"\bCAISSE REGIONALE ASSURANCE\b", "CAISSE REGIONALE D'ASSURANCE"),
    (r"^CENTRE COOPERATION INTERNATIONALE RECHERCHE", "CENTRE DE COOPERATION INTERNATIONALE EN RECHERCHE"),
    (r"\bDEPARTEMENTAL INCENDIE ET SECOURS\b", "DEPARTEMENTAL D'INCENDIE ET DE SECOURS"),
]


class Accents:
    """Accent restoration table: manual words over a table learnt from mixed-case names."""

    def __init__(self, learnt: dict):
        self.table = dict(learnt)
        self.table.update(ACCENTS_MANUAL)

    def word(self, w: str) -> str:
        return self.table.get(strip_accents(w).upper(), w.lower())


def _cap(w: str) -> str:
    return w[:1].upper() + w[1:] if w else w


def title_fr(raw: str, acc: Accents) -> str:
    s = clean_variant(raw).upper()
    s = re.sub(r"\s+", " ", s)
    for a, b in PRE_FIXES:
        s = re.sub(a, b, s)
    # Lone D / L before a word: an apostrophe lost in publication (« METROPOLE D AIX »).
    s = re.sub(r"\b([DL]) (?=[A-ZÀ-Ü])", r"\1'", s)
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        out.append(_title_word(w, acc, first=(i == 0)))
    t = " ".join(out)
    for a, b in PHRASES:
        t = re.sub(a, b, t)
    return _cap(t)


def _title_word(w: str, acc: Accents, first: bool) -> str:
    if not w:
        return w
    if "-" in w and len(w) > 1:
        parts = w.split("-")
        if all(p.upper() in ACRONYMS or not p for p in parts) and w.upper() in ACRONYMS | {"AP-HP"}:
            return w
        return "-".join(_title_word(p, acc, first=(j == 0 and first)) if j == 0
                        else _title_word(p, acc, first=False) for j, p in enumerate(parts))
    m = re.match(r"^([DL])['’](.+)$", w)
    if m:
        art = m.group(1).lower() + "'"
        if first:
            art = art.upper()
        return art + _cap(_title_word(m.group(2), acc, first=True))
    core = re.sub(r"[^\wÀ-ÿ]", "", w)
    if not core:
        return w
    if core.upper() in ACRONYMS or ROMAN.match(core) or any(c.isdigit() for c in core):
        return w
    if len(core) >= 2 and core.isalpha() and not (set(core.upper()) & VOWELS):
        return w  # no vowel: an acronym (GHT, SDSM…)
    lw = acc.word(core)
    if not first and lw in SMALL:
        lw = "à" if lw == "a" else lw
        return w.replace(core, lw)
    return w.replace(core, _cap(lw))


def learn_accents(con) -> dict:
    """Most frequent accented spelling of each word (4 letters or more) in mixed-case DECP texts
    (contract objects and buyer names) and COG commune names (weight 3: proper nouns), kept when it
    clearly dominates the unaccented spelling."""
    forms = collections.defaultdict(collections.Counter)
    rows = con.execute(f"""
        select lower(w), count(*) from (
          select unnest(regexp_extract_all(t, '[A-Za-zÀ-ÿ]{{4,}}')) w from (
            select distinct objet t from '{DECP}' where objet is not null and objet <> upper(objet)
            union all
            select distinct acheteur_nom t from '{DECP}' where acheteur_nom is not null
                                                          and acheteur_nom <> upper(acheteur_nom)))
        where substr(w, 2) = lower(substr(w, 2)) group by 1""").fetchall()
    for lw, n in rows:
        forms[strip_accents(lw).upper()][lw] += n
    for c in json.load(open(COG)):
        for w in re.findall(r"[A-Za-zÀ-ÿ]+", c["nom"]):
            if len(w) >= 4 and w[1:].islower():
                forms[strip_accents(w).upper()][w.lower()] += 3
    learnt = {}
    for key, c in forms.items():
        acc = [(f, k) for f, k in c.items() if has_accent(f)]
        if not acc:
            continue
        best, n_best = max(acc, key=lambda x: x[1])
        n_plain = c.get(key.lower(), 0)
        if n_best >= 3 and n_best >= 2 * n_plain:
            learnt[key] = best
    return learnt


def proper_words(con) -> set:
    """Words that are proper nouns in place names: single-word commune names and the words of
    département names. A published variant writing one in lower case is badly cased."""
    out = set()
    for c in json.load(open(COG)):
        if re.fullmatch(r"[A-Za-zÀ-ÿ]+", c["nom"]) and len(c["nom"]) >= 4 and (c.get("population") or 0) >= 20000:
            out.add(c["nom"].lower())
    for (d,) in con.execute(f"select distinct acheteur_departement_nom from '{DECP}' "
                            "where acheteur_departement_nom is not null").fetchall():
        out.update(w.lower() for w in re.findall(r"[A-Za-zÀ-ÿ]{3,}", d))
    return out - SMALL - {"saint", "sainte", "grand", "haute", "haut", "hauts", "basse", "bas", "nord", "sud",
                          "est", "ouest", "centre", "ville", "port", "pont", "mont", "bois", "parc", "plaine",
                          "vallée", "marche", "charente", "maritime", "territoire", "ile", "réunion", "somme",
                          "manche", "lot", "cher", "creuse", "allier", "orientales", "maritimes", "bouches",
                          "deux", "atlantique", "landes", "basses", "fontaine", "fontaines"}


# ---------------------------------------------------------------- categories

KEYWORDS = [  # order matters: first match wins (on the plain form of the name)
    ("etat", r"\bPREFECTURE\b|\bMINISTERE|\bGENDARMERIE\b|\bPOLICE NATIONALE\b|\bCOMMISSARIAT\b|\bPENITENTIAIRE"
             r"|\bSGAMI\b|\bSGAP\b|SECRETARIAT GENERAL POUR L ADMINISTRATION|AGENCE REGIONALE (DE )?SANTE|\bDISP\b"
             r"|\bDIRECTION (INTER)?REGIONALE|\bDIRECTION (INTER)?DEPARTEMENTALE|\bDREAL\b|\bDRIEA"),
    ("sante", r"\bHOPITA|\bHOSPITALIER|\bHOSPITALO|\bHOSPICES\b|\bCHU\b|\bCHR\b|\bGHT\b|\bGHU\b|ASSISTANCE PUBLIQUE"
              r"|\bAP H[PM]\b|\bCLINIQUE|\bEHPAD\b|INSTITUT CURIE|\bUNION DES HOPITAUX|\bACHETEURS HOSPITALIERS"),
    ("bailleur", r"\bOPH\b|\bOPHLM\b|\bHABITAT\b|\bLOGEMENTS?\b|\bHLM\b|LOYER MODERE|\bOPAC\b|OFFICE PUB(LIC)? D"
                 r"|HABITATIONS|\bIMMOBILIERE\b|\bELOGIE\b|\bIN LI\b|\bSIEMP\b"),
    ("education", r"\bUNIVERSITE|\bUNIV\b|\bLYCEE\b|\bCOLLEGE\b|\bECOLE\b|\bRECTORAT\b|\bRECT\b|\bACADEMIE\b|\bCROUS\b"
                  r"|\bINSA\b|ENSEIGNEMENT SUPERIEUR|CENTRALESUPELEC|\bIUT\b|ETUDES POLITIQUES"),
    ("etat", r"SCIENCES ET TECHNOLOGIES DES TRANSPORTS|\bCEREMA\b|CENTRE D ETUDES ET D EXPERTISE"),
    ("autre", r"^SOCIETE D ECONOMIE MIXTE|^SEM\b"),
    ("transports", r"\bSYTRAL\b|\bMOBILITES?\b|\bTRANSPORTS?\b|\bRATP\b|\bSNCF\b|\bTRAMWAY|\bAEROPORTS?\b"
                   r"|\bGRAND PORT\b|\bPORT AUTONOME\b|\bHAROPA\b|\bVOIES NAVIGABLES\b|\bAUTOROUTES?\b|\bRTM\b"),
    ("etat", r"\bARMEES?\b|SERVICES DE L ETAT|\bJUSTICE\b|COUR D APPEL|COUR ADMINISTRATIVE|\bTRIBUNAL\b"
             r"|COUR DES COMPTES|CONSEIL D ETAT|\bDIRECTION (INTER)?REGIONALE|\bDIRECTION (INTER)?DEPARTEMENTALE"
             r"|\bDREAL\b|\bDRIEA|\bDIR ADMINISTRATION|SECRETARIAT GENERAL|FINANCES PUBLIQUES|\bDGFIP\b"
             r"|\bDIRECTION DES ARCHIVES|\bDIRECTION DE L EVALUATION|\bDIRECTION DES ACHATS DE L ETAT|ARCHIVES NATIONALES"
             r"|\bDGGN\b|\bMIOMCT\b|LEGION D HONNEUR|\bNATIONA(L|LE|LES|UX)\b|\bFRANCE TRAVAIL\b|\bCHANCELLERIE\b"
             r"|\bASSEMBLEE NATIONALE\b|\bSENAT\b|\bAUTORITE\b"),
    ("metropole", r"^METROPOLE\b|\bMETROPOLE$|\bMETROPOLE (DE|DU|D|NICE|AIX|EUROPEENNE|ROUEN|GRAND)\b"),
    ("intercommunalite", r"\bCOMMUNAUTE (D AGGLOMERATION|DE COMMUNES?|URBAINE|AGGLOMERATION|COMMUNES|D AGGLO)\b"
                         r"|^CA |^CC |^CU |^C C |\bAGGLOMERATION$|\bAGGLO\b|\bETABLISSEMENT PUBLIC TERRITORIAL\b|^EPT\b"
                         r"|\bSIVOM\b|\bSIVU\b|SYNDICAT INTERCOMMUNAL|^SI D|PARIS VALLEE DE LA MARNE|GRAND ORLY SEINE BIEVRE"
                         r"|PLAINE COMMUNE$|PARIS TERRES D ENVOL|EST ENSEMBLE|GRAND PARIS GRAND EST|BOUCLE NORD DE SEINE"
                         r"|VALLEE SUD GRAND PARIS|PARIS OUEST LA DEFENSE|GRAND PARIS SEINE OUEST|PARIS EST MARNE"
                         r"|GRAND PARIS SUD EST AVENIR"),
    ("departement", r"^DEPARTEMENT\b|CONSEIL DEPARTEMENTAL|CONSEIL GENERAL|COLLECTIVITE EUROPEENNE D ALSACE"),
    ("region", r"^REGION\b|CONSEIL REGIONAL|COLLECTIVITE TERRITORIALE DE (CORSE|GUYANE|MARTINIQUE)"),
    ("commune", r"^(COMMUNE|VILLE|MAIRIE)\b"),
]
DECP_CAT = {"Département": "departement", "Département outre-mer": "departement", "Région": "region",
            "État": "etat", "Établissement hospitalier": "sante", "Commune": "commune",
            "Groupement de communes": "intercommunalite"}


# Published only as a stylised brand: the display name is written by hand.
OVERRIDES = {"200057941": "Paris Est Marne & Bois", "602052359": "In'li",
             # published as a bare acronym only; expansion written by hand (to check)
             "453414427": "Groupement parisien inter-bailleurs de surveillance (GPIS)",
             "519587851": "Universcience (EPPDCSI)",
             "187500079": "Rectorat de Paris - Chancellerie",
             "130020761": "CentraleSupélec", "302977145": "Comédie-Française"}  # published « MEN / RECT- 75 - Rectorat de PARIS… »
CAT_OVERRIDES = {"602052359": "bailleur", "200057941": "intercommunalite"}


def keyword_category(name: str):
    p = plain(name)
    for cat, rx in KEYWORDS:
        if re.search(rx, p):
            return cat
    return None


# ---------------------------------------------------------------- PLM arrondissements

def plm(code):
    if not code:
        return code
    if code.startswith("751") and len(code) == 5 and "75101" <= code <= "75120":
        return "75056"
    if "69381" <= code <= "69389":
        return "69123"
    if "13201" <= code <= "13216":
        return "13055"
    return code


# ---------------------------------------------------------------- commune names

_ACC = {"a": "aàâä", "e": "eéèêë", "i": "iîï", "o": "oôö", "u": "uùûü", "c": "cç", "y": "yÿ"}


def _loose(part: str) -> str:
    out = ""
    for ch in strip_accents(part).lower():
        out += f"[{_ACC[ch]}{_ACC[ch].upper()}]" if ch in _ACC else (
            f"[{ch}{ch.upper()}]" if ch.isalpha() else ("['’ ]?" if ch in "'’" else re.escape(ch)))
    return out


def hyphen_rules(con, cog) -> list:
    """Official hyphenated place names (départements, régions, communes of 20,000+) to restore in names
    published with spaces: « Ile de France Mobilités » → « Île-de-France Mobilités »."""
    names = set()
    for col in ("acheteur_departement_nom", "acheteur_region_nom"):
        names.update(r[0] for r in con.execute(f"select distinct {col} from '{DECP}' where {col} is not null").fetchall())
    names.update(c["nom"] for c in cog if (c.get("population") or 0) >= 20000)
    rules = []
    for n in sorted((n for n in names if "-" in n), key=len, reverse=True):
        parts = re.split(r"-", n)
        rx = r"(?<![\wÀ-ÿ'’-])" + r"[ -]+".join(_loose(p) for p in parts) + r"(?![\wÀ-ÿ-])"
        rules.append((re.compile(rx), n))
    return rules


def apply_hyphens(name: str, rules) -> str:
    for rx, n in rules:
        name = rx.sub(n, name)
    return name


def commune_label(nom: str, code: str) -> str:
    if code == "75056":
        return "Ville de Paris"
    m = re.match(r"^(Le|Les) (.+)$", nom)
    if m:
        return f"Commune {'du' if m.group(1) == 'Le' else 'des'} {m.group(2)}"
    if strip_accents(nom[:1]).upper() in "AEIOUY":
        return f"Commune d'{nom}"
    return f"Commune de {nom}"


# ---------------------------------------------------------------- main

def main():
    s = REG.read_text(encoding="utf-8")
    R = json.loads(s[s.index("{"):s.rindex("}") + 1])
    affaires, events = R["affaires"], R["evenements"]
    ev_by_id = {e["id"]: e for e in events}
    cog = json.load(open(COG))
    commune_by_siren = {c["siren"]: c for c in cog if c.get("siren")}
    commune_by_code = {c["code"]: c for c in cog}
    members = collections.defaultdict(list)
    for c in cog:
        if c.get("codeEpci"):
            members[c["codeEpci"]].append(c)

    contracts = [a for a in affaires.values() if a["kind"] == "contrat"]
    avis = [e for e in events if e["t"] == "avis"]
    reg_names = collections.defaultdict(collections.Counter)
    contract_names = collections.defaultdict(collections.Counter)
    for a in contracts:
        reg_names[a["acheteur_siren"]][a["acheteur"]] += 1
        contract_names[a["acheteur_siren"]][a["acheteur"]] += 1
    for e in avis:
        if e.get("acheteur_siren"):
            reg_names[e["acheteur_siren"]][e["acheteur"]] += 1
    sirens = sorted(reg_names)
    avis_no_siren = sum(1 for e in avis if not e.get("acheteur_siren"))

    con = duckdb.connect()
    con.execute("create table s(siren varchar)")
    con.executemany("insert into s values (?)", [(x,) for x in sirens])
    decp = con.execute(f"""
        select substr(acheteur_id, 1, 9) siren, acheteur_nom, acheteur_categorie,
               acheteur_commune_code, acheteur_departement_code, count(*) n
        from '{DECP}' d join s on substr(d.acheteur_id, 1, 9) = s.siren
        group by all""").fetchall()
    decp_names = collections.defaultdict(collections.Counter)
    decp_cat = collections.defaultdict(collections.Counter)
    decp_siege = collections.defaultdict(collections.Counter)
    decp_dep = collections.defaultdict(collections.Counter)
    for sir, nom, cat, cc, dc, n in decp:
        if nom:
            decp_names[sir][nom] += n
        if cat:
            decp_cat[sir][cat] += n
        if cc:
            decp_siege[sir][plm(cc)] += n
        if dc:
            decp_dep[sir][dc] += n
    acc = Accents(learn_accents(con))
    hyph = hyphen_rules(con, cog)

    # contract metrics
    stats = {k: {"n": 0, "montant": 0.0, "entreprises": set(), "insee": set(), "dep": collections.Counter()}
             for k in sirens}
    for a in contracts:
        st = stats[a["acheteur_siren"]]
        st["n"] += 1
        st["insee"].add(a["insee"])
        st["dep"][a["dep"]] += 1
        st["entreprises"].update(a.get("entreprises") or [])
        for x in a["events"]:
            e = ev_by_id.get(x)
            if not e or e["t"] != "attribution":
                continue
            st["entreprises"].update(e.get("entreprises") or [])
            if e.get("montant") is not None and not e.get("hors_totaux") and not e.get("national"):
                st["montant"] += e["montant"]
    avis_insee = collections.defaultdict(set)
    avis_dep = collections.defaultdict(collections.Counter)
    for e in avis:
        if e.get("acheteur_siren"):
            avis_insee[e["acheteur_siren"]].add(e["insee"])
            avis_dep[e["acheteur_siren"]][e["dep"]] += 1

    proper = proper_words(con)
    cog_by_name = collections.defaultdict(list)
    for c in cog:
        cog_by_name[plain(c["nom"])].append(c)

    out, review, doubts = {}, [], []
    for sir in sirens:
        rn = reg_names[sir]
        # contract names come from the DECP under that SIREN: trusted before notice names
        anchor = (contract_names.get(sir) or rn).most_common(1)[0][0]
        st = stats[sir]
        com = commune_by_siren.get(sir)
        doute = None
        # heterogeneous SIREN: registry variants that do not describe the same body
        dissimilar = [v for v in rn if not same_body(v, anchor)]
        hetero = sum(rn[v] for v in dissimilar) >= 0.3 * sum(rn.values()) and len(dissimilar) >= 2 and not com
        dn = decp_names.get(sir, collections.Counter())
        if not com and not hetero:
            # a commune published under another SIREN than the COG's: matched by name within its department
            deps = set((st["dep"] + avis_dep[sir]).keys())
            stem = re.sub(r"^(COMMUNE|VILLE|MAIRIE)( DE| DU| DES| D)? ", "", plain(clean_variant(anchor)))
            hit = [c for c in cog_by_name.get(stem, []) if c["codeDepartement"] in deps]
            if len(hit) == 1 and not dissimilar and (keyword_category(anchor) in (None, "commune")):
                com = hit[0]
                doute = (f"SIREN publié ({sir}) différent de celui de la commune au COG ({com.get('siren')}) : "
                         "rattaché par le nom et le département")
        if com:
            nom = commune_label(com["nom"], com["code"])
            cands = rn + dn
        else:
            if hetero and dn:
                anchor = dn.most_common(1)[0][0]  # DECP names the SIREN's owner
            regs = [v for v in rn if same_body(v, anchor)]
            cands = collections.Counter({v: rn[v] for v in regs})
            top = dn.most_common(1)[0][0] if dn else None
            for v in dn:  # DECP spellings of the same body (an acronym in the notice, spelled out in the DECP)
                if any(same_body(v, r) for r in regs) or (hetero and same_body(v, anchor)):
                    cands[v] = rn.get(v, 0) + dn[v]
            if top and not hetero and not any(any(same_body(v, r) for r in regs) for v in dn):
                doute = (f"Dans les DECP, ce SIREN est publié sous « {clean_variant(top)} » : "
                         "nom repris de l'avis, SIREN à vérifier")
            publie = cands.most_common(1)[0][0] if cands else anchor
            if sir in OVERRIDES:
                nom = OVERRIDES[sir]
            elif hetero and not dn:
                nom = "Acheteurs divers (SIREN partagé)"
            else:
                nom = apply_hyphens(pick_name(cands, publie, acc, proper), hyph)
        nom_publie = cands.most_common(1)[0][0] if cands else anchor
        # category
        if com:
            cat = "commune"
        elif sir in members:
            cat = "metropole" if "METROPOLE" in plain(nom) or "METROPOLE" in plain(anchor) else "intercommunalite"
        elif hetero and not dn:
            cat = "autre"
        else:
            cat = keyword_category(nom) or keyword_category(nom_publie)
            if not cat and decp_cat.get(sir):
                cat = DECP_CAT.get(decp_cat[sir].most_common(1)[0][0])
            if not cat and sir.startswith("1"):
                cat = "etat"  # hypothesis: SIRENs starting with 1 are the State and its national bodies
            cat = CAT_OVERRIDES.get(sir, cat or "autre")
        # territory
        if com:
            dep, siege, communes = com["codeDepartement"], com["code"], [com["code"]]
        elif cat in ("metropole", "intercommunalite") and sir in members:
            mem = members[sir]
            communes = sorted(c["code"] for c in mem)
            dep = collections.Counter(c["codeDepartement"] for c in mem).most_common(1)[0][0]
            siege = decp_siege[sir].most_common(1)[0][0] if decp_siege.get(sir) else None
        else:
            communes = sorted(st["insee"] or avis_insee[sir]) if cat != "departement" else []
            siege = decp_siege[sir].most_common(1)[0][0] if decp_siege.get(sir) else None
            depc = decp_dep.get(sir) or st["dep"] or avis_dep[sir]
            dep = depc.most_common(1)[0][0] if depc else None
        if siege and siege not in commune_by_code:
            siege = None
        entry = {"nom": nom, "nom_publie": nom_publie, "categorie": cat, "dep": dep, "insee_siege": siege,
                 "communes": communes, "n_contrats": st["n"], "montant": round(st["montant"], 2),
                 "entreprises": sorted(st["entreprises"])}
        if hetero:
            doute = ("SIREN partagé par plusieurs acheteurs dans les avis publiés : le nom affiché est celui du "
                     "titulaire du SIREN dans les DECP, pas forcément l'acheteur de chaque avis" if dn else
                     "SIREN partagé par plusieurs acheteurs dans les avis publiés, sans titulaire dans les DECP")
        if doute:
            entry["doute"] = doute
            doubts.append((sir, nom, doute[:40]))
        out[sir] = entry
        review.append({"siren": sir, "nom": nom, "nom_publie": nom_publie, "categorie": cat, "dep": dep,
                       "insee_siege": siege, "n_communes": len(communes), "n_contrats": st["n"],
                       "montant": round(st["montant"], 2), "n_entreprises": len(st["entreprises"]),
                       "doute": doute or "", "variantes_registre": " | ".join(sorted(rn))})

    for sir, e in out.items():
        n = e["nom"]
        if n == n.upper() or n == n.lower():  # a bare acronym with no spelled-out variant
            e["nom"] = f"{n} (sigle publié)"
            print("sigle sans forme développée :", sir, n)

    OUT_JS.write_text("window.ACHETEURS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":"))
                      + ";\n", encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / "acheteurs_revue.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(review[0]))
        w.writeheader()
        w.writerows(review)
    write_city_report(contracts, ev_by_id, out)

    cats = collections.Counter(e["categorie"] for e in out.values())
    print(f"{len(out)} acheteurs ; avis sans SIREN écartés : {avis_no_siren}")
    print(" ".join(f"{k}={v}" for k, v in cats.most_common()))
    print("Doutes :", [(d[0], d[1]) for d in doubts])
    none_m = sum(1 for e in events if e["t"] == "attribution" and e.get("montant") is None)
    print(f"attributions sans montant : {none_m}")


MIXED_PREFIX = [(r"^C\.? ?C\.? ", "Communauté de communes "), (r"^CA ", "Communauté d'agglomération "),
                (r"^CU ", "Communauté urbaine ")]


def fix_mixed(c: str, acc: Accents) -> str:
    """Light touch on a mixed-case published variant: expand a leading CA/CC, restore missing accents
    on ordinary words, lower the small words written with a capital (« Eau De Paris »)."""
    for a, b in MIXED_PREFIX:
        c = re.sub(a, b, c)
    words = c.split(" ")
    out = []
    for i, w in enumerate(words):
        def fix(m):
            t = m.group(0)
            if has_accent(t) or not (t.islower() or (t[:1].isupper() and t[1:].islower())):
                return t
            a = acc.table.get(t.upper())
            if not a or not has_accent(a):
                return t
            return _cap(a) if t[:1].isupper() else a
        w = re.sub(r"[A-Za-z]{3,}", fix, w)
        if i > 0 and w in {"De", "Du", "Des", "Et", "Pour", "Sur", "En", "Au", "Aux", "Par"}:
            w = w.lower()
        out.append(w)
    c = " ".join(out)
    c = re.sub(r"\bCommunauté [Cc]ommunes\b", "Communauté de communes", c)
    for a, b in PHRASES:
        c = re.sub(a, b, c)
    return c[:1].upper() + c[1:]


def lower_proper(c: str, proper: set) -> bool:
    """A variant writing a place name in lower case (« Université d'aix marseille »)."""
    return any(w in proper for w in re.findall(r"(?<![\wÀ-ÿ'’])[a-zà-ÿ]{3,}", c)) or bool(
        re.search(r"[dl]['’][a-zà-ÿ]{3,}", c) and any(w in proper for w in re.findall(r"[dl]['’]([a-zà-ÿ]{3,})", c)))


ADDRESS = re.compile(r"\b\d{5}\b|\b(RUE|AVENUE|BOULEVARD|BD|CEDEX)\b")


def pick_name(cands: collections.Counter, publie: str, acc: Accents, proper: set) -> str:
    """Best published variant: no address or slash, close to the most frequent spelling, not a CA/CC
    abbreviation, earnest mixed case with place names capitalised, accents; then frequency."""
    best, best_key = None, None
    for raw, n in cands.items():
        c = clean_variant(raw)
        if not c or len(c) > 120:
            continue
        mixed = is_mixed(c) and not lower_proper(c, proper)
        key = (not ADDRESS.search(plain(c)) and "/" not in c and "CONSEIL GENERAL" not in plain(c),
               c == clean_variant(publie) or jaccard(c, publie) >= 0.75,
               not re.match(r"^(CA|CC|CU|C\.C|CTRE|EPT)\b", c), mixed, has_accent(c), n, len(c))
        if best_key is None or key > best_key:
            best, best_key = c, key
    if best is None:
        best = clean_variant(publie)
    if best_key and best_key[3]:
        return fix_mixed(best, acc)
    return title_fr(best, acc)


# ---------------------------------------------------------------- Lyon / Paris report

def fmt_eur(x: float) -> str:
    if x >= 1e6:
        return f"{x / 1e6:.2f} M€".replace(".", ",")
    return f"{x / 1e3:.0f} k€"


def city_split(contracts, ev_by_id, out, insee):
    rows = collections.defaultdict(lambda: {"n": 0, "m": 0.0, "hors": 0, "nat": 0, "m_nat": 0.0})
    for a in contracts:
        if a["insee"] != insee:
            continue
        att = [ev_by_id[x] for x in a["events"] if ev_by_id[x]["t"] == "attribution"]
        r = rows[a["acheteur_siren"]]
        r["n"] += 1
        for e in att:
            if e.get("hors_totaux"):
                r["hors"] += 1
            elif e.get("montant") is not None:
                r["m"] += e["montant"]
                if e.get("national"):
                    r["m_nat"] += e["montant"]
            if e.get("national"):
                r["nat"] += 1
    return rows


def write_city_report(contracts, ev_by_id, out):
    def bucket(sir, insee):
        a = out[sir]
        if a["categorie"] == "commune" and a["insee_siege"] == insee:
            return "ville"
        return a["categorie"] if a["categorie"] in ("metropole", "transports") else "autres"

    def agg(rows, insee):
        b = {k: {"n": 0, "m": 0.0, "hors": 0} for k in ("ville", "metropole", "transports", "autres")}
        for sir, r in rows.items():
            k = bucket(sir, insee)
            for f in ("n", "m", "hors"):
                b[k][f] += r[f]
        return b

    def pct(x, t):
        return f"{100 * x / t:.0f} %" if t else "–"

    def by_cat(rows, cat):
        sel = [r for s_, r in rows.items() if out[s_]["categorie"] == cat]
        return sum(r["n"] for r in sel), sum(r["m"] for r in sel)

    L = ["# Qui achète à Lyon et à Paris ? (registre v4, contrats DECP rattachés à la commune)",
         "Montants : somme des attributions publiées ; contrats « hors totaux » (mixtes, centrales, à vérifier) "
         "comptés mais non sommés.", ""]
    rows = city_split(contracts, ev_by_id, out, "69123")
    b = agg(rows, "69123")
    tn, tm = sum(r["n"] for r in rows.values()), sum(r["m"] for r in rows.values())
    th = sum(r["hors"] for r in rows.values())
    L.append(f"## Lyon (69123) : {tn} contrats, {fmt_eur(tm)} sommés ({th} hors totaux)")
    lab = {"ville": "Ville de Lyon (acheteur communal, SIREN 216901231)", "metropole": "Métropole de Lyon",
           "transports": "Transports (Sytral, Sytral Mobilités, SPL Lyonnaise de Mobilités)", "autres": "Autres acheteurs"}
    for k in ("ville", "metropole", "transports", "autres"):
        v = b[k]
        L.append(f"- {lab[k]} : {v['n']} contrats ({pct(v['n'], tn)}), {fmt_eur(v['m'])} ({pct(v['m'], tm)})"
                 + (f", dont {v['hors']} hors totaux" if v["hors"] else ""))
    L.append("- Principaux acheteurs (contrats, montant sommé) :")
    for sir, r in sorted(rows.items(), key=lambda x: (-x[1]["n"], -x[1]["m"]))[:7]:
        L.append(f"  - {out[sir]['nom']} ({out[sir]['categorie']}) : {r['n']}, {fmt_eur(r['m'])}"
                 + (f", {r['hors']} hors totaux" if r["hors"] else ""))
    en, em = by_cat(rows, "etat")
    L.append(f"- Lecture : la Ville passe {pct(b['ville']['n'], tn)} des contrats mais {pct(b['ville']['m'], tm)} "
             f"du montant sommé ; les services de l'État en passent {en} ({pct(en, tn)}) pour {fmt_eur(em)} "
             f"({pct(em, tm)}) ; la Métropole {b['metropole']['n']}. Acheteurs nationaux : "
             f"{sum(r['nat'] for r in rows.values())}.")
    assert len(L) - 3 <= 20, len(L)

    rows = city_split(contracts, ev_by_id, out, "75056")
    b = agg(rows, "75056")
    tn, tm = sum(r["n"] for r in rows.values()), sum(r["m"] for r in rows.values())
    th = sum(r["hors"] for r in rows.values())
    nat, m_nat = sum(r["nat"] for r in rows.values()), sum(r["m_nat"] for r in rows.values())
    top = sorted(rows.items(), key=lambda x: (-x[1]["n"], -x[1]["m"]))[:5]
    L.append("")
    L.append(f"## Paris (75056) : {tn} contrats, {fmt_eur(tm)} sommés ({th} hors totaux)")
    v, t = b["ville"], b["transports"]
    L.append(f"- Ville de Paris : {v['n']} contrats ({pct(v['n'], tn)}), {fmt_eur(v['m'])} ({pct(v['m'], tm)}) ; "
             f"métropole : {b['metropole']['n']} ; transports : {t['n']} contrats, {fmt_eur(t['m'])}")
    v = b["autres"]
    L.append(f"- Autres acheteurs : {v['n']} contrats ({pct(v['n'], tn)}), {fmt_eur(v['m'])} ({pct(v['m'], tm)}), "
             f"dont {v['hors']} hors totaux ; acheteurs nationaux : {nat} contrats, {fmt_eur(m_nat)} sommés")
    L.append("- Principaux : " + " ; ".join(f"{out[s_]['nom']} {r['n']} ({fmt_eur(r['m'])})" for s_, r in top))
    (en, em), (bn, bm), (sn, sm) = by_cat(rows, "etat"), by_cat(rows, "bailleur"), by_cat(rows, "sante")
    L.append(f"- Lecture : État et établissements nationaux {en} contrats ({fmt_eur(em)}), bailleurs {bn} "
             f"({fmt_eur(bm)}), santé {sn} ({fmt_eur(sm)}) ; la Ville reste le premier acheteur en montant.")
    (OUT_DIR / "lyon.md").write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
