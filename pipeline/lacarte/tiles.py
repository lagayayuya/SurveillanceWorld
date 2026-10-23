"""Stage 6: vector tiles (PMTiles) for the three reading levels.

- admin.pmtiles    layers `departements` z4-8, `communes` z8-11 (IGN ADMIN EXPRESS COG
                   CARTO; municipal arrondissements in place of their commune)
- admin7.pmtiles   layer `communes` z7: their outlines only, no attribute (drawn from z7.5)
- streets.pmtiles  layer `edges`    z14-16  every segment, grey; sidewalks, crossings
                                             and paths beside a road from z16; the ways of
                                             rules/streets.yaml unfilmed_not_drawn only
                                             where filmed; `c` its width class
                   layer `portions` z11-16  what is filmed, per estimate and level: the
                                             filmed intervals of the axes merged at
                                             z11-14 (z11 on a coarser grid), the portions
                                             with their cameras from z15 (z16 off the axes)
- detail.pmtiles   layers `bands` (DORI coverage bands) and `cameras` (with each shown
                   estimate's field extent, for framing); built at z15, overzoomed
- meta.json        build id (buildinfo.py), participation rules, estimates, quantile
                   breaks of the commune and département colour scales (both sets)
- areas.json       commune and département code -> name, département, bounds (?insee=)

Everything that depends on the reach estimate exists once per estimate, suffixed with its
index (0 certain, 1 probable, 2 cautious; order of rules/optics.yaml).
Attributes are kept short and numeric where possible: tile weight drives fluidity.
"""

from __future__ import annotations

import itertools
import json
import math
import subprocess
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pmtiles.reader import MmapSource, all_tiles

from lacarte import (
    admin,
    apply,
    buildinfo,
    direction,
    exposure,
    normalize,
    optics,
    participation,
    regions,
)
from lacarte.aggregate import KINDS
from lacarte.camerafilters import (
    OP_CODE,
    camera_filters,
    camera_mask,
    estimate_mask,
    position_check,
)

ATTRIBUTION = (
    '<a href="https://www.openstreetmap.org/copyright">© contributeurs OpenStreetMap</a> (ODbL)'
)
ADMIN_ATTRIBUTION = "IGN – Admin Express COG Carto, 2026"
CERT_CODE = {"default": 0, "estimated": 1, "identified": 2}
OSM_TYPE_CODE = {"n": 0, "w": 1, "r": 2}
AREAS_MAX, STREETS_MIN, UNFILMED_MIN, NON_AXIS_MIN, DETAIL_Z = 11, 11, 14, 16, 15
# The portions with their cameras (`cs`, an id) from the street level, where focus mode
# starts; below, the merged intervals (MERGED_ZOOMS).
PORTIONS_MIN = 15
# Départements up to DEPS_MAX (and DEPS_MAX + 1 for the cross-fade), communes from
# DEPS_MAX + 1 to AREAS_MAX [TO ADJUST].
DEPS_MAX = 7
# The communes' outlines one zoom earlier, from a commune's département view (user decision
# 2026-10-23): their own archive (admin7.pmtiles), z7 only, outlines without attributes,
# simplified (OUTLINES_SIMPLIFY, tippecanoe's --simplification). In admin.pmtiles they made
# the France z7 view 114 -> 2,112 KiB of admin tiles; apart, the web draws them from z7.5,
# and MapLibre loads a source only when one of its layers is in its zoom range, so the z7
# view loads none (heaviest tile 186 KiB, 930 KiB on a phone's screen at z7.5).
OUTLINES_Z, OUTLINES_SIMPLIFY = DEPS_MAX, 4
# The lowest zoom of the départements: on a phone the whole of France fills the screen's
# width near z4.2 (user decision 2026-10-23: zoomed out, France stays whole and centred);
# below admin.pmtiles' first zoom the map would show no area at all.
ADMIN_MIN = 4
QUANTILES = (0.2, 0.4, 0.6, 0.8)
# z12-14: segments are a few pixels long; contiguous filmed portions of the same estimate,
# level and filter bits are merged. z14 since lot P (2026-10-17): its portions with their
# cameras made the heaviest streets tile, 289 KB gzip and 917 KB to decode at Châtelet,
# of which the 18,493 portions' camera lists, ids and tags (578 KB) that only focus mode
# (z15+) and the exact filters read; the filters follow the bits there, as at z12-13. Our own
# simplification (SIMPLIFY_PX screen pixels) is off: on IDF, 0.5 px lost 1.8 % of the
# coloured length at z12 (4 tiles beyond 5 %) and saved 4 % of the heaviest tile
# (310 -> 298 KiB); tippecanoe's own remains.
MERGED_ZOOMS = (11, 12, 13, 14)
# z11 (streets one zoom earlier, user decision 2026-10-23): the same merged intervals in their
# own source (portions_low), tiled apart at a coarser grid (tippecanoe -d LOW_DETAIL: 1,024
# units over the tile's 512 CSS px) and joined into streets.pmtiles. At the default 4,096 the
# heaviest z11 tile (Paris) weighed 718 KiB, over the 500 KiB ceiling; simplifying (4: 685),
# coalescing (714) or dropping the smallest (12 % of its features kept) did not help.
LOW_ZOOMS, LOW_DETAIL = (11,), 10
SIMPLIFY_PX = 0.0
TILE_PX = 512  # MapLibre draws a vector tile over 512 CSS pixels
EQUATOR_M = 40_075_016.686
DISPLAYED_LEVELS = optics.DISPLAYED_LEVELS
ESTIMATES = list(optics.estimates())
# Estimates put in tiles, by their index in ESTIMATES (tiles keep that index: `b`, keys).
SHOWN = optics.shown_estimates()


