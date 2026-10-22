"""A region built in parts (regions.yaml `parts`: metropolitan France), then merged.

    lacarte build --region france [--from cut|parts|merge|tiles|tiles_stats] [--resume]

1. cut: each part's .pbf from the region's (extract.cut_parts: its units widened by its
   buffer_m, a few parts per reading of the region's file);
2. parts: every part through PART_STAGES, stage by stage, each (part, stage) in a process
   of its own (its time and peak memory recorded in progress.json; memory freed between
   them). After `apply`, the region's data date (the latest edit among every part's
   cameras) is written into each part: freshness dates from one day, as one build would;
3. merge: who owns what (owners), then the cameras, their filter attributes, the areas,
   what the build did with the contributions, in the region's folder;
4. tiles (merged_tiles): the region's filters and compact numbers (camera_filters,
   compact_ids over every owned camera), each part's features of what it owns appended to
   the region's sources, one tippecanoe run per archive (tiles.finish); then tiles_stats.

Ownership: a camera, a segment (by its midpoint) or a building (db.py) belongs to the part
whose units contain it, the lowest-ranked when two do; outside every part (sea, abroad), to
the nearest. A part's buffer (480 m, more than the longest reach) gives its cameras the
buildings they see and its segments the cameras that film them, so what a part owns is what
one build of the whole would compute. The communes and départements never straddle parts.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from lacarte import aggregate, apply, buildinfo, extract, regions, tiles
from lacarte.camerafilters import camera_filters

PART_STAGES = ("extract", "normalize", "apply", "views", "exposure", "qa", "admin")
STAGES = ("cut", "parts", "merge", "tiles", "tiles_stats")
OWNERS = "owners.parquet"
CAMERA_OWNERS = "camera_owners.parquet"
VIEW_FILTERS = "views_filters.parquet"
PROGRESS = "progress.json"
# The build stops before a part's stage when the disk holding the builds has less free
# space than this (GB; the build may be resumed with --resume once space is made).
MIN_FREE_GB = float(os.environ.get("LACARTE_MIN_FREE_GB", "50"))


def build(region: regions.Region, start: str = "cut", resume: bool = False,
          isolate: bool = True, log=print) -> None:  # fmt: skip
    """The stages from `start`. `isolate`: each part's stage in its own process (a real
    build); in this process otherwise (the tests' pinned regions). `resume`: skip the
    (part, stage) pairs a previous run finished."""
    region.build_dir.mkdir(parents=True, exist_ok=True)
    if STAGES.index(start) > STAGES.index("parts"):
        wanted = "".join(f"{c}\n" for c in sorted(regions.hidden(region)))
        for part in regions.parts(region):
            if (part.build_dir / extract.HIDDEN_APPLIED).read_text() != wanted:
                raise SystemExit(f"the hidden cameras changed since {part.name}'s extract:"
                                 " build from parts")  # fmt: skip
    for stage in STAGES[STAGES.index(start) :]:
        t0 = time.perf_counter()
        if stage == "cut":
            extract.cut_parts(regions.parts(region), extract.ensure_source(region))
        elif stage == "parts":
            run_parts(region, resume=resume, isolate=isolate, log=log)
        elif stage == "merge":
            merge(region)
        elif stage == "tiles":
            tiles.run(region)
        else:
            tiles.run_stats(region)
        _record(region, "stages", stage, {"s": round(time.perf_counter() - t0, 1)})
        log(f"{stage}: {time.perf_counter() - t0:.1f} s")


def run_parts(region: regions.Region, resume: bool = False, isolate: bool = True,
              log=print) -> None:  # fmt: skip
    parts = regions.parts(region)
    done = _progress(region).get("parts", {}) if resume else {}
    if not resume:
        _reset(region, "parts")
    for stage in PART_STAGES:
        if stage == "views":
            write_data_date(region, parts)
        for part in parts:
            if stage in done.get(part.name, {}):
                continue
            _check_space(region, isolate)
            t0 = time.perf_counter()
            rss = _run_stage(part, stage, isolate)
            took = round(time.perf_counter() - t0, 1)
            entry = {"s": took, **({"rss_gb": round(rss / 1e9, 2)} if rss else {})}
            _record(region, "parts", part.name, {stage: entry}, nested=True)
            log(f"{part.name} {stage}: {took} s" + (f", {rss / 1e9:.1f} GB" if rss else ""))


def _run_stage(part: regions.Region, stage: str, isolate: bool) -> int | None:
    """One part's stage; its peak memory (bytes) when run in a process of its own."""
    if not isolate:
        from lacarte import cli

        cli.STAGES[stage](part)
        return None
    cmd = [sys.executable, "-m", "lacarte.cli", "build", "--region", part.name, "--only", stage]
    proc = subprocess.Popen(cmd)
    _, status, usage = os.wait4(proc.pid, 0)
    proc.returncode = os.waitstatus_to_exitcode(status)
    if proc.returncode != 0:
        raise SystemExit(f"{part.name} {stage}: exit {proc.returncode}")
    # ru_maxrss: bytes on macOS, kibibytes on Linux (getrusage(2) of each).
    return usage.ru_maxrss if sys.platform == "darwin" else usage.ru_maxrss * 1024


def _check_space(region: regions.Region, isolate: bool) -> None:
    if not isolate:
        return
    free = shutil.disk_usage(region.build_dir).free / 1e9
    if free < MIN_FREE_GB:
        raise SystemExit(
            f"paused: {free:.0f} GB free, under {MIN_FREE_GB:.0f} GB (LACARTE_MIN_FREE_GB):"
            " make space, then --from parts --resume"
        )


def write_data_date(region: regions.Region, parts: list[regions.Region]) -> str:
    """The region's data date, the latest edit among every part's cameras, written into
    each part and the region (regions.Region.data_date)."""
    cols = ["osm_timestamp"]
    stamps = [pd.read_parquet(p.build_dir / apply.CAMERAS, columns=cols) for p in parts]
    day = max(aggregate.data_date(s) for s in stamps).isoformat()
    for r in (*parts, region):
        r.build_dir.mkdir(parents=True, exist_ok=True)
        r.data_date_file.write_text(day + "\n")
    return day


# --- ownership ------------------------------------------------------------------------------


def outlines(region: regions.Region) -> gpd.GeoDataFrame:
    """Each part's units, as one shape (no buffer), in its order: part, geometry."""
    from lacarte import admin

    rows = []
    for part in regions.parts(region):
        units, _ = admin.region_units(part)
        rows.append({"part": part.name, "geometry": shapely.union_all(units.geometry.values)})
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=region.crs)


