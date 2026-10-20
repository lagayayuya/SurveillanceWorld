"""Stage 1: read an .osm.pbf into GeoParquet.

Layers: cameras, obstacle buildings, buildings ignored as obstacles (roofs, underground…,
kept for review), highway ways, communes.

The raw file is first reduced with `osmium tags-filter`, then streamed with pyosmium.
All geometries are projected to the region's metric CRS. The region's hidden cameras
(regions.hidden) leave here: no later stage, output or count sees them.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import geopandas as gpd
import numpy as np
import osmium
import pandas as pd
import shapely
from pyproj import Transformer

from lacarte import buildings, regions

FILTERS = ["nwr/man_made=surveillance", "wr/building", "w/highway", "r/admin_level=8"]
WAY_TAGS = [
    "highway",
    "name",
    "access",
    "foot",
    "service",
    "tunnel",
    "covered",
    "layer",
    "bridge",
    "area",
    "indoor",
    "level",
    "footway",
    "cycleway",
]


HIDDEN_APPLIED = "hidden-applied.txt"


def run(region: regions.Region) -> dict[str, Path]:
    out = region.build_dir
    out.mkdir(parents=True, exist_ok=True)
    src = ensure_source(region)
    filtered = out / "filtered.osm.pbf"
    _osmium("tags-filter", str(src), *FILTERS, "-o", str(filtered), "--overwrite")
    frames = read(filtered, region.crs)
    cams = frames["cameras"]
    hidden = regions.hidden(region)
    frames["cameras"] = cams[~cams.camera_id.isin(hidden)].reset_index(drop=True)
    # What this extract left out: a build started at a later stage checks it is still the
    # list (cli build), or a camera hidden since would stay in every output.
    (out / HIDDEN_APPLIED).write_text("".join(f"{c}\n" for c in sorted(hidden)))
    paths = {}
    for name, frame in frames.items():
        paths[name] = out / f"{name}.parquet"
        frame.to_parquet(paths[name])
    return paths


def ensure_source(region: regions.Region) -> Path:
    """Return the region's .pbf, cutting it from its parent region if needed."""
    if region.parent is None:
        if not region.source_pbf.exists():
            raise FileNotFoundError(
                f"{region.source_pbf} missing; download it from {region.url or 'its source'}"
            )
        return region.source_pbf
    parent = regions.load(region.parent)
    parent_pbf = ensure_source(parent)
    region.build_dir.mkdir(parents=True, exist_ok=True)
    poly = region.build_dir / "boundary.geojson"
    poly.write_text(json.dumps(_communes_polygon(parent_pbf, region)))
    _osmium(
        "extract", "-p", str(poly), "-s", "smart", str(parent_pbf),
        "-o", str(region.source_pbf), "--overwrite",
    )  # fmt: skip
    return region.source_pbf


def _communes_polygon(pbf: Path, region: regions.Region) -> dict:
    """GeoJSON (WGS84) of the region's communes, buffered by `buffer_m`."""
    admin = region.build_dir / "admin8.osm.pbf"
    _osmium("tags-filter", str(pbf), "r/admin_level=8", "-o", str(admin), "--overwrite")
    wanted = set(region.communes)
    wkb = osmium.geom.WKBFactory()
    parts = []
    for o in osmium.FileProcessor(str(admin)).with_areas():
        if (
            isinstance(o, osmium.osm.Area)
            and o.tags.get("name") in wanted
            and o.tags.get("boundary") == "administrative"
        ):
            parts.append(shapely.from_wkb(wkb.create_multipolygon(o)))
    found = len(parts)
    if found != len(wanted):
        raise ValueError(f"found {found} of {len(wanted)} communes {sorted(wanted)}")
    to_m = Transformer.from_crs("EPSG:4326", region.crs, always_xy=True)
    to_ll = Transformer.from_crs(region.crs, "EPSG:4326", always_xy=True)
    zone = _project(shapely.union_all(parts), to_m).buffer(region.buffer_m)
    return {
        "type": "Feature",
        "properties": {"name": region.name},
        "geometry": shapely.geometry.mapping(_project(zone, to_ll)),
    }


