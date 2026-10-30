"""The registre's counting rules, ported once from the pilot's prototype and nowhere else.

Each document (`evenements[]` of the pilot) gets the flags the pages read:
- `copie`: a contract published twice, not the first member of its « doublon » group (the
  pilot's LOTS / LOTS_GROUPES). Only `nature == "doublon"` makes copies: the one group whose
  nature is « lots et doublons » keeps every member, as the prototype does.
- `compte`: counted in an amount (a territory's, a company's, a buyer's): a signed contract
  (`t == "attribution"`), not out of the totals (`hors_totaux`: a central purchasing body's
  ceiling, a mixed contract, an amount to check), not a national buyer's, not a copy.
- `communal`: the commune's own document: a subsidy; an act whose beneficiary is a commune
  or an intercommunality, or a body-camera act; else its affaire's `acheteur_communal`
  (true when unknown).
- `date_lue`: the date read by a review (rules/registre_corrections.yaml), beside the
  source's own date, which the record keeps.
- `corrige`: what a correction accepted in /revue changed (data/registre/corrections.yaml,
  `lacarte-registre corrections exporter`): {field: {"source": the value as published,
  "le": the day it was accepted}}. Such a correction replaces the value the pages read (a
  date also sets `date_lue`), before every flag and index that depends on it: a commune's
  documents and counts follow a corrected `insee`, a copy its `affaire`, `nom_publie` its
  `beneficiaire`, `non_lu` its `cameras`.
- `partage`: an act naming several communes (zones.js AUTORISATIONS): the other communes.
  The act is placed in each of them as a copy with that commune's `insee` and `insee0`, the
  commune of the original; a territory counts it once (comptes.uniq). An act the registre
  left without a commune whose zones name communes is placed in the first of them.
- `non_lu`: the reasons an act could not be read entirely (non_lus.json), a list of codes:
  `nombre_illisible` (a video-protection act without its number of cameras: counted in the
  acts, not in the cameras), `commune_introuvable` (no commune after placement),
  `zone_non_deduite` (a drone or algorithmic-analysis act with no zone drawn, or only zones
  under review).
- `nom_publie`: false when an act's beneficiary is masked (`[non retenu]`: a natural
  person, or a name not verified in SIRENE); the pilot export masks them, the build keeps
  the mask and refuses a named sole trader.
- `ei` (EI): a sole trader is a natural person and has no page (DECISIONS 2026-10-29): its
  SIREN, which names the person in SIRENE, leaves every document, affaire, correction and
  dictionary for this token, after the corrections, before anything is counted or written;
  the pages say « entreprise individuelle, nom non publié », and no ranking, no « who sells »
  list and no company page counts it.

The pilot lists 242 BOAMP notices twice, identical: a document is kept once (by id); two
different records under one id stop the build.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from lacarte_registre import corrections as fields

Event = dict[str, Any]

AO = ("avis", "resultat", "rectificatif")
DISP = {
    "videoprotection": "vp",
    "csu": "csu",
    "vsa": "vsa",
    "lapi": "lapi",
    "pietons": "pi",
    "cameras_pietons": "pi",
    "videoverbalisation": "vv",
    "drone": "dr",
    "drones": "dr",
}
MASQUE = "[non retenu]"
# A correction without its acceptance day (the rules file's, a review's reading): the flag it
# sets beside the source's value, which stays.
READ_FLAGS = {"date": "date_lue"}


def typ(e: Event) -> str:
    """The registre's five kinds: con, mod, ao, aut, sub."""
    t = e["t"]
    if t == "attribution":
        return "con"
    if t == "modification":
        return "mod"
    if t in AO:
        return "ao"
    if t.startswith("arrete"):
        return "aut"
    if t.startswith("subvention"):
        return "sub"
    return "?"


def disp(e: Event) -> str:
    return DISP.get(e.get("dispositif") or "", "na")


def year_group(d: str | None) -> str:
    y = (d or "")[:4]
    if not y.isdigit():
        return ""
    return "<2018" if int(y) < 2018 else y


def sort_key(e: Event) -> str:
    """A subsidy dated by its year only sorts at the start of its year."""
    return f"{(e.get('date') or '')[:4]}-00-00" if e.get("date_annee") else (e.get("date") or "")


def is_act(e: Event) -> bool:
    return e["t"].startswith("arrete")


def is_camera_act(e: Event) -> bool:
    return e["t"] == "arrete"


def is_drone_act(e: Event) -> bool:
    return e["t"] == "arrete_drone"


@dataclass
class Pilote:
    """The pilot export, as imported (data/registre/pilote/<NAME>.json)."""

    reg: dict[str, Any]
    globals: dict[str, Any]

    def get(self, name: str, default: Any) -> Any:
        return self.globals.get(name, default)


def charger(folder: Path) -> Pilote:
    if not (folder / "pilote.json").is_file():
        raise FileNotFoundError(f"{folder}: no pilote.json (lacarte-registre importer-pilote)")
    found = {}
    for path in folder.glob("*.json"):
        if path.name != "pilote.json":
            found[path.stem] = json.loads(path.read_text(encoding="utf-8"))
    return Pilote(reg=found.pop("REG"), globals=found)


