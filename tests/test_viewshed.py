"""Frozen geometric cases for the viewshed (metric coordinates, north = +y)."""

import math

import numpy as np
import pytest
import shapely
from shapely import Point, box

from lacarte import buildings, qa
from lacarte.viewshed import ObstacleIndex, Sector, compute_camera_viewshed, compute_viewshed

R = 20.0


def disk_area(r=R):
    return math.pi * r * r


def view_of(sector, polys, prepare=True):
    obstacles = buildings.prepare(polys) if prepare else polys
    return compute_viewshed(sector, ObstacleIndex(obstacles)), obstacles


def assert_clean(view, sectors, obstacles):
    assert not qa.outside_sector(view, sectors)
    assert qa.building_overlap_m2(view, obstacles) < qa.MAX_BUILDING_OVERLAP_M2
    assert not qa.is_uncut(view, sectors, obstacles)


def test_no_obstacle_is_full_disk():
    view, _ = view_of(Sector(0, 0, R), [])
    assert view.area == pytest.approx(disk_area(), rel=2e-3)


def test_facade_blocks_everything_behind():
    s = Sector(0, 0.5, R)  # wall-mounted, 0.5 m north of the facade
    block = box(-40, -30, 40, 0)
    view, obs = view_of(s, [block])
    assert_clean(view, [s], obs)
    assert not view.contains(Point(0, -5))
    assert view.contains(Point(0, 10))
    half = disk_area() / 2
    assert half < view.area < half + 2 * R * 0.5 + 1


def test_camera_on_outer_corner_sees_three_quarters():
    s = Sector(0.5, 0.5, R)
    block = box(-40, -40, 0, 0)
    view, obs = view_of(s, [block])
    assert_clean(view, [s], obs)
    assert view.contains(Point(-10, 3))
    assert view.contains(Point(3, -10))
    assert not view.contains(Point(-10, -10))
    assert view.area == pytest.approx(0.75 * disk_area(), rel=0.03)


def test_street_intersection_gives_a_cross():
    s = Sector(0, 0, R)
    blocks = [box(5, 5, 40, 40), box(-40, 5, -5, 40), box(-40, -40, -5, -5), box(5, -40, 40, -5)]
    view, obs = view_of(s, blocks)
    assert_clean(view, [s], obs)
    disk = Point(0, 0).buffer(R, quad_segs=256)
    cross = shapely.union_all([box(-5, -R, 5, R), box(-R, -5, R, 5)]).intersection(disk)
    assert view.symmetric_difference(cross).area < 0.01 * cross.area
    assert view.contains(Point(0, 18))
    assert view.contains(Point(8, 3))
    assert not view.contains(Point(15, 15))


def test_missing_building_is_not_cut():
    # A building absent from OSM cannot cut the view: the viewshed is the full disk.
    view, _ = view_of(Sector(0, 0.5, R), [])
    assert view.area == pytest.approx(disk_area(), rel=2e-3)


def test_no_direction_is_full_circle_and_direction_gives_a_cone():
    full, _ = view_of(Sector(0, 0, R, direction_deg=None, fov_deg=90), [])
    assert full.area == pytest.approx(disk_area(), rel=2e-3)

    east = Sector(0, 0, R, direction_deg=90, fov_deg=90)
    cone, _ = view_of(east, [])
    assert cone.area == pytest.approx(disk_area() / 4, rel=5e-3)
    assert cone.contains(Point(10, 0))
    assert not cone.contains(Point(-10, 0))
    assert not cone.contains(Point(0, 10))
    assert not qa.outside_sector(cone, [east])


def test_cone_across_north():
    north = Sector(0, 0, R, direction_deg=350, fov_deg=40)
    cone, _ = view_of(north, [])
    assert cone.contains(Point(1, 10))  # bearing 5.7 deg, inside 330..10
    assert cone.contains(Point(-5, 10))
    assert not cone.contains(Point(10, 5))
    assert not qa.outside_sector(cone, [north])


def test_camera_drawn_inside_its_building_is_snapped_out():
    block = box(-20, -20, 0, 20)
    obs = buildings.prepare([block])
    x, y, snapped = buildings.snap_origin(-0.2, 0, obs)
    assert snapped
    assert x == pytest.approx(0.5)
    assert compute_viewshed(Sector(-0.2, 0, R), ObstacleIndex(obs)).is_empty
    s = Sector(x, y, R)
    view = compute_viewshed(s, ObstacleIndex(obs))
    assert_clean(view, [s], obs)
    assert view.area > 0.45 * disk_area()


