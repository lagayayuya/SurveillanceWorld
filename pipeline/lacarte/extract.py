"""Stage 1: read an .osm.pbf into GeoParquet.

Layers: cameras, obstacle buildings, buildings ignored as obstacles (roofs, underground…,
kept for review), highway ways, communes.

The raw file is first reduced with `osmium tags-filter`, then streamed with pyosmium.
All geometries are projected to the region's metric CRS. The region's hidden cameras
(regions.hidden) leave here: no later stage, output or count sees them. So do, in a
country's region (regions.country: France and its parts), the cameras abroad: outside the
country's OSM outline (country_outline, its territorial sea included) and farther than
rules/admin.yaml rescue_max_m from every commune (camera_abroad).
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
ABROAD = "cameras-abroad.txt"  # the cameras the extract left abroad, one id per line
COUNTRY = "country.geojson"  # the country's outline (WGS84), in its region's build folder


def run(region: regions.Region) -> dict[str, Path]:
    out = region.build_dir
    out.mkdir(parents=True, exist_ok=True)
    src = ensure_source(region)
    filtered = out / "filtered.osm.pbf"
    _osmium("tags-filter", str(src), *FILTERS, "-o", str(filtered), "--overwrite")
    frames = read(filtered, region.crs)
    cams = frames["cameras"]
    hidden = regions.hidden(region)
    cams = cams[~cams.camera_id.isin(hidden)].reset_index(drop=True)
    away = camera_abroad(cams, region)
    frames["cameras"] = cams[~away].reset_index(drop=True)
    (out / ABROAD).write_text("".join(f"{c}\n" for c in sorted(cams.camera_id[away])))
    frames["skipped"] = pd.concat([frames["skipped"], pd.DataFrame(
        [{"layer": "camera_abroad", "count": int(away.sum())}])], ignore_index=True)  # fmt: skip
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
    pbf = region.source_pbf
    if region.aggregate and pbf.exists() and pbf.stat().st_mtime > parent_pbf.stat().st_mtime:
        return pbf  # cut with the other parts (cut_parts), after the parent
    poly = region.build_dir / "boundary.geojson"
    if region.aggregate:
        poly.write_text(json.dumps(units_polygon(region)))
    else:
        poly.write_text(json.dumps(_communes_polygon(parent_pbf, region)))
    _osmium(
        "extract", "-p", str(poly), "-s", "smart", str(parent_pbf),
        "-o", str(region.source_pbf), "--overwrite",
    )  # fmt: skip
    return region.source_pbf


def camera_abroad(cams: gpd.GeoDataFrame, region: regions.Region) -> np.ndarray:
    """Per camera, whether it stands abroad (abroad); none outside a country's region."""
    shape = country_outline(region)
    if shape is None or not len(cams):
        return np.zeros(len(cams), dtype=bool)
    from lacarte import admin

    shape = gpd.GeoSeries([shape], crs="EPSG:4326").to_crs(region.crs).iloc[0]
    pts = cams.geometry.values
    shapely.prepare(shape)
    if shapely.contains_xy(shape, shapely.get_x(pts), shapely.get_y(pts)).all():
        return np.zeros(len(cams), dtype=bool)  # an inland part: no commune to load
    units, deps = admin.region_units(region)
    if region.aggregate:
        units, _, _ = admin.with_neighbours(region, units, deps)
    return abroad(cams.geometry.values, shape, units, admin.rescue_max_m())


def abroad(points, shape, units: gpd.GeoDataFrame, tolerance_m: float) -> np.ndarray:
    """Per point (the CRS of `shape` and `units`): outside the country's outline `shape`
    and farther than `tolerance_m` from every unit. In a commune or that close, it stays:
    there the communes' generalised limits and the national border disagree by a few
    metres (border crossings, France 2026-10-16: 7 cameras, 1 to 21 m outside the outline),
    and the communes' rescue (admin.assign_points) would place it as before."""
    points = np.asarray(points, dtype=object)
    out = np.zeros(len(points), dtype=bool)
    if not len(points):
        return out
    shapely.prepare(shape)
    out = ~shapely.contains_xy(shape, shapely.get_x(points), shapely.get_y(points))
    idx = np.flatnonzero(out)
    if len(idx) and len(units):
        from lacarte import admin

        unit, _ = admin.assign_points(points[idx], units, tolerance_m)
        out[idx[unit >= 0]] = False
    return out


def country_outline(region: regions.Region):
    """The outline of the region's country (regions.country), WGS84, or None: derived from
    the country's region's .pbf (a part's aggregate's) into that region's build folder
    (COUNTRY), again when the .pbf is newer. 1.8 MB for France: a build product, not a
    versioned file."""
    iso = regions.country(region)
    if iso is None:
        return None
    if region.aggregate:
        root, folder = regions.load(region.aggregate), region.build_dir.parent / region.aggregate
    else:
        root, folder = region, region.build_dir
    pbf = ensure_source(root)
    path = folder / COUNTRY
    if not path.exists() or path.stat().st_mtime < pbf.stat().st_mtime:
        folder.mkdir(parents=True, exist_ok=True)
        derive_country(pbf, iso, path)
    return shapely.from_geojson(path.read_text())


