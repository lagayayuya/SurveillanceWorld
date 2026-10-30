"""Facts computed from the procurement registry, for the v10 prototype.

Usage: python3 -I scripts/faits/faits.py   (from anywhere; paths are relative to this file)

Reads   prototype-v4/registre.js, prototype-v9/acheteurs.js,
        data/derived/seuils/seuils_marches.json (if present, else a provisional list).
Writes  prototype-v10/faits.js, data/derived/faits/faits.md.

1. Facts per company (>= 3 signed contracts): repeated amounts across buyers, clustering under a
   threshold in force at the contract's date, the busiest leading-digit band, offers received.
2. Lots of one tender: same commune, buyer, notification date and holders; each group is classed
   as lots or as one contract published twice (doublon).
3. Fill rate of the number of offers received (pilot), per departement, per year, per commune.
4. Signed contracts without a published holder.

Phrases are French, neutral, without adjectives; no natural person's name is written (sole traders
are never named; objet texts lose any civility + name).
"""

import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from itertools import combinations
from pathlib import Path

M = Path(__file__).resolve().parents[2]
REGISTRE = M / "prototype-v4" / "registre.js"
ACHETEURS_JS = M / "prototype-v9" / "acheteurs.js"
SEUILS_JSON = M / "data" / "derived" / "seuils" / "seuils_marches.json"
OUT_JS = M / "prototype-v10" / "faits.js"
OUT_MD = M / "data" / "derived" / "faits" / "faits.md"

PILOTE = ["75", "69", "13", "77", "78", "91", "92", "93", "94", "95"]
MIN_CONTRATS = 3          # companies with at least this many signed contracts get facts
ECART_REL = 0.001         # 0,1 %: amounts this close are "the same amount"
ECART_JOURS = 31          # date gap reported when at most this many days
SOUS_SEUIL = 0.9          # band [0.9 S, S) under a threshold S
SEUIL_MIN_N, SEUIL_MIN_PART = 3, 0.25
TRANCHE_MIN_N, TRANCHE_MIN_PART = 3, 0.30
OFFRES_MIN = 3
MONTANT_MIN = 1.0         # 0 and 1 € are placeholders, not amounts

# Provisional thresholds (same schema as seuils_marches.json), used until that file exists.
SEUILS_PROVISOIRES = [
    {"nom": "dispense de procédure", "montant_ht": 25000, "portee": "tous marchés",
     "acheteurs": "tous", "debut": None, "fin": "2019-12-31"},
    {"nom": "dispense de procédure", "montant_ht": 40000, "portee": "tous marchés",
     "acheteurs": "tous", "debut": "2020-01-01", "fin": None},
    {"nom": "publicité des MAPA", "montant_ht": 90000, "portee": "tous marchés",
     "acheteurs": "tous", "debut": None, "fin": None},
] + [
    {"nom": "seuil européen", "montant_ht": m, "portee": "fournitures et services",
     "acheteurs": "collectivités territoriales", "debut": d, "fin": f}
    for m, d, f in [(221000, "2018-01-01", "2019-12-31"), (214000, "2020-01-01", "2021-12-31"),
                    (215000, "2022-01-01", "2023-12-31"), (221000, "2024-01-01", "2025-12-31"),
                    (216000, "2026-01-01", "2027-12-31")]
]
TERRITORIALES = {"commune", "intercommunalite", "departement", "region", "metropole"}

# From scripts/sanitize.py (copied, not imported): a civility or a rank followed by a name.
CIVILITY = re.compile(r"(?:M\.|Mme|MME|Mlle|MLLE|Monsieur|MONSIEUR|Madame|MADAME|Mr)\s+(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s*){1,3}")
RANK = re.compile(r"\b((?:adjudant|brigadier)(?:-chef)?|capitaine|lieutenant(?:-colonel)?|commandant|colonel|major"
                  r"|gardien de la paix|chef de service|directeur|directrice|interlocuteur|interlocutrice)\s+"
                  r"(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s+){1,2}", re.I)
LOT = re.compile(r"\blot\s*(?:n\s*[°o]?\s*)?(\d{1,2})\b")


