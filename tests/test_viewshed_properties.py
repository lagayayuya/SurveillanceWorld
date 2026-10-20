"""Property tests on random scenes: the viewshed stays in its sector and out of buildings."""

from hypothesis import given
from hypothesis import strategies as st
from shapely import affinity, box

from lacarte import buildings, qa
from lacarte.viewshed import ObstacleIndex, Sector, compute_viewshed

coord = st.floats(-60, 60, allow_nan=False)
size = st.floats(0.5, 25, allow_nan=False)
angle = st.floats(0, 360, allow_nan=False)


@st.composite
def rect(draw):
    x, y, w, h, rot = draw(coord), draw(coord), draw(size), draw(size), draw(angle)
    return affinity.rotate(box(x, y, x + w, y + h), rot, origin="centroid")


@st.composite
def scene(draw):
    rects = draw(st.lists(rect(), min_size=0, max_size=12))
    direction = draw(st.one_of(st.none(), angle))
    fov = draw(st.floats(10, 360, allow_nan=False))
    rng = draw(st.floats(5, 60, allow_nan=False))
    x, y = draw(st.floats(-20, 20)), draw(st.floats(-20, 20))
    return rects, Sector(x, y, rng, direction, fov)


@given(scene())
def test_view_in_sector_and_out_of_buildings(sc):
    rects, s = sc
    obs = buildings.prepare(rects)
    x, y, _ = buildings.snap_origin(s.x, s.y, obs)
    s = Sector(x, y, s.range_m, s.direction_deg, s.fov_deg)
    index = ObstacleIndex(obs)
    view = compute_viewshed(s, index)

    assert view.is_empty or view.is_valid
    assert not qa.outside_sector(view, [s])
    assert qa.building_overlap_m2(view, obs) < qa.MAX_BUILDING_OVERLAP_M2
    assert not qa.is_uncut(view, [s], obs)
    if not index.contains(x, y):
        assert not view.is_empty