def owner(points, shapes: gpd.GeoDataFrame) -> np.ndarray:
    """Per point (the shapes' CRS), the rank of the shape that contains it, the lowest when
    two do; outside every shape, the nearest's."""
    points = np.asarray(points)
    out = np.full(len(points), -1, dtype=np.int64)
    if not len(points):
        return out
    geoms = shapes.geometry.values
    x, y = shapely.get_x(points), shapely.get_y(points)
    # A prepared shape answers contains_xy with its own index: 0.0004 ms a point against a
    # part's outline, 75 times less than an STRtree `within` query (measured on fr-idf).
    for rank, shape in enumerate(geoms):
        todo = np.flatnonzero(out < 0)
        if not len(todo):
            break
        x0, y0, x1, y1 = shape.bounds
        near = todo[(x[todo] >= x0) & (x[todo] <= x1) & (y[todo] >= y0) & (y[todo] <= y1)]
        if len(near):
            shapely.prepare(shape)
            out[near[shapely.contains_xy(shape, x[near], y[near])]] = rank
    rest = np.flatnonzero(out < 0)
    if len(rest):
        near = shapely.STRtree(geoms).query_nearest(points[rest], all_matches=False)
        out[rest[near[0]]] = near[1]
    return out


def midpoints(lines) -> np.ndarray:
    return shapely.line_interpolate_point(np.asarray(lines), 0.5, normalized=True)


