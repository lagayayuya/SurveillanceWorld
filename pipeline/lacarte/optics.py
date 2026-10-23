"""Observation levels (DORI, IEC 62676-4) and their uncertain coverage.

A camera reaches level L (pixels per metre) up to d_L = H / (2 L tan(F / 2)), with H the
horizontal resolution and F the horizontal field of view. Neither is known for most
cameras, so each camera type gets a distribution of (H, F), from the catalogue
(rules/optics.yaml, `distributions`, per generation), mixed over the probable age of the
installed base. It is represented by weighted samples. At a point, p = weight share of the
samples that cover it (inside the sample's sector and within its d_L). Bands are the
regions where p >= t for a few thresholds t.

Coordinates are metric, relative to the camera; bearings clockwise from north, as in
viewshed.py. Everything here is pure geometry; the pipeline cuts bands by buildings.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cache

import numpy as np
import shapely
from shapely import Polygon
from shapely.geometry.base import BaseGeometry

from lacarte import regions, robust

ARC_STEP_DEG = 2.0


@cache
def rules() -> dict:
    import yaml

    return yaml.safe_load((regions.ROOT / "rules" / "optics.yaml").read_text())


def estimates() -> dict[str, float]:
    """Reach estimates, most to least certain: name -> minimum share of samples."""
    return dict(rules()["estimates"])


def thresholds() -> list[float]:
    return list(estimates().values())


def default_estimate_index() -> int:
    return list(estimates()).index(rules()["default_estimate"])


def opening_estimate_index() -> int:
    """Estimate the map opens on (web only; the pipeline's reference is the default one)."""
    return list(estimates()).index(rules()["opening_estimate"])


def shown_estimates() -> list[int]:
    """Estimates drawn on the map, by their index in estimates() (tiles keep that index)."""
    names = list(estimates())
    return [names.index(e) for e in rules()["shown_estimates"]]


# Map levels: the display floor (detection, >= 25 PPM, shown as "observation"), then
# recognition and identification; codes 1, 2, 3 in tiles and in the live field (`lv`).
# The observation level proper (62.5) is stored only.
DISPLAYED_LEVELS = ["detection", "recognition", "identification"]


def label_m(metres: float) -> float:
    """A reach as written on the map and the sheet: rounded up to the metre (5.6 m -> 6 m;
    DECISIONS 2026-10-08, « The more vivid… »), after rounding to the micrometre so that a
    reach computed as 6.0000000001 m stays 6 m."""
    return float(math.ceil(round(metres, 6)))


# Above this field of view a lens is a fisheye, not rectilinear [TO ADJUST].
FISHEYE_FROM_DEG = 150.0


def level_range(resolution_px: float, hfov_deg: float, ppm: float) -> float:
    """Distance (m) up to which a camera delivers `ppm` pixels per metre.

    Rectilinear lens: the image spans 2 d tan(F / 2) metres at distance d. Fisheye (F above
    FISHEYE_FROM_DEG): pixels are spread evenly over the angle (equidistant projection) and
    the image diameter covers at most 180 degrees, even for 360-degree cameras, so d =
    H / (ppm * F) with F in radians, capped at 180 degrees.
    """
    if hfov_deg > FISHEYE_FROM_DEG:
        return resolution_px / (ppm * math.radians(min(hfov_deg, 180.0)))
    return resolution_px / (2.0 * ppm * math.tan(math.radians(hfov_deg) / 2.0))


Sample = tuple[float, float, float]  # (horizontal resolution px, horizontal fov deg, weight)

# Points standing for the lower, middle and upper thirds of a distribution given by its
# 10th, 50th and 90th percentiles: the tercile midpoints (1/6, 1/2, 5/6), interpolated in
# log space as if each half were log-normal: z(5/6) / z(0.9) = 0.9674 / 1.2816.
TERCILE_FACTOR = 0.9674 / 1.2816


def tercile_points(p10: float, p50: float, p90: float) -> list[float]:
    lo = math.exp(math.log(p50) + TERCILE_FACTOR * (math.log(p10) - math.log(p50)))
    hi = math.exp(math.log(p50) + TERCILE_FACTOR * (math.log(p90) - math.log(p50)))
    return [lo, p50, hi]


def distribution(kind: str, generation: str) -> dict:
    """{resolution_px: [p10, p50, p90], hfov_deg: [...]} of a type and generation, falling
    back to the type over all generations when the cell has too few catalogue models."""
    d = rules()["distributions"][kind]
    cell = (d.get("generations") or {}).get(generation) or {}
    return cell if "resolution_px" in cell else d["pooled"]


def optics_kind(kind: str) -> str:
    """The kind whose optics a camera of `kind` has: an assembly's (rules/optics.yaml
    assemblies: a multi-dome's domes are domes), else its own."""
    return rules()["assemblies"].get(kind, {}).get("optics_of", kind)


def full_circle(kind: str) -> bool:
    """Whether a camera of `kind` films all around whatever its surveyed directions (an
    assembly whose opening is 360 degrees: rules/optics.yaml assemblies)."""
    return rules()["assemblies"].get(kind, {}).get("opening_deg", 0) >= 360


def opening_deg(kind: str) -> float:
    """The widest opening of a camera of `kind` around one direction: the drawn sector
    (normalize's fov_deg). An assembly's own (a multi-dome: 360), else the widest field of
    view of its samples."""
    return float(rules()["assemblies"].get(kind, {}).get("opening_deg", fov_bounds(kind)[1]))


@cache
def samples(kind: str) -> tuple[Sample, ...]:
    """Weighted (resolution, hfov) samples of a camera type: for each generation, weighted
    by the installed-base mix, the 3 x 3 grid of tercile points of both axes (taken as
    independent). Identical samples are merged. An assembly's are those of the kind of its
    cameras (optics_kind: a multi-dome's are a dome's)."""
    kind = optics_kind(kind)
    cal = rules()["calibration"]
    mixed = cal["unknown_kind_mix"] if kind == "unknown" else {kind: 1.0}
    acc: dict[tuple[float, float], float] = {}
    for k, w_kind in mixed.items():
        for gen, w_gen in cal["generation_mix"].items():
            d = distribution(k, gen)
            for r in tercile_points(*d["resolution_px"]):
                for f in tercile_points(*d["hfov_deg"]):
                    key = (round(r, 3), round(f, 4))
                    acc[key] = acc.get(key, 0.0) + w_kind * w_gen / 9
    total = sum(acc.values())
    return tuple((r, f, w / total) for (r, f), w in sorted(acc.items()))


def _weighted(sample_list) -> list[Sample]:
    """Accept plain (resolution, hfov) pairs as equally weighted samples."""
    return [s if len(s) == 3 else (s[0], s[1], 1.0) for s in sample_list]


def max_reach(kind: str) -> float:
    """Farthest distance where any sample of the kind reaches the lowest drawn level
    (capped): a camera's range_m (normalize), also for a kind a contribution gives."""
    floor = rules()["levels"][rules()["display_floor"]]
    return reach_at_share(samples(kind), floor, 0.0)


def fov_bounds(kind: str) -> tuple[float, float]:
    """Narrowest and widest horizontal field of view of the kind's samples (fov_lo,
    fov_hi; the widest bounds the drawn sector, normalize's fov_deg)."""
    fov = [f for _, f, _ in samples(kind)]
    return min(fov), max(fov)


def tele_reach_m(kind: str = "ptz") -> float:
    """Zoomed-in observation reach of a PTZ camera, for its outline: 90th-percentile
    resolution at the 10th-percentile tele field of view, capped by `reach_cap_m`."""
    d = rules()["distributions"][kind]["pooled"]
    ppm = rules()["levels"]["observation"]
    reach = level_range(d["resolution_px"][2], d["tele_hfov_deg"][0], ppm)
    return min(reach, rules()["reach_cap_m"])


def reach_at_share(sample_list, ppm: float, share: float, cap: float | None = None) -> float:
    """Distance along the axis up to which at least `share` of the sample weight reaches
    `ppm` (the radial extent of the band of that share, ignoring blind zones)."""
    cap = cap if cap is not None else rules()["max_range_m"]
    ranked = sorted(
        ((level_range(r, f, ppm), w) for r, f, w in _weighted(sample_list)), reverse=True
    )
    total = sum(w for _, w in ranked)
    acc = 0.0
    for reach, w in ranked:
        acc += w
        if acc >= share * total - 1e-9:
            return min(reach, cap)
    return min(ranked[-1][0], cap)


@dataclass(frozen=True)
class Mount:
    """Height and downward tilt, used only when both are at least estimated."""

    height_m: float
    tilt_deg: float


def sample_extent(
    resolution_px: float, hfov_deg: float, ppm: float, mount: Mount | None, cap: float
) -> tuple[float, float]:
    """Ground interval [near, far] (m) where one sample reaches `ppm`."""
    reach = level_range(resolution_px, hfov_deg, ppm)
    if mount is None:
        return 0.0, min(reach, cap)
    h, tilt = mount.height_m, mount.tilt_deg
    vfov = math.degrees(
        2 * math.atan(math.tan(math.radians(hfov_deg) / 2) * rules()["aspect_ratio"])
    )
    ground = math.sqrt(max(reach * reach - h * h, 0.0))  # PPM is set by the slant distance
    low_edge = tilt + vfov / 2
    near = h / math.tan(math.radians(low_edge)) if low_edge < 90 else 0.0
    high_edge = tilt - vfov / 2
    far = h / math.tan(math.radians(high_edge)) if high_edge > 0 else math.inf
    return near, min(ground, far, cap)


def coverage(
    direction_deg: float | None,
    sample_list,
    ppm: float,
    threshold: float,
    mount: Mount | None = None,
    cap: float | None = None,
) -> BaseGeometry:
    """Region where at least `threshold` of the sample weight reaches `ppm` (0 = at least
    one sample). Samples are (resolution, hfov, weight), or unweighted pairs.

    Exact up to arc sampling: in each angular slice between consecutive sample half-angles,
    the samples wide enough are known, and the weight along a ray is piecewise constant.
    """
    cap = cap if cap is not None else rules()["max_range_m"]
    weighted = _weighted(sample_list)
    total = sum(w for _, _, w in weighted)
    need = max(threshold * total - 1e-9, 1e-12)
    half, extent, weight = [], [], []
    for res, fov, w in weighted:
        a = 180.0 if direction_deg is None else min(fov / 2.0, 180.0)
        half.append(a)
        extent.append(sample_extent(res, fov, ppm, mount, cap))
        weight.append(w)
    n = len(weighted)
    angles = sorted(set(half), reverse=True)
    pieces: list[Polygon] = []
    for j, a_out in enumerate(angles):
        a_in = angles[j + 1] if j + 1 < len(angles) else 0.0
        active = [(extent[i], weight[i]) for i in range(n) if half[i] >= a_out]
        for r0, r1 in _intervals_with_weight(active, need):
            pieces.extend(_slice(direction_deg, a_in, a_out, r0, r1))
    return union_slices(pieces)


def union_slices(pieces: list[Polygon]) -> BaseGeometry:
    """Union of adjacent annular sectors, with snap rounding on the 1 mm grid: a plain
    GEOS union silently dropped a whole 0.95-degree sector (24 m2) of an IDF camera, which
    broke the nesting of levels. The result is on the grid the bands are stored on."""
    if not pieces:
        return Polygon()
    try:
        out = shapely.make_valid(shapely.union_all(pieces, grid_size=robust.GRID_M))
    except shapely.errors.GEOSException:
        out = shapely.make_valid(robust.union_all(pieces))
    return closed(out)


def closed(g: BaseGeometry) -> BaseGeometry:
    """A band without the hairlines the snap rounding leaves in it.

    Two slices meet along a ray; where one ends inside the other's edge, its corner snapped
    to the 1 mm grid falls up to 0.7 mm off that edge: the union kept two parts touching at
    the camera with a hairline between them, or one part with a slit 0.7 mm wide running in
    from its edge (up to tens of metres). The map drew it as a light line from the camera
    across the field (2026-10-11: a pending add at 213°, tilted slightly down). A closing by
    one grid step (buffer out, then in, mitred) welds every such gap; gaps wider than 2 mm,
    the sample model's real lobes, stay. Applied to every band alike: a closing keeps a band
    inside any band that contained it, so the levels stay nested."""
    if g.is_empty:
        return g
    step = robust.GRID_M
    # Floating precision first: a band from on_grid carries its 1 mm grid, and GEOS then
    # buffers on that grid — the inward step collapsed whole bands to nothing (IDF build of
    # 2026-10-11: n2513702649 lost every « détecte » band).
    g = shapely.set_precision(g, 0.0)
    welded = shapely.buffer(shapely.buffer(g, step, join_style="mitre", mitre_limit=10.0),
                            -step, join_style="mitre", mitre_limit=10.0)  # fmt: skip
    return robust.polygonal(robust.on_grid(shapely.make_valid(welded)))


def _intervals_with_weight(
    extents: list[tuple[tuple[float, float], float]], need: float
) -> list[tuple[float, float]]:
    """Radial intervals where the [near, far] extents present weigh at least `need`."""
    if sum(w for _, w in extents) < need:
        return []
    events = sorted({e for (pair, _) in extents for e in pair})
    out = []
    for r0, r1 in zip(events[:-1], events[1:], strict=True):
        mid = (r0 + r1) / 2
        if sum(w for (lo, hi), w in extents if lo <= mid <= hi) >= need:
            if out and abs(out[-1][1] - r0) < 1e-9:
                out[-1] = (out[-1][0], r1)
            else:
                out.append((r0, r1))
    return [(a, b) for a, b in out if b > a]


def _slice(direction: float | None, a_in: float, a_out: float, r0: float, r1: float):
    """Annular sector(s) for |bearing - direction| in [a_in, a_out], radius in [r0, r1]."""
    if direction is None or a_out >= 180.0:
        if a_in <= 0.0:
            return [_annulus(0.0, 360.0, r0, r1)]
        d = direction or 0.0
        return [_annulus(d + a_in, 360.0 - 2 * a_in, r0, r1)]
    if a_in <= 0.0:
        return [_annulus(direction - a_out, 2 * a_out, r0, r1)]
    return [
        _annulus(direction + a_in, a_out - a_in, r0, r1),
        _annulus(direction - a_out, a_out - a_in, r0, r1),
    ]


def _annulus(start_deg: float, width_deg: float, r0: float, r1: float) -> Polygon:
    """Annular sector from bearing `start_deg`, clockwise over `width_deg`.

    Arc vertices sit on a global grid of bearings (multiples of ARC_STEP_DEG) plus the two
    ends, so that every band of every level shares the same arc vertices: a chord of a
    smaller band can then never stick out of a larger one (at 150 m a 2 deg chord sags
    by 2.3 cm, enough to break nesting when grids differ).
    """
    first = math.ceil(start_deg / ARC_STEP_DEG) * ARC_STEP_DEG
    grid = np.arange(first, start_deg + width_deg, ARC_STEP_DEG)
    deg = np.unique(np.concatenate([[start_deg], grid, [start_deg + width_deg]]))
    b = np.radians(deg)
    outer = np.column_stack([r1 * np.sin(b), r1 * np.cos(b)])
    if width_deg >= 360.0 - 1e-9:
        ring = Polygon(outer[:-1])
        return ring if r0 <= 0 else ring.difference(Polygon(r0 * outer[:-1] / r1))
    if r0 <= 0:
        return Polygon([(0.0, 0.0), *outer])
    inner = np.column_stack([r0 * np.sin(b), r0 * np.cos(b)])[::-1]
    return Polygon([*outer, *inner])
