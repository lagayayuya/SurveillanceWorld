"""Stage 5b: communes and départements from IGN ADMIN EXPRESS COG CARTO.

A commune divided into municipal arrondissements (Paris, Lyon, Marseille: any commune the
arrondissement layer points to) is replaced by its arrondissements. Street length is cut
at the limits; the filmed stretches of each segment (exposure.filmed_intervals, every
estimate and set) are cut at the same points, so both are measured, not apportioned.
Cameras count where they stand. Reliability and filmed shares are those of the hexagons
(aggregate.summarise); départements are summed from their units, their reliability
recomputed from their cameras.

COG CARTO limits are generalised: a stretch of street outside every unit goes to the
nearest one within `rescue_max_m` (rules/admin.yaml), beyond that it is outside the
region's units. Both are counted in qa/out/<region>/admin.json.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
import yaml

from lacarte import aggregate, apply, exposure, normalize, optics, regions

# IGN ADMIN EXPRESS 4.0 attribute names (read from the 2026 GeoParquet files).
GEOM = "geometrie"
CODE, NAME, DEP = "code_insee", "nom_officiel", "code_insee_du_departement"
PARENT = "code_insee_de_la_commune_de_rattach"  # truncated by IGN
ESTIMATES = list(optics.estimates())
TOP_OPERATORS = 5


@cache
def _rules() -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / "admin.yaml").read_text())


def class_breaks() -> list[float]:
    """The punk map's fixed colour classes of the areas, in % (rules/admin.yaml
    area_class_breaks_pct), strictly increasing."""
    breaks = [float(b) for b in _rules()["area_class_breaks_pct"]]
    if breaks != sorted(set(breaks)):
        raise ValueError(f"area_class_breaks_pct must strictly increase: {breaks}")
    return breaks


def run(region: regions.Region) -> dict[str, Path]:
    if not region.admin:
        return {}
    b = region.build_dir
    units, deps = region_units(region)
    own = None
    if region.aggregate:
        units, deps, own = with_neighbours(region, units, deps)
    edges = gpd.read_parquet(b / "edges.parquet")
    intervals = pd.read_parquet(b / "filmed_intervals.parquet")
    cams = aggregate.prepare_cameras(gpd.read_parquet(b / apply.CAMERAS), region.data_date())
    areas, stats = aggregate_areas(edges, intervals, cams, units, deps)
    if own is not None:
        areas = areas[areas.code.isin(own)].reset_index(drop=True)
    path = b / "areas.parquet"
    areas.to_parquet(path)
    qa = regions.ROOT / "qa" / "out" / region.name / "admin.json"
    qa.parent.mkdir(parents=True, exist_ok=True)
    qa.write_text(json.dumps(stats, indent=2))
    return {"areas": path, "admin_qa": qa}


def _read(stem: Path, columns: list[str], filters=None) -> gpd.GeoDataFrame:
    """One IGN layer, as GeoParquet (the download) or GeoJSON (the CI fixture)."""
    if stem.with_suffix(".parquet").exists():
        return gpd.read_parquet(stem.with_suffix(".parquet"), columns=[*columns, GEOM],
                                filters=filters)  # fmt: skip
    if stem.with_suffix(".geojson").exists():
        g = gpd.read_file(stem.with_suffix(".geojson"))
        g = g.rename_geometry(GEOM) if g.geometry.name != GEOM else g
        for col, op, vals in filters or []:
            assert op == "in"
            g = g[g[col].isin(vals)]
        return g[[*columns, GEOM]]
    return gpd.GeoDataFrame({c: [] for c in [*columns, GEOM]}, geometry=GEOM, crs="EPSG:4326")


def region_units(region: regions.Region) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """load_units for the region's admin settings (its départements)."""
    a = region.admin
    return load_units(regions.ROOT / a["source"], a.get("departements"), region.crs)


