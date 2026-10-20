"""Frozen cases for communes and départements (IGN ADMIN EXPRESS COG CARTO)."""

import json

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from shapely import LineString, Point, box

from lacarte import admin, aggregate

CRS = "EPSG:2154"


def units_frame(rows):
    df = pd.DataFrame(rows, columns=["code", "name", "dep", "parent", "geometry"])
    df.insert(4, "town", df.name)
    return gpd.GeoDataFrame(df, geometry="geometry", crs=CRS)


def test_divided_communes_are_replaced_by_their_arrondissements_whatever_the_city():
    communes = gpd.GeoDataFrame({
        admin.CODE: ["75056", "69123", "13055", "92062"],
        admin.NAME: ["Paris", "Lyon", "Marseille", "Puteaux"],
        admin.DEP: ["75", "69", "13", "92"],
        admin.GEOM: [box(0, 0, 2, 1), box(10, 0, 11, 1), box(20, 0, 21, 1), box(30, 0, 31, 1)],
    }, geometry=admin.GEOM, crs=CRS)  # fmt: skip
    arm = gpd.GeoDataFrame({
        admin.CODE: ["75101", "75102", "69381", "13201", "99999"],
        admin.NAME: ["Paris 1er", "Paris 2e", "Lyon 1er", "Marseille 1er", "not in the region"],
        admin.PARENT: ["75056", "75056", "69123", "13055", "00000"],
        admin.GEOM: [box(0, 0, 1, 1), box(1, 0, 2, 1), box(10, 0, 11, 1), box(20, 0, 21, 1),
                     box(50, 0, 51, 1)],
    }, geometry=admin.GEOM, crs=CRS)  # fmt: skip
    u = admin.split_communes(communes, arm)
    assert list(u.code) == ["13201", "69381", "75101", "75102", "92062"]
    assert list(u.dep) == ["13", "69", "75", "75", "92"]
    assert list(u.parent) == ["13055", "69123", "75056", "75056", None]
    assert list(u.town) == ["Marseille", "Lyon", "Paris", "Paris", "Puteaux"]


def test_segments_are_cut_at_the_limits_and_gaps_go_to_the_nearest_unit():
    units = units_frame([
        ("A", "a", "1", None, box(0, -10, 60, 10)),
        ("B", "b", "1", None, box(60, -10, 100, 10)),
    ])  # fmt: skip
    lines = [
        LineString([(10, 0), (50, 0)]),  # inside A
        LineString([(40, 0), (90, 0)]),  # 20 m in A, 30 m in B
        LineString([(90, 0), (130, 0)]),  # 10 m in B, 30 m in a gap: nearest is B, 5-30 m
        LineString([(0, 500), (10, 500)]),  # far from every unit: outside
    ]
    s = admin.cut_edges(lines, units, rescue_m=100)
    got = [(r.e, r.unit, round(r.lo, 6), round(r.hi, 6), r.rescued) for r in s.itertuples()]
    assert got == [
        (0, 0, 0, 40, False),
        (1, 0, 0, 20, False), (1, 1, 20, 50, False),
        (2, 1, 0, 10, False), (2, 1, 10, 40, True),
        (3, -1, 0, 10, False),
    ]  # fmt: skip
    # The stretches partition every line.
    assert (s.hi - s.lo).groupby(s.e).sum().tolist() == pytest.approx([40, 50, 40, 10])


def test_filmed_stretches_are_cut_at_the_same_points():
    stretches = pd.DataFrame({"e": [0, 0], "unit": [0, 1], "lo": [0.0, 20.0], "hi": [20.0, 50.0]})
    # The last row: the probable estimate filmed by cameras with a surveyed direction only.
    intervals = pd.DataFrame({
        "e": [0, 0, 0, 0], "est": [1, 1, 2, 1], "pub": [False, False, True, False],
        "dir": [False, False, False, True],
        "lo": [5.0, 30.0, 0.0, 10.0], "hi": [25.0, 35.0, 50.0, 25.0],
    })  # fmt: skip
    f = admin.filmed_by_stretch(stretches, intervals)
    assert f.filmed_m_probable.tolist() == pytest.approx([15, 10])  # 5-20 | 20-25 + 30-35
    assert f.filmed_m_cautious_pub.tolist() == pytest.approx([20, 30])
    assert f.filmed_m_certain.tolist() == [0, 0]
    assert f.filmed_m_probable_dir.tolist() == pytest.approx([10, 5])  # 10-20 | 20-25
    assert f.filmed_m_probable_dir_pub.tolist() == [0, 0]