def test_camera_exactly_on_outline_is_snapped_out():
    block = box(-20, -20, 0, 20)
    obs = buildings.prepare([block])
    x, y, snapped = buildings.snap_origin(0, 5, obs)
    assert snapped
    assert (x, y) == pytest.approx((0.5, 5))


def test_multiple_directions_are_unioned():
    sectors = [Sector(0, 0, R, 0, 90), Sector(0, 0, R, 180, 90)]
    view = compute_camera_viewshed(sectors, ObstacleIndex([]))
    assert view.area == pytest.approx(disk_area() / 2, rel=5e-3)
    assert not qa.outside_sector(view, sectors)


def test_adjoining_buildings_5cm_apart_let_no_spike_through():
    left, right = box(-30, -20, -0.025, 0), box(0.025, -20, 30, 0)
    s = Sector(0, 5, R, direction_deg=180, fov_deg=90)

    raw_view, _ = view_of(s, [left, right], prepare=False)
    assert raw_view.intersects(box(-0.02, -10, 0.02, -1)), "raw data really leaks"

    view, obs = view_of(s, [left, right])
    assert len(obs) == 1
    assert not view.intersects(box(-1, -20, 1, -0.01))
    assert qa.spike_area_m2(view) < qa.SPIKE_MIN_AREA_M2
    assert_clean(view, [s], obs)


def test_spike_detector_flags_a_thin_leak():
    left, right = box(-30, -20, -0.025, 0), box(0.025, -20, 30, 0)
    s = Sector(0, 5, R, direction_deg=180, fov_deg=90)
    raw_view, _ = view_of(s, [left, right], prepare=False)
    assert qa.spike_area_m2(raw_view) > qa.SPIKE_MIN_AREA_M2
    assert qa.leak_area_m2(raw_view, [left, right]) > qa.SPIKE_MIN_AREA_M2


def test_narrow_street_seen_lengthwise_is_not_a_leak():
    # A 1.2 m passage (wider than the closing merges): the view narrows at the far end
    # between two walls, which is real, not a leak.
    left, right = box(-30, -60, -0.6, 0), box(0.6, -60, 30, 0)
    s = Sector(2, 4, 70, direction_deg=190, fov_deg=40)  # off-axis: a narrowing wedge
    view, obs = view_of(s, [left, right])
    assert qa.spike_area_m2(view) > qa.SPIKE_MIN_AREA_M2
    assert qa.leak_area_m2(view, obs) == 0.0


def test_grazing_wedge_along_a_facade_is_a_spike_but_not_a_leak():
    # Camera on a wall looking almost along it: a legitimate thin wedge.
    wall = box(-40, -30, 40, 0)
    s = Sector(0, 0.5, 30, direction_deg=91, fov_deg=4)  # wedge under 1 m wide
    view, obs = view_of(s, [wall])
    assert qa.spike_area_m2(view) > qa.SPIKE_MIN_AREA_M2
    assert qa.leak_area_m2(view, obs) == 0.0


def test_courtyard():
    ring = box(-20, -20, 20, 20).difference(box(-5, -5, 5, 5))
    obs = buildings.prepare([ring])
    assert len(obs[0].interiors) == 1

    inner = Sector(0, 0, R)
    view = compute_viewshed(inner, ObstacleIndex(obs))
    assert view.area == pytest.approx(100, rel=1e-3)
    assert_clean(view, [inner], obs)

    outer = Sector(0, 20.5, R)
    view = compute_viewshed(outer, ObstacleIndex(obs))
    assert not view.intersects(box(-5, -5, 5, 5))
    assert_clean(view, [outer], obs)


@pytest.mark.parametrize(
    ("tags", "blocks"),
    [
        ({"building": "yes"}, True),
        ({"building": "house", "layer": "1"}, True),
        ({"building": "roof"}, False),
        ({"building": "carport"}, False),
        ({"building": "yes", "location": "underground"}, False),
        ({"building": "yes", "layer": "-1"}, False),
        ({"building": "no"}, False),
        ({"amenity": "shelter"}, False),
    ],
)
def test_which_buildings_block(tags, blocks):
    assert buildings.is_obstacle(tags) is blocks


