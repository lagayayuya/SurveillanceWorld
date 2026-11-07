"""The outlines the register's pages draw, built from the IGN's ADMIN EXPRESS COG CARTO layers
(rules/registre_geo.yaml): metropolitan France and its départements as SVG paths in the
pixels of the home's map, the overseas départements listed.

Out: <site>/geo/departements.json {v, source, licence, attribution, largeur, hauteur,
france: path, departements: {code: {nom, d}}, outre_mer: [{code, nom}]}. Written by
construire when the layers are on the machine (data/src, not versioned); else not written,
and the summary says so.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import geopandas as gpd
import shapely
import yaml

LAYER = "departement.parquet"
CODE, NAME, GEOM = "code_insee", "nom_officiel", "geometrie"
METRIC = "EPSG:2154"


def rules(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text("utf-8"))["departements"]


def source(root: Path, conf: dict[str, Any]) -> Path:
    """The layer's file, from the register's data folder (data/registre → data/src/…)."""
    return root.parent / conf["source"] / LAYER


def _path(geom: shapely.Geometry, tr: Any, nd: int) -> str:
    """An SVG path of a (multi)polygon: one subpath per ring, absolute coordinates."""
    parts = []
    for poly in getattr(geom, "geoms", [geom]):
        if poly.is_empty:
            continue
        for ring in (poly.exterior, *poly.interiors):
            pts = [tr(x, y) for x, y in ring.coords[:-1]]
            if len(pts) < 3:
                continue
            xy = [f"{x:.{nd}f} {y:.{nd}f}" for x, y in pts]
            parts.append("M" + "L".join(xy) + "Z")
    return "".join(parts)


def sans_ilots(geoms: Any, min_area: float) -> list[shapely.Geometry]:
    """Each geometry without its parts smaller than min_area that touch no other geometry:
    an islet the drawing cannot show; a part on a neighbour's border stays (no gap opens)."""
    geoms = list(geoms)
    tree = shapely.STRtree(geoms)
    out = []
    for i, g in enumerate(geoms):
        parts = list(getattr(g, "geoms", [g]))
        keep = [
            p for p in parts
            if p.area >= min_area or any(j != i for j in tree.query(p, predicate="intersects"))
        ]  # fmt: skip
        out.append(shapely.MultiPolygon(keep) if len(keep) > 1 else keep[0] if keep else g)
    return out


def departements(gdf: gpd.GeoDataFrame, conf: dict[str, Any]) -> dict[str, Any]:
    """The home's map of France: the metropolitan départements fitted in largeur×hauteur
    (north up), simplified together; the overseas ones (97x) listed."""
    gdf = gdf.rename_geometry("geometry") if gdf.geometry.name != "geometry" else gdf
    over = gdf[gdf[CODE].str.startswith("97")]
    metro = gdf[~gdf[CODE].str.startswith("97")].to_crs(METRIC).sort_values(CODE)
    w, h, m = conf["largeur"], conf["hauteur"], conf["marge"]
    x0, y0, x1, y1 = metro.total_bounds
    scale = min((w - 2 * m) / (x1 - x0), (h - 2 * m) / (y1 - y0))
    # centred in the drawing; y grows downwards in SVG
    ox = (w - (x1 - x0) * scale) / 2
    oy = (h - (y1 - y0) * scale) / 2

    def tr(x: float, y: float) -> tuple[float, float]:
        return ox + (x - x0) * scale, oy + (y1 - y) * scale

    kept = sans_ilots(metro.geometry.values, conf["ilot_min_px2"] / scale**2)
    simple = shapely.coverage_simplify(kept, conf["tolerance_px"] / scale)
    nd = conf["decimales"]
    deps = {
        code: {"nom": nom, "d": _path(g, tr, nd)}
        for code, nom, g in zip(metro[CODE], metro[NAME], simple, strict=True)
    }
    france = shapely.union_all(simple)
    return {
        "v": 1,
        "source": "IGN ADMIN EXPRESS COG CARTO",
        "licence": conf["licence"],
        "attribution": conf["attribution"],
        "largeur": w,
        "hauteur": h,
        "france": _path(france, tr, nd),
        "departements": deps,
        "outre_mer": [
            {"code": c, "nom": n} for c, n in sorted(zip(over[CODE], over[NAME], strict=True))
        ],
    }


def build(root: Path, rules_dir: Path) -> dict[str, Any] | None:
    """The file construire writes, or None when the layers are not on this machine."""
    conf = rules(rules_dir / "registre_geo.yaml")
    src = source(root, conf)
    if not src.is_file():
        return None
    return departements(gpd.read_parquet(src), conf)
