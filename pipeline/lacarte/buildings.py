"""Building obstacles: which OSM buildings block the view, and their cleanup.

Cleanup is done per processing block: repair, merge, then a morphological closing that
fills the slivers between adjoining buildings (OSM mappers often leave a few centimetres
between row houses, which would otherwise let rays through).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping

import numpy as np
import shapely
from shapely import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points

CLOSING_M = 0.5  # buffer out then in; closes gaps narrower than 2 * CLOSING_M
SNAP_OFFSET_M = 0.5  # distance from the facade for a wall-mounted camera origin
MITRE_LIMIT = 2.0
TIE_TOLERANCE_M = 1e-3  # snap directions this close to the best one count as ties
ON_OUTLINE_M = 1e-3  # a camera closer than this to an outline is on it
MAX_SNAP_M = 10.0  # deeper inside a building than this is a data error: no snapping

NON_OBSTACLE_BUILDINGS = {"roof", "carport"}


def is_obstacle(tags: Mapping[str, str]) -> bool:
    """True if an OSM building blocks the view at street level."""
    building = tags.get("building")
    if not building or building == "no":
        return False
    if building in NON_OBSTACLE_BUILDINGS:
        return False
    if tags.get("location") == "underground":
        return False
    return _layer(tags.get("layer")) >= 0


def _layer(value: str | None) -> int:
    if value is None:
        return 0
    try:
        return int(float(value.split(";")[0].strip()))
    except ValueError:
        return 0


def prepare(geoms: Iterable[BaseGeometry], closing_m: float = CLOSING_M) -> list[Polygon]:
    """Repair, merge and close building footprints. Courtyards stay as interior rings."""
    valid = []
    for g in geoms:
        if g is None or g.is_empty:
            continue
        g = shapely.make_valid(g)
        valid.extend(_polygons(g))
    if not valid:
        return []
    merged = shapely.union_all(valid)
    if closing_m > 0:
        merged = merged.buffer(closing_m, join_style="mitre", mitre_limit=MITRE_LIMIT)
        merged = merged.buffer(-closing_m, join_style="mitre", mitre_limit=MITRE_LIMIT)
    return [p for p in _polygons(merged) if p.area > 0.01]


def clusters(raw: np.ndarray, tree: shapely.STRtree, seeds: np.ndarray) -> list[np.ndarray]:
    """Groups of buildings the closing can merge (gaps under 2 * CLOSING_M), grown from `seeds`.

    Each group is a full connected component over all buildings, so preparing it gives the
    same geometry whichever processing block asks for it.
    """
    gap = 2 * CLOSING_M + 1e-6
    seen = np.zeros(len(raw), dtype=bool)
    frontier = np.unique(np.asarray(seeds, dtype=np.int64))
    seen[frontier] = True
    parent = {}

    def find(i):
        while parent.get(i, i) != i:
            parent[i] = parent.get(parent[i], parent[i])
            i = parent[i]
        return i

    while len(frontier):
        a, b = tree.query(raw[frontier], predicate="dwithin", distance=gap)
        for i, j in zip(frontier[a].tolist(), b.tolist(), strict=True):
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[max(ri, rj)] = min(ri, rj)
        new = np.unique(b[~seen[b]])
        seen[new] = True
        frontier = new

    members = np.flatnonzero(seen)
    roots = np.array([find(int(i)) for i in members])
    order = np.argsort(roots, kind="stable")
    groups = np.split(members[order], np.flatnonzero(np.diff(roots[order])) + 1)
    return [np.sort(g) for g in groups if len(g)]


def snap_origin(
    x: float, y: float, near: list[Polygon], offset: float = SNAP_OFFSET_M
) -> tuple[float, float, bool]:
    """Move a camera origin out of (or away from) the nearest building.

    Returns (x, y, snapped). A camera drawn on or inside its building outline ends up
    `offset` metres outside the nearest facade, unless it is more than MAX_SNAP_M deep
    (then it is left where it is, inside, and gets no view).
    """
    pt = Point(x, y)
    if not near:
        return x, y, False
    host = min(near, key=lambda p: p.boundary.distance(pt))
    d = host.boundary.distance(pt)
    inside = host.contains(pt)
    if not inside and d >= offset:
        return x, y, False
    if inside and d > MAX_SNAP_M:
        return x, y, False

    nearest = nearest_points(host.boundary, pt)[0]
    nx, ny = nearest.x, nearest.y
    vx, vy = (nx - x, ny - y) if inside else (x - nx, y - ny)
    norm = (vx * vx + vy * vy) ** 0.5
    if norm >= ON_OUTLINE_M:  # below this the direction to the outline is float noise
        cx, cy = nx + vx / norm * offset, ny + vy / norm * offset
        if _clearance(cx, cy, near) >= offset * 0.99:
            return cx, cy, True
    # On the outline itself (or at a corner): the escape direction is ambiguous. At a convex
    # corner every direction across the free quadrant is equally good, so take the mean of
    # the near-best directions (the bisector) rather than let float noise pick one.
    dirs = _unit_ring()
    clear = [_clearance(nx + ux * offset, ny + uy * offset, near) for ux, uy in dirs]
    best = max(clear)
    good = [d for d, c in zip(dirs, clear, strict=True) if c >= best - TIE_TOLERANCE_M]
    mx, my = sum(d[0] for d in good), sum(d[1] for d in good)
    norm = math.hypot(mx, my)
    ux, uy = (mx / norm, my / norm) if norm > 1e-9 else good[0]
    return nx + ux * offset, ny + uy * offset, True


def magnet(
    x: float, y: float, near: list[Polygon], capture_m: float
) -> tuple[float, float, bool, LineString | None]:
    """Pull a point dropped near a facade onto it, then out by the pipeline's rule.

    Participation's move mode: a point inside a building, or within `capture_m` of the
    nearest facade, ends SNAP_OFFSET_M outside that facade, placed by snap_origin itself;
    farther away (or deeper than MAX_SNAP_M) it stays. Returns (x, y, pulled, facade), the
    facade being the outline segment nearest to the result, for drawing.
    """
    if not near:
        return x, y, False, None
    pt = Point(x, y)
    host = min(near, key=lambda p: p.boundary.distance(pt))
    d = host.boundary.distance(pt)
    if not host.contains(pt):
        if d > capture_m:
            return x, y, False, None
        if d >= ON_OUTLINE_M:
            # Bring it within snap_origin's reach on the same normal to the facade; it then
            # sets the point SNAP_OFFSET_M out, with its own clearance and corner handling.
            n = nearest_points(host.boundary, pt)[0]
            k = SNAP_OFFSET_M / 2 / d
            pt = Point(n.x + (x - n.x) * k, n.y + (y - n.y) * k)
    sx, sy, snapped = snap_origin(pt.x, pt.y, near)
    if not snapped:
        return x, y, False, None
    return sx, sy, True, nearest_edge(near, sx, sy)


def nearest_edge(polys: list[Polygon], x: float, y: float) -> LineString:
    """Outline segment (two vertices) of `polys` nearest to (x, y)."""
    pt = Point(x, y)
    rings = [r for p in polys for r in (p.exterior, *p.interiors)]
    edges = []
    for ring in rings:
        c = np.asarray(ring.coords)
        edges.extend(shapely.linestrings(np.stack([c[:-1], c[1:]], axis=1)))
    return edges[int(np.argmin(shapely.distance(edges, pt)))]


def _unit_ring(n: int = 72) -> list[tuple[float, float]]:
    return [(math.cos(2 * math.pi * k / n), math.sin(2 * math.pi * k / n)) for k in range(n)]


def _clearance(x: float, y: float, polys: list[Polygon]) -> float:
    """Distance to the nearest polygon, negative when inside one."""
    pt = Point(x, y)
    best = math.inf
    for p in polys:
        d = p.boundary.distance(pt)
        best = min(best, -d if p.contains(pt) else d)
    return best


def _polygons(g: BaseGeometry) -> list[Polygon]:
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if hasattr(g, "geoms"):
        return [p for sub in g.geoms for p in _polygons(sub)]
    return []
