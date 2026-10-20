"""Exact 2D viewshed of a camera among building obstacles.

Coordinates are metric (x = east, y = north). Bearings are compass angles in degrees,
clockwise from north, as in OSM `camera:direction`.

Algorithm: the visible region only changes shape at angles where a ray passes an obstacle
vertex or where an obstacle edge crosses the range circle. We cast a ray at each such
angle and at +/- EPSILON around it, along the two cone edges, and along the range arc
(sampled, the only approximation, on an arc where nothing blocks). Each ray stops at its
nearest obstacle hit or at the range. The hits, sorted by angle, form a star-shaped
polygon around the origin.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass

import numpy as np
import shapely
from shapely import Polygon
from shapely.geometry.base import BaseGeometry

EPSILON_RAD = 1e-4  # side offset around critical angles, ~5 mm at 50 m
ARC_STEP_DEG = 2.0  # sampling of the unobstructed range arc
_TWO_PI = 2.0 * math.pi
BUCKETS = 64  # angular buckets for ray / segment tests
SPAN_MARGIN_RAD = 1e-9  # widens segment spans so rays exactly on an endpoint still match


@dataclass(frozen=True)
class Sector:
    x: float
    y: float
    range_m: float
    direction_deg: float | None = None  # None means no known direction: full circle
    fov_deg: float = 360.0

    @property
    def is_full_circle(self) -> bool:
        return self.direction_deg is None or self.fov_deg >= 360.0

    def start_rad(self) -> float:
        """Bearing (radians) where the sector starts, sweeping clockwise."""
        if self.is_full_circle:
            return 0.0
        return math.radians(self.direction_deg - self.fov_deg / 2.0) % _TWO_PI

    def width_rad(self) -> float:
        return _TWO_PI if self.is_full_circle else math.radians(self.fov_deg)

    def nominal_polygon(self) -> Polygon:
        """Sector without obstacles, arc sampled like the viewshed arc."""
        start, width = self.start_rad(), self.width_rad()
        n = max(2, math.ceil(math.degrees(width) / ARC_STEP_DEG) + 1)
        rel = np.linspace(0.0, width, n)
        if self.is_full_circle:
            rel = rel[:-1]
        xs, ys = _ray_points(self, start + rel, np.full(rel.shape, self.range_m))
        coords = list(zip(xs, ys, strict=True))
        if not self.is_full_circle:
            coords = [(self.x, self.y), *coords]
        return Polygon(coords)


class ObstacleIndex:
    """Building polygons (already prepared) with a spatial index."""

    def __init__(self, polygons: list[BaseGeometry]):
        parts: list[Polygon] = []
        for geom in polygons:
            parts.extend(_polygon_parts(geom))
        self.polygons = parts
        self.tree = shapely.STRtree(parts)
        self._cache: dict = {}  # shared with the views of `carved`
        self._skip = -1  # a polygon replaced by `_extra` (carved)
        self._extra: list[Polygon] = []

    def carved(self, i: int, hole: BaseGeometry) -> ObstacleIndex:
        """The same obstacles, polygon `i` without `hole` (sharing the tree): a camera under
        that roof sees through it as far as the hole goes."""
        view = copy.copy(self)
        view._skip = i
        view._extra = _polygon_parts(self.polygons[i].difference(hole))
        return view

    def host(self, x: float, y: float) -> int | None:
        """The polygon whose interior holds (x, y) (prepared polygons are disjoint)."""
        idx = self.tree.query(shapely.Point(x, y), predicate="within")
        return int(idx.min()) if len(idx) else None

    def _query(self, geom, predicate: str) -> np.ndarray:
        idx = self.tree.query(geom, predicate=predicate)
        return idx[idx != self._skip]

    def _extra_near(self, bbox) -> list[Polygon]:
        return [p for p in self._extra if p.intersects(bbox)]

    def near_with_shrunk(self, x: float, y: float, radius: float, shrink: float):
        """Nearby polygons and the same polygons shrunk by `shrink` (computed once)."""
        if "shrunk" not in self._cache:
            self._cache["shrunk"] = shapely.buffer(np.asarray(self.polygons, dtype=object), -shrink)
        bbox = shapely.box(x - radius, y - radius, x + radius, y + radius)
        idx = self._query(bbox, "intersects")
        polys = np.asarray(self.polygons, dtype=object)[idx]
        shrunk = self._cache["shrunk"][idx]
        extra = self._extra_near(bbox)
        if not extra:
            return polys, shrunk
        extra_arr = np.asarray(extra, dtype=object)
        return (
            np.concatenate([polys, extra_arr]),
            np.concatenate([shrunk, shapely.buffer(extra_arr, -shrink)]),
        )

    def near(self, x: float, y: float, radius: float) -> list[Polygon]:
        bbox = shapely.box(x - radius, y - radius, x + radius, y + radius)  # superset of the disk
        idx = self._query(bbox, "intersects")
        return [self.polygons[i] for i in idx] + self._extra_near(bbox)

    def contains(self, x: float, y: float) -> bool:
        pt = shapely.Point(x, y)
        idx = self._query(pt, "within")
        return len(idx) > 0 or any(pt.within(p) for p in self._extra)


def compute_viewshed(sector: Sector, obstacles: ObstacleIndex) -> Polygon:
    """Visible area of `sector`, cut by `obstacles`. Empty polygon if the origin is blocked."""
    if obstacles.contains(sector.x, sector.y):
        return Polygon()

    near = obstacles.near(sector.x, sector.y, sector.range_m)
    segments = _segments(near)
    angles = _candidate_angles(sector, segments)
    dist = _nearest_hits(sector, angles, segments)

    xs, ys = _ray_points(sector, angles, dist)
    coords = list(zip(xs, ys, strict=True))
    if not sector.is_full_circle:
        coords = [(sector.x, sector.y), *coords]
    if len(coords) < 3:
        return Polygon()

    poly = shapely.make_valid(Polygon(coords))
    return _largest_polygon(poly)


def compute_camera_viewshed(sectors: list[Sector], obstacles: ObstacleIndex) -> BaseGeometry:
    """Union of the viewsheds of a camera with one or several directions."""
    views = [compute_viewshed(s, obstacles) for s in sectors]
    views = [v for v in views if not v.is_empty]
    if not views:
        return Polygon()
    return views[0] if len(views) == 1 else shapely.union_all(views)


def _candidate_angles(sector: Sector, segments: np.ndarray) -> np.ndarray:
    """Sorted absolute bearings (radians) of all rays to cast."""
    start, width = sector.start_rad(), sector.width_rad()

    arc_n = max(2, math.ceil(math.degrees(width) / ARC_STEP_DEG) + 1)
    rel = [np.linspace(0.0, width, arc_n)]

    if len(segments):
        critical = [_bearings(sector, segments[:, 0], segments[:, 1])]
        critical.append(_circle_crossings(sector, segments))
        crit = np.concatenate(critical)
        crit = crit[np.isfinite(crit)]
        for offset in (-EPSILON_RAD, 0.0, EPSILON_RAD):
            rel.append((crit + offset - start) % _TWO_PI)

    out = np.concatenate(rel)
    if not sector.is_full_circle:
        out = out[out <= width + 1e-12]
    out = np.unique(np.round(out, 12))
    if sector.is_full_circle:
        out = out[out < _TWO_PI - 1e-12]
    return start + out


def _bearings(sector: Sector, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Bearings of points that lie within range; NaN for the others."""
    dx, dy = px - sector.x, py - sector.y
    b = np.arctan2(dx, dy) % _TWO_PI
    return np.where(np.hypot(dx, dy) <= sector.range_m, b, np.nan)