def cams_frame(rows):
    base = {"is_camera": True, "direction_certainty": "estimated", "indoor": False,
            "type_known": True, "stale_flags": [], "survey_date": "2026-01-01",
            "osm_timestamp": "2026-09-01T00:00:00+00:00", "operator_class": "public",
            "operator_norm": None, "kind": "dome"}  # fmt: skip
    data = [{**base, **r} for r in rows]
    return gpd.GeoDataFrame(data, geometry="geometry", crs=CRS)


def test_areas_sum_to_the_totals_and_departements_recount_their_cameras():
    units = units_frame([
        ("A", "a", "1", None, box(0, -10, 60, 10)),
        ("B", "b", "1", None, box(60, -10, 100, 10)),
        ("C", "c", "2", None, box(100, -10, 140, 10)),
    ])  # fmt: skip
    deps = gpd.GeoDataFrame(
        {"code": ["1", "2"], "name": ["Un", "Deux"]},
        geometry=[box(0, -10, 100, 10), box(100, -10, 140, 10)],
        crs=CRS,
    )
    edges = gpd.GeoDataFrame({
        "assessed": [True, True, False, True], "axis": [True, True, True, False],
        "counted": [True, True, False, False], "length_m": [80.0, 40.0, 10.0, 40.0],
    }, geometry=[LineString([(20, 0), (100, 0)]), LineString([(100, 0), (140, 0)]),
                 LineString([(0, 5), (10, 5)]), LineString([(20, 3), (60, 3)])],
        crs=CRS)  # fmt: skip
    # Segment 0 filmed 30-50 m along (typical, all), i.e. x 50-70: 10 m in A, 10 m in B.
    # Segment 3, a sidewalk (not an axis, so not counted), filmed along: left out like
    # segment 2 (exposure.mark_counted).
    intervals = pd.DataFrame({"e": [0, 2, 3], "est": [1, 1, 1], "pub": [False] * 3,
                              "dir": [False] * 3,
                              "lo": [30.0, 0.0, 0.0], "hi": [50.0, 10.0, 40.0]})  # fmt: skip
    cams = aggregate.prepare_cameras(cams_frame([
        {"camera_id": "n1", "operator_norm": "SNCF", "geometry": Point(10, 0)},
        {"camera_id": "n2", "operator_norm": "SNCF", "geometry": Point(70, 0)},
        {"camera_id": "n3", "operator_norm": "RATP", "geometry": Point(80, 0),
         "operator_class": "private_outdoor", "direction_certainty": "default"},
        {"camera_id": "n4", "geometry": Point(120, 0)},
    ]))  # fmt: skip
    areas, stats = admin.aggregate_areas(edges, intervals, cams, units, deps)
    a = areas.set_index("code")
    assert a.loc[["A", "B", "C"], "road_m"].tolist() == pytest.approx([40, 40, 40])
    assert a.loc[["A", "B"], "filmed_m_probable"].tolist() == pytest.approx([10, 10])
    assert a.loc["A", "filmed_ratio_probable"] == pytest.approx(0.25)
    assert a.loc["1", "road_m"] == pytest.approx(80)  # non-assessed and non-axis left out
    assert a.loc["1", "filmed_m_probable"] == pytest.approx(20)
    assert a.loc["1", "camera_count"] == 3 and a.loc["1", "n_public"] == 2
    assert a.loc["2", "camera_count"] == 1
    # Département reliability comes from its cameras, not from its communes' averages.
    assert a.loc["1", "direction_known_share"] == pytest.approx(2 / 3)
    assert a.loc["1", "reliability_reason"] == "no_direction"
    assert json.loads(a.loc["1", "operators"]) == [["SNCF", 2], ["RATP", 1]]
    assert json.loads(a.loc["C", "operators"]) == []  # no name: not an operator
    assert a.loc["B", "dep_name"] == "Un"
    assert stats["road_in_units_m"] == pytest.approx(120) and stats["segments_cut"] == 1