def run(region: regions.Region) -> dict[str, Path]:
    if region.parts:
        from lacarte import merge  # a region built in parts: its parts' features, merged

        return merge.merged_tiles(region)
    b = region.build_dir
    src, out = sources(b)
    areas = gpd.read_parquet(b / "areas.parquet")
    cams = gpd.read_parquet(b / apply.CAMERAS)
    views = pd.read_parquet(b / "views.parquet", columns=VIEW_FILTER_COLUMNS)
    filters, lists = camera_filters(cams, views, region.data_date())
    compact = compact_ids(cams.camera_id)
    write_features(b, src, region.crs, areas, filters, compact, masks_of(cams, filters))
    return finish(region, src, out, areas, cams, filters, lists, compact)


# The views' columns the filters read (camerafilters.camera_filters, position_check).
VIEW_FILTER_COLUMNS = ["camera_id", "snapped", "inside_building", "area_m2"]
LAYERS = ("edges", "portions", "portions_low", "bands", "cameras")


def sources(b: Path) -> tuple[Path, Path]:
    """The folders of the tiles' sources and of the tiles, the layers' sources emptied
    (write_features appends to them)."""
    src, out = b / "tiles_src", b / "tiles"
    src.mkdir(exist_ok=True)
    out.mkdir(exist_ok=True)
    for layer in LAYERS:
        (src / f"{layer}.geojsonl").unlink(missing_ok=True)
    return src, out


def masks_of(cams: pd.DataFrame, filters: dict) -> dict[str, int]:
    """camera id -> the SEGMENT_BITS it sets (camerafilters.camera_mask)."""
    return {
        c.camera_id: camera_mask(c.operator_class, c.kind, filters[c.camera_id]["fl"])
        for c in cams.itertuples(index=False)
    }


def write_features(
    b: Path,
    src: Path,
    crs: str,
    areas: gpd.GeoDataFrame,
    filters: dict,
    compact: dict[str, int],
    masks: dict[str, int],
    own_cams=None,
    own_edges=None,
    fid_offset: int = 0,
) -> int:
    """The features of the streets and detail layers of the build in `b`, appended to the
    sources in `src`: every one, or (a part of a merged region) those of the cameras and
    segments it owns (`own_cams`, `own_edges`: masks over cameras_applied's and edges'
    rows), the portions' feature ids from `fid_offset`. Returns the portions written."""
    edges = gpd.read_parquet(b / "edges.parquet")
    cams = gpd.read_parquet(b / apply.CAMERAS)
    portions = gpd.read_parquet(b / "street_portions.parquet")
    own_edges = np.ones(len(edges), dtype=bool) if own_edges is None else own_edges
    if own_cams is not None:
        cams = cams[own_cams].reset_index(drop=True)
    kept = set(cams.camera_id)
    bands = gpd.read_parquet(b / "bands.parquet")
    bands = bands[bands.camera_id.isin(kept)].reset_index(drop=True)
    views = gpd.read_parquet(b / "views.parquet")
    views = views[views.camera_id.isin(kept)].to_crs("EPSG:4326")
    extents = field_extents(bands, cams)
    bands, cams = bands.to_crs("EPSG:4326"), cams.to_crs("EPSG:4326")
    street = pd.read_parquet(b / "camera_street.parquet").set_index("camera_id")

    classes = street_classes(edges)
    filmed = np.zeros(len(edges), dtype=bool)
    filmed[portions.e[portions.band.isin(SHOWN)].to_numpy()] = True
    drawn = own_edges & (filmed | unfilmed_drawn(edges, areas, crs))
    _write(src / "edges.geojsonl", _edge_features(edges, classes, filmed, drawn), append=True)
    portions = portions[own_edges[portions.e.to_numpy()]]
    axis = edges.axis.to_numpy()
    fb = portion_filter_bits(portions, masks)
    high = [z for z in MERGED_ZOOMS if z not in LOW_ZOOMS]
    features = itertools.chain(
        _merged_features(portions, fb, axis, high),
        _portion_features(portions.to_crs("EPSG:4326"), compact, axis, classes, fid_offset),
    )
    _write(src / "portions.geojsonl", features, append=True)
    low = _merged_features(portions, fb, axis, LOW_ZOOMS)
    _write(src / "portions_low.geojsonl", low, append=True)
    _write(src / "bands.geojsonl", _band_features(bands, cams, filters), append=True)
    features = _camera_features(cams, views, street, filters, compact, extents)
    _write(src / "cameras.geojsonl", features, append=True)
    return len(portions)