def with_neighbours(
    region: regions.Region, units: gpd.GeoDataFrame, deps: gpd.GeoDataFrame
) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, set[str]]:
    """A part's units and départements with those of its aggregate within its buffer, and
    the codes it reports (its own): a street or a camera of the neighbour's commune, near
    the limit, goes to that commune as in one build of the whole, not to the part's nearest
    by the rescue distance."""
    agg = regions.load(region.aggregate).admin
    every, every_dep = load_units(regions.ROOT / agg["source"], agg.get("departements"),
                                  region.crs)  # fmt: skip
    zone = shapely.union_all(units.geometry.values).buffer(region.buffer_m)
    shapely.prepare(zone)
    near = every[shapely.intersects(zone, every.geometry.values)].reset_index(drop=True)
    near_dep = every_dep[shapely.intersects(zone, every_dep.geometry.values)]
    return near, near_dep.reset_index(drop=True), set(units.code) | set(deps.code)


def load_units(
    source: Path, departements: list[str] | None, crs: str
) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """Units (code, name, dep, parent) and départements (code, name) in `crs`."""
    in_deps = [(DEP, "in", departements)] if departements else None
    communes = _read(source / "commune", [CODE, NAME, DEP], in_deps)
    arm = _read(source / "arrondissement_municipal", [CODE, NAME, PARENT])
    deps = _read(source / "departement", [CODE, NAME],
                 [(CODE, "in", departements)] if departements else None)  # fmt: skip
    return split_communes(communes, arm).to_crs(crs), (
        deps.rename(columns={CODE: "code", NAME: "name"})
        .rename_geometry("geometry")
        .to_crs(crs)
        .reset_index(drop=True)
    )


