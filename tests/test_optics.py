"""Observation levels: PPM formula, staircase coverage, blind zone, band nesting."""

import math

import pytest
import shapely
from shapely import Point

from lacarte import optics, qa


def test_ppm_formula():
    # 1920 px over 90 deg: 250 PPM (identification) up to 1920 / (2 * 250 * 1) = 3.84 m.
    assert optics.level_range(1920, 90, 250) == pytest.approx(3.84)
    assert optics.level_range(1920, 90, 25) == pytest.approx(38.4)


def test_single_sample_is_a_sector():
    s = [(1920.0, 90.0)]
    region = optics.coverage(0.0, s, 125, 1.0, cap=1000)
    r = optics.level_range(1920, 90, 125)
    assert region.area == pytest.approx(math.pi * r * r / 4, rel=2e-3)
    assert region.contains(Point(0.5, 5))
    assert not region.contains(Point(0, -2))


def test_staircase_of_two_samples():
    wide_short, narrow_long = (1920.0, 90.0), (1920.0, 30.0)
    s = [wide_short, narrow_long]
    r_wide = optics.level_range(*wide_short, 62.5)
    r_narrow = optics.level_range(*narrow_long, 62.5)
    both = optics.coverage(0.0, s, 62.5, 1.0, cap=1000)
    either = optics.coverage(0.0, s, 62.5, 0.0, cap=1000)
    # "Both samples": the narrow sector up to the wide range.
    assert both.area == pytest.approx(math.pi * r_wide**2 * 30 / 360, rel=5e-3)
    # "At least one": wide sector + the narrow sector beyond it.
    union = math.pi * r_wide**2 * 90 / 360 + math.pi * (r_narrow**2 - r_wide**2) * 30 / 360
    assert either.area == pytest.approx(union, rel=5e-3)
    assert either.contains(Point(0, r_narrow - 1))
    assert not both.contains(Point(0, r_wide + 1))


@pytest.mark.parametrize(
    "kind", ["dome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"]
)
def test_bands_are_nested(kind):
    s = optics.samples(kind)
    regions = [optics.coverage(45.0, s, 62.5, t) for t in optics.thresholds()]
    # Bands are on the 1 mm grid: nesting holds within the QA slack, as in the pipeline.
    for inner, outer in zip(regions, regions[1:], strict=False):
        assert inner.difference(outer.buffer(qa.NESTING_SLACK_M)).area < qa.NESTING_TOLERANCE_M2
        assert inner.area <= outer.area + 1e-3


def test_unknown_direction_is_a_disk_band():
    s = optics.samples("dome")
    region = optics.coverage(None, s, 125, 0.5)
    b = region.bounds
    assert b[0] == pytest.approx(-b[2], rel=1e-3) and b[1] == pytest.approx(-b[3], rel=1e-3)


def test_cap_bounds_the_reach():
    s = optics.samples("fixed")
    region = optics.coverage(0.0, s, 25, 0.0, cap=150)
    assert max(abs(v) for v in region.bounds) <= 150 + 1e-6


def test_blind_zone_under_a_tilted_camera():
    mount = optics.Mount(height_m=6, tilt_deg=30)
    near, far = optics.sample_extent(1920, 90, 25, mount, cap=150)
    vfov = math.degrees(2 * math.atan(math.tan(math.radians(45)) * 0.5625))
    assert near == pytest.approx(6 / math.tan(math.radians(30 + vfov / 2)))
    assert far < 150
    region = optics.coverage(0.0, [(1920.0, 90.0)], 25, 1.0, mount=mount, cap=150)
    assert not region.contains(Point(0, near / 2))
    assert region.contains(Point(0, (near + far) / 2))


