"""Overlay operations that survive GEOS robustness failures.

Nearly degenerate inputs (collinear slivers, vertices a few nanometres apart) can make GEOS
raise a TopologyException. The fallback snaps the operands to a millimetre grid, which is
far below the precision of the source data, and retries once.
"""

from __future__ import annotations

import shapely
from shapely.errors import GEOSException
from shapely.geometry.base import BaseGeometry

GRID_M = 0.001


def snap(g: BaseGeometry) -> BaseGeometry:
    return on_grid(shapely.make_valid(g))


def on_grid(g: BaseGeometry) -> BaseGeometry:
    """`g` on the 1 mm grid; repaired first if GEOS rejects it as it stands."""
    try:
        return shapely.set_precision(g, GRID_M)
    except GEOSException:
        return shapely.set_precision(shapely.make_valid(shapely.buffer(g, 0)), GRID_M)


def polygonal(g: BaseGeometry) -> BaseGeometry:
    """`g`'s polygons only: an overlay or the grid may collapse a sliver into a line or a
    point, which a fill cannot draw (a GeometryCollection then reaches the tiles)."""
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    # make_valid nests: GEOMETRYCOLLECTION(MULTIPOLYGON(...), LINESTRING(...)).
    parts = [q for part in shapely.get_parts(g) for q in shapely.get_parts(part)]
    polys = [q for q in parts if q.geom_type == "Polygon" and not q.is_empty]
    if not polys:
        return shapely.Polygon()
    return polys[0] if len(polys) == 1 else shapely.MultiPolygon(polys)


def intersection(a: BaseGeometry, b: BaseGeometry) -> BaseGeometry:
    try:
        return a.intersection(b)
    except GEOSException:
        return snap(a).intersection(snap(b))


def union_all(geoms) -> BaseGeometry:
    geoms = list(geoms)
    try:
        return shapely.union_all(geoms)
    except GEOSException:
        return shapely.union_all([snap(g) for g in geoms])


def difference(a: BaseGeometry, b: BaseGeometry) -> BaseGeometry:
    try:
        return a.difference(b)
    except GEOSException:
        return snap(a).difference(snap(b))
