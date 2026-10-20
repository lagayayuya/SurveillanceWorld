"""Frozen cases for street segments and exposure."""

import json

import geopandas as gpd
import pytest
import shapely
from shapely import LineString, Point, box

from lacarte import exposure, qa

CRS = "EPSG:2154"
SLACK = 2 * exposure.BAND_SLACK_M + 1e-9  # two band edges crossed, 1 mm each


def ways_frame(rows):
    base = {k: None for k in exposure.select_ways.__globals__["_rules"]()["not_assessed"]}
    cols = {"access": None, "foot": None, "service": None, "area": None, "name": None,
            "footway": None, "cycleway": None}  # fmt: skip
    data = [{**base, **cols, **r} for r in rows]
    return gpd.GeoDataFrame(data, geometry="geometry", crs=CRS)


def test_ways_split_at_shared_nodes():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2, 3], "highway": "residential",
         "geometry": LineString([(0, 0), (50, 0), (100, 0)])},
        {"way_id": 2, "node_ids": [2, 4], "highway": "residential",
         "geometry": LineString([(50, 0), (50, 50)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    assert sorted(edges.edge_id) == ["1:1:2", "1:2:3", "2:2:4"]
    assert edges.length_m.sum() == pytest.approx(150)


def test_selection_rules():
    line = LineString([(0, 0), (10, 0)])
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential", "geometry": line},
        {"way_id": 2, "node_ids": [3, 4], "highway": "motorway", "geometry": line},
        {"way_id": 3, "node_ids": [5, 6], "highway": "service", "service": "driveway",
         "geometry": line},
        {"way_id": 4, "node_ids": [7, 8], "highway": "residential", "access": "private",
         "geometry": line},
        {"way_id": 5, "node_ids": [9, 10], "highway": "footway", "access": "private", "foot": "yes",
         "geometry": line},
        {"way_id": 6, "node_ids": [11, 12], "highway": "residential", "tunnel": "building_passage",
         "geometry": line},
    ])  # fmt: skip
    sel = exposure.select_ways(ways)
    # A motorway is drawn (rules/streets.yaml drawn_highways), out of the shares.
    assert sorted(sel.way_id) == [1, 2, 5, 6]
    want = {1: True, 2: True, 5: True, 6: False}
    assert dict(zip(sel.way_id, sel.assessed, strict=True)) == want
    edges = exposure.mark_counted(exposure.build_edges(sel))
    got = dict(zip(edges.way_id, edges.counted, strict=True))
    assert got == {1: True, 2: False, 5: True, 6: False}  # 6: in a building passage


def cams_frame(rows):
    return gpd.GeoDataFrame(rows, geometry=[Point(0, 0)] * len(rows), crs=CRS)


def bands_frame(rows):
    """rows: (camera_id, level, band, polygon)."""
    return gpd.GeoDataFrame(
        {"camera_id": [r[0] for r in rows], "level": [r[1] for r in rows],
         "band": [r[2] for r in rows]},
        geometry=[r[3] for r in rows], crs=CRS,
    )  # fmt: skip


def test_filmed_length_per_level_and_public_set():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    ref = exposure.reference_band()
    bands = bands_frame([
        # camera a (public): detection band 0..50 m, identification band 0..10 m
        ("a", "detection", ref, box(0, -5, 50, 5)),
        ("a", "identification", ref, box(0, -5, 10, 5)),
        # camera b (private): detection band 30..60 m
        ("b", "detection", ref, box(30, -5, 60, 5)),
    ])  # fmt: skip
    cams = cams_frame([
        {"camera_id": "a", "operator_class": "public"},
        {"camera_id": "b", "operator_class": "private_outdoor"},
    ])  # fmt: skip
    e = exposure.expose(edges, bands, cams).iloc[0]
    # Bands are widened by 1 mm (exposure.BAND_SLACK_M): SLACK per band edge crossed.
    assert e.filmed_m_detection_probable == pytest.approx(60, abs=SLACK)  # 0..50 and 30..60
    assert e.filmed_m_detection_probable_pub == pytest.approx(50, abs=SLACK)
    assert e.filmed_m_identification_probable == pytest.approx(10, abs=SLACK)
    assert e.filmed_ratio_probable == pytest.approx(0.6, abs=SLACK)
    assert e.filmed_ratio_probable_pub == pytest.approx(0.5, abs=SLACK)
    assert e.max_level_probable == 3 and e.max_level_probable_pub == 3
    assert e.max_level_certain == 0  # no band given for the other estimates
    assert list(e.camera_ids) == ["a", "b"]


def test_expected_length_integrates_the_bands():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    # Nested bands p>=.9: 0..20, p>=.5: 0..40, p>=.1: 0..60
    bands = bands_frame([("a", "detection", i, box(0, -5, 20 * (i + 1), 5)) for i in range(3)])
    cams = cams_frame([{"camera_id": "a", "operator_class": "public"}])
    e = exposure.expose(edges, bands, cams).iloc[0]
    # Lower Riemann sum of p over the edge: 0.4 * 20 + 0.4 * 40 + 0.1 * 60
    assert e.expected_m_detection == pytest.approx(30, abs=SLACK)
    assert [e[f"filmed_m_{est}"] for est in exposure.ESTIMATES] == pytest.approx(
        [20, 40, 60], abs=SLACK
    )
    assert [e[f"filmed_ratio_{est}"] for est in exposure.ESTIMATES] == pytest.approx(
        [0.2, 0.4, 0.6], abs=SLACK
    )


def test_street_estimate_monotony_check():
    edges = gpd.GeoDataFrame({
        "filmed_m_detection_certain": [10.0, 30.0], "filmed_m_detection_probable": [20.0, 20.0],
        "filmed_m_detection_cautious": [20.0, 40.0],
    })  # fmt: skip
    # Edge 1 is more filmed with "certain" than with "probable": one violation.
    assert qa.street_estimate_violations(edges, ["detection"], exposure.ESTIMATES, ("",)) == 1


def test_sidewalks_and_crossings_are_not_axes():
    line = LineString([(0, 0), (10, 0)])
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential", "geometry": line},
        {"way_id": 2, "node_ids": [3, 4], "highway": "footway", "footway": "sidewalk",
         "geometry": line},
        {"way_id": 3, "node_ids": [5, 6], "highway": "footway", "footway": "crossing",
         "geometry": line},
        {"way_id": 4, "node_ids": [7, 8], "highway": "footway", "geometry": line},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    assert dict(zip(edges.way_id, edges.axis, strict=True)) == {
        1: True,
        2: False,
        3: False,
        4: True,
    }


def test_cnil_signal_needs_private_and_certain_street_view():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(-100, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    street_view = box(-10, -4, 10, 4)
    views = gpd.GeoDataFrame(
        {"camera_id": ["priv_dir", "priv_nodir", "pub_dir", "doorbell"],
         "geom_certainty": ["default"] * 4},
        geometry=[street_view, street_view, street_view, box(-5, -0.2, 5, 49.8)],
        crs=CRS,
    )  # fmt: skip

    def cam(cid, op, kind, dcert):
        return {"camera_id": cid, "operator_class": op, "kind": kind,
                "direction_certainty": dcert, "tags": json.dumps({})}  # fmt: skip

    cams = cams_frame([
        cam("priv_dir", "private_outdoor", "fixed", "estimated"),
        cam("priv_nodir", "private_outdoor", "fixed", "default"),
        cam("pub_dir", "public", "fixed", "estimated"),
        cam("doorbell", "private_outdoor", "doorbell", "estimated"),
    ])  # fmt: skip
    s = exposure.camera_street(views, cams, edges).set_index("camera_id")
    assert s.cnil_signal.to_dict() == {
        "priv_dir": True, "priv_nodir": False, "pub_dir": False, "doorbell": True,
    }  # fmt: skip
    # doorbell rule: under the 20 % share, but some street length is enough
    assert s.loc["doorbell", "street_share"] < 0.2
    assert s.loc["doorbell", "street_len_m"] == pytest.approx(10)


def test_a_track_is_no_public_street_a_motorway_is():
    # rules/streets.yaml street_space: a private camera seeing only a farm track does not
    # film the public street (no CNIL signal); seeing only a motorway, it does.
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "track",
         "geometry": LineString([(-100, 0), (100, 0)])},
        {"way_id": 2, "node_ids": [3, 4], "highway": "motorway",
         "geometry": LineString([(-100, 100), (100, 100)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    assert set(edges.highway) == {"track", "motorway"}  # both drawn (drawn_highways)
    views = gpd.GeoDataFrame(
        {"camera_id": ["on_track", "on_motorway"], "geom_certainty": ["default"] * 2},
        geometry=[box(-10, -4, 10, 4), box(-10, 96, 10, 104)],
        crs=CRS,
    )  # fmt: skip
    cams = cams_frame([
        {"camera_id": c, "operator_class": "private_outdoor", "kind": "fixed",
         "direction_certainty": "estimated", "tags": json.dumps({})}
        for c in ("on_track", "on_motorway")
    ])  # fmt: skip
    s = exposure.camera_street(views, cams, edges).set_index("camera_id")
    assert s.loc["on_track", "street_len_m"] == 0
    assert s.films_street.to_dict() == {"on_track": False, "on_motorway": True}
    assert s.cnil_signal.to_dict() == {"on_track": False, "on_motorway": True}


def test_union_of_nearly_collinear_pieces_is_measured_along_the_segment():
    # Frozen from La Défense (edge 17149760:2428949445:569952826, detection, probable):
    # three cameras film overlapping parts of a 40.87 m segment; the pieces, snapped to the
    # 1 mm grid, are not exactly collinear and a 2D union summed them (91.6 m).
    edge = shapely.from_wkt("LINESTRING (644113.031 6866698.056, 644145.982 6866673.884)")
    pieces = shapely.from_wkt([
        "LINESTRING (644121.111 6866692.129, 644145.982 6866673.884)",
        "LINESTRING (644113.031 6866698.056, 644144.009 6866675.331)",
        "LINESTRING (644128.007 6866687.07, 644145.982 6866673.884)",
    ])  # fmt: skip
    assert shapely.union_all(pieces).length > 2 * edge.length  # the bug being guarded
    assert exposure.union_length_along(edge, pieces) == pytest.approx(edge.length, abs=0.005)


def test_union_length_along_keeps_gaps_and_multi_parts():
    edge = LineString([(0, 0), (100, 0), (100, 100)])  # bends at (100, 0)
    pieces = [
        shapely.MultiLineString([[(0, 0), (10, 0)], [(20, 0), (30, 0)]]),
        LineString([(25, 0), (40, 0)]),
        LineString([(90, 0), (100, 0), (100, 10)]),  # across the bend
    ]
    assert exposure.union_length_along(edge, pieces) == pytest.approx(10 + 20 + 20)


def test_estimates_are_monotone_along_a_band_edge():
    # A segment along a facade lies on the edge of the certain band; the probable band,
    # snapped on its own, misses it by 1 mm. Filmed length must still grow with the estimate.
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "footway",
         "geometry": LineString([(0, 0), (10, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 0, box(0, 0, 10, 10)),
        ("a", "detection", 1, box(0, 0.001, 20, 20)),
        ("a", "detection", 2, box(0, 0.001, 30, 30)),
    ])  # fmt: skip
    cams = cams_frame([{"camera_id": "a", "operator_class": "public"}])
    e = exposure.expose(edges, bands, cams).iloc[0]
    assert [e[f"filmed_m_{est}"] for est in exposure.ESTIMATES] == pytest.approx([10, 10, 10])


def test_union_length_along_a_closed_segment():
    # Roundabouts and loops are segments from a node back to itself (IDF: 331 QA failures).
    loop = LineString([(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)])  # 40 m, closes at (0, 0)
    pieces = [
        LineString([(0, 5), (0, 0)]),  # ends at the closing node: last 5 m
        LineString([(0, 8), (0, 2)]),  # overlaps it: 32..38 m
        shapely.MultiLineString([[(0, 1), (0, 0)], [(0, 0), (3, 0)]]),  # across the node
    ]
    assert exposure.union_length_along(loop, pieces) == pytest.approx(8 + 3)


def test_camera_bands_list_each_camera_with_its_most_certain_estimate():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
        {"way_id": 2, "node_ids": [3, 4], "highway": "residential",
         "geometry": LineString([(0, 30), (100, 30)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 1, box(0, -5, 20, 5)),
        ("a", "detection", 2, box(0, -5, 40, 5)),
        ("c", "identification", 0, box(0, -5, 10, 5)),  # levels are nested: films too
        ("b", "detection", 2, box(50, -5, 60, 35)),  # films both segments
        ("d", "detection", 0, box(90, 29.99, 90.01, 30.01)),  # a 1 cm touch: films nothing
    ])  # fmt: skip
    cams = cams_frame([{"camera_id": c, "operator_class": "public"} for c in "abcd"])
    e = exposure.expose(edges, bands, cams).set_index("edge_id")
    assert list(e.camera_bands["1:1:2"]) == ["a:1", "b:2", "c:0"]
    assert list(e.camera_bands["2:3:4"]) == ["b:2"]


def test_street_portions_are_the_filmed_parts_with_their_level_and_cameras():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 1, box(0, -5, 50, 5)),
        ("a", "identification", 1, box(0, -5, 10, 5)),
        ("a", "detection", 2, box(0, -5, 70, 5)),
        ("b", "detection", 1, box(60, -5, 80, 5)),
    ])  # fmt: skip
    pairs = exposure.edge_band_pairs(edges, bands)
    p = exposure.street_portions(edges, pairs, estimates=[1, 2])
    got = {
        (r.band, round(r.geometry.bounds[0], 2), round(r.geometry.bounds[2], 2)): (
            r.level, list(r.cameras))
        for r in p.itertuples()
    }  # fmt: skip
    assert got == {
        # typical: the 50-60 m gap between the two fields is not a portion
        (1, 0, 10): (3, ["a:1"]), (1, 10, 50): (1, ["a:1"]), (1, 60, 80): (1, ["b:1"]),
        # high-end: a's wider field closes the gap; one part per level, with every camera
        # filming some of it (a with its most certain band)
        (2, 0, 10): (3, ["a:1"]), (2, 10, 80): (1, ["a:1", "b:1"]),
    }  # fmt: skip


def test_portion_qa_flags_a_portion_off_the_fields():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([("a", "detection", 1, box(0, -5, 50, 5))])
    p = exposure.street_portions(edges, exposure.edge_band_pairs(edges, bands), estimates=[1])
    assert qa.portion_violations(p, bands, floor="detection") == 0
    stray = p.copy()
    stray["geometry"] = [LineString([(40, 0), (60, 0)])]  # 10 m past the field
    assert qa.portion_violations(stray, bands, floor="detection") == 1


def test_merge_intervals_per_group():
    import numpy as np

    g, lo, hi = exposure.merge_intervals(
        np.array([2, 1, 1, 1, 2]), np.array([5.0, 0, 3, 10, 0]), np.array([9.0, 4, 6, 12, 5])
    )
    assert list(zip(g, lo, hi, strict=True)) == [(1, 0, 6), (1, 10, 12), (2, 0, 9)]


def test_filmed_intervals_add_up_to_the_filmed_lengths():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 1, box(0, -5, 50, 5)),  # public, typical
        ("a", "identification", 1, box(0, -5, 10, 5)),  # not the floor: ignored
        ("b", "detection", 0, box(30, -5, 60, 5)),  # private, certain
        ("b", "detection", 2, box(30, -5, 90, 5)),  # private, high-end
    ])  # fmt: skip
    cams = cams_frame([
        {"camera_id": "a", "operator_class": "public"},
        {"camera_id": "b", "operator_class": "private_outdoor"},
    ])  # fmt: skip
    pairs = exposure.edge_band_pairs(edges, bands)
    iv = exposure.filmed_intervals(edges, pairs, {"a"})
    got = {(r.est, r.pub): (round(r.lo, 2), round(r.hi, 2)) for r in iv.itertuples()}
    assert got == {
        (0, False): (30, 60),  # certain: b only
        (1, False): (0, 60),  # typical: a's 0-50 with b's more certain 30-60
        (2, False): (0, 90),
        (1, True): (0, 50), (2, True): (0, 50),  # public: a only
    }  # fmt: skip
    e = exposure.expose(edges, bands, cams, pairs).iloc[0]
    length = (iv.hi - iv.lo).groupby([iv.est, iv.pub]).sum()
    for i, est in enumerate(exposure.ESTIMATES):
        for pub, suffix in ((False, ""), (True, "_pub")):
            assert length.get((i, pub), 0.0) == pytest.approx(e[f"filmed_m_{est}{suffix}"])


