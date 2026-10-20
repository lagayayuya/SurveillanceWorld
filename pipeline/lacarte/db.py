"""Participation database (PostGIS): migrations, and the served build's tables.

    lacarte db migrate [--dsn DSN]
    lacarte db load --region R [--dsn DSN]       # export, then db/load.sh into DSN
    lacarte db load --region R --to-dir DIR      # export only (deploy: rsync, load there)

The export is the heavy part (buildings prepared as the views stage does), so it runs where
the build is; db/load.sh only needs psql and gzip, so it also runs on the server. Both paths
use the same load script. Without --dsn, psql reads the usual PG* environment.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
import subprocess
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely

from lacarte import admin, apply, buildinfo, buildings, participation, regions, views

MIGRATIONS = regions.ROOT / "db" / "migrations"
LOAD_SCRIPT = regions.ROOT / "db" / "load.sh"
MIGRATE_SCRIPT = regions.ROOT / "db" / "migrate.sh"
SRID = 2154


def migrate(dsn: str | None = None) -> list[str]:
    """Apply the migrations not yet applied (db/migrate.sh, also run on the server)."""
    out = subprocess.run(
        [str(MIGRATE_SCRIPT), *([dsn] if dsn else [])], check=True, capture_output=True, text=True
    ).stdout
    return [line.split()[1] for line in out.splitlines() if line.startswith("applied ")]


def export(region: regions.Region, out: Path, workers: int | None = None) -> dict:
    """Write meta.tsv, cameras.tsv.gz and buildings.tsv.gz (COPY text, EWKB hex)."""
    out.mkdir(parents=True, exist_ok=True)
    b = region.build_dir
    if region.crs != f"EPSG:{SRID}":
        raise SystemExit(f"the participation tables are in EPSG:{SRID}, not {region.crs}")
    cams = gpd.read_parquet(b / apply.CAMERAS)
    cams = cams[cams.is_camera].reset_index(drop=True)
    raw = gpd.read_parquet(b / "buildings.parquet").geometry.values
    move_max = participation.rules()["move"]["max_m"]

    # Every building cluster of the region (phase "Ajouter": a camera may be added anywhere;
    # before it, only those around cameras: a quarter of a suburban town's streets had them).
    # Clusters are whole connected components, so each is prepared exactly as the views
    # stage does.
    tree = shapely.STRtree(raw)
    groups = buildings.clusters(raw, tree, np.arange(len(raw)))
    with ProcessPoolExecutor(max_workers=workers or os.cpu_count()) as pool:
        chunks = [shapely.to_wkb(raw[g]) for g in groups]
        prepared = [p for group in pool.map(views._prepare, chunks, chunksize=256) for p in group]
    polys = shapely.set_srid(shapely.from_wkb(prepared), SRID) if prepared else []
    # The digest of the text, not of the gzip file (its header holds a time): a deploy loads
    # the buildings again only when it changed.
    digest = hashlib.sha256()
    with gzip.open(out / "buildings.tsv.gz", "wt", compresslevel=6) as f:
        for i, wkb in enumerate(shapely.to_wkb(polys, hex=True, include_srid=True)):
            line = f"{i}\t{wkb}\n"
            digest.update(line.encode())
            f.write(line)
    buildings_sha = digest.hexdigest()

    places = admin.places(cams.geometry.values, region)
    ways = gpd.read_parquet(b / "ways.parquet", columns=["highway", "name", "geometry"])
    names = streets(cams.geometry.values, ways, participation.rules()["review"]["street_within_m"])
    with gzip.open(out / "cameras.tsv.gz", "wt", compresslevel=6, newline="") as f:
        # No quote character: JSON tags carry double quotes; COPY's own escapes (_copy).
        w = csv.writer(
            f, delimiter="\t", lineterminator="\n", quoting=csv.QUOTE_NONE, quotechar=None
        )
        pts = shapely.to_wkb(
            shapely.set_srid(cams.geometry.values, SRID), hex=True, include_srid=True
        )
        for c, pt, (town, commune), street in zip(cams.itertuples(index=False), pts, places,
                                                  names, strict=True):  # fmt: skip
            w.writerow(_camera_row(c, pt, town, commune, street))

    # Region bounds for input validation: the box of the cameras and of the buildings (a
    # camera may be added wherever there are buildings), widened by the largest move.
    both = shapely.box(*cams.total_bounds).union(shapely.box(*shapely.total_bounds(raw)))
    lo = gpd.GeoSeries([both], crs=cams.crs).to_crs("EPSG:4326").total_bounds
    pad = move_max / 111_000 * 2  # generous degrees, both axes
    bounds = shapely.box(lo[0] - pad, lo[1] - pad, lo[2] + pad, lo[3] + pad)
    bid = buildinfo.build_id(region)
    box_hex = shapely.to_wkb(shapely.set_srid(bounds, 4326), hex=True, include_srid=True)
    add_camera = _copy(json.dumps(apply.add_template(), sort_keys=True))
    (out / "meta.tsv").write_text(
        f"true\t{bid}\t{region.name}\t{box_hex}\t{add_camera}\t{buildings_sha}\n"
    )
    info = {"build_id": bid, "cameras": len(cams), "buildings": len(polys),
            "buildings_sha256": buildings_sha}  # fmt: skip
    (out / "export.json").write_text(json.dumps(info, indent=2))
    return info


def streets(points, ways: gpd.GeoDataFrame, within_m: float) -> list[str | None]:
    """The street each point (metric CRS) is named by in /revue (migration 019): the name of
    the nearest way with a `highway` and a `name` within `within_m`, None beyond; ways at
    the same distance give the first name in sort order (a stable label)."""
    out: list[str | None] = [None] * len(points)
    named = ways[ways.highway.notna() & ways.name.fillna("").str.strip().ne("")]
    if not len(named) or not len(points):
        return out
    labels = named.name.to_numpy()
    tree = shapely.STRtree(named.geometry.values)
    (src, dst), dist = tree.query_nearest(
        points, max_distance=within_m, return_distance=True, all_matches=True
    )
    best: dict[int, tuple[float, str]] = {}
    for i, j, d in zip(src, dst, dist, strict=True):
        key = (float(d), str(labels[j]))
        if d <= within_m and (i not in best or key < best[i]):
            best[i] = key
    for i, (_, name) in best.items():
        out[i] = name
    return out


def _copy(value: str | None) -> str:
    """A text value in COPY's text format: NULL as \\N, backslash, tab and newlines escaped."""
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return r"\N"
    v = str(value)
    return v.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def _camera_row(c, point_hex: str, town_operator: str | None = None,
                commune: str | None = None, street: str | None = None) -> list:  # fmt: skip
    tilt = c.tilt_deg
    added = apply.is_added(c.camera_id)  # no OSM element (phase "Ajouter")
    return [
        c.camera_id,
        r"\N" if added else c.camera_id[0],
        r"\N" if added else c.camera_id[1:],
        r"\N" if added else c.osm_version,
        _copy(c.osm_timestamp),  # none for an added camera
        point_hex,
        "t" if c.indoor else "f",
        c.kind,
        c.kind_certainty,
        c.mount_group,
        "{" + ",".join(repr(float(d)) for d in c.directions) + "}",
        c.direction_certainty,
        c.fov_deg,
        c.range_m,
        c.height_m,
        c.height_certainty,
        r"\N" if tilt is None or np.isnan(tilt) else tilt,
        c.geom_certainty,
        c.optics_certainty,
        # Phase D2 (migration 006): copied into each contribution; the "who films" list.
        _copy(json.dumps(json.loads(c.tags), ensure_ascii=False, sort_keys=True)),
        c.operator_class,
        _copy(c.operator_norm),
        _copy(town_operator),
        # Phase "Retours terrain" (migration 010): the commune or arrondissement, for /revue.
        _copy(commune),
        # Migration 013: moved or added by a participant, under a roof inside a footprint.
        _copy(getattr(c, "position_source", None)),
        # Migration 019: the nearest named way, for /revue (streets); the last column.
        _copy(street),
    ]


def load(directory: Path, dsn: str | None = None) -> None:
    """Swap the export in `directory` into the database (db/load.sh)."""
    subprocess.run([str(LOAD_SCRIPT), str(directory), *([dsn] if dsn else [])], check=True)
