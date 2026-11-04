"""The places a drone act cites, placed at the build from local data only (lot R4.2): never a
geocoding service, never a third party when a page is served.

- an arrondissement (Paris, Lyon, Marseille): its outline, IGN Admin Express
  (data/src/admin-express-*/arrondissement_municipal.parquet);
- a street: the named highway ways of the map's own OSM build
  (data/build/<part>/ways.parquet, Lambert-93) inside the act's commune, widened by `rue_m`;
- a square, a stadium, a station, a building: the named ways of the same build (a square is
  often a pedestrian way « Place … »), else nothing: a circle of `cercle_m` around it.
A place is drawn only when found without ambiguity inside the act's commune: one name, its
ways close together (`groupe_rue_m`, `groupe_lieu_m`); else it is cited in the text, never
drawn. Each shape is « approximatif » (rules/registre_lieux.yaml).
"""

from __future__ import annotations

import functools
import re
import unicodedata
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "src"
BUILD = ROOT / "data" / "build"


def regles(rules_dir: Path) -> dict[str, Any]:
    return yaml.safe_load((rules_dir / "registre_lieux.yaml").read_text("utf-8"))


def loose(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.replace("’", "'"))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


ORDINAL = re.compile(r"\b(\d{1,2})\s*(?:e|eme|er|ème|è|°)\b", re.I)


def arrondissement(texte: str, insee: str) -> str | None:
    """« 14e arrondissement » of Paris: « 75114 »; Lyon 6938x, Marseille 132xx; else None."""
    m = ORDINAL.search(texte)
    if not m:
        return None
    n = int(m.group(1))
    if insee == "75056" and 1 <= n <= 20:
        return f"751{n:02d}"
    if insee == "69123" and 1 <= n <= 9:
        return f"6938{n}"
    if insee == "13055" and 1 <= n <= 16:
        return f"132{n:02d}"
    return None


@functools.cache
def _admin() -> tuple[Any, Any]:
    import geopandas as gpd

    src = sorted(SRC.glob("admin-express-*"))[-1]
    arr = gpd.read_parquet(src / "arrondissement_municipal.parquet").set_index("code_insee")
    com = gpd.read_parquet(src / "commune.parquet").set_index("code_insee")
    return arr, com


@functools.cache
def _ways(dep: str) -> Any:
    """The named ways of the département's part of the map's build (Lambert-93), or None."""
    import geopandas as gpd

    part = _part(dep)
    path = part.build_dir / "ways.parquet" if part else None
    if not path or not path.is_file():
        return None
    w = gpd.read_parquet(path, columns=["name", "highway", "geometry"])
    w = w[w["name"].notna()]
    return w.assign(cle=w["name"].map(loose))


# the named places of OSM a drone act may cite besides the streets (lot R4.2)
POI = [
    "nwr/leisure=stadium,sports_centre",
    "nwr/railway=station",
    "nwr/public_transport=station",
    "nwr/place=square",
    "nwr/amenity=university,college,school,townhall,hospital,place_of_worship",
    "nwr/tourism=attraction,museum",
    "nwr/historic=monument",
]


def _part(dep: str) -> Any:
    from lacarte import regions

    for part in regions.parts(regions.load("france")):
        if dep in (part.admin or {}).get("departements", []):
            return part
    return None