def read(pbf: Path, crs: str) -> dict[str, gpd.GeoDataFrame]:
    """Stream the filtered file once and build every layer."""
    wkb = osmium.geom.WKBFactory()
    cams, blds, ignored, communes, ways = [], [], [], [], []
    skipped = {"invalid_area": 0, "invalid_way": 0}
    for o in osmium.FileProcessor(str(pbf)).with_areas():
        tags = o.tags
        if isinstance(o, osmium.osm.Node):
            if tags.get("man_made") == "surveillance":
                cams.append(_camera_row("n", o.id, o, wkb.create_point(o)))
        elif isinstance(o, osmium.osm.Way):
            if "highway" in tags and len(o.nodes) >= 2:
                row = _way_row(o, wkb)
                if row is None:
                    skipped["invalid_way"] += 1
                else:
                    ways.append(row)
        elif isinstance(o, osmium.osm.Area):
            is_cam = tags.get("man_made") == "surveillance"
            is_commune = tags.get("admin_level") == "8" and tags.get("boundary") == "administrative"
            is_building = "building" in tags and tags.get("building") != "no"
            if not (is_cam or is_commune or is_building):
                continue
            try:
                geom = wkb.create_multipolygon(o)
            except RuntimeError:  # broken multipolygon in OSM
                skipped["invalid_area"] += 1
                continue
            if is_cam:
                cams.append(_camera_row("w" if o.from_way() else "r", o.orig_id(), o, geom))
            elif is_commune:
                communes.append((tags.get("name"), tags.get("ref:INSEE"), geom))
            elif buildings.is_obstacle(dict(tags)):
                blds.append((o.orig_id(), o.from_way(), geom))
            else:
                keys = ("building", "layer", "location")
                ignored.append((o.orig_id(), *(tags.get(k) for k in keys), geom))

    to_m = Transformer.from_crs("EPSG:4326", crs, always_xy=True)

    cam_df = pd.DataFrame(
        cams, columns=["camera_id", "osm_version", "osm_timestamp", "tags", "wkb"]
    )
    cam_geom = _project(shapely.from_wkb(cam_df.pop("wkb").to_numpy()), to_m)
    cam_geom = shapely.centroid(cam_geom)  # cameras drawn as areas become points
    cameras = gpd.GeoDataFrame(cam_df, geometry=cam_geom, crs=crs)

    bld_df = pd.DataFrame(blds, columns=["osm_id", "from_way", "wkb"])
    bld_geom = _project(shapely.from_wkb(bld_df.pop("wkb").to_numpy()), to_m)
    blds_gdf = gpd.GeoDataFrame(bld_df, geometry=bld_geom, crs=crs)

    way_df = pd.DataFrame(ways, columns=["way_id", "node_ids", *WAY_TAGS, "wkb"])
    way_geom = _project(shapely.from_wkb(way_df.pop("wkb").to_numpy()), to_m)
    ways_gdf = gpd.GeoDataFrame(way_df, geometry=way_geom, crs=crs)

    def frame(rows, cols):
        df = pd.DataFrame(rows, columns=[*cols, "wkb"])
        wkbs = df.pop("wkb").to_numpy()
        geom = _project(shapely.from_wkb(wkbs), to_m) if len(wkbs) else []
        return gpd.GeoDataFrame(df, geometry=geom, crs=crs)

    stats = pd.DataFrame([{"layer": k, "count": v} for k, v in skipped.items()])
    return {
        "cameras": cameras,
        "buildings": blds_gdf,
        "ignored_buildings": frame(ignored, ["osm_id", "building", "layer", "location"]),
        "ways": ways_gdf,
        "communes": frame(communes, ["name", "insee"]),
        "skipped": stats,
    }


def _camera_row(prefix: str, osm_id: int, o, geom_wkb: str) -> tuple:
    return (
        f"{prefix}{osm_id}",
        o.version,
        o.timestamp.isoformat() if o.timestamp else None,
        json.dumps(dict(o.tags), ensure_ascii=False, sort_keys=True),
        geom_wkb,
    )


def _way_row(o, wkb) -> tuple | None:
    """Way with every node kept (use_nodes=ALL) so coordinates align with node ids."""
    try:
        line = wkb.create_linestring(o, use_nodes=osmium.geom.ALL)
    except (osmium.InvalidLocationError, RuntimeError):
        return None
    node_ids = [n.ref for n in o.nodes]
    return (o.id, node_ids, *[o.tags.get(k) for k in WAY_TAGS], line)


def _project(geom, transformer: Transformer):
    return shapely.transform(geom, lambda xy: np.column_stack(transformer.transform(*xy.T)))


def _osmium(*args: str) -> None:
    subprocess.run(["osmium", *args], check=True, capture_output=True, text=True)