def test_filmed_intervals_by_cameras_with_a_direction_are_the_low_end_of_the_areas():
    # The areas' "between X % and Y %": X is the probable estimate filmed by cameras with a
    # surveyed direction only (`dir` rows); b has one, a (a dome without direction) not.
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 1, box(0, -5, 50, 5)),
        ("b", "detection", 0, box(30, -5, 60, 5)),
        ("b", "detection", 2, box(30, -5, 90, 5)),
    ])  # fmt: skip
    pairs = exposure.edge_band_pairs(edges, bands)
    iv = exposure.filmed_intervals(edges, pairs, {"a"}, directed={"b"})
    rows = iv[iv["dir"]]
    got = {(r.est, r.pub): (round(r.lo, 2), round(r.hi, 2)) for r in rows.itertuples()}
    assert got == {(1, False): (30, 60)}  # b's certain band, within the probable estimate
    assert not iv[~iv["dir"]].empty and set(iv[~iv["dir"]].est) == {0, 1, 2}


def test_a_path_drawn_on_a_facade_is_filmed_along_it():
    # A facade at 17 degrees cuts a camera's band; the sidewalk is drawn on the facade and
    # the band, simplified and stored on the 1 mm grid, stops short of it by less than one
    # grid step (0.3 mm, then up to 0.6 mm more by the rounding; IDF: the
    # missed points were all within ~1 mm of the band and 0 mm of a building).
    import math

    from shapely import Polygon, set_precision

    ang = math.radians(17)
    d, n = (math.cos(ang), math.sin(ang)), (-math.sin(ang), math.cos(ang))
    p0 = (651000.1234, 6860000.4567)
    facade = [(p0[0] + t * d[0], p0[1] + t * d[1]) for t in range(41)]  # vertex every metre
    edge = [(x + 0.0003 * n[0], y + 0.0003 * n[1]) for x, y in facade]
    far = [(x + 20 * n[0], y + 20 * n[1]) for x, y in reversed(facade)]
    band = set_precision(Polygon(edge + far), 0.001)
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "footway", "footway": "sidewalk",
         "geometry": LineString([facade[0], facade[-1]])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    snapped = shapely.intersection(edges.geometry.iloc[0], band, grid_size=0.001)
    assert snapped.length < 39  # what the cut on the grid kept of the 40 m
    bands = bands_frame([("a", "detection", 1, band), ("a", "recognition", 1, band)])
    cams = cams_frame([{"camera_id": "a", "operator_class": "public"}])
    pairs = exposure.edge_band_pairs(edges, bands)
    e = exposure.expose(edges, bands, cams, pairs).iloc[0]
    assert e.filmed_m_detection_probable == pytest.approx(40, abs=SLACK)
    p = exposure.street_portions(edges, pairs, estimates=[1])
    assert len(p) == 1 and list(p.cameras.iloc[0]) == ["a:1"]
    assert p.geometry.iloc[0].length == pytest.approx(40, abs=SLACK)


