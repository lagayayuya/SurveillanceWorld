"""Observation bands in the viewshed stage: cut by buildings, nested, PTZ reach."""

import math

import geopandas as gpd
import pytest
import shapely
from shapely import Point, box

from lacarte import buildings, camerafield, optics, qa
from lacarte.viewshed import ObstacleIndex, Sector, compute_camera_viewshed


def record(kind="dome", directions=(90.0,), mount=None):
    return {
        "camera_id": "n1",
        "x": 0.0,
        "y": 0.0,
        "directions": list(directions),
        "kind": kind,
        "mount": mount,
    }


def bands_frame(rows):
    return gpd.GeoDataFrame(
        {"camera_id": "n1", "level": [r["level"] for r in rows], "band": [r["band"] for r in rows]},
        geometry=[shapely.from_wkb(r["wkb"]) for r in rows],
    )


def scene():
    obs = buildings.prepare([box(20, -60, 40, 60)])  # a wall of buildings 20 m east
    return ObstacleIndex(obs), obs


def test_bands_are_cut_by_buildings_and_nested():
    index, obs = scene()
    r = record()
    view = compute_camera_viewshed([Sector(0, 0, 150, 90, 110)], index)
    rows = camerafield.observation_bands(r, 0.0, 0.0, view)
    assert {row["level"] for row in rows} == set(optics.rules()["levels"])
    frame = bands_frame(rows)
    assert qa.band_nesting_violations(frame) == 0
    for g in frame.geometry:
        assert qa.building_overlap_m2(g, obs) < 0.5
        assert not g.contains(Point(60, 0))  # behind the building


def test_unknown_direction_gives_full_circle_bands():
    index, _ = scene()
    r = record(directions=())
    view = compute_camera_viewshed([Sector(0, 0, 150)], index)
    rows = camerafield.observation_bands(r, 0.0, 0.0, view)
    outer = max((shapely.from_wkb(x["wkb"]) for x in rows), key=lambda g: g.area)
    assert outer.contains(Point(-10, 0)) and outer.contains(Point(0, -10))


def test_ptz_is_full_circle_with_a_reach_outline():
    index, _ = scene()
    r = record(kind="ptz", directions=(90.0,))
    view = compute_camera_viewshed([Sector(0, 0, 150)], index)
    rows = camerafield.observation_bands(r, 0.0, 0.0, view)
    outer = max((shapely.from_wkb(x["wkb"]) for x in rows), key=lambda g: g.area)
    assert outer.contains(Point(-10, 0))  # pans: also behind its nominal direction
    reach = camerafield.ptz_reach(r, 0.0, 0.0, index)
    assert reach is not None and reach.length > 0


def test_bands_stay_nested_at_real_lambert93_coordinates():
    # Regression (IDF QA): at ~6.8e6 m GEOS silently returned an empty intersection for
    # nested bands with a blind zone; cutting happens in camera-centred coordinates now.
    x, y = 646334.5123, 6867469.7777
    obs = buildings.prepare([box(x + 60, y - 80, x + 90, y + 80)])
    index = ObstacleIndex(obs)
    r = record(kind="fixed", directions=(70.0,), mount=(2.0, 10.0))
    r.update(x=x, y=y)
    view = compute_camera_viewshed([Sector(x, y, 150, 70, 100)], index)
    frame = bands_frame(camerafield.observation_bands(r, x, y, view))
    assert qa.band_nesting_violations(frame) == 0


def test_ptz_reach_outline_is_capped_at_300_m_and_cut_by_buildings():
    # Frozen case (decision 2026-09-28): the zoomed outline goes to the 300 m cap in the
    # open and stops at a building 250 m away.
    assert optics.tele_reach_m() == 300
    obs = buildings.prepare([box(250, -20, 270, 20)])
    index = ObstacleIndex(obs)
    r = record(kind="ptz", directions=(90.0,))
    outline = camerafield.ptz_reach(r, 0.0, 0.0, index)
    xs, ys = outline.xy
    radius = [math.hypot(x, y) for x, y in zip(xs, ys, strict=True)]
    assert max(radius) == pytest.approx(300, abs=0.5)
    assert min(radius) == pytest.approx(250, abs=0.5)  # the building's facing wall
    assert not shapely.Polygon(outline).contains(Point(285, 0))  # behind the building
    assert shapely.Polygon(outline).contains(Point(0, 290))  # open side


def test_band_reach_is_the_drawn_extent():
    # Open ground: the reach of each band is the optical reach of its share; behind the
    # wall of buildings 20 m east it is cut to the wall's far corners.
    open_index = ObstacleIndex([])
    r = record(directions=())
    view = compute_camera_viewshed([Sector(0, 0, 150)], open_index)
    rows = camerafield.observation_bands(r, 0.0, 0.0, view)
    samples = optics.samples("dome")
    for row in rows:
        ppm = optics.rules()["levels"][row["level"]]
        share = optics.thresholds()[row["band"]]
        want = optics.reach_at_share(samples, ppm, share, cap=150)
        assert row["reach_m"] == pytest.approx(want, abs=0.05)
    # Facing the wall (x = 20, 110 degree field): no band reaches past the wall's face,
    # whose farthest visible point is 20 / cos(55 deg) away.
    index, _ = scene()
    east = record(directions=(90.0,))
    view = compute_camera_viewshed([Sector(0, 0, 150, 90, 110)], index)
    cut = camerafield.observation_bands(east, 0.0, 0.0, view)
    far = max(x["reach_m"] for x in cut)
    assert 20 < far <= 20 / math.cos(math.radians(55)) + 0.01
