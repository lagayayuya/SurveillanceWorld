"""Stage 4: street segments (future routing edges) and how much of each one is filmed.

A segment runs between two junctions: nodes shared by several drawn ways, or way ends.
Its id `way_id:from_node:to_node` stays stable while the way is unchanged. Every drawn way is
measured and coloured (rules/streets.yaml drawn_highways); `counted` marks the segments of
the published shares (counted_highways, street axes only).

Exposure is measured per DORI level on the coverage bands (optics.py), for each reach
estimate: `filmed_m_<level>_<estimate>` is the length inside the estimate's band;
`expected_m_<level>` integrates over the bands (the future routing cost). Everything exists
for all cameras and for public cameras only (`_pub`).
"""

from __future__ import annotations

from collections import Counter
from functools import cache
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
import shapely.ops
import yaml

from lacarte import apply, camerafilters, direction, optics, regions, robust

LEVELS = list(optics.rules()["levels"])  # detection, observation, recognition, identification
FLOOR = optics.rules()["display_floor"]  # the "filmed" share uses this level
ESTIMATES = list(optics.estimates())  # certain, probable, cautious
SETS = ("", "_pub")  # all cameras, public cameras only
# Highest level reached on an edge: 1 >= floor (shown as observation), 2, 3.
SHOWN_LEVELS = [FLOOR, "recognition", "identification"]


def at_or_above(level: str) -> list[str]:
    """`level` and the more demanding ones. Levels are nested (a street seen well enough to
    recognise is seen well enough to detect), but their bands only up to their 1 mm grid:
    a level's length is measured on the union of its band and the higher ones, so that a
    path grazing a facade is not recognised yet undetected (IDF: 366 portions, up to
    5.2 m, listed no camera)."""
    return LEVELS[LEVELS.index(level) :]


@cache
def _rules() -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / "streets.yaml").read_text())


def run(region: regions.Region) -> dict[str, Path]:
    ways = gpd.read_parquet(region.build_dir / "ways.parquet")
    bands = gpd.read_parquet(region.build_dir / "bands.parquet")
    cams = gpd.read_parquet(region.build_dir / apply.CAMERAS)
    edges = mark_counted(mark_parallel_paths(build_edges(select_ways(ways)), ways))
    pairs = edge_band_pairs(edges, bands)
    edges = expose(edges, bands, cams, pairs)
    street = camera_street(reference_areas(bands, FLOOR), cams, edges)
    paths = {
        "edges": region.build_dir / "edges.parquet",
        "camera_street": region.build_dir / "camera_street.parquet",
        "portions": region.build_dir / "street_portions.parquet",
        "intervals": region.build_dir / "filmed_intervals.parquet",
    }
    edges.to_parquet(paths["edges"])
    street.to_parquet(paths["camera_street"])
    masks = camerafilters.camera_masks(
        cams, gpd.read_parquet(region.build_dir / "views.parquet"), region.data_date()
    )
    street_portions(edges, pairs, masks=masks).to_parquet(paths["portions"])
    public = set(cams.camera_id[cams.operator_class == "public"])
    directed = {
        c.camera_id
        for c in cams[["camera_id", "kind", "directions"]].itertuples(index=False)
        if not direction.undirected(c.kind, c.directions)
    }
    filmed_intervals(edges, pairs, public, directed).to_parquet(paths["intervals"])
    return paths