def test_paths_beside_a_road_are_not_axes():
    road = LineString([(0, 0), (200, 0)])
    rows = [
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential", "geometry": road},
        # beside the road, 6 m off: a sidewalk mapped as a plain footway
        {"way_id": 2, "node_ids": [3, 4], "highway": "footway",
         "geometry": LineString([(0, 6), (100, 6)])},
        # 25 m off: a path of its own
        {"way_id": 3, "node_ids": [5, 6], "highway": "footway",
         "geometry": LineString([(0, 25), (100, 25)])},
        # across the road
        {"way_id": 4, "node_ids": [7, 8], "highway": "pedestrian",
         "geometry": LineString([(150, -40), (150, 40)])},
        # a service lane beside the road for 60 % of its length, then away
        {"way_id": 5, "node_ids": [9, 10, 11], "highway": "service",
         "geometry": LineString([(0, -8), (60, -8), (60, -48)])},
        # beside a motorway only: not a sidewalk
        {"way_id": 6, "node_ids": [12, 13], "highway": "motorway",
         "geometry": LineString([(0, 300), (200, 300)])},
        {"way_id": 7, "node_ids": [14, 15], "highway": "footway",
         "geometry": LineString([(0, 306), (200, 306)])},
        # a second carriageway of a road is a road
        {"way_id": 8, "node_ids": [16, 17], "highway": "residential",
         "geometry": LineString([(0, -12), (200, -12)])},
    ]  # fmt: skip
    ways = ways_frame(rows)
    edges = exposure.mark_parallel_paths(exposure.build_edges(exposure.select_ways(ways)), ways)
    got = dict(zip(edges.way_id, edges.parallel, strict=True))
    assert got == {1: False, 2: True, 3: False, 4: False, 5: True, 6: False, 7: False, 8: False}
    assert not dict(zip(edges.way_id, edges.axis, strict=True))[2]  # drawn from z16, not counted


