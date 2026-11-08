"""The outlines the register's pages draw, built from the IGN's ADMIN EXPRESS COG CARTO layers
(rules/registre_geo.yaml): metropolitan France and its départements as SVG paths in the
pixels of the home's map, the overseas départements listed; each département's communes
in the pixels of its own map (the département's page, a commune's neighbours).

Out: <site>/geo/departements.json {v, source, licence, attribution, largeur, hauteur,
france: path, departements: {code: {nom, d}}, outre_mer: [{code, nom}]}, and
<site>/geo/communes-<dep>.json {v, source, licence, attribution, largeur, hauteur,
departement: {code, nom, d}, communes: {insee: {nom, d}}}. Written by construire when the
layers are on the machine (data/src, not versioned); else not written, and the summary says
so.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
import shapely
import yaml

LAYER = "departement.parquet"
LAYER_COMMUNES = "commune.parquet"
DEP_OF = "code_insee_du_departement"
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


def _fit(bounds: Any, w: float, h: float, m: float) -> tuple[Any, float]:
    """The transform that fits `bounds` (metres) in w×h pixels with a margin, centred, north
    up (y grows downwards in SVG), and its scale."""
    x0, y0, x1, y1 = bounds
    scale = min((w - 2 * m) / (x1 - x0), (h - 2 * m) / (y1 - y0))
    ox = (w - (x1 - x0) * scale) / 2
    oy = (h - (y1 - y0) * scale) / 2

    def tr(x: float, y: float) -> tuple[float, float]:
        return ox + (x - x0) * scale, oy + (y1 - y) * scale

    return tr, scale


def communes(gdf: gpd.GeoDataFrame, dep: str, nom: str | None, conf: dict[str, Any],
             crs: str = METRIC) -> dict[str, Any]:  # fmt: skip
    """A département's communes fitted in its own drawing, simplified together (one border
    between two neighbours), the département's outline their union."""
    gdf = gdf.rename_geometry("geometry") if gdf.geometry.name != "geometry" else gdf
    one = gdf.to_crs(crs).sort_values(CODE)
    w, h, m = conf["largeur"], conf["hauteur"], conf["marge"]
    tr, scale = _fit(one.total_bounds, w, h, m)
    kept = sans_ilots(one.geometry.values, conf["ilot_min_px2"] / scale**2)
    simple = shapely.coverage_simplify(kept, conf["tolerance_px"] / scale)
    nd = conf["decimales"]
    return {
        "v": 1,
        "source": "IGN ADMIN EXPRESS COG CARTO",
        "licence": conf["licence"],
        "attribution": conf["attribution"],
        "largeur": w,
        "hauteur": h,
        "departement": {"code": dep, "nom": nom, "d": _path(shapely.union_all(simple), tr, nd)},
        "communes": {
            code: {"nom": n, "d": _path(g, tr, nd)}
            for code, n, g in zip(one[CODE], one[NAME], simple, strict=True)
        },
    }


# the overseas départements' metric projections (RGAF09, RGFG95, RGR92, RGM04 UTM zones,
# names read in pyproj's EPSG database); the others Lambert-93
CRS_OUTRE_MER = {"971": "EPSG:5490", "972": "EPSG:5490", "973": "EPSG:2972",
                 "974": "EPSG:2975", "976": "EPSG:4471"}  # fmt: skip


def communes_par_departement(root: Path, rules_dir: Path) -> Iterator[tuple[str, dict[str, Any]]]:
    """(dep, its file) for every département, or nothing when the layers are not here."""
    conf = yaml.safe_load((rules_dir / "registre_geo.yaml").read_text("utf-8"))["communes"]
    src = source(root, rules(rules_dir / "registre_geo.yaml")).with_name(LAYER_COMMUNES)
    deps = source(root, rules(rules_dir / "registre_geo.yaml"))
    if not src.is_file() or not deps.is_file():
        return
    names = dict(pd.read_parquet(deps, columns=[CODE, NAME]).values)
    gdf = gpd.read_parquet(src, columns=[CODE, NAME, DEP_OF, GEOM])
    for dep, part in gdf.groupby(DEP_OF, sort=True):
        yield dep, communes(part, dep, names.get(dep), conf, CRS_OUTRE_MER.get(dep, METRIC))


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