def test_areas_count_their_cameras_by_type_and_class_alike():
    # The punk sheet's « Caméras » lists the types (n_kind_<kind>, rules/defaults.yaml
    # kinds); each set of counts adds up to camera_count, an area without camera to zeros.
    units = units_frame([
        ("A", "a", "1", None, box(0, -10, 60, 10)),
        ("B", "b", "1", None, box(60, -10, 100, 10)),
        ("C", "c", "1", None, box(100, -10, 140, 10)),
    ])  # fmt: skip
    deps = gpd.GeoDataFrame({"code": ["1"], "name": ["Un"]},
                            geometry=[box(0, -10, 140, 10)], crs=CRS)  # fmt: skip
    edges = gpd.GeoDataFrame({"counted": [True], "length_m": [140.0]},
                             geometry=[LineString([(0, 0), (140, 0)])], crs=CRS)  # fmt: skip
    intervals = pd.DataFrame(columns=["e", "est", "pub", "dir", "lo", "hi"])
    cams = aggregate.prepare_cameras(cams_frame([
        {"camera_id": "n1", "kind": "dome", "operator_norm": "SNCF", "geometry": Point(10, 0)},
        {"camera_id": "n2", "kind": "fixed", "geometry": Point(20, 0)},
        {"camera_id": "n3", "kind": "fixed", "geometry": Point(30, 0),
         "operator_class": "private_outdoor"},
        {"camera_id": "n4", "kind": "unknown", "type_known": False, "geometry": Point(70, 0)},
        {"camera_id": "n5", "kind": "ptz", "geometry": Point(80, 0)},
    ]))  # fmt: skip
    areas, _ = admin.aggregate_areas(edges, intervals, cams, units, deps)
    a = areas.set_index("code")
    kinds = [f"n_kind_{k}" for k in aggregate.KINDS]
    assert aggregate.KINDS == ["dome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"]
    assert a.loc["A", kinds].tolist() == [1, 2, 0, 0, 0, 0, 0]
    assert a.loc["B", kinds].tolist() == [0, 0, 1, 0, 0, 0, 1]
    assert a.loc["C", kinds].tolist() == [0] * 7  # no camera: zeros, not missing
    assert a.loc["1", kinds].tolist() == [1, 2, 1, 0, 0, 0, 1]
    classes = [f"n_{c}" for c in aggregate.OPERATOR_CLASSES]
    for code in ("A", "B", "C", "1"):
        n = a.loc[code, "camera_count"]
        assert a.loc[code, kinds].sum() == n and a.loc[code, classes].sum() == n


def test_top_operators_keep_five_by_count_then_name():
    names = ["F", "E", "E", "D", "C", "B", "A", "A", "A"]
    cams = pd.DataFrame({"unit": 0, "operator_norm": names})
    top = json.loads(admin.top_operators(cams, "unit")[0])
    assert top == [["A", 3], ["E", 2], ["B", 1], ["C", 1], ["D", 1]]


def test_the_sum_check_catches_a_lost_stretch():
    assessed = pd.DataFrame({"length_m": [50.0]}, index=[0])
    stretches = pd.DataFrame({"e": [0], "lo": [0.0], "hi": [40.0]})
    intervals = pd.DataFrame({"e": [], "est": [], "pub": [], "dir": [], "lo": [], "hi": []})
    with pytest.raises(AssertionError):
        admin.check_sums(stretches, assessed, intervals, dict.fromkeys(aggregate.FILMED, 0.0))


def test_points_outside_every_unit_go_to_the_nearest_within_the_distance():
    units = units_frame([("A", "a", "1", None, box(0, 0, 10, 10))])
    pts = np.array([Point(5, 5), Point(15, 5), Point(500, 5)], dtype=object)
    unit, rescued = admin.assign_points(pts, units, rescue_m=100)
    assert unit.tolist() == [0, 0, -1] and rescued.tolist() == [False, True, False]


@pytest.mark.parametrize(
    ("op", "town", "want"),
    [
        ("Mairie", "Cachan", "Ville de Cachan"),
        ("Ville (sans précision)", "Asnières-sur-Seine", "Ville d'Asnières-sur-Seine"),
        ("Ville", "Le Pecq", "Ville du Pecq"),
        ("Police Municipale", "Les Lilas", "Police municipale des Lilas"),
        ("mairie de bailly", "Versailles", "Ville de Bailly"),
        ("Mairie de Saint-cyr-l'école", "Paris", "Ville de Saint-Cyr-l'École"),
        ("Mairie du Pecq", "Paris", "Ville du Pecq"),
        ("Villes de Paris", "Paris", "Ville de Paris"),
        ("Franconville", "Paris", "Ville de Franconville"),
        ("Mairie de Nulle-Part", "Paris", "Mairie de Nulle-Part"),  # not a commune here
        ("SNCF", "Paris", "SNCF"),
        ("private", "Paris", None),
        ("Inconnu", "Paris", None),
    ],
)  # fmt: skip
def test_municipal_operators_get_their_town(op, town, want):
    towns = {"cachan": "Cachan", "bailly": "Bailly", "saint cyr l ecole": "Saint-Cyr-l'École",
             "le pecq": "Le Pecq", "paris": "Paris", "franconville": "Franconville"}  # fmt: skip
    assert admin.operator_name(op, town, towns) == want