def test_cycle_tracks_and_paths_beside_a_road_are_sides_of_it():
    # rule:streets@3.1:parallel_path: a cycleway or a path beside a road is a side of that
    # road (drawn from z16, out of the shares), as a footway is; away from a road, or beside
    # a motorway only, it is a way of its own: a cycle track counted, a path not
    # (rule:streets@3.1:counted_highways).
    rows = [
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (200, 0)])},
        # a cycle track 4 m off the road, a path 7 m off on the other side
        {"way_id": 2, "node_ids": [3, 4], "highway": "cycleway",
         "geometry": LineString([(0, 4), (200, 4)])},
        {"way_id": 3, "node_ids": [5, 6], "highway": "path",
         "geometry": LineString([(0, -7), (150, -7)])},
        # a path across a park, 40 m off
        {"way_id": 4, "node_ids": [7, 8], "highway": "path",
         "geometry": LineString([(0, 40), (200, 60)])},
        # a cycle track along a motorway only
        {"way_id": 5, "node_ids": [9, 10], "highway": "motorway",
         "geometry": LineString([(0, 300), (200, 300)])},
        {"way_id": 6, "node_ids": [11, 12], "highway": "cycleway",
         "geometry": LineString([(0, 306), (200, 306)])},
    ]  # fmt: skip
    ways = ways_frame(rows)
    edges = exposure.mark_parallel_paths(exposure.build_edges(exposure.select_ways(ways)), ways)
    edges = exposure.mark_counted(edges)
    got = {w: (p, c) for w, p, c in zip(edges.way_id, edges.parallel, edges.counted, strict=True)}
    assert got == {
        1: (False, True), 2: (True, False), 3: (True, False), 4: (False, False),
        5: (False, False), 6: (False, True),
    }  # fmt: skip