def camera_owners(region: regions.Region, shapes: gpd.GeoDataFrame) -> dict[str, int]:
    """camera id -> the rank of the part it belongs to (owner), among the parts whose
    cameras hold it: a camera drawn as a way may come with a part (osmium's smart strategy)
    beyond its buffer. An added camera (phase "Ajouter") is applied by every part, wherever
    it stands: it belongs to the part of its position only, and to none when that part
    refused it (a duplicate of an OSM camera there)."""
    held: dict[str, list[int]] = {}
    where: dict[str, int] = {}
    for i, part in enumerate(regions.parts(region)):
        cams = gpd.read_parquet(part.build_dir / apply.CAMERAS, columns=["camera_id", "geometry"])
        ranks = owner(cams.geometry.values, shapes)
        for cid, rank in zip(cams.camera_id, ranks, strict=True):
            held.setdefault(cid, []).append(i)
            where.setdefault(cid, int(rank))
    out = {}
    for cid, have in held.items():
        rank = choose(cid, where[cid], have)
        if rank is not None:
            out[cid] = rank
    return out


def choose(camera_id: str, where: int, have: list[int]) -> int | None:
    """The owner of a camera standing in part `where`, held by the parts `have`: `where`
    when it holds it; else the first holder, but an added camera, which none owns then."""
    if where in have:
        return where
    return None if apply.is_added(camera_id) else have[0]


# --- merge ----------------------------------------------------------------------------------


def merge(region: regions.Region) -> dict[str, Path]:
    """The region's owners, cameras (cameras_applied), their filter attributes
    (views_filters), areas, contribution outcome and hidden list, from its parts."""
    b = region.build_dir
    parts = regions.parts(region)
    shapes = outlines(region)
    shapes.to_parquet(b / OWNERS)
    owners = camera_owners(region, shapes)
    pd.DataFrame({"camera_id": list(owners), "rank": list(owners.values())}).to_parquet(
        b / CAMERA_OWNERS
    )
    cams, views, areas = [], [], []
    for i, part in enumerate(parts):
        c = gpd.read_parquet(part.build_dir / apply.CAMERAS)
        mine = c[c.camera_id.map(owners).eq(i)]
        cams.append(mine)
        v = pd.read_parquet(part.build_dir / "views.parquet", columns=tiles.VIEW_FILTER_COLUMNS)
        views.append(v[v.camera_id.isin(set(mine.camera_id))])
        areas.append(gpd.read_parquet(part.build_dir / "areas.parquet"))
    merged = gpd.GeoDataFrame(pd.concat(cams, ignore_index=True), crs=region.crs)
    if merged.camera_id.duplicated().any():
        raise ValueError("a camera owned twice")
    merged.to_parquet(b / apply.CAMERAS)
    pd.concat(views, ignore_index=True).to_parquet(b / VIEW_FILTERS)
    units = gpd.GeoDataFrame(pd.concat(areas, ignore_index=True), crs=areas[0].crs)
    if units.duplicated(["level", "code"]).any():
        raise ValueError("an area in two parts")
    # As one build orders them: the communes by code, then the départements.
    units = units.sort_values(["level", "code"], key=lambda c: c.ne("commune") if c.name ==
                              "level" else c).reset_index(drop=True)  # fmt: skip
    units.to_parquet(b / "areas.parquet")
    hidden = {(p.build_dir / extract.HIDDEN_APPLIED).read_text() for p in parts}
    if len(hidden) != 1:
        raise ValueError("the parts left out different hidden cameras: build them again")
    (b / extract.HIDDEN_APPLIED).write_text(hidden.pop())
    out = {"cameras": b / apply.CAMERAS, "areas": b / "areas.parquet"}
    outcome = merge_outcome(region, parts, owners, shapes)
    if outcome:
        out["outcome"] = outcome
    return out


