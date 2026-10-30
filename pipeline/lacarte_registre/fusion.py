"""The registre's two origins, merged before any rule: the national public procurement
(national.py: DECP, BOAMP, SIRENE, the communes of France) and the pilot's export (importer.py),
which still brings the prefectoral acts, the drone zones and the subsidies (and the pilot's
own reading of its contracts until the national collection runs).

The rule (DECISIONS 2026-10-30), per document id:
- a contract, a modification or a notice in both: the national one, whole (the newer source,
  its own flags); the pilot's copy is dropped;
- one in the pilot only (a contract found by its holder's SIREN, a notice outside the national
  search): kept, `origine: "pilote"`;
- an affaire: the national one when it exists, its documents recounted from the documents
  kept (a pilot notice whose contract is now national joins it); an affaire left without a
  document is dropped;
- companies: SIRENE's (national) record when it was checked there, else the pilot's; a sole
  trader by either stays one; buyers: the pilot's record (named and classed by hand) first,
  the national one for the others; communes: France's reference, the pilot's own entries
  for a code it does not know; lots: the pilot's groups, then the national groups of the
  affaires no pilot group holds.
Nothing else of the pilot changes (acts, zones, subsidies, maps, labels).
"""

from __future__ import annotations

from typing import Any

from lacarte_registre.regles import Pilote

NATIONAL_KINDS = frozenset({"attribution", "modification", "avis", "resultat", "rectificatif"})


def fusionner(p: Pilote, nat: dict[str, Any]) -> tuple[Pilote, dict[str, int]]:
    reg = p.reg
    national = {e["id"]: e for e in nat["evenements"]}
    kept, replaced, pilot_only = [], 0, 0
    for e in reg["evenements"]:
        if e["id"] in national:
            replaced += 1
            continue
        if e["t"] in NATIONAL_KINDS:
            pilot_only += 1
            e = {**e, "origine": "pilote"}
        kept.append(e)
    events = [*nat["evenements"], *kept]
    affaires: dict[str, dict[str, Any]] = {}
    for aid, a in reg["affaires"].items():
        affaires[aid] = {**a, "events": []}
    for aid, a in nat["affaires"].items():
        old = affaires.get(aid) or {}
        # a pilot-only link (a subsidy's contract « probable ») survives the national record
        extra = {k: v for k, v in old.items() if k in ("subventions_probables",)}
        affaires[aid] = {**a, **extra, "events": []}
    for e in events:
        if e["affaire"] in affaires:
            affaires[e["affaire"]]["events"].append(e["id"])
    order = {e["id"]: (e.get("date") or "") for e in events}
    for a in affaires.values():
        a["events"].sort(key=lambda i: order[i])
    affaires = {k: a for k, a in affaires.items() if a["events"]}
    # a probable link to an affaire that is gone is dropped with it
    for a in affaires.values():
        if a.get("contrat_probable") not in (None, *affaires):
            a.pop("contrat_probable", None)
            a.pop("lien_probable", None)
        if a.get("avis_probables"):
            a["avis_probables"] = [x for x in a["avis_probables"] if x in affaires]

    ents = dict(reg.get("entreprises", {}))
    for s, x in nat["entreprises"].items():
        old = ents.get(s)
        if old is None or x.get("verifie_sirene"):
            ei = x.get("entrepreneur_individuel") or bool(
                old and old.get("entrepreneur_individuel")
            )
            ents[s] = {**(old or {}), **x, "entrepreneur_individuel": ei}
            if ei:
                ents[s]["nom"] = None
    communes = {**reg.get("communes", {}), **nat["communes"]}
    for k, c in reg.get("communes", {}).items():
        # the pilot's population and intercommunality where France's reference has none
        communes[k] = {**c, **{kk: v for kk, v in nat["communes"].get(k, {}).items() if v}}
    g = dict(p.globals)
    g["ACHETEURS"] = {**nat["ACHETEURS"], **p.get("ACHETEURS", {})}
    g["EPCIS"] = {**nat["EPCIS"], **p.get("EPCIS", {})}
    deps = {k: dict(v) for k, v in nat["DEP"].items()}
    for k, v in p.get("DEP", {}).items():
        deps[k] = {**deps.get(k, {}), **v}
    g["DEP"] = deps
    lots = dict(p.get("LOTS", {}))
    groupes = dict(p.get("LOTS_GROUPES", {}))
    for gid, grp in nat["LOTS_GROUPES"].items():
        members = [m["affaire"] for m in grp["membres"]]
        if gid in groupes or any(m in lots for m in members):
            continue
        groupes[gid] = grp
        lots.update(dict.fromkeys(members, gid))
    g["LOTS"], g["LOTS_GROUPES"] = lots, groupes
    merged = Pilote(
        reg={**reg, "evenements": events, "affaires": affaires, "entreprises": ents,
             "communes": communes},
        globals=g,
    )  # fmt: skip
    stats = {
        "nationaux": len(national),
        "remplaces": replaced,
        "pilote_seul": pilot_only,
        "affaires": len(affaires),
    }
    return merged, stats