def unfilmed_drawn(edges: gpd.GeoDataFrame, areas: gpd.GeoDataFrame, crs: str) -> np.ndarray:
    """Per segment: drawn even unfilmed, its midpoint in a unit (commune or municipal
    arrondissement) where a camera stands (rules/streets.yaml unfilmed_only_where_cameras);
    a segment outside every unit is not."""
    units = areas[(areas.level == "commune") & (areas.camera_count > 0)].to_crs(crs)
    mid = shapely.line_interpolate_point(edges.geometry.values, 0.5, normalized=True)
    out = np.zeros(len(edges), dtype=bool)
    if len(units) and len(edges):
        hit, _ = shapely.STRtree(units.geometry.values).query(mid, predicate="within")
        out[hit] = True
    return out


def finish(
    region: regions.Region,
    src: Path,
    out: Path,
    areas: gpd.GeoDataFrame,
    cams: gpd.GeoDataFrame,
    filters: dict,
    lists: dict,
    compact: dict[str, int],
) -> dict[str, Path]:
    """meta.json, cameras.json, areas.json and the three archives, from the sources written
    by write_features and the areas."""
    build = {"build_id": buildinfo.build_id(region), "participation": participation_rules()}
    # The region's extent (its départements, WGS84): the map's lowest zoom fits it and a
    # view taken outside it comes back at the end of the gesture (web bounds.ts).
    extent = {"bounds": region_bounds(areas)}
    (out / "meta.json").write_text(
        json.dumps({**build, **meta(areas), **extent, **lists}, indent=2)
    )
    (out / "cameras.json").write_text(
        json.dumps(camera_table(cams, filters, compact), separators=(",", ":"))
    )

    common = ["--force", "--read-parallel", f"--attribution={ATTRIBUTION}"]
    paths = {
        "streets": out / "streets.pmtiles",
        "detail": out / "detail.pmtiles",
        "admin": out / "admin.pmtiles",
        "admin7": out / "admin7.pmtiles",
    }
    # Tile files of an earlier build that this one no longer writes (cells.pmtiles) would
    # be published with the folder.
    for old in out.glob("*.pmtiles"):
        if old not in paths.values():
            old.unlink()
    levels = {"departements": "departement", "communes": "commune"}
    for layer, level in levels.items():
        # Départements also in the first communes level: the two cross-fade there.
        zooms = {"maxzoom": DEPS_MAX + 1} if level == "departement" else {"minzoom": DEPS_MAX + 1}
        _write(src / f"{layer}.geojsonl", _area_features(areas[areas.level == level], zooms))
    outlines = areas[areas.level == "commune"].geometry
    _write(src / "outlines.geojsonl", _outline_features(outlines))
    (out / "areas.json").write_text(
        json.dumps(area_index(areas), ensure_ascii=False, separators=(",", ":"))
    )
    _tippecanoe(
        "--force", "--read-parallel", f"--attribution={ADMIN_ATTRIBUTION}",
        "-o", str(paths["admin"]), f"-Z{ADMIN_MIN}", f"-z{AREAS_MAX}",
        "--no-feature-limit", "--no-tile-size-limit", "--detect-shared-borders",
        "--name=la-carte admin",
        *(a for layer in levels for a in ("-L", f"{layer}:{src / f'{layer}.geojsonl'}")),
    )  # fmt: skip
    _tippecanoe(
        "--force", "--read-parallel", f"--attribution={ADMIN_ATTRIBUTION}",
        "-o", str(paths["admin7"]), f"-Z{OUTLINES_Z}", f"-z{OUTLINES_Z}",
        f"--simplification={OUTLINES_SIMPLIFY}", "--no-feature-limit", "--no-tile-size-limit",
        "--detect-shared-borders", "--name=la-carte communes outlines",
        "-L", f"communes:{src / 'outlines.geojsonl'}",
    )  # fmt: skip
    high, low = out / "streets-high.pmtiles", out / "streets-low.pmtiles"
    high_min = min(z for z in MERGED_ZOOMS if z not in LOW_ZOOMS)
    _tippecanoe(
        *common, "-o", str(high), f"-Z{high_min}", "-z16", f"-B{high_min}",
        "--no-feature-limit", "--no-tile-size-limit", "--name=la-carte streets",
        "-L", f"edges:{src / 'edges.geojsonl'}", "-L", f"portions:{src / 'portions.geojsonl'}",
    )  # fmt: skip
    if (src / "portions_low.geojsonl").stat().st_size:
        _tippecanoe(
            *common, "-o", str(low), f"-Z{min(LOW_ZOOMS)}", f"-z{max(LOW_ZOOMS)}",
            f"-B{min(LOW_ZOOMS)}", f"-d{LOW_DETAIL}", "--no-feature-limit",
            "--no-tile-size-limit", "-L", f"portions:{src / 'portions_low.geojsonl'}",
        )  # fmt: skip
        subprocess.run(
            ["tile-join", "--quiet", "--force", "--no-tile-size-limit", "--name=la-carte streets",
             f"--attribution={ATTRIBUTION}", "-o", str(paths["streets"]), str(low), str(high)],
            check=True,
        )  # fmt: skip
        low.unlink()
        high.unlink()
    else:
        high.replace(paths["streets"])
    _tippecanoe(
        *common, "-o", str(paths["detail"]), f"-Z{DETAIL_Z}", f"-z{DETAIL_Z}", f"-B{DETAIL_Z}",
        "--no-feature-limit", "--no-tile-size-limit", "--no-tiny-polygon-reduction",
        "--name=la-carte detail",
        "-L", f"bands:{src / 'bands.geojsonl'}",
        "-L", f"cameras:{src / 'cameras.geojsonl'}",
    )  # fmt: skip
    return paths