def merge_outcome(region: regions.Region, parts: list[regions.Region],
                  owners: dict[str, int], shapes: gpd.GeoDataFrame) -> Path | None:  # fmt: skip
    """What the build did with each contribution: what the part owning its camera did (an
    add refused as a duplicate, by the part of its position). None without contributions."""
    path = region.build_dir / apply.OUTCOME
    docs = [p.build_dir / apply.OUTCOME for p in parts]
    if not any(d.exists() for d in docs):
        path.unlink(missing_ok=True)
        return None
    by_part = [
        {o["uuid"]: o for o in json.loads(d.read_text())["contributions"]} if d.exists() else {}
        for d in docs
    ]
    rank_of: dict[str, int] = {}
    for c in apply.read(region.contrib_file):
        if c.camera_id in owners:
            rank_of.setdefault(c.camera_id, owners[c.camera_id])
        elif c.x is not None and c.camera_id not in rank_of:
            rank_of[c.camera_id] = int(owner([shapely.Point(c.x, c.y)], shapes)[0])
    report = []
    for c in sorted(apply.read(region.contrib_file), key=lambda c: c.uuid):
        rank = rank_of.get(c.camera_id, 0)
        o = by_part[rank].get(c.uuid) or next((d[c.uuid] for d in by_part if c.uuid in d), None)
        if o is not None:  # none for a hidden camera's: no part applies it (apply.run)
            report.append(o)
    doc = {"build_id": buildinfo.build_id(region), "contributions": report}
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    return path


# --- tiles ----------------------------------------------------------------------------------


def merged_tiles(region: regions.Region) -> dict[str, Path]:
    """The region's tiles: one set of filters and compact numbers over every owned camera,
    each part's features of what it owns (tiles.write_features), then tiles.finish."""
    b = region.build_dir
    src, out = tiles.sources(b)
    areas = gpd.read_parquet(b / "areas.parquet")
    cams = gpd.read_parquet(b / apply.CAMERAS)
    views = pd.read_parquet(b / VIEW_FILTERS)
    filters, lists = camera_filters(cams, views, region.data_date())
    compact = tiles.compact_ids(cams.camera_id)
    masks = tiles.masks_of(cams, filters)
    shapes = gpd.read_parquet(b / OWNERS)
    rank = pd.read_parquet(b / CAMERA_OWNERS).set_index("camera_id")["rank"]
    offset = 0
    for i, part in enumerate(regions.parts(region)):
        pb = part.build_dir
        pc = pd.read_parquet(pb / apply.CAMERAS, columns=["camera_id"])
        own_cams = pc.camera_id.map(rank).eq(i).to_numpy()
        edges = gpd.read_parquet(pb / "edges.parquet", columns=["geometry"])
        own_edges = owner(midpoints(edges.geometry.values), shapes) == i
        offset += tiles.write_features(pb, src, part.crs, areas, filters, compact, masks,
                                       own_cams, own_edges, offset)  # fmt: skip
    return tiles.finish(region, src, out, areas, cams, filters, lists, compact)


# --- progress -------------------------------------------------------------------------------


def _progress(region: regions.Region) -> dict:
    path = region.build_dir / PROGRESS
    return json.loads(path.read_text()) if path.exists() else {}


def _reset(region: regions.Region, key: str) -> None:
    doc = _progress(region)
    doc.pop(key, None)
    (region.build_dir / PROGRESS).write_text(json.dumps(doc, indent=1))


def _record(region: regions.Region, key: str, name: str, value: dict,
            nested: bool = False) -> None:  # fmt: skip
    doc = _progress(region)
    section = doc.setdefault(key, {})
    if nested:
        section.setdefault(name, {}).update(value)
    else:
        section[name] = value
    (region.build_dir / PROGRESS).write_text(json.dumps(doc, indent=1))
