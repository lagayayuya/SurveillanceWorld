"""Link BOAMP notices (pilot departments) to DECP contracts.

Usage: python -I boamp_link.py <derived dir>

Key, in order: buyer SIREN (from a Luhn-valid SIRET in the notice, else from a buyer name
already seen in DECP), then the DECP notification date within [notice - 30 d, notice + 18 months],
then the objet word overlap. Writes boamp/liens_boamp_decp.csv.
"""

import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd

d = Path(sys.argv[1])
b = pd.read_parquet(d / "boamp/boamp_avis.parquet")
m = pd.read_parquet(d / "decp/marches_classes.parquet")
b = b[b["objet_video"] & b["nature"].isin(["Avis de marché", "Résultat de marché"])].copy()
b["date"] = pd.to_datetime(b["dateparution"])
m["date"] = pd.to_datetime(m["date_notification"], errors="coerce")


def norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"\b(commune|ville|mairie|de|d|du|la|le|les|l)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


STOP = set("de la le les des du et en a au aux pour sur dans un une d l lot n no marche marches accord cadre".split())


def words(s) -> set:
    return {w for w in norm(s).split() if len(w) > 2 and w not in STOP}


name_to_siren = (
    m.assign(k=m["acheteur_nom"].map(norm)).groupby("k")["siren"].agg(lambda s: s.value_counts().index[0]).to_dict()
)
by_name = b["acheteur"].map(norm).map(name_to_siren)


def pick(sirets: str, named: str | None):
    """eForms notices list several organisations (buyer, review body, mediator): the buyer's
    SIRET is the one whose SIREN matches the named buyer, else the first one."""
    sirens = [x[:9] for x in sirets.split(";") if x]
    if not sirens:
        return None
    return named if named in sirens else sirens[0]


b["siren"] = [pick(s, n) for s, n in zip(b["sirets"], by_name)]
b["siren_source"] = b["siren"].notna().map({True: "SIRET de l'avis", False: None})
b.loc[b["siren"].isna(), "siren_source"] = by_name[b["siren"].isna()].notna().map({True: "nom de l'acheteur", False: None})
b["siren"] = b["siren"].fillna(by_name)

# A notice may carry another buyer's SIRET (Gonesse's notices carry an establishment of
# Garges-lès-Gonesse, checked in SIRENE, with « AGIT_POUR_AUTRE_COMPTE_NON »: not a joint
# purchase). When the SIRET's commune is not the one the notice names and the name gives a
# SIREN of its own, the name wins and the correction is logged.
commune_of = m.groupby("siren")["acheteur_commune_nom"].first().map(norm).to_dict()
fix = (b["siren_source"] == "SIRET de l'avis") & by_name.notna() & (by_name != b["siren"])
fix &= pd.Series([bool(commune_of.get(s)) and commune_of.get(s) not in norm(a) for s, a in zip(b["siren"], b["acheteur"])], index=b.index)
corr = b.loc[fix, ["idweb", "acheteur", "sirets"]].assign(siren_declare=b.loc[fix, "siren"], siren_retenu=by_name[fix],
                                                        raison="SIRET d'une autre commune que celle nommée dans l'avis")
corr.to_csv(d / "boamp/corrections.csv", index=False)
b.loc[fix, "siren"] = by_name[fix]
b.loc[fix, "siren_source"] = "nom de l'acheteur (SIRET corrigé)"

links = []
for r in b.itertuples():
    if pd.isna(r.siren):
        continue
    c = m[(m["siren"] == r.siren) & m["date"].between(r.date - pd.Timedelta(days=30), r.date + pd.Timedelta(days=548))]
    if r.nature == "Résultat de marché":  # an award notice comes after the notification
        c = m[(m["siren"] == r.siren) & m["date"].between(r.date - pd.Timedelta(days=270), r.date + pd.Timedelta(days=30))]
    wb = words(r.objet)
    for x in c.itertuples():
        wx = words(x.objet)
        j = len(wb & wx) / max(1, len(wb | wx))
        links.append({"idweb": r.idweb, "nature": r.nature, "date_avis": r.date.date(), "siren": r.siren,
                      "siren_source": r.siren_source, "uid": x.uid, "date_decp": x.date.date(),
                      "jaccard": round(j, 2), "objet_boamp": r.objet, "objet_decp": x.objet})
L = pd.DataFrame(links)
L = L[L["jaccard"] >= 0.2].sort_values("jaccard", ascending=False)
L["rang"] = L.groupby("idweb").cumcount() + 1
L.to_csv(d / "boamp/liens_boamp_decp.csv", index=False)

pil = b[b["departements"].str.contains(r"\b(75|69|13)\b")]
print("avis vidéo (avis + résultats):", len(b), "| SIREN trouvé:", b["siren"].notna().sum(),
      b["siren_source"].value_counts().to_dict())
print("avis reliés à ≥1 marché DECP:", L["idweb"].nunique(), "sur", len(b))
print(L.groupby("nature")["idweb"].nunique())
print("par année de l'avis:", b.assign(y=b.date.dt.year, ok=b.idweb.isin(L.idweb)).groupby("y")["ok"].agg(["size", "sum"]).T.to_string())