def participation_rules() -> dict:
    """What the phone needs of rules/participation.yaml (it must work offline too)."""
    r = participation.rules()
    return {
        "placement": r["placement"],
        "capture_m": r["magnet"]["capture_m"],
        "move_max_m": r["move"]["max_m"],
        "nearby_m": r["move"]["nearby_m"],
        "on_site_m": r["on_site"]["within_m"],
        "on_site_max_age_s": r["on_site"]["max_age_s"],
        "on_site_max_accuracy_m": r["on_site"]["max_accuracy_m"],
        "proposals_min_zoom": r["proposals_min_zoom"],
        "questions": questions_rules(),
        "add": {
            "min_zoom": r["add"]["min_zoom"],
            "refetch_m": r["add"]["refetch_m"],
            "duplicate_m": apply.rules()["duplicate"]["duplicate_m"],
        },
    }


def questions_rules() -> dict:
    """What the phone needs of rules/questions.yaml to choose the "Compléter" questions."""
    q = participation.questions()
    return {
        "shape_kinds": q["shape"]["kinds"],
        "direction_kinds": direction.kinds(),
        "operator_codes": q["operator"]["asked"],
        # Folded names that do not tell a business from a private individual.
        "category_unknown": sorted(
            {participation.fold(n) for n in q["operator"]["category_unknown"]}
            | set(normalize.rules("operators")["no_information"])
        ),
        "min_target_m": q["direction"]["min_target_m"],
        "min_target_px": q["direction"]["min_target_px"],  # the punk aim's, on the screen
        # Phase D3: the answers offered (classes, never metres nor degrees on the phone) and
        # the kinds whose tilt is asked.
        "height_m": q["height"]["classes"],  # class -> metres, shown "≈ 5 m"
        "tilt_classes": list(q["tilt"]["classes"]),
        # The classique's kinds (frozen, a tube only) under the name it has always read; the
        # punk editor's, a small dome too (questions@5), under their own.
        "tilt_kinds": q["tilt"]["classique_kinds"],
        "editor_tilt_kinds": q["tilt"]["kinds"],
        # The punk add and « Modifier »: the kinds offered no height (the big ball).
        "height_excluded_kinds": q["height"]["modify_excludes"],
    }


def meta(areas: gpd.GeoDataFrame) -> dict:
    """Estimates, the direction rule the sheet explains, what the panel and the PTZ sheet
    need, and the colour scales of the communes and départements."""
    return {
        "estimates": ESTIMATES,
        "shown_estimates": SHOWN,
        "default_estimate": optics.default_estimate_index(),
        "opening_estimate": optics.opening_estimate_index(),
        # Cameras of these kinds without a direction are drawn light (rules/direction.yaml).
        "unknown_direction": {"kinds": direction.kinds()},
        # Kinds made of several cameras (rules/optics.yaml assemblies): the kind of each
        # camera and the field's opening (a multi-dome: domes, 360 degrees).
        "assemblies": {
            k: {"optics_of": v["optics_of"], "opening_deg": v["opening_deg"]}
            for k, v in optics.rules()["assemblies"].items()
            if isinstance(v, dict)
        },
        # Farthest filled field: "Qui filme" widens the view by it (a field reaching in).
        "max_range_m": optics.rules()["max_range_m"],
        # Median wide field of view of PTZ cameras in the catalogue, for their sheet.
        "ptz_hfov_p50": round(optics.rules()["distributions"]["ptz"]["pooled"]["hfov_deg"][1]),
        "communes": share_breaks(areas[areas.level == "commune"]),
        "departements": share_breaks(areas[areas.level == "departement"]),
        # The punk map's classes, fixed and the same for both kinds of area (the classique
        # keeps the quantiles above until the switch).
        "area_classes": admin.class_breaks(),
    }


def region_bounds(areas: gpd.GeoDataFrame) -> list[float]:
    """[west, south, east, north] of the région's départements, to 3 decimals outward."""
    deps = areas[areas.level == "departement"]
    west, south, east, north = (deps if len(deps) else areas).to_crs("EPSG:4326").total_bounds
    return [
        math.floor(west * 1000) / 1000,
        math.floor(south * 1000) / 1000,
        math.ceil(east * 1000) / 1000,
        math.ceil(north * 1000) / 1000,
    ]


def share_breaks(areas: pd.DataFrame) -> dict:
    """Quantile breaks (in %) of the areas' colour, over areas with at least one camera,
    for each set; computed apart for each kind of area. The colour is fixed, whatever the
    estimate chosen: the high end Y of the sheet's "between X % and Y %" (the least certain
    estimate, every camera)."""
    mapped = areas[areas.camera_count > 0]
    high = list(optics.estimates())[-1]
    out = {}
    for key, col in (("hi", f"filmed_ratio_{high}"), ("hi_pub", f"filmed_ratio_{high}_pub")):
        vals = 100 * mapped[col].to_numpy()
        vals = vals[vals > 0]
        breaks = unique_breaks(np.quantile(vals, QUANTILES).round(2)) if len(vals) else []
        out[key] = {"breaks": breaks, "max": round(float(vals.max()), 2) if len(vals) else 0}
    return out