def load_js(path):
    s = path.read_text(encoding="utf-8")
    return json.loads(s[s.index("{"):s.rstrip().rstrip(";").rindex("}") + 1])


def load_seuils():
    if SEUILS_JSON.exists():
        data = json.loads(SEUILS_JSON.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("seuils") or data.get("liste") or []
        data = [dict(s, montant_ht=float(str(s["montant_ht"]).replace(" ", "").replace("\u202f", "").replace(",", ".")))
                for s in data if s.get("montant_ht") not in (None, "")]
        return data, False
    return SEUILS_PROVISOIRES, True


def fold(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def tokens(s):
    f = re.sub(r"\bvideo (protection|surveillance)", r"video\1", fold(s))
    return {w for w in f.split() if len(w) >= 3 and not w.isdigit()}


def lot_suffixes_differ(a, b):
    """'M2021-02' / 'M2021-03', 'MP20251001' / 'MP20251002': same id but its last two digits."""
    return len(a) == len(b) and a[:-2] == b[:-2] and a[-2:] != b[-2:] and a[-2:].isdigit() and b[-2:].isdigit()


def similarity(a, b):
    ta, tb = tokens(a), tokens(b)
    return round(len(ta & tb) / len(ta | tb), 2) if ta and tb else 0.0


def clean_objet(s):
    s = CIVILITY.sub("", s or "")
    return RANK.sub(lambda m: m.group(1) + " ", s).strip()


def eur(x):
    """Whole euros, French grouping with a narrow no-break space."""
    return f"{round(x):,}".replace(",", " ")


def near(a, b):
    return a is not None and b is not None and a > MONTANT_MIN and b > MONTANT_MIN \
        and abs(a - b) / min(a, b) <= ECART_REL


def days(d1, d2):
    return abs((date.fromisoformat(d1) - date.fromisoformat(d2)).days)


def liste_fr(xs):
    xs = list(xs)
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " et " + xs[-1]


class Ctx:
    def __init__(self):
        self.R = load_js(REGISTRE)
        self.A = load_js(ACHETEURS_JS)
        self.seuils, self.provisoire = load_seuils()
        self.att = [e for e in self.R["evenements"] if e["t"] == "attribution"]
        self.aff = self.R["affaires"]
        self.communes = self.R["communes"]

    def buyer(self, e):
        return self.aff[e["affaire"]]["acheteur_siren"]

    def buyer_cat(self, siren):
        return (self.A.get(siren) or {}).get("categorie", "")

    def buyer_name(self, siren):
        a = self.A.get(siren)
        if a:
            return a["nom"]
        return next((af["acheteur"] for af in self.aff.values() if af.get("acheteur_siren") == siren), siren)

    def buyer_label(self, siren):
        """A commune is named by its town ('Yutz'); any other buyer by its proper name."""
        a = self.A.get(siren) or {}
        if a.get("categorie") == "commune":
            c = self.communes.get(a.get("insee_siege", ""))
            if c:
                return c["nom"]
            return re.sub(r"^Commune (de |d['’]|du |des )", "", a["nom"])
        return self.buyer_name(siren)

    def cpv(self, e):
        return e["affaire"].rsplit("_", 1)[-1] if "_" in e["affaire"] else ""

    def seuils_at(self, e):
        """Thresholds in force at the contract's date, for its buyer and its kind of purchase."""
        out = []
        cat, travaux = self.buyer_cat(self.buyer(e)), self.cpv(e).startswith("45")
        for s in self.seuils:
            if not s.get("montant_ht"):
                continue
            if (s.get("debut") and e["date"] < s["debut"]) or (s.get("fin") and e["date"] > s["fin"]):
                continue
            ach = fold(" ".join(s["acheteurs"]) if isinstance(s.get("acheteurs"), list) else s.get("acheteurs"))
            if ("collectiv" in ach or "territor" in ach or "local" in ach) and cat not in TERRITORIALES:
                continue
            if ("etat" in ach.split() or "central" in ach) and "collectiv" not in ach and cat != "etat":
                continue
            por = fold(" ".join(s["portee"]) if isinstance(s.get("portee"), list) else s.get("portee"))
            if "travaux" in por and "fournit" not in por and "service" not in por and not travaux:
                continue
            if ("fournit" in por or "service" in por) and "travaux" not in por and travaux:
                continue
            out.append(s)
        return out


# ---------------------------------------------------------------------------------------------
# 2. Lots of one tender (computed first: company facts say how many contracts appear twice)

def lots(ctx):
    by_key = defaultdict(list)
    for e in ctx.att:
        if e["entreprises"]:
            by_key[(e["insee"], ctx.buyer(e), e["date"])].append(e)
    parent = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    critere = {}
    for evs in by_key.values():
        for e in evs:
            parent.setdefault(e["id"], e["id"])
        for a, b in combinations(evs, 2):
            same = sorted(a["entreprises"]) == sorted(b["entreprises"])
            overlap = set(a["entreprises"]) & set(b["entreprises"])
            if same or (overlap and near(a["montant"], b["montant"])):
                parent[find(a["id"])] = find(b["id"])
                if not same:
                    critere[a["id"]] = critere[b["id"]] = "titulaires en partie communs, même montant"
    comps = defaultdict(list)
    ev_by_id = {e["id"]: e for e in ctx.att}
    for x in parent:
        comps[find(x)].append(ev_by_id[x])
    groups, lot_of = {}, {}
    for members in sorted((v for v in comps.values() if len(v) > 1), key=lambda v: (v[0]["insee"], v[0]["date"])):
        members.sort(key=lambda e: e["affaire"])
        e0 = members[0]
        gid = f"G{e0['insee']}-{e0['date']}-{len([g for g in groups if g.startswith('G' + e0['insee'] + '-' + e0['date'])]) + 1}"
        info = []
        for e in members:
            ident = e["affaire"].rsplit("_", 1)[0]
            id_marche = ident[14:]
            m = LOT.findall(fold(e["objet"]))
            info.append({"affaire": e["affaire"], "evenement": e["id"], "montant": e["montant"],
                         "offres": e.get("offres"), "entreprises": e["entreprises"],
                         "id_marche": id_marche, "base": re.sub(r"(?:00)+$", "", id_marche),
                         "lot": int(m[0]) if m else None, "cpv": ctx.cpv(e),
                         "objet": clean_objet(e["objet"])[:160]})
        # A pair is one contract published twice when nothing marks two lots (lot numbers, a lot
        # suffix in the id) and either the amounts agree within 0.1 % or the ids agree once their
        # trailing "00" are dropped. Checked by hand at Salon-de-Provence (2022, 2023).
        doublons, sims, a_verifier = [], [], False
        for a, b in combinations(info, 2):
            sim = similarity(a["objet"], b["objet"])
            sims.append(sim)
            lots_differ = (a["lot"] is not None and b["lot"] is not None and a["lot"] != b["lot"]) \
                or lot_suffixes_differ(a["id_marche"], b["id_marche"])
            same_base = a["base"] == b["base"]
            if not lots_differ and (near(a["montant"], b["montant"]) or same_base):
                doublons.append([a["affaire"], b["affaire"]])
                if not near(a["montant"], b["montant"]) or (sim < 0.3 and not same_base):
                    a_verifier = True
        # one representative per set of copies (union of doublon pairs), the larger amount kept
        rep = {i["affaire"]: i["affaire"] for i in info}
        for a, b in doublons:
            ra, rb = rep[a], rep[b]
            for k, v in rep.items():
                if v == rb:
                    rep[k] = ra
        kept = defaultdict(float)
        for i in info:
            kept[rep[i["affaire"]]] = max(kept[rep[i["affaire"]]], i["montant"] or 0)
        n_distinct = len(set(rep.values()))
        nature = "lots" if not doublons else ("doublon" if n_distinct == 1 else "lots et doublons")
        groups[gid] = {
            "insee": e0["insee"], "commune": (ctx.communes.get(e0["insee"]) or {}).get("nom", ""),
            "acheteur_siren": ctx.buyer(e0), "acheteur": ctx.buyer_name(ctx.buyer(e0)), "date": e0["date"],
            "entreprises": sorted({s for i in info for s in i["entreprises"]}),
            "critere": next((critere[e["id"]] for e in members if e["id"] in critere), "mêmes titulaires"),
            "nature": nature, "doublon_a_verifier": a_verifier,
            "copies": [sorted(k for k, v in rep.items() if v == r) for r in sorted(set(rep.values()))
                       if sum(1 for v in rep.values() if v == r) > 1],
            "membres": info, "montants": [i["montant"] for i in info],
            "somme": round(sum(i["montant"] or 0 for i in info), 2),
            "somme_sans_doublons": round(sum(kept.values()), 2),
            "similarite_objet_min": min(sims), "similarite_objet_max": max(sims), "doublons": doublons,
        }
        for i in info:
            lot_of[i["affaire"]] = gid
    return lot_of, groups


# ---------------------------------------------------------------------------------------------
# 1. Facts per company

def faits_entreprise(ctx, contrats, doublon_events):
    faits = []
    with_amount = [e for e in contrats if e["montant"] is not None and e["montant"] > MONTANT_MIN]
    n, m = len(contrats), len(with_amount)
    sur = f"sur {m}" if m == n else f"sur {m} au montant publié"
    buyers = sorted({ctx.buyer(e) for e in contrats})
    years = sorted({e["date"][:4] for e in contrats})
    span = years[0] if len(years) == 1 else f"de {years[0]} à {years[-1]}"
    dbl = [e for e in contrats if e["id"] in doublon_events]
    sets = {doublon_events[e["id"]] for e in dbl}
    phrase = f"{n} contrats signés {span}, avec {len(buyers)} acheteurs"
    if dbl:
        k = len(sets)
        phrase += (f" ; {k} {'contrat apparaît' if k == 1 else 'contrats apparaissent'} deux fois ou plus "
                   f"(même acheteur, même date, même titulaire), soit {n - len(dbl) + k} contrats distincts")
    faits.append({"type": "volume", "phrase": phrase,
                  "chiffres": {"contrats": n, "avec_montant": m, "acheteurs": len(buyers),
                               "annees": years, "lignes_en_double": len(dbl), "contrats_en_double": len(sets),
                               "contrats_distincts": n - len(dbl) + len(sets)},
                  "contrats": [e["id"] for e in contrats], "acheteurs": buyers})

    # a. the same amounts with different buyers
    srt = sorted(with_amount, key=lambda e: e["montant"])
    groups, cur = [], []
    for e in srt:
        if cur and (e["montant"] - cur[0]["montant"]) / cur[0]["montant"] > ECART_REL:
            groups.append(cur)
            cur = []
        cur.append(e)
    if cur:
        groups.append(cur)
    for g in groups:
        bs = []
        for e in sorted(g, key=lambda e: e["date"]):
            if ctx.buyer(e) not in bs:
                bs.append(ctx.buyer(e))
        if len(bs) < 2:
            continue
        lo, hi = g[0]["montant"], g[-1]["montant"]
        dates = sorted(e["date"] for e in g)
        gap = days(dates[0], dates[-1])
        labels = [ctx.buyer_label(b) for b in bs]
        communes_only = all(ctx.buyer_cat(b) == "commune" for b in bs)
        montant = f"{eur(lo)} €" if eur(lo) == eur(hi) else f"de {eur(lo)} à {eur(hi)} €"
        terr = all(ctx.buyer_cat(b) in TERRITORIALES for b in bs)
        if len(bs) == 2 and communes_only:
            phrase = f"{montant} à {labels[0]} et à {labels[1]}"
        else:
            qui = "collectivités" if terr else "acheteurs"
            phrase = f"{montant} dans {len(bs)} {qui} ({', '.join(labels)})"
        if gap <= ECART_JOURS:
            if gap == 0:
                phrase += ", le même jour"
            elif len(g) == 2:
                phrase += f", à {gap} jour{'s' if gap > 1 else ''} d'intervalle"
            else:
                phrase += f", en {gap} jour{'s' if gap > 1 else ''}"
        if len(bs) >= 3:
            phrase = "les mêmes montants reviennent : " + phrase
        faits.append({"type": "montants_identiques", "phrase": phrase,
                      "chiffres": {"min": lo, "max": hi, "ecart_relatif_pct": round((hi - lo) / lo * 100, 3),
                                   "contrats": len(g), "acheteurs": len(bs), "ecart_jours": gap,
                                   "communes_seulement": communes_only},
                      "contrats": [e["id"] for e in g], "acheteurs": bs})

    # b. just under a threshold in force at the contract's date
    under = defaultdict(list)
    vals = defaultdict(set)
    for e in with_amount:
        for s in ctx.seuils_at(e):
            if SOUS_SEUIL * s["montant_ht"] <= e["montant"] < s["montant_ht"]:
                under[s["nom"]].append(e)
                vals[s["nom"]].add(s["montant_ht"])
    for nom, evs in under.items():
        if len(evs) >= SEUIL_MIN_N and len(evs) / m >= SEUIL_MIN_PART:
            v = sorted(vals[nom])
            seuil = f"{eur(v[0])} €" if len(v) == 1 else f"de {eur(v[0])} à {eur(v[-1])} € selon l'année"
            phrase = (f"{len(evs)} contrats {sur} dans les 10 % sous le {nom} en vigueur à leur date "
                      f"({seuil})")
            faits.append({"type": "sous_seuil", "phrase": phrase,
                          "chiffres": {"contrats": len(evs), "total": m, "part_pct": round(len(evs) / m * 100),
                                       "seuil": nom, "seuils_ht": v, "seuils_provisoires": ctx.provisoire},
                          "contrats": [e["id"] for e in evs],
                          "acheteurs": sorted({ctx.buyer(e) for e in evs})})

    # the leading-digit band holding the most contracts (90 000-100 000, 200 000-300 000...)
    bands = defaultdict(list)
    for e in with_amount:
        p = 10 ** (len(str(int(e["montant"]))) - 1)
        lo = int(e["montant"] // p) * p
        bands[(lo, lo + p)].append(e)
    if bands:
        (lo, hi), evs = max(bands.items(), key=lambda kv: (len(kv[1]), -kv[0][0]))
        if len(evs) >= TRANCHE_MIN_N and len(evs) / m >= TRANCHE_MIN_PART:
            faits.append({"type": "tranche", "phrase": f"{len(evs)} contrats {sur} entre {eur(lo)} et {eur(hi)} €",
                          "chiffres": {"contrats": len(evs), "total": m, "part_pct": round(len(evs) / m * 100),
                                       "de": lo, "a": hi},
                          "contrats": [e["id"] for e in evs],
                          "acheteurs": sorted({ctx.buyer(e) for e in evs})})

    # c. offers received
    filled = [e for e in contrats if e.get("offres") is not None]
    if len(filled) >= OFFRES_MIN:
        one = [e for e in filled if e["offres"] == 1]
        sans = n - len(filled)
        phrase = f"{len(one)} contrats sur {len(filled)} n'ont reçu qu'une offre"
        if len(one) == 1:
            phrase = f"1 contrat sur {len(filled)} n'a reçu qu'une offre"
        if sans:
            phrase += f" ; pour {sans} contrat{'s' if sans > 1 else ''} sur {n}, le nombre d'offres n'est pas publié"
        faits.append({"type": "offres", "phrase": phrase,
                      "chiffres": {"une_offre": len(one), "renseignes": len(filled), "sans_valeur": sans,
                                   "contrats": n, "repartition": dict(sorted(Counter(e["offres"] for e in filled).items()))},
                      "contrats": [e["id"] for e in one], "acheteurs": sorted({ctx.buyer(e) for e in one})})
    return faits


# ---------------------------------------------------------------------------------------------
# 3. Offers received, 4. contracts without holder

def rate(evs):
    filled = [e for e in evs if e.get("offres") is not None]
    one = sum(1 for e in filled if e["offres"] == 1)
    return {"total": len(evs), "renseignes": len(filled),
            "taux_pct": round(len(filled) / len(evs) * 100, 1) if evs else None,
            "une_offre": one, "une_offre_pct": round(one / len(filled) * 100, 1) if filled else None}


def offres(ctx):
    pil = [e for e in ctx.att if e["dep"] in PILOTE]
    by_dep, by_year = defaultdict(list), defaultdict(list)
    for e in pil:
        by_dep[e["dep"]].append(e)
        by_year[e["date"][:4]].append(e)
    communes = defaultdict(list)
    for e in ctx.att:
        communes[e["insee"]].append(e)
    com = {}
    for insee, evs in sorted(communes.items()):
        f = [e for e in evs if e.get("offres") is not None]
        if f:
            com[insee] = {"filled": len(f), "total": len(evs), "one_offer": sum(1 for e in f if e["offres"] == 1)}
    return {"pilote": {"ensemble": rate(pil), "departements": {d: rate(by_dep[d]) for d in PILOTE},
                       "annees": {y: rate(v) for y, v in sorted(by_year.items())}},
            "communes": com}


def sans_entreprise(ctx):
    def summary(evs):
        per = defaultdict(list)
        for e in evs:
            per[ctx.buyer(e)].append(e)
        return {"contrats": len(evs), "evenements": [e["id"] for e in evs],
                "acheteurs": [{"siren": s, "nom": ctx.buyer_name(s), "contrats": len(v),
                               "montant": round(sum(e["montant"] or 0 for e in v), 2),
                               "evenements": [e["id"] for e in v]}
                              for s, v in sorted(per.items(), key=lambda kv: (-len(kv[1]), kv[0]))]}
    none = [e for e in ctx.att if not e["entreprises"]]
    pil = [e for e in none if e["dep"] in PILOTE]
    lyon = [e for e in none if e["insee"] == "69123"]
    return {"ensemble": len(none), "pilote": summary(pil), "lyon": summary(lyon),
            "pilote_total_contrats": sum(1 for e in ctx.att if e["dep"] in PILOTE),
            "lyon_total_contrats": sum(1 for e in ctx.att if e["insee"] == "69123")}


# ---------------------------------------------------------------------------------------------

def fr(x):
    return str(x).replace(".", ",")


def markdown(ctx, faits, groups, lot_of, off, sans):
    L = ["# Faits calculés sur le registre des marchés", "",
         f"Source : `prototype-v4/registre.js` ({ctx.R['meta']['construit']}), {len(ctx.att)} contrats signés. "
         + ("Seuils **provisoires** (liste de travail, `seuils_marches.json` absent)." if ctx.provisoire
            else "Seuils lus dans `data/derived/seuils/seuils_marches.json`."), ""]
    for siren, nom in [("899832901", "Alphaiota"), ("431903954", "Serfim T.I.C."), ("434085395", "Spie CityNetworks")]:
        L.append(f"## {nom} ({siren})")
        for f in faits.get(siren, []):
            L.append(f"- {f['phrase']}.")
        L.append("")
    L.append("Le « 90 000–100 000 € » d'Alphaiota est une tranche de montants, pas un seuil : aucun seuil "
             "de la liste ne vaut 100 000 € ; 2 contrats seulement sont dans [81 000, 90 000), sous la publicité des MAPA.")
    L.append("")
    L.append("## Salon-de-Provence (13103) : contrats signés le même jour")
    salon = [g for g in groups.values() if g["insee"] == "13103"]
    for g in salon:
        ids = ", ".join(f"`{i['id_marche']}` ({eur(i['montant'])} €, offres : "
                        f"{i['offres'] if i['offres'] is not None else 'non publié'})" for i in g["membres"])
        L.append(f"- {g['date']}, {g['critere']} : {ids} ; part de mots communs dans l'objet "
                 f"{fr(g['similarite_objet_min'])} ; nature : **{g['nature']}**.")
    if [g["nature"] for g in salon] == ["doublon", "doublon"]:
        L.append("- Lecture (vérifiée à la main le 2026-10-25) : même numéro de marché (`22007MF`, `23014MF`) suivi "
                 "de `00` ou de `0000` ; même montant, même objet (à une coquille ou un code près) : chaque fois le "
                 "même contrat publié deux fois, pas deux lots. Le second exemplaire de 2023 ajoute BBTP comme "
                 "cotitulaire et change de code CPV.")
    nat = Counter(g["nature"] for g in groups.values())
    n_dbl = sum(len(c) for g in groups.values() for c in g["copies"])
    a_verif = sum(1 for g in groups.values() if g["doublon_a_verifier"])
    L.append(f"- Ensemble du registre : {len(groups)} groupes ({nat.get('lots', 0)} de lots, "
             f"{nat.get('doublon', 0)} doublons, {nat.get('lots et doublons', 0)} mêlant lots et doublons) ; {n_dbl} lignes sont "
             f"des copies d'un même contrat ; {a_verif} doublons à vérifier (montants qui diffèrent ou objets peu semblables).")
    L.append("")
    e = off["pilote"]["ensemble"]
    L.append("## Nombre d'offres reçues (pilote : 75, 69, 13, 77, 78, 91, 92, 93, 94, 95)")
    L.append(f"- Renseigné pour {e['renseignes']} contrats sur {e['total']} ({fr(e['taux_pct'])} %) ; "
             f"une seule offre : {e['une_offre']} sur {e['renseignes']} ({fr(e['une_offre_pct'])} %).")
    L.append("- Par département : " + " ; ".join(
        f"{d} {v['renseignes']}/{v['total']} ({fr(v['taux_pct'])} %, une offre : {v['une_offre']})"
        for d, v in off["pilote"]["departements"].items()) + ".")
    L.append("- Par année : " + " ; ".join(
        f"{y} {v['renseignes']}/{v['total']}" for y, v in off["pilote"]["annees"].items()) + ".")
    L.append("")
    L.append("## Contrats signés sans entreprise publiée")
    for key, label, tot in [("pilote", "Pilote", sans["pilote_total_contrats"]),
                            ("lyon", "Lyon (69123)", sans["lyon_total_contrats"])]:
        s = sans[key]
        L.append(f"- {label} : {s['contrats']} contrats sur {tot} ; acheteurs : " + ", ".join(
            f"{a['nom']} ({a['contrats']})" for a in s["acheteurs"]) + ".")
    return "\n".join(L) + "\n"


def main():
    ctx = Ctx()
    lot_of, groups = lots(ctx)
    ev_of = {i["affaire"]: i["evenement"] for g in groups.values() for i in g["membres"]}
    doublon_events = {ev_of[a]: f"{gid}/{n}" for gid, g in groups.items()
                      for n, copies in enumerate(g["copies"]) for a in copies}
    by_company = defaultdict(list)
    for e in ctx.att:
        for s in e["entreprises"]:
            by_company[s].append(e)
    faits = {s: faits_entreprise(ctx, sorted(evs, key=lambda e: e["date"]), doublon_events)
             for s, evs in sorted(by_company.items()) if len(evs) >= MIN_CONTRATS}
    off = offres(ctx)
    sans = sans_entreprise(ctx)
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    dump = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    OUT_JS.write_text(
        f"// Generated by scripts/faits/faits.py from registre.js ({ctx.R['meta']['construit']}); "
        f"thresholds {'PROVISIONAL' if ctx.provisoire else 'from seuils_marches.json'}.\n"
        f"window.FAITS = {dump(faits)};\n"
        f"window.FAITS_META = {dump({'seuils_provisoires': ctx.provisoire, 'seuils': ctx.seuils})};\n"
        f"window.LOTS = {dump(lot_of)};\n"
        f"window.LOTS_GROUPES = {dump(groups)};\n"
        f"window.OFFRES = {dump(off)};\n"
        f"window.SANS_ENTREPRISE = {dump(sans)};\n", encoding="utf-8")
    OUT_MD.write_text(markdown(ctx, faits, groups, lot_of, off, sans), encoding="utf-8")
    print(f"{len(faits)} companies, {len(groups)} groups, thresholds provisional={ctx.provisoire}")


if __name__ == "__main__":
    main()
