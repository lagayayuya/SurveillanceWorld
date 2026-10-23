"""Stage 2: dirty OSM tags -> normalised cameras and capabilities with a certainty level.

Priority for every capability: catalogue model (identified) > OSM tag (estimated) >
rule from rules/defaults.yaml (default). The catalogue is empty in v1.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from functools import cache
from pathlib import Path

import geopandas as gpd
import pandas as pd
import yaml

from lacarte import optics, regions
from lacarte.osmtags import (  # noqa: F401 (re-exported: normalize.parse_height...)
    CARDINALS,
    DEFAULT,
    ESTIMATED,
    IDENTIFIED,
    _values,
    classify_kind,
    dome_count,
    parse_direction,
    parse_height,
    parse_tilt,
)

CERTAINTY_RANK = {DEFAULT: 0, ESTIMATED: 1, IDENTIFIED: 2}

NON_CAMERA_TYPES = {"guard", "gunshot_detector", "sensor", "radar", "microphone"}


@cache
def _rules(name: str) -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / f"{name}.yaml").read_text())


def rules(name: str) -> dict:
    """A rules/<name>.yaml file."""
    return _rules(name)


# --- parsers -------------------------------------------------------------------------


def parse_date(value: str | None) -> date | None:
    """ISO date, possibly partial (YYYY or YYYY-MM)."""
    if not value:
        return None
    m = re.match(r"\s*(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?", value)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2) or 1), int(m.group(3) or 1)
    try:
        return date(y, mo, d)
    except ValueError:
        return None


# --- classification --------------------------------------------------------------------


def is_camera(tags: dict) -> bool:
    types = _values(tags.get("surveillance:type"))
    if not types:
        return True
    return not types <= NON_CAMERA_TYPES


def mount_group(tags: dict) -> str:
    raw = (tags.get("camera:mount") or "").strip().lower()
    if not raw:
        return "unknown"
    raw = raw.split(";")[0].strip()
    for group, values in _rules("mounts")["groups"].items():
        if raw in values:
            return group
    return "other"


# Typographic apostrophes and accents written alone: no ASCII form, they would glue the
# words around them ("d’Annecy" -> "dannecy").
APOSTROPHES = re.compile("[‘’ʼ´`]")


def name_key(name: str) -> str:
    """Operator spelling key: lower case, no accents, punctuation as single spaces."""
    name = APOSTROPHES.sub(" ", name)
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_name).strip()


@dataclass(frozen=True)
class Places:
    """Official names by spelling key (name_key), for the generic operator names
    (rules/operators.yaml `generic`): communes and départements; a key two official names
    share is left out (it names neither)."""

    communes: dict[str, str]
    departements: dict[str, str]

    @classmethod
    def of(cls, communes, departements) -> Places:
        return cls(_by_key(communes), _by_key(departements))


def _by_key(names) -> dict[str, str]:
    seen: dict[str, set[str]] = {}
    for n in names:
        if isinstance(n, str) and n.strip():
            seen.setdefault(name_key(n), set()).add(n)
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


# French articles after a prefix ("Mairie du Pecq"): the article, and what the place's
# own name starts with instead ("Le Pecq").
ARTICLES = (("de ", ""), ("d ", ""), ("du ", "le "), ("des ", "les "))


def after_prefix(key: str, prefixes) -> list[str]:
    """The place a spelling key may name after one of `prefixes`, as written and with its
    article made the place's own: "mairie du pecq" -> ["du pecq", "le pecq"]."""
    out = []
    for pre in prefixes:
        if key.startswith(pre + " "):
            rest = key[len(pre) + 1 :]
            out.append(rest)
            out.extend(alt + rest[len(art) :] for art, alt in ARTICLES if rest.startswith(art))
    return out