def select_ways(ways: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    r = _rules()
    keep = ways.highway.isin(r["drawn_highways"]["highways"])
    keep &= ~(ways.highway.eq("service") & ways.service.isin(r["excluded_service"]))
    closed = ways.access.isin(r["closed_access"]) & ~ways.foot.isin(r["open_foot"])
    keep &= ~closed
    keep &= ~ways.area.eq("yes")
    out = ways[keep].copy()
    hidden = np.zeros(len(out), dtype=bool)
    for key, values in r["not_assessed"].items():
        hidden |= out[key].isin(values).to_numpy()
    out["assessed"] = ~hidden
    return out.reset_index(drop=True)


def build_edges(ways: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Split ways at junctions."""
    uses = Counter()
    for nodes in ways.node_ids:
        uses.update(nodes)
        uses[nodes[0]] += 1  # way ends are always split points
        uses[nodes[-1]] += 1
    rows = []
    for w in ways.itertuples(index=False):
        nodes = list(w.node_ids)
        coords = shapely.get_coordinates(w.geometry)
        if len(coords) != len(nodes):
            continue  # cannot align geometry and nodes (should not happen with use_nodes=ALL)
        start = 0
        for i in range(1, len(nodes)):
            if uses[nodes[i]] > 1 or i == len(nodes) - 1:
                seg = coords[start : i + 1]
                if len(seg) >= 2:
                    rows.append((
                        f"{w.way_id}:{nodes[start]}:{nodes[i]}", w.way_id, nodes[start], nodes[i],
                        w.highway, w.footway, w.cycleway, w.service, w.name, bool(w.assessed),
                        shapely.linestrings(seg),
                    ))  # fmt: skip
                start = i
    cols = [
        "edge_id", "way_id", "from_node", "to_node", "highway", "footway", "cycleway", "service",
        "name", "assessed", "geometry",
    ]  # fmt: skip
    df = pd.DataFrame(rows, columns=cols)
    edges = gpd.GeoDataFrame(df, geometry="geometry", crs=ways.crs)
    edges["length_m"] = edges.length
    edges["axis"] = ~not_axis(edges)
    return edges[edges.length_m > 0].reset_index(drop=True)


def not_axis(edges: pd.DataFrame) -> np.ndarray:
    """Sidewalks and crossings drawn as separate ways, cycle crossings included
    (rules/streets.yaml not_axis): no street axes (hidden at low zoom, out of the shares)."""
    out = np.zeros(len(edges), dtype=bool)
    for highway, tags in _rules()["not_axis"]["highways"].items():
        side = np.zeros(len(edges), dtype=bool)
        for key, values in tags.items():
            side |= edges[key].isin(values).to_numpy()
        out |= edges.highway.eq(highway).to_numpy() & side
    return out


def mark_parallel_paths(edges: gpd.GeoDataFrame, ways: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """`parallel`: a path beside a road (rules/streets.yaml parallel_path), which is then no
    street axis: drawn from z16 only and out of the published shares, like sidewalks."""
    rule = _rules()["parallel_path"]
    roads = ways[ways.highway.isin(rule["roads"])]
    hidden = np.zeros(len(roads), dtype=bool)
    for key, values in _rules()["not_assessed"].items():
        if key in roads:
            hidden |= roads[key].isin(values).to_numpy()
    roads = roads[~hidden]
    cand = np.flatnonzero((edges.highway.isin(rule["paths"]) & edges.axis).to_numpy())
    share = beside_share(
        edges.geometry.values[cand], edges.way_id.to_numpy()[cand], roads.geometry.values,
        roads.way_id.to_numpy(), rule["within_m"], rule["max_angle_deg"], rule["sample_m"],
    )  # fmt: skip
    parallel = np.zeros(len(edges), dtype=bool)
    parallel[cand] = share >= rule["min_share"]
    return edges.assign(parallel=parallel, axis=edges.axis.to_numpy() & ~parallel)


def mark_counted(edges: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """`counted`: a segment of the published shares (communes, départements, "between X %
    and Y %"): a street axis of a counted type (rules/streets.yaml counted_highways), not
    hidden from view (`assessed`). The others drawn (motorways, tracks) are measured and
    coloured on the map only."""
    kind = edges.highway.isin(_rules()["counted_highways"]["highways"]).to_numpy()
    return edges.assign(counted=kind & edges.axis.to_numpy() & edges.assessed.to_numpy())


def beside_share(lines, line_way, roads, road_way, within_m, max_angle_deg, step_m, chunk=500_000):
    """Share of each line's length lying within `within_m` of a road of another way whose
    direction differs by less than `max_angle_deg`, sampled at the middle of every
    `step_m` stretch (the last one shorter)."""
    lines = np.asarray(lines, dtype=object)
    share = np.zeros(len(lines))
    if not len(lines) or not len(roads):
        return share
    # Roads as straight pieces: one direction each.
    coords, owner = shapely.get_coordinates(np.asarray(roads, dtype=object), return_index=True)
    same = owner[1:] == owner[:-1]
    a, b = coords[:-1][same], coords[1:][same]
    seg_way = np.asarray(road_way)[owner[:-1][same]]
    seg_dir = b - a
    tree = shapely.STRtree(shapely.linestrings(np.stack([a, b], axis=1)))
    # Samples along the lines, with the direction of the piece they fall on.
    length = shapely.length(lines)
    n = np.maximum(1, np.ceil(length / step_m).astype(int))
    which = np.repeat(np.arange(len(lines)), n)
    start = (np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n)) * step_m
    weight = np.minimum(step_m, length[which] - start)
    at = start + weight / 2
    pts = shapely.line_interpolate_point(lines[which], at)
    ahead = shapely.line_interpolate_point(lines[which], np.minimum(at + 0.01, length[which]))
    behind = shapely.line_interpolate_point(lines[which], np.maximum(at - 0.01, 0))
    sdir = shapely.get_coordinates(ahead) - shapely.get_coordinates(behind)
    cos_max = np.cos(np.radians(max_angle_deg))
    ok = np.zeros(len(pts), dtype=bool)
    line_way = np.asarray(line_way)
    for c0 in range(0, len(pts), chunk):
        i, j = tree.query(pts[c0 : c0 + chunk], predicate="dwithin", distance=within_m)
        i = i + c0
        u, v = sdir[i], seg_dir[j]
        dot = np.abs((u * v).sum(axis=1))
        norm = np.hypot(*u.T) * np.hypot(*v.T)
        good = (dot >= cos_max * norm) & (norm > 0) & (seg_way[j] != line_way[which[i]])
        ok[i[good]] = True
    covered = np.bincount(which, weights=weight * ok, minlength=len(lines))
    return np.divide(covered, length, out=np.zeros(len(lines)), where=length > 0)


def reference_band() -> int:
    """Band of the default estimate (probable)."""
    return optics.default_estimate_index()


def reference_areas(bands: gpd.GeoDataFrame, level: str) -> gpd.GeoDataFrame:
    """One polygon per camera: its band of the default estimate at `level`."""
    sel = bands[(bands.level == level) & (bands.band == reference_band())]
    return sel[["camera_id", "geometry"]].reset_index(drop=True)


PIECE_MIN_M = 0.05  # a band touching a segment over less than this films none of it
# Bands are widened by one step of their grid before cutting the segments, and the cut is
# exact (not snapped to the grid): a path drawn on a facade lies on the edge of a band cut
# by that building; on the 1 mm grid it went in and out of the band (IDF: ~26 km missed,
# 79 % sidewalks), and snapping the cut moved a grazing path's ends by metres. Costs 1 mm
# of length where a segment crosses a band edge.
BAND_SLACK_M = robust.GRID_M


def widened(bands) -> np.ndarray:
    """Band polygons widened by BAND_SLACK_M; bevel joins keep every point within it."""
    return shapely.buffer(np.asarray(bands), BAND_SLACK_M, quad_segs=1, join_style="bevel")


def edge_band_pairs(edges: gpd.GeoDataFrame, bands: gpd.GeoDataFrame) -> pd.DataFrame:
    """Every (edge, band polygon) pair: edge index `e`, level, band, camera, and the part of
    the edge inside the band widened by BAND_SLACK_M (`piece`), in one vectorised call."""
    polys = widened(bands.geometry.values)
    tree = shapely.STRtree(polys)
    e_idx, b_idx = tree.query(edges.geometry.values, predicate="intersects")
    try:
        pieces = shapely.intersection(edges.geometry.values[e_idx], polys[b_idx])
    except shapely.errors.GEOSException:  # rare: redo pair by pair with the robust fallback
        pieces = [
            robust.intersection(a, b)
            for a, b in zip(edges.geometry.values[e_idx], polys[b_idx], strict=True)
        ]
    return pd.DataFrame({
        "e": e_idx, "level": bands.level.values[b_idx], "band": bands.band.values[b_idx],
        "cam": bands.camera_id.values[b_idx], "piece": pieces,
    })  # fmt: skip


def expose(
    edges: gpd.GeoDataFrame,
    bands: gpd.GeoDataFrame,
    cams: gpd.GeoDataFrame,
    pairs: pd.DataFrame | None = None,
) -> gpd.GeoDataFrame:
    """Filmed length per edge, DORI level, estimate and aggregate set; expected length."""
    public = set(cams.camera_id[cams.operator_class == "public"])
    thresholds = optics.thresholds()
    edges = edges.copy()
    n = len(edges)
    cam_ids: list[set] = [set() for _ in range(n)]
    ops = cams.set_index("camera_id").operator_class
    pairs = edge_band_pairs(edges, bands) if pairs is None else pairs.copy()
    pairs["pub"] = pairs.cam.isin(public)
    for e, cam in zip(pairs.e, pairs.cam, strict=True):
        cam_ids[e].add(cam)

    def covered_length(sel: pd.DataFrame) -> np.ndarray:
        """Length of each edge covered by the union of the selected pieces.

        Most edges are covered by a single camera: their lengths come in one vectorised
        call; only edges covered several times need a union.
        """
        out = np.zeros(n)
        e = sel.e.to_numpy()
        pieces = sel.piece.to_numpy()
        if not len(e):
            return out
        counts = np.bincount(e, minlength=n)
        single = counts[e] == 1
        out[e[single]] = shapely.length(pieces[single])
        multi_e, multi_p = e[~single], pieces[~single]
        if not len(multi_e):
            return out
        order = np.argsort(multi_e, kind="stable")
        multi_e, multi_p = multi_e[order], multi_p[order]
        starts = np.flatnonzero(np.r_[True, multi_e[1:] != multi_e[:-1]])
        lines = edges.geometry.values
        for a, b in zip(starts, np.r_[starts[1:], len(multi_e)], strict=True):
            out[multi_e[a]] = union_length_along(lines[multi_e[a]], multi_p[a:b])
        return out

    columns = {}
    for level in LEVELS:
        at_level = pairs[pairs.level.isin(at_or_above(level))]
        for suffix, subset in (("", at_level), ("_pub", at_level[at_level.pub])):
            # An estimate's band contains the more certain ones: measure it on their union.
            # Bands are nested only up to the 1 mm grid, and a segment running along a band
            # edge (a facade) could fall inside one band and just outside the next.
            lengths = [covered_length(subset[subset.band <= b]) for b in range(len(thresholds))]
            for est, length in zip(ESTIMATES, lengths, strict=True):
                columns[f"filmed_m_{level}_{est}{suffix}"] = length
            # E[covered length] = integral over s of length(p >= s) ds, bounded below by
            # sum_b (t_b - t_b+1) * length(p >= t_b), with t after the last band = 0.
            expected = np.zeros(n)
            for b, t in enumerate(thresholds):
                nxt = thresholds[b + 1] if b + 1 < len(thresholds) else 0.0
                expected += (t - nxt) * lengths[b]
            columns[f"expected_m_{level}{suffix}"] = expected

    for est in ESTIMATES:
        for suffix in SETS:
            filmed = columns[f"filmed_m_{FLOOR}_{est}{suffix}"]
            columns[f"filmed_m_{est}{suffix}"] = filmed
            columns[f"filmed_ratio_{est}{suffix}"] = np.clip(
                filmed / edges.length_m.to_numpy(), 0, 1
            )
            lv = np.zeros(n, dtype=int)
            for i, level in enumerate(SHOWN_LEVELS, start=1):
                lv[columns[f"filmed_m_{level}_{est}{suffix}"] > 0] = i
            columns[f"max_level_{est}{suffix}"] = lv
    edges = edges.join(pd.DataFrame(columns, index=edges.index))
    # Focus mode highlights the segments one camera films: per segment, each camera with
    # the most certain estimate whose display-floor band covers some of it ("id:band").
    floor = pairs[
        pairs.level.isin(at_or_above(FLOOR))
        & (shapely.length(pairs.piece.to_numpy()) > PIECE_MIN_M)
    ]
    first = floor.groupby(["e", "cam"]).band.min()
    cam_bands: list[list[str]] = [[] for _ in range(n)]
    for (e, cam), b in first.items():
        cam_bands[e].append(f"{cam}:{int(b)}")
    edges["camera_bands"] = [sorted(c) for c in cam_bands]
    edges["camera_count"] = [len(c) for c in cam_ids]
    edges["camera_ids"] = [sorted(c) for c in cam_ids]
    edges["operator_classes"] = [sorted({ops.get(c, "unknown") for c in cs}) for cs in cam_ids]
    edges["exposure_version"] = 4
    return edges


def intervals_along(line, pieces, tags=None):
    """Intervals [lo, hi] of distance along `line` covered by `pieces` (parts of it), with
    the tag of the piece each comes from (`tags`, one per piece; default its index).

    Each part is placed by its midpoint: on a closed segment (roundabout, loop) an end at
    the closing node is both at 0 and at the full length, a midpoint is not; a part across
    the closing node wraps around and gives two intervals.
    """
    pieces = list(pieces)
    tags = list(range(len(pieces))) if tags is None else list(tags)
    parts, part_tags = [], []
    for g, tag in zip(pieces, tags, strict=True):
        for part in shapely.get_parts(np.asarray([g], dtype=object)):
            if shapely.get_type_id(part) == 1:  # line parts; points have no length
                parts.append(part)
                part_tags.append(tag)
    if not parts:
        return np.zeros(0), np.zeros(0), []
    parts = np.asarray(parts, dtype=object)
    total_len = line.length
    mid = shapely.line_locate_point(
        line, shapely.line_interpolate_point(parts, 0.5, normalized=True)
    )
    half = shapely.length(parts) / 2
    lo, hi = mid - half, mid + half
    tags_out = list(part_tags)
    if line.is_closed:
        wrap_lo, wrap_hi = lo < 0, hi > total_len
        extra_lo = np.r_[lo[wrap_lo] + total_len, np.zeros(wrap_hi.sum())]
        extra_hi = np.r_[np.full(wrap_lo.sum(), total_len), hi[wrap_hi] - total_len]
        tags_out += [t for t, w in zip(part_tags, wrap_lo, strict=True) if w]
        tags_out += [t for t, w in zip(part_tags, wrap_hi, strict=True) if w]
        lo, hi = np.r_[lo, extra_lo], np.r_[hi, extra_hi]
    return np.clip(lo, 0, total_len), np.clip(hi, 0, total_len), tags_out


def union_length_along(line, pieces) -> float:
    """Length of `line` covered by the union of `pieces` (parts of that line).

    Measured in 1D, as a union of intervals of distance along the line: pieces cut by
    different polygons are snapped to the 1 mm grid and are not exactly collinear, and a 2D
    union of nearly collinear lines does not dissolve (it summed overlaps: 91.6 m filmed on
    a 40.9 m segment at La Défense).
    """
    lo, hi, _ = intervals_along(line, pieces)
    if not len(lo):
        return 0.0
    order = np.argsort(lo)
    total, cur_lo, cur_hi = 0.0, lo[order[0]], hi[order[0]]
    for i in order[1:]:
        if lo[i] > cur_hi:
            total += cur_hi - cur_lo
            cur_lo, cur_hi = lo[i], hi[i]
        else:
            cur_hi = max(cur_hi, hi[i])
    return float(total + cur_hi - cur_lo)


def camera_street(
    views: gpd.GeoDataFrame, cams: gpd.GeoDataFrame, edges: gpd.GeoDataFrame
) -> pd.DataFrame:
    """Per camera: street length inside the view and share of the view on street space
    (the ways of rules/streets.yaml street_space seen from outside: the counted ways and the
    motorways, not the tracks)."""
    r = _rules()
    seen = edges[edges.assessed & edges.highway.isin(r["street_space"]["highways"])]
    widths = seen.highway.map(r["half_width_m"]).fillna(r["half_width_m"]["default"])
    street_space = shapely.buffer(seen.geometry.values, widths.values, cap_style="flat")
    tree_lines = shapely.STRtree(seen.geometry.values)
    tree_space = shapely.STRtree(street_space)
    rows = []
    for v in views.itertuples(index=False):
        view = v.geometry
        if view.is_empty:
            rows.append((v.camera_id, 0.0, 0.0))
            continue
        lines = seen.geometry.values[tree_lines.query(view, predicate="intersects")]
        length = float(sum(line.intersection(view).length for line in lines))
        spaces = street_space[tree_space.query(view, predicate="intersects")]
        share = (
            view.intersection(shapely.union_all(spaces)).area / view.area if len(spaces) else 0.0
        )
        rows.append((v.camera_id, length, float(share)))
    out = pd.DataFrame(rows, columns=["camera_id", "street_len_m", "street_share"])
    k = cams.set_index("camera_id")
    kind = out.camera_id.map(k.kind)
    known_dir = out.camera_id.map(k.direction_certainty) != "default"
    surv_public = out.camera_id.map(k.tags).str.contains('"surveillance": "public"', regex=False)
    # A private individual (a validated "Particulier", phase D2) never carries the signal.
    private = out.camera_id.map(k.operator_class).eq("private_outdoor") & ~out.camera_id.map(
        apply.household(k)
    ).fillna(False).astype(bool)
    films = (known_dir & (out.street_share >= r["films_street_share"])) | (
        kind.eq("doorbell") & known_dir & (out.street_len_m >= r["doorbell_street_min_m"])
    )
    out["films_street"] = films
    out["cnil_signal"] = private & (surv_public | films)
    return out


PORTION_MIN_M = 0.05  # shorter sub-intervals are grid noise at band edges
# Drawing only: a level change shorter than this joins the neighbouring portion (the
# statistics come from the filmed intervals and are unchanged) — author's decision.
LEVEL_MERGE_M = 2.0


def part_intervals(lines, e: np.ndarray, pieces) -> tuple[np.ndarray, ...]:
    """Every line part of every piece (a part of segment `lines[e[i]]`), placed along its
    segment in one vectorised pass: (segment index, lo, hi, index of the piece).

    Each part is placed by its midpoint; on a closed segment a part across the closing
    node wraps around and gives two intervals (see intervals_along)."""
    pieces = np.array(list(pieces), dtype=object)  # writable copy for GEOS
    parts, owner = shapely.get_parts(pieces, return_index=True)
    line = shapely.get_type_id(parts) == 1
    parts, owner = parts[line], owner[line]
    e = np.asarray(e)[owner]
    seg = lines[e]
    seg_len = shapely.length(seg)
    mid = shapely.line_locate_point(
        seg, shapely.line_interpolate_point(parts, 0.5, normalized=True)
    )
    half = shapely.length(parts) / 2
    lo, hi = mid - half, mid + half
    closed = shapely.is_closed(seg)
    wrap_lo, wrap_hi = closed & (lo < 0), closed & (hi > seg_len)
    ext = np.r_[np.flatnonzero(wrap_lo), np.flatnonzero(wrap_hi)]
    ext_lo = np.r_[lo[wrap_lo] + seg_len[wrap_lo], np.zeros(wrap_hi.sum())]
    ext_hi = np.r_[seg_len[wrap_lo], hi[wrap_hi] - seg_len[wrap_hi]]
    keep = np.r_[np.arange(len(e)), ext]
    seg_len = seg_len[keep]
    lo = np.clip(np.r_[lo, ext_lo], 0, seg_len)
    hi = np.clip(np.r_[hi, ext_hi], 0, seg_len)
    return e[keep], lo, hi, owner[keep]


def merge_intervals(group: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> tuple[np.ndarray, ...]:
    """Union of intervals per group: (group, lo, hi) of the merged runs, sorted."""
    if not len(group):
        return group, lo, hi
    order = np.lexsort((lo, group))
    group, lo, hi = group[order], lo[order], hi[order]
    new_group = np.r_[True, group[1:] != group[:-1]]
    prev_max = pd.Series(hi).groupby(group).cummax().groupby(group).shift().to_numpy()
    start = new_group | ~(lo <= prev_max)
    run = np.cumsum(start) - 1
    n = run[-1] + 1
    out_lo = np.full(n, np.inf)
    out_hi = np.full(n, -np.inf)
    np.minimum.at(out_lo, run, lo)
    np.maximum.at(out_hi, run, hi)
    return group[start], out_lo, out_hi


def filmed_intervals(
    edges: gpd.GeoDataFrame,
    pairs: pd.DataFrame,
    public: set[str],
    directed: set[str] | None = None,
) -> pd.DataFrame:
    """The filmed stretches of each segment at the display floor, per estimate (`est`,
    index; a band with the more certain ones, as filmed_m_<estimate>) and aggregate set
    (`pub`): distances along the segment, merged. Their lengths add up to
    filmed_m_<estimate>[_pub]; the communes cut them at their limits.

    With `directed` (cameras with a surveyed direction, PTZ and panoramas: rules/
    direction.yaml), rows with `dir` true add the default estimate filmed by those cameras
    only: the low end of the areas' "between X % and Y %"."""
    sel = pairs[pairs.level.isin(at_or_above(FLOOR))].reset_index(drop=True)
    cols = ["e", "edge_id", "est", "pub", "dir", "lo", "hi"]
    if not len(sel):
        return pd.DataFrame({c: [] for c in cols})
    e, lo, hi, owner = part_intervals(edges.geometry.values, sel.e.to_numpy(), sel.piece)
    band = sel.band.to_numpy()[owner]
    pub = sel.cam.isin(public).to_numpy()[owner]
    n_est = len(ESTIMATES)
    frames = []
    for est in range(n_est):
        for p in (False, True):
            keep = (band <= est) & (pub if p else True)
            g, a, b = merge_intervals(e[keep], lo[keep], hi[keep])
            frames.append(
                pd.DataFrame({"e": g, "est": est, "pub": p, "dir": False, "lo": a, "hi": b})
            )
    if directed is not None:
        ref = reference_band()
        known = sel.cam.isin(directed).to_numpy()[owner]
        for p in (False, True):
            keep = (band <= ref) & known & (pub if p else True)
            g, a, b = merge_intervals(e[keep], lo[keep], hi[keep])
            frames.append(
                pd.DataFrame({"e": g, "est": ref, "pub": p, "dir": True, "lo": a, "hi": b})
            )
    out = pd.concat(frames, ignore_index=True)
    out = out[out.hi > out.lo]
    out.insert(1, "edge_id", edges.edge_id.to_numpy()[out.e.to_numpy()])
    return out.reset_index(drop=True)[cols]


def merge_short_levels(runs: list[list], min_m: float = LEVEL_MERGE_M) -> list[list]:
    """Runs of one segment ([start, end, level, first cut, last cut, signature], in order)
    with every level change shorter than `min_m` joined to a touching neighbour of the same
    signature: the longer one (the higher level on a tie), shortest runs first."""
    runs = [list(r) for r in runs]

    def joins(i: int, k: int) -> bool:
        a, b = (runs[i], runs[k]) if i < k else (runs[k], runs[i])
        return a[5] == b[5] and a[1] >= b[0] - 1e-9

    while True:
        best = None
        for i, r in enumerate(runs):
            length = r[1] - r[0]
            if length >= min_m or (best is not None and length >= best[0]):
                continue
            near = [k for k in (i - 1, i + 1) if 0 <= k < len(runs) and joins(i, k)]
            if near:
                best = (length, i, near)
        if best is None:
            return runs
        _, i, near = best
        k = max(near, key=lambda k: (runs[k][1] - runs[k][0], runs[k][2]))
        lo, hi = min(i, k), max(i, k)
        a, b = runs[lo], runs[hi]
        runs[lo : hi + 1] = [[a[0], b[1], runs[k][2], a[3], b[4], a[5]]]
        # The joined run may now continue a neighbour at its level.
        for m in (lo - 1, lo):
            if 0 <= m < len(runs) - 1 and runs[m][2] == runs[m + 1][2] and joins(m, m + 1):
                x, y = runs[m], runs[m + 1]
                runs[m : m + 2] = [[x[0], y[1], x[2], x[3], y[4], x[5]]]
                break


def street_portions(
    edges: gpd.GeoDataFrame,
    pairs: pd.DataFrame,
    estimates: list[int] | None = None,
    masks: dict[str, int] | None = None,
    profiles: bool = True,
) -> gpd.GeoDataFrame:
    """The parts of each segment that are filmed, per estimate: the segment is cut where a
    band of that estimate (or a more certain one) starts or stops covering it, where the
    highest displayed level reaching it changes (1 detection floor, 2 recognition,
    3 identification), and, with `masks` (camera id -> camerafilters.camera_mask), where
    the filterable categories of the cameras filming it at the floor change; a level change
    shorter than LEVEL_MERGE_M joins its neighbour (merge_short_levels). Each part
    lists the cameras filming some of it at the floor, as "camera:band" with the most
    certain band. Stretches no band covers are not parts: the passages between two filmed
    zones are never drawn.

    With the masks, the set of camera profiles (masks) is the same all along a part: a
    filter on who, type and the advanced rows keeps a part only where a camera it keeps
    films, alone or combined. `profiles=False` cuts on the union of the categories only
    (exact for one criterion; kept to measure the difference). Not at every camera change:
    that gave 1.75 M IDF parts and a 410 KiB z15 tile."""
    # Every level at or above the floor films; the drawn level is the highest reached.
    shown_levels = {lv: 1 for lv in at_or_above(FLOOR)} | {"recognition": 2, "identification": 3}
    if estimates is None:
        names = list(optics.estimates())
        estimates = [names.index(e) for e in optics.rules()["shown_estimates"]]
    sel = pairs[pairs.level.isin(shown_levels)].reset_index(drop=True)
    cols = ["e", "edge_id", "band", "level", "cameras", "geometry"]
    if not len(sel):
        return gpd.GeoDataFrame([], columns=cols, geometry="geometry", crs=edges.crs)
    lines = edges.geometry.values
    e, lo, hi, owner = part_intervals(lines, sel.e.to_numpy(), sel.piece.to_list())
    lvl = sel.level.map(shown_levels).to_numpy()[owner]
    band = sel.band.to_numpy()[owner]
    cam = sel.cam.to_numpy()[owner]
    # Each piece's camera profile as the filters of each estimate read it.
    emask = {
        est: np.array([camerafilters.estimate_mask((masks or {}).get(c, 0), est) for c in cam])
        for est in estimates
    }

    order = np.argsort(e, kind="stable")
    e, lo, hi, lvl, band, cam = e[order], lo[order], hi[order], lvl[order], band[order], cam[order]
    emask = {est: m[order] for est, m in emask.items()}
    starts = np.flatnonzero(np.r_[True, e[1:] != e[:-1]])
    ends = np.r_[starts[1:], len(e)]
    out = []
    for s0, s1 in zip(starts, ends, strict=True):
        edge = int(e[s0])
        for est in estimates:
            keep = np.flatnonzero(band[s0:s1] <= est) + s0
            if not len(keep):
                continue
            klo, khi, klv = lo[keep], hi[keep], lvl[keep]
            cuts = np.unique(np.r_[klo, khi])
            a, b = cuts[:-1], cuts[1:]
            m = (a + b) / 2
            inside = (klo[:, None] <= m[None, :]) & (khi[:, None] >= m[None, :])
            level = np.where(inside, klv[:, None], 0).max(axis=0)
            long_enough = (b - a) >= PORTION_MIN_M
            if masks is None:
                sig = [None] * len(m)
            else:
                floor_in = inside  # every level films (at_or_above)
                km = emask[est][keep]
                if profiles:
                    sig = [frozenset(km[floor_in[:, j]].tolist()) for j in range(len(m))]
                else:
                    sig = [int(np.bitwise_or.reduce(km[floor_in[:, j]], initial=0))
                           for j in range(len(m))]  # fmt: skip
            runs: list[list] = []  # [start, end, level, first cut, last cut, signature]
            run = None
            for j in np.flatnonzero(long_enough | (level == 0)):
                if level[j] == 0 or not long_enough[j]:
                    if level[j] == 0:
                        run = None
                    continue
                if (
                    run is not None
                    and run[2] == level[j]
                    and run[5] == sig[j]
                    and run[1] >= a[j] - 1e-9
                ):
                    run[1], run[4] = b[j], j
                else:
                    run = [a[j], b[j], int(level[j]), j, j, sig[j]]
                    runs.append(run)
            out += [(edge, est, r, keep, inside) for r in merge_short_levels(runs)]
    rows = []
    for edge, est, (a0, b0, level, j0, j1, _), keep, inside in out:
        # Cameras filming some of the run (any level), with their most certain band.
        hit = inside[:, j0 : j1 + 1].any(axis=1)
        cams: dict[str, int] = {}
        for c, bd in zip(cam[keep][hit], band[keep][hit], strict=True):
            cams[c] = min(int(bd), cams.get(c, int(bd)))
        geom = shapely.ops.substring(lines[edge], a0, b0)
        if geom.length >= PORTION_MIN_M:
            rows.append({
                "e": edge, "edge_id": edges.edge_id.iloc[edge], "band": int(est),
                "level": level, "cameras": [f"{c}:{bd}" for c, bd in sorted(cams.items())],
                "geometry": geom,
            })  # fmt: skip
    return gpd.GeoDataFrame(rows, columns=cols, geometry="geometry", crs=edges.crs)
