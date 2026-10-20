"""Quality checks on viewsheds, run on every camera by the `qa` stage."""

from __future__ import annotations

import math

import numpy as np
import shapely
from shapely import Polygon
from shapely.geometry.base import BaseGeometry

from lacarte import optics, robust
from lacarte.viewshed import Sector

SECTOR_TOLERANCE_M = 0.01
MAX_BUILDING_OVERLAP_M2 = 0.5
SPIKE_HALF_WIDTH_M = 0.5  # opening removes parts narrower than twice this
SPIKE_MIN_AREA_M2 = 0.5
UNCUT_MIN_OVERLAP_M2 = 1.0
LEAK_CONTACT_M = 0.05  # outline within this distance of a building touches it
LEAK_GAP_M = 0.3  # closer than this = adjoining buildings mapped with a sliver [TO ADJUST]
LEAK_ZONE_MIN_M2 = 0.25  # view area inside such a gap that makes a leak [TO ADJUST]


def outside_sector(view: BaseGeometry, sectors: list[Sector]) -> bool:
    """True if some vertex of `view` lies outside every sector (range or angle)."""
    if view.is_empty:
        return False
    coords = shapely.get_coordinates(view)
    ok = np.zeros(len(coords), dtype=bool)
    for s in sectors:
        ok |= _in_sector(coords, s)
    return not bool(ok.all())


def _in_sector(coords: np.ndarray, s: Sector) -> np.ndarray:
    dx, dy = coords[:, 0] - s.x, coords[:, 1] - s.y
    dist = np.hypot(dx, dy)
    in_range = dist <= s.range_m + SECTOR_TOLERANCE_M
    if s.is_full_circle:
        return in_range
    rel = (np.arctan2(dx, dy) - s.start_rad()) % (2 * math.pi)
    # angular tolerance expressed as SECTOR_TOLERANCE_M at the vertex distance
    tol = np.where(dist > 0, SECTOR_TOLERANCE_M / np.maximum(dist, 1e-9), math.pi)
    width = s.width_rad()
    in_angle = (rel <= width + tol) | (rel >= 2 * math.pi - tol) | (dist <= SECTOR_TOLERANCE_M)
    return in_range & in_angle


OVERLAP_SHRINK_M = 0.01  # buildings the view only touches (< 1 cm) are skipped


def building_overlap_m2(view: BaseGeometry, buildings, shrunk=None) -> float:
    """Area of `view` inside buildings. With `shrunk` (the same buildings shrunk by
    OVERLAP_SHRINK_M), only buildings the view really enters are intersected exactly."""
    if view.is_empty or not len(buildings):
        return 0.0
    blds = np.asarray(buildings, dtype=object)
    if shrunk is not None:
        shapely.prepare(view)
        blds = blds[shapely.intersects(view, np.asarray(shrunk, dtype=object))]
        if not len(blds):
            return 0.0
    return _overlap(view, blds)


def _overlap(area: BaseGeometry, buildings: np.ndarray) -> float:
    """Area shared with buildings, one vectorised call on the buildings that intersect."""
    shapely.prepare(area)
    hits = buildings[shapely.intersects(area, buildings)]
    if not len(hits):
        return 0.0
    try:
        return float(shapely.area(shapely.intersection(area, hits)).sum())
    except shapely.errors.GEOSException:
        return float(sum(robust.intersection(area, b).area for b in hits))


def spike_area_m2(view: BaseGeometry) -> float:
    """Largest part of `view` narrower than 2 * SPIKE_HALF_WIDTH_M (morphological opening).

    Mitre joins keep the sharp but legitimate corners of the view (cone apex, shadow
    edges) instead of rounding them off, so only genuinely thin parts are removed.
    """
    return spike_and_leak(view, [])[0]


def leak_area_m2(view: BaseGeometry, buildings: list[Polygon]) -> float:
    """Largest thin part whose outline lies mostly against buildings."""
    return spike_and_leak(view, buildings)[1]


def spike_and_leak(view: BaseGeometry, buildings: list[Polygon]) -> tuple[float, float]:
    """(largest thin part, largest leak) with a single opening.

    A leak is a thin part that runs between two distinct buildings closer than LEAK_GAP_M:
    adjoining buildings mapped with a sliver between them, which the closing is meant to
    fill, and through which rays escape. A thin part along one facade, past a corner, down
    a street, or through a real passage between separate buildings seen at a grazing angle
    is legitimate.
    """
    if view.is_empty:
        return 0.0, 0.0
    opts = {"join_style": "mitre", "mitre_limit": 10.0}
    opened = view.buffer(-SPIKE_HALF_WIDTH_M, **opts).buffer(SPIKE_HALF_WIDTH_M, **opts)
    removed = robust.difference(view, opened)
    parts = [
        p
        for p in getattr(removed, "geoms", [removed])
        if p.geom_type == "Polygon" and not p.is_empty
    ]
    spike = max((p.area for p in parts), default=0.0)
    if not buildings:
        return spike, 0.0
    blds = np.asarray(buildings, dtype=object)
    leak = 0.0
    for p in parts:
        if p.area <= SPIKE_MIN_AREA_M2 or p.area <= leak:
            continue
        touching = blds[shapely.distance(p, blds) <= LEAK_CONTACT_M]
        if len(touching) >= 2 and _passes_through_a_gap(p, touching):
            leak = p.area
    return spike, leak


