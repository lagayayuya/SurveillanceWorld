"""What the streets layers say, checked on the whole CI pipeline (conftest.ci_pipeline):
filmed pieces against a point sampling, portions and their cameras."""

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
import shapely

from lacarte import exposure, optics, streetaudit, tiles

SAMPLE_M = 0.1  # point sampling step
PAIR_TOL_M = 0.2  # a pair's filmed length within this of the sampling


def test_filmed_pieces_match_a_10_cm_point_sampling(ci_pipeline):
    # Every (segment, floor band) pair: the piece exposure measures against points every
    # 10 cm along the segment that lie in the band or within its 1 mm grid step of it.
    b = ci_pipeline.build_dir
    edges = gpd.read_parquet(b / "edges.parquet")
    bands = gpd.read_parquet(b / "bands.parquet")
    sel = bands[
        (bands.level == exposure.FLOOR) & bands.band.isin(optics.shown_estimates())
    ].reset_index(drop=True)
    key = list(zip(sel.camera_id, sel.band, strict=True))
    assert len(set(key)) == len(key)  # one polygon per camera and estimate
    poly = dict(zip(key, sel.geometry.values, strict=True))
    pairs = exposure.edge_band_pairs(edges, sel)
    lines = edges.geometry.values
    worst = 0.0
    for e, cam, band, piece in zip(pairs.e, pairs.cam, pairs.band, pairs.piece, strict=True):
        line = lines[e]
        n = int(np.ceil(line.length / SAMPLE_M))
        start = np.arange(n) * SAMPLE_M
        weight = np.minimum(SAMPLE_M, line.length - start)
        pts = shapely.line_interpolate_point(line, start + weight / 2)
        inside = shapely.dwithin(pts, poly[(cam, band)], exposure.BAND_SLACK_M)
        sampled = float(weight[inside].sum())
        measured = exposure.union_length_along(line, [piece])
        worst = max(worst, abs(sampled - measured))
    assert len(pairs) > 1000
    assert worst <= PAIR_TOL_M


def test_every_portion_lists_its_cameras(ci_pipeline):
    portions = gpd.read_parquet(ci_pipeline.build_dir / "street_portions.parquet")
    assert len(portions) and all(len(c) for c in portions.cameras)


@pytest.fixture(scope="session")
def ci_tiles(ci_pipeline):
    """The streets tiles of the CI pipeline measured against its filmed intervals."""
    b = ci_pipeline.build_dir
    zooms = range(tiles.STREETS_MIN, 17)
    return streetaudit.tile_audit(
        streetaudit.read_tiles(b / "tiles" / "streets.pmtiles", zooms),
        gpd.read_parquet(b / "edges.parquet"),
        pd.read_parquet(b / "filmed_intervals.parquet"),
        optics.shown_estimates(),
        zooms,
    )


# At z12-14 (tiles.MERGED_ZOOMS) a coloured stretch off the filmed intervals is tolerated up
# to 2.5 m (streetaudit.OUTSIDE_MERGED_M: tile coordinates are integers there); z15+ keep 1 m.
def _off_key(z: int, key: str) -> str:
    return f"{key}_beyond_limit"


def test_no_portion_off_the_axes_below_z16(ci_tiles):
    # Sidewalks, crossings and paths beside a road appear at z16: so do their portions.
    for est in optics.shown_estimates():
        for z in range(tiles.STREETS_MIN, 16):
            got = ci_tiles[f"z{z}_b{est}"]
            assert got[_off_key(z, "off_drawn_axes")] == 0, (z, got)
            assert got["coloured_km"] > 1


def test_every_zoom_colours_what_is_filmed(ci_tiles):
    # Per zoom and per tile, the coloured length is within max(1 m, 5 %) of the length
    # filmed on the segments drawn at that zoom, and nothing is coloured more than 1 m off
    # a filmed interval: z12-13 and z14 say what z15+ says.
    for est in optics.shown_estimates():
        for z in range(tiles.STREETS_MIN, 17):
            got = ci_tiles[f"z{z}_b{est}"]
            assert got["tiles_out_of_tolerance"] == 0, (z, est, got)
            assert got[_off_key(z, "off_filmed")] == 0, (z, est, got)


COMBINED = ["op:pub&kind:dome", "op:pro&fresh_never", "kind:fixed&direction_unknown"]


def test_filters_keep_portions_only_where_a_kept_camera_films(ci_pipeline):
    # For each of the 26 simple filters (and three combined), every portion kept for an
    # estimate lies within the stretches the kept cameras film, within 0.5 m.
    b = ci_pipeline.build_dir
    edges = gpd.read_parquet(b / "edges.parquet")
    portions = gpd.read_parquet(b / "street_portions.parquet")
    bands = gpd.read_parquet(b / "bands.parquet")
    cams = gpd.read_parquet(b / "cameras_norm.parquet")
    views = gpd.read_parquet(b / "views.parquet")
    shown = optics.shown_estimates()
    cam_iv = streetaudit.camera_intervals(edges, bands, shown)
    names = streetaudit.filter_names() + COMBINED
    got = streetaudit.filter_audit(edges, portions, cam_iv, cams, views, shown, names)
    assert len(names) == 29
    bad = {k: v["portions"] for k, v in got.items() if v["portions"]["over_slack"]}
    assert not bad
    kept = sum(v["portions"]["drawn_km"] for v in got.values())
    assert kept > 10  # the filters keep something on the CI extract


def test_the_off_limit_is_the_same_share_of_a_grid_unit_on_coarser_zooms():
    assert streetaudit.outside_limit_m(12, 4096) == streetaudit.OUTSIDE_MERGED_M == 2.5
    assert streetaudit.outside_limit_m(11, 1024) == 20.0  # z11 at tiles.LOW_DETAIL
    assert streetaudit.outside_limit_m(15, 4096) == streetaudit.OUTSIDE_MIN_M