def test_camera_at_block_edge_matches_single_block():
    raw = np.array(
        [box(-3, 2, 6, 12), box(6.02, 2, 15, 12), box(15.5, 2, 90, 12), box(-30, -15, -8, -2)]
    )
    tree = shapely.STRtree(raw)
    s = Sector(-0.5, 0, R)

    def prepared_from(seed_zone):
        seeds = tree.query(seed_zone, predicate="intersects")
        groups = buildings.clusters(raw, tree, seeds)
        return [p for g in groups for p in buildings.prepare(raw[g])]

    # Only the camera disk vs a whole region: the mitoyen chain reaching x=90 is prepared
    # as one cluster in both cases, so the geometry is identical, not just close.
    alone = prepared_from(Point(s.x, s.y).buffer(R + 5))
    region = prepared_from(box(-100, -100, 100, 100))
    view_alone = compute_viewshed(s, ObstacleIndex(alone))
    view_region = compute_viewshed(s, ObstacleIndex(region))
    assert view_alone.equals_exact(view_region, tolerance=0)


def test_clusters_follow_gaps_under_one_metre():
    raw = np.array([box(0, 0, 10, 10), box(10.5, 0, 20, 10), box(21.5, 0, 30, 10)])
    tree = shapely.STRtree(raw)
    groups = buildings.clusters(raw, tree, np.array([0]))
    assert [list(g) for g in groups] == [[0, 1]]


def test_camera_exactly_on_a_building_corner_is_snapped_clear():
    # Regression (found by hypothesis): the edge normal at a corner put the camera on the
    # other edge, giving an empty view.
    obs = buildings.prepare([box(0, 0, 1, 1)])
    x, y, snapped = buildings.snap_origin(0, 0, obs)
    assert snapped
    assert obs[0].distance(Point(x, y)) == pytest.approx(buildings.SNAP_OFFSET_M, rel=0.02)
    assert compute_viewshed(Sector(x, y, 5.0), ObstacleIndex(obs)).area > 0.7 * disk_area(5.0)


def test_building_at_the_edge_of_range_still_cuts():
    # Regression (found by hypothesis): an inscribed polygonal disk missed buildings lying
    # just inside the range circle.
    s = Sector(7.0, 5.0, 57.0)
    obs = buildings.prepare([box(0, -52, 1, -51)])
    view = compute_viewshed(s, ObstacleIndex(obs))
    assert qa.building_overlap_m2(view, obs) < 0.01  # residual from the EPSILON side rays


def test_snap_at_convex_corner_goes_along_the_bisector():
    # Regression (IDF block check): at a convex corner all directions over the free
    # quadrant tie, and float noise picked different ones depending on the block.
    obs = buildings.prepare([box(-10, -10, 0, 0)])
    x, y, snapped = buildings.snap_origin(0, 0, obs)
    assert snapped
    h = buildings.SNAP_OFFSET_M / math.sqrt(2)
    assert (x, y) == pytest.approx((h, h), abs=1e-6)


def test_camera_deep_inside_a_building_is_not_snapped():
    obs = buildings.prepare([box(-40, -40, 40, 40)])
    x, y, snapped = buildings.snap_origin(0, 0, obs)
    assert not snapped
    assert compute_viewshed(Sector(x, y, R), ObstacleIndex(obs)).is_empty


def test_robust_intersection_falls_back_to_a_millimetre_grid(monkeypatch):
    from shapely.errors import GEOSException

    from lacarte import robust

    calls = {"n": 0}
    real = type(box(0, 0, 1, 1)).intersection

    def flaky(self, other, *a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise GEOSException("TopologyException: found non-noded intersection")
        return real(self, other, *a, **k)

    monkeypatch.setattr(type(box(0, 0, 1, 1)), "intersection", flaky)
    out = robust.intersection(box(0, 0, 2, 2), box(1, 1, 3, 3))
    assert out.area == pytest.approx(1.0)


def test_sliver_along_two_close_buildings_on_one_side_is_not_a_leak():
    # Two buildings end to end, 10 cm apart, on the same side of a grazing sight line: the
    # view does not pass between them.
    a, b = box(1, -10, 20, 0), box(20.1, -10, 40, 0)
    s = Sector(0, 0.5, 40, direction_deg=91, fov_deg=4)
    view, _ = view_of(s, [a, b], prepare=False)
    assert qa.spike_area_m2(view) > qa.SPIKE_MIN_AREA_M2
    assert qa.leak_area_m2(view, [a, b]) == 0.0
