"""The national collection (lacarte_collecte, on the server), read by construire from the
derived files brought back to data/registre/collecte/ (`deploy/collecte-sync.sh rapatrier`):

- `avis`: the DILA's notices, for national.py, beside the notices collected from the BOAMP's
  API before it was given up: the archive's record wins by idweb, the API's stays until the
  archive has read it again; an erased idweb (rules/registre_effacements.yaml) is out of both.
- `fusionner`: the DGCL's subsidies and the acts read, as the pilot's events, added to it:
  - a pilot State subsidy (the 69's and the 13's lists) of a year the DGCL has published is
    the DGCL's; the pilot keeps the years after (the year in progress);
  - an act in the pilot (the Rhône's, reviewed, with its zones) stays the pilot's; the
    collection adds the others;
  - a kind of act published in a département (lacarte_collecte.seuil: its threshold
    reached on the reference readings, data/registre/references/) keeps its fields; below,
    or without a measure yet, the act is listed without any field read (`sous_le_seuil`):
    its title, date and official link only;
  - the site names no intermediary: an act's reference is its prefecture's recueil and its
    link the official document; `mention_site` (rules/registre_sources.yaml
    `sources.attrap`) is the one place a mention would be added, empty by Ju's decision.
- `couverture`: the collection's coverage per administration, and the measures, for
  couverture.py.
"""

from __future__ import annotations

import gzip
import json
import re
from pathlib import Path
from typing import Any

import yaml

from lacarte_collecte import arretes
from lacarte_registre import regles

DIR = "collecte"
KINDS = {
    "videoprotection": ("arrete", "videoprotection"),
    "drone": ("arrete_drone", "drone"),
    "cameras_pietons": ("arrete_pietons", "pietons"),
    "vsa": ("arrete_vsa", "vsa"),
}
# The administrations whose code is a département's (a region's code is not one)
DEPARTEMENTAL = ("departement", "outre-mer", "prefecture_de_police")


def _load(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    with gzip.open(path, "rt", encoding="utf-8") as g:
        return [json.loads(line) for line in g if line.strip()]


def present(root: Path) -> bool:
    return (root / DIR / "couverture.json").is_file()


def effaces(rules: Path) -> set[str]:
    conf = yaml.safe_load((rules / "registre_effacements.yaml").read_text("utf-8")) or {}
    return {str(e["idweb"]) for e in conf.get("avis") or []}


def avis(root: Path, old: list[dict[str, Any]], rules: Path) -> list[dict[str, Any]]:
    """The notices for national.py: the API's (`old`), then the archive's over them."""
    gone = effaces(rules)
    by = {n["idweb"]: n for n in old}
    by.update({n["idweb"]: n for n in _load(root / DIR / "avis.jsonl.gz")})
    return [n for k, n in by.items() if k not in gone]


def mesures(root: Path, rules: Path) -> dict[str, Any]:
    """The threshold's measure per « dep-kind » and field (the server's `modele mesurer`, in
    mesures.json); none yet: every field is « non lu »."""
    path = root / DIR / "mesures.json"
    return json.loads(path.read_text("utf-8")) if path.is_file() else {}


def _sources(rules: Path) -> dict[str, Any]:
    return yaml.safe_load((rules / "registre_sources.yaml").read_text("utf-8"))["sources"]


def _admins(rules: Path) -> dict[str, Any]:
    path = rules / "collecte_administrations.yaml"
    return yaml.safe_load(path.read_text("utf-8"))["administrations"]


DOUBLONS = ("ppparis", "pref75")
# the decree's number in its title, « n° » or not, as the text layer spells it (« Arrêté
# 2026-01518 du… » at the prefecture of Paris, « Arrété n°2025-01485autorisant… », « n 2025-
# 00640 », « n02025-00895 »); the Préfecture de police's reader already keys its acts by it
NUMERO = re.compile(r"arr[êeé]t[ée]\s*(?:n\s*[°o0]?\s*)?(\d{4})\s*-\s*(\d{3,6})(?!\d)", re.I)
NUMERO_ACTE = re.compile(r"^(\d{4})-(\d{3,6})$")


def noms_departements(admins: dict[str, Any]) -> re.Pattern[str]:
    """The départements' names (the administrations' rules), longest first, as whole names
    (« Marne » is not « Val-de-Marne »), « Paris » among them."""
    names = sorted(
        {
            a["nom"]: a["code"]
            for a in admins.values()
            if a["genre"] in ("departement", "outre-mer")
        },
        key=len,
        reverse=True,
    )
    alt = "|".join(re.escape(n).replace("\\-", "[-\\s]") for n in names)
    return re.compile(rf"(?<![\w-])({alt})(?![\w-])", re.I)


def departements_vises(
    a: dict[str, Any], pattern: re.Pattern[str], codes: dict[str, str]
) -> list[str]:
    """The départements a drone or algorithm act names in its title, after « aéronefs » or
    « algorithmique » (« à Paris, en Seine-Saint-Denis et dans le Val-de-Marne »: 75, 93, 94),
    in its order; none when it names none."""
    if a["type"] not in ("drone", "vsa"):
        return []
    title = a.get("titre") or ""
    m = re.search(r"a[ée]ronefs|algorithm", title, re.I)
    found = pattern.findall(title[m.end() :] if m else "")
    return list(dict.fromkeys(codes[parse_raa_key(n)] for n in found))


def parse_raa_key(name: str) -> str:
    return re.sub(r"[-\s]+", "-", name.strip().lower())


def numero(a: dict[str, Any], tel_quel: bool = False) -> str | None:
    """The decree's number to match, « 2026-1518 » (the zeros of padding dropped: « 2024-0067 »
    is « 2024-00067 »), or as written, « 2026-01518 » (`tel_quel`); None without one."""
    m = NUMERO_ACTE.match(a.get("acte") or "") if a.get("administration") == "ppparis" else None
    m = m or NUMERO.search(a.get("titre") or "")
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2) if tel_quel else int(m.group(2))}"