def unique_breaks(values) -> list[float]:
    """Strictly increasing class breaks: a MapLibre `step` rejects repeated stops, which
    happen when a small region has few distinct values."""
    return sorted({float(v) for v in values})


def _outline_features(outlines: gpd.GeoSeries):
    """The communes' outlines for admin7.pmtiles: geometry only (the web draws lines)."""
    for geom in outlines.to_crs("EPSG:4326").values:
        if geom is not None and not geom.is_empty:
            yield _feature(geom, {}, {"minzoom": OUTLINES_Z, "maxzoom": OUTLINES_Z})


def _area_features(areas: gpd.GeoDataFrame, zooms: dict):
    """Communes or départements: the sheet's "between X % and Y % of the streets", fixed
    whatever the estimate chosen: `lo` = the default estimate filmed by cameras with a
    surveyed direction (PTZ and panoramas included), `hi` = the least certain estimate,
    every camera (also the colour); `_pub` for public cameras only. Then counts (by
    operator class and by type), reliability, names and the main operators (JSON
    [[name, count], ...])."""
    default = optics.rules()["default_estimate"]
    high = list(optics.estimates())[-1]
    for c in areas.itertuples(index=False):
        rel = None if pd.isna(c.reliability) else round(100 * c.reliability)
        nd_known = 100 * c.direction_known_share
        props = {
            "c": c.code,
            "nm": c.name,
            "d": c.dep,
            "dn": _str(c.dep_name),
            **{
                f"{key}{sfx}": round(100 * getattr(c, f"filmed_ratio_{col}{sfx}"), 2)
                for key, col in (("lo", f"{default}_dir"), ("hi", high))
                for sfx in ("", "_pub")
            },
            "n": int(c.camera_count),
            "n_pub": int(c.n_public),
            "n_pro": int(c.n_private_outdoor),
            "n_pri": int(c.n_private_indoor),
            "n_unk": int(c.n_unknown),
            # Cameras by type (`k_<kind>`, absent at 0): the punk sheet's « Caméras ».
            **{f"k_{k}": int(getattr(c, f"n_kind_{k}")) or None for k in KINDS},
            # A point inside the area: the panel counts the areas whose point is in view.
            **dict(zip(("lx", "ly"), _point_inside(c.geometry), strict=True)),
            "rel": rel,
            "rw": _str(c.reliability_word),
            "rr": _str(c.reliability_reason),
            "rp": None if pd.isna(c.reliability_reason_pct) else int(c.reliability_reason_pct),
            # Share of the cameras without a surveyed direction (%): only a possible zone.
            "nd": None if pd.isna(c.direction_known_share) else round(100 - nd_known),
            "road_km": round(c.road_m / 1000, 1),
            "ops": c.operators if c.operators != "[]" else None,
            # Cameras whose operator value says nothing ("private"): out of the top five.
            "nx": int(c.n_no_operator_info) or None,
        }
        yield _feature(c.geometry, {k: v for k, v in props.items() if v is not None}, zooms)


def _point_inside(geom) -> tuple[float, float]:
    """A point inside the area, to ~100 m (3 decimals): enough to say whether an area is in
    view; 5 decimals cost 13 KiB in the heaviest z8 tile, 3 decimals 6."""
    p = shapely.point_on_surface(geom)
    return round(p.x, 3), round(p.y, 3)


def area_index(areas: gpd.GeoDataFrame) -> dict:
    """code -> [name, département code, [west, south, east, north]]: what a ?insee= link
    needs to frame its area before any admin tile is loaded."""
    return {
        c.code: [c.name, c.dep, [round(float(v), 5) for v in c.geometry.bounds]]
        for c in areas.itertuples(index=False)
    }


def pixel_m(zoom: int, lat_deg: float) -> float:
    """Ground size (m) of one screen pixel at `zoom`."""
    return EQUATOR_M * np.cos(np.radians(lat_deg)) / (TILE_PX * 2**zoom)


def portion_filter_bits(portions: gpd.GeoDataFrame, masks: dict[str, int]) -> np.ndarray:
    """`fb` per portion: OR of the masks of the cameras it lists, as the filters of its
    estimate read them (camerafilters.estimate_mask). Portions are cut where the camera
    profiles change, so a bit set on a portion is set all along it."""
    out = np.zeros(len(portions), dtype=np.int64)
    for i, (est, cbs) in enumerate(zip(portions.band, portions.cameras, strict=True)):
        v = 0
        for cb in cbs:
            v |= masks.get(cb.rsplit(":", 1)[0], 0)
        out[i] = estimate_mask(v, int(est))
    return out


