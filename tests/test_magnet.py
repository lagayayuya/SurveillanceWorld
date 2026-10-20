"""Frozen cases of the participation magnet (buildings.magnet): a point dropped near a
facade ends 0.5 m outside it, placed by the pipeline's own snap_origin."""

import math

import pytest
from shapely import Point, box

from lacarte import buildings

CAPTURE = 3.0
HOUSE = box(0, 0, 10, 10)


def edge_set(line):
    return {tuple(round(v, 9) for v in c) for c in line.coords}


@pytest.mark.parametrize(
    ("dropped", "expected"),
    [
        ((12.0, 5.0), (10.5, 5.0)),  # 2 m out: pulled onto the east facade, 0.5 m out
        ((10.3, 5.0), (10.5, 5.0)),  # closer than the offset: pushed out to it
        ((10.0, 5.0), (10.5, 5.0)),  # exactly on the outline
        ((8.0, 5.0), (10.5, 5.0)),  # 2 m inside: out by the nearest facade
        ((5.0, -2.5), (5.0, -0.5)),  # south facade
    ],
)
def test_pulled_onto_the_nearest_facade(dropped, expected):
    x, y, pulled, facade = buildings.magnet(*dropped, [HOUSE], CAPTURE)
    assert pulled
    assert (x, y) == pytest.approx(expected, abs=1e-9)
    assert HOUSE.boundary.distance(Point(x, y)) == pytest.approx(0.5, abs=1e-9)
    assert facade.distance(Point(x, y)) == pytest.approx(0.5, abs=1e-9)


def test_east_facade_segment_is_returned():
    *_, facade = buildings.magnet(12.0, 5.0, [HOUSE], CAPTURE)
    assert edge_set(facade) == {(10.0, 0.0), (10.0, 10.0)}


def test_beyond_capture_the_point_stays():
    assert buildings.magnet(13.5, 5.0, [HOUSE], CAPTURE) == (13.5, 5.0, False, None)


def test_no_building_near_the_point_stays():
    assert buildings.magnet(1.0, 2.0, [], CAPTURE) == (1.0, 2.0, False, None)


def test_outer_corner_keeps_the_diagonal():
    x, y, pulled, _ = buildings.magnet(11.0, 11.0, [HOUSE], CAPTURE)
    assert pulled
    off = 0.5 / math.sqrt(2)
    assert (x, y) == pytest.approx((10 + off, 10 + off), abs=1e-9)


def test_across_a_street_the_nearer_facade_wins():
    opposite = box(13, 0, 20, 10)  # 3 m street; dropped 2 m from west, 1 m from east
    x, y, pulled, facade = buildings.magnet(12.0, 5.0, [HOUSE, opposite], CAPTURE)
    assert pulled
    assert (x, y) == pytest.approx((12.5, 5.0), abs=1e-9)
    assert edge_set(facade) == {(13.0, 0.0), (13.0, 10.0)}


def test_deeper_than_the_pipeline_snaps_stays():
    hall = box(0, 0, 60, 60)
    assert buildings.magnet(30.0, 30.0, [hall], CAPTURE) == (30.0, 30.0, False, None)


@pytest.mark.parametrize("dropped", [(12.0, 5.0), (8.0, 5.0), (11.0, 11.0), (5.0, -2.5)])
def test_the_batch_does_not_move_a_magnet_result(dropped):
    """What the magnet stores is where the batch will draw the camera once merged."""
    x, y, *_ = buildings.magnet(*dropped, [HOUSE], CAPTURE)
    bx, by, _ = buildings.snap_origin(x, y, [HOUSE])
    assert math.hypot(bx - x, by - y) < 1e-6