def test_uninformative_operators_are_counted_apart():
    units = units_frame([("A", "Cachan", "1", None, box(0, -10, 60, 10))])
    deps = gpd.GeoDataFrame({"code": ["1"], "name": ["Un"]}, geometry=[box(0, -10, 60, 10)],
                            crs=CRS)  # fmt: skip
    edges = gpd.GeoDataFrame({"counted": [True], "length_m": [40.0]},
                             geometry=[LineString([(10, 0), (50, 0)])], crs=CRS)  # fmt: skip
    intervals = pd.DataFrame({"e": [], "est": [], "pub": [], "dir": [], "lo": [], "hi": []})
    cams = aggregate.prepare_cameras(cams_frame([
        {"camera_id": "n1", "operator_norm": "private", "geometry": Point(10, 0)},
        {"camera_id": "n2", "operator_norm": "Mairie", "geometry": Point(20, 0)},
        {"camera_id": "n3", "operator_norm": "Ville de Cachan", "geometry": Point(30, 0)},
    ]))  # fmt: skip
    areas, _ = admin.aggregate_areas(edges, intervals, cams, units, deps)
    a = areas.set_index("code")
    assert json.loads(a.loc["A", "operators"]) == [["Ville de Cachan", 2]]
    assert a.loc["A", "n_no_operator_info"] == 1 and a.loc["1", "n_no_operator_info"] == 1


@pytest.mark.parametrize(
    "beside",
    [
        # two sidewalks mapped as plain footways, 6 m each side (rule:streets@2)
        [("footway", 6), ("footway", -6)],
        # two cycle tracks, or a path and a cycle track (rule:streets@3.1:parallel_path)
        [("cycleway", 6), ("cycleway", -6)],
        [("path", 6), ("cycleway", -6)],
        # a motorway 8 m off, filmed over 50 m: drawn, never counted (drawn_highways)
        [("motorway", 8)],
    ],
)
def test_a_street_with_two_sidewalks_has_the_share_of_the_street_alone(beside):
    # A street and what runs beside it; a camera films half of the street and all of one
    # side. Paths beside a road are not axes (rules/streets.yaml parallel_path), motorways
    # are not counted: the commune's share is the street's.
    from test_exposure import bands_frame, ways_frame
    from test_exposure import cams_frame as street_cams

    from lacarte import exposure

    def share(with_sidewalks: bool) -> float:
        rows = [{"way_id": 1, "node_ids": [1, 2], "highway": "residential",
                 "geometry": LineString([(0, 0), (100, 0)])}]  # fmt: skip
        if with_sidewalks:
            rows += [
                {"way_id": 2 + i, "node_ids": [10 + 2 * i, 11 + 2 * i], "highway": hw,
                 "geometry": LineString([(0, y), (100, y)])}
                for i, (hw, y) in enumerate(beside)
            ]  # fmt: skip
        ways = ways_frame(rows)
        edges = exposure.mark_parallel_paths(exposure.build_edges(exposure.select_ways(ways)), ways)
        edges = exposure.mark_counted(edges)
        bands = bands_frame([("a", "detection", 1, box(0, -2, 50, 10))])
        pairs = exposure.edge_band_pairs(edges, bands)
        street = street_cams([{"camera_id": "a", "operator_class": "public"}])
        edges = exposure.expose(edges, bands, street, pairs)
        intervals = exposure.filmed_intervals(edges, pairs, {"a"})
        units = units_frame([("A", "a", "1", None, box(-10, -20, 110, 20))])
        deps = gpd.GeoDataFrame({"code": ["1"], "name": ["Un"]},
                                geometry=[box(-10, -20, 110, 20)], crs=CRS)  # fmt: skip
        one = {"camera_id": "a", "operator_norm": "SNCF", "geometry": Point(0, 0)}
        cams = aggregate.prepare_cameras(cams_frame([one]))
        areas, _ = admin.aggregate_areas(edges, intervals, cams, units, deps)
        return float(areas.set_index("code").loc["A", "filmed_ratio_probable"])

    assert share(True) == pytest.approx(share(False), abs=1e-4)
    assert share(False) == pytest.approx(0.5, abs=1e-4)