class CorrectionError(ValueError):
    """A correction the build cannot apply: `lacarte-registre construire` stops and says it."""


@dataclass(frozen=True)
class Correction:
    id: str
    evenement: str
    field: str
    value: Any
    le: str | None  # the day accepted in /revue; None: a reading (READ_FLAGS)


def corrections(*paths: Path) -> list[Correction]:
    """The corrections of rules/registre_corrections.yaml then of data/registre/
    corrections.yaml, in their order; each checked (its field, its value)."""
    out = []
    for path in paths:
        for c in yaml.safe_load(path.read_text(encoding="utf-8"))["corrections"] or []:
            if not (c.get("id") and c.get("rationale") and c.get("source")):
                raise CorrectionError(
                    f"{path.name}: a correction needs id, rationale and source: {c}"
                )
            where = f"{path.name}: {c['id']}"
            field = c.get("field")
            if field not in fields.FIELDS:
                raise CorrectionError(f"{where}: unknown field {field!r} (one of {fields.FIELDS})")
            le = c.get("le")
            if le is None and field not in READ_FLAGS:
                raise CorrectionError(f"{where}: no acceptance day (le) for a {field} correction")
            le = le.isoformat() if hasattr(le, "isoformat") else le
            if le is not None and not (isinstance(le, str) and fields.DAY.fullmatch(le)):
                raise CorrectionError(f"{where}: le is a day, YYYY-MM-DD: {le!r}")
            try:
                value = fields.value(field, c.get("value"))
            except ValueError as e:
                raise CorrectionError(f"{where}: {e}") from None
            out.append(Correction(c["id"], str(c.get("evenement")), field, value, le))
    return out


def corriger(reg: Registre, corr: list[Correction]) -> None:
    """Apply the corrections to the documents, in order (a later one on the same field wins;
    `corrige` keeps the value as published). An unknown document, commune or affaire stops
    the build."""
    for c in corr:
        e = reg.by_id.get(c.evenement)
        if e is None:
            raise CorrectionError(f"{c.id}: no document {c.evenement!r} in the register")
        if c.le is None:
            e[READ_FLAGS[c.field]] = c.value
            continue
        record = e.setdefault("corrige", {})
        source = record[c.field]["source"] if c.field in record else e.get(c.field)
        if c.field == "insee":
            if c.value not in reg.communes:
                raise CorrectionError(f"{c.id}: no commune {c.value} in the register's reference")
            e["dep"] = reg.communes[c.value]["dep"]
        elif c.field == "affaire":
            if c.value not in reg.affaires:
                raise CorrectionError(f"{c.id}: no affaire {c.value!r} in the register")
            old = reg.affaires.get(e["affaire"])
            if old and e["id"] in old.get("events", []):
                old["events"] = [i for i in old["events"] if i != e["id"]]
            new = reg.affaires[c.value].setdefault("events", [])
            if e["id"] not in new:
                new.append(e["id"])
        elif c.field == "date":
            e["date_lue"] = c.value
            e.pop("date_annee", None)  # a full day now, no longer a year
        e[c.field] = c.value
        record[c.field] = {"source": source, "le": c.le}


# A sole trader's place in a document's companies: a natural person has no page, and its
# SIREN names it in SIRENE, so it never leaves the build (masquer_ei).
EI = "ei"
EI_DICO = {"nom": None, "entrepreneur_individuel": True}


def masquer_ei(reg: Registre) -> int:
    """Replace every sole trader's SIREN by EI: the documents' and the affaires' companies,
    a correction's source value, any `*_siren` field; the dictionary keeps one EI entry and
    no sole trader's own. Returns how many sole traders were masked."""
    ents = reg.pilote.reg.get("entreprises", {})
    ei = {s for s, x in ents.items() if x.get("entrepreneur_individuel")}
    if not ei:
        return 0

    def mask(v: Any) -> Any:
        return [EI if s in ei else s for s in v] if isinstance(v, list) else v

    for e in reg.evenements:
        if e.get("entreprises"):
            e["entreprises"] = mask(e["entreprises"])
        for k in [k for k in e if k.endswith("_siren")]:
            if e[k] in ei:
                e[k] = None
        corr = (e.get("corrige") or {}).get("entreprises")
        if corr:
            corr["source"] = mask(corr.get("source"))
    for a in reg.affaires.values():
        if a.get("entreprises"):
            a["entreprises"] = mask(a["entreprises"])
    for s in ei:
        del ents[s]
    ents[EI] = dict(EI_DICO)
    return len(ei)