def _passes_through_a_gap(part: BaseGeometry, touching: np.ndarray) -> bool:
    """True if the part runs through the gap between two buildings closer than LEAK_GAP_M.

    The gap zone of two buildings is where a point is within LEAK_GAP_M of both. A sliver
    squeezed through the gap lies in that zone; a sliver running along two close
    buildings on the same side only grazes a corner of it.
    """
    for i in range(len(touching)):
        for j in range(i + 1, len(touching)):
            a, b = touching[i], touching[j]
            if a.distance(b) >= LEAK_GAP_M:
                continue
            zone = robust.intersection(a.buffer(LEAK_GAP_M), b.buffer(LEAK_GAP_M))
            if robust.intersection(part, zone).area >= LEAK_ZONE_MIN_M2:
                return True
    return False


def is_uncut(
    view: BaseGeometry,
    sectors: list[Sector],
    buildings: list[Polygon],
    view_overlap: float | None = None,
) -> bool:
    """True if buildings stand inside the nominal sector but the view ignores them."""
    if not len(buildings):
        return False
    nominal = robust.union_all([s.nominal_polygon() for s in sectors])
    blocked = _overlap(nominal, np.asarray(buildings, dtype=object))
    if blocked < UNCUT_MIN_OVERLAP_M2:
        return False
    overlap = view_overlap if view_overlap is not None else building_overlap_m2(view, buildings)
    return overlap >= 0.5 * blocked


NESTING_TOLERANCE_M2 = 0.01
NESTING_SLACK_M = 0.002
GRID = robust.GRID_M


def band_nesting_violations(bands) -> int:
    """Count (camera, level, band) polygons sticking out of the band or level that should
    contain them: a less certain band of the same level, or the same band one level down."""
    levels = list(optics.rules()["levels"])
    geom = {(r.camera_id, r.level, r.band): r.geometry for r in bands.itertuples(index=False)}
    bad = 0
    for (cam, level, band), g in geom.items():
        wider = [geom.get((cam, level, band + 1))]
        li = levels.index(level)
        if li > 0:
            wider.append(geom.get((cam, levels[li - 1], band)))
        for w in wider:
            # Bands are stored on the 1 mm grid, each snapped on its own: containment is
            # checked up to NESTING_SLACK_M, with a snap-rounding overlay (robust where plain
            # overlays silently failed at Lambert-93 coordinates).
            if w is None:
                continue
            outside = g.difference(w.buffer(NESTING_SLACK_M), grid_size=GRID).area
            if outside > NESTING_TOLERANCE_M2:
                bad += 1
                break
    return bad


STREET_SLACK_M = 0.01  # bands are cut on a 1 mm grid: lengths agree to about a centimetre


def street_estimate_violations(edges, levels, estimates, sets=("", "_pub")) -> int:
    """Count (edge, level, set) where a more certain estimate films more of the edge than a
    less certain one: bands are nested, so filmed length must grow from certain to cautious."""
    bad = 0
    for level in levels:
        for suffix in sets:
            cols = [edges[f"filmed_m_{level}_{est}{suffix}"].to_numpy() for est in estimates]
            for inner, outer in zip(cols, cols[1:], strict=False):
                bad += int((inner > outer + STREET_SLACK_M).sum())
    return bad


PORTION_TOLERANCE_M = 1.0  # a drawn street portion may stray this far from the fields
PORTION_STEP_M = 2.0  # sampling step along a portion


def portion_violations(portions, bands, floor: str | None = None) -> int:
    """Count drawn street portions with a point farther than PORTION_TOLERANCE_M from every
    display-floor field of their estimate (band <= the portion's): a portion outside the
    union of the fields, or a passage between two fields drawn as filmed. Points are
    sampled every PORTION_STEP_M, ends included."""
    floor = floor or optics.rules()["display_floor"]
    fields = bands[bands.level == floor]
    if not len(portions) or not len(fields):
        return 0
    tree = shapely.STRtree(fields.geometry.values)
    field_band = fields.band.to_numpy()
    geoms = portions.geometry.values
    n = np.maximum(2, np.ceil(shapely.length(geoms) / PORTION_STEP_M).astype(int) + 1)
    owner = np.repeat(np.arange(len(geoms)), n)
    # Fractions 0 .. 1 in n steps per portion, all portions at once.
    first = np.repeat(np.cumsum(n) - n, n)
    frac = (np.arange(len(owner)) - first) / np.repeat(n - 1, n)
    pts = shapely.line_interpolate_point(geoms[owner], frac, normalized=True)
    p_idx, f_idx = tree.query(pts, predicate="dwithin", distance=PORTION_TOLERANCE_M)
    ok = field_band[f_idx] <= portions.band.to_numpy()[owner[p_idx]]
    covered = np.zeros(len(pts), dtype=bool)
    covered[p_idx[ok]] = True
    return int(len(set(owner[~covered].tolist())))