def of_place(place: str) -> str:
    """ "de Montrouge", "d'Asnières-sur-Seine", "du Pecq", "des Lilas"."""
    if place.startswith("Le "):
        return f"du {place[3:]}"
    if place.startswith("Les "):
        return f"des {place[4:]}"
    if place[:1].upper() in "AEIOUYÉÈÊÎÏÔÂ":
        return f"d'{place}"
    return f"de {place}"


@cache
def _operator_table() -> dict[str, dict]:
    return {m: entry for entry in _rules("operators")["names"] for m in entry["match"]}


SEVERAL = re.compile(r";|/|\bou\b", re.IGNORECASE)  # "Ville de Bron ou Sytral"


def normalized_operator(
    name: str | None, places: Places | None = None
) -> tuple[str | None, str | None]:
    """-> (normalised name, class from rules/operators.yaml) or (trimmed raw name, None).
    The `names` table first, then the `generic` patterns; those that name a commune or a
    département need `places` (without, they leave the name as it is)."""
    if not name or not name.strip():
        return None, None
    raw = re.sub(r"\s+", " ", name.strip())
    table = _operator_table()
    entry = table.get(name_key(raw))
    bare = re.sub(r"\s+", " ", re.sub(r"\([^)]*\)", " ", raw)).strip()
    if entry is None and bare:
        entry = table.get(name_key(bare))
    if entry is not None:
        return entry["name"], entry["class"]
    if bare and not SEVERAL.search(bare):
        generic = generic_operator(bare, places)
        if generic is not None:
            return generic, "public"
    return raw, None


def generic_operator(name: str, places: Places | None) -> str | None:
    """The normalised name rules/operators.yaml `generic` gives `name` (one operator, no
    remark in brackets), or None."""
    rules = _rules("operators")
    m, g = rules["municipal"], rules["generic"]
    key = name_key(name.replace("&", " et "))
    if key in m["generic"]:
        return "Ville (sans précision)"
    if key in m["police"]:
        return "Police municipale (sans précision)"
    if places is not None:
        for prefixes, label in ((m["police"], "Police municipale"), (m["prefixes"], "Ville")):
            for rest in after_prefix(key, prefixes):
                if rest in places.communes:
                    return f"{label} {of_place(places.communes[rest])}"
        for pre in g["departement"]:
            if not key.startswith(pre + " "):
                continue
            rest = key[len(pre) + 1 :]
            art = next((a for a in DEP_ARTICLES if rest.startswith(a)), "")
            dep = places.departements.get(rest[len(art) :])
            if dep is not None:
                return f"Département {DEP_ARTICLES[art] + dep if art else of_place(dep)}"
    if any(key.startswith(p + " ") for p in g["region"]):
        return name
    if re.search(rf"\b({'|'.join(g['metropole'])})\b", key):
        return name
    return None


# A département's article as written (key form -> French), longest first.
DEP_ARTICLES = {"de la ": "de la ", "de l ": "de l'", "du ": "du ", "des ": "des ", "de ": "de ",
                "d ": "d'"}  # fmt: skip


def operator_class(tags: dict, kind: str, places: Places | None = None) -> tuple[str, str]:
    """-> (public | private_outdoor | private_indoor | unknown, certainty)."""
    rules = _rules("operators")
    otype = (tags.get("operator:type") or "").strip().lower()
    name = (tags.get("operator") or "").strip().lower()
    surv = _values(tags.get("surveillance"))
    if otype in rules["operator_type"]["public"]:
        return "public", ESTIMATED
    if otype in rules["operator_type"]["private"]:
        return ("private_indoor" if "indoor" in surv else "private_outdoor"), ESTIMATED
    # A known operator: its class from the normalisation table.
    _, table_class = normalized_operator(tags.get("operator"), places)
    if table_class == "public":
        return "public", ESTIMATED
    if table_class == "private":
        return ("private_indoor" if "indoor" in surv else "private_outdoor"), ESTIMATED
    if name and any(re.search(p, name) for p in rules["public_operator_patterns"]):
        return "public", ESTIMATED
    if "indoor" in surv:
        return "private_indoor", ESTIMATED
    if kind == "doorbell":
        return "private_outdoor", ESTIMATED
    if otype in rules["operator_type"]["private"] or (name and "public" not in surv):
        return "private_outdoor", ESTIMATED
    if "outdoor" in surv:
        return "private_outdoor", ESTIMATED
    if "public" in surv:
        return "public", ESTIMATED
    return "unknown", DEFAULT