def _circle_crossings(sector: Sector, seg: np.ndarray) -> np.ndarray:
    """Bearings where segments cross the range circle."""
    ox, oy, r = sector.x, sector.y, sector.range_m
    x1, y1 = seg[:, 0] - ox, seg[:, 1] - oy
    ex, ey = seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1]
    a = ex * ex + ey * ey
    b = 2.0 * (x1 * ex + y1 * ey)
    c = x1 * x1 + y1 * y1 - r * r
    disc = b * b - 4.0 * a * c
    ok = (disc >= 0) & (a > 0)
    sq = np.sqrt(np.where(ok, disc, 0.0))
    out = []
    for sign in (-1.0, 1.0):
        u = np.where(ok, (-b + sign * sq) / np.where(a > 0, 2.0 * a, 1.0), np.nan)
        valid = ok & (u >= 0.0) & (u <= 1.0)
        px, py = x1 + u * ex, y1 + u * ey
        out.append(np.where(valid, np.arctan2(px, py) % _TWO_PI, np.nan))
    return np.concatenate(out)


def _nearest_hits(sector: Sector, angles: np.ndarray, seg: np.ndarray) -> np.ndarray:
    """Distance to the nearest obstacle along each ray, capped at the range.

    Rays and segments are bucketed by bearing: a ray can only hit a segment whose angular
    span (seen from the origin) contains the ray, so each ray is only tested against the
    segments of its bucket. Same result as testing every pair, far less work at 150 m.
    """
    dist = np.full(angles.shape, float(sector.range_m))  # an int range would floor every hit
    if not len(seg):
        return dist
    a1 = np.arctan2(seg[:, 0] - sector.x, seg[:, 1] - sector.y) % _TWO_PI
    a2 = np.arctan2(seg[:, 2] - sector.x, seg[:, 3] - sector.y) % _TWO_PI
    d = (a2 - a1) % _TWO_PI
    start = np.where(d <= math.pi, a1, a2) - SPAN_MARGIN_RAD
    length = np.where(d <= math.pi, d, _TWO_PI - d) + 2 * SPAN_MARGIN_RAD
    width = _TWO_PI / BUCKETS
    first = np.floor((start % _TWO_PI) / width).astype(np.int64)
    count = np.minimum(
        np.floor(((start % _TWO_PI) + length) / width).astype(np.int64) - first + 1, BUCKETS
    )
    seg_idx = np.repeat(np.arange(len(seg)), count)
    offsets = np.arange(len(seg_idx)) - np.repeat(np.cumsum(count) - count, count)
    seg_bucket = (np.repeat(first, count) + offsets) % BUCKETS
    ray_bucket = np.floor((angles % _TWO_PI) / width).astype(np.int64) % BUCKETS

    order = np.argsort(seg_bucket, kind="stable")
    seg_idx, seg_bucket = seg_idx[order], seg_bucket[order]
    bounds = np.searchsorted(seg_bucket, np.arange(BUCKETS + 1))
    for b in np.unique(ray_bucket):
        segs = seg_idx[bounds[b] : bounds[b + 1]]
        if not len(segs):
            continue
        rays = np.flatnonzero(ray_bucket == b)
        dist[rays] = np.minimum(dist[rays], _hits(sector, angles[rays], seg[segs]))
    return dist