def merged_portions(
    portions: gpd.GeoDataFrame, fb: np.ndarray, axis: np.ndarray, tolerance_m: float
) -> gpd.GeoDataFrame:
    """Filmed portions of street axes (z12-14), merged where contiguous portions share
    their estimate (`b`), level (`lv`) and filter bits (`fb`), then simplified by
    `tolerance_m`. Metric CRS."""
    sel = portions.assign(fb=fb)[axis[portions.e.to_numpy()] & portions.band.isin(SHOWN)]
    rows = []
    for (b, lv, f), g in sel.groupby(["band", "level", "fb"]):
        # Contiguous portions share an end point: merging where exactly two portions of the
        # group meet joins runs along a segment and across the junctions they continue.
        merged = shapely.line_merge(shapely.multilinestrings(g.geometry.values))
        rows.append({"b": int(b), "lv": int(lv), "fb": int(f), "geometry": merged})
    out = gpd.GeoDataFrame(rows, columns=["b", "lv", "fb", "geometry"], crs=portions.crs)
    out["geometry"] = shapely.simplify(out.geometry.values, tolerance_m, preserve_topology=False)
    return out


def _merged_features(
    portions: gpd.GeoDataFrame, fb: np.ndarray, axis: np.ndarray, zooms=MERGED_ZOOMS
):
    """z11-14: the filmed intervals of the axes, merged (merged_portions), per zoom."""
    bounds = portions.to_crs("EPSG:4326").total_bounds if len(portions) else [0.0] * 4
    lat = (bounds[1] + bounds[3]) / 2
    for z in zooms:
        tol = SIMPLIFY_PX * pixel_m(z, lat)
        merged = merged_portions(portions, fb, axis, tol).to_crs("EPSG:4326")
        for m in merged.to_dict("records"):
            geom = m.pop("geometry")
            if not geom.is_empty:
                yield _feature(geom, m, {"minzoom": z, "maxzoom": z})


def street_classes(edges: pd.DataFrame) -> np.ndarray:
    """Each segment's width class (rules/streets.yaml tile_class): the basemap's road class
    for its type, a service way with a service=* value drawn as a minor road."""
    rule = exposure._rules()["tile_class"]
    out = edges.highway.map(rule["highways"]).fillna(rule["default"]).to_numpy(dtype=object)
    out[(edges.highway.eq("service") & edges.service.notna()).to_numpy()] = "minor"
    return out


def width_class(c: str) -> dict:
    """`c` as a tile property, none for the default class (rules/streets.yaml tile_class):
    its basemap road is never wider than the floor, which the web draws without `c`."""
    return {} if c == exposure._rules()["tile_class"]["default"] else {"c": c}


def _edge_features(
    edges: gpd.GeoDataFrame, classes: np.ndarray, filmed: np.ndarray, drawn: np.ndarray
):
    """The segments `drawn` says, grey, under the filmed portions: axes from z14, sidewalks,
    crossings and paths beside a road from z16; the types of rules/streets.yaml
    unfilmed_not_drawn only where filmed (the basemap draws the rest). `c`: the width class.
    Colour, cameras and filter marks are the portions'."""
    hidden = edges.highway.isin(exposure._rules()["unfilmed_not_drawn"]["highways"]).to_numpy()
    for i, e in enumerate(edges.to_crs("EPSG:4326").itertuples(index=False)):
        if not drawn[i] or (hidden[i] and not filmed[i]):
            continue
        minzoom = UNFILMED_MIN if e.axis else NON_AXIS_MIN
        yield _feature(e.geometry, width_class(classes[i]), {"minzoom": minzoom})


def camera_table(cams: gpd.GeoDataFrame, filters: dict, compact: dict[str, int]) -> dict:
    """What the street filters need per camera, by compact number: operator class and type
    (indices into `ops` and `kinds`), flags `fl` and operator index `op` (-1: none). Loaded
    by the browser only when a filter is first used."""
    ops = list(OP_CODE.values())
    kinds = sorted(cams.kind.unique())
    n = len(compact)
    table = {"ops": ops, "kinds": kinds, "o": [0] * n, "k": [0] * n, "fl": [0] * n, "op": [-1] * n}
    for c in cams.itertuples(index=False):
        i = compact[c.camera_id]
        table["o"][i] = ops.index(OP_CODE[c.operator_class])
        table["k"][i] = kinds.index(c.kind)
        table["fl"][i] = filters[c.camera_id]["fl"]
        table["op"][i] = filters[c.camera_id].get("op", -1)
    return table


def _portion_features(
    portions: gpd.GeoDataFrame,
    compact: dict[str, int],
    axis: np.ndarray,
    classes: np.ndarray,
    fid_offset: int = 0,
):
    """Filmed parts of the segments, per shown estimate (`b`), with their highest level
    (`lv`) and cameras (`cs`: focus mode and the filters): from PORTIONS_MIN; those of
    sidewalks, crossings and paths beside a road (not `axis`) from NON_AXIS_MIN, with their
    segments. A feature id lets the filters mark them. `c`: the segment's width class
    (street_classes). The merged features of z12-14 have none: there the basemap's roads
    are under the fields and every stroke takes the narrowest width."""
    for i, r in enumerate(portions.itertuples(index=False)):
        if r.band not in SHOWN:
            continue
        props = {"b": int(r.band), "lv": int(r.level), **width_class(classes[r.e])}
        if len(r.cameras):
            props["cs"] = camera_bands_key(r.cameras, compact)
        minzoom = PORTIONS_MIN if axis[r.e] else NON_AXIS_MIN
        yield _feature(r.geometry, props, {"minzoom": minzoom}, fid=fid_offset + i)