def test_weighted_coverage_counts_weight_not_samples():
    # A heavy short-range sample and a light long-range one: p >= 0.5 stops at the short
    # range (the long one alone weighs 0.2), p >= 0.1 reaches the long range.
    short, long_ = (1920.0, 90.0, 0.8), (3840.0, 90.0, 0.2)
    r_short = optics.level_range(1920, 90, 125)
    r_long = optics.level_range(3840, 90, 125)
    half = optics.coverage(0.0, [short, long_], 125, 0.5, cap=1000)
    tenth = optics.coverage(0.0, [short, long_], 125, 0.1, cap=1000)
    assert half.area == pytest.approx(math.pi * r_short**2 / 4, rel=2e-3)
    assert tenth.area == pytest.approx(math.pi * r_long**2 / 4, rel=2e-3)


def test_samples_are_weighted_and_sum_to_one():
    for kind in ("dome", "ptz", "unknown"):
        s = optics.samples(kind)
        assert sum(w for _, _, w in s) == pytest.approx(1.0)
        assert all(w > 0 for _, _, w in s)


def test_tercile_points():
    lo, mid, hi = optics.tercile_points(1000, 2000, 4000)
    assert mid == 2000
    assert 1000 < lo < 2000 < hi < 4000
    assert math.log(2000 / lo) == pytest.approx(math.log(2) * 0.9674 / 1.2816)


def test_fisheye_reach_uses_the_angle():
    # 3000 px over a 180-degree fisheye: 3000 / pi px per radian; 25 px/m -> 38.2 m.
    assert optics.level_range(3000, 180, 25) == pytest.approx(3000 / (25 * math.pi))
    assert optics.level_range(3000, 360, 25) == optics.level_range(3000, 180, 25)
    assert optics.level_range(3000, 120, 25) == pytest.approx(3000 / (50 * math.tan(math.pi / 3)))


def test_reach_at_share_is_the_kth_longest_sample():
    s = [(1920.0, 90.0), (1920.0, 30.0), (3840.0, 30.0), (1280.0, 110.0)]
    reaches = sorted((optics.level_range(r, f, 250) for r, f in s), reverse=True)
    assert optics.reach_at_share(s, 250, 0.1, cap=1000) == pytest.approx(reaches[0])
    assert optics.reach_at_share(s, 250, 0.5, cap=1000) == pytest.approx(reaches[1])
    assert optics.reach_at_share(s, 250, 0.9, cap=1000) == pytest.approx(reaches[3])
    assert optics.reach_at_share(s, 25, 0.1, cap=150) == 150


def test_union_of_slices_keeps_every_sector():
    # Frozen from IDF camera n2325894123 (fixed, 3 m high, 25 deg tilt, facing 290 deg),
    # detection level, cautious estimate: a plain union dropped the 43.0-43.95 deg sectors.
    params = [
        (52.13425, 52.4143, 1.6520419428080937, 34.83108168523053),
        (43.95, 52.13425, 1.6520419428080937, 53.97986200233038),
        (43.0, 43.95, 1.6520419428080937, 54.080768902016665),
        (29.1408, 43.0, 1.6520419428080937, 72.93555628885368),
        (24.1741, 29.1408, 1.6520419428080937, 72.93555628885368),
        (0.0, 24.1741, 1.6520419428080937, 72.93555628885368),
    ]
    pieces = [
        p for a_in, a_out, r0, r1 in params for p in optics._slice(290.0, a_in, a_out, r0, r1)
    ]
    total = sum(p.area for p in pieces)
    assert optics.union_slices(pieces).area == pytest.approx(total, abs=0.05)