def values(v: str | None) -> set[str]:
    """The values of a multi-valued tag ("a;b"), lower case."""
    return _values(v)


def tagged_capabilities(tags: dict, kind: str) -> dict[str, bool]:
    """What the tags say the camera can do (rules/capabilities.yaml)."""
    features = {
        p.strip().lower() for p in re.split(r"[;,]", tags.get("camera:features") or "") if p.strip()
    }
    rules = _rules("capabilities")["features"]
    has = {name: bool(features & set(tokens)) for name, tokens in rules.items()}
    return {
        "plate_reading": kind == "alpr" or has["plate_reading"],
        "ptz": kind == "ptz" or has["zoom"],
        "night_vision_tag": has["night_vision"],
        "analytics": has["analytics"],
    }


# --- capabilities ----------------------------------------------------------------------


@dataclass(frozen=True)
class Overrides:
    """What validated contributions say about a camera (phase D2, the `apply` stage), each
    at certainty estimated, source contribution: its kind, its direction, and who operates
    it — (class, normalised name or None, keep the OSM name): the class public |
    private_outdoor | private_indoor | unknown; the OSM name is kept when the answer gave
    none and agrees with the class the tags give. Phase D3: its height (metres) and tilt
    (degrees below the horizon), from the classes of rules/questions.yaml. A multi-dome's
    number of domes, when its shape answer gave one (rules/questions.yaml dome_count)."""

    kind: str | None = None
    directions: list[float] | None = None
    operator: tuple[str, str | None, bool] | None = None
    height_m: float | None = None
    tilt_deg: float | None = None
    dome_count: int | None = None


@dataclass(frozen=True)
class Capability:
    name: str
    value: object
    certainty: str
    source: str


def capabilities(
    tags: dict,
    kind: str,
    kind_cert: str,
    mount: str,
    directions: list[float] | None = None,
    height_m: float | None = None,
    tilt_deg: float | None = None,
) -> list[Capability]:
    d = _rules("defaults")
    ver = d["version"]
    k, m = d["kinds"][kind], d["mounts"][mount]
    rule = f"rule:defaults@{ver}"
    caps = []

    if directions:  # a validated contribution (phase D2)
        caps.append(Capability("direction", directions, ESTIMATED, "contribution"))
    elif parsed := parse_direction(tags.get("camera:direction") or tags.get("direction"))[0]:
        caps.append(Capability("direction", parsed, ESTIMATED, "osm:camera:direction"))
    else:
        caps.append(Capability("direction", None, DEFAULT, f"{rule}:full_circle"))

    # Optics: distributions per type from the catalogue (rules/optics.yaml); no OSM tag gives
    # them. Stored as the span of the type's samples; the field questionnaire or an
    # identified model will narrow them.
    orule = f"rule:optics@{optics.rules()['version']}:distributions.{optics.optics_kind(kind)}"
    smp = optics.samples(kind)
    res = [r for r, _, _ in smp]
    fov = [f for _, f, _ in smp]
    caps.append(Capability("resolution_px", [min(res), max(res)], DEFAULT, orule))
    caps.append(Capability("hfov_deg", [min(fov), max(fov)], DEFAULT, orule))
    caps.append(Capability("range_m", max_reach(kind), DEFAULT, orule))
    tilt = parse_tilt(tags.get("camera:angle"))
    if tilt_deg is not None:  # a validated contribution (phase D3)
        caps.append(Capability("tilt_deg", tilt_deg, ESTIMATED, "contribution"))
    elif tilt is not None:
        caps.append(Capability("tilt_deg", tilt, ESTIMATED, "osm:camera:angle"))

    height = parse_height(tags.get("height"))
    if height_m is not None:  # a validated contribution (phase D3)
        caps.append(Capability("height_m", height_m, ESTIMATED, "contribution"))
    elif height is not None:
        caps.append(Capability("height_m", height, ESTIMATED, "osm:height"))
    else:
        caps.append(Capability("height_m", m["height_m"], DEFAULT, f"{rule}:mounts.{mount}"))

    caps.append(Capability("night_vision", k["night_vision"], DEFAULT, f"{rule}:kinds.{kind}"))
    if kind == "alpr":
        caps.append(Capability("plate_reading", True, kind_cert, "osm:surveillance:type"))
    if kind == "ptz":
        caps.append(Capability("pan_tilt_zoom", True, kind_cert, "osm:camera:type"))
    return caps