def uniques(acts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A decree published by both the Préfecture de police and the prefecture of Paris, once:
    the same kind and the same « n° » in the title; the prefecture of Paris's record (its
    national id) is kept."""
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    out = []
    for a in sorted(acts, key=lambda a: (a.get("administration") != "pref75", a["id"])):
        n = numero(a) if a.get("administration") in DOUBLONS else None
        key = (a["type"], n) if n else None
        if key and key in seen:
            # what the kept record's reading left empty, from the other's (the prefecture of
            # Paris's text layer often loses the zone's article)
            kept = seen[key]
            if a.get("administration") == "ppparis":
                kept["autorite"] = "ppparis"  # the decree is the Préfecture de police's
            mine, theirs = kept.get("champs") or {}, a.get("champs") or {}
            kept["champs"] = {
                **mine,
                **{k: v for k, v in theirs.items() if mine.get(k) in (None, "", [])},
            }
            continue
        if key:
            a = {**a}
            seen[key] = a
        out.append(a)
    return out


# the act sends its zone to a plan or a map annexed, which the registre does not read (« le
# périmètre géographique figurant sur le plan en annexe », « plan joint enannexe », « défini en
# annexe », « cartographie en annexe »): a rule on the zone's sentences (parse_raa.drone)
PLAN_ANNEXE = re.compile(
    r"(?:plans?|cartographies?|cartes?|p[ée]rim[eè]tres?)\b[^.;|]{0,80}?(?:en\s*)?annex"
    r"|annexes?\s*(?:\d+\s*)?(?:cartographique|graphique|plan)",
    re.I,
)


def plan_annexe(a: dict[str, Any]) -> bool:
    return bool(PLAN_ANNEXE.search((a.get("champs") or {}).get("zone_extrait") or ""))


GROUPS = {
    "commune": ("commune",),
    "nombre": ("n_total", "n_interieur", "n_exterieur", "n_voie_publique", "n_cameras_drone"),
    "dates": ("dates",),
    "horaires": ("horaires",),
    "perimetre": ("perimetre",),
}
# the complementary fields (lot R4.2), each its own group, published on its own measure
NOUVEAUX = ("motif", "motif_libelle", "service", "finalites", "lieux", "n_perimetres", "communes",
            "etablissement", "adresse", "conservation_jours", "echeance", "nature")  # fmt: skip


def act_event(
    a: dict[str, Any],
    admin: dict[str, Any],
    published: set[str],
    final: dict[str, Any] | None,
    mention: str | None,
    deps: list[str] | None = None,
) -> regles.Event:
    """The act as an event: the fields of the groups published in its département and kind,
    from the checked reading (rules, model, both, arbitration) else the rules'; the others
    empty, said in `champs_non_lus`."""
    t, disp = KINDS[a["type"]]
    read = {k: v["valeur"] for k, v in ((final or {}).get("champs") or {}).items()}
    origins = {k: v["origine"] for k, v in ((final or {}).get("champs") or {}).items()}
    if final is None:
        r = a.get("champs") or {}
        read = {
            **{k: r.get(k) for k in GROUPS["nombre"]},
            "dates": r.get("dates"),
            "horaires": r.get("horaires"),
            "commune": a.get("commune"),
        }
        origins = {k: "regles" for k, v in read.items() if v not in (None, [])}
    f = {k: read.get(k) for g in published if g in GROUPS for k in GROUPS[g]}
    nv = {k: v for k, v in ((final or {}).get("nouveaux") or {}).items() if k in published}
    insee = (
        ((final or {}).get("insee") if final else a.get("insee"))
        if "commune" in published
        else None
    )
    dep = admin["code"] if admin["genre"] in DEPARTEMENTAL else None
    if insee and len(insee) == 5:
        # the commune's département (a Préfecture de police act in Saint-Denis is the 93's)
        dep = insee[:3] if insee.startswith("97") else insee[:2]
    deps = deps or []
    if deps and dep not in deps:
        # the title names other départements (« dans le département des Hauts-de-Seine »): the
        # commune read is not one of theirs, the act is theirs alone
        insee, dep = None, deps[0]
    days = f.get("dates") or []
    cams = f.get("n_cameras_drone") if a["type"] == "drone" else f.get("n_total")
    e: regles.Event = {
        "id": arretes.safe_id(a["id"]),
        "t": t,
        "sous_type": a.get("sous_type"),
        # a day read only when the dates are published; else its recueil's
        "date": (days[0] if days else None) or a["recueil_date"],
        "insee": insee,
        "dep": dep,
        "affaire": arretes.safe_id(a["id"]),
        "entreprises": [],
        "beneficiaire": regles.MASQUE if t == "arrete" else None,
        "beneficiaire_siren": None,
        "type_beneficiaire": None,
        "cameras": float(cams) if cams is not None else None,
        "cameras_vp": f.get("n_voie_publique"),
        "cameras_int": f.get("n_interieur"),
        "cameras_ext": f.get("n_exterieur"),
        "cameras_lib": None,
        "dossier": None,
        "periode": " au ".join(dict.fromkeys([days[0], days[-1]])) if days else "",
        "horaires": f.get("horaires") or [],
        "duree": "",
        "ref": f"préfecture ({admin['nom']}), {a['recueil_nom']}, acte {a['acte']}",
        "url": a["url"],
        "page": None,
        "relu": False,
        "dispositif": disp,
        "titre": a.get("titre") or "",
        "origine": "collecte",
        "origines": {k: origins[k] for k in f if k in origins and f[k] not in (None, [])},
    }
    if f.get("perimetre"):
        e["perimetre"] = f["perimetre"]
    if a["type"] in ("drone", "vsa") and not f.get("perimetre") and plan_annexe(a):
        e["plan_annexe"] = True
    # what the list and the panel show (lot R4.2): the days, the decree's number and its
    # author; the hours read but not published said as such, never their value
    if days:
        e["jours"] = days
    if n := numero(a, tel_quel=True):
        e["numero"] = n
    e["autorite"] = a.get("autorite") or a.get("administration")
    if "horaires" not in published and read.get("horaires"):
        e["horaires_lus"] = True
    if "motif" in nv or "motif_libelle" in nv:
        e["motif"] = {"categorie": nv.get("motif"), "libelle": nv.get("motif_libelle")}
    for k in ("service", "finalites", "lieux", "n_perimetres", "etablissement", "adresse",
              "conservation_jours", "echeance", "nature"):  # fmt: skip
        if k in nv:
            e[k] = nv[k]
    if e.get("adresse"):
        # an address served only when its street is found in the act's commune (lieux.py)
        from lacarte_registre import lieux

        point = lieux.adresse(e["adresse"], e["insee"]) if e.get("insee") else None
        if point is None:
            e.pop("adresse")
        else:
            e["adresse_point"] = point
    if len(nv.get("communes") or []) > 1:
        e["communes"] = nv["communes"]  # every commune it names (regles.appliquer)
        deps = list(
            dict.fromkeys(
                [*deps, *(k[:3] if k.startswith("97") else k[:2] for k in nv["communes"])]
            )
        )
    if len(deps) > 1:
        # listed in each département it names, counted once in each (regles.appliquer)
        e["departements"] = deps
    if not published:
        e["sous_le_seuil"] = True
    else:
        e["champs_non_lus"] = sorted(set(GROUPS) - published)
    if mention:
        e["mention"] = mention
    return e


def fusionner(p: regles.Pilote, root: Path, rules: Path) -> tuple[regles.Pilote, dict[str, int]]:
    reg = p.reg
    cov = json.loads((root / DIR / "couverture.json").read_text("utf-8"))
    last = (cov.get("dgcl") or {}).get("derniere_annee_publiee") or 0
    from lacarte_collecte import dgcl

    # the département from the commune, for the grants kept before that rule (dgcl.departement)
    subs = [
        {**x, "dep": dgcl.departement(x.get("dep"), x.get("insee"))}
        for x in _load(root / DIR / "subventions_etat.jsonl.gz")
    ]
    acts = _load(root / DIR / "arretes.jsonl.gz")
    finals = {r["id"]: r for r in _load(root / DIR / "champs.jsonl.gz")}
    admins = _admins(rules)
    measured = mesures(root, rules)
    mention = _sources(rules)["attrap"].get("mention_site") or None
    pilot_ids = {e["id"] for e in reg["evenements"]}
    names = noms_departements(admins)
    codes = {
        parse_raa_key(a["nom"]): a["code"]
        for a in admins.values()
        if a["genre"] in ("departement", "outre-mer")
    }

    def replaced(e: regles.Event) -> bool:
        return e["t"] == "subvention_etat" and bool(subs) and int(e["date"][:4]) <= last

    kept = [e for e in reg["evenements"] if not replaced(e)]
    dropped = {e["affaire"] for e in reg["evenements"] if replaced(e)}
    new: list[regles.Event] = list(subs)
    n_pub = 0
    for a in uniques(acts):
        if a["id"] in pilot_ids or a["type"] not in KINDS or a["administration"] not in admins:
            continue
        admin = admins[a["administration"]]
        dep = admin["code"] if admin["genre"] in DEPARTEMENTAL else ""
        groups = measured.get(f"{dep}-{a['type']}") or {}
        published = {
            g for g, v in groups.items() if v.get("publie") and (g in GROUPS or g in NOUVEAUX)
        }
        n_pub += bool(published)
        deps = departements_vises(a, names, codes)
        new.append(act_event(a, admin, published, finals.get(a["id"]), mention, deps))
    affaires = {k: v for k, v in reg["affaires"].items() if k not in dropped}
    for e in new:
        kind = "subvention" if e["t"].startswith("subvention") else "acte"
        title = f"Subvention : {e['beneficiaire']}" if kind == "subvention" else e["ref"]
        affaires[e["affaire"]] = {
            "id": e["affaire"],
            "kind": kind,
            "events": [e["id"]],
            "debut": e["date"],
            "fin": e["date"],
            "insee": e.get("insee"),
            "dep": e.get("dep"),
            "entreprises": [],
            "titre": title,
        }
    out = regles.Pilote(
        reg={**reg, "evenements": [*kept, *new], "affaires": affaires}, globals=p.globals
    )
    return out, {
        "subventions_dgcl": len(subs),
        "subventions_pilote_remplacees": len(reg["evenements"]) - len(kept),
        "arretes": len(new) - len(subs),
        "arretes_publies": n_pub,
    }


def couverture(root: Path, rules: Path) -> dict[str, Any] | None:
    if not present(root):
        return None
    cov = json.loads((root / DIR / "couverture.json").read_text("utf-8"))
    cov["mesures"] = mesures(root, rules)
    return cov