def compact_ids(camera_ids) -> dict[str, int]:
    """Short per-build camera numbers (the `n` of camera features): segments list the
    cameras filming them with these, not with the long OSM-derived feature ids."""
    # OSM cameras first, then the added ones: an add renumbers no OSM camera.
    return {
        c: i for i, c in enumerate(sorted(camera_ids, key=lambda c: (participation.is_added(c), c)))
    }


def camera_bands_key(camera_bands, compact: dict[str, int]) -> str:
    """Cameras filming a segment as ";t;t;", t = base-36 of (compact number * 3 + most
    certain estimate reaching it): searched as a substring by focus mode and parsed by the
    street filters; base 36 keeps z15 tiles light."""
    parts = []
    for cb in camera_bands:
        cam, band = cb.rsplit(":", 1)
        parts.append(base36(compact[cam] * 3 + int(band)))
    return ";" + ";".join(parts) + ";"


def base36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if n == 0:
            return out


def _band_features(bands: gpd.GeoDataFrame, cams: gpd.GeoDataFrame, filters: dict):
    """Displayed DORI levels only: 1 = >= 25 PPM (observation incl. detection),
    2 = recognition, 3 = identification. `b` is the reach estimate (0 = certain);
    `i` the camera's feature id, to draw one camera's three estimates on click. No mark of
    an unknown direction: the classique hatches by `c` (the direction's certainty), punk
    leaves no trace of it (DECISIONS 2026-10-08)."""
    shown = {name: i for i, name in enumerate(DISPLAYED_LEVELS, start=1)}
    c = cams.set_index("camera_id")
    for r in bands.itertuples(index=False):
        if r.level not in shown or r.band not in SHOWN:
            continue
        props = {
            "i": numeric_id(r.camera_id),
            "lv": shown[r.level],
            "b": int(r.band),
            "r": optics.label_m(r.reach_m),  # written on the outline in focus mode
            "c": CERT_CODE[c.direction_certainty[r.camera_id]],
            "o": OP_CODE[c.operator_class[r.camera_id]],
            "k": c.kind[r.camera_id],
            **filters[r.camera_id],
        }
        yield _feature(r.geometry, props)


def _camera_features(
    cams: gpd.GeoDataFrame,
    views: gpd.GeoDataFrame,
    street: pd.DataFrame,
    filters: dict,
    compact: dict[str, int],
    extents: dict | None = None,
):
    snapped = views.set_index("camera_id")
    check = position_check(snapped).to_dict()
    extents = extents or {}
    for c in cams[cams.is_camera].itertuples(index=False):
        dirs = [round(float(d)) for d in c.directions]
        s = street.loc[c.camera_id] if c.camera_id in street.index else None
        v = snapped.loc[c.camera_id] if c.camera_id in snapped.index else None
        props = {
            "id": c.camera_id,
            "n": compact[c.camera_id],
            "k": c.kind,
            "kc": CERT_CODE[c.kind_certainty],
            "o": OP_CODE[c.operator_class],
            **filters[c.camera_id],
            "d": dirs[0] if dirs else -1,
            "ds": ";".join(map(str, dirs)),
            "dc": CERT_CODE[c.direction_certainty],
            # Per lens: a multi-dome's is one of its domes' (its field is the full circle).
            "fov": f"{round(c.fov_lo)}–{round(c.fov_hi)}",
            # A multi-dome (k multidome): its number of domes, absent when unknown, and that
            # number's certainty (2 OSM's camera:count, 1 an answer, 0 unknown).
            "dn": _count(getattr(c, "dome_count", None)),
            "dnc": CERT_CODE[c.dome_count_certainty]
            if isinstance(getattr(c, "dome_count_certainty", None), str)
            else None,
            # PTZ: how far it can observe once aimed and zoomed at someone (outline radius).
            "zr": round(optics.tele_reach_m()) if c.kind == "ptz" else None,
            "h": c.height_m,
            "hc": CERT_CODE[c.height_certainty],
            "mg": c.mount_group,  # participation: sets the magnet's default
            "nv": c.night_vision,
            "sd": _str(c.survey_date),
            "ed": (_str(c.osm_timestamp) or "")[:10],
            "st": ",".join(c.stale_flags),
            "cnil": int(bool(s.cnil_signal)) if s is not None else 0,
            "ib": int(bool(v.inside_building)) if v is not None else 0,
            # Position or direction to check on site (no reach shown): camerafilters.
            "pv": int(bool(check.get(c.camera_id, False))) or None,
            # Validated contributions (apply.py), months of observation: position corrected
            # on site, seen on site, verified gone (no field, out of the statistics).
            "pm": _str(getattr(c, "position_month", None)),
            "vm": _str(getattr(c, "seen_month", None)),
            "gm": _str(getattr(c, "gone_month", None)),
            "am": _str(getattr(c, "added_month", None)),  # added (phase "Ajouter")
            # Which of those months were observed on site (apply.ON_SITE bits).
            "os": int(getattr(c, "on_site", 0) or 0) or None,
            # "Compléter" answers applied (phase D2), months of observation: kind, direction,
            # who films; `ok` h = a private individual (no CNIL signal), b = a business.
            "km": _str(getattr(c, "kind_month", None)),
            "dm": _str(getattr(c, "direction_month", None)),
            "om": _str(getattr(c, "operator_month", None)),
            "ok": {"household": "h", "business": "b"}.get(getattr(c, "operator_kind", None)),
            # Phase D3: the tilt's class whatever its source (the phone asks no tilt it
            # knows; the sheet shows it while the height makes it count), the height class
            # an answer gave, and the months of the height and tilt answers applied.
            "t": participation.tilt_class(c.tilt_deg),
            "hk": _str(getattr(c, "height_class", None)),
            "hm": _str(getattr(c, "height_month", None)),
            "tm": _str(getattr(c, "tilt_month", None)),
            **extents.get(c.camera_id, {}),
        }
        clean = {k: val for k, val in props.items() if val not in (None, "")}
        yield _feature(c.geometry, clean, fid=numeric_id(c.camera_id))


