"""Build the geographic data pack of prototype-v9 (local files only, no network).

Outputs, in prototype-v9/geo/:
  dep-<code>.js   window.DEP[code] = {nom, viewBox, communes: [{c, nom, d, cx, cy}]}
  voisins.js      window.VOISINS = {insee: [neighbour insee, ...]}
  mini.js         window.MINI = {insee: {viewBox, items: [{c, d}]}}  (self first)
  cartes.js       window.CARTE_N_ALL, window.CARTE_PUB, window.CP (partial, see LISEZMOI)

Sources (read-only):
  data/build/{fr-rhone-alpes,fr-idf,fr-paca}/communes.parquet   OSM polygons, EPSG:2154
  data/build/france/tiles_src/communes.geojsonl                 site build: counts, and
      polygons (WGS84, simplified) for neighbours outside the three regional extracts
  M/data/raw/geo_pop/communes_france.json                       COG names
  M/data/raw/geo/departements.json.gz                           COG département names
  M/data/derived/rhone_raa/communes69.json                      postal codes, 69 only

Run: <chemin local> -I scripts/geo/build_geo.py
"""

from __future__ import annotations

import gzip
import json
import math
import os
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import MultiPolygon, Polygon, box, shape
from shapely.geometry.polygon import orient

M = Path(__file__).resolve().parents[2]
ROOT = M.parents[2]
BUILD = Path(os.environ.get("LACARTE_BUILD", ROOT / "data" / "build"))
OUT = M / "prototype-v9" / "geo"

REGIONS = ["fr-rhone-alpes", "fr-idf", "fr-paca"]
PILOT = ["69", "75", "13", "77", "78", "91", "92", "93", "94", "95"]
CITIES = {  # city INSEE -> arrondissement INSEE codes
    "75056": [f"751{i:02d}" for i in range(1, 21)],
    "69123": [f"6938{i}" for i in range(1, 10)],
    "13055": [f"132{i:02d}" for i in range(1, 17)],
}
ARR_TO_CITY = {a: c for c, arrs in CITIES.items() for a in arrs}
MINI_FALLBACK = ["69283", "69290", "69123", "69282", "69266",
                 "93066", "94018", "91386", "75056"]

NEIGHBOUR_DIST_M = 50.0
DEP_WIDTH = 1000
DEP_PAD = 8
DEP_MAX_BYTES = 250_000
MINI_WIDTH = 200
MINI_MARGIN = 0.45          # window margin around the commune, share of its larger side
MINI_TOL_UNITS = 1.0
MINI_MAX_BYTES = 3_000_000


def log(*a):
    print(*a, file=sys.stderr)


# ---------------------------------------------------------------- loading

def load_parquets() -> gpd.GeoDataFrame:
    frames = []
    for r in REGIONS:
        g = gpd.read_parquet(BUILD / r / "communes.parquet")
        g = g[g["insee"].notna()][["insee", "geometry"]].copy()
        g["src"] = r
        frames.append(g.to_crs(2154))
    g = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs=2154)
    g["area"] = g.geometry.area
    # The same commune can sit in two regional extracts: keep the largest copy.
    g = g.sort_values("area", ascending=False).drop_duplicates("insee")
    return g.set_index("insee")


def read_geojsonl_props(line: str) -> dict:
    i = line.find('"geometry"')
    try:
        return json.loads(line[:i].rstrip().rstrip(",") + "}")["properties"]
    except (ValueError, KeyError):
        return json.loads(line)["properties"]


def load_counts_and_fallback(known: set[str], bbox_ll):
    """Counts for every commune; WGS84 polygons of nearby communes absent from `known`."""
    counts = {}
    fb_codes, fb_geoms = [], []
    x0, y0, x1, y1 = bbox_ll
    with open(BUILD / "france" / "tiles_src" / "communes.geojsonl", encoding="utf-8") as f:
        for line in f:
            p = read_geojsonl_props(line)
            c = p["c"]
            counts[c] = p
            if c in known or c in ARR_TO_CITY:
                continue
            if x0 <= p["lx"] <= x1 and y0 <= p["ly"] <= y1:
                fb_codes.append(c)
                fb_geoms.append(shape(json.loads(line)["geometry"]))
    fb = gpd.GeoDataFrame({"insee": fb_codes, "src": "geojsonl"},
                          geometry=fb_geoms, crs=4326).to_crs(2154)
    return counts, fb.set_index("insee")


# ---------------------------------------------------------------- SVG encoding