def test_steps_and_bridleways_beside_a_road_are_sides_of_it():
    # rule:streets@3.1:parallel_path: steps and a bridleway along a road are sides of it
    # (no axis: drawn from z16); steps away from a road stay an axis, counted; a bridleway
    # is never counted (rule:streets@3.1:counted_highways).
    rows = [
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (200, 0)])},
        {"way_id": 2, "node_ids": [3, 4], "highway": "steps",
         "geometry": LineString([(0, 5), (60, 5)])},
        {"way_id": 3, "node_ids": [5, 6], "highway": "bridleway",
         "geometry": LineString([(0, -8), (200, -8)])},
        {"way_id": 4, "node_ids": [7, 8], "highway": "steps",
         "geometry": LineString([(0, 80), (0, 120)])},
        {"way_id": 5, "node_ids": [9, 10], "highway": "bridleway",
         "geometry": LineString([(300, 80), (300, 280)])},
    ]  # fmt: skip
    ways = ways_frame(rows)
    edges = exposure.mark_parallel_paths(exposure.build_edges(exposure.select_ways(ways)), ways)
    edges = exposure.mark_counted(edges)
    got = {w: (a, c) for w, a, c in zip(edges.way_id, edges.axis, edges.counted, strict=True)}
    assert got == {
        1: (True, True), 2: (False, False), 3: (False, False), 4: (True, True),
        5: (True, False),
    }  # fmt: skip


