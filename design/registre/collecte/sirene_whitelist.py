"""Whitelist of beneficiary names: a name is shown only if it is a legal person in SIRENE.

A candidate name read in an act is searched in the API Recherche d'entreprises (≤1 request per
1.1 s, filtered on establishments of the département). It is accepted only when, after
normalisation, it equals the legal name, the acronym, a trade name or a sign of the unit or of
one of its matching establishments, and the unit's legal category is not 1xxx (natural person,
sole trader). The displayed name is then SIRENE's legal name, never the act's spelling.

The search also matches directors and elected officials; that is why a result is never accepted
for coming back, only for an exact name match.

Cache (`data/derived/sirene_noms_cache.csv`): the key is the SHA-256 of the normalised candidate,
so no candidate name is written to disk; only accepted legal persons (SIREN, legal name, legal
category, matched field) are stored in clear.
"""

import csv
import hashlib
import os
import re
import time
import unicodedata

import requests

UA = "SurveillanceWorld-research (+<contact>)"
API = "https://recherche-entreprises.api.gouv.fr/search"
FORMS = {"SA", "SAS", "SASU", "SARL", "EURL", "SNC", "SCI", "SCM", "SCA", "SELARL", "SELAS", "SELAFA", "SEL", "GIE",
         "SEM", "SPL", "SCOP", "SCS", "SC", "EARL", "GAEC", "SOCIETE", "STE", "ETS", "ETABLISSEMENTS", "LA", "LE", "LES", "L"}
FIELDS = ["key", "siren", "raison_sociale", "nom_affiche", "nature_juridique", "champ", "prefixe_seul", "date"]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper()
    toks = re.sub(r"[^A-Z0-9]+", " ", s).split()
    while toks and toks[0] in FORMS:      # « SAS CALAO », « LA SOCIETE … »
        toks.pop(0)
    while toks and (toks[-1] in FORMS or toks[-1].isdigit()):   # « … SAS », agency numbers
        toks.pop()
    return " ".join(toks)


def key(s: str) -> str:
    return hashlib.sha256(norm(s).encode()).hexdigest()


class Whitelist:
    def __init__(self, path, dep):
        self.path, self.dep, self.n_queries, self._total = path, dep, 0, 0
        self.cache = {}
        if os.path.exists(path):
            self.cache = {r["key"]: r for r in csv.DictReader(open(path))}

    def _save(self, row):
        new = not os.path.exists(self.path)
        with open(self.path, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            if new:
                w.writeheader()
            w.writerow(row)
        self.cache[row["key"]] = row

    def lookup(self, candidate: str):
        """(siren, legal name) of the legal person whose name is exactly the candidate, else None."""
        n = norm(candidate)
        if len(n) < 3:
            return None
        k = key(candidate)
        if k in self.cache:
            r = self.cache[k]
            return (r["siren"], r["nom_affiche"] or r["raison_sociale"]) if r["siren"] else None
        for attempt, wait in enumerate((0, 20, 60, 180)):
            time.sleep(wait)
            try:
                js = requests.get(API, params={"q": n, "departement": self.dep, "per_page": 10},
                                  headers={"User-Agent": UA}, timeout=20).json()
                res, self._total = js.get("results", []), js.get("total_results") or 0
                break
            except Exception:
                res = None
            finally:
                self.n_queries += 1
                time.sleep(1.1)
        if res is None:
            # the API is unreachable: stop rather than publish « not found » for names never checked
            raise RuntimeError("API Recherche d'entreprises injoignable : reprendre plus tard (RAA_RESUME=1)")
        prefix = set()   # measured only: legal persons whose legal name merely starts with the candidate
        # a trade name (enseigne) shared by a network (« CREDIT MUTUEL », « U EXPRESS ») names many legal
        # units: it is accepted only if exactly one unit in the département carries it (5th pass, end)
        sign_units = {x["siren"] for x in res for e in [x.get("siege") or {}] + (x.get("matching_etablissements") or [])
                      if any(norm(v or "") == n for v in (e.get("liste_enseignes") or []) + [e.get("nom_commercial")])}
        sign_ok = len(sign_units) == 1 and self._total <= 10
        # an acronym is as weak as a trade name (« CREDIT MUTUEL » is the acronym of many local banks):
        # accepted only when every result was seen
        all_seen = self._total <= 10
        exact_units = {x["siren"] for x in res if not str(x.get("nature_juridique") or "1").startswith("1") and (
            n == norm(x.get("nom_raison_sociale") or "") or (all_seen and n == norm(x.get("sigle") or ""))
            or (sign_ok and x["siren"] in sign_units))}
        for x in res:
            nj = str(x.get("nature_juridique") or "")
            if not nj or nj.startswith("1"):
                continue
            if norm(x.get("nom_raison_sociale") or "").startswith(n + " "):
                prefix.add(x["siren"])
            names = [("raison_sociale", x.get("nom_raison_sociale"))] + ([("sigle", x.get("sigle"))] if all_seen else [])
            if sign_ok:
                for e in [x.get("siege") or {}] + (x.get("matching_etablissements") or []):
                    names += [("enseigne", s) for s in (e.get("liste_enseignes") or [])] + [("nom_commercial", e.get("nom_commercial"))]
            if len(exact_units) != 1:
                continue      # homonyms: two legal units answer to this exact name, no way to tell which
            for champ, v in names:
                if v and norm(v) == n:
                    rs = x.get("nom_raison_sociale") or x.get("nom_complet") or ""
                    self._save({"key": k, "siren": x["siren"], "raison_sociale": rs, "nom_affiche": v, "nature_juridique": nj,
                                "champ": champ, "prefixe_seul": "", "date": time.strftime("%Y-%m-%d")})
                    return x["siren"], v
        self._save({"key": k, "siren": "", "raison_sociale": "", "nom_affiche": "", "nature_juridique": "", "champ": "",
                    "prefixe_seul": "1" if len(prefix) == 1 else "", "date": time.strftime("%Y-%m-%d")})
        return None

    def prefix_only(self, candidate: str) -> bool:
        """True if the candidate is not whitelisted but is the start of exactly one legal name (measured, never shown)."""
        r = self.cache.get(key(candidate))
        return bool(r and not r["siren"] and r.get("prefixe_seul") == "1")