def polys(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


def ring_path(coords, tf) -> str:
    pts = []
    for x, y in coords:
        p = tf(x, y)
        if not pts or p != pts[-1]:
            pts.append(p)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    if len(set(pts)) < 3:
        return ""
    out = [f"M{pts[0][0]} {pts[0][1]}l"]
    nums = []
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        nums += [bx - ax, by - ay]
    s = " ".join(str(n) for n in nums).replace(" -", "-")
    return out[0] + s + "z"


def geom_path(geom, tf) -> str:
    parts = []
    for poly in polys(geom):
        # Exterior and holes with opposite windings: holes render with either fill-rule.
        poly = orient(poly, 1.0)
        parts.append(ring_path(poly.exterior.coords, tf))
        parts += [ring_path(r.coords, tf) for r in poly.interiors]
    return "".join(p for p in parts if p)


def make_tf(minx, maxy, s, pad):
    def tf(x, y):
        return (int(round((x - minx) * s + pad)), int(round((maxy - y) * s + pad)))
    return tf


def simplify_group(geoms, tol_m):
    arr = np.array(geoms, dtype=object)
    try:
        if shapely.coverage_is_valid(arr):
            return list(shapely.coverage_simplify(arr, tol_m))
    except shapely.errors.GEOSException:
        pass
    return [g.simplify(tol_m, preserve_topology=True) for g in geoms]


def js_dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- outputs

def build_dep(code, nom, rows, geoms, cog_names, stats):
    minx, miny, maxx, maxy = shapely.union_all(np.array(list(geoms.values()), dtype=object)).bounds
    s = (DEP_WIDTH - 2 * DEP_PAD) / (maxx - minx)
    height = int(math.ceil((maxy - miny) * s + 2 * DEP_PAD))
    tf = make_tf(minx, maxy, s, DEP_PAD)
    codes = sorted(rows)
    tol_units = 0.5
    while True:
        simp = simplify_group([geoms[c] for c in codes], tol_units / s)
        communes, fallback = [], 0
        for c, g in zip(codes, simp):
            d = geom_path(g, tf)
            if not d:          # collapsed by simplification: use the raw outline
                d = geom_path(geoms[c], tf)
                fallback += 1
            if not d:          # smaller than a unit: a 2x2 square on the label point
                px, py = tf(*geoms[c].representative_point().coords[0])
                d = f"M{px - 1} {py - 1}l2 0 0 2-2 0z"
            rp = geoms[c].representative_point()
            cx, cy = tf(rp.x, rp.y)
            communes.append({"c": c, "nom": cog_names[c], "d": d, "cx": cx, "cy": cy})
        obj = {"nom": nom, "viewBox": f"0 0 {DEP_WIDTH} {height}", "communes": communes}
        text = ("window.DEP = window.DEP || {};\n"
                f"window.DEP[{json.dumps(code)}] = {js_dump(obj)};\n")
        size = len(text.encode("utf-8"))
        if size <= DEP_MAX_BYTES or tol_units > 20:
            break
        tol_units *= 1.3
    (OUT / f"dep-{code}.js").write_text(text, encoding="utf-8")
    stats[code] = (len(communes), size, round(tol_units, 2), fallback)


def neighbours(all_geoms: gpd.GeoSeries, pilot_codes):
    codes = list(all_geoms.index)
    tree = shapely.STRtree(all_geoms.values)
    pos = {c: i for i, c in enumerate(codes)}
    pidx = [pos[c] for c in pilot_codes]
    src, dst = tree.query(all_geoms.values[pidx], predicate="dwithin",
                          distance=NEIGHBOUR_DIST_M)
    out = {c: set() for c in pilot_codes}
    for i, j in zip(src, dst):
        a, b = pilot_codes[i], codes[j]
        if a != b:
            out[a].add(b)
    return {c: sorted(v) for c, v in sorted(out.items())}


def build_mini(code, voisins, all_geoms):
    self_g = all_geoms[code]
    x0, y0, x1, y1 = self_g.bounds
    m = MINI_MARGIN * max(x1 - x0, y1 - y0)
    wx0, wy0, wx1, wy1 = x0 - m, y0 - m, x1 + m, y1 + m
    s = MINI_WIDTH / (wx1 - wx0)
    height = int(math.ceil((wy1 - wy0) * s))
    tf = make_tf(wx0, wy1, s, 0)
    group = [code] + voisins[code]
    clipped = [shapely.clip_by_rect(all_geoms[c], wx0, wy0, wx1, wy1) for c in group]
    simp = simplify_group(clipped, MINI_TOL_UNITS / s)
    items = []
    for c, g in zip(group, simp):
        d = geom_path(g, tf)
        if d:
            items.append({"c": c, "d": d})
    return {"viewBox": f"0 0 {MINI_WIDTH} {height}", "items": items}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cog = json.loads((M / "data/raw/geo_pop/communes_france.json").read_text(encoding="utf-8"))
    cog_names = {c["code"]: c["nom"] for c in cog}
    dep_names = {d["code"]: d["nom"] for d in
                 json.load(gzip.open(M / "data/raw/geo/departements.json.gz", "rt", encoding="utf-8"))}
    pilot_cog = {d: sorted(c["code"] for c in cog if c["codeDepartement"] == d) for d in PILOT}

    pq = load_parquets()
    pilot_codes = [c for d in PILOT for c in pilot_cog[d]]
    missing = [c for c in pilot_codes if c not in pq.index]
    pilot_codes = [c for c in pilot_codes if c in pq.index]

    bbox = gpd.GeoSeries(pq.loc[pilot_codes].geometry, crs=2154).to_crs(4326).total_bounds
    bbox_ll = (bbox[0] - 0.3, bbox[1] - 0.3, bbox[2] + 0.3, bbox[3] + 0.3)
    counts, fb = load_counts_and_fallback(set(pq.index), bbox_ll)
    all_geoms = gpd.GeoSeries(
        list(pq.geometry.values) + list(fb.geometry.values),
        index=list(pq.index) + list(fb.index), crs=2154)
    src = dict(zip(pq.index, pq["src"])) | dict(zip(fb.index, fb["src"]))

    # 1. départements
    stats = {}
    for d in PILOT:
        rows = [c for c in pilot_cog[d] if c in pq.index]
        build_dep(d, dep_names.get(d, d), rows, {c: pq.geometry[c] for c in rows}, cog_names, stats)

    # 2. neighbours
    voisins = neighbours(all_geoms, pilot_codes)
    (OUT / "voisins.js").write_text(f"window.VOISINS = {js_dump(voisins)};\n", encoding="utf-8")
    cross_src = sorted({b for v in voisins.values() for b in v if src.get(b) == "geojsonl"})

    # 3. mini maps: all pilot communes if under budget, else the fallback list
    mini = {c: build_mini(c, voisins, all_geoms) for c in pilot_codes}
    text = f"window.MINI = {js_dump(mini)};\n"
    mini_scope = "all"
    if len(text.encode("utf-8")) > MINI_MAX_BYTES:
        mini = {c: mini[c] for c in MINI_FALLBACK if c in mini}
        text = f"window.MINI = {js_dump(mini)};\n"
        mini_scope = "fallback"
    (OUT / "mini.js").write_text(text, encoding="utf-8")

    # 4. counts (arrondissements summed into their city), partial postal codes
    n_all, n_pub = {}, {}
    for c, p in counts.items():
        k = ARR_TO_CITY.get(c, c)
        n_all[k] = n_all.get(k, 0) + int(p["n"])
        n_pub[k] = n_pub.get(k, 0) + int(p["n_pub"])
    cp = {}
    cp_file = M / "data/derived/rhone_raa/communes69.json"
    if cp_file.exists():
        for r in json.loads(cp_file.read_text(encoding="utf-8")):
            if r.get("codesPostaux"):
                cp[r["code"]] = sorted(set(r["codesPostaux"]))
    cp_deps = sorted({c[:2] for c in cp})
    (OUT / "cartes.js").write_text(
        f"window.CARTE_N_ALL = {js_dump(dict(sorted(n_all.items())))};\n"
        f"window.CARTE_PUB = {js_dump(dict(sorted(n_pub.items())))};\n"
        f"// Postal codes: local source covers these départements only.\n"
        f"window.CP_DEPARTEMENTS = {js_dump(cp_deps)};\n"
        f"window.CP = {js_dump(cp)};\n", encoding="utf-8")

    # report
    log("missing polygons:", missing)
    for d, (n, size, tol, fbk) in stats.items():
        log(f"dep-{d}: {n} communes, {size} B, tol {tol} units, raw-outline fallbacks {fbk}")
    log("voisins:", len(voisins), "communes; neighbours from geojsonl fallback:", len(cross_src))
    log("no neighbour:", [c for c, v in voisins.items() if not v])
    log("mini:", mini_scope, len(mini), "communes")
    log("cartes:", len(n_all), "communes;", {c: n_all.get(c) for c in CITIES},
        "arr sums:", {c: sum(int(counts[a]["n"]) for a in a_s if a in counts) for c, a_s in CITIES.items()})
    log("CP:", len(cp), "communes, départements", cp_deps)


if __name__ == "__main__":
    main()