@dataclass
class Registre:
    """The flagged documents and the indexes every page is cut from."""

    pilote: Pilote
    evenements: list[Event]
    by_id: dict[str, Event]
    affaires: dict[str, dict[str, Any]]
    communes: dict[str, dict[str, Any]]
    # a commune's documents: its own and the copies of the acts it shares
    by_insee: dict[str, list[Event]] = field(default_factory=dict)
    by_dep: dict[str, list[Event]] = field(default_factory=dict)
    non_lus: list[Event] = field(default_factory=list)

    def buyer(self, e: Event) -> str | None:
        return e.get("acheteur_siren") or (self.affaires.get(e["affaire"]) or {}).get(
            "acheteur_siren"
        )


def unique_events(events: list[Event]) -> list[Event]:
    seen: dict[str, Event] = {}
    out = []
    for e in events:
        old = seen.get(e["id"])
        if old is None:
            seen[e["id"]] = e
            out.append(e)
        elif old != e:
            raise ValueError(f"two different documents under the id {e['id']}")
    return out


def is_copy(e: Event, lots: dict[str, str], groupes: dict[str, Any]) -> bool:
    g = groupes.get(lots.get(e["affaire"], ""))
    if not g or g.get("nature") != "doublon":
        return False
    first = (g.get("membres") or [{}])[0].get("affaire")
    return first != e["affaire"]


def communal(e: Event, affaires: dict[str, Any]) -> bool:
    if e["t"].startswith("subvention"):
        return True
    if is_act(e):
        return bool(re.match(r"commune|epci", e.get("type_beneficiaire") or "")) or (
            e["t"] == "arrete_pietons"
        )
    v = (affaires.get(e["affaire"]) or {}).get("acheteur_communal")
    return True if v is None else bool(v)


def _shares(reg: Registre, autorisations: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Place the acts left without a commune by their zones; {act id: all its communes} for
    the acts naming several (in the act's order, the original's commune among them)."""
    out = {}
    for a in autorisations:
        e = reg.by_id.get(a["acte"])
        insee = a.get("insee") or []
        if not e or not insee or (len(insee) < 2 and insee[0] == e.get("insee")):
            continue
        named = [k for k in dict.fromkeys(insee) if k in reg.communes]
        if not e.get("insee") and named:
            e["insee"] = named[0]
            e["dep"] = e.get("dep") or reg.communes[named[0]]["dep"]
        if len(named) >= 2:
            out[e["id"]] = named
    return out


def _unread(e: Event, zones_of: dict[str, list[str]], statut: dict[str, str]) -> list[str]:
    why = []
    if is_camera_act(e) and e.get("cameras") is None:
        why.append("nombre_illisible")
    if is_act(e) and not e.get("insee"):
        why.append("commune_introuvable")
    if e["t"] in ("arrete_drone", "arrete_vsa"):
        zs = zones_of.get(e["id"], [])
        if not zs or all(statut.get(z) == "relecture" for z in zs):
            why.append("zone_non_deduite")
    return why


def appliquer(p: Pilote, corr: list[Correction]) -> Registre:
    """Correct, flag every document of the pilot and index them."""
    affaires = p.reg["affaires"]
    events = unique_events(p.reg["evenements"])
    reg = Registre(
        pilote=p,
        evenements=events,
        by_id={e["id"]: e for e in events},
        affaires=affaires,
        communes=p.reg["communes"],
    )
    for siren, x in p.reg.get("entreprises", {}).items():
        if x.get("entrepreneur_individuel") and x.get("nom"):
            raise ValueError(f"the sole trader {siren} is named: the export must mask it")
    # The pilot's own `corrige` (prototype v4: « identifiant de l'acheteur corrigé », a
    # boolean on every BOAMP notice, true on 9) is no page's and would be taken for the
    # record of a correction accepted in /revue.
    for e in events:
        if not isinstance(e.get("corrige"), dict):
            e.pop("corrige", None)
    corriger(reg, corr)
    masquer_ei(reg)
    autorisations = p.get("AUTORISATIONS", [])
    shares = _shares(reg, autorisations)
    lots, groupes = p.get("LOTS", {}), p.get("LOTS_GROUPES", {})
    zones_of = {a["acte"]: a.get("zones") or [] for a in autorisations}
    statut = {z["id"]: z.get("statut") for z in p.get("ZONES", [])}
    for e in events:
        e["copie"] = is_copy(e, lots, groupes)
        e["compte"] = (
            e["t"] == "attribution"
            and not e.get("hors_totaux")
            and not e.get("national")
            and not e["copie"]
        )
        e["communal"] = communal(e, affaires)
        if "beneficiaire" in e:
            e["nom_publie"] = e["beneficiaire"] != MASQUE
        why = _unread(e, zones_of, statut)
        if why:
            e["non_lu"] = why
            reg.non_lus.append(e)
        if e.get("insee"):
            reg.by_insee.setdefault(e["insee"], []).append(e)
        reg.by_dep.setdefault(e.get("dep") or "", []).append(e)
    for act, named in shares.items():
        e = reg.by_id[act]
        for k in named:
            others = [x for x in named if x != k]
            if k == e["insee"]:
                e["partage"] = others
            else:
                copy = {**e, "insee": k, "partage": others, "insee0": e["insee"]}
                reg.by_insee.setdefault(k, []).append(copy)
    return reg