def dome_count_capability(tags: dict, kind: str, answered: int | None) -> Capability | None:
    """A multi-dome's number of domes (rules/optics.yaml assemblies): a shape answer's
    (estimated), else OSM's camera:count when the tags make it a multi-dome (identified: a
    count, not an estimate), else unknown (None, default: its field is the full circle
    whatever the number). None for any other kind. A shape answer without a number keeps
    OSM's."""
    if kind != "multidome":
        return None
    if answered is not None:
        return Capability("dome_count", answered, ESTIMATED, "contribution")
    if (tagged := dome_count(tags)) is not None:
        return Capability("dome_count", tagged, IDENTIFIED, "osm:camera:count")
    return Capability(
        "dome_count", None, DEFAULT, f"rule:optics@{optics.rules()['version']}:assemblies"
    )


def max_reach(kind: str) -> float:
    """Farthest distance where any sample reaches the lowest drawn level (capped)."""
    floor = optics.rules()["levels"][optics.rules()["display_floor"]]
    return optics.reach_at_share(optics.samples(kind), floor, 0.0)


def geometry_certainty(caps: list[Capability]) -> str:
    """Certainty of the drawn field of view: the weakest of direction, fov and range."""
    by_name = {c.name: c.certainty for c in caps}
    parts = [by_name["direction"], by_name["hfov_deg"], by_name["range_m"]]
    return min(parts, key=CERTAINTY_RANK.__getitem__)


# --- stage -----------------------------------------------------------------------------


def run(region: regions.Region) -> dict[str, Path]:
    from lacarte import admin  # admin imports this module

    cams = gpd.read_parquet(region.build_dir / "cameras.parquet")
    norm, caps = normalize(cams, admin.place_names(region))
    paths = {
        "cameras_norm": region.build_dir / "cameras_norm.parquet",
        "capabilities": region.build_dir / "capabilities.parquet",
    }
    norm.to_parquet(paths["cameras_norm"])
    caps.to_parquet(paths["capabilities"])
    return paths


def normalize(
    cams: gpd.GeoDataFrame, places: Places | None = None
) -> tuple[gpd.GeoDataFrame, pd.DataFrame]:
    """Every camera's normalised row and capabilities; `places`: the generic operator
    names' communes and départements (admin.place_names)."""
    rows, cap_rows = [], []
    for rec in cams.itertuples(index=False):
        row, caps = normalize_row(rec.camera_id, rec.osm_version, rec.osm_timestamp, rec.tags,
                                  places=places)  # fmt: skip
        rows.append(row)
        for cap in caps:
            cap_rows.append({
                "camera_id": rec.camera_id, "name": cap.name,
                "value": json.dumps(cap.value), "certainty": cap.certainty, "source": cap.source,
            })  # fmt: skip
    norm = gpd.GeoDataFrame(rows, geometry=cams.geometry.values, crs=cams.crs)
    norm["dome_count"] = norm["dome_count"].astype("Int64")  # nullable: unknown or not one
    return norm, pd.DataFrame(cap_rows)


