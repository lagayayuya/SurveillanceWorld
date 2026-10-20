"""Street audit: what the streets tiles colour against what is filmed, the street filters
against the cameras they keep, the published shares and the tile weights.

`lacarte audit --region NAME` writes qa/out/<region>/streets_audit.json; the tests run the
same checks on the CI extract. The vector-tile decoder is minimal (line features and
their properties) so that no dependency is added.

Lengths are measured in each tile's own units and turned into metres at the tile's
latitude (Web Mercator scale), for the tiles and for the filmed reference alike.
"""

from __future__ import annotations

import gzip
import json
import struct
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
import shapely.ops
from pmtiles.reader import MmapSource, all_tiles

from lacarte import apply, camerafilters, exposure, optics, regions, tiles

C = 2 * np.pi * 6378137.0  # Web Mercator world width (m)
TOL_REL, TOL_ABS_M = 0.05, 1.0  # coloured length per tile within max(1 m, 5 %) of filmed
OUTSIDE_MIN_M = 1.0  # a coloured stretch off every filmed interval longer than this fails
# ...except at z12-14 (MERGED_ZOOMS), where tile coordinates are integers of 1.57 m (z12):
# an interval's end moves by up to ~1 unit; 2.5 m is 0.2-0.4 screen pixel (IDF max 2.45 m)
# — author's decision.
OUTSIDE_MERGED_M = 2.5
FILTER_SLACK_M = 0.5  # a kept portion may overrun its kept cameras by this much


# --- vector tiles ----------------------------------------------------------------------


def _varint(b: bytes, i: int) -> tuple[int, int]:
    v = s = 0
    while True:
        c = b[i]
        i += 1
        v |= (c & 0x7F) << s
        if c < 0x80:
            return v, i
        s += 7


def _fields(b: bytes):
    """(field number, value) of a protobuf message: ints for varints, bytes otherwise."""
    i, n = 0, len(b)
    while i < n:
        key, i = _varint(b, i)
        f, w = key >> 3, key & 7
        if w == 0:
            v, i = _varint(b, i)
        elif w == 2:
            size, i = _varint(b, i)
            v, i = b[i : i + size], i + size
        elif w == 1:
            v, i = b[i : i + 8], i + 8
        elif w == 5:
            v, i = b[i : i + 4], i + 4
        else:
            raise ValueError(f"protobuf wire type {w}")
        yield f, v


def _packed(b: bytes) -> list[int]:
    out, i = [], 0
    while i < len(b):
        v, i = _varint(b, i)
        out.append(v)
    return out