def test_cycle_crossings_are_not_axes_and_busways_count():
    # rule:streets@3.1:not_axis: a cycle crossing (cycleway=crossing, or footway=crossing on
    # a cycleway) is no street axis, as a footway crossing is; a plain cycle track is.
    # A busway is drawn and counted (rule:streets@3.1:counted_highways).
    line = LineString([(0, 0), (10, 0)])
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "cycleway", "cycleway": "crossing",
         "geometry": line},
        {"way_id": 2, "node_ids": [3, 4], "highway": "cycleway", "footway": "crossing",
         "geometry": line},
        {"way_id": 3, "node_ids": [5, 6], "highway": "cycleway", "geometry": line},
        {"way_id": 4, "node_ids": [7, 8], "highway": "footway", "cycleway": "crossing",
         "geometry": line},
        {"way_id": 5, "node_ids": [9, 10], "highway": "busway", "geometry": line},
    ])  # fmt: skip
    edges = exposure.mark_counted(exposure.build_edges(exposure.select_ways(ways)))
    got = {w: (a, c) for w, a, c in zip(edges.way_id, edges.axis, edges.counted, strict=True)}
    assert got == {
        1: (False, False), 2: (False, False), 3: (True, True), 4: (True, True),
        5: (True, True),
    }  # fmt: skip