def normalize_row(
    camera_id: str,
    osm_version,
    osm_timestamp,
    tags_json: str,
    over: Overrides | None = None,
    places: Places | None = None,
) -> tuple[dict, list[Capability]]:
    """One camera's normalised columns and capabilities from its OSM tags (JSON text, kept
    as is in the row). The `apply` stage reruns it with what contributions say (`over`),
    with the same `places` (normalized_operator)."""
    over = over or Overrides()
    tags = json.loads(tags_json)
    kind, kind_cert = classify_kind(tags)
    if over.kind is not None:
        kind, kind_cert = over.kind, ESTIMATED
    mount = mount_group(tags)
    op, op_cert = operator_class(tags, kind, places)
    op_name, _ = normalized_operator(tags.get("operator"), places)
    raw_operator = tags.get("operator")
    if over.operator is not None:
        cls, name, keep = over.operator
        if name is not None:
            op_name = raw_operator = name
        elif not (keep and cls == op):
            op_name = raw_operator = None
        op, op_cert = cls, DEFAULT if cls == "unknown" else ESTIMATED
    tagged = tagged_capabilities(tags, kind)
    caps = capabilities(tags, kind, kind_cert, mount, over.directions, over.height_m, over.tilt_deg)
    if (count := dome_count_capability(tags, kind, over.dome_count)) is not None:
        caps.append(count)
    c = {cap.name: cap for cap in caps}
    _, dir_status = parse_direction(tags.get("camera:direction") or tags.get("direction"))
    if over.directions:
        dir_status = "contribution"
    survey = max(
        (d for d in (parse_date(tags.get("check_date")), parse_date(tags.get("survey:date"))) if d),
        default=None,
    )
    stale = []
    if "plus présente" in (tags.get("fixme") or "").lower():
        stale.append("fixme_maybe_gone")
    if "sous-surveillance" in (tags.get("source") or "").lower() and (
        survey is None or survey.year <= 2012
    ):
        stale.append("legacy_import")
    row = {
        "camera_id": camera_id,
        "osm_version": osm_version,
        "osm_timestamp": osm_timestamp,
        "is_camera": is_camera(tags),
        "kind": kind,
        "kind_certainty": kind_cert,
        "type_known": kind != "unknown",
        "operator_class": op,
        "operator_certainty": op_cert,
        "operator_name": raw_operator,
        "operator_norm": op_name,
        **{f"cap_{k}": v for k, v in tagged.items()},
        "mount_raw": tags.get("camera:mount"),
        "mount_group": mount,
        "level": tags.get("level"),
        "indoor": "indoor" in _values(tags.get("surveillance")),
        "directions": c["direction"].value or [],
        "direction_parse": dir_status,
        "direction_certainty": c["direction"].certainty,
        "res_lo": float(c["resolution_px"].value[0]),
        "res_hi": float(c["resolution_px"].value[1]),
        "fov_lo": float(c["hfov_deg"].value[0]),
        "fov_hi": float(c["hfov_deg"].value[1]),
        "optics_certainty": c["hfov_deg"].certainty,
        # Widest: bounds the drawn sector (a multi-dome's is the full circle, 360).
        "fov_deg": optics.opening_deg(kind),
        "range_m": float(c["range_m"].value),
        "tilt_deg": float(c["tilt_deg"].value) if "tilt_deg" in c else None,
        # A multi-dome's number of domes and its certainty; None for other kinds, and the
        # number None (certainty default) when unknown.
        "dome_count": c["dome_count"].value if "dome_count" in c else None,
        "dome_count_certainty": c["dome_count"].certainty if "dome_count" in c else None,
        "height_m": float(c["height_m"].value),
        "height_certainty": c["height_m"].certainty,
        "night_vision": c["night_vision"].value,
        "geom_certainty": geometry_certainty(caps),
        "survey_date": survey.isoformat() if survey else None,
        "stale_flags": stale,
        "tags": tags_json,
    }
    return row, caps
