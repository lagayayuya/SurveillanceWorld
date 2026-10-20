"""Stage 3: viewsheds for every outdoor camera, with per-camera QA metrics.

Work is split into blocks (H3 res 6 cells of the camera positions) processed in
parallel. Obstacles are prepared once per building cluster (buildings the closing can merge),
then each block takes the prepared clusters that intersect its cameras' range disks.
"""

from __future__ import annotations

import math
import os
import random
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

from lacarte import apply, buildings, camerafield, regions
from lacarte.viewshed import ObstacleIndex

BLOCK_RES = 6
BLOCK_CHECK_SAMPLE = 500  # cameras recomputed alone to check block independence


def run(region: regions.Region, workers: int | None = None) -> dict[str, Path]:
    cams = gpd.read_parquet(region.build_dir / apply.CAMERAS)
    blds = gpd.read_parquet(region.build_dir / "buildings.parquet")
    # A camera verified gone (rules/contributions.yaml not_found) films nothing.
    outdoor = cams[cams.is_camera & ~cams.indoor & ~apply.gone(cams)].reset_index(drop=True)
    views, bands = compute(outdoor, blds.geometry.values, region.crs, workers)
    paths = {
        "views": region.build_dir / "views.parquet",
        "bands": region.build_dir / "bands.parquet",
    }
    views.to_parquet(paths["views"])
    bands.to_parquet(paths["bands"])
    return paths


def compute(
    cams: gpd.GeoDataFrame, raw_buildings: np.ndarray, crs: str, workers: int | None = None
) -> gpd.GeoDataFrame:
    workers = workers or os.cpu_count()
    to_ll = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lon, lat = to_ll.transform(cams.geometry.x.values, cams.geometry.y.values)
    blocks = [h3.latlng_to_cell(la, lo, BLOCK_RES) for la, lo in zip(lat, lon, strict=True)]
    cams = cams.assign(block=blocks)
    # PTZ cameras also get their zoomed-reach outline: select obstacles out to it.
    radius = [camerafield.select_radius(k, r) for k, r in zip(cams.kind, cams.range_m, strict=True)]
    disks = shapely.buffer(cams.geometry.values, np.asarray(radius, dtype=float))

    # Prepare every building cluster that any camera can see, once for the whole region,
    # so that a cluster has the same geometry in every block that uses it.
    raw_tree = shapely.STRtree(raw_buildings)
    seeds = np.unique(raw_tree.query(disks, predicate="intersects")[1])
    groups = buildings.clusters(raw_buildings, raw_tree, seeds)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        chunks = [shapely.to_wkb(raw_buildings[g]) for g in groups]
        prepared = [p for group in pool.map(_prepare, chunks, chunksize=256) for p in group]
    prepared = shapely.from_wkb(prepared) if prepared else np.empty(0, dtype=object)
    tree = shapely.STRtree(prepared)

    jobs = []
    for _, group in cams.groupby("block"):
        idx = np.unique(tree.query(disks[group.index.values], predicate="intersects")[1])
        jobs.append((_records(group), shapely.to_wkb(prepared[idx])))
    rows = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for block_rows in pool.map(_process_block, jobs, chunksize=1):
            rows.extend(block_rows)

    # Block independence check: a sample of cameras, each recomputed with only the
    # obstacles around itself, must give the same geometry.
    by_id = {r["camera_id"]: r for r in rows}
    sample = random.Random(42).sample(range(len(cams)), min(BLOCK_CHECK_SAMPLE, len(cams)))
    solo_jobs = []
    for i in sample:
        idx = tree.query(disks[i], predicate="intersects")
        solo_jobs.append((_records(cams.iloc[[i]]), shapely.to_wkb(prepared[idx])))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for (solo,) in pool.map(_process_block, solo_jobs, chunksize=8):
            ref = by_id[solo["camera_id"]]
            a, b = shapely.from_wkb(solo["wkb"]), shapely.from_wkb(ref["wkb"])
            ref["block_diff_m2"] = float(a.symmetric_difference(b).area)

    out = pd.DataFrame(rows)
    band_rows = [{"camera_id": r["camera_id"], **b} for r in rows for b in r["bands"]]
    out = out.drop(columns=["bands"])
    geom = shapely.from_wkb(out.pop("wkb").to_numpy())
    reach = out.pop("reach_wkb").to_numpy()
    views = gpd.GeoDataFrame(out, geometry=geom, crs=crs)
    views["reach"] = gpd.GeoSeries(
        [shapely.from_wkb(w) if w is not None else None for w in reach], crs=crs
    )
    bands = pd.DataFrame(band_rows, columns=["camera_id", "level", "band", "reach_m", "wkb"])
    band_geom = shapely.from_wkb(bands.pop("wkb").to_numpy()) if len(bands) else []
    return views, gpd.GeoDataFrame(bands, geometry=band_geom, crs=crs)


def _prepare(wkbs: list[bytes]) -> list[bytes]:
    return [shapely.to_wkb(p) for p in buildings.prepare(shapely.from_wkb(wkbs))]


def _records(group: gpd.GeoDataFrame) -> list[dict]:
    return [
        {
            "camera_id": r.camera_id,
            "x": r.geometry.x,
            "y": r.geometry.y,
            "directions": list(r.directions),
            "fov_deg": r.fov_deg,
            "range_m": r.range_m,
            "geom_certainty": r.geom_certainty,
            "kind": r.kind,
            "mount": _mount(r),
            # Moved or added by a participant (apply.applied_cameras): under a roof when
            # inside a footprint (camerafield.field).
            "placed": getattr(r, "position_source", None) == "contribution",
        }
        for r in group.itertuples(index=False)
    ]


def _mount(r) -> tuple[float, float] | None:
    return camerafield.mount(getattr(r, "tilt_deg", None), r.height_m, r.height_certainty)


def _process_block(job: tuple[list[dict], list[bytes]]) -> list[dict]:
    recs, wkbs = job
    index = ObstacleIndex(list(shapely.from_wkb(wkbs)) if len(wkbs) else [])
    out = []
    for r in recs:
        f = camerafield.field(r, index)
        view, reach = f.pop("view"), f.pop("reach")
        del f["x"], f["y"]
        f.update({
            "block_diff_m2": math.nan,
            "wkb": shapely.to_wkb(view),
            "reach_wkb": shapely.to_wkb(reach) if reach is not None else None,
        })  # fmt: skip
        out.append(f)
    return out