def _zigzag(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def _value(b: bytes):
    for f, v in _fields(b):
        if f == 1:
            return v.decode()
        if f == 2:
            return struct.unpack("<f", v)[0]
        if f == 3:
            return struct.unpack("<d", v)[0]
        if f == 4:
            return v - (1 << 64) if v >= 1 << 63 else v
        if f == 5:
            return v
        if f == 6:
            return _zigzag(v)
        if f == 7:
            return bool(v)
    return None


def lines_of(commands: list[int]) -> list[np.ndarray]:
    """Geometry commands of a line feature -> its parts, (n, 2) arrays in tile units."""
    parts: list[list[tuple[int, int]]] = []
    x = y = i = 0
    while i < len(commands):
        cid, count = commands[i] & 7, commands[i] >> 3
        i += 1
        if cid == 7:  # ClosePath
            continue
        for _ in range(count):
            x += _zigzag(commands[i])
            y += _zigzag(commands[i + 1])
            i += 2
            if cid == 1:  # MoveTo
                parts.append([(x, y)])
            else:  # LineTo
                parts[-1].append((x, y))
    return [np.asarray(p, dtype=float) for p in parts if len(p) >= 2]


def decode(data: bytes) -> dict[str, dict]:
    """{layer: {"extent": n, "features": [(id, props, geometry type, commands)]}}."""
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    out = {}
    for f, layer in _fields(data):
        if f != 3:
            continue
        name, extent, keys, values, raw = "", 4096, [], [], []
        for lf, v in _fields(layer):
            if lf == 1:
                name = v.decode()
            elif lf == 2:
                raw.append(v)
            elif lf == 3:
                keys.append(v.decode())
            elif lf == 4:
                values.append(_value(v))
            elif lf == 5:
                extent = v
        features = []
        for fb in raw:
            fid, tags, gtype, geom = None, [], 0, []
            for ff, v in _fields(fb):
                if ff == 1:
                    fid = v
                elif ff == 2:
                    tags = _packed(v)
                elif ff == 3:
                    gtype = v
                elif ff == 4:
                    geom = _packed(v)
            props = {keys[tags[k]]: values[tags[k + 1]] for k in range(0, len(tags), 2)}
            features.append((fid, props, gtype, geom))
        out[name] = {"extent": extent, "features": features}
    return out


def read_tiles(path: Path, zooms) -> dict[tuple[int, int, int], bytes]:
    with path.open("rb") as fh:
        return {k: d for k, d in all_tiles(MmapSource(fh)) if k[0] in zooms}


# --- what the streets style colours ----------------------------------------------------


def coloured(layer: str, props: dict, z: int, est: int) -> bool:
    """Whether the streets style colours this feature at zoom `z` for estimate `est`,
    every camera (web/src/layers.ts). Two schemas: until the phase "tronçons", segments
    coloured by class below z15 (`c<est>`); since, the portions layer alone, every zoom."""
    if layer == "edges":
        return z < 15 and props.get(f"c{est}", 0) > 0
    if layer == "portions":
        return props.get("b") == est
    return False


# --- filmed reference ------------------------------------------------------------------


def visible_column(edges: gpd.GeoDataFrame) -> str:
    """The edge column saying what is drawn below z16: street axes (not sidewalks,
    crossings, nor paths beside a road since rules/streets.yaml parallel_path)."""
    return "axis"


def filmed_lines(edges: gpd.GeoDataFrame, intervals: pd.DataFrame, est: int):
    """Filmed stretches (every camera) of estimate `est` as lines in EPSG:3857, and
    whether their segment is drawn below z16."""
    iv = intervals[(intervals.est == est) & ~intervals.pub & ~intervals["dir"]]
    lines = edges.geometry.values
    geoms = [
        shapely.ops.substring(lines[e], lo, hi)
        for e, lo, hi in zip(iv.e.to_numpy(), iv.lo.to_numpy(), iv.hi.to_numpy(), strict=True)
    ]
    g = gpd.GeoSeries(geoms, crs=edges.crs).to_crs("EPSG:3857").values
    visible = edges[visible_column(edges)].to_numpy()[iv.e.to_numpy()]
    return np.asarray(g, dtype=object), visible


def _to_world(geoms, z: int, extent: int):
    """EPSG:3857 -> world tile units at zoom z (y down)."""
    scale = 2**z * extent / C

    def f(xy):
        return np.column_stack(((xy[:, 0] + C / 2) * scale, (C / 2 - xy[:, 1]) * scale))

    return shapely.transform(geoms, f)


def _unit_m(z: int, y: int, extent: int) -> float:
    """Ground metres of one tile unit at the middle of tile row y."""
    n = 2**z
    lat = np.arctan(np.sinh(np.pi * (1 - 2 * (y + 0.5) / n)))
    return C / (n * extent) * float(np.cos(lat))


def tile_audit(
    tile_data: dict, edges: gpd.GeoDataFrame, intervals: pd.DataFrame, estimates, zooms
) -> dict:
    """Per zoom and estimate: coloured length against filmed length (segments drawn at that
    zoom), tiles outside max(1 m, 5 %), coloured stretches off every filmed interval (any
    segment) and off the filmed intervals of the segments drawn at that zoom (so off the
    axes below z16), counted when longer than OUTSIDE_MIN_M."""
    extent = next(
        (layer["extent"] for d in tile_data.values() for layer in decode(d).values()), 4096
    )
    refs = {est: filmed_lines(edges, intervals, est) for est in estimates}
    out: dict = {}
    for z in zooms:
        prep = {}
        keys = {k for k in tile_data if k[0] == z}
        for est, (ref, visible) in refs.items():
            world = _to_world(ref, z, extent)
            vis = visible if z < 16 else np.ones(len(ref), bool)
            prep[est] = (world, vis, shapely.STRtree(world))
            for x0, y0, x1, y1 in (shapely.bounds(world) // extent).astype(int):
                keys.update((z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1))
        # Lateral slack, in tile units: quantisation and tippecanoe's simplification, ours
        # on the merged zooms, and half a metre.
        slack_units = 2 * extent / 4096 + (
            tiles.SIMPLIFY_PX * extent / tiles.TILE_PX if z in tiles.MERGED_ZOOMS else 0
        )
        per_tile: dict[int, list] = {est: [] for est in estimates}
        for key in sorted(keys):
            _, tx, ty = key
            layers = decode(tile_data[key]) if key in tile_data else {}
            for layer in layers.values():
                if layer["extent"] != extent:
                    raise ValueError(f"tile {key}: extent {layer['extent']}")
            rect = (tx * extent, ty * extent, (tx + 1) * extent, (ty + 1) * extent)
            u = _unit_m(z, ty, extent)
            # The filmed lines around the tile too: a curve leaving the tile may be drawn
            # inside it as its simplified chord.
            pad = slack_units + 0.5 / u
            around = (rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad)
            for est in estimates:
                world, vis, tree = prep[est]
                hit = tree.query(shapely.box(*around))
                clipped = shapely.clip_by_rect(world[hit], *rect)
                filmed_m = float(shapely.length(clipped[vis[hit]]).sum()) * u
                col = [
                    part + (tx * extent, ty * extent)
                    for name, layer in layers.items()
                    for _, props, gtype, geom in layer["features"]
                    if gtype == 2 and coloured(name, props, z, est)
                    for part in lines_of(geom)
                ]
                col_m, off, off_vis = 0.0, (0.0, 0, 0), (0.0, 0, 0)
                if col:
                    idx = np.repeat(np.arange(len(col)), [len(c) for c in col])
                    lines = shapely.linestrings(np.concatenate(col), indices=idx)
                    col_geom = shapely.clip_by_rect(lines, *rect)
                    col_m = float(shapely.length(col_geom).sum()) * u
                    near = shapely.clip_by_rect(world[hit], *around)
                    zones = shapely.buffer(near, pad, cap_style="flat", quad_segs=2)
                    drawn = shapely.union_all(col_geom)
                    lim = OUTSIDE_MERGED_M if z in tiles.MERGED_ZOOMS else OUTSIDE_MIN_M
                    off = _off(drawn, shapely.union_all(zones), u, lim)
                    off_vis = (
                        _off(drawn, shapely.union_all(zones[vis[hit]]), u, lim) if z < 16 else off
                    )
                per_tile[est].append((key, col_m, filmed_m, *off, *off_vis))
        for est in estimates:
            out[f"z{z}_b{est}"] = _zoom_summary(per_tile[est])
    return out


def _off(drawn, zone, u: float, limit: float) -> tuple[float, int, int]:
    """Length (m) and count of the parts of `drawn` outside `zone` longer than
    OUTSIDE_MIN_M, and the count of those longer than `limit` (the zoom's tolerance)."""
    lens = shapely.length(shapely.get_parts(shapely.difference(drawn, zone))) * u
    long = lens > OUTSIDE_MIN_M
    return float(lens[long].sum()), int(long.sum()), int((lens > limit).sum())


def _zoom_summary(per_tile) -> dict:
    col = np.array([t[1] for t in per_tile])
    fil = np.array([t[2] for t in per_tile])
    bad = np.abs(col - fil) > np.maximum(TOL_ABS_M, TOL_REL * fil)
    worst = sorted(per_tile, key=lambda t: -abs(t[1] - t[2]))[:5]
    return {
        "tiles": len(per_tile),
        "coloured_km": round(col.sum() / 1000, 3),
        "filmed_km": round(fil.sum() / 1000, 3),
        "tiles_out_of_tolerance": int(bad.sum()),
        "out_of_tolerance_near_empty": int((bad & (fil < 20)).sum()),
        "off_filmed_km": round(sum(t[3] for t in per_tile) / 1000, 3),
        "off_filmed_stretches": int(sum(t[4] for t in per_tile)),
        "off_filmed_beyond_limit": int(sum(t[5] for t in per_tile)),
        "off_drawn_axes_km": round(sum(t[6] for t in per_tile) / 1000, 3),
        "off_drawn_axes_stretches": int(sum(t[7] for t in per_tile)),
        "off_drawn_axes_beyond_limit": int(sum(t[8] for t in per_tile)),
        "worst_tiles": [
            {
                "tile": "/".join(map(str, t[0])),
                "coloured_m": round(t[1], 1),
                "filmed_m": round(t[2], 1),
            }
            for t in worst
        ],  # fmt: skip
    }


# --- filters ---------------------------------------------------------------------------


def filter_names() -> list[str]:
    """The 26 simple filters: who, type, freshness, the flags, identification far."""
    return [
        *(f"op:{c}" for c in camerafilters.OP_CODE.values()),
        *(f"kind:{k}" for k in camerafilters.KIND_ORDER),
        *camerafilters.FRESH_ROWS,
        *camerafilters.FLAG_ROWS,
        "identifies_far",
    ]


def camera_categories(cams: gpd.GeoDataFrame, views: gpd.GeoDataFrame, est: int) -> dict:
    """camera id -> the simple filters it passes, for estimate `est`."""
    filters, _ = camerafilters.camera_filters(cams, views)
    out = {}
    for c in cams.itertuples(index=False):
        fl = filters[c.camera_id]["fl"]
        cats = {
            f"op:{camerafilters.OP_CODE[c.operator_class]}",
            f"kind:{c.kind}",
            camerafilters.FRESH_ROWS[fl % 4],
        }
        cats |= {r for r in camerafilters.FLAG_ROWS if (fl >> camerafilters.FLAG_BITS[r]) & 1}
        if (fl >> camerafilters.FLAG_BITS[f"identifies_far_{est}"]) & 1:
            cats.add("identifies_far")
        out[c.camera_id] = cats
    return out


def camera_intervals(edges: gpd.GeoDataFrame, bands: gpd.GeoDataFrame, estimates):
    """Every camera's filmed stretches at the display floor or above (levels are measured on
    the union with the higher ones, exposure.at_or_above): (e, lo, hi, cam, band)."""
    floor = exposure.at_or_above(exposure.FLOOR)
    sel = bands[bands.level.isin(floor) & (bands.band <= max(estimates))]
    pairs = exposure.edge_band_pairs(edges, sel.reset_index(drop=True))
    e, lo, hi, owner = exposure.part_intervals(
        edges.geometry.values, pairs.e.to_numpy(), pairs.piece
    )
    return pd.DataFrame({
        "e": e, "lo": lo, "hi": hi,
        "cam": pairs.cam.to_numpy()[owner], "band": pairs.band.to_numpy()[owner],
    })  # fmt: skip


def overrun(drawn: pd.DataFrame, kept: pd.DataFrame) -> np.ndarray:
    """Per drawn interval (e, lo, hi): its length outside the kept intervals (merged, per
    edge)."""
    d = drawn.reset_index(drop=True).assign(i=lambda f: np.arange(len(f)))
    m = d.merge(kept, on="e", how="left", suffixes=("", "_k"))
    ov = np.clip(np.minimum(m.hi, m.hi_k) - np.maximum(m.lo, m.lo_k), 0, None)
    covered = pd.Series(np.nan_to_num(ov)).groupby(m.i.to_numpy()).sum().to_numpy()
    return (d.hi - d.lo).to_numpy() - covered


def portion_intervals(edges: gpd.GeoDataFrame, portions: gpd.GeoDataFrame) -> pd.DataFrame:
    e, lo, hi, owner = exposure.part_intervals(
        edges.geometry.values, portions.e.to_numpy(), portions.geometry.values
    )
    return pd.DataFrame({"e": e, "lo": lo, "hi": hi, "p": owner})


def _exploded(lists) -> pd.DataFrame:
    """Lists of "camera:band" -> one row per item: (i, cam, band)."""
    rows = [(i, *cb.rsplit(":", 1)) for i, cs in enumerate(lists) for cb in cs]
    df = pd.DataFrame(rows, columns=["i", "cam", "band"])
    return df.astype({"band": int})


def filter_audit(edges, portions, cam_iv, cams, views, estimates, names=None) -> dict:
    """For each simple filter and shown estimate: length drawn as kept against length
    filmed by the kept cameras. `portions` = filmed portions (every one, then those drawn
    below z16); `segments` = whole filmed axes (what the portions' zooms kept before).
    `names`: filters to test (default the 26 simple ones); "a&b" keeps the cameras in both
    categories."""
    vis = edges[visible_column(edges)].to_numpy()
    p_iv = portion_intervals(edges, portions)
    p_band = portions.band.to_numpy()
    p_cams = _exploded(portions.cameras)
    s_cams = _exploded(edges.camera_bands)
    s_cams = s_cams[vis[s_cams.i.to_numpy()]]
    out = {}
    for est in estimates:
        cats = camera_categories(cams, views, est)
        on_est = p_iv[p_band[p_iv.p.to_numpy()] == est]
        for name in names or filter_names():
            keep_cam = [c for c, s in cats.items() if all(n in s for n in name.split("&"))]
            kiv = cam_iv[(cam_iv.band <= est) & cam_iv.cam.isin(keep_cam)]
            g, a, b = exposure.merge_intervals(
                kiv.e.to_numpy(), kiv.lo.to_numpy(), kiv.hi.to_numpy()
            )
            kept = pd.DataFrame({"e": g, "lo_k": a, "hi_k": b})
            row = {"kept_filmed_km": round(float((b - a).sum()) / 1000, 3)}
            kp = p_cams[(p_cams.band <= est) & p_cams.cam.isin(keep_cam)].i.unique()
            drawn = on_est[on_est.p.isin(kp)][["e", "lo", "hi"]]
            below = drawn[vis[drawn.e.to_numpy()]]
            for label, dr in (("portions", drawn), ("portions_below16", below)):
                row[label] = _over_summary(dr, overrun(dr, kept) if len(dr) else np.zeros(0))
            seg = s_cams[(s_cams.band <= est) & s_cams.cam.isin(keep_cam)].i.unique()
            sdr = pd.DataFrame({"e": seg, "lo": 0.0, "hi": edges.length_m.to_numpy()[seg]})
            row["segments"] = _over_summary(sdr, overrun(sdr, kept) if len(sdr) else np.zeros(0))
            out[f"{name}_b{est}"] = row
    return out


def _over_summary(drawn: pd.DataFrame, over: np.ndarray) -> dict:
    return {
        "drawn_km": round(float((drawn.hi - drawn.lo).sum()) / 1000, 3),
        "overrun_km": round(float(over.sum()) / 1000, 3),
        "over_slack": int((over > FILTER_SLACK_M).sum()),
        "max_overrun_m": round(float(over.max()), 2) if len(over) else 0.0,
    }


# --- portions, shares, weights ---------------------------------------------------------


def portion_audit(edges, portions, estimates) -> dict:
    vis = edges[visible_column(edges)].to_numpy()
    out = {}
    for est in estimates:
        p = portions[portions.band == est]
        length = shapely.length(p.geometry.values)
        off = ~vis[p.e.to_numpy()]
        empty = np.array([len(c) == 0 for c in p.cameras])
        out[f"b{est}"] = {
            "portions": len(p),
            "km": round(float(length.sum()) / 1000, 3),
            "under_3m": int((length < 3).sum()),
            "off_axis_km": round(float(length[off].sum()) / 1000, 3),
            "off_axis_share": round(float(length[off].sum() / max(length.sum(), 1e-9)), 4),
            "empty_camera_list": int(empty.sum()),
            "empty_camera_list_m": round(float(length[empty].sum()), 1),
        }
    return out


WATCHED = {
    "75101": "Paris 1er", "92062": "Puteaux", "92050": "Nanterre",
    "93066": "Saint-Denis", "77186": "Fontainebleau",
}  # fmt: skip


def share_audit(areas: gpd.GeoDataFrame) -> dict:
    """The published "between X % and Y %" for IDF and the watched communes, and each
    commune's colour class (quintile of Y)."""
    names = list(optics.estimates())
    ref, high = names[optics.default_estimate_index()], names[-1]

    def xy(road, row, sfx=""):
        return {
            "X": round(100 * row[f"filmed_m_{ref}_dir{sfx}"] / road, 2),
            "Y": round(100 * row[f"filmed_m_{high}{sfx}"] / road, 2),
        }

    deps = areas[areas.level == "departement"]
    total = deps[[c for c in deps.columns if c.startswith("filmed_m_")] + ["road_m"]].sum()
    out = {"IDF": {"road_km": round(total.road_m / 1000, 1), **xy(total.road_m, total),
                   "pub": xy(total.road_m, total, "_pub")}}  # fmt: skip
    for code, label in WATCHED.items():
        if code not in set(areas.code):
            continue  # outside the region (the CI extract)
        r = areas[areas.code == code].iloc[0]
        out[label] = {"road_km": round(r.road_m / 1000, 2), **xy(r.road_m, r),
                      "pub": xy(r.road_m, r, "_pub")}  # fmt: skip
    communes = areas[areas.level == "commune"]
    breaks = tiles.share_breaks(communes)["hi"]["breaks"]
    vals = 100 * communes[f"filmed_ratio_{high}"].to_numpy()
    mapped = communes.camera_count.to_numpy() > 0
    cls = np.where(mapped, np.searchsorted(breaks, vals, side="right"), -1)
    out["commune_breaks"] = breaks
    out["commune_class"] = dict(zip(communes.code, map(int, cls), strict=True))
    return out


def run(region: regions.Region, skip_tiles: bool = False) -> Path:
    b = region.build_dir
    shown = optics.shown_estimates()
    edges = gpd.read_parquet(b / "edges.parquet")
    portions = gpd.read_parquet(b / "street_portions.parquet")
    intervals = pd.read_parquet(b / "filmed_intervals.parquet")
    report: dict = {"build": json.loads((b / "tiles" / "meta.json").read_text())["build_id"]}
    report["portions"] = portion_audit(edges, portions, shown)
    report["shares"] = share_audit(gpd.read_parquet(b / "areas.parquet"))
    bands = gpd.read_parquet(b / "bands.parquet")
    cams = gpd.read_parquet(b / apply.CAMERAS)
    views = gpd.read_parquet(b / "views.parquet")
    cam_iv = camera_intervals(edges, bands, shown)
    report["filters"] = filter_audit(edges, portions, cam_iv, cams, views, shown)
    streets = b / "tiles" / "streets.pmtiles"
    report["weights"] = tiles.tile_stats(streets)
    timings = b / "timings.json"
    report["timings"] = json.loads(timings.read_text()) if timings.exists() else {}
    if not skip_tiles:
        zooms = range(tiles.STREETS_MIN, 17)
        report["tiles"] = tile_audit(read_tiles(streets, zooms), edges, intervals, shown, zooms)
    path = regions.ROOT / "qa" / "out" / region.name / "streets_audit.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    return path