def test_a_filmed_motorway_is_coloured_but_out_of_the_shares():
    # rules/streets.yaml drawn_highways / counted_highways: a camera that films a motorway
    # films it (measured, its portions drawn), but nobody walks along it: no share counts it.
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "motorway",
         "geometry": LineString([(0, 0), (100, 0)])},
        {"way_id": 2, "node_ids": [3, 4], "highway": "trunk",
         "geometry": LineString([(0, 40), (100, 40)])},
    ])  # fmt: skip
    edges = exposure.mark_counted(
        exposure.mark_parallel_paths(exposure.build_edges(exposure.select_ways(ways)), ways)
    )
    bands = bands_frame([
        ("a", "detection", 1, box(0, -5, 50, 45)),
        ("a", "identification", 1, box(0, -5, 10, 5)),
    ])  # fmt: skip
    cams = cams_frame([{"camera_id": "a", "operator_class": "public"}])
    pairs = exposure.edge_band_pairs(edges, bands)
    e = exposure.expose(edges, bands, cams, pairs).set_index("way_id")
    assert e.filmed_m_probable.tolist() == pytest.approx([50, 50], abs=SLACK)
    assert e.counted.tolist() == [False, True]  # a trunk counts since version 3
    p = exposure.street_portions(edges, pairs, estimates=[1])
    drawn = {(int(edges.way_id.iloc[r.e]), r.level, round(r.geometry.length, 2))
             for r in p.itertuples()}  # fmt: skip
    assert drawn == {(1, 3, 10.0), (1, 1, 40.0), (2, 1, 50.0)}


def test_the_drawn_field_and_the_coloured_street_share_one_floor():
    # Lot 15/10 b, cause (c) of the white streets: a street inside a drawn field but
    # coloured only from a higher level would stay white. The punk fields' lowest level
    # (tiles._band_features, optics.DISPLAYED_LEVELS) and the streets' (exposure.FLOOR)
    # are both the display floor.
    from lacarte import optics

    assert optics.DISPLAYED_LEVELS[0] == exposure.FLOOR == optics.rules()["display_floor"]
    assert (
        exposure.at_or_above(exposure.FLOOR)
        == exposure.LEVELS[exposure.LEVELS.index(optics.DISPLAYED_LEVELS[0]) :]
    )


def test_portions_are_cut_where_the_camera_profiles_change():
    # a (public dome) films 0-50 m, b (private dome) 30-80 m, c (public dome, a's profile)
    # 40-60 m. Profiles along the street: {a} 0-30, {a, b} 30-60 (c changes no profile),
    # {b} 60-80: a filter on "public" keeps 0-60, filmed by public cameras all along.
    from lacarte import camerafilters

    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 1, box(0, -5, 50, 5)),
        ("b", "detection", 1, box(30, -5, 80, 5)),
        ("c", "detection", 1, box(40, -5, 60, 5)),
    ])  # fmt: skip
    pairs = exposure.edge_band_pairs(edges, bands)
    public = camerafilters.camera_mask("public", "dome", 3)
    private = camerafilters.camera_mask("private_outdoor", "dome", 3)
    masks = {"a": public, "b": private, "c": public}

    def parts(**kw):
        p = exposure.street_portions(edges, pairs, estimates=[1], **kw)
        return [
            (round(r.geometry.bounds[0]), round(r.geometry.bounds[2]), list(r.cameras))
            for r in p.itertuples()
        ]

    assert parts() == [(0, 80, ["a:1", "b:1", "c:1"])]  # one level, no masks: one part
    assert parts(masks=masks) == [
        (0, 30, ["a:1"]), (30, 60, ["a:1", "b:1", "c:1"]), (60, 80, ["b:1"]),
    ]  # fmt: skip
    # The union of categories alone changes where the profiles do here.
    assert parts(masks=masks, profiles=False) == parts(masks=masks)