def _count(value) -> int | None:
    """A nullable whole number of a parquet column (None, NaN or pandas' NA: None)."""
    return None if value is None or pd.isna(value) else int(value)


def field_extents(bands: gpd.GeoDataFrame, cams: gpd.GeoDataFrame) -> dict[str, dict]:
    """Per camera, `x<estimate>` for each shown estimate: its drawn field (display-floor
    band) as "west,south,east,north" in whole metres from the camera. The map frames the
    field from it: framing on the loaded band pieces alone zoomed in too far, and the
    camera +- the band's reach overshot a field cut by buildings. Metric CRS."""
    at = cams.set_index("camera_id").geometry
    sel = bands[(bands.level == optics.rules()["display_floor"]) & bands.band.isin(SHOWN)]
    out: dict[str, dict] = {}
    for cam, band, (x0, y0, x1, y1) in zip(
        sel.camera_id, sel.band, shapely.bounds(sel.geometry.values), strict=True
    ):
        if cam not in at.index or not np.isfinite(x0):
            continue
        p = at[cam]
        box = (np.floor(x0 - p.x), np.floor(y0 - p.y), np.ceil(x1 - p.x), np.ceil(y1 - p.y))
        out.setdefault(cam, {})[f"x{int(band)}"] = ",".join(str(int(v)) for v in box)
    return out


def _str(v) -> str | None:
    """Missing values come back from parquet as None or NaN."""
    return v if isinstance(v, str) and v else None


# Feature ids of added cameras: 2**52 + their 48 bits, under 2**53 (exact in JavaScript) and
# far above every OSM id * 3 + 2 (OSM ids are about 1.4e10 today).
ADDED_ID_BASE = 2**52


def numeric_id(camera_id: str) -> int:
    """Stable integer feature id (for hover state): osm_id * 3 + type code; an added
    camera's (phase "Ajouter"): ADDED_ID_BASE + its 12 hex digits."""
    if participation.is_added(camera_id):
        return ADDED_ID_BASE + int(camera_id[1:], 16)
    return int(camera_id[1:]) * 3 + OSM_TYPE_CODE[camera_id[0]]


def _feature(geom, props: dict, tippecanoe: dict | None = None, fid: int | None = None) -> str:
    f = {"type": "Feature", "properties": props, "geometry": json.loads(shapely.to_geojson(geom))}
    if fid is not None:
        f["id"] = fid
    if tippecanoe:
        f["tippecanoe"] = tippecanoe
    return json.dumps(f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _write(path: Path, features, append: bool = False) -> None:
    with path.open("a" if append else "w") as fh:
        for line in features:
            fh.write(line + "\n")


def _tippecanoe(*args: str) -> None:
    subprocess.run(["tippecanoe", "--quiet", *args], check=True)


def tile_stats(path: Path) -> dict:
    """Per zoom: tile count, median / p95 / max compressed size (KiB), heaviest tile."""
    with path.open("rb") as fh:
        get = MmapSource(fh)
        sizes: dict[int, list[tuple[int, tuple]]] = {}
        for (z, x, y), data in all_tiles(get):
            sizes.setdefault(z, []).append((len(data), (z, x, y)))
    out = {"file_mb": round(path.stat().st_size / 1e6, 2), "zooms": {}}
    for z, items in sorted(sizes.items()):
        vals = np.array([n for n, _ in items]) / 1024
        biggest = max(items)
        out["zooms"][z] = {
            "tiles": len(items),
            "p50_kib": round(float(np.median(vals)), 1),
            "p95_kib": round(float(np.quantile(vals, 0.95)), 1),
            "max_kib": round(float(vals.max()), 1),
            "max_tile": "/".join(map(str, biggest[1])),
        }
    return out


def run_stats(region: regions.Region) -> dict[str, Path]:
    tiles = region.build_dir / "tiles"
    stats = {p.stem: tile_stats(p) for p in sorted(tiles.glob("*.pmtiles"))}
    path = regions.ROOT / "qa" / "out" / region.name / "tiles.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(stats, indent=2))
    return {"tiles_stats": path}