def _hits(sector: Sector, angles: np.ndarray, seg: np.ndarray) -> np.ndarray:
    """Nearest hit distance of each ray against every given segment (inf if none)."""
    dx, dy = np.sin(angles)[:, None], np.cos(angles)[:, None]
    px, py = (seg[:, 0] - sector.x)[None, :], (seg[:, 1] - sector.y)[None, :]
    ex, ey = (seg[:, 2] - seg[:, 0])[None, :], (seg[:, 3] - seg[:, 1])[None, :]
    denom = dx * ey - dy * ex
    with np.errstate(divide="ignore", invalid="ignore"):
        t = (px * ey - py * ex) / denom
        u = (px * dy - py * dx) / denom
    hit = (np.abs(denom) > 1e-15) & (t >= 0.0) & (u >= -1e-12) & (u <= 1.0 + 1e-12)
    return np.where(hit, t, np.inf).min(axis=1)


def _ray_points(sector: Sector, angles: np.ndarray, dist: np.ndarray):
    return sector.x + dist * np.sin(angles), sector.y + dist * np.cos(angles)


def _segments(polygons: list[Polygon]) -> np.ndarray:
    """All ring edges (exteriors and courtyards) as an (n, 4) array x1, y1, x2, y2."""
    rings = []
    for poly in polygons:
        rings.append(np.asarray(poly.exterior.coords))
        rings.extend(np.asarray(r.coords) for r in poly.interiors)
    if not rings:
        return np.empty((0, 4))
    return np.concatenate([np.hstack([r[:-1, :2], r[1:, :2]]) for r in rings])


def _polygon_parts(geom: BaseGeometry) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in _polygon_parts(g)]
    return []


def _largest_polygon(geom: BaseGeometry) -> Polygon:
    parts = _polygon_parts(geom)
    if not parts:
        return Polygon()
    return max(parts, key=lambda p: p.area)