def test_level_changes_under_2_m_join_their_neighbour_for_drawing_only():
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "residential",
         "geometry": LineString([(0, 0), (100, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 1, box(0, -5, 60, 5)),
        ("a", "identification", 1, box(20, -5, 21.5, 5)),  # 1.5 m: joins the detection
        ("a", "recognition", 1, box(40, -5, 43, 5)),  # 3 m: stays
    ])  # fmt: skip
    pairs = exposure.edge_band_pairs(edges, bands)
    p = exposure.street_portions(edges, pairs, estimates=[1])
    got = [
        (round(r.geometry.bounds[0]), round(r.geometry.bounds[2]), r.level) for r in p.itertuples()
    ]
    assert got == [(0, 40, 1), (40, 43, 2), (43, 60, 1)]
    # Statistics are unchanged: identification is still measured.
    e = exposure.expose(edges, bands, cams_frame([{"camera_id": "a", "operator_class": "public"}]))
    assert e.filmed_m_identification_probable.iloc[0] == pytest.approx(1.5, abs=SLACK)
    assert e.max_level_probable.iloc[0] == 3


def test_short_level_runs_join_the_longer_neighbour_of_the_same_profiles():
    runs = [[0, 10, 1, 0, 0, "x"], [10, 11, 3, 1, 1, "x"], [11, 14, 2, 2, 2, "x"]]
    assert exposure.merge_short_levels(runs) == [[0, 11, 1, 0, 1, "x"], [11, 14, 2, 2, 2, "x"]]
    runs = [[0, 3, 1, 0, 0, "x"], [3, 4, 3, 1, 1, "x"], [4, 14, 1, 2, 2, "x"]]
    assert exposure.merge_short_levels(runs) == [[0, 14, 1, 0, 2, "x"]]  # rejoins its level
    # Not across a change of profiles (filters stay exact), nor across a gap.
    runs = [[0, 10, 1, 0, 0, "x"], [10, 11, 3, 1, 1, "y"], [12, 20, 1, 2, 2, "y"]]
    assert exposure.merge_short_levels(runs) == runs


def test_a_street_recognised_but_just_outside_the_detection_band_is_filmed():
    # Bands nest only up to their 1 mm grid: here the recognition band passes 1.5 mm beyond
    # the detection band, along a path grazing it for 5 m. The path is filmed there, at
    # recognition, by that camera (IDF: 366 portions listed no camera).
    ways = ways_frame([
        {"way_id": 1, "node_ids": [1, 2], "highway": "footway",
         "geometry": LineString([(0, 0), (20, 0)])},
    ])  # fmt: skip
    edges = exposure.build_edges(exposure.select_ways(ways))
    bands = bands_frame([
        ("a", "detection", 1, box(0, 0.0025, 20, 30)),  # stops 2.5 mm short of the path
        ("a", "recognition", 1, box(5, -0.001, 10, 20)),  # reaches over it for 5 m
    ])  # fmt: skip
    cams = cams_frame([{"camera_id": "a", "operator_class": "public"}])
    pairs = exposure.edge_band_pairs(edges, bands)
    e = exposure.expose(edges, bands, cams, pairs).iloc[0]
    assert e.filmed_m_probable == pytest.approx(5, abs=SLACK)
    assert e.max_level_probable == 2
    iv = exposure.filmed_intervals(edges, pairs, set())
    assert list(iv[iv.est == 1].hi - iv[iv.est == 1].lo) == pytest.approx([5], abs=SLACK)
    p = exposure.street_portions(edges, pairs, estimates=[1])
    assert [(r.level, list(r.cameras)) for r in p.itertuples()] == [(2, ["a:1"])]