def test_a_band_is_never_two_parts_a_hairline_apart():
    """Frozen case (2026-10-11, a pending add at 213° tilted slightly down drew a light
    line from the camera across its field): two slices meeting along a ray, one ending
    inside the other's edge, kept apart by the 1 mm snap rounding. Welded now; parts
    that remain are truly apart (more than 2 mm), as a fill draws them."""
    s = optics.samples("fixed")
    levels = optics.rules()["levels"]
    t = optics.thresholds()
    g = optics.coverage(12.0, s, levels["recognition"], t[1], optics.Mount(3.0, 25.0))
    assert g.geom_type == "Polygon" and g.is_valid
    for direction in range(0, 360, 9):
        for height in (2.5, 3.0, 5.0):
            for level in ("detection", "recognition"):
                for share in t:
                    band = optics.coverage(float(direction), s, levels[level], share,
                                           optics.Mount(height, 25.0))  # fmt: skip
                    parts = list(getattr(band, "geoms", [band]))
                    assert all(p.geom_type == "Polygon" for p in parts)
                    gaps = [a.distance(b) for i, a in enumerate(parts) for b in parts[i + 1 :]]
                    assert min(gaps, default=1.0) > 0.002, (direction, height, level, share)


def closing(g, step=0.001):
    out = shapely.buffer(shapely.buffer(g, step, join_style="mitre", mitre_limit=10.0),
                         -step, join_style="mitre", mitre_limit=10.0)  # fmt: skip
    return out


def slit(band) -> float:
    """How enclosed by the band the longest thing a grid-step closing would add is (0 to 1):
    a slit through the field has the band on both sides (about 1); the grid's notches along
    a straight edge, on one side only (about 0.5)."""
    worst = 0.0
    added = closing(band).difference(band)
    for part in getattr(added, "geoms", [added]):
        if part.length < 0.05:
            continue
        ring = part.buffer(0.003).difference(part)
        worst = max(worst, ring.intersection(band).area / ring.area)
    return worst


@pytest.mark.parametrize("kind", ["dome", "fixed", "ptz", "panorama", "unknown"])
def test_no_band_keeps_a_slit_a_closing_would_fill(kind):
    """Review finding (2026-10-11): the hairline also came as one part with a 0.7 mm slit
    running in from its edge (e.g. fixed, 36°, 3 m, tilted 10°): what a closing by a grid
    step would still add is never bounded by the band on both sides — notches the grid
    leaves along an edge, not a line across the field."""
    s = optics.samples(kind)
    levels = optics.rules()["levels"]
    for direction in range(0, 360, 9):
        for height, tilt in ((3.0, 10.0), (5.0, 25.0)):
            for ppm in levels.values():
                for share in optics.thresholds():
                    band = optics.coverage(float(direction), s, ppm, share,
                                           optics.Mount(height, tilt))  # fmt: skip
                    assert slit(band) < 0.75, (kind, direction, height, tilt, ppm, share)


def test_polygonal_keeps_a_multipolygon_nested_in_a_collection():
    """Review finding: make_valid nests a MultiPolygon in a GeometryCollection; polygonal()
    dropped it whole (an empty band, silently)."""
    from lacarte import robust

    nested = shapely.GeometryCollection([
        shapely.MultiPolygon([shapely.box(0, 0, 1, 1), shapely.box(2, 0, 3, 1)]),
        shapely.LineString([(5, 5), (6, 6)]),
    ])  # fmt: skip
    got = robust.polygonal(nested)
    assert got.geom_type == "MultiPolygon" and got.area == pytest.approx(2.0)


def test_a_band_on_the_grid_survives_its_weld():
    """IDF build of 2026-10-11: a band coming off on_grid keeps GEOS's 1 mm grid, and the
    weld's inward step on that grid gave an empty band (n2513702649 lost every « détecte »
    band; the QA's portions outside fields caught it). A whole band survives now."""
    from lacarte import robust

    quad = shapely.Polygon([(-1.426, 13.465), (11.337, -7.452), (1.423, -13.467),
                            (-11.34, 7.45), (-1.426, 13.465)])  # fmt: skip
    gridded = robust.on_grid(quad)
    assert shapely.get_precision(gridded) == pytest.approx(0.001)
    welded = optics.closed(gridded)
    assert welded.area == pytest.approx(quad.area, abs=0.01)