def derive_country(pbf: Path, iso: str, out: Path) -> None:
    """Write the outline (GeoJSON, WGS84) of the OSM country boundary ISO3166-1=`iso`
    (boundary=administrative, admin_level=2) held in `pbf`."""
    tmp = out.with_name(out.stem + ".osm.pbf")
    _osmium("tags-filter", str(pbf), "r/admin_level=2", "-o", str(tmp), "--overwrite")
    try:
        shape = country_shape(tmp, iso)
    finally:
        tmp.unlink(missing_ok=True)
    out.write_text(shapely.to_geojson(shape))


def country_shape(pbf: Path, iso: str):
    """The country's (multi)polygon from the boundary relation's member ways in `pbf`: a
    country extract (Geofabrik's France) holds the relation but not every member (France's
    overseas rings: 357 of its 1,742 ways on 2026-10-16), so osmium's area assembler refuses
    it; its rings are rebuilt here from the ways present (outline). An absent ring is
    absent; a ring with a way missing stops the build."""
    found = []
    for r in osmium.FileProcessor(str(pbf), osmium.osm.RELATION):
        t = r.tags
        if (t.get("boundary"), t.get("admin_level"), t.get("ISO3166-1")) == (
            "administrative", "2", iso,
        ):  # fmt: skip
            found.append({m.ref: m.role for m in r.members if m.type == "w"})
    if len(found) != 1:
        raise ValueError(f"{len(found)} admin_level=2 boundaries ISO3166-1={iso} in {pbf.name}")
    roles = found[0]
    lines: dict[str, list] = {"outer": [], "inner": []}
    for w in osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY).with_locations():
        if isinstance(w, osmium.osm.Way) and w.id in roles:
            coords = [(n.lon, n.lat) for n in w.nodes]
            lines["inner" if roles[w.id] == "inner" else "outer"].append(shapely.LineString(coords))
    return outline(lines["outer"], lines["inner"])


def outline(outer: list, inner: list):
    """Polygons from boundary ways (WGS84 lines): each role's ways merged into rings, the
    outer rings less the inner ones (Llívia, Spanish, inside France). Raises on an open ring
    (a member missing) or no outer ring."""
    shapes = []
    for role, lines in (("outer", outer), ("inner", inner)):
        if not lines:
            shapes.append(None)
            continue
        merged = shapely.line_merge(shapely.MultiLineString(lines))
        rings = list(getattr(merged, "geoms", [merged]))
        gaps = [g for g in rings if not g.is_closed]
        if gaps:
            raise ValueError(f"{len(gaps)} open {role} ring(s), one from {gaps[0].coords[0]}")
        shapes.append(shapely.union_all([shapely.make_valid(shapely.Polygon(g)) for g in rings]))
    if shapes[0] is None:
        raise ValueError("no outer ring")
    return shapes[0] if shapes[1] is None else shapes[0].difference(shapes[1])


def cut_parts(parts: list[regions.Region], parent_pbf: Path, per_pass: int = 3) -> None:
    """Cut each part's .pbf from the parent's (a part: units_polygon), `per_pass` parts per
    reading of the parent (osmium extract --config): its memory is about 2 x (highest node
    id / 8) bytes per extract with the smart strategy (osmium-extract(1), « Memory usage »),
    ~4 GB each for France's."""
    for i in range(0, len(parts), per_pass):
        batch = parts[i : i + per_pass]
        extracts = []
        for part in batch:
            part.build_dir.mkdir(parents=True, exist_ok=True)
            poly = part.build_dir / "boundary.geojson"
            poly.write_text(json.dumps(units_polygon(part)))
            polygon = {"file_name": str(poly), "file_type": "geojson"}
            extracts.append({"output": str(part.source_pbf), "polygon": polygon})
        config = batch[0].build_dir / "cut-config.json"
        config.write_text(json.dumps({"extracts": extracts}))
        _osmium("extract", "-c", str(config), "-s", "smart", str(parent_pbf), "--overwrite")
        config.unlink()


def units_polygon(region: regions.Region) -> dict:
    """GeoJSON (WGS84) of a part's units (its départements or communes, IGN ADMIN EXPRESS),
    widened by `buffer_m`: what its cameras may see and what may film its streets."""
    from lacarte import admin

    units, _ = admin.region_units(region)
    zone = shapely.union_all(units.geometry.values).buffer(region.buffer_m)
    wgs = gpd.GeoSeries([zone], crs=region.crs).to_crs("EPSG:4326").iloc[0]
    return {
        "type": "Feature",
        "properties": {"name": region.name},
        "geometry": shapely.geometry.mapping(wgs),
    }


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