@functools.cache
def _pois(dep: str) -> Any:
    """The named places of the département's part (Lambert-93 points), extracted once from the
    map's own OSM file into its build folder (lieux.parquet), or None."""
    import subprocess

    import geopandas as gpd
    import osmium
    import shapely

    part = _part(dep)
    if part is None:
        return None
    cache = part.build_dir / "lieux.parquet"
    if not cache.is_file():
        pbf = part.build_dir / f"{part.name}.osm.pbf"
        if not pbf.is_file():
            return None
        small = part.build_dir / "lieux.osm.pbf"
        subprocess.run(
            ["osmium", "tags-filter", "--overwrite", "-o", str(small), str(pbf), *POI],
            check=True,
            capture_output=True,
        )
        wkb, rows = osmium.geom.WKBFactory(), []
        for o in osmium.FileProcessor(str(small)).with_areas():
            name = o.tags.get("name")
            if not name:
                continue
            try:
                if isinstance(o, osmium.osm.Node):
                    rows.append((name, wkb.create_point(o)))
                elif isinstance(o, osmium.osm.Area):
                    rows.append((name, wkb.create_multipolygon(o)))
            except RuntimeError:  # broken geometry in OSM
                continue
        small.unlink(missing_ok=True)
        geom = shapely.centroid(shapely.from_wkb([w for _, w in rows]))
        g = gpd.GeoDataFrame({"name": [n for n, _ in rows]}, geometry=geom, crs="EPSG:4326")
        g.to_crs(part.crs).to_parquet(cache)
    g = gpd.read_parquet(cache)
    return g.assign(cle=g["name"].map(loose))


def placer(lieu: dict[str, Any], insee: str, conf: dict[str, Any]) -> dict[str, Any] | None:
    """The place's shape (GeoJSON, WGS 84) with its kind, or None (cited only)."""
    import geopandas as gpd
    import shapely

    arr, com = _admin()
    genre = lieu.get("genre")
    if genre == "arrondissement":
        code = arrondissement(lieu.get("texte") or "", insee)
        if not code or code not in arr.index:
            return None
        geom = arr.loc[code, "geometrie"]
        return {"id": code, "genre": genre, "geometry": shapely.geometry.mapping(geom)}
    if genre not in ("rue", "place", "stade", "gare", "etablissement") or insee not in com.index:
        return None
    dep = insee[:3] if insee.startswith("97") else insee[:2]
    ways = _ways(dep)
    if ways is None:
        return None
    town = gpd.GeoSeries([com.loc[insee, "geometrie"]], crs="OGC:CRS84").to_crs(ways.crs).iloc[0]
    key = loose(lieu.get("texte") or "")
    if len(key) < 4:
        return None
    hits = ways[(ways["cle"] == key) & ways.intersects(town)]
    if genre != "rue":
        pois = _pois(dep)
        if pois is not None:
            more = pois[(pois["cle"] == key) & pois.intersects(town)]
            if more.empty and hits.empty:
                # « gare du Nord » is OSM's « Paris Gare du Nord »: the name holds the words
                near = pois[pois.intersects(town)]
                more = near[near["cle"].str.contains(rf"\b{re.escape(key)}\b", regex=True)]
            hits = more if not more.empty else hits
    if hits.empty:
        return None
    union = shapely.union_all(hits.geometry.values)
    # one place: its ways close together; the same name far apart is two places
    minx, miny, maxx, maxy = union.bounds
    spread = conf["groupe_rue_m"] if genre == "rue" else conf["groupe_lieu_m"]
    if max(maxx - minx, maxy - miny) > float(spread):
        return None
    if genre == "rue":
        shape = union.buffer(float(conf["rue_m"]))
    else:
        shape = union.centroid.buffer(float(conf["cercle_m"]))
    out = gpd.GeoSeries([shape], crs=ways.crs).to_crs("OGC:CRS84").iloc[0]
    out = shapely.set_precision(out, 1e-6)
    return {
        "id": f"{insee}:{genre}:{key.replace(' ', '-')}",
        "genre": genre,
        "geometry": shapely.geometry.mapping(out),
    }


def formes(rows: list[dict[str, Any]], insee: str, conf: dict[str, Any]) -> dict[str, Any]:
    """The shapes of the places the rows cite, each row's place given its `forme` id when
    placed; {id: {genre, geometry, approximatif}}."""
    out: dict[str, Any] = {}
    for r in rows:
        for lieu in r.get("lieux") or []:
            f = placer(lieu, insee, conf)
            if f:
                lieu["forme"] = f["id"]
                out[f["id"]] = {
                    "genre": f["genre"],
                    "geometry": f["geometry"],
                    "approximatif": True,
                }
    return out