def split_communes(communes: gpd.GeoDataFrame, arm: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Communes, each divided one replaced by its municipal arrondissements (whatever the
    city: the arrondissement layer names its commune)."""
    dep_of = dict(zip(communes[CODE], communes[DEP], strict=True))
    arm = arm[arm[PARENT].isin(dep_of)].to_crs(communes.crs)
    divided = set(arm[PARENT])
    whole = communes[~communes[CODE].isin(divided)]
    name_of = dict(zip(communes[CODE], communes[NAME], strict=True))
    parts = pd.DataFrame({
        "code": arm[CODE], "name": arm[NAME], "dep": arm[PARENT].map(dep_of),
        "parent": arm[PARENT], "town": arm[PARENT].map(name_of), "geometry": arm[GEOM],
    })  # fmt: skip
    rows = pd.DataFrame({
        "code": whole[CODE], "name": whole[NAME], "dep": whole[DEP], "parent": None,
        "town": whole[NAME], "geometry": whole[GEOM],
    })  # fmt: skip
    out = pd.concat([rows, parts], ignore_index=True).sort_values("code")
    return gpd.GeoDataFrame(out.reset_index(drop=True), geometry="geometry", crs=communes.crs)


def cut_edges(lines, units: gpd.GeoDataFrame, rescue_m: float) -> pd.DataFrame:
    """Each line cut into stretches by unit: (e, unit index or -1 outside, lo, hi, rescued,
    distance), distances along the line. A stretch in two overlapping units goes to the
    first; a stretch in none goes to the nearest unit within `rescue_m` (`rescued`)."""
    lines = np.asarray(lines, dtype=object)
    polys = units.geometry.values
    tree = shapely.STRtree(polys)
    length = shapely.length(lines)
    w_e, w_u = tree.query(lines, predicate="covered_by")
    first = pd.Series(w_u).groupby(w_e).min()
    whole = np.zeros(len(lines), dtype=bool)
    whole[first.index.to_numpy()] = True
    rows = [pd.DataFrame({"e": first.index.to_numpy(), "unit": first.to_numpy(), "lo": 0.0,
                          "hi": length[first.index.to_numpy()], "rescued": False,
                          "distance": 0.0})]  # fmt: skip

    rest = np.flatnonzero(~whole)
    e_idx, u_idx = tree.query(lines[rest], predicate="intersects")
    e_idx = rest[e_idx]
    pieces = shapely.intersection(lines[e_idx], polys[u_idx])
    pe, plo, phi, owner = exposure.part_intervals(lines, e_idx, pieces)
    pu = u_idx[owner]
    order = np.lexsort((plo, pe))
    pe, plo, phi, pu = pe[order], plo[order], phi[order], pu[order]
    bounds = np.searchsorted(pe, rest, side="left"), np.searchsorted(pe, rest, side="right")
    cut = []
    for e, a0, a1 in zip(rest, *bounds, strict=True):
        lo, hi, u = plo[a0:a1], phi[a0:a1], pu[a0:a1]
        cuts = np.unique(np.r_[0.0, length[e], lo, hi])
        a, b = cuts[:-1], cuts[1:]
        m = (a + b) / 2
        inside = (lo[:, None] <= m[None, :]) & (hi[:, None] >= m[None, :])
        none = np.iinfo(np.int64).max
        owner_u = np.where(inside, u[:, None], none).min(axis=0, initial=none)
        owner_u = np.where(inside.any(axis=0), owner_u, -1)
        # Contiguous elementary stretches of one owner become one stretch.
        start = np.r_[True, owner_u[1:] != owner_u[:-1]]
        run = np.cumsum(start) - 1
        for r in range(run[-1] + 1 if len(run) else 0):
            sel = run == r
            cut.append((e, int(owner_u[sel][0]), float(a[sel][0]), float(b[sel][-1])))
    cut = pd.DataFrame(cut, columns=["e", "unit", "lo", "hi"])
    cut = cut[cut.hi > cut.lo].reset_index(drop=True)
    cut["rescued"] = False
    cut["distance"] = 0.0
    gap = cut.unit.to_numpy() == -1
    if gap.any():
        mids = shapely.line_interpolate_point(
            lines[cut.e[gap].to_numpy()], ((cut.lo + cut.hi) / 2)[gap].to_numpy()
        )
        (i, j), dist = tree.query_nearest(mids, max_distance=rescue_m, return_distance=True,
                                          all_matches=False)  # fmt: skip
        idx = np.flatnonzero(gap)[i]
        cut.loc[idx, "unit"] = j
        cut.loc[idx, "rescued"] = True
        cut.loc[idx, "distance"] = dist
    rows.append(cut)
    out = pd.concat(rows, ignore_index=True)
    return out.sort_values(["e", "lo"]).reset_index(drop=True)


def filmed_by_stretch(stretches: pd.DataFrame, intervals: pd.DataFrame) -> pd.DataFrame:
    """Filmed length of each stretch (index of `stretches`) per estimate and set, the
    columns of aggregate.FILMED: the segment's filmed intervals cut at the stretch."""
    j = (
        stretches[["e", "lo", "hi"]]
        .reset_index(names="s")
        .merge(intervals[["e", "est", "pub", "dir", "lo", "hi"]], on="e", suffixes=("", "_f"))
    )
    j["m"] = (np.minimum(j.hi, j.hi_f) - np.maximum(j.lo, j.lo_f)).clip(lower=0)
    cols = {}
    for i, est in enumerate(ESTIMATES):
        for pub, suffix in ((False, ""), (True, "_pub")):
            sel = j[(j.est == i) & (j.pub == pub) & ~j.dir]
            col = f"filmed_m_{est}{suffix}"
            cols[col] = sel.groupby("s").m.sum().reindex(stretches.index, fill_value=0.0)
            if est == optics.rules()["default_estimate"]:
                sel = j[(j.est == i) & (j.pub == pub) & j.dir]
                col = f"filmed_m_{est}_dir{suffix}"
                cols[col] = sel.groupby("s").m.sum().reindex(stretches.index, fill_value=0.0)
    return pd.DataFrame(cols, index=stretches.index)[aggregate.FILMED]


def assign_points(points, units: gpd.GeoDataFrame, rescue_m: float) -> tuple[np.ndarray, ...]:
    """Unit index of each point (-1 outside), and whether it was rescued."""
    tree = shapely.STRtree(units.geometry.values)
    unit = np.full(len(points), -1)
    p, u = tree.query(points, predicate="covered_by")
    first = pd.Series(u).groupby(p).min()  # the first unit wins where two overlap
    unit[first.index.to_numpy()] = first.to_numpy()
    rescued = np.zeros(len(points), dtype=bool)
    missing = np.flatnonzero(unit == -1)
    if len(missing):
        (i, j) = tree.query_nearest(points[missing], max_distance=rescue_m, all_matches=False)
        unit[missing[i]] = j
        rescued[missing[i]] = True
    return unit, rescued


def town_operators(points, region: regions.Region) -> list[str | None]:
    """ "Ville de <commune>" for each point (metric CRS): the commune it stands in, the
    parent commune for a municipal arrondissement (Paris, Lyon, Marseille), as the areas'
    top operators name a municipal operator; None outside every commune, or without the
    region's communes. The "who films" list offers it after "Public" (phase D2)."""
    return [p[0] for p in places(points, region)]


def places(points, region: regions.Region) -> list[tuple[str | None, str | None]]:
    """(town operator, unit name) for each point (metric CRS): "Ville de <commune>" as
    town_operators says it, and the name of the commune or municipal arrondissement it
    stands in, shown by /revue (phase "Retours terrain"); None outside every unit."""
    if not region.admin:
        return [(None, None)] * len(points)
    units, _ = region_units(region)
    unit, _ = assign_points(points, units, _rules()["rescue_max_m"])
    towns, names = units.town.to_numpy(), units.name.to_numpy()
    return [(f"Ville {_of_town(towns[u])}", str(names[u])) if u >= 0 else (None, None)
            for u in unit]  # fmt: skip


@cache
def _municipal_rules() -> tuple[set, set, list, set]:
    r = normalize.rules("operators")
    m = r["municipal"]
    return set(m["generic"]), set(m["police"]), list(m["prefixes"]), set(r["no_information"])


def _of_town(town: str) -> str:
    """ "de Montrouge", "d'Asnières-sur-Seine", "du Pecq", "des Lilas"."""
    if town.startswith("Le "):
        return f"du {town[3:]}"
    if town.startswith("Les "):
        return f"des {town[4:]}"
    if town[:1].upper() in "AEIOUYÉÈÊÎÏÔÂ":
        return f"d'{town}"
    return f"de {town}"


def operator_name(op, town: str, towns: dict[str, str]) -> str | None:
    """The operator name as listed among an area's top operators: municipal names with
    their town (rules/operators.yaml `municipal`), the camera's own `town` when the name
    gives none; None for a value that says nothing about who films (`no_information`)."""
    if not isinstance(op, str) or not op.strip():
        return None
    generic, police, prefixes, no_info = _municipal_rules()
    key = normalize.name_key(op)
    if key in no_info:
        return None
    if key in generic:
        return f"Ville {_of_town(town)}"
    if key in police:
        return f"Police municipale {_of_town(town)}"
    rests = [key]
    for pre in prefixes:
        if key.startswith(pre + " "):
            rest = key[len(pre) + 1 :]
            rests.append(rest)
            for art, alt in (("de ", ""), ("d ", ""), ("du ", "le "), ("des ", "les ")):
                if rest.startswith(art):
                    rests.append(alt + rest[len(art) :])
    for rest in rests:
        if rest in towns:
            return f"Ville {_of_town(towns[rest])}"
    return op


def operator_names(cams: pd.DataFrame, towns: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Per camera: its name among the top operators (operator_name) and whether its
    operator value says nothing (`no_information`, counted apart)."""
    known = {normalize.name_key(t): t for t in towns.dropna().unique()}
    names = [
        operator_name(op, town, known)
        for op, town in zip(cams.operator_norm, cams.town, strict=True)
    ]
    _, _, _, no_info = _municipal_rules()
    uninformative = [
        isinstance(op, str) and normalize.name_key(op) in no_info for op in cams.operator_norm
    ]
    return pd.Series(names, index=cams.index), pd.Series(uninformative, index=cams.index)


def top_operators(cams: pd.DataFrame, key: str) -> pd.Series:
    """Per area, the TOP_OPERATORS operator names (column `operator_top`, else
    operator_norm) by number of cameras (then by name), as a JSON list
    [[name, count], ...]; cameras without a name are not counted."""
    col = "operator_top" if "operator_top" in cams else "operator_norm"
    cams = cams.assign(operator_norm=cams[col])
    named = cams[cams.operator_norm.apply(lambda v: isinstance(v, str) and v != "")]
    counts = named.groupby([key, "operator_norm"]).size().reset_index(name="n")
    counts = counts.sort_values([key, "n", "operator_norm"], ascending=[True, False, True])
    return counts.groupby(key).apply(
        lambda g: json.dumps(
            [[n, int(c)] for n, c in zip(g.operator_norm, g.n, strict=True)][:TOP_OPERATORS],
            ensure_ascii=False,
        ),
        include_groups=False,
    )


def aggregate_areas(
    edges: gpd.GeoDataFrame,
    intervals: pd.DataFrame,
    cams: gpd.GeoDataFrame,
    units: gpd.GeoDataFrame,
    deps: gpd.GeoDataFrame,
) -> tuple[gpd.GeoDataFrame, dict]:
    """Communes (or arrondissements) and départements with the columns of the hexagons
    (aggregate.summarise) plus names, codes and main operators; EPSG:4326. And QA stats."""
    rescue_m = _rules()["rescue_max_m"]
    # Counted segments only (exposure.mark_counted): street axes of the counted types, seen
    # from outside. Sidewalks, crossings and paths beside a road are sides of a street
    # (rules/streets.yaml parallel_path), not streets of their own; motorways and tracks are
    # drawn on the map only (drawn_highways).
    assessed = edges[edges.counted]
    lines = assessed.geometry.values
    stretches = cut_edges(lines, units, rescue_m)
    # Filmed intervals are indexed by position in `edges`; stretches by position in
    # `assessed`.
    pos = pd.Series(np.arange(len(assessed)), index=assessed.index)
    iv = intervals[intervals.e.isin(assessed.index)].copy()
    iv["e"] = pos.reindex(iv.e.to_numpy()).to_numpy()
    filmed = filmed_by_stretch(stretches, iv)
    stretches = stretches.join(filmed)
    stretches["road_m"] = stretches.hi - stretches.lo
    inside = stretches[stretches.unit >= 0]
    roads = inside.groupby("unit")[["road_m", *aggregate.FILMED]].sum()

    cam_unit, cam_rescued = assign_points(cams.geometry.values, units, rescue_m)
    cams = cams.assign(unit=cam_unit)
    placed = cams[cams.unit >= 0].copy()
    placed["dep"] = units.dep.to_numpy()[placed.unit.to_numpy()]
    placed["town"] = units.town.to_numpy()[placed.unit.to_numpy()]
    placed["operator_top"], placed["no_operator_info"] = operator_names(placed, units.town)
    noinfo = placed[placed.no_operator_info]

    com = aggregate.summarise(roads, placed, "unit").reindex(range(len(units)))
    com = _fill_empty(com)
    com["operators"] = top_operators(placed, "unit").reindex(com.index)
    com["n_no_operator_info"] = noinfo.groupby("unit").size().reindex(com.index, fill_value=0)
    com = com.join(units.drop(columns="geometry"))
    com["dep_name"] = com.dep.map(dict(zip(deps.code, deps.name, strict=True)))
    com["level"] = "commune"
    com_geom = units.geometry.values

    dep_roads = roads.join(units.dep).groupby("dep").sum()
    dep = aggregate.summarise(dep_roads, placed, "dep").reindex(deps.code)
    dep = _fill_empty(dep)
    dep["operators"] = top_operators(placed, "dep").reindex(dep.index)
    dep["n_no_operator_info"] = (
        noinfo.groupby("dep").size().reindex(dep.index, fill_value=0).to_numpy()
    )
    dep = dep.reset_index(names="code")
    dep["name"] = deps.name.to_numpy()
    dep["dep"] = dep.code
    dep["dep_name"] = dep.name
    dep["parent"] = None
    dep["town"] = None
    dep["level"] = "departement"

    cols = ["level", "code", "name", "dep", "dep_name", "parent", "road_m", *aggregate.FILMED]
    rest = [c for c in com.columns if c not in cols]
    out = pd.concat([com[cols + rest], dep[cols + rest]], ignore_index=True)
    out["operators"] = out.operators.fillna("[]")
    areas = gpd.GeoDataFrame(
        out, geometry=np.r_[com_geom, deps.geometry.values], crs=units.crs
    ).to_crs("EPSG:4326")

    total = float(assessed.length_m.sum())
    outside = stretches[stretches.unit < 0]
    rescued = stretches[stretches.rescued]
    total_filmed = {c: float(stretches[c].sum()) for c in aggregate.FILMED}
    stats = {
        "units": len(units),
        "arrondissements": int(units.parent.notna().sum()),
        "departements": len(deps),
        "road_m": round(total, 1),
        "road_in_units_m": round(float(inside.road_m.sum()), 1),
        "road_outside_m": round(float(outside.road_m.sum()), 1),
        "road_rescued_m": round(float(rescued.road_m.sum()), 1),
        "rescued_max_distance_m": round(float(rescued.distance.max()), 1) if len(rescued) else 0,
        "segments_cut": int(stretches.groupby("e").size().gt(1).sum()),
        "filmed_outside_m": {c: round(float(outside[c].sum()), 1) for c in aggregate.FILMED},
        "cameras": len(cams),
        "cameras_rescued": int(cam_rescued.sum()),
        "cameras_outside": int((cam_unit < 0).sum()),
    }
    check_sums(stretches, assessed, intervals, total_filmed)
    return areas, stats


def _fill_empty(df: pd.DataFrame) -> pd.DataFrame:
    """Areas without street nor camera: zero lengths and counts, no reliability."""
    zero = {"road_m": 0.0, "camera_count": 0, **{c: 0.0 for c in aggregate.FILMED},
            **dict.fromkeys(aggregate.COUNTS, 0)}  # fmt: skip
    zero.update({c.replace("filmed_m_", "filmed_ratio_"): 0.0 for c in aggregate.FILMED})
    return df.fillna(zero)


def check_sums(stretches: pd.DataFrame, assessed, intervals: pd.DataFrame, filmed: dict):
    """The stretches partition every assessed segment, and the filmed stretches every
    filmed interval of it (in units or outside): nothing is lost or counted twice."""
    tol = 1e-6 * max(1.0, float(assessed.length_m.sum()))
    road = float((stretches.hi - stretches.lo).sum())
    if abs(road - float(assessed.length_m.sum())) > tol:
        raise AssertionError(f"street length {road} != {assessed.length_m.sum()}")
    iv = intervals[intervals.e.isin(assessed.index)]
    for i, est in enumerate(ESTIMATES):
        for pub, suffix in ((False, ""), (True, "_pub")):
            for known, extra in ((False, ""), (True, "_dir")):
                col = f"filmed_m_{est}{extra}{suffix}"
                if col not in filmed:
                    continue
                sel = iv[(iv.est == i) & (iv.pub == pub) & (iv.dir == known)]
                want = float((sel.hi - sel.lo).sum())
                if abs(filmed[col] - want) > tol:
                    raise AssertionError(f"filmed {est}{extra}{suffix}: {filmed[col]} != {want}")
